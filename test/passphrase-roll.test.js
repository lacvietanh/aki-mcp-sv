#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-pass-'));
const { loadOrCreatePassphrase, rotatePassphrase } = await import('../scripts/oauth.js');
const { renderPanel } = await import('../scripts/config-page.js');

const before = loadOrCreatePassphrase();
const after = rotatePassphrase();
assert.notEqual(after, before, 'a roll must issue a different passphrase');
assert.equal(loadOrCreatePassphrase(), after, 'the rolled passphrase must be the one read next');
for (const p of [before, after]) assert.match(p, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/, 'first-load and rolled passphrases use the unambiguous alphabet');

const html = renderPanel({ origin: null, client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
assert.ok(!html.includes(`>${after}<`), 'passphrase must not be visible in the rendered text');
assert.ok(!html.includes('>SECRETTOK<'), 'access token must not be visible in the rendered text');
assert.ok(html.includes(`data-v="${after}"`) && html.includes('data-v="SECRETTOK"'), 'copy must still carry the real values');
assert.ok(html.includes('data-eye') && html.includes('data-act="rollPassphrase"'));

fs.rmSync(process.env.AKI_MCP_DATA_DIR, { recursive: true, force: true });
console.log('passphrase-roll.test.js: ok');
