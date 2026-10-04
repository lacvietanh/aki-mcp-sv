#!/usr/bin/env node
// The served tool surface as one contract (docs/arch/provider-toolkit.md): size budget, annotations, description length, cross-references, provider on/off and detection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// A temp data dir so the owner's setting.json (agy.allowedModes, providers) never shapes the measured surface, and setEnabled below never writes the real one.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tool-surface-test-')));
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data', 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
const { createToolsServer } = await import('../scripts/tools-server.js');
const { listProviders, setEnabled, redetect } = await import('../scripts/provider-registry.js');

// JSON.stringify(tools/list .tools).length measured 2026-10-02 at P0 (36 tools, before annotations). Budget = baseline × 1.10; raising it is a deliberate change in the diff, never a silent drift.
const BASELINE_CHARS = 27207;
// Each new tool is a measured raise on top of the baseline budget, so growth stays visible line by line.
const RAISES = [
  { date: '2026-10-02', why: 'P6 aiobox provider (aki__aiobox, aki__aiobox_write) and the devtools hint pointing at it', chars: 2687 },
  { date: '2026-10-03', why: 'aiobox_write op=compose (akipanel compose v2) and the account in aiobox op=read', chars: 214 },
  { date: '2026-10-03', why: 'akidevrule_context: a session named by an AIObox handle drives its own window through aki__aiobox', chars: 278 },
  { date: '2026-10-03', why: 'aiobox: handles are renumbered on AIObox restart, so window takes a chat id, expect guards the target, op=windows names stable ids', chars: 207 },
  { date: '2026-10-03', why: 'aiobox: op=state (guide in the result, not the description), whoami, wait_idle, run_macro, from', chars: 595 },
  { date: '2026-10-03', why: 'aiobox_write op=send (akipanel send v1) and its wait argument', chars: 157 },
];
const BUDGET_CHARS = Math.round(BASELINE_CHARS * 1.1) + RAISES.reduce((sum, r) => sum + r.chars, 0);

const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'tool-surface-test', version: '1' });
await client.connect(clientSide);
const served = async () => (await client.listTools()).tools;
const servedNames = async () => (await served()).map((t) => t.name);

// What is served depends on what this machine has installed (CI has no agy, Postman or Chrome), so the budget is an upper bound on whatever is available here.
const tools = await served();
const json = JSON.stringify(tools);
const total = json.length;
const rows = tools.map((t) => [t.name, JSON.stringify(t).length, (t.description || '').length]).sort((a, b) => b[1] - a[1]);
// The hash makes "the surface did not change" checkable across a refactor by comparing one line.
console.log(`tool surface: ${tools.length} tools, ${total} chars (budget ${BUDGET_CHARS}), sha256 ${createHash('sha256').update(json).digest('hex').slice(0, 16)}`);
for (const [name, size, desc] of rows) console.log(`  ${String(size).padStart(6)}  desc ${String(desc).padStart(4)}  ${name}`);
assert.ok(total <= BUDGET_CHARS, `tools/list is ${total} chars, over the ${BUDGET_CHARS} budget — trim descriptions or raise BASELINE_CHARS deliberately`);

// The rest checks every registered tool, disabled ones included, so the result does not depend on this machine.
const registered = Object.entries(server._registeredTools).map(([name, t]) => ({ name, ...t }));

