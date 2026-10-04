#!/usr/bin/env node
// A credential value never leaves through a tool result, whatever route reached its bytes: a directory search over the data dir, or a copy in a file the tools may read (a task log, a spilled output).
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

const { createToolsServer } = await import('../scripts/tools-server.js');
const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'credential-redaction-test', version: '1' });
await client.connect(clientSide);
const text = async (name, args) => (await client.callTool({ name, arguments: args })).content.map((c) => c.text).join('\n');

const grep = await text('aki__run_cmd', { command: `grep -r ${token.slice(0, 16)} .`, cwd: dataDir });
assert.ok(grep.includes('tokens.json') && grep.includes('[redacted]'), `grep -r over the data dir still finds the file: ${grep}`);
assert.ok(!grep.includes(token), 'but the token itself comes back as [redacted]');

const copy = await text('aki__read_text_file', { path: path.join(tmp, 'copy.log') });
assert.equal(copy, 'token=[redacted] pass=[redacted]\n', 'a copy in an ordinary file is redacted too, passphrase included');

const plain = await text('aki__read_text_file', { path: path.join(dataDir, 'setting.json') });
assert.ok(plain.includes(tmp), 'text with no credential in it passes unchanged');

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: credential values are redacted from every tool result');
