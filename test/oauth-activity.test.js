#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env must be set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-activity-test-'));
process.env.AKI_MCP_DATA_DIR = dir;

const staticClient = { clientId: 'c'.repeat(32), clientSecret: 's'.repeat(64) };
const hourAgo = Date.now() - 3600_000 - 1000;
const monthAgo = Date.now() - 31 * 24 * 3600_000;
const dcr = (id, extra) => ({ clientId: id, clientSecret: null, redirectUris: ['https://chatgpt.com/connector/oauth/x'], tokenEndpointAuthMethod: 'none', clientName: id, ...extra });
writeFileSync(path.join(dir, 'oauth-client.json'), JSON.stringify(staticClient));
writeFileSync(path.join(dir, 'oauth-dcr-clients.json'), JSON.stringify({
  stale: dcr('stale', { firstSeenAt: hourAgo }),
  fresh: dcr('fresh', { firstSeenAt: Date.now() }),
  approved: dcr('approved', { firstSeenAt: hourAgo, approvedAt: hourAgo }),
  legacy: dcr('legacy'),
  legacyHeld: dcr('legacyHeld'),
  idle: dcr('idle', { firstSeenAt: monthAgo, approvedAt: monthAgo }),
  signedOut: dcr('signedOut', { firstSeenAt: hourAgo, approvedAt: hourAgo }),
}));
writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({
  access: {},
  refresh: { rStale: { clientId: 'stale' }, rGone: { clientId: 'gone' }, rApproved: { clientId: 'approved' }, rLegacy: { clientId: 'legacyHeld' }, rStatic: { clientId: staticClient.clientId } },
}));

const { handleRegister, handleAuthorize, handleToken, listClients, removeClient } = await import('../scripts/oauth.js');

const readJson = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const dcrFile = () => readJson('oauth-dcr-clients.json');

const server = http.createServer((req, res) => {
  if (req.url === '/register') return handleRegister(req, res);
  if (req.url.startsWith('/authorize')) return handleAuthorize(req, res, 'pass', 'http://origin');
  return handleToken(req, res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const form = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'activity-test/1' }, body: new URLSearchParams(body) });

try {
  // Load time: orphan refresh tokens go, then dead clients — stale pending (with its token), untracked without a token, a month idle without a token.
  assert.deepEqual(Object.keys(readJson('tokens.json').refresh).sort(), ['rApproved', 'rLegacy', 'rStatic']);
  assert.deepEqual(Object.keys(dcrFile()).sort(), ['approved', 'fresh', 'legacyHeld', 'signedOut']);

  // Registering keeps every live client.
  const reg = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector/oauth/y'], client_name: 'New app', token_endpoint_auth_method: 'none' }),
  });
  assert.equal(reg.status, 201);
  const registered = await reg.json();
  const ids = Object.keys(dcrFile());
  for (const kept of ['fresh', 'approved', 'legacyHeld', 'signedOut', registered.client_id]) assert.ok(ids.includes(kept), `${kept} must be kept`);
  assert.ok(dcrFile()[registered.client_id].firstSeenAt > Date.now() - 5000);
  assert.ok(!existsSync(path.join(dir, 'oauth-dcr-clients.json.tmp')), 'atomic write must leave no temp file');

  // Approval sets approvedAt and the caller fields on the DCR record.
  const verifier = 'v'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'https://chatgpt.com/connector/oauth/y';
  const approve = await fetch(`${base}/authorize`, {
    ...form({ redirect_uri: redirectUri, client_id: registered.client_id, code_challenge: challenge, code_challenge_method: 'S256', passphrase: 'pass' }),
    redirect: 'manual',
  });
  assert.equal(approve.status, 302);
  const code = new URL(approve.headers.get('location')).searchParams.get('code');
  let record = dcrFile()[registered.client_id];
  assert.ok(record.approvedAt && !record.tokenAt);
  assert.equal(record.lastAgent, 'activity-test/1');
  assert.ok(record.lastAddress);

  // A /token grant sets tokenAt.
  const grant = await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: registered.client_id }));
  assert.equal(grant.status, 200);
  record = dcrFile()[registered.client_id];
  assert.ok(record.tokenAt >= record.approvedAt);

  // The static client gets firstSeenAt on approval and keeps its secret.
  const staticApprove = await fetch(`${base}/authorize`, {
    ...form({ redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: staticClient.clientId, code_challenge: challenge, code_challenge_method: 'S256', passphrase: 'pass' }),
    redirect: 'manual',
  });
  assert.equal(staticApprove.status, 302);
  const storedStatic = readJson('oauth-client.json');
  assert.equal(storedStatic.clientSecret, staticClient.clientSecret);
  assert.ok(storedStatic.firstSeenAt && storedStatic.approvedAt);

  // listClients: contract fields, no secrets, most recent activity first, legacy last.
  const list = listClients();
  const fields = ['clientId', 'name', 'kind', 'redirectHost', 'firstSeenAt', 'approvedAt', 'tokenAt', 'lastAddress', 'lastAgent', 'pending', 'signedIn'];
  for (const view of list) assert.deepEqual(Object.keys(view).sort(), [...fields].sort());
  assert.ok(!JSON.stringify(list).includes(staticClient.clientSecret) && !JSON.stringify(list).includes('clientSecret'));
  assert.deepEqual(list.slice(0, 2).map((view) => view.clientId), [staticClient.clientId, registered.client_id]);
  assert.equal(list.at(-1).clientId, 'legacyHeld');
  const claude = list.find((view) => view.kind === 'claude');
  assert.equal(claude.name, 'Claude (pre-registered)');
  assert.equal(claude.redirectHost, 'claude.ai');
  assert.equal(list.find((view) => view.clientId === 'fresh').pending, true);
  assert.equal(list.find((view) => view.clientId === 'approved').pending, false);
  assert.equal(list.find((view) => view.clientId === 'legacyHeld').pending, false);
  const signedIn = (id) => list.find((view) => view.clientId === id).signedIn;
  assert.deepEqual([signedIn('approved'), signedIn('legacyHeld'), signedIn(registered.client_id), signedIn('fresh'), signedIn('signedOut')], [true, true, true, false, false]);

  // Remove forgets a connector with its refresh token; the static client is only signed out.
  assert.equal(removeClient(registered.client_id), 'removed');
  assert.ok(!dcrFile()[registered.client_id]);
  assert.ok(!Object.values(readJson('tokens.json').refresh).some((entry) => entry.clientId === registered.client_id));
  assert.equal(removeClient(staticClient.clientId), 'signed out');
  assert.equal(readJson('oauth-client.json').clientSecret, staticClient.clientSecret);
  assert.ok(!Object.keys(readJson('tokens.json').refresh).includes('rStatic'));
  assert.throws(() => removeClient('nope'), /unknown client/);

  // Security events reach the log file.
  const securityLog = readFileSync(path.join(dir, 'security.log'), 'utf8');
  for (const event of ['client approved: New app', 'token granted (authorization_code) to New app', 'client removed from the panel: New app']) assert.ok(securityLog.includes(event), event);

  console.log('PASS: client activity — prune, activity fields, listClients contract, remove, security log');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
