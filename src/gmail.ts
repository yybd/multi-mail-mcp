// Gmail operations, one authorized client per connected account.

import { gmail as gmailApi, auth, type gmail_v1 } from '@googleapis/gmail';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, hasLabelScope, listAccounts, loadClientSecrets, resolveAccount, updateTokens, type Account } from './config.js';
import { addressList, attachmentParts, buildRaw, extractBody, header, safeFilename, type Attachment } from './mime.js';

export function oauthClient(redirectUri?: string) {
  const { clientId, clientSecret } = loadClientSecrets();
  return new auth.OAuth2(clientId, clientSecret, redirectUri);
}

const clients = new Map<string, { refresh: string; api: gmail_v1.Gmail }>();

export function apiFor(acc: Account): gmail_v1.Gmail {
  const refresh = acc.tokens.refresh_token ?? '';
  const cached = clients.get(acc.email);
  if (cached && cached.refresh === refresh) return cached.api;
  if (!refresh) throw new Error(`${acc.email} has no refresh token — reconnect it: npx -y @yybd/multi-mail-mcp add`);
  const client = oauthClient();
  client.setCredentials(acc.tokens);
  client.on('tokens', (t) => updateTokens(acc.email, t));
  const api = gmailApi({ version: 'v1', auth: client });
  clients.set(acc.email, { refresh, api });
  return api;
}

/** Turns Google's terse auth failures into something the user can act on. */
async function call<T>(acc: Account, fn: (api: gmail_v1.Gmail) => Promise<T>): Promise<T> {
  try {
    return await fn(apiFor(acc));
  } catch (err: any) {
    const msg = String(err?.response?.data?.error_description ?? err?.response?.data?.error?.message ?? err?.message ?? err);
    if (/invalid_grant|unauthorized_client|Token has been expired or revoked/i.test(msg)) {
      throw new Error(
        `Access to ${acc.email} has expired or was revoked. Reconnect: npx -y @yybd/multi-mail-mcp add ${acc.email}. ` +
          '(If this happens every 7 days, the OAuth app is still in "Testing" — publish it, see README.)'
      );
    }
    throw new Error(`${acc.email}: ${msg}`);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- read ----------

export interface Summary {
  account: string;
  id: string;
  threadId: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  labels: string[];
  unread: boolean;
}

function summarize(account: string, m: gmail_v1.Schema$Message): Summary {
  const labels = m.labelIds ?? [];
  return {
    account,
    id: m.id ?? '',
    threadId: m.threadId ?? '',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, 'Date') ?? '',
    from: header(m, 'From') ?? '',
    to: header(m, 'To') ?? '',
    subject: header(m, 'Subject') ?? '(no subject)',
    snippet: decodeSnippet(m.snippet ?? ''),
    labels,
    unread: labels.includes('UNREAD'),
  };
}

function decodeSnippet(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export async function searchAccount(
  acc: Account,
  query: string,
  maxResults: number,
  pageToken?: string
): Promise<{ messages: Summary[]; nextPageToken?: string; estimate?: number }> {
  return call(acc, async (api) => {
    const list = await api.users.messages.list({ userId: 'me', q: query || undefined, maxResults, pageToken });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const full = await mapLimit(ids, 10, (id) =>
      api.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      })
    );
    return {
      messages: full.map((r) => summarize(acc.email, r.data)),
      nextPageToken: list.data.nextPageToken ?? undefined,
      estimate: list.data.resultSizeEstimate ?? undefined,
    };
  });
}

/** Search one account, or every account at once ("all"), newest first. */
export async function search(accountSel: string | undefined, query: string, maxResults: number, pageToken?: string) {
  if (accountSel?.trim().toLowerCase() === 'all') {
    const accounts = listAccounts();
    if (accounts.length === 0) throw new Error('No Gmail accounts are connected. Run: npx -y @yybd/multi-mail-mcp add');
    const results = await Promise.all(
      accounts.map((a) =>
        searchAccount(a, query, maxResults).then(
          (r) => ({ ok: true as const, r }),
          (e: Error) => ({ ok: false as const, error: `${a.email}: ${e.message}` })
        )
      )
    );
    const messages = results
      .flatMap((x) => (x.ok ? x.r.messages : []))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, maxResults);
    const errors = results.flatMap((x) => (x.ok ? [] : [x.error]));
    if (errors.length === accounts.length) throw new Error(errors.join('\n'));
    return { messages, ...(errors.length ? { errors } : {}) };
  }
  return searchAccount(resolveAccount(accountSel), query, maxResults, pageToken);
}

