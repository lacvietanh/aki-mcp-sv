#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getListeningPorts, isProtectedPort } from '../scripts/port-mcp.js';

assert.equal(isProtectedPort(9999), true);
assert.equal(isProtectedPort(9998), true);
assert.equal(isProtectedPort(3000), false);
assert.equal(isProtectedPort(8080), false);

const ports = await getListeningPorts();
assert.ok(Array.isArray(ports));
for (const p of ports) {
  assert.ok(Number.isInteger(p.port));
  assert.ok(Number.isInteger(p.pid));
}

console.log('port-mcp.test.js: ok');
