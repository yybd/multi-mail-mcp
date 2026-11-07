// Building outgoing RFC 5322 messages and reading incoming Gmail payloads.
// Everything is UTF-8 safe, so Hebrew subjects, names and bodies survive.

import type { gmail_v1 } from '@googleapis/gmail';

// ---------- outgoing ----------

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded-words, split so no chunk breaks a UTF-8 character. */
export function encodeHeader(value: string): string {
  if (isAscii(value)) return value;
  const chunks: string[] = [];
  let cur = '';
  for (const ch of value) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 45) {
      chunks.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** "Name <a@b.c>" or "a@b.c" — encodes a non-ASCII display name. */
export function encodeAddress(addr: string): string {
  const m = addr.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
  if (!m) return addr.trim();
  const [, name, email] = m;
  if (!name) return email.trim();
  return `${isAscii(name) ? `"${name.replace(/"/g, '\\"')}"` : encodeHeader(name)} <${email.trim()}>`;
}

function b64Lines(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
}

/** Turn "a@x, b@y" or ["a@x", "b@y"] into a clean list. */
export function addressList(v?: string | string[]): string[] {
  if (!v) return [];
  const src = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const s of src) {
    // split on , or ; outside "quotes" and <angle brackets>
    let cur = '';
    let quoted = false;
    let angle = false;
    for (const ch of s) {
      if (ch === '"' && !angle) quoted = !quoted;
      else if (ch === '<' && !quoted) angle = true;
      else if (ch === '>' && !quoted) angle = false;
      if ((ch === ',' || ch === ';') && !quoted && !angle) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export interface Outgoing {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}

/** Returns the message as base64url, ready for Gmail's `raw` field. */
export function buildRaw(m: Outgoing): string {
  const headers: string[] = [
    `From: ${encodeAddress(m.from)}`,
    `To: ${m.to.map(encodeAddress).join(', ')}`,
  ];
  if (m.cc?.length) headers.push(`Cc: ${m.cc.map(encodeAddress).join(', ')}`);
  if (m.bcc?.length) headers.push(`Bcc: ${m.bcc.map(encodeAddress).join(', ')}`);
  headers.push(`Subject: ${encodeHeader(m.subject)}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references) headers.push(`References: ${m.references}`);
  headers.push('MIME-Version: 1.0');

  let body: string;
  if (m.html) {
    const boundary = `mm_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(m.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(m.html),
      `--${boundary}--`,
      '',
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
    body = b64Lines(m.text);
  }
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

// ---------- incoming ----------

export function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  const n = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === n)?.value ?? undefined;
}

function decode(data?: string | null): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => `${txt} (${href})`)
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
}

export function extractBody(payload?: gmail_v1.Schema$MessagePart): { text: string; attachments: Attachment[] } {
  let text = '';
  let html = '';
  const attachments: Attachment[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    if (p.filename && (p.body?.attachmentId || p.body?.size)) {
      attachments.push({ filename: p.filename, mimeType: p.mimeType ?? '', size: p.body?.size ?? 0 });
    } else if (p.mimeType === 'text/plain' && p.body?.data && !text) {
      text = decode(p.body.data);
    } else if (p.mimeType === 'text/html' && p.body?.data && !html) {
      html = decode(p.body.data);
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return { text: text.trim() || htmlToText(html), attachments };
}
