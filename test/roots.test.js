#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUnderRoot, resolveRealUnderRoot, resolveRealWritable, resolveRealWritableDir, refuseCredentialArgs, getRoots, containedIn } from '../scripts/roots.js';
import { USER_DIR } from '../scripts/userdata.js';

async function run() {
  const home = os.homedir();
  const homeInRoots = getRoots().some((root) => containedIn(home, root));
  assert.ok(homeInRoots, 'the home directory is inside the default roots');

  // A bare "~" expands to the home directory, not a literal ".../~" path.
  assert.equal(resolveUnderRoot('~'), home, '"~" must expand to os.homedir()');
  assert.equal(
    resolveUnderRoot('~/x'),
    path.join(home, 'x'),
    '"~/x" must expand under os.homedir()',
  );

  // The boundary still holds: an expanded "~/..." path that lands outside every root must throw.
  const escape = path.join(home, '..', '..', 'definitely-not-a-configured-root-xyz');
  const escapeTarget = '~/' + path.relative(home, escape);
  assert.throws(
    () => resolveUnderRoot(escapeTarget),
    /outside the allowed roots/,
    'a ~/... path that escapes all roots must still throw',
  );

  // create_directory is mkdir -p: resolveRealWritableDir must resolve a target whose parent chain is missing several levels, where resolveRealWritable (single-level only) rejects it.
  const base = fs.mkdtempSync(path.join(home, '.aki-mkdirp-test-'));
  try {
    const deep = path.join(base, 'a', 'b', 'c', 'd');
    const real = await resolveRealWritableDir(deep);
    assert.equal(
      real,
      path.join(fs.realpathSync(base), 'a', 'b', 'c', 'd'),
      'resolveRealWritableDir must resolve a deep path built on the nearest existing ancestor',
    );
    await assert.rejects(
      resolveRealWritable(deep),
      /parent directory does not exist/,
      'resolveRealWritable must still reject a multi-level-missing path',
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  // The root boundary still holds for the mkdir -p resolver.
  await assert.rejects(
    resolveRealWritableDir(escapeTarget),
    /outside the allowed roots/,
    'resolveRealWritableDir must reject a path that escapes every root',
  );

  // M2: refuseCredentialArgs blocks instance.json directly, through a symlink, and inside --flag=path, while resolveRealUnderRoot leaves instance.json open for redacted reads.
  fs.mkdirSync(USER_DIR, { recursive: true });
  const lockFile = path.join(USER_DIR, 'instance.json');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, panelPort: 9998, token: '0123456789abcdef0123456789abcdef' }));
  const symDir = fs.mkdtempSync(path.join(home, '.aki-lock-sym-'));
  const symLock = path.join(symDir, 'alias-lock.json');
  try {
    fs.symlinkSync(lockFile, symLock);
    assert.throws(() => refuseCredentialArgs([lockFile], home), /instance\.json holds akimcp's credentials/);
    assert.throws(() => refuseCredentialArgs([symLock], home), /instance\.json holds akimcp's credentials/);
    assert.throws(() => refuseCredentialArgs([`--config=${lockFile}`], home), /instance\.json holds akimcp's credentials/);
    assert.throws(() => refuseCredentialArgs([`--config=${symLock}`], home), /instance\.json holds akimcp's credentials/);
    const readableLock = await resolveRealUnderRoot(lockFile);
    assert.equal(readableLock, fs.realpathSync(lockFile));
  } finally {
    fs.rmSync(symDir, { recursive: true, force: true });
  }

  console.log('roots.test.js: ok');
}

await run();
