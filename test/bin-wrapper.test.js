#!/usr/bin/env node
// The `bin/akimcp.js` wrapper (what `npx @akinet/akimcp` runs) forwards to the CLI; the flags themselves are covered by cli-flags.test.js.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = path.join(REPO_ROOT, 'bin', 'akimcp.js');
const { version } = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN_PATH, ...args], { cwd: REPO_ROOT, timeout: 10_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code || 1 : 0, stdout, stderr });
    });
  });
}

const versionRun = await runCli(['--version']);
assert.equal(versionRun.code, 0);
assert.equal(versionRun.stdout.trim(), version);

const helpRun = await runCli(['-h']);
assert.equal(helpRun.code, 0);
assert.match(helpRun.stdout, /Usage:\s+akimcp/);

console.log('bin-wrapper.test.js: ok');
