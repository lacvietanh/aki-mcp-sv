#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';

const ORIGIN = 'https://mcp.example.test';
const CALLBACK = 'https://www.notion.so/mcp/callback';
const METHODS = ['none', 'client_secret_post', 'client_secret_basic'];
const PANEL_TOKEN = 'notion-panel-test-link';
const SPECIAL_ID = 'client space+percent%:id';
const SPECIAL_SECRET = 'secret space+percent%:tail:second';
const fixtures = [];
const sensitive = new Set([SPECIAL_ID, SPECIAL_SECRET]);
let activeCase = 0;

// Only unrelated tool integrations are doubled; the HTTP front doors, OAuth, storage, and assets are real.
export function resolve(specifier, context, nextResolve) {
  if (specifier === './streamable-bridge.js' && context.parentURL?.endsWith('/scripts/gatekeeper.js')) {
    return {
      url: 'data:text/javascript,' + encodeURIComponent('export function handleStreamableMcp(req, res) { res.writeHead(202); res.end("bridge-dispatched"); } export function terminateSession() {}'),
      shortCircuit: true,
    };
  }
  if (specifier === './postman-mcp.js' && context.parentURL?.endsWith('/scripts/panel.js')) {
    return {
      url: 'data:text/javascript,' + encodeURIComponent('export function getDaemonStatus() { return { running: false }; } export function launchPostmanDaemon() { throw new Error("not exercised"); } export const killPostmanDaemon = launchPostmanDaemon; export const requestNewWindow = launchPostmanDaemon;'),
      shortCircuit: true,
    };
  }
  if (!/^(node:|file:|data:|\.)/.test(specifier)) throw new Error('Unexpected non-core dependency');
  return nextResolve(specifier, context);
}

async function serve() {
  os.homedir = () => process.argv[3];
  const logs = [];
  console.log = (...parts) => logs.push(parts.join(' '));
  console.error = (...parts) => logs.push(parts.join(' '));
  register(import.meta.url);
  const { startGatekeeper } = await import('../scripts/gatekeeper.js');
  const { startPanel } = await import('../scripts/panel.js');
  const { loadOrCreateClient, loadOrCreatePassphrase } = await import('../scripts/oauth.js');
  const listen = http.Server.prototype.listen;
  let remote, local;
  // Exercise the actual fixed-port front door without reserving a real installation's port.
  http.Server.prototype.listen = function (port, host, callback) {
    return listen.call(this, 0, host, callback);
  };
  try {
    remote = startGatekeeper(ORIGIN);
    local = startGatekeeper(null);
  } finally {
    http.Server.prototype.listen = listen;
  }
  const panel = startPanel({
    port: 0,
    token: PANEL_TOKEN,
    origin: ORIGIN,
    ingress: 'funnel',
    client: loadOrCreateClient(),
    passphrase: loadOrCreatePassphrase(),
    updateInfo: { mcp: {}, rule: {} },
  });
  const servers = [remote, local, panel];
  await Promise.all(servers.map((server) => server.listening ? undefined : once(server, 'listening')));
  process.on('message', async (message) => {
    if (message.type === 'logs') process.send({ type: 'logs', logs });
    if (message.type === 'stop') {
      await Promise.all(servers.map((server) => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })));
      process.disconnect();
    }
  });
  process.send({ type: 'ready', ports: servers.map((server) => server.address().port) });
}

function clientRecord(clientId, clientSecret, method = 'none') {
  return { clientId, clientSecret, redirectUris: [CALLBACK], tokenEndpointAuthMethod: method, clientName: 'Notion test client' };
}

function createFixture(tokens = { access: {}, refresh: {} }, registry = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'notion-oauth-'));
  const data = path.join(home, '.aki', 'mcpsv');
  mkdirSync(data, { recursive: true });
  const fixture = {
    home,
    data,
    tokensFile: path.join(data, 'tokens.json'),
    clientsFile: path.join(data, 'oauth-dcr-clients.json'),
    passphrase: randomBytes(16).toString('hex'),
    child: null,
  };
  fixtures.push(fixture);
  sensitive.add(fixture.passphrase);
  writeFileSync(fixture.tokensFile, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(fixture.clientsFile, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(path.join(data, 'passphrase.txt'), fixture.passphrase, { mode: 0o600 });
  const client = { clientId: randomBytes(16).toString('hex'), clientSecret: randomBytes(32).toString('hex') };
  writeFileSync(path.join(data, 'oauth-client.json'), JSON.stringify(client), { mode: 0o600 });
  fixture.staticClient = { client_id: client.clientId, client_secret: client.clientSecret, token_endpoint_auth_method: 'client_secret_post' };
  sensitive.add(client.clientId);
  sensitive.add(client.clientSecret);
  return fixture;
}

async function boot(fixture) {
  const child = fork(fileURLToPath(import.meta.url), ['--serve', fixture.home], {
    env: {},
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  fixture.child = child;
  child.stdout.resume();
  child.stderr.resume();
  const ports = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited before readiness')); });
    child.on('message', (message) => {
      if (message.type === 'ready') { clearTimeout(timeout); resolve(message.ports); }
      if (message.type === 'failure') { clearTimeout(timeout); reject(new Error('Server initialization failed')); }
    });
  });
  [fixture.remote, fixture.local, fixture.panel] = ports.map((port) => `http://127.0.0.1:${port}`);
  fixture.logs = () => new Promise((resolve) => {
    const listener = (message) => {
      if (message.type !== 'logs') return;
      child.off('message', listener);
      resolve(message.logs);
    };
    child.on('message', listener);
    child.send({ type: 'logs' });
  });
  return fixture;
}

async function stop(fixture) {
  const child = fixture.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill(), 5000);
  if (child.connected) child.send({ type: 'stop' });
  else child.kill();
  try { await exited; } finally { clearTimeout(timeout); fixture.child = null; }
}

