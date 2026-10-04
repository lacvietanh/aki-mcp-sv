#!/usr/bin/env node
// `akimcp --stdio`: the tools over stdin/stdout for a client that spawns the package (MCP Registry `server.json`, AGY); no gateway, no tunnel, no token. Anything else starts the gateway.
if (process.argv.includes('--stdio')) await import('../scripts/stdio.js');
else await import('../scripts/start.js');
