#!/usr/bin/env node
// Shapes AIObox reads from AkiMCP (docs/plan/IMPORTANT-akimcp-aiobox-contract.md § Hợp đồng AIObox đọc từ AkiMCP): a change that breaks one fails here before it breaks the macro.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aiobox-contract-')));
process.env.AKI_MCP_DATA_DIR = tmp;
const read = (name) => fs.readFileSync(path.join(tmp, name), 'utf8');

const { writeLock } = await import('../scripts/instance-lock.js');
const { getOrIssueAccessToken, loadOrCreatePassphrase } = await import('../scripts/oauth.js');
const { recordCaller } = await import('../scripts/callers.js');
const { ROUTES } = await import('../scripts/panel.js');

// instance.json: panelPort + token for the loopback panel, origin + ingress for the connector URL in every mode.
writeLock({ pid: 1, panelPort: 9998, gatePort: 9999, token: 'panel-token', version: '0.0.0', origin: 'https://host.example', ingress: 'funnel' });
const lock = JSON.parse(read('instance.json'));
assert.equal(lock.panelPort, 9998);
assert.equal(lock.token, 'panel-token');
assert.equal(lock.origin, 'https://host.example');
assert.equal(lock.ingress, 'funnel');
writeLock({ pid: 1, panelPort: 9998, gatePort: 9999, token: 'panel-token', version: '0.0.0' });
assert.equal(JSON.parse(read('instance.json')).origin, null, 'no ingress is an explicit null, not a missing key');

// tokens.json: { access: { <token>: { expires } }, refresh: { <token>: { clientId } } }; AIObox takes the first unexpired access token.
const access = getOrIssueAccessToken('contract test');
const tokens = JSON.parse(read('tokens.json'));
assert.deepEqual(Object.keys(tokens).sort(), ['access', 'refresh']);
assert.ok(tokens.access[access].expires > Date.now());
assert.equal(typeof tokens.refresh, 'object');

// passphrase.txt: one line, the passphrase itself.
const passphrase = loadOrCreatePassphrase();
assert.equal(read('passphrase.txt').trim(), passphrase);
assert.doesNotMatch(read('passphrase.txt'), /\n./);

// ingress.json: the panel's saved Cloudflare pick, origin without a trailing slash.
await ROUTES['POST /api/ingress/cloudflared']({ credContent: JSON.stringify({ TunnelID: 'x' }), origin: 'https://cf.example/' });
assert.equal(JSON.parse(read('ingress.json')).origin, 'https://cf.example');

// GET /api/security: clients[] { redirectHost, signedIn, tokenAt }, callers[] { agent, lastSeen }.
recordCaller('203.0.113.9', 'Claude-User/1.0');
const security = await ROUTES['GET /api/security']();
const claude = security.clients.find((c) => c.redirectHost === 'claude.ai');
assert.ok(claude, 'the pre-registered Claude client is listed by its redirect host');
assert.equal(typeof claude.signedIn, 'boolean');
assert.ok(claude.tokenAt === null || typeof claude.tokenAt === 'number');
assert.ok(security.callers[0].agent.startsWith('Claude-User'));
assert.equal(typeof security.callers[0].lastSeen, 'number');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('aiobox-contract.test.js: ok');
