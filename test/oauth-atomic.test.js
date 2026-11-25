#!/usr/bin/env node
import './setup.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-oauth-atomic-'));
process.env.AKI_MCP_DATA_DIR = dataDir;
const { loadOrCreatePassphrase, getOrIssueAccessToken, rotateAccessToken } = await import('../scripts/oauth.js');
const tokensFile = path.join(dataDir, 'tokens.json');
const retiredFile = path.join(dataDir, 'retired-tokens.json');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('rotateAccessToken writes complete JSON atomically with no .tmp residue', () => {
  const first = getOrIssueAccessToken();
  const rolled = rotateAccessToken();
  assert.notEqual(rolled, first, 'a roll issues a new token');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(tokensFile, 'utf8')).access), [rolled], 'the token file is complete JSON holding the rolled token');
  assert.equal(JSON.parse(fs.readFileSync(retiredFile, 'utf8')).length, 1, 'the retired file is complete JSON holding the first token');
  assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.includes('.tmp')), [], 'no temp file is left beside the saved files');
});

test('token files are written owner-only (0600)', { skip: process.platform === 'win32' ? 'POSIX mode bits are not enforced on Windows' : false }, () => {
  for (const file of [tokensFile, retiredFile]) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${path.basename(file)} is readable by its owner only`);
  }
});

test('torn passphrase files are replaced atomically', () => {
  const passphraseFile = path.join(dataDir, 'passphrase.txt');
  for (const torn of ['', ' \n\t']) {
    fs.writeFileSync(passphraseFile, torn);
    const issued = loadOrCreatePassphrase();
    assert.match(issued, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/, `a passphrase file holding ${JSON.stringify(torn)} is replaced, never used as the passphrase`);
    assert.equal(fs.readFileSync(passphraseFile, 'utf8'), issued, 'the replacement is on disk');
    assert.equal(loadOrCreatePassphrase(), issued, 'and is the one read next');
  }
});
