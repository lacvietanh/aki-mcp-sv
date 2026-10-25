#!/usr/bin/env node
// write_file / edit_file keep an existing file's permission bits through the atomic temp-then-rename write, and name an ss write in their result.
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aki-fs-')));
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(home, 'work'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.AKI_MCP_DATA_DIR = path.join(home, '.aki', 'mcpsv');
const { register } = await import('../scripts/filesystem-mcp.js');
const { SS_DIR, shapeOf } = await import('../scripts/session-file.js');

const server = new McpServer({ name: 'fs-test', version: '0' });
register(server);
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 't', version: '0' });
await client.connect(b);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, r.content?.[0]?.text);
  return r.content.map((c) => c.text).join('\n');
};

// D9 of docs/plan/ss-session-file.md: a write of a chat's ss or of a legacy task working.md ends with a fact line naming it, never an order; any other write does not.
const ssFile = path.join(SS_DIR, 'demo', '2026.10.24-1812-ab.md');
const legacy = path.join(home, '.aki', 'mcpsv', 'task', 'old-thread', 'working.md');
for (const f of [ssFile, legacy]) fs.mkdirSync(path.dirname(f), { recursive: true });
// v2 D6: a write of an ss (not a legacy working.md) also says whether it has the frontmatter keys and headings, as a fact.
assert.equal(await call('write_file', { path: ssFile, content: '# goal\n' }), `wrote ${ssFile}\nss file written: ${ssFile} · shape: missing ${shapeOf('# goal\n').join(', ')}`);
assert.match(await call('edit_file', { path: ssFile, edits: [{ oldText: 'goal', newText: 'state' }] }), new RegExp(`\\nss file written: ${ssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · shape: missing status, repo, .*## Log$`));
const shaped = ['---', ...['status', 'repo', 'chat', 'started', 'parent', 'successor', 'room', 'plan', 'transcript'].map((k) => `${k}: none`), '---', '# t', ...['Now', 'Asked', 'Next', 'Decisions', 'Open', 'Files', 'Log'].map((h) => `## ${h}`), ''].join('\n');
assert.equal(await call('write_file', { path: ssFile, content: shaped }), `wrote ${ssFile}\nss file written: ${ssFile} · shape ok`);
assert.match(await call('edit_file', { path: ssFile, edits: [{ oldText: '## Log', newText: '## Log\n- 12:00 x' }] }), new RegExp(`\\nss file written: ${ssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · shape ok$`), 'an edit is checked on the content it leaves');
assert.equal(await call('write_file', { path: legacy, content: 'x\n' }), `wrote ${legacy}\nss file written: ${legacy}`);
assert.equal(await call('write_file', { path: path.join(home, 'work', 'plain.md'), content: 'x\n' }), `wrote ${path.join(home, 'work', 'plain.md')}`);

if (process.platform !== 'win32') {
  const script = path.join(home, 'work', 'run.sh');
  fs.writeFileSync(script, '#!/bin/sh\necho one\n');
  fs.chmodSync(script, 0o755);
  await call('edit_file', { path: script, edits: [{ oldText: 'one', newText: 'two' }] });
  assert.equal(fs.readFileSync(script, 'utf8'), '#!/bin/sh\necho two\n');
  assert.equal(fs.statSync(script).mode & 0o777, 0o755, 'edit_file keeps the exec bit');

  const secret = path.join(home, 'work', 'secret.txt');
  fs.writeFileSync(secret, 'a\n');
  fs.chmodSync(secret, 0o600);
  await call('write_file', { path: secret, content: 'b\n' });
  assert.equal(fs.readFileSync(secret, 'utf8'), 'b\n', 'write_file replaces the content');
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600, 'write_file over a file keeps its mode');
}

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('filesystem-mcp: ok');