// readOnlyHint only where the tool cannot write by mechanism; every non-read-only tool also states whether it destroys.
for (const t of registered) {
  assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} lacks annotations.readOnlyHint`);
  if (!t.annotations.readOnlyHint) assert.equal(typeof t.annotations.destructiveHint, 'boolean', `${t.name} is not read-only but lacks destructiveHint`);
}
const readOnly = registered.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
assert.ok(readOnly.includes('aki__agy_run'), "agy_run is read-only while 'plan' is its only allowed mode");
assert.ok(!readOnly.includes('aki__run_cmd') && !readOnly.includes('aki__write_file'), 'write-capable tools never claim read-only');

// akidevrule_context is the one exception: its description carries the rule-delivery handshake (docs/arch/rule-context-delivery.md, docs/plan/rule-context-handshake.md).
for (const t of registered) {
  if (t.name === 'aki__akidevrule_context') continue;
  assert.ok((t.description || '').length <= 700, `${t.name} description is ${t.description.length} chars, over 700`);
}

// Every aki__<name> a description (or the server instructions) points at must be a registered tool, so a rename never leaves a dead reference.
const names = new Set(registered.map((t) => t.name));
const texts = [['instructions', client.getInstructions() || ''], ...registered.map((t) => [t.name, t.description || ''])];
for (const [owner, text] of texts) {
  for (const [ref] of text.matchAll(/aki__[a-z0-9_]+/g)) assert.ok(names.has(ref), `${owner} references ${ref}, which is not a tool`);
}

// Every registered tool belongs to exactly one provider.
const providers = listProviders();
assert.deepEqual(providers.flatMap((p) => p.tools).sort(), [...names].sort());

// Switching a provider off hides its tools on the next tools/list and refuses calls; switching it back restores them. git is always available, so this holds on any machine; postman also shows the switch on a machine that has it.
for (const id of ['git', 'postman']) {
  const { tools: own, available } = providers.find((p) => p.id === id);
  setEnabled(id, false);
  const off = await servedNames();
  assert.ok(own.every((n) => !off.includes(n)), `${id} tools still served after setEnabled(false)`);
  const refused = await client.callTool({ name: own[0], arguments: id === 'git' ? { op: 'status' } : {} }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
  assert.ok(refused.isError, `${own[0]} must refuse while ${id} is off`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'setting.json'), 'utf8')).providers[id].enabled, false, 'the switch persists in setting.json');
  setEnabled(id, true);
  const on = await servedNames();
  if (available) assert.ok(own.every((n) => on.includes(n)), `${id} tools missing after setEnabled(true)`);
}
// agy and kiro are opt-in: off until the owner switches them on, whether or not the CLI is installed.
for (const id of ['agy', 'kiro']) {
  const { tools: own, available, enabled } = providers.find((p) => p.id === id);
  assert.equal(enabled, false, `${id} is off by default`);
  assert.ok(own.every((n) => !tools.some((t) => t.name === n)), `${id} tools are not served by default`);
  assert.equal(setEnabled(id, true).enabled, true);
  const on = await servedNames();
  if (available) assert.ok(own.every((n) => on.includes(n)), `${id} tools served once switched on`);
  setEnabled(id, false);
}
for (const id of ['rule', 'filesystem', 'search', 'shell']) assert.throws(() => setEnabled(id, false), /always on/, `${id} must refuse to switch off`);
assert.throws(() => setEnabled('nope', false), /unknown provider/);

// Detection follows the machine: with an empty PATH neither CLI is found, so their tools are not served; restoring PATH and re-detecting brings back whatever is installed.
const savedPath = process.env.PATH;
process.env.PATH = '';
const blind = redetect();
assert.equal(blind.find((p) => p.id === 'agy').available, false);
assert.match(blind.find((p) => p.id === 'kiro').reason, /not on PATH/);
const withoutPath = await servedNames();
assert.ok(!withoutPath.includes('aki__agy_run') && !withoutPath.includes('aki__kiro_read'), 'CLI tools hidden when their binary is not on PATH');
process.env.PATH = savedPath;
redetect();
assert.deepEqual(await servedNames(), tools.map((t) => t.name), 'the surface is back to where it started');

// The panel's API drives the same registry, so a switch there reaches this live server.
const { ROUTES } = await import('../scripts/panel.js');
assert.deepEqual(await ROUTES['GET /api/providers'](), listProviders());
const afterOff = await ROUTES['POST /api/providers']({ id: 'git', enabled: false });
assert.equal(afterOff.find((p) => p.id === 'git').enabled, false);
assert.ok(!(await servedNames()).includes('aki__git'), 'a panel switch hides the tool on the live server');
await ROUTES['POST /api/providers']({ id: 'git', enabled: true });
await assert.rejects(ROUTES['POST /api/providers']({ id: 'shell', enabled: false }), /always on/);
assert.equal((await ROUTES['POST /api/providers']({ redetect: true })).length, providers.length);
assert.deepEqual(await servedNames(), tools.map((t) => t.name));

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('tool-surface.test.js: ok');
