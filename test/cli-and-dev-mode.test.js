#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = path.join(REPO_ROOT, 'bin', 'akimcp.js');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [BIN_PATH, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      timeout: 10_000,
    }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code || 1 : 0, stdout, stderr });
    });
  });
}

async function testCli() {
  // Test --version and -v
  const vLong = await runCli(['--version']);
  assert.equal(vLong.code, 0);
  assert.equal(vLong.stdout.trim(), '2.0.0');

  const vShort = await runCli(['-v']);
  assert.equal(vShort.code, 0);
  assert.equal(vShort.stdout.trim(), '2.0.0');

  // Test --help and -h
  const hLong = await runCli(['--help']);
  assert.equal(hLong.code, 0);
  assert.match(hLong.stdout, /Usage:\s+akimcp/);
  assert.match(hLong.stdout, /--dev/);
  assert.match(hLong.stdout, /--port/);
  assert.match(hLong.stdout, /--panel-port/);

  const hShort = await runCli(['-h']);
  assert.equal(hShort.code, 0);
  assert.match(hShort.stdout, /Usage:\s+akimcp/);

  console.log('cli-and-dev-mode.test.js: ok');
}

await testCli();
