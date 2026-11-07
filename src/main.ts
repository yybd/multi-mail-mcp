#!/usr/bin/env node
// The one command the npm package installs:
//   multi-mail-mcp                 stdio MCP server (what Claude Desktop / Claude Code run)
//   multi-mail-mcp http            Streamable HTTP server (ChatGPT, URL clients)
//   multi-mail-mcp add|list|…      account management (see cli.ts)

const cmd = process.argv[2];

if (!cmd || cmd === 'serve' || cmd === 'stdio') {
  await import('./server.js');
} else if (cmd === 'http') {
  await import('./http.js');
} else {
  await import('./cli.js');
}
