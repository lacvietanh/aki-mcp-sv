#!/usr/bin/env node
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../scripts/cdp-mcp.js';
import cdp from '../scripts/cdp-engine.js';
import { NO_CDP_PORT_MESSAGE } from '../scripts/chrome-profile.js';
import http from 'node:http';
import { createRequire } from 'node:module';

// ws is chrome-remote-interface's own dependency, resolved from there so the test adds none.
const requireFromCri = createRequire(createRequire(import.meta.url).resolve('chrome-remote-interface'));
const WebSocketServer = requireFromCri('ws').Server;
const protocol = JSON.stringify(requireFromCri('./lib/protocol.json'));

async function testCdpExtensions() {
  assert.equal(typeof cdp.screenshot, 'function');
  assert.equal(typeof cdp.click, 'function');

  // Verify server registers devtools_screenshot and devtools_click
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  register(server);
  assert.ok(server);

  // The attach-to-existing-window path must be spelled out in the error and in every devtools_* description.
  assert.match(NO_CDP_PORT_MESSAGE, /aki__port_status/);
  assert.match(NO_CDP_PORT_MESSAGE, /aki__devtools_targets/);
  for (const name of ['devtools_targets', 'devtools_eval', 'devtools_screenshot']) {
    assert.match(server._registeredTools[name].description, /aki__port_status/, `${name} description must point at aki__port_status`);
  }

  // A page that never answers (frozen tab): evaluate gives up at its own bound with a message naming the cause, instead of hanging until the bridge timeout.
  const frozenHttp = http.createServer((req, res) => res.end(protocol));
  const frozen = new WebSocketServer({ server: frozenHttp });
  await new Promise((resolve) => frozenHttp.listen(0, '127.0.0.1', resolve));
  const { port } = frozenHttp.address();
  const target = { id: 'T-FROZEN', url: 'https://example.com/', title: 'frozen', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/T-FROZEN` };
  const startedAt = Date.now();
  await assert.rejects(cdp.evaluate({ port, target, expression: '1', timeoutMs: 300 }), (e) => {
    assert.match(e.message, /the page did not answer within 0\.3s \(the tab is frozen.*; code timeout; next: the script may have run: check with a short read-only expression before running it again/);
    assert.deepEqual([e.code, e.timedOut], ['timeout', true]);
    return true;
  });
  assert.ok(Date.now() - startedAt < 3000);
  // S7: one call ends within its bound end to end, under the client's ~60 s: 50 s by default, and a screenshot of a frozen tab too.
  assert.equal(cdp.CALL_BOUND_MS, 50_000);
  const shotAt = Date.now();
  await assert.rejects(cdp.screenshot({ port, target, timeoutMs: 300 }), /gave no screenshot within 0\.3s.*code timeout; next: try once more/);
  assert.ok(Date.now() - shotAt < 3000, 'a frozen screenshot ends at its bound');

  // An endpoint that never answers /json/list: finding the target counts against the same bound.
  const silent = http.createServer(() => {});
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const silentPort = silent.address().port;
  const listAt = Date.now();
  await assert.rejects(cdp.evaluate({ port: silentPort, target: 'T-NONE', expression: '1', timeoutMs: 300 }), /the page did not answer within 0\.3s.*code timeout/);
  await assert.rejects(cdp.listTargets({ port: silentPort, timeoutMs: 300 }), /the CDP endpoint 127\.0\.0\.1:\d+ did not answer within 0\.3s; code timeout; next: check the app is running with aki__port_status/);
  assert.ok(Date.now() - listAt < 3000, 'a silent endpoint ends at the bound');
  silent.closeAllConnections();
  await new Promise((resolve) => silent.close(resolve));
  for (const socket of frozen.clients) socket.terminate();
  frozenHttp.closeAllConnections();
  await new Promise((resolve) => frozenHttp.close(resolve));

  console.log('cdp-extensions.test.js: ok');
}

await testCdpExtensions();
