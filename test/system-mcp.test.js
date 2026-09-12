#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register, notifyUser, clipboardRead, clipboardWrite } from '../scripts/system-mcp.js';

async function runTests() {
  // 1. Verify functions exist
  assert.equal(typeof notifyUser, 'function');
  assert.equal(typeof clipboardRead, 'function');
  assert.equal(typeof clipboardWrite, 'function');

  // 2. Test clipboard write and read round-trip
  const testPayload = `aki-test-${Date.now()}`;
  await clipboardWrite(testPayload);
  const readBack = await clipboardRead();
  assert.equal(readBack.text.trim(), testPayload);

  // 3. Test McpServer tool registration
  const server = new McpServer({ name: 'test-system', version: '2.0.0' });
  register(server);

  assert.ok(server._registeredTools['notify_user']);
  assert.ok(server._registeredTools['clipboard_read']);
  assert.ok(server._registeredTools['clipboard_write']);

  console.log('system-mcp.test.js: ok');
}

await runTests();
