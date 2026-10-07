#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env must be set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-token-test-'));
process.env.AKI_MCP_DATA_DIR = dir;

const client = { clientId: 'c'.repeat(32), clientSecret: 's'.repeat(64) };
const future = Date.now() + 3600_000;
const expiredTok = 'e'.repeat(64);
const firstValid = 'a'.repeat(64);
const secondValid = 'b'.repeat(64);
writeFileSync(path.join(dir, 'oauth-client.json'), JSON.stringify(client));
writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({
  access: { [expiredTok]: { expires: Date.now() - 1000 }, [firstValid]: { expires: future }, [secondValid]: { expires: future + 1000 } },
  refresh: { r1: { clientId: client.clientId }, r2: { clientId: client.clientId } },
}));

const { getOrIssueAccessToken, rotateAccessToken, verifyBearer, handleToken } = await import('../scripts/oauth.js');
const { ROUTES } = await import('../scripts/panel.js');

const saved = () => JSON.parse(readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
const bearer = (t) => verifyBearer('Bearer ' + t);

const server = http.createServer((req, res) => handleToken(req, res));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const refreshGrant = async (refreshToken) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  return { status: res.status, body: await res.json() };
};

try {
  // Migration from the previous shape: first valid survives, expired and extra valid are dropped, refresh untouched.
  assert.deepEqual(Object.keys(saved().access), [firstValid]);
  assert.deepEqual(Object.keys(saved().refresh), ['r1', 'r2']);
  assert.equal(bearer(firstValid), true);
  assert.equal(bearer(secondValid), false);
  assert.equal(bearer(expiredTok), false);
  assert.equal(getOrIssueAccessToken(), firstValid);

  // A refresh grant returns the shared token and adds nothing.
  const soft = await refreshGrant('r1');
  assert.equal(soft.status, 200);
  assert.equal(soft.body.access_token, firstValid);
  assert.ok(soft.body.expires_in > 0 && soft.body.expires_in <= 3600, 'expires_in must be the remaining life, not the full TTL');
  assert.equal(Object.keys(saved().access).length, 1);

  // Soft roll: old token dead, refresh still works and hands out the new one.
  const rolled = rotateAccessToken();
  assert.notEqual(rolled, firstValid);
  assert.equal(bearer(firstValid), false);
  assert.equal(bearer(rolled), true);
  assert.deepEqual(Object.keys(saved().access), [rolled]);
  assert.deepEqual(Object.keys(saved().refresh), ['r1', 'r2']);
  assert.equal((await refreshGrant('r2')).body.access_token, rolled);

  // Hard roll through the panel route: refresh tokens are revoked too.
  assert.equal((await ROUTES['POST /api/roll-token']({ hard: true })).ok, true);
  const hard = getOrIssueAccessToken();
  assert.notEqual(hard, rolled);
  assert.equal(bearer(rolled), false);
  assert.deepEqual(saved().refresh, {});
  assert.equal((await refreshGrant('r1')).status, 400);

  // Panel soft roll keeps refresh tokens.
  const before = getOrIssueAccessToken();
  await ROUTES['POST /api/roll-token']({});
  assert.notEqual(getOrIssueAccessToken(), before);

  console.log('PASS: single shared access token — collapse on load, reuse across grants, soft and hard roll');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
