#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-oauth-atomic-'));
process.env.AKI_MCP_DATA_DIR = dataDir;
const oauthSource = new URL('../scripts/oauth.js', import.meta.url);
const { loadOrCreatePassphrase } = await import(oauthSource.href);

try {
  const plainWrites = fs.readFileSync(oauthSource, 'utf8').split('writeFileSync(').length - 1;
  assert.equal(plainWrites, 1, 'the only writeFileSync call in oauth.js is the one inside writeFileAtomic');

  const passphraseFile = path.join(dataDir, 'passphrase.txt');
  for (const torn of ['', ' \n\t']) {
    fs.writeFileSync(passphraseFile, torn);
    const issued = loadOrCreatePassphrase();
    assert.match(issued, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/, `a passphrase file holding ${JSON.stringify(torn)} is replaced, never used as the passphrase`);
    assert.equal(fs.readFileSync(passphraseFile, 'utf8'), issued, 'the replacement is on disk');
    assert.equal(loadOrCreatePassphrase(), issued, 'and is the one read next');
  }
  console.log('oauth-atomic.test.js: ok');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
