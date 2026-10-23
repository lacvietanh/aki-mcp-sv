#!/usr/bin/env node
import '../../../test/setup.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { normalizeAutoClickLabel, matchesAutoClickTarget } = require('../page/postman-autoclick-target-match.cjs');

const targets = [
  { keywords: ['approve', 'allow'], matchExact: false },
  { keywords: ['continue'], matchExact: false },
  { keywords: ['run'], matchExact: true },
  { keywords: ['try again'], matchExact: false },
];
const matchesKnownTarget = (text) => targets.some((target) => matchesAutoClickTarget(text, target));

for (const label of ['approve', 'allow', 'continue', 'run', 'try again']) {
  assert.equal(matchesKnownTarget(label), true, `base action should match: ${label}`);
}

for (const count of [1, 2, 12, 999]) {
  for (const label of ['approve', 'allow', 'continue', 'run', 'try again']) {
    assert.equal(matchesKnownTarget(`${label} (${count})`), true, `counted action should match: ${label} (${count})`);
  }
}

assert.equal(normalizeAutoClickLabel('approve (12)'), 'approve');
for (const label of ['unrelated', 'unrelated (2)', 'runner (2)', 'run (0)', 'run (-2)', 'run (2 items)']) {
  assert.equal(matchesKnownTarget(label), false, `unrelated or invalid label should not match: ${label}`);
}

const indexSrc = readFileSync(path.join(repoRoot, 'scripts/postman/postman-daemon.cjs'), 'utf8');
const autoclickerSrc = readFileSync(path.join(repoRoot, 'scripts/postman/page/postman-autoclick.js'), 'utf8');
assert.match(indexSrc, /PAGE_FILES = \['postman-autoclick-target-match\.cjs'/);
assert.match(autoclickerSrc, /matchesAutoClickTarget\(text, t\)/);

console.log('autoclick-target-match.test.js: ok');
