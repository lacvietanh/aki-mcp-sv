#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-chrome-mcp-'));
const home = path.join(tmp, 'home');
Object.assign(process.env, { HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
process.env.AKI_CDP_PROFILES_DIR = path.join(tmp, 'profiles');
process.env.AKI_MCP_DATA_DIR = tmp;
const { register } = await import('../scripts/chrome-mcp.js');
const { default: cdp } = await import('../scripts/cdp-engine.js');
const { getBrowserInfo, listInstalledBrowsers } = await import('../scripts/chrome-profile.js');

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
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
  const call = (name, args) => client.callTool({ name, arguments: args });

  // 3. Test chrome_profiles through the client
  assert.ok(tools.has('chrome_profiles'), 'chrome_profiles must be registered');

  const chrome = getBrowserInfo('chrome');
  assert.ok(chrome.userDataDir.startsWith(home), 'the browser user-data dir comes from the fake HOME');
  fs.mkdirSync(chrome.userDataDir, { recursive: true });
  fs.writeFileSync(path.join(chrome.userDataDir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1', user_name: 'a@example.com' } } } }));
  const res = await call('chrome_profiles', { browser: 'chrome' });
  assert.ok(res.content && res.content[0]);
  const parsed = JSON.parse(res.content[0].text);
  assert.deepEqual(parsed.detectedBrowsers, listInstalledBrowsers().map((b) => b.name));
  assert.ok(parsed.detectedBrowsers.includes(chrome.name), 'the fixture user-data dir makes Chrome detected');
  assert.equal(parsed.selectedBrowser, 'chrome');
  assert.deepEqual(parsed.profiles, [
    { id: 'Default', name: 'Person 1', userName: 'a@example.com', gaiaName: '', browser: chrome.name, isDefault: true, path: path.join(chrome.userDataDir, 'Default') },
  ]);
  assert.equal(parsed.sharedRoot, process.env.AKI_CDP_PROFILES_DIR);
  assert.deepEqual(parsed.sharedProfiles, []);

  // 4. Verify all tool handlers exist
  for (const name of ['chrome_launch', 'chrome_tabs', 'chrome_interact', 'chrome_stop']) assert.ok(tools.has(name), `${name} must be registered`);

  // 5. chrome_launch no longer clones: no refresh flag, and it names no AIObox on any machine.
  const launch = tools.get('chrome_launch');
  assert.deepEqual(Object.keys(launch.inputSchema.properties).sort(), ['browser', 'headless', 'profile', 'url']);
  assert.doesNotMatch(launch.description, /clones a real profile|purges locks/i);
  const missing = await call('chrome_launch', { profile: 'Profile 1' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /\(no_profile; next: /);
  assert.doesNotMatch(missing.content[0].text, /aiobox/i);
  assert.doesNotMatch(launch.description, /aiobox/i);

  // 6. chrome_stop states its ownership rule and does nothing without a session.
  assert.match(tools.get('chrome_stop').description, /owned/);
  assert.equal(JSON.parse((await call('chrome_stop', {})).content[0].text).stopped, false);
  for (const name of ['chrome_launch', 'chrome_stop', 'chrome_profiles']) assert.ok(tools.get(name).description.length <= 700, name);

  // 7. B2: while AIObox runs (windows.json appPid alive) and is served, chrome_launch refuses with one next and opens nothing.
  const clone = path.join(process.env.AKI_CDP_PROFILES_DIR, 'chrome-profile-1');
  fs.mkdirSync(clone, { recursive: true });
  fs.writeFileSync(path.join(clone, 'Local State'), '{}');
  const map = path.join(home, '.aki', 'aiobox', 'cdp', 'windows.json');
  fs.mkdirSync(path.dirname(map), { recursive: true });
  fs.writeFileSync(map, JSON.stringify({ version: 1, appPid: process.pid, profiles: [] }));
  const reachesLaunch = /Cannot tell which profile folder/; // the fixture clone has no profile folder, so launchChrome stops before spawning
  const refused = await call('chrome_launch', { profile: 'Profile 1', url: 'https://example.com/' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /\(aiobox_running; next: aki__aiobox_write op=open_url url=https:\/\/example\.com\/ profileId=chrome-profile-1\)$/);
  assert.doesNotMatch(refused.content[0].text, /from=<your chatId>|op=windows/);
  const noUrl = await call('chrome_launch', { profile: 'Profile 1' });
  assert.match(noUrl.content[0].text, /\(aiobox_running; next: aki__aiobox_write op=open_url url=<link> profileId=chrome-profile-1\)$/);
  assert.equal(JSON.parse((await call('chrome_stop', {})).content[0].text).detail, 'no active session', 'nothing opened or attached');
  // Not served (switched off) or crashed (windows.json left, appPid dead): launches as before B2.
  const { setEnabled } = await import('../scripts/provider-registry.js');
  setEnabled('aiobox', false);
  // Launching says nothing about AIObox: the description and the errors are the same on every machine.
  const launches = async (why) => {
    const text = (await call('chrome_launch', { profile: 'Profile 1' })).content[0].text;
    assert.match(text, reachesLaunch, why);
    assert.doesNotMatch(text, /aiobox/i, why);
  };
  await launches('aiobox switched off');
  setEnabled('aiobox', true);
  fs.writeFileSync(map, JSON.stringify({ version: 1, appPid: cp.spawnSync(process.execPath, ['-e', '']).pid, profiles: [] }));
  await launches('dead appPid');
  // A map that is not AIObox's (not JSON, appPid not a number) is no running AIObox either.
  for (const text of ['not json', JSON.stringify({ version: 1, appPid: String(process.pid), profiles: [] })]) {
    fs.writeFileSync(map, text);
    await launches(text);
  }
  // The refusal names the id AIObox knows: any id the shared list returns, the clone of the browser asked for, and a placeholder when no url is given.
  fs.writeFileSync(map, JSON.stringify({ version: 1, appPid: process.pid, profiles: [] }));
  for (const id of ['aio-1700000000000', 'brave-profile-1']) {
    fs.mkdirSync(path.join(process.env.AKI_CDP_PROFILES_DIR, id), { recursive: true });
    fs.writeFileSync(path.join(process.env.AKI_CDP_PROFILES_DIR, id, 'Local State'), '{}');
  }
  assert.match((await call('chrome_launch', { profile: 'aio-1700000000000', url: 'https://example.com/' })).content[0].text, / url=https:\/\/example\.com\/ profileId=aio-1700000000000\)$/);
  assert.match((await call('chrome_launch', { profile: 'Profile 1', browser: 'brave' })).content[0].text, / profileId=brave-profile-1\)$/);

  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('chrome-mcp.test.js: ok');
}

await runTests();
