// What a server started under an identity serves: tool names, texts that name a tool, the rule gate, per-spawn stdio (docs/plan/v4-custom-name.md § P3).
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(repo, 'test', 'fixtures', name), 'utf8'));
const scriptUrl = (name) => JSON.stringify(pathToFileURL(path.join(repo, 'scripts', name)).href);

const RECEIPT = `sha256:${createHash('sha256').update('[]').digest('hex')}`;
const MAC = { identity: { name: 'MacMCP' } };
const BRIDGE = "This server's tools start with mac__. Text that names aki__<tool> means mac__<tool>.";

const PROBE = `import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolsServer } from ${scriptUrl('tools-server.js')};
import { listProviders } from ${scriptUrl('provider-registry.js')};
import { IDENTITY_PROBLEM } from ${scriptUrl('mcp-name.js')};
import { setAssembler, recordIssued } from ${scriptUrl('rule-gate.js')};
const fakeRules = async ({ extraFiles = [] }) => ({ receipt: 'sha256:' + createHash('sha256').update(JSON.stringify(extraFiles)).digest('hex'), sources: extraFiles.map((path) => ({ path })) });
setAssembler(fakeRules);
recordIssued((await fakeRules({})).receipt, {});
const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'probe', version: '1' });
await client.connect(clientSide);
const { tools } = await client.listTools();
const results = [];
for (const call of JSON.parse(process.env.PROBE_CALLS)) {
  const result = await client.callTool(call).catch((error) => ({ isError: true, content: [{ type: 'text', text: error.message }] }));
  results.push({ isError: Boolean(result.isError), text: (result.content ?? []).map((part) => part.text ?? '').join('\\n') });
}
let stdioNames = null;
if (process.env.PROBE_REWRITE) {
  fs.writeFileSync(process.env.AKI_MCP_DATA_DIR + '/setting.json', process.env.PROBE_REWRITE);
  const messages = [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list', params: {} }];
  const child = spawnSync(process.execPath, [${JSON.stringify(path.join(repo, 'scripts', 'stdio.js'))}], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, input: messages.map((m) => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\\n') + '\\n' });
  stdioNames = child.stdout.split('\\n').filter(Boolean).map((line) => JSON.parse(line)).find((m) => m.id === 2).result.tools.map((t) => t.name);
}
const liveNames = (await client.listTools()).tools.map((t) => t.name);
const providers = listProviders().map(({ id, available, enabled, tools: own }) => ({ id, available, enabled, tools: own }));
process.stdout.write('PROBE ' + JSON.stringify({ serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities(), instructions: client.getInstructions(), tools, providers, problem: IDENTITY_PROBLEM, results, stdioNames, liveNames }) + '\\n', () => process.exit(0));`;

fs.mkdirSync(path.join(os.homedir(), '.aki', 'aiobox'), { recursive: true });

// Every probe is a fresh process, because the identity is read once at import.
function probe({ setting = {}, calls = () => [], env = {}, rewrite } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-served-')));
  const dirs = Object.fromEntries(['data', 'free', 'project', 'big'].map((name) => [name, path.join(root, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dirs.project, 'CLAUDE.md'), 'project rule\n');
  fs.writeFileSync(path.join(dirs.big, 'CLAUDE.md'), 'x'.repeat(40 * 1024));
  fs.writeFileSync(path.join(dirs.data, 'setting.json'), JSON.stringify({ folders: [root], ...setting }));
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, AKI_MCP_DATA_DIR: dirs.data, PROBE_CALLS: JSON.stringify(calls(dirs)), ...(rewrite ? { PROBE_REWRITE: JSON.stringify(rewrite) } : {}), ...env },
  });
  const line = run.stdout.split('\n').find((text) => text.startsWith('PROBE '));
  assert.ok(line, `probe printed no result (exit ${run.status}): ${run.stderr}`);
  return { ...JSON.parse(line.slice('PROBE '.length)), dirs, root };
}

