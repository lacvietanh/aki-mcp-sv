#!/usr/bin/env node
// Local stdio MCP entry for Antigravity CLI and IDE (docs/ref/fact-agy-mcp-config.md § CLI-1, IDE-3): redirect console logging to stderr BEFORE the tool modules load.
for (const method of ['log', 'info', 'debug']) console[method] = (...args) => console.error(...args);

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createToolsServer } = await import('./tools-server.js');
const { announceIdentity } = await import('./mcp-name.js');
announceIdentity();
const server = createToolsServer({ tempTokenMode: 'proxy' });
await server.connect(new StdioServerTransport());
