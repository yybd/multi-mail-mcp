#!/usr/bin/env node
// stdio entry point — Claude Desktop and Claude Code run this as a local process.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './mcp.js';

await buildServer().connect(new StdioServerTransport());
