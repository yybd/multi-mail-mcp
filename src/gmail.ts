// Gmail operations, one authorized client per connected account.

import { gmail as gmailApi, auth, type gmail_v1 } from '@googleapis/gmail';
import { listAccounts, loadClientSecrets, resolveAccount, updateTokens, type Account } from './config.js';
import { addressList, buildRaw, extractBody, header, type Attachment } from './mime.js';

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