// Postman's first message: the prompt file with its tokens filled from the identity a fresh process reads at import.
const postmanFirstMessage = (setting) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-served-postman-')));
  fs.writeFileSync(path.join(root, 'setting.json'), JSON.stringify(setting));
  const prompt = JSON.stringify(path.join(repo, 'scripts', 'postman', 'prompts', 'postman.md'));
  const code = `import store from ${scriptUrl('postman/postman-instruction-store.cjs')};\nimport { IDENTITY } from ${scriptUrl('mcp-name.js')};\nprocess.stdout.write('MESSAGE ' + JSON.stringify(store.renderInstruction(store.loadInstruction([${prompt}]), IDENTITY)) + '\\n', () => process.exit(0));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: repo, encoding: 'utf8', env: { ...process.env, AKI_MCP_DATA_DIR: root } });
  const line = run.stdout.split('\n').find((text) => text.startsWith('MESSAGE '));
  assert.ok(line, `the render printed no message (exit ${run.status}): ${run.stderr}`);
  return JSON.parse(line.slice('MESSAGE '.length));
};

const once = (make) => { let value; return () => (value ??= make()); };

const write = (dir, receipt) => ({ name: 'mac__write_file', arguments: { path: path.join(dir, 'out.txt'), content: 'x', ...(receipt ? { receipt } : {}) } });
const mac = once(() => probe({
  setting: MAC,
  rewrite: { identity: { name: 'WorkMCP' } },
  calls: ({ free, project, big }) => [
    write(free),
    write(free, RECEIPT),
    { name: 'mac__read_text_file', arguments: { path: path.join(project, 'CLAUDE.md') } },
    { name: 'mac__devtools_targets', arguments: {} },
    write(big, RECEIPT),
    write(big, RECEIPT),
  ],
}));

test('serverInfo carries the Display name and the Server ID', () => {
  const { serverInfo } = mac();
  assert.equal(serverInfo.name, 'macmcp');
  assert.equal(serverInfo.title, 'MacMCP');
});

test('every served tool starts with the Tool prefix and none with aki__, one per tool the providers list', () => {
  const { tools, providers } = mac();
  const expected = providers.filter((p) => p.available && p.enabled).flatMap((p) => p.tools);
  assert.equal(tools.length, expected.length);
  assert.ok(tools.length > 0);
  for (const { name } of tools) assert.match(name, /^mac__[a-z0-9_]+$/);
});

test('aki__ appears in the instructions and the rule tool description only inside the bridge sentence, and in no other description', () => {
  const { tools, instructions } = mac();
  const ruleTool = tools.find((t) => t.name === 'mac__akidevrule_context');
  for (const [owner, text] of [['instructions', instructions], ['the rule tool description', ruleTool.description]]) {
    assert.equal(text.split(BRIDGE).length, 2, `${owner} carries the bridge sentence once`);
    assert.doesNotMatch(text.replace(BRIDGE, ''), /aki__/, `${owner} names an aki__ tool outside the bridge sentence`);
  }
  for (const t of tools.filter((tool) => tool !== ruleTool)) assert.doesNotMatch(t.description ?? '', /aki__/, `${t.name} description names an aki__ tool`);
});

test('a gated call without a receipt is refused and the refusal names the renamed rule tool', () => {
  const { results } = mac();
  assert.equal(results[0].isError, true);
  assert.match(results[0].text, /call mac__akidevrule_context /);
  assert.doesNotMatch(results[0].text, /aki__/);
});

test('a gated write with the current receipt runs', () => {
  const { results, dirs } = mac();
  assert.equal(results[1].isError, false, results[1].text);
  assert.equal(fs.readFileSync(path.join(dirs.free, 'out.txt'), 'utf8'), 'x');
});

test('the line a read appends after a project with rule files names the renamed read tool', () => {
  const { results } = mac();
  assert.match(results[2].text, /Readable with mac__read_text_file\.$/);
  assert.doesNotMatch(results[2].text, /aki__/);
});

test('a call without an active Chrome session is told how to attach with the renamed tools', () => {
  const { results } = mac();
  assert.equal(results[3].isError, true);
  assert.match(results[3].text, /Open a shared profile with mac__chrome_launch, or attach .* find the port with mac__port_status .* run mac__devtools_targets on it/);
  assert.doesNotMatch(results[3].text, /aki__/);
});

test('the rules pushed for a project with an oversize rule file say how to read it with the renamed read tool', () => {
  const { results } = mac();
  assert.match(results[4].text, /over the 32 KiB cap; readable with mac__read_text_file\)/);
  assert.doesNotMatch(results[4].text, /aki__/);
});

test('a second call that finds the rules shown a moment ago points at the renamed read tool', () => {
  const { results } = mac();
  assert.match(results[5].text, /went with another call a moment ago; if no result in this turn shows it, read it with mac__read_text_file first\./);
  assert.doesNotMatch(results[5].text, /aki__/);
});

test('a stdio child started after the file changed serves the new prefix while the live server keeps its own', () => {
  const { stdioNames, liveNames } = mac();
  assert.ok(stdioNames.length > 0);
  for (const name of stdioNames) assert.match(name, /^work__/);
  for (const name of liveNames) assert.match(name, /^mac__/);
});

test('at the default identity every served tool equals its 3.3.1 recording and initialize equals it apart from the version', () => {
  const { tools, providers, serverInfo, capabilities, instructions } = probe();
  const recorded = fixture('surface-3.3.1-aiobox.json');
  const { version, ...info } = serverInfo;
  assert.deepEqual({ serverInfo: info, capabilities, instructions }, { serverInfo: { name: recorded.initialize.serverInfo.name, title: recorded.initialize.serverInfo.title }, capabilities: recorded.initialize.capabilities, instructions: recorded.initialize.instructions });
  assert.ok(version);
  for (const { id, available, enabled, tools: own } of providers.filter((p) => p.available && p.enabled)) {
    assert.ok(recorded.providers[id], `provider ${id} is detected here but has no recording`);
    for (const name of own) assert.deepEqual(tools.find((t) => t.name === name), recorded.providers[id].find((t) => t.name === name), `${name} differs from its recording`);
    for (const { name } of recorded.providers[id]) assert.ok(own.includes(name), `${name} is recorded for ${id} but not served`);
  }
});

test('agy_run and kiro_read at the default identity equal their recording when both CLIs are present and switched on', () => {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-served-bin-')), 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['agy', 'kiro-cli']) fs.writeFileSync(path.join(bin, cli), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const { tools } = probe({ setting: { providers: { agy: { enabled: true }, kiro: { enabled: true } } }, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  const recorded = fixture('surface-3.3.1-optin.json');
  for (const { name } of Object.values(recorded.providers).flat()) assert.deepEqual(tools.find((t) => t.name === name), Object.values(recorded.providers).flat().find((t) => t.name === name), `${name} differs from its recording`);
  assert.deepEqual(Object.values(recorded.providers).flat().map((t) => t.name).sort(), ['aki__agy_run', 'aki__kiro_read']);
});

test('the Postman first message at the default identity is the 3.3.1 line, and under MacMCP names macmcp and mac__', () => {
  assert.equal(postmanFirstMessage({}), 'Could you use the akimcp tools (aki__*) as primary, and fall back to your subagent shell for commands that akimcp cannot execute?');
  assert.equal(postmanFirstMessage(MAC), 'Could you use the macmcp tools (mac__*) as primary, and fall back to your subagent shell for commands that macmcp cannot execute?');
});

test('a stored identity that is not an object serves the defaults and the exported problem names identity', () => {
  const { serverInfo, tools, problem } = probe({ setting: { identity: 'Work' } });
  assert.equal(serverInfo.name, 'akimcp');
  assert.ok(tools.every((t) => t.name.startsWith('aki__')));
  assert.deepEqual(problem, { field: 'identity', value: 'Work', reason: 'must be an object with name, key and prefix' });
});
