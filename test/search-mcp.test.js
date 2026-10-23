import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'search-mcp-test-')));
const dataDir = path.join(tmp, 'data');
const tree = path.join(tmp, 'tree');
fs.mkdirSync(dataDir);
fs.mkdirSync(tree);
fs.writeFileSync(path.join(dataDir, 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.AKI_MCP_DATA_DIR = dataDir;

const { createToolsServer } = await import('../scripts/tools-server.js');
const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
let client;
const text = async (name, args) => (await client.callTool({ name, arguments: args })).content.map((c) => c.text).join('\n');
const dir = (name) => {
  const made = path.join(tree, name);
  fs.mkdirSync(made, { recursive: true });
  return made;
};

before(async () => {
  await server.connect(serverSide);
  client = new Client({ name: 'search-mcp-test', version: '1' });
  await client.connect(clientSide);
});

const restoreAccess = (root) => {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, 0o755);
  for (const entry of fs.readdirSync(root)) fs.chmodSync(path.join(root, entry), 0o755);
};

after(async () => {
  try {
    restoreAccess(path.join(tree, 'locked'));
    restoreAccess(path.join(tree, 'mixed'));
    await client.close();
    await server.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const cannotDenyAccess = process.platform === 'win32' || process.getuid?.() === 0 ? 'chmod 000 does not deny access on Windows or as root' : false;

test('find_path header names skipped directories and unreadable directories', { skip: cannotDenyAccess }, async () => {
  fs.mkdirSync(path.join(tree, 'build'));
  fs.mkdirSync(path.join(tree, 'vendor'));
  fs.writeFileSync(path.join(tree, 'build', 'hidden-target.txt'), '');
  fs.mkdirSync(path.join(tree, 'locked'));
  fs.chmodSync(path.join(tree, 'locked'), 0o000);
  const out = await text('aki__find_path', { query: 'hidden-target', path: tree });
  assert.equal(out, `nothing matched "hidden-target" under ${tree} (omitted from search: skipped directories build, vendor; 1 unreadable dir(s))`);
});

test('find_path header says the depth limit was reached', async () => {
  const deep = dir(path.join('deep', ...Array(13).fill('d')));
  fs.writeFileSync(path.join(deep, 'leaf.txt'), '');
  const out = await text('aki__find_path', { query: 'leaf.txt', path: path.join(tree, 'deep') });
  assert.match(out, /^nothing matched "leaf.txt" under \S+ \(omitted from search: depth limit 12 reached\)$/);
});

test('find_path puts the cap on line 1 and no note at the end', async () => {
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(dir('many'), `cap-${n}.txt`), '');
  const out = (await text('aki__find_path', { query: 'cap-', path: path.join(tree, 'many'), limit: 2 })).split('\n');
  assert.equal(out[0], `3 result(s) under ${path.join(tree, 'many')}, showing the first 2 (truncated: raise limit or narrow path/glob):`);
  assert.equal(out.length, 3);
});

test('search_content puts the cap on line 1 and no note at the end', async () => {
  fs.writeFileSync(path.join(dir('lines'), 'a.txt'), 'needle 1\nneedle 2\nneedle 3\n');
  const out = (await text('aki__search_content', { query: 'needle', path: path.join(tree, 'lines'), limit: 2 })).split('\n');
  assert.equal(out[0], '3 matching line(s), showing the first 2 (truncated: raise limit or narrow path/glob):');
  assert.equal(out.length, 3);
});

test('search_content no-match result ends with the constant excluded-directories line', async () => {
  const out = await text('aki__search_content', { query: 'absent-xyz', path: path.join(tree, 'lines') });
  assert.match(out, /^no lines matched "absent-xyz" under \S+ \(omitted from search: directories node_modules, .*\bbuild\b.*; akimcp's credential files\)$/);
});

test('search_content over the capture limit says incomplete with a lower bound and drops the partial last line', async () => {
  fs.writeFileSync(path.join(dir('big'), 'big.txt'), 'needle padding padding padding padding\n'.repeat(150_000));
  const out = (await text('aki__search_content', { query: 'needle', path: path.join(tree, 'big'), limit: 1_000_000 })).split('\n');
  assert.match(out[0], /^at least \d+ matching line\(s\) \(truncated, incomplete: grep output over the 4 MB capture limit; the count is a lower bound, narrow path\/glob\):$/);
  assert.ok(out.slice(1).every((line) => line.endsWith('needle padding padding padding padding')), 'no partial last line');
});

test('search_content reports grep errors beside matches in the header', { skip: cannotDenyAccess }, async () => {
  const mixed = dir('mixed');
  fs.writeFileSync(path.join(mixed, 'ok.txt'), 'needle here\n');
  for (const n of [1, 2, 3, 4]) {
    const file = path.join(mixed, `denied-${n}.txt`);
    fs.writeFileSync(file, 'needle\n');
    fs.chmodSync(file, 0o000);
  }
  const out = (await text('aki__search_content', { query: 'needle', path: mixed })).split('\n');
  assert.equal(out[0], '1 matching line(s):');
  assert.match(out[1], /^grep errors \(4 line\(s\)\): .*Permission denied.* \| … 1 more$/);
  assert.match(out[2], /ok\.txt:1:needle here$/);
});

test('search_content with grep missing from PATH is an error, never "no lines matched"', async () => {
  const emptyBin = dir('empty-bin');
  const savedPath = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    const first = (await text('aki__search_content', { query: 'needle', path: path.join(tree, 'lines') })).split('\n')[0];
    assert.match(first, /^error: .*ENOENT/);
    assert.ok(!first.includes('no lines matched'));
  } finally {
    process.env.PATH = savedPath;
  }
});
