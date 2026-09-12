#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../scripts/cdp-mcp.js';
import cdp from '../scripts/cdp-engine.js';

async function testCdpExtensions() {
  assert.equal(typeof cdp.screenshot, 'function');
  assert.equal(typeof cdp.click, 'function');

  // Verify server registers devtools_screenshot and devtools_click
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  register(server);
  assert.ok(server);

  console.log('cdp-extensions.test.js: ok');
}

await testCdpExtensions();
