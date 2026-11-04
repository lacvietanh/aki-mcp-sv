#!/usr/bin/env node
// A credential value never leaves through a tool result, whatever route reached its bytes: a directory search over the data dir, or a copy in a file the tools may read (a task log, a spilled output).
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'credential-redaction-test-')));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(dataDir, 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.AKI_MCP_DATA_DIR = dataDir;

const token = '0123456789abcdef'.repeat(4);
const passphrase = 'Kq7-mW2x-Rt9v';
fs.writeFileSync(path.join(dataDir, 'tokens.json'), JSON.stringify({ access: { [token]: { exp: 1 } } }));
fs.writeFileSync(path.join(dataDir, 'passphrase.txt'), `${passphrase}\n`);
fs.writeFileSync(path.join(tmp, 'copy.log'), `token=${token} pass=${passphrase}\n`);
const panelToken = 'a1b2c3d4'.repeat(4);
fs.writeFileSync(path.join(dataDir, 'instance.json'), JSON.stringify({ pid: 1, panelPort: 2, token: panelToken, version: '3.0.0', origin: 'https://x.example' }));

const { createToolsServer } = await import('../scripts/tools-server.js');
const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'credential-redaction-test', version: '1' });
await client.connect(clientSide);
const text = async (name, args) => (await client.callTool({ name, arguments: args })).content.map((c) => c.text).join('\n');
// run_cmd acts, so it needs the rule receipt (scripts/rule-gate.js).
const { receipt } = (await client.callTool({ name: 'aki__akidevrule_context', arguments: {} })).structuredContent;

const grep = await text('aki__run_cmd', { command: `grep -r ${token.slice(0, 16)} .`, cwd: dataDir, receipt });
assert.ok(grep.includes('tokens.json') && grep.includes('[redacted]'), `grep -r over the data dir still finds the file: ${grep}`);
assert.ok(!grep.includes(token), 'but the token itself comes back as [redacted]');

const copy = await text('aki__read_text_file', { path: path.join(tmp, 'copy.log') });
assert.equal(copy, 'token=[redacted] pass=[redacted]\n', 'a copy in an ordinary file is redacted too, passphrase included');

// instance.json stays readable for its ports and origin, but the panel token (it opens the panel) is redacted.
const instance = JSON.parse(await text('aki__read_text_file', { path: path.join(dataDir, 'instance.json') }));
assert.deepEqual([instance.token, instance.panelPort, instance.origin], ['[redacted]', 2, 'https://x.example']);

const plain = await text('aki__read_text_file', { path: path.join(dataDir, 'setting.json') });
assert.ok(plain.includes(tmp), 'text with no credential in it passes unchanged');

// An oversized one-line output is cut at a code point; the cut must not split the token into halves the result pass misses.
const { shapeForModel, SHOWN_HEAD } = await import('../scripts/output-shape.js');
const cut = shapeForModel(`${'x'.repeat(SHOWN_HEAD - 10)}${token}${'y'.repeat(30_000)}`);
assert.ok(cut.startsWith('[output truncated:') && !cut.includes(token.slice(0, 10)), 'no half token survives the cut');

// A handler that throws skips the result pass; its message is redacted before the SDK turns it into the error result.
const { redactError } = await import('../scripts/roots.js');
assert.equal(redactError(new Error(`Unexpected token in ${token}`)).message, 'Unexpected token in [redacted]');

// A project's .env is no akimcp file: its secrets are known by shape, through each tool that reaches them. Fixtures are built at run time so this file reads unredacted.
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
const botToken = `${'12345678'}:${'Ab-_'.repeat(8)}xyz`;
const envFile = path.join(project, '.env');
fs.writeFileSync(envFile, [`AKIDEV_TG_BOT_TOKEN=${botToken}`, 'PORT=3000', `DB_${'PASSWORD'}="hunter 2"`, 'export GH_TOKEN="$(gh auth token)"', ''].join('\n'));
const env = await text('aki__read_text_file', { path: envFile });
assert.equal(env, ['AKIDEV_TG_BOT_TOKEN=[redacted]', 'PORT=3000', 'DB_PASSWORD=[redacted]', 'export GH_TOKEN="$(gh auth token)"', ''].join('\n'), 'a secret-named value is hidden; a plain value and a $reference stay');
const found = await text('aki__search_content', { query: 'AKIDEV_TG', path: project });
assert.ok(found.includes('.env:1:AKIDEV_TG_BOT_TOKEN=[redacted]') && !found.includes(botToken), `search_content hides it too: ${found}`);
const grepped = await text('aki__run_cmd', { command: 'grep -r DB_ .', cwd: project, receipt });
assert.ok(grepped.includes('DB_PASSWORD=[redacted]') && !grepped.includes('hunter'), `and so does run_cmd: ${grepped}`);

const [pemBegin, pemEnd] = ['BEGIN', 'END'].map((edge) => `-----${edge} RSA PRIVATE KEY-----`);
fs.writeFileSync(path.join(tmp, 'notes.md'), [
  `bot ${botToken}`,
  `key sk-${'a1B2'.repeat(6)}`,
  `gh ghp_${'a1B2'.repeat(9)}`,
  `Authorization: Bearer ${'z9Y8'.repeat(5)}`,
  `postgres://app:${'pw'.repeat(4)}@db.local/app`,
  `${pemBegin}\nMIIEabc\n${pemEnd}`,
  'plain text stays: a Bearer header, task-1793772142200, PORT=3000',
].join('\n'));
assert.equal(await text('aki__read_text_file', { path: path.join(tmp, 'notes.md') }), [
  'bot [redacted]',
  'key [redacted]',
  'gh [redacted]',
  'Authorization: Bearer [redacted]',
  'postgres://app:[redacted]@db.local/app',
  '[redacted]',
  'plain text stays: a Bearer header, task-1793772142200, PORT=3000',
].join('\n'), 'a bare token shape is hidden in any file');

// The AI saw only [redacted]: writing that back would replace the real value, so the write is refused and the file keeps its bytes.
const write = async (name, args) => (await client.callTool({ name, arguments: { ...args, path: envFile, receipt } })).content.map((c) => c.text).join('\n');
assert.ok((await write('aki__write_file', { content: env })).includes('holds values the tools show as [redacted]'), 'write_file of the redacted text is refused');
assert.ok((await write('aki__edit_file', { edits: [{ oldText: 'PORT=3000', newText: 'PORT=3000\nAPI_KEY=[redacted]' }] })).includes('holds values the tools show as [redacted]'), 'so is an edit that adds the marker');
await write('aki__edit_file', { edits: [{ oldText: 'PORT=3000', newText: 'PORT=3001' }] });
const onDisk = fs.readFileSync(envFile, 'utf8');
assert.ok(onDisk.includes(botToken) && onDisk.includes('PORT=3001\n'), 'a plain line stays editable and the token survives');

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: credential values are redacted from every tool result');
