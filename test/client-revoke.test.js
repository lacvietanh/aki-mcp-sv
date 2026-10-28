#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'client-revoke-')));
process.env.AKI_MCP_DATA_DIR = tmp;
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const { ROUTES } = await import('../scripts/panel.js');
const { getOrIssueAccessToken, bearerStatus, listClients } = await import('../scripts/oauth.js');

const dcr = (clientId, extra) => ({ clientId, clientSecret: null, redirectUris: ['https://claude.ai/api/mcp/auth_callback'], tokenEndpointAuthMethod: 'none', clientName: clientId, firstSeenAt: Date.now(), ...extra });
fs.writeFileSync(path.join(tmp, 'oauth-dcr-clients.json'), JSON.stringify({
  granted: dcr('granted', { approvedAt: Date.now(), tokenAt: Date.now() }),
  kept: dcr('kept', { approvedAt: Date.now(), tokenAt: Date.now() }),
  untouched: dcr('untouched', { approvedAt: Date.now(), tokenAt: Date.now() }),
  neverTokened: dcr('neverTokened'),
}));
const remove = (body) => ROUTES['POST /api/clients/remove'](body);
const ids = () => listClients().map((c) => c.clientId);

const before = getOrIssueAccessToken('client revoke test');
assert.equal(bearerStatus(`Bearer ${before}`), 'valid');

const rolled = await remove({ clientId: 'granted', roll: true });
assert.ok(!ids().includes('granted'), 'roll:true removes the client');
assert.equal(bearerStatus(`Bearer ${before}`), 'retired', 'roll:true retires the access token the client held');
const after = getOrIssueAccessToken('client revoke test');
assert.notEqual(after, before);
assert.equal(bearerStatus(`Bearer ${after}`), 'valid');
assert.match(rolled.message, /removed and rolled the access token/);
assert.match(rolled.message, /ClickUp/);
assert.match(rolled.message, /Buda/);

for (const [clientId, roll] of [['kept', false], ['untouched', 'true']]) {
  const result = await remove({ clientId, roll });
  assert.ok(!ids().includes(clientId));
  assert.equal(result.message, 'removed', `roll:${JSON.stringify(roll)} only removes`);
  assert.equal(bearerStatus(`Bearer ${after}`), 'valid', `roll:${JSON.stringify(roll)} leaves the access token alone`);
}

assert.ok(ids().includes('neverTokened'), 'a client that never got a token is listed with tokenAt null');
assert.equal(listClients().find((c) => c.clientId === 'neverTokened').tokenAt, null);
await remove({ clientId: 'neverTokened', roll: false });
assert.ok(!ids().includes('neverTokened'), 'a never-tokened client is deleted');
assert.equal(bearerStatus(`Bearer ${after}`), 'valid');

console.log('client-revoke.test.js: ok');