export interface FullMessage extends Summary {
  cc: string;
  replyTo: string;
  messageIdHeader: string;
  body: string;
  truncated: boolean;
  attachments: Attachment[];
}

function toFull(account: string, m: gmail_v1.Schema$Message, maxChars: number): FullMessage {
  const { text, attachments } = extractBody(m.payload);
  return {
    ...summarize(account, m),
    cc: header(m, 'Cc') ?? '',
    replyTo: header(m, 'Reply-To') ?? '',
    messageIdHeader: header(m, 'Message-ID') ?? '',
    body: text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text,
    truncated: text.length > maxChars,
    attachments,
  };
}

export async function readMessage(accountSel: string | undefined, id: string, maxChars: number): Promise<FullMessage> {
  const acc = resolveAccount(accountSel);
  return call(acc, async (api) => {
    const r = await api.users.messages.get({ userId: 'me', id, format: 'full' });
    return toFull(acc.email, r.data, maxChars);
  });
}

export async function readThread(accountSel: string | undefined, threadId: string, maxChars: number) {
  const acc = resolveAccount(accountSel);
  return call(acc, async (api) => {
    const r = await api.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    const msgs = r.data.messages ?? [];
    const per = Math.max(2000, Math.floor(maxChars / Math.max(1, msgs.length)));
    return { account: acc.email, threadId, messages: msgs.map((m) => toFull(acc.email, m, per)) };
  });
}

export async function listLabels(accountSel: string | undefined) {
  const acc = resolveAccount(accountSel);
  return call(acc, async (api) => {
    const r = await api.users.labels.list({ userId: 'me' });
    return {
      account: acc.email,
      labels: (r.data.labels ?? [])
        .map((l) => ({ id: l.id, name: l.name, type: l.type }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  });
}

export async function getProfile(acc: Account) {
  return call(acc, async (api) => (await api.users.getProfile({ userId: 'me' })).data);
}

// ---------- write ----------

export interface Compose {
  account?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  body: string;
  html?: string;
  replyToMessageId?: string;
  replyAll?: boolean;
}

const sameAddr = (a: string, b: string) => {
  const e = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
  return e(a) === e(b);
};

async function prepare(c: Compose): Promise<{ acc: Account; raw: string; threadId?: string; to: string[]; subject: string }> {
  const acc = resolveAccount(c.account);
  let to = addressList(c.to);
  let cc = addressList(c.cc);
  let subject = c.subject ?? '';
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;

  if (c.replyToMessageId) {
    const orig = await call(acc, (api) =>
      api.users.messages.get({
        userId: 'me',
        id: c.replyToMessageId!,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Message-ID', 'References'],
      })
    );
    const m = orig.data;
    threadId = m.threadId ?? undefined;
    inReplyTo = header(m, 'Message-ID');
    references = [header(m, 'References'), inReplyTo].filter(Boolean).join(' ') || undefined;
    const origSubject = header(m, 'Subject') ?? '';
    if (!subject) subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
    if (to.length === 0) {
      const sender = header(m, 'Reply-To') ?? header(m, 'From') ?? '';
      // Replying to a message I sent goes back to its recipients, not to me.
      to = sameAddr(sender, acc.email) ? addressList(header(m, 'To')) : addressList(sender);
      if (c.replyAll) {
        const others = [...addressList(header(m, 'To')), ...addressList(header(m, 'Cc'))];
        for (const a of others) {
          if (!sameAddr(a, acc.email) && !to.some((t) => sameAddr(t, a)) && !cc.some((t) => sameAddr(t, a))) cc.push(a);
        }
      }
    }
  }

  if (to.length === 0) throw new Error('No recipient: give "to", or "reply_to_message_id" to answer a message.');
  if (!subject) throw new Error('No subject given.');

  const raw = buildRaw({
    from: acc.email,
    to,
    cc,
    bcc: addressList(c.bcc),
    subject,
    text: c.body,
    html: c.html,
    inReplyTo,
    references,
  });
  return { acc, raw, threadId, to: [...to, ...cc], subject };
}

export async function sendEmail(c: Compose) {
  const p = await prepare(c);
  const r = await call(p.acc, (api) =>
    api.users.messages.send({ userId: 'me', requestBody: { raw: p.raw, threadId: p.threadId } })
  );
  return { sent: true, account: p.acc.email, id: r.data.id, threadId: r.data.threadId, to: p.to, subject: p.subject };
}

export async function createDraft(c: Compose) {
  const p = await prepare(c);
  const r = await call(p.acc, (api) =>
    api.users.drafts.create({ userId: 'me', requestBody: { message: { raw: p.raw, threadId: p.threadId } } })
  );
  return {
    draft: true,
    account: p.acc.email,
    draftId: r.data.id,
    messageId: r.data.message?.id,
    to: p.to,
    subject: p.subject,
    note: 'Saved in Gmail Drafts — not sent.',
  };
}

export async function listDrafts(accountSel: string | undefined, maxResults: number) {
  const acc = resolveAccount(accountSel);
  return call(acc, async (api) => {
    const list = await api.users.drafts.list({ userId: 'me', maxResults });
    const drafts = await mapLimit(list.data.drafts ?? [], 10, async (d) => {
      const r = await api.users.drafts.get({ userId: 'me', id: d.id!, format: 'metadata' });
      const m = r.data.message ?? {};
      return { draftId: d.id, ...summarize(acc.email, m) };
    });
    return { account: acc.email, drafts };
  });
}

export async function sendDraft(accountSel: string | undefined, draftId: string) {
  const acc = resolveAccount(accountSel);
  const r = await call(acc, (api) => api.users.drafts.send({ userId: 'me', requestBody: { id: draftId } }));
  return { sent: true, account: acc.email, id: r.data.id, threadId: r.data.threadId };
}

// ---------- attachments ----------

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-csv|javascript|x-yaml|yaml|rtf))/i;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface FetchedAttachment {
  account: string;
  messageId: string;
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** text, or PDF text layer */
  text?: string;
  truncated?: boolean;
  /** base64 image for clients that can see images */
  image?: { data: string; mimeType: string };
  /** where the file was written, when it was saved */
  savedTo?: string;
  note?: string;
}

function saveAttachment(account: string, messageId: string, filename: string, bytes: Buffer): string {
  const dir = join(HOME, 'attachments', safeFilename(account), safeFilename(messageId));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, safeFilename(filename));
  writeFileSync(path, bytes, { mode: 0o600 });
  return path;
}

