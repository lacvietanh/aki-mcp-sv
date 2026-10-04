#!/usr/bin/env node
// The MCP Registry record (server.json) and the npm package must agree, or `mcp-publisher publish` fails (plan/mcp-registry-listing.md): name = mcpName, versions = package version, the stdio entry the record names really starts the tools.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(fs.readFileSync(new URL('../server.json', import.meta.url), 'utf8'));

assert.equal(server.name, pkg.mcpName, 'server.json name = package.json mcpName');
assert.match(server.name, /^io\.github\.lacvietanh\/[a-zA-Z0-9._-]+$/, 'GitHub namespace of the repo owner (GitHub auth)');
assert.equal(server.version, pkg.version, 'bump server.json with package.json at every release');
assert.ok(server.description.length >= 1 && server.description.length <= 100, `description ${server.description.length} chars, the schema allows 100`);
assert.equal(server.repository.url, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
assert.equal(server.packages.length, 1);
const [entry] = server.packages;
assert.deepEqual([entry.registryType, entry.identifier, entry.version, entry.transport.type], ['npm', pkg.name, pkg.version, 'stdio']);
assert.deepEqual(entry.packageArguments.map((a) => a.value), ['--stdio']);
assert.ok(pkg.files.includes('bin') && pkg.files.includes('scripts'), 'the stdio entry ships in the tarball');

// `akimcp --stdio` answers initialize on stdout (no gateway, no tunnel), as a registry client would spawn it.
const child = spawn(process.execPath, [new URL('../bin/akimcp.js', import.meta.url).pathname, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MCP_DATA_DIR: fs.mkdtempSync('/tmp/akimcp-stdio-') } });
let out = '';
const reply = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no initialize reply in 15s; stdout: ${out.slice(0, 300)}`)), 15_000);
  child.stdout.on('data', (d) => {
    out += d;
    const line = out.split('\n').find((l) => l.includes('"id":1'));
    if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
  });
});
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'registry-test', version: '0' } } })}\n`);
try {
  const r = await reply;
  assert.ok(r.result?.serverInfo, 'initialize returns serverInfo');
  assert.equal(out.trim().split('\n').every((l) => l.startsWith('{')), true, 'stdout carries only JSON-RPC');
} finally {
  child.kill();
}
console.log('PASS: server.json matches package.json, and akimcp --stdio serves MCP over stdio');
