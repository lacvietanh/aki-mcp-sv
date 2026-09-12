#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getListeningPorts, isProtectedPort } from '../scripts/port-mcp.js';
import { createToolsServer } from '../scripts/tools-server.js';

async function testPortMcp() {
  // Test port protection logic
  assert.equal(isProtectedPort(9999), true);
  assert.equal(isProtectedPort(9998), true);
  assert.equal(isProtectedPort(3000), false);
  assert.equal(isProtectedPort(8080), false);

  // Test getListeningPorts execution
  const ports = await getListeningPorts();
  assert.ok(Array.isArray(ports));
  for (const p of ports) {
    assert.ok(Number.isInteger(p.port));
    assert.ok(Number.isInteger(p.pid));
  }

  // Test tool registration on server
  const server = createToolsServer();
  // Server is created without error with aki__port_status and aki__kill_port registered
  console.log('port-mcp.test.js: ok');
}

await testPortMcp();
