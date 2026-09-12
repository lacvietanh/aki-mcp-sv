#!/usr/bin/env node
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { resolveUnderRoot, getRoots, containedIn } from '../scripts/roots.js';

async function run() {
  const home = os.homedir();
  const homeInRoots = getRoots().some((root) => containedIn(home, root));

  // Fix 1: a bare "~" must expand to the home directory, not a literal ".../~" path.
  if (homeInRoots) {
    assert.equal(resolveUnderRoot('~'), home, '"~" must expand to os.homedir()');
    assert.equal(
      resolveUnderRoot('~/x'),
      path.join(home, 'x'),
      '"~/x" must expand under os.homedir()',
    );
  }

  // The boundary still holds: an expanded "~/..." path that lands outside every root must throw.
  const escape = path.join(home, '..', '..', 'definitely-not-a-configured-root-xyz');
  const escapeTarget = '~/' + path.relative(home, escape);
  assert.throws(
    () => resolveUnderRoot(escapeTarget),
    /outside the allowed roots/,
    'a ~/... path that escapes all roots must still throw',
  );

  console.log('roots.test.js: ok');
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
