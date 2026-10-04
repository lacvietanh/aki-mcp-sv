#!/usr/bin/env node
// `akimcp --version` / `--help` print only their answer and touch no data: AIObox reads the version from stdout, and oauth.js used to prune a stale client at import and log it there first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../scripts/version.js';

const start = fileURLToPath(new URL('../scripts/start.js', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-flags-'));
const dcrFile = path.join(dir, 'oauth-dcr-clients.json');
// A connector registered two hours ago and never approved: the import-time prune removes it and logs "removed 1 unused clients".
const stale = JSON.stringify({ stale: { clientId: 'stale', clientName: 'test', firstSeenAt: Date.now() - 2 * 3600_000 } });
fs.writeFileSync(dcrFile, stale);

const run = (flag) => spawnSync(process.execPath, [start, flag], { env: { ...process.env, AKI_MCP_DATA_DIR: dir }, encoding: 'utf8' });

try {
  for (const flag of ['--version', '-v']) {
    const r = run(flag);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${VERSION}\n`, `${flag} prints the version alone`);
  }
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^@akinet\/akimcp - /);
  assert.doesNotMatch(help.stdout, /\[oauth\]/);
  assert.equal(fs.readFileSync(dcrFile, 'utf8'), stale, 'the flags leave the client store untouched');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('cli-flags: ok');
