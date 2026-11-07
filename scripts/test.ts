// Offline checks: MIME encoding, account selection, and the MCP surface over stdio and HTTP.
// No Google account is needed — the Gmail calls themselves are not exercised here.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const home = mkdtempSync(join(tmpdir(), 'multi-mail-test-'));
process.env.MULTI_MAIL_HOME = home;
mkdirSync(join(home, 'accounts'), { recursive: true });
writeFileSync(join(home, 'credentials.json'), JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }));
for (const [email, alias] of [['me.work@gmail.com', 'work'], ['me.home@gmail.com', 'home']]) {
  writeFileSync(join(home, 'accounts', `${email}.json`), JSON.stringify({ email, alias, tokens: { refresh_token: 'r' }, added: '2026-11-07' }));
}

const { buildRaw, encodeAddress, addressList, extractBody, htmlToText } = await import('../src/mime.js');
const { resolveAccount } = await import('../src/config.js');

// --- MIME ---
const raw = Buffer.from(
  buildRaw({ from: 'me.work@gmail.com', to: ['ישראל ישראלי <a@b.com>'], subject: 'שלום עולם — בדיקה ארוכה מאוד של נושא בעברית שחייב להתפצל', text: 'גוף ההודעה\nשורה שנייה' }),
  'base64url'
).toString('utf8');
assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
const subj = raw.match(/^Subject: ([\s\S]*?)\r\n(?=\S)/m)![1];
const decoded = subj.split(/\r\n /).map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
assert.equal(decoded, 'שלום עולם — בדיקה ארוכה מאוד של נושא בעברית שחייב להתפצל');
const body = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'גוף ההודעה\nשורה שנייה');
assert.match(encodeAddress('ישראל <a@b.com>'), /^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
assert.equal(encodeAddress('"Bob, Jr" <b@c.com>'), '"Bob, Jr" <b@c.com>');
assert.deepEqual(addressList('a@x.com, "Smith, J" <j@y.com>; c@z.com'), ['a@x.com', '"Smith, J" <j@y.com>', 'c@z.com']);
const html = Buffer.from('<p>שלום&nbsp;<b>עולם</b></p><a href="https://x.y">קישור</a>').toString('base64url');
assert.equal(extractBody({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: html } }] }).text, 'שלום עולם\nקישור (https://x.y)');
assert.equal(htmlToText('a &#1488; &amp; b'), 'a א & b');
console.log('✓ mime');

// --- accounts ---
assert.equal(resolveAccount('work').email, 'me.work@gmail.com');
assert.equal(resolveAccount('me.home').email, 'me.home@gmail.com');
assert.equal(resolveAccount('ME.HOME@gmail.com').email, 'me.home@gmail.com');
assert.throws(() => resolveAccount(), /Several accounts/);
assert.throws(() => resolveAccount('nobody'), /Unknown account/);
console.log('✓ account selection');

// --- MCP over stdio ---
const EXPECTED = ['create_draft', 'fetch', 'list_accounts', 'list_drafts', 'list_labels', 'read_email', 'read_thread', 'search', 'search_emails', 'send_draft', 'send_email'];
const env = { ...process.env, MULTI_MAIL_HOME: home } as Record<string, string>;
const stdio = new Client({ name: 'test', version: '0' });
await stdio.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/server.ts'], env }));
const tools = (await stdio.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, EXPECTED);
const accs = await stdio.callTool({ name: 'list_accounts', arguments: {} });
assert.match((accs.content as any)[0].text, /me\.work@gmail\.com/);
const noAcc = await stdio.callTool({ name: 'read_email', arguments: { message_id: 'x' } });
assert.equal(noAcc.isError, true);
assert.match((noAcc.content as any)[0].text, /Several accounts/);
await stdio.close();
console.log('✓ stdio:', tools.length, 'tools');

// --- MCP over HTTP ---
const TOKEN = 'test-token-0123456789-abcdefghij';
const port = 39000 + Math.floor(Math.random() * 500);
const srv = spawn('npx', ['tsx', 'src/http.ts'], { env: { ...env, MCP_AUTH_TOKEN: TOKEN, PORT: String(port) }, stdio: 'pipe' });
await new Promise<void>((res, rej) => {
  srv.stdout.on('data', (d) => String(d).includes('listening') && res());
  srv.on('exit', (c) => rej(new Error(`http exited ${c}`)));
});
const base = `http://127.0.0.1:${port}`;
const ping = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(ping) });
assert.equal((await post(`${base}/mcp`)).status, 401);
assert.equal((await post(`${base}/mcp?api_key=wrong`)).status, 401);
assert.equal((await post(`${base}/mcp?api_key=${TOKEN}`)).status, 200);
const http = new Client({ name: 'test', version: '0' });
await http.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
assert.deepEqual((await http.listTools()).tools.map((t) => t.name).sort(), EXPECTED);
const s = await http.callTool({ name: 'search', arguments: { query: 'x' } });
assert.equal(s.isError, true); // fake tokens → Google rejects; the error must come back as a tool error, not a crash
await http.close();
srv.kill();
console.log('✓ http: auth enforced, tools listed');

// --- HTTP refuses to start without a token ---
const bad = spawn('npx', ['tsx', 'src/http.ts'], { env: { ...env, MCP_AUTH_TOKEN: '' } });
assert.equal(await new Promise((r) => bad.on('exit', r)), 1);
console.log('✓ http refuses to start without MCP_AUTH_TOKEN');
console.log('\nall tests passed');
