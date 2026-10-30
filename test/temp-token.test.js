#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-temp-token-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const probe = net.createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
process.env.GATEKEEPER_PORT = String(probe.address().port);
probe.close();
await once(probe, 'close');

const { getOrIssueAccessToken, rotateAccessToken, bearerStatus, mintTempToken, revokeTempToken, listTempTokens, extendTempTokenById } = await import('../scripts/oauth.js');
const { startGatekeeper } = await import('../scripts/gatekeeper.js');
const { ROUTES } = await import('../scripts/panel.js');

const bearer = (token) => `Bearer ${token}`;
const base = `http://127.0.0.1:${process.env.GATEKEEPER_PORT}/mcp`;
const call = (method, token) => fetch(base, { method, headers: { Authorization: bearer(token) } });
const server = startGatekeeper(null);
await once(server, 'listening');
const realNow = Date.now;

try {
  const shared = getOrIssueAccessToken();
  const first = mintTempToken();
  const second = mintTempToken();
  assert.equal(bearerStatus(bearer(first.token)), 'valid');
  assert.equal(bearerStatus(bearer(second.token)), 'valid', 'temp tokens are many at once');
  assert.notEqual(first.token, shared);
  assert.ok(first.expires > Date.now() && first.expires <= Date.now() + 4 * 3600_000, 'one 4 h lifetime');
  assert.ok(!readFileSync(path.join(dir, 'tokens.json'), 'utf8').includes(first.token), 'tokens.json never holds a temp token');

  // Self-revoke over the wire: DELETE with the temp Bearer ends that token only, then the same token gets the retired 401.
  const preflight = await fetch(base, { method: 'OPTIONS' });
  assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
  assert.equal((await call('DELETE', first.token)).status, 204);
  assert.equal((await call('DELETE', first.token)).status, 401);
  assert.equal(bearerStatus(bearer(first.token)), 'retired');
  assert.equal(bearerStatus(bearer(second.token)), 'valid', 'the other temp token is untouched');
  assert.equal(bearerStatus(bearer(shared)), 'valid', 'the shared token is untouched');

  // A shared-token DELETE behaves as before: it ends no token.
  assert.equal((await call('DELETE', shared)).status, 204);
  assert.equal(bearerStatus(bearer(shared)), 'valid');
  assert.equal(revokeTempToken(bearer(shared)), false);
  assert.equal(revokeTempToken('Bearer ' + 'f'.repeat(64)), false);

  // Expiry: past its lifetime a temp token is retired, not valid.
  Date.now = () => realNow() + 5 * 3600_000;
  assert.equal(bearerStatus(bearer(second.token)), 'retired');
  Date.now = realNow;

  // Soft roll keeps temp tokens; hard roll ends them.
  const kept = mintTempToken();
  rotateAccessToken();
  assert.equal(bearerStatus(bearer(kept.token)), 'valid');
  rotateAccessToken({ revokeRefresh: true });
  assert.equal(bearerStatus(bearer(kept.token)), 'retired');

  // Extend: each call adds exactly 30 min to a live token; a revoked or unknown id changes nothing.
  const extendable = mintTempToken();
  const [{ id: extendId }] = listTempTokens();
  const extendedOnce = extendable.expires + 30 * 60_000;
  assert.equal(extendTempTokenById(extendId), true);
  assert.equal(listTempTokens()[0].expires, extendedOnce);
  assert.equal(extendTempTokenById(extendId), true);
  assert.equal(listTempTokens()[0].expires, extendedOnce + 30 * 60_000);
  assert.equal(extendTempTokenById('f'.repeat(64)), false);
  assert.equal(listTempTokens().length, 1);
  assert.equal(listTempTokens()[0].expires, extendedOnce + 30 * 60_000, 'an unknown id extends nothing');
  assert.equal((await ROUTES['POST /api/temp-token/extend']({ id: extendId })).message, 'extended by 30 min');
  assert.equal(listTempTokens()[0].expires, extendedOnce + 60 * 60_000);

  // Use is recorded through the public /mcp entry with the caller facts the callers list derives: address and user-agent.
  assert.deepEqual([listTempTokens()[0].lastAddress, listTempTokens()[0].lastAgent, listTempTokens()[0].lastSeen], [null, null, null], 'not used yet');
  const usedAt = Date.now();
  assert.equal((await fetch(base, { headers: { Authorization: bearer(extendable.token), 'User-Agent': 'temp-test/1' } })).status, 405);
  const used = listTempTokens()[0];
  assert.equal(used.lastAddress, 'loopback');
  assert.equal(used.lastAgent, 'temp-test/1');
  assert.ok(used.lastSeen >= usedAt && used.lastSeen <= Date.now());

  assert.equal(revokeTempToken(bearer(extendable.token)), true);
  assert.equal(extendTempTokenById(extendId), false, 'a revoked token stays dead');
  assert.equal(bearerStatus(bearer(extendable.token)), 'retired');
  assert.deepEqual(listTempTokens(), []);
  await assert.rejects(() => ROUTES['POST /api/temp-token/extend']({ id: extendId }), /no live temporary token/);

  // Panel mint: needs a public origin, returns the labelled block once, and the token it carries works.
  await assert.rejects(() => ROUTES['POST /api/temp-token']({}, {}), /public address/);
  const minted = await ROUTES['POST /api/temp-token']({}, { origin: 'https://akimcp.example' });
  const labels = Object.fromEntries(minted.kickoff.split('\n').filter((line) => /^[A-Z_]+: /.test(line)).map((line) => line.split(': ')));
  assert.deepEqual(Object.keys(labels), ['GUIDE', 'MCP_URL', 'TOKEN', 'EXPIRES']);
  assert.equal(labels.MCP_URL, 'https://akimcp.example/mcp');
  assert.match(labels.GUIDE, /^https:\/\/akimcp\.top\/guide\/mcp-http\/v1\.md$/);
  assert.equal(bearerStatus(bearer(labels.TOKEN)), 'valid');

  // Panel list and revoke by id: only live tokens are listed, and the panel's revoke ends that one token.
  const { tokens } = await ROUTES['GET /api/temp-tokens']();
  assert.equal(tokens.length, 1);
  assert.equal((await ROUTES['POST /api/temp-token/revoke']({ id: tokens[0].id })).message, 'revoked 1 temporary token');
  assert.equal(bearerStatus(bearer(labels.TOKEN)), 'retired');
  assert.deepEqual((await ROUTES['GET /api/temp-tokens']()).tokens, []);

  // The guide is served as markdown, not a binary download.
  const guide = await fetch(`http://127.0.0.1:${process.env.GATEKEEPER_PORT}/guide/mcp-http/v1.md`);
  assert.equal(guide.status, 200);
  assert.equal(guide.headers.get('content-type'), 'text/markdown; charset=utf-8');

  console.log('PASS: temp tokens — many at once, self-revoke by DELETE, expiry, hard roll, panel mint and revoke, guide MIME');
} finally {
  Date.now = realNow;
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
