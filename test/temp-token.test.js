#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-temp-token-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
process.env.GATEKEEPER_PORT = '0';

const {
  getOrIssueAccessToken,
  rotateAccessToken,
  bearerStatus,
  bearerPrincipal,
  normalizeTempTokenName,
  mintTempToken,
  revokeTempToken,
  listTempTokens,
  resolveTempTokenId,
  extendTempToken,
  extendTempTokenById,
  revokeTempTokenTarget,
} = await import('../scripts/oauth.js');
const { startGatekeeper } = await import('../scripts/gatekeeper.js');
const { handleStreamableMcp, setBridgeOrigin } = await import('../scripts/streamable-bridge.js');
const { ROUTES } = await import('../scripts/panel.js');
const { writeLock, clearLock } = await import('../scripts/instance-lock.js');

const bearer = (token) => `Bearer ${token}`;
const server = startGatekeeper(null);
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/mcp`;
const call = (method, token) => fetch(base, { method, headers: { Authorization: bearer(token) } });
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

  // Expiry: past its lifetime a temp token is retired, not valid, and +30 min cannot bring it back before it is pruned.
  const [{ id: secondId }] = listTempTokens();
  Date.now = () => realNow() + 5 * 3600_000;
  assert.equal(bearerStatus(bearer(second.token)), 'retired');
  assert.equal(extendTempTokenById(secondId), false, 'an expired token stays dead');
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
  const guide = await fetch(`${origin}/guide/mcp-http/v1.md`);
  assert.equal(guide.status, 200);
  assert.equal(guide.headers.get('content-type'), 'text/markdown; charset=utf-8');

  // M3: Name normalization, NFC, control-char stripping, length caps, case-insensitive uniqueness, selector conflicts, 7-day extend cap, and 64-live cap.
  assert.equal(normalizeTempTokenName(undefined), null);
  assert.equal(normalizeTempTokenName('   \n\t  '), null);
  assert.equal(normalizeTempTokenName('  aistudio-p60\n\tworker\x07  '), 'aistudio-p60 worker');
  assert.equal(normalizeTempTokenName('caf\u0065\u0301'), 'caf\u00e9');
  assert.throws(() => normalizeTempTokenName(123), /must be a string/);
  assert.throws(() => normalizeTempTokenName('a'.repeat(49)), /at most 48 characters/);
  assert.throws(() => normalizeTempTokenName('🔥'.repeat(33)), /128 UTF-8 bytes/);

  const namedA = await ROUTES['POST /api/temp-token']({ name: '  AIStudio-P60\nWorker  ' }, { origin: 'https://akimcp.example' });
  assert.equal(namedA.name, 'AIStudio-P60 Worker');
  assert.equal(bearerPrincipal(bearer(namedA.token)).name, 'AIStudio-P60 Worker');
  assert.ok(!namedA.kickoff.includes('AIStudio-P60 Worker'), 'kickoff stays 0 extra chars without NAME:');
  assert.match(readFileSync(path.join(dir, 'security.log'), 'utf8'), /name="AIStudio-P60 Worker"/);

  // Case-insensitive duplicate live name is refused.
  await assert.rejects(
    () => ROUTES['POST /api/temp-token']({ name: 'aistudio-p60 worker' }, { origin: 'https://akimcp.example' }),
    /already exists/,
  );

  // Conflicting selectors are refused.
  await assert.rejects(
    () => ROUTES['POST /api/temp-token/extend']({ id: namedA.id, name: namedA.name }),
    /specify either id or name, not both/,
  );
  await assert.rejects(
    () => ROUTES['POST /api/temp-token/revoke']({ all: true, name: namedA.name }),
    /specify either all or a single token/,
  );

  // Extend by case-insensitive name and by >=8-hex id prefix.
  const extByName = await ROUTES['POST /api/temp-token/extend']({ name: 'aistudio-p60 WORKER' });
  assert.equal(extByName.id, namedA.id);
  assert.equal(extByName.expires, namedA.expires + 30 * 60_000);
  const extByPrefix = await ROUTES['POST /api/temp-token/extend']({ id: namedA.id.slice(0, 8) });
  assert.equal(extByPrefix.id, namedA.id);
  assert.equal(extByPrefix.expires, namedA.expires + 60 * 60_000);

  // 7-day horizon cap throws instead of silently adding 0 min.
  const horizonToken = mintTempToken({ name: 'horizon-check' });
  Date.now = () => realNow() - 7 * 24 * 3600_000;
  assert.throws(() => extendTempToken({ id: horizonToken.id }), /cannot extend temporary token beyond 7 days/);
  Date.now = realNow;
  revokeTempTokenTarget({ id: horizonToken.id });

  // Revoke by case-insensitive name frees the name for immediate reuse.
  const revByName = await ROUTES['POST /api/temp-token/revoke']({ name: 'aistudio-p60 worker' });
  assert.equal(revByName.revoked, 1);
  assert.equal(revByName.name, 'AIStudio-P60 Worker');
  const namedAgain = await ROUTES['POST /api/temp-token']({ name: 'aistudio-p60 worker' }, { origin: 'https://akimcp.example' });
  assert.equal(namedAgain.name, 'aistudio-p60 worker');
  await ROUTES['POST /api/temp-token/revoke']({ all: true });

  // 64 live token cap.
  for (let i = 0; i < 64; i++) mintTempToken({ name: `slot-${i}` });
  assert.throws(() => mintTempToken({ name: 'slot-64' }), /too many active temporary tokens \(max 64\)/);
  revokeTempTokenTarget({ all: true });
  assert.equal(listTempTokens().length, 0);

  // B1 & M4: MCP tool aki__temp_token over HTTP /mcp enforces caller principal isolation (access vs temp) and fail-closed requireCaller.
  setBridgeOrigin(() => 'https://akimcp.example');
  const activeShared = getOrIssueAccessToken();
  const mcpPost = async (token, body, sid) => {
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(token),
        ...(sid ? { 'MCP-Session-Id': sid } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, sid: res.headers.get('MCP-Session-Id'), json: await res.json() };
  };
  const initRes = await mcpPost(activeShared, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'temp-token-test', version: '1.0' } },
  });
  assert.equal(initRes.status, 200);
  const sid = initRes.sid;
  const ctxRes = await mcpPost(activeShared, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'aki__akidevrule_context', arguments: {} },
  }, sid);
  const { receipt } = ctxRes.json.result.structuredContent;

  const callTempTool = async (token, args) => {
    const { json } = await mcpPost(token, {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000) + 10,
      method: 'tools/call',
      params: { name: 'aki__temp_token', arguments: { ...args, receipt } },
    }, sid);
    return json.result;
  };

  // Owner (shared access token) mints two named temp tokens via aki__temp_token.
  const mint1Res = await callTempTool(activeShared, { op: 'mint', name: 'agent-alpha' });
  assert.ok(!mint1Res.isError, mint1Res.content[0].text);
  assert.ok(!mint1Res.content[0].text.includes('\n'), 'M4: 1-line compact JSON');
  const mint1 = JSON.parse(mint1Res.content[0].text);
  assert.equal(mint1.id.length, 12, 'M4: 12-char short id');
  assert.equal(mint1.name, 'agent-alpha');
  assert.equal(mint1.ok, undefined, 'M4: redundant ok field omitted');
  const alphaToken = mint1.kickoff.match(/^TOKEN: ([0-9a-f]{64})$/m)[1];

  const mint2Res = await callTempTool(activeShared, { op: 'mint', name: 'agent-beta' });
  const mint2 = JSON.parse(mint2Res.content[0].text);
  assert.equal(mint2.name, 'agent-beta');

  // Temp-token caller (alphaToken) CANNOT mint, extend, or revoke other tokens.
  for (const forbiddenArgs of [
    { op: 'mint', name: 'rogue' },
    { op: 'extend', name: 'agent-alpha' },
    { op: 'revoke', name: 'agent-beta' },
    { op: 'revoke', all: true },
  ]) {
    const denied = await callTempTool(alphaToken, forbiddenArgs);
    assert.equal(denied.isError, true, `temp token must be forbidden from ${forbiddenArgs.op}`);
    assert.match(denied.content[0].text, /TEMP_TOKEN_FORBIDDEN/);
  }

  // Temp-token caller op="list" sees ONLY its own record (not agent-beta).
  const selfList = JSON.parse((await callTempTool(alphaToken, { op: 'list' })).content[0].text);
  assert.equal(selfList.callerKind, 'temp');
  assert.equal(selfList.tokens.length, 1);
  assert.equal(selfList.tokens[0].name, 'agent-alpha');

  // Shared access-token caller op="list" sees both tokens.
  const ownerList = JSON.parse((await callTempTool(activeShared, { op: 'list' })).content[0].text);
  assert.equal(ownerList.callerKind, 'access');
  assert.equal(ownerList.tokens.length, 2);

  // Temp-token caller op="revoke_self" revokes only its own token.
  const selfRev = JSON.parse((await callTempTool(alphaToken, { op: 'revoke_self' })).content[0].text);
  assert.equal(selfRev.revoked, 1);
  assert.equal(selfRev.name, 'agent-alpha');
  assert.equal(bearerStatus(bearer(alphaToken)), 'retired');
  assert.equal(listTempTokens().length, 1);
  assert.equal(listTempTokens()[0].name, 'agent-beta');

  // Shared access-token caller revokes agent-beta by name.
  const betaRev = JSON.parse((await callTempTool(activeShared, { op: 'revoke', name: 'agent-beta' })).content[0].text);
  assert.equal(betaRev.revoked, 1);
  assert.equal(betaRev.name, 'agent-beta');
  assert.equal(listTempTokens().length, 0);

  // B1 fail-closed check: calling handleStreamableMcp without a principal fails closed on aki__temp_token.
  const bareServer = http.createServer((req, res) => { handleStreamableMcp(req, res); });
  await new Promise((resolve) => bareServer.listen(0, '127.0.0.1', resolve));
  try {
    const bareUrl = `http://127.0.0.1:${bareServer.address().port}/mcp`;
    const bareRes = await fetch(bareUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'aki__temp_token', arguments: { op: 'list', receipt } },
      }),
    }).then((r) => r.json());
    assert.equal(bareRes.result.isError, true);
    assert.match(bareRes.result.content[0].text, /caller principal is required for temp_token on HTTP transport/);
  } finally {
    bareServer.closeAllConnections();
    bareServer.close();
  }

  // N1 & M1: CLI akimcp temp-token subcommand (including --dev temp-token --help and live loopback panel proxy).
  const binPath = fileURLToPath(new URL('../bin/akimcp.js', import.meta.url));
  const runCli = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { timeout: 10_000, env: { ...process.env, AKI_MCP_DATA_DIR: dir } }, (err, stdout, stderr) => {
      resolve({ status: err ? (err.code || 1) : 0, stdout, stderr });
    });
  });
  const helpRun = await runCli('--dev', 'temp-token', '--help');
  assert.equal(helpRun.status, 0, helpRun.stderr);
  assert.match(helpRun.stdout, /akimcp temp-token list/);

  const panelToken = 'panel-secret-token-for-cli-test';
  const stubPanel = http.createServer(async (req, res) => {
    if (req.headers['x-panel-token'] !== panelToken) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'wrong panel token' }));
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const handler = ROUTES[`${req.method} ${req.url}`];
    try {
      const out = await handler(JSON.parse(body || '{}'), { origin: 'https://akimcp.example' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((resolve) => stubPanel.listen(0, '127.0.0.1', resolve));
  writeLock({ pid: process.pid, panelPort: stubPanel.address().port, gatePort: server.address().port, token: panelToken, version: '4.2.0', origin: 'https://akimcp.example' });
  try {
    const cli = (...args) => runCli('temp-token', ...args);
    const cliMint = await cli('mint', '--name', 'cli-runner', '--json');
    assert.equal(cliMint.status, 0, cliMint.stderr);
    const cliMinted = JSON.parse(cliMint.stdout.trim());
    assert.equal(cliMinted.name, 'cli-runner');

    const cliList = await cli('list', '--json');
    assert.equal(cliList.status, 0, cliList.stderr);
    assert.equal(JSON.parse(cliList.stdout.trim()).tokens.length, 1);

    const cliExt = await cli('extend', 'cli-runner', '--json');
    assert.equal(cliExt.status, 0, cliExt.stderr);
    assert.equal(JSON.parse(cliExt.stdout.trim()).name, 'cli-runner');

    // Regression (a): CLI extend and revoke with full 64-hex id target (>48 chars).
    const cliExtFullHex = await cli('extend', cliMinted.id, '--json');
    assert.equal(cliExtFullHex.status, 0, cliExtFullHex.stderr);
    assert.equal(JSON.parse(cliExtFullHex.stdout.trim()).id, cliMinted.id);

    // Regression (b): Ambiguous target when token A name equals 8-hex prefix of token B id.
    const prefixCollisionName = cliMinted.id.slice(0, 8);
    const cliMintCollision = await cli('mint', '--name', prefixCollisionName, '--json');
    assert.equal(cliMintCollision.status, 0, cliMintCollision.stderr);
    assert.throws(() => resolveTempTokenId({ target: prefixCollisionName }), /ambiguous/i);
    const cliAmbiguous = await cli('extend', prefixCollisionName, '--json');
    assert.notEqual(cliAmbiguous.status, 0, 'CLI must reject ambiguous target matching both a name and an 8-hex id prefix');
    assert.match(cliAmbiguous.stderr, /ambiguous/i);

    const cliRevCollision = await cli('revoke', '--name', prefixCollisionName, '--json');
    assert.equal(cliRevCollision.status, 0, cliRevCollision.stderr);
    assert.equal(JSON.parse(cliRevCollision.stdout.trim()).revoked, 1);

    const cliRev = await cli('revoke', cliMinted.id, '--json');
    assert.equal(cliRev.status, 0, cliRev.stderr);
    assert.equal(JSON.parse(cliRev.stdout.trim()).revoked, 1);

    // A-N3: --token-only is strictly rejected on list, extend and revoke.
    for (const badArgs of [['list', '--token-only'], ['extend', 'cli-runner', '--token-only'], ['revoke', 'cli-runner', '--token-only'], ['revoke', '--all', '--token-only']]) {
      const badRun = await cli(...badArgs);
      assert.notEqual(badRun.status, 0, `expected --token-only to fail for ${badArgs.join(' ')}`);
      assert.match(badRun.stderr, /--token-only|takes only/);
    }
  } finally {
    clearLock();
    stubPanel.closeAllConnections();
    stubPanel.close();
  }

  console.log('PASS: temp tokens — named tokens, M3 caps/uniqueness, B1 caller principal isolation, CLI proxy, panel mint and revoke, guide MIME');
} finally {
  Date.now = realNow;
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
