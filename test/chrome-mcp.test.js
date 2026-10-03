#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-chrome-mcp-'));
process.env.AKI_CDP_PROFILES_DIR = path.join(tmp, 'profiles');
process.env.AKI_MCP_DATA_DIR = tmp;
const { register } = await import('../scripts/chrome-mcp.js');
const { default: cdp } = await import('../scripts/cdp-engine.js');

async function runTests() {
  // 1. Verify cdp engine exports
  assert.equal(typeof cdp.type, 'function');
  assert.equal(typeof cdp.click, 'function');
  assert.equal(typeof cdp.openTab, 'function');
  assert.equal(typeof cdp.closeTab, 'function');
  assert.equal(typeof cdp.activateTab, 'function');

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
  assert.equal(parsed.sharedRoot, process.env.AKI_CDP_PROFILES_DIR);
  assert.deepEqual(parsed.sharedProfiles, []);

  // 4. Verify all tool handlers exist
  assert.ok(server._registeredTools['chrome_launch']);
  assert.ok(server._registeredTools['chrome_tabs']);
  assert.ok(server._registeredTools['chrome_interact']);
  assert.ok(server._registeredTools['chrome_stop']);

  // 5. chrome_launch no longer clones: no refresh flag, a missing clone points at AIObox.
  const launch = server._registeredTools['chrome_launch'];
  assert.deepEqual(Object.keys(launch.inputSchema.shape).sort(), ['browser', 'headless', 'profile', 'url']);
  assert.doesNotMatch(launch.description, /clones a real profile|purges locks/i);
  const missing = await launch.handler({ profile: 'Profile 1' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Create it in AIObox/);

  // 6. chrome_stop states its ownership rule and does nothing without a session.
  const stop = server._registeredTools['chrome_stop'];
  assert.match(stop.description, /owned/);
  assert.equal(JSON.parse((await stop.handler({})).content[0].text).stopped, false);
  for (const name of ['chrome_launch', 'chrome_stop', 'chrome_profiles']) assert.ok(server._registeredTools[name].description.length <= 700, name);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('chrome-mcp.test.js: ok');
}

await runTests();
