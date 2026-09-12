#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../scripts/chrome-mcp.js';
import cdp from '../scripts/cdp-engine.js';

async function runTests() {
  // 1. Verify cdp engine exports
  assert.equal(typeof cdp.type, 'function');
  assert.equal(typeof cdp.click, 'function');
  assert.equal(typeof cdp.openTab, 'function');
  assert.equal(typeof cdp.closeTab, 'function');
  assert.equal(typeof cdp.activateTab, 'function');
  assert.equal(typeof cdp.probeAi, 'function');

  // 2. Register tools with McpServer
  const server = new McpServer({ name: 'test-chrome', version: '2.0.0' });
  register(server);

  // 3. Test chrome_profiles tool directly
  const profilesTool = server._registeredTools['chrome_profiles'];
  assert.ok(profilesTool, 'chrome_profiles must be registered');

  const res = await profilesTool.handler({ browser: 'chrome' });
  assert.ok(res.content && res.content[0]);
  const parsed = JSON.parse(res.content[0].text);
  assert.ok(Array.isArray(parsed.detectedBrowsers));
  assert.equal(parsed.selectedBrowser, 'chrome');
  assert.ok(Array.isArray(parsed.profiles));

  // 4. Verify all tool handlers exist
  assert.ok(server._registeredTools['chrome_launch']);
  assert.ok(server._registeredTools['chrome_tabs']);
  assert.ok(server._registeredTools['chrome_interact']);
  assert.ok(server._registeredTools['chrome_probe_ai']);
  assert.ok(server._registeredTools['chrome_stop']);

  console.log('chrome-mcp.test.js: ok');
}

await runTests();
