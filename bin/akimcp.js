#!/usr/bin/env node
// `akimcp --stdio`: the tools over stdin/stdout for a client that spawns the package (MCP Registry `server.json`, AGY); no gateway, no tunnel, no token. Anything else starts the gateway.
const cmd = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (process.argv.includes('--stdio')) await import('../scripts/stdio.js');
else if (cmd === 'temp-token') await import('../scripts/temp-token-cli.js');
else await import('../scripts/start.js');
