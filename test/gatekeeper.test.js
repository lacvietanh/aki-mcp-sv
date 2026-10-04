#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before the gatekeeper loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-gatekeeper-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const port = 38000 + Math.floor(Math.random() * 900);
process.env.GATEKEEPER_PORT = String(port);
const goodToken = 'b'.repeat(64);
writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access: { [goodToken]: { expires: Date.now() + 3600_000 } }, refresh: {} }));

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

const { startGatekeeper } = await import('../scripts/gatekeeper.js');
const server = startGatekeeper('https://example.ts.net');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${port}`;

// Declares a 1000-byte body, sends a few bytes, then drops the socket: what a client that loses its connection mid-request looks like.
const abortedPost = (pathname) => new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write(`POST ${pathname} HTTP/1.1\r\nHost: x\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\ngrant_type=`);
    setTimeout(() => socket.destroy(), 50);
  });
  socket.on('close', () => setTimeout(resolve, 100));
});

for (const pathname of ['/token', '/revoke', '/authorize', '/register']) {
  await abortedPost(pathname);
  assert.deepEqual(unhandled, [], `an aborted POST ${pathname} must not leave an unhandled rejection`);
  assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server`)).status, 200, `the server still answers after an aborted POST ${pathname}`);
}

const oversized = await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${'x'.repeat(100 * 1024)}` });
assert.equal(oversized.status, 413, 'an OAuth body over the cap is refused');

const smallToken = await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=nope' });
assert.equal(smallToken.status, 401, 'a normal-sized body still reaches the token handler, which rejects the unknown client');

for (const body of ['null', '[]', '7']) {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${goodToken}`, 'content-type': 'application/json' }, body });
  assert.equal(res.status, 400, `/mcp answers 400 to the JSON body ${body}`);
  assert.equal((await res.json()).error.code, -32600);
}
assert.deepEqual(unhandled, []);

server.close();
rmSync(dir, { recursive: true, force: true });
console.log('gatekeeper.test.js: ok');
process.exit(0);