async function pdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join('\n\n') : text).trim();
}

/**
 * Download one attachment. Text and PDF come back as text, images as an image,
 * anything else is saved under ~/.multi-mail/attachments and its path returned.
 */
export async function getAttachment(
  accountSel: string | undefined,
  messageId: string,
  which: { partId?: string; filename?: string },
  opts: { save: boolean; maxChars: number }
): Promise<FetchedAttachment> {
  const acc = resolveAccount(accountSel);
  return call(acc, async (api) => {
    const msg = (await api.users.messages.get({ userId: 'me', id: messageId, format: 'full' })).data;
    const parts = attachmentParts(msg.payload);
    if (parts.length === 0) throw new Error('This message has no attachments.');
    const list = parts.map((p) => `${p.partId}: ${p.filename}`).join(', ');
    let part = which.partId ? parts.find((p) => p.partId === which.partId) : undefined;
    if (!part && which.filename) {
      const hits = parts.filter((p) => p.filename?.toLowerCase() === which.filename!.toLowerCase());
      if (hits.length > 1) throw new Error(`Several attachments are named "${which.filename}" — pass part_id. Attachments: ${list}`);
      part = hits[0];
    }
    if (!part && !which.partId && !which.filename && parts.length === 1) part = parts[0];
    if (!part) throw new Error(`Attachment not found. Attachments: ${list}`);

    const data = part.body?.data
      ? part.body.data
      : (await api.users.messages.attachments.get({ userId: 'me', messageId, id: part.body!.attachmentId! })).data.data;
    const bytes = Buffer.from(data ?? '', 'base64url');
    const mimeType = (part.mimeType ?? 'application/octet-stream').toLowerCase();
    const out: FetchedAttachment = {
      account: acc.email,
      messageId,
      partId: part.partId ?? '',
      filename: part.filename ?? 'attachment',
      mimeType,
      size: bytes.length,
    };
    const truncate = (t: string) => {
      out.truncated = t.length > opts.maxChars;
      return out.truncated ? `${t.slice(0, opts.maxChars)}\n…[truncated]` : t;
    };

    if (mimeType === 'application/pdf' || out.filename.toLowerCase().endsWith('.pdf')) {
      try {
        const t = await pdfText(bytes);
        if (t) out.text = truncate(t);
        else out.note = 'The PDF has no text layer (probably scanned). It was saved so you can open it.';
      } catch (e) {
        out.note = `Could not read the PDF (${(e as Error).message}). It was saved so you can open it.`;
      }
      if (!out.text) out.savedTo = saveAttachment(acc.email, messageId, out.filename, bytes);
    } else if (TEXT_TYPES.test(mimeType)) {
      out.text = truncate(bytes.toString('utf8'));
    } else if (IMAGE_TYPES.test(mimeType) && bytes.length <= MAX_IMAGE_BYTES) {
      out.image = { data: bytes.toString('base64'), mimeType: mimeType.replace('jpg', 'jpeg') };
    } else {
      out.savedTo = saveAttachment(acc.email, messageId, out.filename, bytes);
      out.note = 'This file type cannot be shown inline, so it was saved.';
    }
    if (opts.save && !out.savedTo) out.savedTo = saveAttachment(acc.email, messageId, out.filename, bytes);
    return out;
  });
}

