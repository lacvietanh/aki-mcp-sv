#!/usr/bin/env node
// F7 (docs/plan/akimcp-tool-refactor.md § 8): without AIObox, nothing served points at it — tools hidden, no output names a hidden tool or the AIObox site; install + re-detect brings both back.
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
await assert.rejects(launchChrome('Profile 99'), (e) => /\(no_profile; next: attach .*aki__port_status/.test(e.message) && !/aiobox/i.test(e.message.replace(process.env.AKI_CDP_PROFILES_DIR, '')));
for (const name of ['aki__devtools_targets', 'aki__devtools_eval', 'aki__devtools_screenshot']) {
  const args = name === 'aki__devtools_eval' ? { expression: '1' } : {};
  const r = await call(name, args);
  assert.ok(r.isError && /No CDP port specified/.test(textOf(r)) && !pointsAtAiobox(textOf(r)), `${name} without a port: ${textOf(r)}`);
}
const failing = Object.assign(new Error('spawn notifier ENOENT'), { code: 'ENOENT' });
let notified;
try {
  mock.method(cp, 'execFile', (file, args, options, cb) => cb(failing));
  notified = await call('aki__notify_user', { message: 'hi' });
} finally {
  mock.restoreAll();
}
assert.ok(!pointsAtAiobox(textOf(notified)), `notify_user failure: ${textOf(notified)}`);
assert.equal(notified.isError, true, 'every platform path throws when no notifier can run');
assert.match(textOf(notified), /spawn notifier ENOENT/);
assert.doesNotMatch(textOf(notified), /"notified":\s*true/, 'a failed notifier never reports notified:true');

// 3. No description and no server instruction says anything about AIObox while it is hidden: the pitch in akidevrule_context is the one sentence (boundary plan § 3).
const pointingAt = async (c) => [['instructions', c.getInstructions() || ''], ...(await c.listTools()).tools.map((t) => [t.name, t.description || ''])]
  .filter(([, text]) => /aiobox/i.test(text)).map(([owner]) => owner);
assert.deepEqual(await pointingAt(client), [], 'nothing served points at AIObox while it is hidden');
const describedBare = new Map((await client.listTools()).tools.map((t) => [t.name, JSON.stringify(t)]));

// 4. Installing AIObox and re-detecting adds exactly its two tools, nothing else.
fs.mkdirSync(path.join(tmp, 'home', '.aki', 'aiobox'), { recursive: true });
redetect();
const withAiobox = await servedNames();
assert.deepEqual(withAiobox.filter((n) => !bare.includes(n)).sort(), AIOBOX_TOOLS);
assert.ok(bare.every((n) => withAiobox.includes(n)), 'nothing served before is lost');
// The handle step reaches a client that connects once AIObox is served: in the instructions, and aki__aiobox's own description is the same on every machine.
const { AIOBOX_STEP } = await import('../scripts/rule-context-mcp.js');
const later = createToolsServer();
const [laterClient, laterServer] = InMemoryTransport.createLinkedPair();
await later.connect(laterServer);
const client2 = new Client({ name: 'surface-with-aiobox-test', version: '1' });
await client2.connect(laterClient);
assert.ok(client2.getInstructions().endsWith(AIOBOX_STEP), 'instructions carry the AIObox step once it is served');
assert.ok(!client.getInstructions().includes(AIOBOX_STEP), 'and not before');
const toolsWithAiobox = (await client2.listTools()).tools;
assert.match(toolsWithAiobox.find((t) => t.name === 'aki__aiobox').description, /^AIObox windows\. Call op=state first/);
// Installing AIObox changes no other tool's definition, so a client's Always allow on them holds (A12); aki__aiobox/aki__aiobox_write are new, so not in describedBare.
assert.ok(toolsWithAiobox.filter((t) => describedBare.has(t.name)).length > 10, 'the served-with-AIObox list is compared, not the bare one again');
for (const t of toolsWithAiobox) if (describedBare.has(t.name)) assert.equal(JSON.stringify(t), describedBare.get(t.name), `${t.name} definition changed with AIObox installed`);
await client2.close();

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('surface-no-aiobox.test.js: ok');
