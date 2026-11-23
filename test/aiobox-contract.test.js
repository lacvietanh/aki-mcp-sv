#!/usr/bin/env node
// Shapes AIObox reads from AkiMCP (docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md § Hợp đồng AIObox đọc từ AkiMCP): a change that breaks one fails here before it breaks the macro.
import './setup.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aiobox-contract-')));
process.env.AKI_MCP_DATA_DIR = tmp;
const read = (name) => fs.readFileSync(path.join(tmp, name), 'utf8');

const { writeLock } = await import('../scripts/instance-lock.js');
const { getOrIssueAccessToken, loadOrCreatePassphrase } = await import('../scripts/oauth.js');
const { recordCaller } = await import('../scripts/callers.js');
const { ROUTES, startPanel } = await import('../scripts/panel.js');
const { noteRefused } = await import('../scripts/oauth-callbacks.js');
const { IDENTITY, DEFAULT_NAME, DEFAULT_KEY } = await import('../scripts/mcp-name.js');
const { renderPanel } = await import('../scripts/config-page.js');
const { createToolsServer } = await import('../scripts/tools-server.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

// instance.json: panelPort + token for the loopback panel, origin + ingress for the connector URL in every mode.
writeLock({ pid: 1, panelPort: 9998, gatePort: 9999, token: 'panel-token', version: '0.0.0', origin: 'https://host.example', ingress: 'funnel' });
const lock = JSON.parse(read('instance.json'));
assert.equal(lock.panelPort, 9998);
assert.equal(lock.token, 'panel-token');
assert.equal(lock.origin, 'https://host.example');
assert.equal(lock.ingress, 'funnel');
writeLock({ pid: 1, panelPort: 9998, gatePort: 9999, token: 'panel-token', version: '0.0.0' });
assert.equal(JSON.parse(read('instance.json')).origin, null, 'no ingress is an explicit null, not a missing key');

// tokens.json: { access: { <token>: { expires } }, refresh: { <token>: { clientId } } }; AIObox reads it as a fallback until its A3 step.
const access = getOrIssueAccessToken('contract test');
const tokens = JSON.parse(read('tokens.json'));
assert.deepEqual(Object.keys(tokens).sort(), ['access', 'refresh']);
assert.ok(tokens.access[access].expires > Date.now());
assert.equal(typeof tokens.refresh, 'object');

// GET /api/access-token: { accessToken } is the token tokens.json holds; AIObox reads it here instead of the file.
assert.deepEqual(await ROUTES['GET /api/access-token'](), { accessToken: access });

// passphrase.txt: one line, the passphrase itself.
const passphrase = loadOrCreatePassphrase();
assert.equal(read('passphrase.txt').trim(), passphrase);
assert.doesNotMatch(read('passphrase.txt'), /\n./);

// ingress.json: the panel's saved Cloudflare pick, origin without a trailing slash.
await ROUTES['POST /api/ingress/cloudflared']({ credContent: JSON.stringify({ TunnelID: 'x' }), origin: 'https://cf.example/' });
assert.equal(JSON.parse(read('ingress.json')).origin, 'https://cf.example');

// GET /api/security: clients[] { redirectHost, signedIn, tokenAt }, callers[] { agent, lastSeen }.
fs.writeFileSync(path.join(tmp, 'oauth-dcr-clients.json'), JSON.stringify({
  claudeDcr: { clientId: 'claudeDcr', clientSecret: null, redirectUris: ['https://claude.ai/api/mcp/auth_callback'], tokenEndpointAuthMethod: 'none', clientName: 'Claude', firstSeenAt: Date.now() },
}));
recordCaller('203.0.113.9', 'Claude-User/1.0');
const security = await ROUTES['GET /api/security']();
const claudeClients = security.clients.filter((c) => c.redirectHost === 'claude.ai');
assert.deepEqual(claudeClients.map((c) => c.clientId), ['claudeDcr'], 'only a client registered from claude.ai reports its redirect host; the pre-issued client reports none');
const claude = claudeClients[0];
assert.equal(typeof claude.signedIn, 'boolean');
assert.ok(claude.tokenAt === null || typeof claude.tokenAt === 'number');
assert.ok(security.callers[0].agent.startsWith('Claude-User'));
assert.equal(typeof security.callers[0].lastSeen, 'number');
// clients[] is listClients() unchanged, so its full field set AIObox's Clients card reads is held by test/oauth-activity.test.js.

// POST /api/clients/remove { clientId, roll } → { ok, message }; what roll does is test/client-revoke.test.js's.
const removed = await ROUTES['POST /api/clients/remove']({ clientId: 'claudeDcr', roll: false });
assert.deepEqual(Object.keys(removed).sort(), ['message', 'ok']);
assert.equal(removed.ok, true);

// GET /api/oauth-callbacks and POST /api/oauth-callbacks/{add,remove}: exact 4.2.0 wire shape frozen for AIObox.
noteRefused(['https://contract-ai.example/oauth/cb', 'http://localhost:9000/bad'], 'Contract AI');
const listedCb = await ROUTES['GET /api/oauth-callbacks']();
assert.deepEqual(Object.keys(listedCb).sort(), ['entries', 'readError', 'refused', 'skipped']);
assert.equal(listedCb.readError, null);
const refusedRow = listedCb.refused.find((r) => r.callbacks.some((c) => c.host === 'contract-ai.example'));
assert.ok(refusedRow, 'noteRefused feeds GET /api/oauth-callbacks refused[]');
assert.deepEqual(Object.keys(refusedRow).sort(), ['callbacks', 'clientName', 'count', 'firstAt', 'lastAt']);
assert.equal(refusedRow.clientName, 'Contract AI');
assert.equal(typeof refusedRow.firstAt, 'number');
assert.equal(typeof refusedRow.lastAt, 'number');
assert.equal(refusedRow.count, 1);
assert.deepEqual(Object.keys(refusedRow.callbacks[0]).sort(), ['host', 'href', 'prefix', 'reason', 'shown']);
assert.equal(refusedRow.callbacks[0].host, 'contract-ai.example');
assert.equal(refusedRow.callbacks[0].prefix, 'https://contract-ai.example/oauth/');
assert.equal(refusedRow.callbacks[0].reason, null);
assert.equal(refusedRow.callbacks[1].prefix, null);
assert.equal(typeof refusedRow.callbacks[1].reason, 'string');

const addedCb = await ROUTES['POST /api/oauth-callbacks/add']({ match: 'exact', value: 'https://contract-ai.example/oauth/cb' });
assert.deepEqual(Object.keys(addedCb).sort(), ['message', 'ok']);
assert.equal(addedCb.ok, true);
const afterAddCb = await ROUTES['GET /api/oauth-callbacks']();
assert.deepEqual(afterAddCb.entries, [{ match: 'exact', value: 'https://contract-ai.example/oauth/cb', host: 'contract-ai.example' }]);
const removedCb = await ROUTES['POST /api/oauth-callbacks/remove']({ match: 'exact', value: 'https://contract-ai.example/oauth/cb' });
assert.deepEqual(Object.keys(removedCb).sort(), ['message', 'ok']);
assert.equal(removedCb.ok, true);

// HTTP-level 400 ({ error }, including wrong { url } body) and 403 (bad x-panel-token) gates for /api/oauth-callbacks*.
const cbPanelToken = 'contract-panel-token';
const cbPanel = startPanel({ port: 0, token: cbPanelToken, origin: 'https://host.example', ingress: 'funnel', client: { clientId: 'c', clientSecret: 's' }, passphrase: 'p', updateInfo: { mcp: {}, rule: {} } });
if (!cbPanel.listening) await once(cbPanel, 'listening');
const cbBase = `http://127.0.0.1:${cbPanel.address().port}`;
try {
  for (const route of ['/api/oauth-callbacks/add', '/api/oauth-callbacks/remove']) {
    const badBody = await fetch(cbBase + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-panel-token': cbPanelToken }, body: JSON.stringify({ url: 'https://contract-ai.example/oauth/cb' }) });
    assert.equal(badBody.status, 400, `${route} rejects legacy { url } body with 400`);
    assert.equal(typeof (await badBody.json()).error, 'string');
  }
  for (const [method, route] of [['GET', '/api/oauth-callbacks'], ['POST', '/api/oauth-callbacks/add'], ['POST', '/api/oauth-callbacks/remove']]) {
    const badTok = await fetch(cbBase + route, { method, headers: { 'Content-Type': 'application/json', 'x-panel-token': 'wrong' }, body: method === 'POST' ? JSON.stringify({ match: 'exact', value: 'https://contract-ai.example/oauth/cb' }) : undefined });
    assert.equal(badTok.status, 403, `${route} requires x-panel-token`);
    assert.equal(typeof (await badTok.json()).error, 'string');
  }
} finally {
  cbPanel.close();
  await once(cbPanel, 'close');
}

// /mcp initialize: AIObox copies serverInfo.title as the MCP name (serverInfo.name as fallback); the bridge returns this result unchanged.
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await createToolsServer().connect(serverSide);
const mcpClient = new Client({ name: 'aiobox-contract', version: '0.0.0' });
await mcpClient.connect(clientSide);
const serverInfo = mcpClient.getServerVersion();
assert.deepEqual([serverInfo.title, serverInfo.name], ['AkiMCP', 'akimcp']);
await mcpClient.close();

// Connector id and name: under the default identity both must contain "akimcp" by AIObox's matching rule, and the retired key survives in the rendered page only as the hint lines.
assert.deepEqual([IDENTITY.name, IDENTITY.key], [DEFAULT_NAME, DEFAULT_KEY], 'this run serves the default identity');
for (const name of [IDENTITY.name, IDENTITY.key]) assert.ok(name.toLowerCase().replace(/\s+/g, '').includes('akimcp'), `${name} satisfies the contract pattern`);
const page = renderPanel({ origin: 'https://host.example', client: {}, passphrase: 'p', token: 't', accessToken: 'tok', repoRoot: '/', rulesDir: '/', userDir: '/' });
const hints = page.match(/<p class="helptext legacy-hint">.*?<\/p>/g) ?? [];
assert.ok(hints.length > 0 && hints.some((hint) => hint.includes('Your config may still have entries named <span class="mono">aki-mcp</span>; delete them. Apply does this for you.')), 'the legacy hint line is rendered');
assert.doesNotMatch(page.replace(/<p class="helptext legacy-hint">.*?<\/p>/g, ''), /aki-mcp([^-]|$)/, 'no snippet or prose names the retired key outside the hint');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('aiobox-contract.test.js: ok');
