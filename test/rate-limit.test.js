#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before the gatekeeper loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-ratelimit-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
process.env.GATEKEEPER_PORT = '0';
const goodToken = 'a'.repeat(64);
writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access: { [goodToken]: { expires: Date.now() + 3600_000 } }, refresh: {} }));

const { createLimiter, clientKey, readLimits, validateLimits, LIMIT_DEFAULTS } = await import('../scripts/rate-limit.js');
const { startGatekeeper } = await import('../scripts/gatekeeper.js');

let clock = 0;
const limiter = createLimiter({ settings: () => ({ enabled: true, max: 3, windowMs: 1000, blockMs: 5000 }), now: () => clock });
assert.equal(limiter.retryAfterSeconds('k'), 0);
assert.equal(limiter.record('k'), false);
assert.equal(limiter.record('k'), false);
assert.equal(limiter.record('k'), true);
assert.equal(limiter.retryAfterSeconds('k'), 5);
assert.equal(limiter.retryAfterSeconds('other'), 0);
clock = 1001;
assert.equal(limiter.retryAfterSeconds('k'), 4, 'the block outlives the counting window');
assert.deepEqual(limiter.blockedList(), [{ key: 'k', retryAfterSeconds: 4 }]);
limiter.release('k');
assert.equal(limiter.retryAfterSeconds('k'), 0, 'release lifts a block at once');
limiter.record('k'); limiter.record('k'); limiter.record('k');
clock = 6002;
assert.equal(limiter.retryAfterSeconds('k'), 0, 'a block ends by itself');
assert.equal(limiter.record('k'), false, 'and the counter starts over');

assert.deepEqual(readLimits(), LIMIT_DEFAULTS);
assert.equal(LIMIT_DEFAULTS.failMax, 5);
assert.equal(LIMIT_DEFAULTS.failWindowSeconds, 60);
assert.throws(() => validateLimits({ ...LIMIT_DEFAULTS, failMax: 0 }));
assert.throws(() => validateLimits({ ...LIMIT_DEFAULTS, enabled: 'yes' }));
assert.deepEqual(validateLimits({ ...LIMIT_DEFAULTS, failMax: 7 }).failMax, 7);

const fake = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });
assert.equal(clientKey(fake('203.0.113.9', { 'x-forwarded-for': '1.1.1.1' })), '203.0.113.9');
assert.equal(clientKey(fake('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' })), '198.51.100.7');
assert.equal(clientKey(fake('::1', { 'x-forwarded-for': 'spoofed, 198.51.100.8' })), '198.51.100.8');
assert.equal(clientKey(fake('::ffff:127.0.0.1')), 'loopback');

const printed = [];
const consoleLog = console.log;
console.log = (...a) => { printed.push(a.join(' ')); consoleLog(...a); };
const server = startGatekeeper(null);
await new Promise((resolve) => server.once('listening', resolve));
const call = (pathname, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path: pathname, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, retryAfter: res.headers['retry-after'] }));
  }).on('error', reject);
});

for (let i = 0; i < 30; i++) assert.equal((await call('/nope', { 'x-forwarded-for': '198.51.100.1' })).status, 404, 'unknown paths are never counted');

for (let i = 0; i < 5; i++) assert.equal((await call('/mcp', { 'x-forwarded-for': '198.51.100.3', authorization: 'Bearer wrong' })).status, 401);
const refused = await call('/mcp', { 'x-forwarded-for': '198.51.100.3', authorization: 'Bearer wrong' });
assert.equal(refused.status, 429);
assert.ok(Math.abs(Number(refused.retryAfter) - LIMIT_DEFAULTS.blockMinutes * 60) <= 5, `the default block is ${LIMIT_DEFAULTS.blockMinutes} minutes, got ${refused.retryAfter} s`);
assert.equal((await call('/mcp', { 'x-forwarded-for': '198.51.100.3', authorization: 'Bearer ' + goodToken })).status, 405, 'valid credentials are never refused');
await call('/mcp', { 'x-forwarded-for': '198.51.100.3', authorization: 'Bearer ' + goodToken });
assert.equal(printed.filter((l) => l.includes('token used by new caller 198.51.100.3')).length, 1, 'a new caller is logged once');
assert.equal(printed.filter((l) => l.includes('/nope') || l.includes('-> 429') || l.includes('GET /mcp')).length, 0, '404, 429 and /mcp access lines are not printed');
assert.equal(printed.filter((l) => l.includes('blocked after repeated failed attempts')).length, 1, 'a block is logged once');
console.log = consoleLog;

server.close();

const withIngress = startGatekeeper('https://example.ts.net');
await new Promise((resolve) => withIngress.once('listening', resolve));
const register = (forwardedFor) => fetch(`http://127.0.0.1:${withIngress.address().port}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
  body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }),
}).then((res) => res.status);
for (let i = 0; i < 100; i++) assert.equal(await register('198.51.100.4'), 201, 'many connects in a few minutes are allowed');
assert.equal(await register('198.51.100.4'), 429, 'a caller registering in bulk is refused');
assert.equal(await register('198.51.100.5'), 201, 'another caller can still register');
withIngress.close();
rmSync(dir, { recursive: true, force: true });
console.log('rate-limit.test.js: ok');
