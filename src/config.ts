// Where credentials and per-account tokens live, and how an account is chosen.
//
// Layout (default ~/.multi-mail, override with MULTI_MAIL_HOME):
//   credentials.json        OAuth client downloaded from Google Cloud ("Desktop app")
//   accounts/<email>.json   one file per connected Gmail account (refresh token inside)
//
// Files are read on every call, so an account added with the CLI is visible to a
// running server without a restart.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.MULTI_MAIL_HOME ?? join(homedir(), '.multi-mail');
export const CREDENTIALS_PATH = process.env.MULTI_MAIL_CREDENTIALS ?? join(HOME, 'credentials.json');
export const ACCOUNTS_DIR = join(HOME, 'accounts');

// readonly: list/search/read. compose: create drafts and send. Nothing can delete mail.
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export interface StoredTokens {
  refresh_token?: string | null;
  access_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
}

export interface Account {
  email: string;
  alias?: string;
  tokens: StoredTokens;
  added: string;
}

export interface ClientSecrets {
  clientId: string;
  clientSecret: string;
}

export function ensureHome(): void {
  mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(HOME, 0o700);
    chmodSync(ACCOUNTS_DIR, 0o700);
  } catch {
    /* best effort */
  }
}

export function loadClientSecrets(): ClientSecrets {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `OAuth client file not found at ${CREDENTIALS_PATH}. ` +
        'Create a "Desktop app" OAuth client in Google Cloud Console, download its JSON there, ' +
        'or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. See README.md.'
    );
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) throw new Error(`${CREDENTIALS_PATH} has no client_id/client_secret`);
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

function accountFile(email: string): string {
  return join(ACCOUNTS_DIR, `${email.toLowerCase()}.json`);
}

export function listAccounts(): Account[] {
  if (!existsSync(ACCOUNTS_DIR)) return [];
  return readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ACCOUNTS_DIR, f), 'utf8')) as Account)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function saveAccount(acc: Account): void {
  ensureHome();
  const path = accountFile(acc.email);
  writeFileSync(path, JSON.stringify(acc, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Merge refreshed tokens into the stored account (Google rarely re-sends the refresh token). */
export function updateTokens(email: string, tokens: StoredTokens): void {
  const path = accountFile(email);
  if (!existsSync(path)) return;
  const acc = JSON.parse(readFileSync(path, 'utf8')) as Account;
  acc.tokens = { ...acc.tokens, ...Object.fromEntries(Object.entries(tokens).filter(([, v]) => v != null)) };
  saveAccount(acc);
}

export function removeAccount(email: string): boolean {
  const path = accountFile(email);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Pick an account by email, alias, or the part before "@" (when unique).
 * With no selector: the only account, or MULTI_MAIL_DEFAULT.
 */
export function resolveAccount(selector?: string): Account {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    throw new Error('No Gmail accounts are connected. Run: npx -y @yybd/multi-mail-mcp add');
  }
  const names = accounts.map((a) => (a.alias ? `${a.email} (${a.alias})` : a.email)).join(', ');
  const sel = (selector ?? process.env.MULTI_MAIL_DEFAULT ?? '').trim().toLowerCase();
  if (!sel) {
    if (accounts.length === 1) return accounts[0];
    throw new Error(`Several accounts are connected — say which one. Accounts: ${names}`);
  }
  const exact = accounts.find((a) => a.email.toLowerCase() === sel || a.alias?.toLowerCase() === sel);
  if (exact) return exact;
  const byLocal = accounts.filter((a) => a.email.toLowerCase().split('@')[0] === sel);
  if (byLocal.length === 1) return byLocal[0];
  throw new Error(`Unknown account "${selector}". Accounts: ${names}`);
}
