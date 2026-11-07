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
  writeFileSync(join(home, 'accounts', `${email}.json`), JSON.stringify({ email, alias, tokens: { refresh_token: 'r', ...(alias === 'home' ? { scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' } : {}) }, added: '2026-11-07' }));
}

const { buildRaw, encodeAddress, addressList, extractBody, htmlToText, safeFilename } = await import('../src/mime.js');
const { resolveLabelIds } = await import('../src/gmail.js');
const { toInstant, formatInTz, mergeBusy, freeSlots } = await import('../src/calendar.js');
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
const withAtt = extractBody({ mimeType: 'multipart/mixed', parts: [
  { partId: '0', mimeType: 'text/plain', body: { data: Buffer.from('hi').toString('base64url') } },
  { partId: '1', mimeType: 'application/pdf', filename: 'חשבונית.pdf', body: { attachmentId: 'A', size: 1234 } },
] });
assert.deepEqual(withAtt.attachments, [{ partId: '1', filename: 'חשבונית.pdf', mimeType: 'application/pdf', size: 1234 }]);
assert.equal(safeFilename('../../etc/passwd'), 'passwd');
assert.equal(safeFilename('..\\..\\x:y?.pdf'), 'x_y_.pdf');
assert.equal(safeFilename('.hidden'), 'hidden');
assert.equal(safeFilename(''), 'attachment');
console.log('✓ mime');

const labels = [{ id: 'UNREAD', name: 'UNREAD' }, { id: 'INBOX', name: 'INBOX' }, { id: 'Label_7', name: 'Projects/Acme' }];
assert.deepEqual(resolveLabelIds(labels, ['projects/acme', 'unread', 'Label_7', 'nope']), { ids: ['Label_7', 'UNREAD', 'Label_7'], unknown: ['nope'] });
console.log('✓ label names');

// --- calendar time math (pure) ---
const TZ = 'Asia/Jerusalem';
assert.equal(toInstant('2026-11-09T14:30', TZ).toISOString(), '2026-11-09T12:30:00.000Z'); // winter, +02:00
assert.equal(toInstant('2026-07-01T09:00', TZ).toISOString(), '2026-07-01T06:00:00.000Z'); // summer, +03:00
assert.equal(toInstant('2026-11-09T14:30:00Z', TZ).toISOString(), '2026-11-09T14:30:00.000Z');
assert.equal(formatInTz(new Date('2026-11-09T12:30:00Z'), TZ), '2026-11-09T14:30:00+02:00');
assert.throws(() => toInstant('tomorrow', TZ), /Not a valid time/);
const H = (t: string) => toInstant(t, TZ).getTime();
assert.deepEqual(mergeBusy([{ start: 5, end: 10 }, { start: 1, end: 6 }, { start: 20, end: 30 }]), [{ start: 1, end: 10 }, { start: 20, end: 30 }]);
const slots = freeSlots(
  [{ start: H('2026-11-09T10:00'), end: H('2026-11-09T11:00') }, { start: H('2026-11-09T10:30'), end: H('2026-11-09T12:00') }],
  { start: H('2026-11-09T00:00'), end: H('2026-11-11T00:00') },
  TZ,
  { minutes: 60, dayStart: '09:00', dayEnd: '18:00', weekdays: [0, 1, 2, 3, 4], maxSlots: 10 }
).map((x) => [formatInTz(new Date(x.start), TZ).slice(5, 16), formatInTz(new Date(x.end), TZ).slice(11, 16)]);
// Monday 9th: 09-10 free, busy 10-12 (merged), 12-18 free; Tuesday 10th: whole day.
assert.deepEqual(slots, [['11-09T09:00', '10:00'], ['11-09T12:00', '18:00'], ['11-10T09:00', '18:00']]);
const fri = freeSlots([], { start: H('2026-11-13T00:00'), end: H('2026-11-15T00:00') }, TZ, { minutes: 30, dayStart: '09:00', dayEnd: '18:00', weekdays: [0, 1, 2, 3, 4], maxSlots: 5 });
assert.equal(fri.length, 0); // Friday and Saturday are excluded
console.log('✓ calendar time math');

// --- accounts ---
assert.equal(resolveAccount('work').email, 'me.work@gmail.com');
assert.equal(resolveAccount('me.home').email, 'me.home@gmail.com');
assert.equal(resolveAccount('ME.HOME@gmail.com').email, 'me.home@gmail.com');
assert.throws(() => resolveAccount(), /Several accounts/);
assert.throws(() => resolveAccount('nobody'), /Unknown account/);
console.log('✓ account selection');

// --- MCP over stdio ---
const EXPECTED = ['create_draft', 'create_event', 'create_label', 'fetch', 'find_free_time', 'get_attachment', 'list_accounts', 'list_drafts', 'list_events', 'list_labels', 'modify_labels', 'read_email', 'read_thread', 'search', 'search_emails', 'send_draft', 'send_email'];
const DRAFTS_ONLY = EXPECTED.filter((t) => !t.startsWith('send_'));
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
const lbl = await stdio.callTool({ name: 'modify_labels', arguments: { account: 'work', message_ids: ['x'], remove: ['UNREAD'] } });
assert.equal(lbl.isError, true);
assert.match((lbl.content as any)[0].text, /Labels are not enabled .*--labels/);
const trash = await stdio.callTool({ name: 'modify_labels', arguments: { account: 'home', message_ids: ['x'], add: ['trash'] } });
assert.equal(trash.isError, true);
assert.match((trash.content as any)[0].text, /Refusing to add trash/);
const cal = await stdio.callTool({ name: 'list_events', arguments: { account: 'work', from: '2026-11-09', to: '2026-11-10' } });
assert.equal(cal.isError, true);
assert.match((cal.content as any)[0].text, /Calendar is not enabled .*--calendar/);
await stdio.close();
console.log('✓ stdio:', tools.length, 'tools; labels need --labels; TRASH refused; calendar needs --calendar');

// --- drafts-only: the send tools are not there at all ---
for (const how of [{ args: ['tsx', 'src/main.ts', '--drafts-only'], env }, { args: ['tsx', 'src/main.ts'], env: { ...env, MULTI_MAIL_SEND: 'off' } }]) {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: 'npx', args: how.args, env: how.env }));
  assert.deepEqual((await c.listTools()).tools.map((t) => t.name).sort(), DRAFTS_ONLY);
  const acc = JSON.parse(((await c.callTool({ name: 'list_accounts', arguments: {} })).content as any)[0].text);
  assert.equal(acc.sending, 'off (drafts only)');
  await c.close();
}
console.log('✓ drafts-only (flag and env): no send tools');

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
