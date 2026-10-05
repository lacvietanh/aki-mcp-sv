#!/usr/bin/env node
// F7 (docs/plan/akimcp-tool-refactor.md § 8): on a machine without AIObox nothing served points at it. The aiobox tools are hidden,
// tool output never sends the model to a hidden tool or to the AIObox site, and installing AIObox + re-detect brings exactly its two tools back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { mock } from 'node:test';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// A fake home with no ~/.aki/aiobox, set before any import reads it; profiles and data dirs are temp too, so the owner's machine never shapes the result.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'surface-no-aiobox-')));
for (const d of ['home', 'data', 'profiles']) fs.mkdirSync(path.join(tmp, d));
fs.writeFileSync(path.join(tmp, 'data', 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home');
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
process.env.AKI_CDP_PROFILES_DIR = path.join(tmp, 'profiles');
assert.equal(os.homedir(), path.join(tmp, 'home'));

const { createToolsServer } = await import('../scripts/tools-server.js');
const { redetect } = await import('../scripts/provider-registry.js');
const { launchChrome } = await import('../scripts/chrome-profile.js');
const { GUIDE_URL } = await import('../scripts/aiobox-guide.js');

const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'surface-no-aiobox-test', version: '1' });
await client.connect(clientSide);
const servedNames = async () => (await client.listTools()).tools.map((t) => t.name);
const AIOBOX_TOOLS = ['aki__aiobox', 'aki__aiobox_write'];
// Nothing in a result may route the model to AIObox: not a hidden tool, not the site, not the guide.
const pointsAtAiobox = (text) => /aki__aiobox|aiobox\.app/i.test(text) || text.includes(GUIDE_URL);
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
// Tools that act need the rule receipt (scripts/rule-gate.js); pass it only where the schema takes it.
const { receipt } = (await client.callTool({ name: 'aki__akidevrule_context', arguments: {} })).structuredContent;
const takesReceipt = new Set((await client.listTools()).tools.filter((t) => t.inputSchema?.properties?.receipt).map((t) => t.name));
const call = (name, args = {}) => client.callTool({ name, arguments: takesReceipt.has(name) ? { ...args, receipt } : args })
  .catch((e) => ({ isError: true, content: [{ text: e.message }] }));

// 1. Without ~/.aki/aiobox the two aiobox tools are not served.
redetect();
const bare = await servedNames();
assert.ok(AIOBOX_TOOLS.every((n) => !bare.includes(n)), 'aiobox tools hidden without ~/.aki/aiobox');

// 2. Error output states a fact and a next step that works here.
await assert.rejects(launchChrome('Profile 99'), (e) => /\(no_profile; next: attach .*aki__port_status/.test(e.message) && !pointsAtAiobox(e.message));
if (bare.includes('aki__chrome_launch')) {
  const r = await call('aki__chrome_launch', { profile: 'Profile 99' });
  assert.ok(r.isError && /no_profile/.test(textOf(r)) && !pointsAtAiobox(textOf(r)), `chrome_launch miss: ${textOf(r)}`);
}
for (const name of ['aki__devtools_targets', 'aki__devtools_eval', 'aki__devtools_screenshot']) {
  const args = name === 'aki__devtools_eval' ? { expression: '1' } : {};
  const r = await call(name, args);
  assert.ok(r.isError && /No CDP port specified/.test(textOf(r)) && !pointsAtAiobox(textOf(r)), `${name} without a port: ${textOf(r)}`);
}
const failing = Object.assign(new Error('spawn notifier ENOENT'), { code: 'ENOENT' });
mock.method(cp, 'execFile', (file, args, options, cb) => cb(failing));
const notified = await call('aki__notify_user', { message: 'hi' });
mock.restoreAll();
assert.ok(!pointsAtAiobox(textOf(notified)), `notify_user failure: ${textOf(notified)}`);
if (!notified.isError) assert.equal(JSON.parse(textOf(notified)).notified, false, 'a failed notifier never reports notified:true');

// 3. Descriptions and instructions that still name a hidden aiobox tool: exactly the texts P3 rewrites (NO_SESSION_HINT, AIOBOX_STEP,
// chrome_launch's clone note). P3 empties this list; a new entry here is a fresh dead pointer and fails the test.
const KNOWN_P3 = ['aki__akidevrule_context', 'aki__chrome_launch', 'aki__devtools_eval', 'aki__devtools_screenshot', 'aki__devtools_targets', 'instructions'];
const listed = (await client.listTools()).tools;
const pointing = [['instructions', client.getInstructions() || ''], ...listed.map((t) => [t.name, t.description || ''])]
  .filter(([, text]) => pointsAtAiobox(text)).map(([owner]) => owner).sort();
assert.ok(pointing.every((o) => KNOWN_P3.includes(o)), `new text points at AIObox while it is hidden: ${pointing.filter((o) => !KNOWN_P3.includes(o))}`);
console.log(`surface-no-aiobox: still pointing (P3): ${pointing.join(', ') || 'none'}`);

// 4. Installing AIObox and re-detecting adds exactly its two tools, nothing else.
fs.mkdirSync(path.join(tmp, 'home', '.aki', 'aiobox'), { recursive: true });
redetect();
const withAiobox = await servedNames();
assert.deepEqual(withAiobox.filter((n) => !bare.includes(n)).sort(), AIOBOX_TOOLS);
assert.ok(bare.every((n) => withAiobox.includes(n)), 'nothing served before is lost');

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('surface-no-aiobox.test.js: ok');
