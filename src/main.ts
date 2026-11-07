#!/usr/bin/env node
// The one command the npm package installs:
//   multi-mail-mcp                 stdio MCP server (what Claude Desktop / Claude Code run)
//   multi-mail-mcp http            Streamable HTTP server (ChatGPT, URL clients)
//   multi-mail-mcp add|list|…      account management (see cli.ts)
//   --drafts-only                  no tool can send (same as MULTI_MAIL_SEND=off)

// --drafts-only (anywhere on the line) is the same as MULTI_MAIL_SEND=off.
const di = process.argv.indexOf('--drafts-only');
if (di >= 2) {
  process.env.MULTI_MAIL_SEND = 'off';
  process.argv.splice(di, 1);
}

const cmd = process.argv[2];

if (!cmd || cmd === 'serve' || cmd === 'stdio') {
  await import('./server.js');
} else if (cmd === 'http') {
  await import('./http.js');
} else {
  await import('./cli.js');
}
