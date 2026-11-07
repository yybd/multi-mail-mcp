#!/usr/bin/env node
// Streamable HTTP entry point — for ChatGPT, or any client that connects by URL.
// Stateless: each POST /mcp gets a fresh server+transport pair.
//
// Env:
//   MCP_AUTH_TOKEN  required. Sent as "Authorization: Bearer <token>", or as ?api_key=<token>
//                   for clients that cannot send headers (ChatGPT connectors).
//   PORT            default 3333
//   HOST            default 127.0.0.1 — reach it from outside through a tunnel, not by
//                   opening the port.

import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './mcp.js';
import { listAccounts } from './config.js';

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? '127.0.0.1';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? '';

if (AUTH_TOKEN.length < 24) {
  console.error(
    'MCP_AUTH_TOKEN is missing or shorter than 24 characters. This server can read and send your mail, ' +
      'so the HTTP endpoint will not start without one. Generate one with: npx -y @yybd/multi-mail-mcp token'
  );
  process.exit(1);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(req: express.Request): boolean {
  const h = req.headers.authorization ?? '';
  if (h.startsWith('Bearer ') && safeEqual(h.slice(7), AUTH_TOKEN)) return true;
  const q = req.query.api_key;
  return typeof q === 'string' && safeEqual(q, AUTH_TOKEN);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'multi-mail', accounts: listAccounts().length });
});

app.post('/mcp', async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('mcp request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').send());
app.delete('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').send());

app.listen(PORT, HOST, () => {
  console.log(`multi-mail MCP listening on http://${HOST}:${PORT}/mcp (${listAccounts().length} account(s))`);
});