// ---------- labels (opt-in: `add --labels`) ----------

/** Labels this server will not apply: they would move mail to trash or spam. */
export const FORBIDDEN_LABELS = ['TRASH', 'SPAM'];

function requireLabels(acc: Account) {
  if (!hasLabelScope(acc)) {
    throw new Error(
      `Labels are not enabled for ${acc.email}. Reconnect it with label permission: ` +
        `npx -y @yybd/multi-mail-mcp add ${acc.email} --labels`
    );
  }
}

/** Map label names (any case) or ids to ids; system labels like UNREAD pass through. */
export function resolveLabelIds(
  labels: { id?: string | null; name?: string | null }[],
  wanted: string[]
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const w of wanted) {
    const t = w.trim();
    if (!t) continue;
    const hit =
      labels.find((l) => l.id === t) ??
      labels.find((l) => l.name?.toLowerCase() === t.toLowerCase()) ??
      labels.find((l) => l.id?.toLowerCase() === t.toLowerCase());
    if (hit?.id) ids.push(hit.id);
    else unknown.push(t);
  }
  return { ids, unknown };
}

export async function modifyLabels(
  accountSel: string | undefined,
  target: { messageIds?: string[]; threadId?: string },
  add: string[],
  remove: string[]
) {
  const acc = resolveAccount(accountSel);
  requireLabels(acc);
  const banned = add.filter((a) => FORBIDDEN_LABELS.includes(a.trim().toUpperCase()));
  if (banned.length) throw new Error(`Refusing to add ${banned.join(', ')}: this server does not trash or spam mail.`);
  if (!target.threadId && !target.messageIds?.length) throw new Error('Give message_ids or thread_id.');
  return call(acc, async (api) => {
    const labels = (await api.users.labels.list({ userId: 'me' })).data.labels ?? [];
    const a = resolveLabelIds(labels, add);
    const r = resolveLabelIds(labels, remove);
    const unknown = [...a.unknown, ...r.unknown];
    if (unknown.length) throw new Error(`Unknown label(s): ${unknown.join(', ')}. Create one with create_label, or see list_labels.`);
    if (target.threadId) {
      await api.users.threads.modify({
        userId: 'me',
        id: target.threadId,
        requestBody: { addLabelIds: a.ids, removeLabelIds: r.ids },
      });
    } else {
      await api.users.messages.batchModify({
        userId: 'me',
        requestBody: { ids: target.messageIds, addLabelIds: a.ids, removeLabelIds: r.ids },
      });
    }
    return {
      account: acc.email,
      ...(target.threadId ? { threadId: target.threadId } : { messages: target.messageIds!.length }),
      added: a.ids,
      removed: r.ids,
    };
  });
}

export async function createLabel(accountSel: string | undefined, name: string) {
  const acc = resolveAccount(accountSel);
  requireLabels(acc);
  return call(acc, async (api) => {
    const r = await api.users.labels.create({
      userId: 'me',
      requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    return { account: acc.email, id: r.data.id, name: r.data.name };
  });
}
