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

const live = renderPanel({ origin: 'https://example.test', client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
assert.ok(live.includes('data-tab="buda"') && live.includes('id="tab-buda"'), 'Buda tab and pane are rendered');
const budaPane = live.split('id="tab-buda"')[1].split('class="tabpane"')[0];
assert.ok(budaPane.includes('>https://example.test/mcp<'), 'Buda pane carries the public MCP URL');
assert.ok(budaPane.includes('data-v="Bearer SECRETTOK"'), 'Buda pane carries the Bearer header value');
const geminiPane = live.split('id="tab-gemini"')[1].split('class="tabpane"')[0];
assert.ok(geminiPane.includes('<strong>Next</strong>') && geminiPane.includes('<strong>Approve</strong>'), 'Gemini pane walks the Next / Approve account-linking flow');
assert.ok(!geminiPane.includes('Client secret'), 'Gemini pane no longer asks for a pasted Client ID/Secret as a step');

fs.rmSync(process.env.AKI_MCP_DATA_DIR, { recursive: true, force: true });
console.log('passphrase-roll.test.js: ok');
