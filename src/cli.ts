#!/usr/bin/env node
// Account management. Reached through main.ts ("multi-mail-mcp add …") or `npm run cli -- …`.
//   add [email] [--alias name]   connect a Gmail account (opens the browser for Google sign-in)
//   list                         connected accounts
//   check                        verify every account still has access
//   alias <account> <name>       set or change an account's alias
//   remove <account>             disconnect (deletes the local token; revoke at myaccount.google.com too)
//   token                        print a fresh random MCP_AUTH_TOKEN for the HTTP server

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { gmail as gmailApi } from '@googleapis/gmail';
import {
  ACCOUNTS_DIR,
  CREDENTIALS_PATH,
  CALENDAR_SCOPES,
  LABEL_SCOPE,
  SCOPES,
  ensureHome,
  hasCalendarScope,
  hasLabelScope,
  listAccounts,
  loadClientSecrets,
  removeAccount,
  resolveAccount,
  saveAccount,
  type Account,
} from './config.js';
import { getProfile, oauthClient } from './gmail.js';

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

/** Loopback OAuth: a one-shot local web server catches Google's redirect. */
async function authorize(loginHint: string | undefined, scopes: string[]): Promise<{ tokens: any }> {
  const state = randomBytes(16).toString('hex');
  loadClientSecrets(); // fail here, with a clear message, before opening anything
  return new Promise((resolve, reject) => {
    const srv = createServer();
    const timer = setTimeout(() => {
      srv.close();
      reject(new Error('Timed out waiting for Google sign-in (5 minutes).'));
    }, 5 * 60_000);

    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const client = oauthClient(redirect);
      const url = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent select_account', // consent → always get a refresh token
        scope: scopes,
        state,
        login_hint: loginHint,
        include_granted_scopes: false,
      });

      srv.on('request', async (req, res) => {
        const u = new URL(req.url ?? '/', redirect);
        if (u.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const finish = (code: number, msg: string) => {
          res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3em" dir="auto"><h2>${msg}</h2><p>You can close this tab.</p>`);
        };
        try {
          if (u.searchParams.get('state') !== state) throw new Error('State mismatch — try again.');
          const err = u.searchParams.get('error');
          if (err) throw new Error(`Google returned: ${err}`);
          const code = u.searchParams.get('code');
          if (!code) throw new Error('No authorization code in the redirect.');
          const granted = (u.searchParams.get('scope') ?? '').split(' ');
          const missing = scopes.filter((s) => !granted.includes(s));
          if (missing.length) throw new Error(`Not all permissions were granted (missing: ${missing.join(', ')}). Tick every box on the consent screen.`);
          const { tokens } = await client.getToken(code);
          finish(200, '✅ Connected');
          resolve({ tokens });
        } catch (e) {
          finish(400, `❌ ${(e as Error).message}`);
          reject(e);
        } finally {
          clearTimeout(timer);
          srv.close();
        }
      });

      console.log('\nOpening Google sign-in in your browser. If it does not open, visit:\n');
      console.log(url, '\n');
      openBrowser(url);
    });
  });
}

async function add(hint: string | undefined, alias: string | undefined, labels: boolean, calendar: boolean) {
  ensureHome();
  const scopes = [...SCOPES, ...(labels ? [LABEL_SCOPE] : []), ...(calendar ? CALENDAR_SCOPES : [])];
  const { tokens } = await authorize(hint, scopes);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and run add again.'
    );
  }
  const client = oauthClient();
  client.setCredentials(tokens);
  const profile = (await gmailApi({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' })).data;
  const email = profile.emailAddress!;
  const prev = listAccounts().find((a) => a.email.toLowerCase() === email.toLowerCase());
  const acc: Account = {
    email,
    alias: alias ?? prev?.alias,
    tokens,
    added: prev?.added ?? new Date().toISOString(),
  };
  saveAccount(acc);
  console.log(`${prev ? 'Reconnected' : 'Connected'} ${email}${acc.alias ? ` (alias: ${acc.alias})` : ''}${labels ? ', labels enabled' : ''}${calendar ? ', calendar enabled' : ''} — ${profile.messagesTotal} messages.`);
}

async function check() {
  const accounts = listAccounts();
  if (!accounts.length) return console.log('No accounts connected.');
  for (const a of accounts) {
    try {
      const p = await getProfile(a);
      console.log(`✓ ${a.email}${a.alias ? ` (${a.alias})` : ''}${hasLabelScope(a) ? ' [labels]' : ''}${hasCalendarScope(a) ? ' [calendar]' : ''} — ${p.messagesTotal} messages`);
    } catch (e) {
      console.log(`✗ ${a.email} — ${(e as Error).message}`);
    }
  }
}

function list() {
  const accounts = listAccounts();
  if (!accounts.length) return console.log(`No accounts connected yet. Run: npx -y @yybd/multi-mail-mcp add\n(credentials: ${CREDENTIALS_PATH})`);
  for (const a of accounts) console.log(`${a.email}${a.alias ? `  alias=${a.alias}` : ''}${hasLabelScope(a) ? '  labels' : ''}${hasCalendarScope(a) ? '  calendar' : ''}  added=${a.added.slice(0, 10)}`);
  console.log(`\n${accounts.length} account(s) in ${ACCOUNTS_DIR}`);
}

function usage(): never {
  console.log(`multi-mail-mcp — MCP server for several Gmail accounts

Usage: npx -y @yybd/multi-mail-mcp [command]

  (no command)                 run the MCP server over stdio (Claude Desktop / Claude Code)
  http                         run the Streamable HTTP server (needs MCP_AUTH_TOKEN)
  --drafts-only                with either of the above: no tool can send mail

  add [email] [--alias name] [--labels] [--calendar]
                               connect an account (browser sign-in). --labels also allows
                               adding/removing labels (mark read, archive, star);
                               --calendar adds Google Calendar (read, free time, create)
  list                         list connected accounts
  check                        verify every account still has access
  alias <account> <name>       set or change an alias ("work", "home"…)
  remove <account>             disconnect an account
  token                        generate an MCP_AUTH_TOKEN for HTTP mode

Setup guide: https://github.com/yybd/multi-mail-mcp#readme`);
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
};

try {
  switch (cmd) {
    case 'add': {
      const alias = flag('alias');
      const li = rest.indexOf('--labels');
      if (li >= 0) rest.splice(li, 1);
      const ci = rest.indexOf('--calendar');
      if (ci >= 0) rest.splice(ci, 1);
      await add(rest[0], alias, li >= 0, ci >= 0);
      break;
    }
    case 'list':
      list();
      break;
    case 'check':
      await check();
      break;
    case 'alias': {
      if (rest.length < 2) usage();
      const acc = resolveAccount(rest[0]);
      acc.alias = rest[1];
      saveAccount(acc);
      console.log(`${acc.email} → alias ${rest[1]}`);
      break;
    }
    case 'remove': {
      if (!rest[0]) usage();
      const acc = resolveAccount(rest[0]);
      removeAccount(acc.email);
      console.log(`Removed ${acc.email}. To revoke Google's side too: https://myaccount.google.com/permissions`);
      break;
    }
    case 'token':
      console.log(randomBytes(32).toString('base64url'));
      break;
    default:
      usage();
  }
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}
