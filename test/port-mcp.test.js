#!/usr/bin/env node
import assert from 'node:assert/strict';
import net from 'node:net';
import { getListeningPorts, isProtectedPort } from '../scripts/port-mcp.js';

// isProtectedPort reads these on every call; an ambient value would move the protected ports.
delete process.env.GATEKEEPER_PORT;
delete process.env.PANEL_PORT;

assert.equal(isProtectedPort(9999), true);
assert.equal(isProtectedPort(9998), true);
assert.equal(isProtectedPort(3000), false);
assert.equal(isProtectedPort(8080), false);

const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const { port } = server.address();
  const listed = await getListeningPorts(port);
  assert.deepEqual(listed.map((p) => [p.port, p.pid]), [[port, process.pid]], 'a loopback listener is listed once, owned by this process');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('port-mcp.test.js: ok');
