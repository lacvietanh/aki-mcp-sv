#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// A temp data dir, so the call log written below never lands in the owner's ~/.aki/mcpsv.
const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-')));
process.env.AKI_MCP_DATA_DIR = dataDir;
// Removed at exit, not earlier: on Windows the folder is still in use while the bridge is up.
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.error(`temp folder not removed: ${e.message}`); } });
// `node` allowed whole, so the cancel test below has a command that runs long on every OS.
fs.writeFileSync(path.join(dataDir, 'setting.json'), JSON.stringify({ folders: [dataDir], shell: { allowlist: { node: true } } }));
const { handleStreamableMcp } = await import('../scripts/streamable-bridge.js');
const pkgVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const originalConsoleLog = console.log;
const bridgeLogs = [];
console.log = (...args) => {
  bridgeLogs.push(args.map(String).join(' '));
  originalConsoleLog(...args);
};

const server = http.createServer((req, res) => {
  handleStreamableMcp(req, res).catch((error) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  });
});

function initialize(baseUrl, id) {
  return fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'streamable-bridge-regression', version: '1.0.0' },
      },
    }),
  });
}

async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/mcp`;

  try {
    const firstInitialize = await initialize(baseUrl, 1);
    assert.equal(firstInitialize.status, 200);
    const firstSessionId = firstInitialize.headers.get('MCP-Session-Id');
    assert.match(firstSessionId, /^[0-9a-f]{32}$/);
    const firstBody = await firstInitialize.json();
    assert.equal(firstBody.id, 1);
    assert.match(firstBody.result.instructions, /aki__akidevrule_context/);
    assert.equal(firstBody.result.serverInfo?.name, 'aki-mcp');
    assert.equal(firstBody.result.serverInfo?.version, pkgVersion, 'serverInfo carries the package version');
    assert.ok(firstBody.result.capabilities);

    const secondInitialize = await initialize(baseUrl, 2);
    assert.equal(secondInitialize.status, 200);
    const secondSessionId = secondInitialize.headers.get('MCP-Session-Id');
    assert.match(secondSessionId, /^[0-9a-f]{32}$/);
    assert.notEqual(secondSessionId, firstSessionId);
    const secondBody = await secondInitialize.json();
    assert.equal(secondBody.id, 2);
    assert.equal(secondBody.result.instructions, firstBody.result.instructions);
    assert.deepEqual(secondBody.result, firstBody.result);

    const sharedSessionOpenLogs = bridgeLogs.filter((line) =>
      line.includes('shared tools-server session opened'),
    );
    assert.equal(
      sharedSessionOpenLogs.length,
      1,
      'repeated initialize requests must reuse exactly one internal tools-server session',
    );

    const toolsList = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Deliberately mixed case: Node must normalize it for the bridge's lowercase lookup.
        'mCp-SeSsIoN-iD': secondSessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    });
    assert.equal(toolsList.status, 200);
    const response = await toolsList.json();
    assert.equal(response.id, 3);
    assert.ok(Array.isArray(response.result?.tools));
    assert.ok(response.result.tools.length > 0);
    const contextTool = response.result.tools.find((tool) => tool.name === 'aki__akidevrule_context');
    assert.ok(contextTool, 'tools/list must expose the prefixed rule context tool');
    assert.equal(contextTool.title, 'Load Effective Aki/Claude Context');
    assert.match(contextTool.description, /Call once before the first substantive action/);
    assert.equal(contextTool.inputSchema.type, 'object');
    assert.deepEqual(Object.keys(contextTool.inputSchema.properties), ['workingPath', 'mode', 'knownReceipt']);
    // A browser-driving tool call is logged once, with caller and op, never its argument text; a bad op names the stale-schema cause.
    const callTool = (id, args) => fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': secondSessionId, 'User-Agent': 'openai-mcp/1.0 test' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'aki__devtools_eval', arguments: args } }),
    }).then((r) => r.json());
    const bad = await callTool(4, { port: 'not-a-port', expression: 'SECRET_EXPRESSION_TEXT' });
    const badText = bad.error?.message ?? bad.result?.content?.[0]?.text ?? '';
    assert.match(badText, /-32602/);
    assert.match(badText, /tool schema is stale; reconnect AkiMCP/);
    await callTool(5, { port: 1, expression: 'SECRET_EXPRESSION_TEXT' });
    const logged = fs.readFileSync(path.join(dataDir, 'tool-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(logged.length, 2, 'one line per tools/call');
    assert.deepEqual(logged.map((l) => [l.tool, l.client, l.agent, l.ok, l.version]), [
      ['aki__devtools_eval', secondSessionId.slice(0, 8), 'openai-mcp/1.0 test', false, pkgVersion],
      ['aki__devtools_eval', secondSessionId.slice(0, 8), 'openai-mcp/1.0 test', false, pkgVersion],
    ]);
    assert.equal(logged[1].port, 1);
    assert.ok(!JSON.stringify(logged).includes('SECRET_EXPRESSION_TEXT'), 'argument text is never logged');
    // A wrong argument name is the caller's mistake, not a stale schema: the hint names the arguments the tool takes.
    const misnamed = await callTool(6, { port: 1, exprssion: '1' });
    const misnamedText = misnamed.error?.message ?? misnamed.result?.content?.[0]?.text ?? '';
    assert.match(misnamedText, /-32602/);
    assert.match(misnamedText, /aki__devtools_eval takes no exprssion; its arguments are .*expression/);
    assert.doesNotMatch(misnamedText, /schema is stale/);
    // A cancel reaches only the caller's own request: the same request id sent by another client changes nothing, the caller's own cancel ends the wait at once.
    const post = (sessionId, body) => fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': sessionId }, body: JSON.stringify(body) });
    // run_cmd acts, so it carries the rule receipt (scripts/rule-gate.js); without one it would be refused at once instead of running.
    const { receipt } = (await post(secondSessionId, { jsonrpc: '2.0', id: 76, method: 'tools/call', params: { name: 'aki__akidevrule_context', arguments: {} } }).then((r) => r.json())).result.structuredContent;
    // The child records its pid, then runs far longer than the test: a leaked child stays alive and fails the `gone` wait below.
    const pidFile = path.join(dataDir, 'cancelled-child.pid');
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const until = async (check, what) => {
      const deadline = Date.now() + 5000;
      for (let value = await check(); !value; value = await check()) {
        assert.ok(Date.now() < deadline, `${what} not reached within 5 s`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const slow = post(secondSessionId, { jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'aki__run_cmd', arguments: { command: `node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 30000)" ${pidFile}`, receipt } } }).then((r) => r.json());
    await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8'), 'the command started');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    try {
      assert.equal((await post(firstSessionId, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 77 } })).status, 202);
      assert.equal(await Promise.race([slow.then(() => 'answered'), new Promise((r) => setTimeout(() => r('waiting'), 400))]), 'waiting', "another client's cancel must not end this request");
      assert.equal(alive(childPid), true, "another client's cancel must not stop the command");
      assert.equal((await post(secondSessionId, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 77 } })).status, 202);
      const cancelled = await slow;
      assert.equal(cancelled.id, 77);
      assert.match(cancelled.error.message, /cancelled by the client/);
      await until(() => !alive(childPid), 'the cancelled command gone');
    } finally {
      if (alive(childPid)) process.kill(childPid, 'SIGKILL');
    }

    originalConsoleLog(
      `PASS: repeated initialize reused one internal session and tools/list accepted MCP-Session-Id (${response.result.tools.length} tools)`,
    );
  } finally {
    console.log = originalConsoleLog;
    // fetch keeps its keep-alive sockets open; drop them before exit (issue #8: on Windows process.exit with sockets still closing aborts in libuv src/win/async.c).
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

await run();
