#!/usr/bin/env node
// Notion custom MCP connector (ported from PR #7 by @TheLucasHenry onto the single shared access token).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env must be set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-notion-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const { handleRegister, handleAuthorize, handleToken, handleRevoke, metadataHandlers, getOrIssueAccessToken, verifyBearer } = await import('../scripts/oauth.js');

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/register') return handleRegister(req, res);
  if (route === '/authorize') return handleAuthorize(req, res, 'pass', 'http://origin');
  if (route === '/revoke') return handleRevoke(req, res);
  if (route === '/meta') return metadataHandlers('http://origin').authorizationServer(req, res);
  return handleToken(req, res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const CALLBACK = 'https://www.notion.so/mcp/oauth/callback';
const form = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
const register = (body) => fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const basic = (id, secret) => ({ Authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}` });
const tokens = () => JSON.parse(readFileSync(path.join(dir, 'tokens.json'), 'utf8'));

try {
  const meta = await (await fetch(`${base}/meta`)).json();
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none', 'client_secret_post', 'client_secret_basic']);
  assert.equal(meta.revocation_endpoint, 'http://origin/revoke');

  // Callbacks: exact Notion hostnames over https only.
  for (const bad of ['https://notion.so.evil.com/cb', 'https://evilnotion.so/cb', 'http://www.notion.so/cb', 'https://u:p@www.notion.so/cb', 'https://www.notion.so/cb#x', 'https://x.notion.so/cb']) {
    assert.equal((await register({ redirect_uris: [bad] })).status, 400, bad);
  }
  // Non-object bodies and unknown auth methods are rejected, never crash.
  for (const body of ['null', '[]', '7', '"x"']) assert.equal((await register(body)).status, 400, body);
  assert.equal((await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'private_key_jwt' })).status, 400);

  const reg = await register({ redirect_uris: [CALLBACK], client_name: 'Notion', token_endpoint_auth_method: 'client_secret_basic' });
  assert.equal(reg.status, 201);
  const client = await reg.json();
  assert.match(client.client_secret, /^[0-9a-f]{64}$/);

  // A prototype member is not a client.
  for (const id of ['constructor', '__proto__', 'toString']) {
    const r = await fetch(`${base}/authorize?client_id=${id}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=x&code_challenge_method=S256`);
    assert.equal(r.status, 400, id);
  }

  // Consent carries scope through to the code; Basic client auth gets the one shared access token.
  const verifier = 'v'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const consent = await (await fetch(`${base}/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}&code_challenge_method=S256&scope=${encodeURIComponent(' read write ')}`)).text();
  assert.match(consent, /name="scope" value="read write"/);
  const approve = await fetch(`${base}/authorize`, { ...form({ redirect_uri: CALLBACK, client_id: client.client_id, code_challenge: challenge, code_challenge_method: 'S256', passphrase: 'pass', scope: 'read write' }), redirect: 'manual' });
  assert.equal(approve.status, 302);
  const code = new URL(approve.headers.get('location')).searchParams.get('code');

  const wrong = await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK }, basic(client.client_id, 'nope')));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('www-authenticate'), 'Basic realm="aki-mcp-sv"');
  const malformed = await fetch(`${base}/token`, form({ grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret }, { Authorization: 'Basic !!!' }));
  assert.equal(malformed.status, 401, 'a malformed Basic header must not fall back to body credentials');

  const granted = await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK }, basic(client.client_id, client.client_secret)));
  assert.equal(granted.status, 200);
  const grant = await granted.json();
  assert.equal(grant.scope, 'read write');
  assert.equal(grant.access_token, getOrIssueAccessToken(), 'Notion holds the same single access token as every client');
  assert.deepEqual(tokens().refresh[grant.refresh_token], { clientId: client.client_id, scope: 'read write' });

  // Refresh: never widens, may narrow, and client_secret_post still works for a Basic-registered client.
  const refresh = (extra) => fetch(`${base}/token`, form({ grant_type: 'refresh_token', refresh_token: grant.refresh_token, client_id: client.client_id, client_secret: client.client_secret, ...extra }));
  assert.equal((await refresh({ scope: 'read admin' })).status, 400);
  assert.equal((await (await refresh({})).json()).scope, 'read write');
  assert.equal((await (await refresh({ scope: 'read' })).json()).scope, 'read');
  assert.equal((await refresh({ scope: 'write' })).status, 400, 'a narrowed grant cannot win back a dropped part');

  // Revoke: another client's token is untouched; revoking the shared access token signs out only the caller.
  const other = await (await register({ redirect_uris: ['https://app.notion.com/cb'], token_endpoint_auth_method: 'client_secret_post' })).json();
  const revoke = (who, token) => fetch(`${base}/revoke`, form({ token, client_id: who.client_id, client_secret: who.client_secret }));
  assert.equal((await revoke(other, grant.refresh_token)).status, 200);
  assert.ok(tokens().refresh[grant.refresh_token], 'a foreign refresh token must survive');
  assert.equal((await fetch(`${base}/revoke`, form({ client_id: client.client_id, client_secret: client.client_secret }))).status, 400);
  assert.equal((await revoke({ client_id: client.client_id, client_secret: 'x' }, grant.access_token)).status, 401);
  assert.equal((await revoke(client, grant.access_token)).status, 200);
  assert.ok(!tokens().refresh[grant.refresh_token], 'the caller is signed out');
  assert.equal(verifyBearer(`Bearer ${grant.access_token}`), true, 'the shared access token keeps serving every other client');
  assert.equal((await revoke(client, 'unknown')).status, 200);

  console.log('PASS: Notion connector — exact callback hosts, non-object /register, own-property clients, Basic auth, scope, revoke on the shared token');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