async function request(base, route, { method = 'GET', form, payload, authorization } = {}) {
  const headers = {};
  let body;
  if (form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  if (authorization !== undefined) headers.Authorization = authorization;
  const response = await fetch(base + route, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
}

function expectError(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(response.body, { error });
}

async function registerClient(base, method = 'none', redirectUri = CALLBACK) {
  const response = await request(base, '/register', {
    method: 'POST',
    payload: { redirect_uris: [redirectUri], token_endpoint_auth_method: method, client_name: 'Notion HTTP test' },
  });
  assert.equal(response.status, 201);
  sensitive.add(response.body.client_id);
  if (response.body.client_secret) sensitive.add(response.body.client_secret);
  return response.body;
}

const formEncode = (value) => encodeURIComponent(value).replace(/%20/g, '+');

function basic(clientId, clientSecret) {
  const encoded = Buffer.from(formEncode(clientId) + ':' + formEncode(clientSecret)).toString('base64');
  sensitive.add(encoded);
  return 'Basic ' + encoded;
}

function authenticated(client, form) {
  if (client.token_endpoint_auth_method === 'client_secret_basic') {
    return { method: 'POST', authorization: basic(client.client_id, client.client_secret), form };
  }
  return { method: 'POST', form: { client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}), ...form } };
}

const token = (fixture, client, form) => request(fixture.remote, '/token', authenticated(client, form));
const revoke = (fixture, client, value, extra = {}) => request(fixture.remote, '/revoke', authenticated(client, { ...(value === undefined ? {} : { token: value }), ...extra }));
const stored = (fixture) => JSON.parse(readFileSync(fixture.tokensFile, 'utf8'));

function authorizationQuery(client, scope) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  sensitive.add(verifier);
  sensitive.add(state);
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris?.[0] || CALLBACK,
    response_type: 'code',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  });
  if (scope !== undefined) query.set('scope', scope);
  return { query, verifier, state };
}

