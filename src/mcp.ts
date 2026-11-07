// Builds the MCP server. Entry points: server.ts (stdio), http.ts (Streamable HTTP).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listAccounts } from './config.js';
import {
  createDraft,
  listDrafts,
  listLabels,
  readMessage,
  readThread,
  search,
  sendDraft,
  sendEmail,
} from './gmail.js';

const INSTRUCTIONS = `Gmail across several accounts.
- Call list_accounts first when you don't know which mailbox the user means. Every tool takes "account" (email, alias, or the part before @); with one account connected it may be omitted. search_emails also accepts account="all".
- Queries use Gmail search syntax: from:, to:, subject:, is:unread, has:attachment, after:2026/01/01, newer_than:7d, label:, in:sent, "exact phrase".
- Writing: prefer create_draft. Use send_email only when the user clearly asked to send, and show them recipients, subject and body before sending. To reply, pass reply_to_message_id — it threads correctly and fills recipient and subject.`;

const accountArg = z
  .string()
  .optional()
  .describe('Which mailbox: email address, alias, or local part. Optional when only one account is connected.');

const addrArg = z
  .union([z.string(), z.array(z.string())])
  .optional();

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });

function tool<A>(fn: (a: A) => Promise<unknown>) {
  return async (a: A) => {
    try {
      return json(await fn(a));
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err?.message ?? err}` }], isError: true };
    }
  };
}

const gmailUrl = (account: string, id: string) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(account)}/#all/${id}`;

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'multi-mail', version: '0.1.1' }, { instructions: INSTRUCTIONS });

  const READ = { readOnlyHint: true, openWorldHint: false };
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

  server.registerTool(
    'list_accounts',
    {
      title: 'List mail accounts',
      description: 'The Gmail accounts connected to this server, with their aliases.',
      inputSchema: {},
      annotations: READ,
    },
    tool(async () => ({
      accounts: listAccounts().map((a) => ({ email: a.email, alias: a.alias ?? null })),
      default: process.env.MULTI_MAIL_DEFAULT ?? null,
    }))
  );

  server.registerTool(
    'search_emails',
    {
      title: 'Search mail',
      description:
        'Search one mailbox, or all of them with account="all", using Gmail search syntax. Returns id, thread id, date, from, to, subject and snippet — use read_email for the full body. An empty query lists the newest mail.',
      inputSchema: {
        account: z.string().optional().describe('Email, alias, or "all" to search every connected mailbox.'),
        query: z.string().default('').describe('Gmail query, e.g. "from:bank is:unread newer_than:30d".'),
        max_results: z.number().int().min(1).max(100).default(20),
        page_token: z.string().optional().describe('nextPageToken from a previous call (single account only).'),
      },
      annotations: READ,
    },
    tool(async (a: { account?: string; query: string; max_results: number; page_token?: string }) =>
      search(a.account, a.query, a.max_results, a.page_token)
    )
  );

  server.registerTool(
    'read_email',
    {
      title: 'Read a message',
      description: 'Full message: headers, plain-text body (HTML converted to text) and attachment names.',
      inputSchema: {
        account: accountArg,
        message_id: z.string().describe('Message id from search_emails.'),
        max_chars: z.number().int().min(500).max(200000).default(20000),
      },
      annotations: READ,
    },
    tool(async (a: { account?: string; message_id: string; max_chars: number }) =>
      readMessage(a.account, a.message_id, a.max_chars)
    )
  );

  server.registerTool(
    'read_thread',
    {
      title: 'Read a conversation',
      description: 'Every message in a thread, oldest first.',
      inputSchema: {
        account: accountArg,
        thread_id: z.string().describe('threadId from search_emails or read_email.'),
        max_chars: z.number().int().min(2000).max(400000).default(40000).describe('Total budget across the thread.'),
      },
      annotations: READ,
    },
    tool(async (a: { account?: string; thread_id: string; max_chars: number }) =>
      readThread(a.account, a.thread_id, a.max_chars)
    )
  );

  server.registerTool(
    'list_labels',
    {
      title: 'List labels',
      description: 'Labels/folders of a mailbox, for use with label: in search queries.',
      inputSchema: { account: accountArg },
      annotations: READ,
    },
    tool(async (a: { account?: string }) => listLabels(a.account))
  );

  const composeSchema = {
    account: accountArg.describe('Mailbox to write from (email, alias or local part).'),
    to: addrArg.describe('Recipients: "a@x.com, Name <b@y.com>" or a list. Optional when replying.'),
    cc: addrArg,
    bcc: addrArg,
    subject: z.string().optional().describe('Optional when replying ("Re: …" is added).'),
    body: z.string().describe('Plain-text body.'),
    html: z.string().optional().describe('Optional HTML version of the body.'),
    reply_to_message_id: z.string().optional().describe('Reply in the thread of this message id.'),
    reply_all: z.boolean().default(false).describe('With reply_to_message_id and no "to": copy all original recipients.'),
  };
  type ComposeArgs = {
    account?: string;
    to?: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject?: string;
    body: string;
    html?: string;
    reply_to_message_id?: string;
    reply_all: boolean;
  };
  const toCompose = (a: ComposeArgs) => ({
    account: a.account,
    to: a.to,
    cc: a.cc,
    bcc: a.bcc,
    subject: a.subject,
    body: a.body,
    html: a.html,
    replyToMessageId: a.reply_to_message_id,
    replyAll: a.reply_all,
  });

  server.registerTool(
    'create_draft',
    {
      title: 'Create a draft',
      description: 'Save a message (new or reply) in Gmail Drafts without sending it. The safe default for writing.',
      inputSchema: composeSchema,
      annotations: { ...WRITE, openWorldHint: false },
    },
    tool(async (a: ComposeArgs) => createDraft(toCompose(a)))
  );

  server.registerTool(
    'send_email',
    {
      title: 'Send an email',
      description:
        'Send a message (new or reply) immediately. Only when the user explicitly asked to send; confirm recipients, subject and body with them first.',
      inputSchema: composeSchema,
      annotations: WRITE,
    },
    tool(async (a: ComposeArgs) => sendEmail(toCompose(a)))
  );

  server.registerTool(
    'list_drafts',
    {
      title: 'List drafts',
      description: 'Drafts waiting in a mailbox.',
      inputSchema: { account: accountArg, max_results: z.number().int().min(1).max(100).default(20) },
      annotations: READ,
    },
    tool(async (a: { account?: string; max_results: number }) => listDrafts(a.account, a.max_results))
  );

  server.registerTool(
    'send_draft',
    {
      title: 'Send a draft',
      description: 'Send an existing draft. Only when the user explicitly asked to send it.',
      inputSchema: { account: accountArg, draft_id: z.string().describe('draftId from create_draft or list_drafts.') },
      annotations: WRITE,
    },
    tool(async (a: { account?: string; draft_id: string }) => sendDraft(a.account, a.draft_id))
  );

  // ---- search / fetch: the shape ChatGPT's connectors and deep research expect ----

  server.registerTool(
    'search',
    {
      title: 'Search all mailboxes',
      description:
        'Search every connected Gmail account (Gmail query syntax). Returns result ids for the fetch tool.',
      inputSchema: { query: z.string().describe('Gmail search query.') },
      annotations: READ,
    },
    async ({ query }: { query: string }) => {
      try {
        const r = await search('all', query, 20);
        const results = r.messages.map((m) => ({
          id: `${m.account}:${m.id}`,
          title: `${m.subject} — ${m.from} (${m.date.slice(0, 10)})`,
          url: gmailUrl(m.account, m.id),
        }));
        const errors = 'errors' in r ? r.errors : undefined;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ results, ...(errors ? { errors } : {}) }) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err?.message ?? err}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch a message',
      description: 'Full text of a message returned by the search tool (id is "account:messageId").',
      inputSchema: { id: z.string() },
      annotations: READ,
    },
    async ({ id }: { id: string }) => {
      try {
        const cut = id.lastIndexOf(':');
        if (cut < 0) throw new Error('id must look like "account:messageId"');
        const m = await readMessage(id.slice(0, cut), id.slice(cut + 1), 50000);
        const headers = [
          `From: ${m.from}`,
          `To: ${m.to}`,
          m.cc && `Cc: ${m.cc}`,
          `Date: ${m.date}`,
          `Subject: ${m.subject}`,
          m.attachments.length > 0 && `Attachments: ${m.attachments.map((x) => x.filename).join(', ')}`,
        ].filter(Boolean);
        const text = `${headers.join('\n')}\n\n${m.body}`;
        const doc = {
          id,
          title: m.subject,
          text,
          url: gmailUrl(m.account, m.id),
          metadata: { account: m.account, threadId: m.threadId, from: m.from, date: m.date },
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(doc) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err?.message ?? err}` }], isError: true };
      }
    }
  );

  return server;
}
