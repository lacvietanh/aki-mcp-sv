#!/usr/bin/env node
// Guard against hardcoded aki__ prefix leaking into scripts/public and docs naming aki__ without the default-prefix note.
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipNoGit = existsSync(join(repoRoot, '.git')) ? false : 'not a git checkout';

test('scripts/ and public/ contain no hardcoded aki__ tool prefix outside exempt defaults', { skip: skipNoGit }, () => {
  const EXEMPT_FILES = ['scripts/verify-boundary-b1.sh', 'scripts/mcp-name.js'];
  const EXEMPT_DIRS = ['public/guide/'];
  const grep = spawnSync('git', ['grep', '-n', 'aki__', '--', 'scripts', 'public'], { cwd: repoRoot, encoding: 'utf8' });
  assert.ok(grep.status === 0 || grep.status === 1, `git grep failed: ${grep.stderr || grep.error?.message}`);
  const left = grep.stdout
    .split('\n')
    .map((line) => line.match(/^([^:]+):(\d+):(.*)$/))
    .filter(Boolean)
    .filter(([, file, , text]) => !EXEMPT_FILES.includes(file) && !EXEMPT_DIRS.some((dir) => file.startsWith(dir)) && !text.trimStart().startsWith('//'))
    .map(([, file, line]) => `${file}:${line}`);
  assert.deepEqual(left, [], 'scripts and public serve the tool prefix from the identity');
});

test('every active doc naming aki__ carries the default-prefix note', { skip: skipNoGit }, () => {
  const EXEMPT_DIRS = ['docs/plan/done/', 'docs/research/'];
  const NOTE = /default prefix .aki__|aki__. by default/;
  let listed = '';
  try {
    listed = execFileSync('git', ['grep', '-l', 'aki__', '--', 'README.md', 'docs', 'public', 'CLAUDE.md'], { cwd: repoRoot, encoding: 'utf8' });
  } catch (error) {
    assert.equal(error.status, 1, `git grep failed: ${error.stderr || error.message}`);
  }
  const missing = listed
    .split('\n')
    .filter(Boolean)
    .filter((file) => !EXEMPT_DIRS.some((dir) => file.startsWith(dir)))
    .filter((file) => !NOTE.test(readFileSync(resolve(repoRoot, file), 'utf8')));
  assert.deepEqual(missing, [], 'docs naming aki__ must carry the default-prefix note');
});
