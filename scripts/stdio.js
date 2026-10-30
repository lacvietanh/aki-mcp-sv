#!/usr/bin/env node
// Local stdio MCP entry for Antigravity CLI and IDE (docs/ref/fact-agy-mcp-config.md § CLI-1, IDE-3): the shared tools server over stdin/stdout.
// In-process, not a bridge to :9999: /mcp needs an OAuth access token, which the panel token is not.
// stdout is the JSON-RPC channel: redirect console logging to stderr BEFORE the tool modules load (dynamic import below).
for (const method of ['log', 'info', 'debug']) console[method] = (...args) => console.error(...args);

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createToolsServer } = await import('./tools-server.js');
const { announceIdentity } = await import('./mcp-name.js');

announceIdentity();

const server = createToolsServer();
await server.connect(new StdioServerTransport());
