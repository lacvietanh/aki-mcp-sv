#!/usr/bin/env node
// write_file / edit_file over an existing file keep its permission bits: the atomic temp-then-rename write must not drop a script's exec bit or widen a 0600 secret.
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
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
const { register } = await import('../scripts/filesystem-mcp.js');

const server = new McpServer({ name: 'fs-test', version: '0' });
register(server);
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 't', version: '0' });
await client.connect(b);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, r.content?.[0]?.text);
};

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
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600, 'write_file over a file keeps its mode');
}

await client.close();
console.log('filesystem-mcp: ok');
process.exit(0);
