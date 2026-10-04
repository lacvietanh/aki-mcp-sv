#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'aki-trusted-')));
const home = path.join(tmp, 'home');
const zone = path.join(home, '.claude', 'skills');
mkdirSync(zone, { recursive: true });
mkdirSync(path.join(home, 'work'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
const dataDir = path.join(home, '.aki', 'mcpsv');
mkdirSync(dataDir, { recursive: true });
process.env.AKI_MCP_DATA_DIR = dataDir;

const script = path.join(zone, 'tool.sh');
writeFileSync(script, '#!/bin/sh\necho ok\n');
chmodSync(script, 0o755);
const py = path.join(zone, 'tool.py');
writeFileSync(py, 'print("ok")\n');
const outside = path.join(home, 'work', 'evil.py');
writeFileSync(outside, 'print("x")\n');

const { Shell } = await import('../scripts/shell-mcp.js');
const { resolveRealWritable, resolveRealUnderRoot } = await import('../scripts/roots.js');
const { loadAllowlistDirs } = await import('../scripts/allowlist.js');
const shell = new Shell();

assert.ok(loadAllowlistDirs().includes(zone), 'default zones include ~/.claude/skills');
assert.doesNotThrow(() => shell.checkPermission(script, []), 'executable under a default zone runs with no settings edit');
assert.doesNotThrow(() => shell.checkPermission('python3', [py]), 'interpreter + script under a zone runs');
assert.throws(() => shell.checkPermission('python3', [outside]), /not in the allowlist/, 'script outside every zone stays blocked');
assert.throws(() => shell.checkPermission('python3', ['-c', 'print(1)']), /not in the allowlist/, 'inline code has no script under a zone');
for (const smuggled of [['--eval=process.exit(7)', py], ['-c', 'print(1)', py], ['--require', outside, py], ['-u', py]]) {
  assert.throws(() => shell.checkPermission('python3', smuggled), /not in the allowlist/, `a flag before the zone script is refused: ${smuggled[0]}`);
}
assert.doesNotThrow(() => shell.checkPermission('python3', [py, '--verbose', outside]), 'arguments after the zone script are the script\'s own');
for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  assert.throws(() => shell.checkPermission(inherited, []), /not in the allowlist/, `${inherited} is not an allowlist entry`);
}
assert.throws(() => shell.checkPermission('bash', [script]), /not in the allowlist/, 'shells stay excluded');

await assert.rejects(() => resolveRealWritable(path.join(zone, 'new.py')), /trusted script directory/, 'file tools cannot plant a file in a zone');
await assert.rejects(() => resolveRealWritable(py), /trusted script directory/, 'file tools cannot overwrite a zone script');
assert.equal(await resolveRealWritable(path.join(home, 'work', 'notes.md')), path.join(home, 'work', 'notes.md'), 'ordinary folders stay writable');

// akimcp's own data dir: setting.json stays writable (owner decision), the credential files are read-only for the file tools, existing or not yet created.
writeFileSync(path.join(dataDir, 'tokens.json'), '{}');
assert.equal(await resolveRealWritable(path.join(dataDir, 'setting.json')), path.join(dataDir, 'setting.json'), 'setting.json stays writable');
for (const name of ['tokens.json', 'passphrase.txt', 'oauth-client.json', 'oauth-dcr-clients.json', 'cloudflared-cred.json']) {
  await assert.rejects(() => resolveRealWritable(path.join(dataDir, name)), /holds akimcp's credentials/, `${name} is not written by a file tool`);
}
assert.equal(await resolveRealUnderRoot(path.join(dataDir, 'tokens.json')), path.join(dataDir, 'tokens.json'), 'reading stays allowed');

console.log('PASS: trusted script zones — run by default, unwritable by the file tools');