function hiddenFields(html) {
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'" };
  const form = new URLSearchParams();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    form.set(match[1], match[2].replace(/&(?:amp|lt|gt|quot|#0?39);/g, (entity) => entities[entity]));
  }
  return form;
}

async function authorize(fixture, client, scope) {
  const { query, verifier, state } = authorizationQuery(client, scope);
  const consent = await request(fixture.remote, '/authorize?' + query);
  assert.equal(consent.status, 200);
  const form = hiddenFields(consent.text);
  assert.equal(form.get('scope'), (scope || '').trim());
  form.set('passphrase', fixture.passphrase);
  const approved = await request(fixture.remote, '/authorize', { method: 'POST', form });
  assert.equal(approved.status, 302);
  const redirect = new URL(approved.headers.get('location'));
  assert.equal(redirect.searchParams.get('state'), state);
  assert.equal(redirect.searchParams.get('iss'), ORIGIN);
  const code = redirect.searchParams.get('code');
  sensitive.add(code);
  return { grant_type: 'authorization_code', code, redirect_uri: query.get('redirect_uri'), code_verifier: verifier };
}

async function grant(fixture, client, scope) {
  const response = await token(fixture, client, await authorize(fixture, client, scope));
  assert.equal(response.status, 200);
  sensitive.add(response.body.access_token);
  sensitive.add(response.body.refresh_token);
  return response.body;
}

function fileSnapshot(file) {
  return { bytes: readFileSync(file), modified: statSync(file, { bigint: true }).mtimeNs };
}

function unchanged(file, snapshot) {
  assert.deepEqual(readFileSync(file), snapshot.bytes);
  assert.equal(statSync(file, { bigint: true }).mtimeNs, snapshot.modified);
}

async function run() {
  try {
    const fixture = await boot(createFixture(undefined, {
      [SPECIAL_ID]: clientRecord(SPECIAL_ID, SPECIAL_SECRET, 'client_secret_post'),
      'missing-stored-secret': clientRecord('missing-stored-secret', null, 'client_secret_post'),
    }));

    activeCase = 1;
    const hosts = ['notion.so', 'www.notion.so', 'app.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com', 'mcp.notion.com'];
    for (const host of hosts) await registerClient(fixture.remote, 'none', `https://${host}/cb`);
    await registerClient(fixture.remote, 'none', 'https://NOTION.SO:8443/cb?value=%23encoded');
    for (const uri of [
      'https://notion.so.evil.test/cb', 'https://evil-notion.so/cb', 'https://extra.notion.so/cb',
      'http://notion.so/cb', 'ftp://notion.so/cb', 'https://user:pw@notion.com/cb',
      'https://user@notion.so/cb', 'https://:pw@notion.so/cb', 'https://notion.so@evil.test/cb',
      'https://notion.so/cb#fragment', 'https://notion.so/cb#', 'https://notion.so./cb',
      'not a URL', 'relative/cb', null, 42,
    ]) {
      expectError(await request(fixture.remote, '/register', { method: 'POST', payload: { redirect_uris: [uri] } }), 400, 'invalid_redirect_uri');
    }
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chatgpt.com/connector/oauth/existing#unchanged', 'https://grok.com/connectors-oauth-exchange-code/existing',
      'https://oauth-redirect.googleusercontent.com/r/existing',
    ]) await registerClient(fixture.remote, 'none', uri);
    for (const uri of ['https://claude.ai/api/mcp/auth_callback/extra', 'https://chatgpt.com/connector_platform_oauth_redirect/extra']) {
      expectError(await request(fixture.remote, '/register', { method: 'POST', payload: { redirect_uris: [uri] } }), 400, 'invalid_redirect_uri');
    }
    const publicClient = await registerClient(fixture.remote);
    for (const method of ['plain', '', 'S256']) {
      const { query } = authorizationQuery(publicClient);
      query.set('code_challenge_method', method);
      if (method === 'S256') query.delete('code_challenge');
      assert.equal((await request(fixture.remote, '/authorize?' + query)).status, 400);
      query.set('passphrase', fixture.passphrase);
      assert.equal((await request(fixture.remote, '/authorize', { method: 'POST', form: query })).status, 400);
    }
    const changedRedirect = authorizationQuery(publicClient).query;
    changedRedirect.set('redirect_uri', 'https://app.notion.com/other');
    assert.equal((await request(fixture.remote, '/authorize?' + changedRedirect)).status, 400);
    console.log('PASS 1: exact callback hostnames, rejected lookalikes/schemes/userinfo/fragments, existing rules, and mandatory S256');

    activeCase = 2;
    const clients = {};
    for (const method of METHODS) {
      const client = await registerClient(fixture.remote, method);
      clients[method] = client;
      assert.equal(client.token_endpoint_auth_method, method);
      if (method === 'none') assert.equal(Object.hasOwn(client, 'client_secret'), false);
      else assert.match(client.client_secret, /^[0-9a-f]{64}$/);
      const entry = JSON.parse(readFileSync(fixture.clientsFile, 'utf8'))[client.client_id];
      assert.equal(entry.clientSecret, client.client_secret || null);
      assert.equal(entry.tokenEndpointAuthMethod, method);
    }
    const defaultMethod = await request(fixture.remote, '/register', { method: 'POST', payload: { redirect_uris: [CALLBACK] } });
    assert.equal(defaultMethod.status, 201);
    assert.equal(defaultMethod.body.token_endpoint_auth_method, 'none');
    assert.equal(Object.hasOwn(defaultMethod.body, 'client_secret'), false);
    for (const method of ['private_key_jwt', 'client_secret_jwt', '', null, false, [], {}]) {
      expectError(await request(fixture.remote, '/register', { method: 'POST', payload: { redirect_uris: [CALLBACK], token_endpoint_auth_method: method } }), 400, 'invalid_client_metadata');
    }
    console.log('PASS 2: confidential DCR secrets, public-client omission, default method, and unsupported-method rejection');

    activeCase = 3;
    for (const route of ['/token', '/revoke']) {
      const form = { grant_type: 'unsupported', token: 'unknown-held-token', client_id: SPECIAL_ID, client_secret: SPECIAL_SECRET };
      const success = (response) => route === '/token' ? expectError(response, 400, 'unsupported_grant_type') : assert.deepEqual([response.status, response.body], [200, {}]);
      success(await request(fixture.remote, route, { method: 'POST', form }));
      success(await request(fixture.remote, route, { method: 'POST', form: { ...form, client_id: 'wrong-body-id', client_secret: 'wrong-body-secret' }, authorization: basic(SPECIAL_ID, SPECIAL_SECRET) }));
      const colonHeader = 'bAsIc ' + Buffer.from(formEncode(SPECIAL_ID) + ':' + formEncode(SPECIAL_SECRET).replace(/%3A/g, ':')).toString('base64');
      sensitive.add(colonHeader.slice(6));
      success(await request(fixture.remote, route, { method: 'POST', form, authorization: colonHeader }));
      const unpaddedHeader = basic(SPECIAL_ID, SPECIAL_SECRET).replace(/=+$/, '');
      success(await request(fixture.remote, route, { method: 'POST', form, authorization: unpaddedHeader }));
      for (const header of [
        '', 'Bearer not-basic', 'Basic', 'Basic !!!!', 'Basic ' + Buffer.from('no-colon').toString('base64'),
        'Basic ' + Buffer.from('%ZZ:secret').toString('base64'), 'Basic ' + Buffer.from('id:%E0%A4').toString('base64'),
        'Basic ' + Buffer.from([0xff, 0x3a, 0xff]).toString('base64'), 'Basic YTpiA', 'Basic YTpi=',
        basic(SPECIAL_ID, 'incorrect-secret'),
      ]) {
        const response = await request(fixture.remote, route, { method: 'POST', form, authorization: header });
        expectError(response, 401, 'invalid_client');
        assert.equal(response.headers.get('www-authenticate'), /^Basic(?:\s|$)/i.test(header) ? 'Basic realm="aki-mcp-sv"' : null);
      }
      const missingSecret = await request(fixture.remote, route, { method: 'POST', form: { ...form, client_id: 'missing-stored-secret', client_secret: '' } });
      expectError(missingSecret, 401, 'invalid_client');
    }
    console.log('PASS 3: Basic form decoding, first-colon split, authoritative headers, body fallback only when absent, and challenges');

    activeCase = 4;
    const confidential = clients.client_secret_basic;
    const escapedScope = ' read"<&>\' write ';
    const escapeQuery = authorizationQuery(confidential, escapedScope).query;
    const consent = await request(fixture.remote, '/authorize?' + escapeQuery);
    assert.equal(consent.status, 200);
    assert.match(consent.text, /name="scope" value="read&quot;&lt;&amp;&gt;' write"/);
    assert.equal(hiddenFields(consent.text).get('scope'), escapedScope.trim());
    const exchange = await authorize(fixture, confidential, '  read write  ');
    const issued = await token(fixture, confidential, exchange);
    assert.equal(issued.status, 200);
    const scoped = issued.body;
    sensitive.add(scoped.access_token);
    sensitive.add(scoped.refresh_token);
    assert.equal(scoped.scope, 'read write');
    assert.equal(scoped.expires_in, 365 * 24 * 3600);
    assert.deepEqual(stored(fixture).refresh[scoped.refresh_token], { clientId: confidential.client_id, scope: 'read write' });
    const access = stored(fixture).access[scoped.access_token];
    assert.deepEqual(Object.keys(access).sort(), ['clientId', 'expires', 'refreshToken']);
    assert.equal(access.clientId, confidential.client_id);
    assert.equal(access.refreshToken, scoped.refresh_token);
    expectError(await token(fixture, confidential, exchange), 400, 'invalid_grant');
    const wrongVerifier = await authorize(fixture, confidential);
    expectError(await token(fixture, confidential, { ...wrongVerifier, code_verifier: 'wrong-verifier' }), 400, 'invalid_grant');
    const missingVerifier = await authorize(fixture, confidential);
    delete missingVerifier.code_verifier;
    expectError(await token(fixture, confidential, missingVerifier), 400, 'invalid_grant');
    const refreshForm = { grant_type: 'refresh_token', refresh_token: scoped.refresh_token };
    let refreshed = await token(fixture, confidential, refreshForm);
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.scope, 'read write');
    assert.equal(refreshed.body.refresh_token, scoped.refresh_token);
    const beforeWiden = readFileSync(fixture.tokensFile);
    for (const scope of ['read admin', 'reader']) expectError(await token(fixture, confidential, { ...refreshForm, scope }), 400, 'invalid_scope');
    assert.deepEqual(readFileSync(fixture.tokensFile), beforeWiden);
    refreshed = await token(fixture, confidential, { ...refreshForm, scope: ' write ' });
    assert.equal(refreshed.body.scope, 'write');
    assert.equal(refreshed.body.refresh_token, scoped.refresh_token);
    assert.equal((await token(fixture, confidential, refreshForm)).body.scope, 'write');
    expectError(await token(fixture, confidential, { ...refreshForm, scope: 'read write' }), 400, 'invalid_scope');
    refreshed = await token(fixture, confidential, { ...refreshForm, scope: '' });
    assert.equal(refreshed.status, 200);
    assert.equal(Object.hasOwn(refreshed.body, 'scope'), false);
    assert.deepEqual(stored(fixture).refresh[scoped.refresh_token], { clientId: confidential.client_id, scope: '' });
    assert.equal(Object.hasOwn((await token(fixture, confidential, refreshForm)).body, 'scope'), false);
    expectError(await token(fixture, confidential, { ...refreshForm, scope: 'write' }), 400, 'invalid_scope');
    for (const scope of [undefined, '   ']) {
      const empty = await grant(fixture, clients.none, scope);
      assert.equal(Object.hasOwn(empty, 'scope'), false);
      assert.deepEqual(stored(fixture).refresh[empty.refresh_token], { clientId: clients.none.client_id, scope: '' });
    }
    console.log('PASS 4: escaped consent scope, code exchange, refresh persistence, empty omission, narrowing, and widening rejection');

    activeCase = 5;
    const held = await grant(fixture, confidential, 'read');
    const sibling = await grant(fixture, confidential, 'read');
    const foreign = await grant(fixture, clients.none, 'read');
    const heldRefresh = await token(fixture, confidential, { grant_type: 'refresh_token', refresh_token: held.refresh_token });
    assert.equal(heldRefresh.status, 200);
    const uniform = (response) => {
      assert.equal(response.status, 200);
      assert.equal(response.text, '{}');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    };
    for (const value of [foreign.refresh_token, foreign.access_token]) uniform(await revoke(fixture, confidential, value));
    assert.ok(stored(fixture).refresh[foreign.refresh_token]);
    assert.ok(stored(fixture).access[foreign.access_token]);
    uniform(await revoke(fixture, confidential, sibling.access_token, { token_type_hint: 'refresh_token' }));
    assert.equal(Object.hasOwn(stored(fixture).access, sibling.access_token), false);
    assert.ok(stored(fixture).refresh[sibling.refresh_token]);
    const siblingRefresh = await token(fixture, confidential, { grant_type: 'refresh_token', refresh_token: sibling.refresh_token });
    assert.equal(siblingRefresh.status, 200);
    uniform(await revoke(fixture, confidential, held.refresh_token, { token_type_hint: 'access_token' }));
    const remaining = stored(fixture);
    assert.equal(Object.hasOwn(remaining.refresh, held.refresh_token), false);
    for (const value of [held.access_token, heldRefresh.body.access_token]) {
      assert.equal(Object.hasOwn(remaining.access, value), false);
      assert.equal((await request(fixture.remote, '/mcp', { authorization: 'Bearer ' + value })).status, 401);
    }
    assert.ok(remaining.access[siblingRefresh.body.access_token]);
    assert.ok(remaining.access[foreign.access_token]);
    uniform(await revoke(fixture, confidential, held.refresh_token));
    uniform(await revoke(fixture, confidential, 'unknown-revocation-token'));
    expectError(await revoke(fixture, confidential), 400, 'invalid_request');
    expectError(await revoke(fixture, confidential, ''), 400, 'invalid_request');
    expectError(await request(fixture.remote, '/revoke', { method: 'POST', form: {} }), 401, 'invalid_client');
    const metadata = await request(fixture.remote, '/.well-known/oauth-authorization-server');
    assert.equal(metadata.body.revocation_endpoint, ORIGIN + '/revoke');
    assert.deepEqual(metadata.body.token_endpoint_auth_methods_supported, METHODS);
    assert.deepEqual(metadata.body.revocation_endpoint_auth_methods_supported, METHODS);
    assert.deepEqual(metadata.body.code_challenge_methods_supported, ['S256']);
    console.log('PASS 5: grant-only revocation, foreign-token protection, uniform responses, missing-token errors, and metadata');

    activeCase = 6;
    const authorizeParams = authorizationQuery(clients.none).query;
    const approvedParams = new URLSearchParams(authorizeParams);
    approvedParams.set('passphrase', fixture.passphrase);
    const discovery = [
      '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration', '/.well-known/openid-configuration/mcp',
    ];
    const routes = [
      ...discovery.map((route) => [route, {}, 200]),
      ['/register', { method: 'POST', payload: { redirect_uris: [CALLBACK] } }, 201],
      ['/authorize?' + authorizeParams, {}, 200],
      ['/authorize', { method: 'POST', form: approvedParams }, 302],
      ['/token', authenticated(clients.none, { grant_type: 'unsupported' }), 400],
      ['/revoke', authenticated(clients.none, { token: 'unknown-boundary-token' }), 200],
    ];
    for (const [route, options, status] of routes) {
      const blocked = await request(fixture.local, route, options);
      assert.equal(blocked.status, 503);
      assert.equal(blocked.text, 'Remote ingress not configured — local MCP is active at /mcp');
      const enabled = await request(fixture.remote, route, options);
      assert.equal(enabled.status, status);
      if (discovery.slice(2).includes(route)) assert.deepEqual(enabled.body, metadata.body);
      if (discovery.slice(0, 2).includes(route)) assert.deepEqual(enabled.body, { resource: ORIGIN + '/mcp', authorization_servers: [ORIGIN] });
      for (const base of [fixture.local, fixture.remote]) {
        assert.equal((await request(base, route, { method: 'OPTIONS' })).status, 204);
        assert.equal((await request(base, route, { method: 'DELETE' })).status, 404);
      }
    }
    for (const base of [fixture.local, fixture.remote]) {
      const unauthenticated = await request(base, '/mcp');
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.headers.get('www-authenticate'), base === fixture.local ? 'Bearer' : `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
      const authorization = 'Bearer ' + foreign.access_token;
      const unsupported = await request(base, '/mcp', { authorization });
      assert.equal(unsupported.status, 405);
      assert.equal(unsupported.headers.get('allow'), 'POST, DELETE');
      assert.equal((await request(base, '/mcp', { method: 'DELETE', authorization })).status, 204);
      const dispatched = await request(base, '/mcp', { method: 'POST', authorization, payload: {} });
      assert.equal(dispatched.status, 202);
      assert.equal(dispatched.text, 'bridge-dispatched');
      assert.equal((await request(base, '/img/providers/notion.png')).status, 200);
      assert.equal((await request(base, '/img/providers/notion.png', { method: 'POST' })).status, 404);
      assert.equal((await request(base, '/not-a-route')).status, 404);
      assert.equal((await request(base, '/not-a-route', { method: 'OPTIONS' })).status, 204);
    }
    console.log('PASS 6: all 11 OAuth routes share ingress gating; discovery aliases, local MCP dispatch, static files, and fallbacks');

    activeCase = 7;
    const expires = Date.now() + 365 * 24 * 3600 * 1000;
    const legacyId = 'legacy-public-client';
    const legacyOtherId = 'legacy-confidential-client';
    const legacySecret = randomBytes(32).toString('hex');
    sensitive.add(legacySecret);
    const legacyRegistry = {
      [legacyId]: { ...clientRecord(legacyId, null), redirectUris: ['https://chatgpt.com/connector/oauth/legacy'] },
      [legacyOtherId]: { ...clientRecord(legacyOtherId, legacySecret, 'client_secret_post'), redirectUris: ['https://claude.ai/api/mcp/auth_callback'] },
    };
    const legacy = createFixture({
      access: { 'old-access-one': { expires }, 'old-access-two': { expires } },
      refresh: { 'old-refresh': { clientId: legacyId }, 'other-refresh': { clientId: legacyOtherId } },
    }, legacyRegistry);
    const tokenSnapshot = fileSnapshot(legacy.tokensFile);
    const dcrSnapshot = fileSnapshot(legacy.clientsFile);
    const legacyClient = { client_id: legacyId, token_endpoint_auth_method: 'none' };
    const otherClient = { client_id: legacyOtherId, client_secret: legacySecret, token_endpoint_auth_method: 'client_secret_post' };
    for (let reload = 0; reload < 2; reload++) {
      await boot(legacy);
      unchanged(legacy.tokensFile, tokenSnapshot);
      unchanged(legacy.clientsFile, dcrSnapshot);
      assert.equal((await request(legacy.remote, '/mcp', { authorization: 'Bearer old-access-one' })).status, 405);
      for (const client of [legacyClient, otherClient]) expectError(await token(legacy, client, { grant_type: 'unsupported' }), 400, 'unsupported_grant_type');
      unchanged(legacy.tokensFile, tokenSnapshot);
      unchanged(legacy.clientsFile, dcrSnapshot);
      await stop(legacy);
    }
    const mixed = stored(legacy);
    Object.assign(mixed.access, {
      'linked-owned': { clientId: legacyId, refreshToken: 'old-refresh', expires },
      'linked-foreign': { clientId: legacyOtherId, refreshToken: 'old-refresh', expires },
      'linked-ownerless': { refreshToken: 'old-refresh', expires },
      'linked-null-owner': { clientId: null, refreshToken: 'old-refresh', expires },
      'owned-unlinked': { clientId: legacyId, expires },
      'owned-null-link': { clientId: legacyId, refreshToken: null, expires },
      'other-grant': { clientId: legacyId, refreshToken: 'different-refresh', expires },
      'orphan-linked-owned': { clientId: legacyId, refreshToken: 'ownerless-refresh', expires },
      'orphan-linked-ownerless': { refreshToken: 'ownerless-refresh', expires },
      'null-owner': { clientId: null, expires },
      'empty-owner': { clientId: '', expires },
      collision: { clientId: legacyId, expires },
    });
    Object.assign(mixed.refresh, {
      'ownerless-refresh': {}, 'null-owner-refresh': { clientId: null },
      'empty-owner-refresh': { clientId: '' }, collision: { clientId: legacyOtherId },
    });
    writeFileSync(legacy.tokensFile, JSON.stringify(mixed, null, 2) + '\n');
    const mixedSnapshot = fileSnapshot(legacy.tokensFile);
    await boot(legacy);
    unchanged(legacy.tokensFile, mixedSnapshot);
    unchanged(legacy.clientsFile, dcrSnapshot);
    for (const value of ['collision', 'null-owner', 'empty-owner', 'null-owner-refresh', 'empty-owner-refresh']) uniform(await revoke(legacy, legacyClient, value));
    assert.deepEqual(stored(legacy), mixed);
    const legacyRefresh = await token(legacy, legacyClient, { grant_type: 'refresh_token', refresh_token: 'old-refresh' });
    assert.equal(legacyRefresh.status, 200);
    assert.equal(legacyRefresh.body.refresh_token, 'old-refresh');
    assert.equal(Object.hasOwn(legacyRefresh.body, 'scope'), false);
    uniform(await revoke(legacy, otherClient, 'old-refresh'));
    assert.ok(stored(legacy).access['linked-owned']);
    uniform(await revoke(legacy, legacyClient, 'old-refresh'));
    const afterLegacyRevoke = stored(legacy);
    assert.equal(Object.hasOwn(afterLegacyRevoke.refresh, 'old-refresh'), false);
    assert.equal(Object.hasOwn(afterLegacyRevoke.access, 'linked-owned'), false);
    assert.equal(Object.hasOwn(afterLegacyRevoke.access, legacyRefresh.body.access_token), false);
    for (const value of ['old-access-one', 'old-access-two', 'linked-foreign', 'linked-ownerless', 'linked-null-owner', 'owned-unlinked', 'owned-null-link', 'other-grant', 'collision']) assert.ok(afterLegacyRevoke.access[value]);
    uniform(await revoke(legacy, legacyClient, 'ownerless-refresh'));
    assert.equal(Object.hasOwn(stored(legacy).access, 'orphan-linked-owned'), false);
    assert.ok(stored(legacy).access['orphan-linked-ownerless']);
    uniform(await revoke(legacy, legacyClient, 'old-access-one'));
    assert.equal(Object.hasOwn(stored(legacy).access, 'old-access-one'), false);
    assert.ok(stored(legacy).access['old-access-two']);
    uniform(await revoke(legacy, legacyClient, 'old-access-one'));
    unchanged(legacy.clientsFile, dcrSnapshot);
    await stop(legacy);
    const persisted = fileSnapshot(legacy.tokensFile);
    await boot(legacy);
    unchanged(legacy.tokensFile, persisted);
    unchanged(legacy.clientsFile, dcrSnapshot);
    assert.equal((await request(legacy.remote, '/mcp', { authorization: 'Bearer old-access-one' })).status, 401);
    assert.equal((await request(legacy.remote, '/mcp', { authorization: 'Bearer old-access-two' })).status, 405);
    expectError(await token(legacy, legacyClient, { grant_type: 'refresh_token', refresh_token: 'old-refresh' }), 400, 'invalid_grant');
    assert.equal((await token(legacy, otherClient, { grant_type: 'refresh_token', refresh_token: 'other-refresh' })).status, 200);
    unchanged(legacy.clientsFile, dcrSnapshot);
    await stop(legacy);
    console.log('PASS 7: populated legacy token/DCR load and reload without writes; refresh-first lookup and no unlinked/ambiguous-owner sweep');

    activeCase = 8;
    const page = await request(fixture.panel, '/?t=' + PANEL_TOKEN);
    assert.equal(page.status, 200);
    const section = page.text.match(/<section id="s1">([\s\S]*?)<\/section>/)[1];
    const tabs = section.match(/<nav class="tabs" role="tablist">([\s\S]*?)<\/nav>/)[1];
    const web = tabs.slice(tabs.indexOf('Web · needs ingress'));
    assert.match(web, /<button class="tab" data-tab="notion"><img src="\/img\/providers\/notion\.png" class="provider-icon" alt="">Notion<\/button>/);
    assert.equal((tabs.match(/class="tab active"/g) || []).length, 1);
    assert.match(tabs, /class="tab active" data-tab="postman"/);
    assert.equal((section.match(/class="tabpane active"/g) || []).length, 1);
    assert.match(section, /class="tabpane active" id="tab-postman"/);
    const notion = section.match(/<div class="tabpane" id="tab-notion">([\s\S]*?)<\/div>/)[1];
    assert.match(notion, /https:\/\/www\.notion\.so\/my-connections/);
    for (const text of ['custom MCP servers', 'workspace settings', 'approved', 'MCP URL', 'Passphrase', 'agent', 'republish the agent', 'Notion self-registers', 'no Client ID or Client secret to paste']) assert.ok(notion.includes(text));
    for (const asset of ['img/providers/notion.png', 'panel.css', 'panel-client.js']) {
      const response = await fetch(fixture.panel + '/' + asset);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, readFileSync(new URL('../public/' + asset, import.meta.url)));
      if (asset.endsWith('.png')) {
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(bytes.readUInt32BE(16), 96);
        assert.equal(bytes.readUInt32BE(20), 96);
      }
    }
    console.log('PASS 8: Notion Web-group tab, unchanged Postman default, setup steps, and byte-identical panel icon/assets');

    activeCase = 9;
    for (const clientId of ['unknown-client-sentinel', '__proto__', 'constructor', 'toString']) {
      sensitive.add(clientId);
      for (const route of ['/token', '/revoke']) {
        const form = { client_id: clientId, client_secret: '', grant_type: 'refresh_token', refresh_token: 'unknown-refresh-sentinel', token: 'unknown-revoke-sentinel' };
        const noHeader = await request(fixture.remote, route, { method: 'POST', form });
        expectError(noHeader, 401, 'invalid_client');
        assert.equal(noHeader.headers.get('www-authenticate'), null);
        const withHeader = await request(fixture.remote, route, { method: 'POST', form, authorization: basic(clientId, '') });
        expectError(withHeader, 401, 'invalid_client');
        assert.equal(withHeader.headers.get('www-authenticate'), 'Basic realm="aki-mcp-sv"');
      }
    }
    const canary = randomBytes(24).toString('hex');
    sensitive.add(canary);
    expectError(await request(fixture.remote, '/register', {
      method: 'POST',
      payload: { redirect_uris: [`https://${canary}:${canary}@rejected.example.test/${canary}?client_secret=${canary}#${canary}`] },
    }), 400, 'invalid_redirect_uri');
    expectError(await request(fixture.remote, '/register', { method: 'POST', payload: { redirect_uris: ['invalid-' + canary] } }), 400, 'invalid_redirect_uri');
    const leakedQuery = authorizationQuery(clients.none).query;
    leakedQuery.set('client_secret', canary);
    leakedQuery.set('state', canary);
    leakedQuery.set('code_challenge_method', canary);
    assert.equal((await request(fixture.remote, '/authorize?' + leakedQuery)).status, 400);
    expectError(await token(fixture, clients.none, { grant_type: canary, client_secret: canary }), 400, 'unsupported_grant_type');
    expectError(await request(fixture.remote, '/token?client_secret=' + canary, { method: 'POST', form: { client_id: canary, client_secret: canary } }), 401, 'invalid_client');
    const logs = await fixture.logs();
    for (const value of sensitive) assert.equal(logs.some((line) => line.includes(value)), false);
    assert.ok(logs.some((line) => line.includes('register REJECTED (redirect_uri not allowlisted): ["https://rejected.example.test"]')));
    assert.ok(logs.some((line) => line.includes('[oauth] token FAILED: invalid_client')));
    assert.ok(logs.some((line) => line.includes('[oauth] authorize REJECTED')));
    assert.ok(logs.some((line) => line.includes('[oauth] tokens ISSUED')));
    assert.ok(logs.some((line) => line.includes('[gatekeeper] GET /authorize -> 400')));
    assert.equal(logs.some((line) => /\[gatekeeper\].*\?/.test(line)), false);
    console.log('PASS 9: unknown/prototype clients rejected; no credential values in logs; rejected origins and diagnostics retained');
    activeCase = 10;
    // A grant written before scope existed has no `scope` key; one granted an empty scope has `scope: ''`.
    // The first must keep refreshing even when the client still sends `scope`, the second must not widen.
    const upgradeId = 'upgrade-legacy-client';
    const emptyScopeId = 'upgrade-empty-scope-client';
    const upgradeSecret = randomBytes(32).toString('hex');
    sensitive.add(upgradeSecret);
    const upgrade = createFixture({
      access: {},
      refresh: { 'pre-scope-refresh': { clientId: upgradeId }, 'empty-scope-refresh': { clientId: emptyScopeId, scope: '' } },
    }, {
      [upgradeId]: clientRecord(upgradeId, upgradeSecret, 'client_secret_basic'),
      [emptyScopeId]: clientRecord(emptyScopeId, upgradeSecret, 'client_secret_basic'),
    });
    await boot(upgrade);
    const upgradeClient = { client_id: upgradeId, client_secret: upgradeSecret, token_endpoint_auth_method: 'client_secret_basic' };
    const emptyScopeClient = { client_id: emptyScopeId, client_secret: upgradeSecret, token_endpoint_auth_method: 'client_secret_basic' };
    const preScope = await token(upgrade, upgradeClient, { grant_type: 'refresh_token', refresh_token: 'pre-scope-refresh', scope: 'read' });
    assert.equal(preScope.status, 200);
    assert.equal(preScope.body.scope, 'read');
    assert.equal(preScope.body.refresh_token, 'pre-scope-refresh');
    assert.equal(stored(upgrade).refresh['pre-scope-refresh'].scope, 'read');
    // Once recorded, the same grant is narrowable but no longer widenable.
    expectError(await token(upgrade, upgradeClient, { grant_type: 'refresh_token', refresh_token: 'pre-scope-refresh', scope: 'read write' }), 400, 'invalid_scope');
    assert.equal((await token(upgrade, upgradeClient, { grant_type: 'refresh_token', refresh_token: 'pre-scope-refresh', scope: '' })).status, 200);
    expectError(await token(upgrade, emptyScopeClient, { grant_type: 'refresh_token', refresh_token: 'empty-scope-refresh', scope: 'read' }), 400, 'invalid_scope');
    const emptyScopeRefresh = await token(upgrade, emptyScopeClient, { grant_type: 'refresh_token', refresh_token: 'empty-scope-refresh' });
    assert.equal(emptyScopeRefresh.status, 200);
    assert.equal(Object.hasOwn(emptyScopeRefresh.body, 'scope'), false);
    await stop(upgrade);
    console.log('PASS 10: pre-scope grants keep refreshing with a requested scope, then narrow only; explicit empty scope still rejects widening');

    activeCase = 11;
    // The panel prints its access token into local client configurations, so it must never hand out a
    // connector's token: revoking from the connector would otherwise break every local config silently.
    const connectorId = 'panel-isolation-connector';
    const connectorSecret = randomBytes(32).toString('hex');
    sensitive.add(connectorSecret);
    const isolation = createFixture({
      access: { 'connector-access': { clientId: connectorId, refreshToken: 'connector-refresh', expires: Date.now() + 365 * 24 * 3600 * 1000 } },
      refresh: { 'connector-refresh': { clientId: connectorId } },
    }, { [connectorId]: clientRecord(connectorId, connectorSecret, 'client_secret_basic') });
    await boot(isolation);
    const panelBearer = async () => {
      const response = await request(isolation.panel, '/?t=' + PANEL_TOKEN);
      assert.equal(response.status, 200);
      const match = response.text.match(/Bearer ([0-9a-f]{64})/);
      assert.ok(match, 'panel page did not expose an access token');
      sensitive.add(match[1]);
      return match[1];
    };
    const panelToken = await panelBearer();
    assert.notEqual(panelToken, 'connector-access');
    assert.equal(stored(isolation).access[panelToken].local, true);
    assert.equal(Object.hasOwn(stored(isolation).access['connector-access'], 'local'), false);
    assert.equal((await request(isolation.remote, '/mcp', { authorization: 'Bearer connector-access' })).status, 405);
    const connectorClient = { client_id: connectorId, client_secret: connectorSecret, token_endpoint_auth_method: 'client_secret_basic' };
    uniform(await revoke(isolation, connectorClient, 'connector-refresh'));
    const afterRevoke = stored(isolation);
    assert.equal(Object.hasOwn(afterRevoke.access, 'connector-access'), false);
    assert.equal(Object.hasOwn(afterRevoke.refresh, 'connector-refresh'), false);
    assert.ok(afterRevoke.access[panelToken]);
    assert.equal((await request(isolation.remote, '/mcp', { authorization: 'Bearer connector-access' })).status, 401);
    assert.equal((await request(isolation.local, '/mcp', { authorization: 'Bearer ' + panelToken })).status, 405);
    assert.equal(await panelBearer(), panelToken);
    await stop(isolation);
    console.log('PASS 11: the panel keeps its own local grant; a connector revocation cannot invalidate local client configurations');

    console.log('PASS: all 11 Notion OAuth cases (Node core only)');
  } finally {
    for (const fixture of fixtures) {
      await stop(fixture);
      rmSync(fixture.home, { recursive: true, force: true });
    }
  }
}

if (isMainThread) {
  const worker = process.argv[2] === '--serve';
  (worker ? serve() : run()).then(
    () => { if (!worker) process.exit(0); },
    (error) => {
      if (worker && process.send) process.send({ type: 'failure' });
      else {
        const line = error.stack?.match(/notion-oauth\.test\.js:(\d+)/)?.[1];
        console.error(`FAIL: case ${activeCase}${line ? ' at test/notion-oauth.test.js:' + line : ''} (${error.code || error.name})`);
      }
      process.exit(1);
    },
  );
}
