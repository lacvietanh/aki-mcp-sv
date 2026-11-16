#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { register } from '../scripts/cdp-mcp.js';
import cdp from '../scripts/cdp-engine.js';
import { NO_CDP_PORT_MESSAGE } from '../scripts/chrome-profile.js';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// ws is chrome-remote-interface's own dependency, resolved from there so the test adds none.
const requireFromCri = createRequire(createRequire(import.meta.url).resolve('chrome-remote-interface'));
const WebSocketServer = requireFromCri('ws').Server;
const protocol = JSON.stringify(requireFromCri('./lib/protocol.json'));

async function testCdpExtensions() {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  register(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));

  // The attach-to-existing-window path must be spelled out in the error and in every devtools_* description.
  assert.match(NO_CDP_PORT_MESSAGE, /aki__port_status/);
  assert.match(NO_CDP_PORT_MESSAGE, /aki__devtools_targets/);
  for (const name of ['devtools_targets', 'devtools_eval', 'devtools_screenshot']) {
    assert.match(tools.get(name).description, /aki__port_status/, `${name} description must point at aki__port_status`);
  }

  // A page that never answers (frozen tab): evaluate gives up at its own bound with a message naming the cause, instead of hanging until the bridge timeout.
  const frozenHttp = http.createServer((req, res) => res.end(protocol));
  const frozen = new WebSocketServer({ server: frozenHttp });
  await new Promise((resolve) => frozenHttp.listen(0, '127.0.0.1', resolve));
  const { port } = frozenHttp.address();
  const target = { id: 'T-FROZEN', url: 'https://example.com/', title: 'frozen', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/T-FROZEN` };
  const startedAt = Date.now();
  await assert.rejects(cdp.evaluate({ port, target, expression: '1', timeoutMs: 50 }), (e) => {
    assert.match(e.message, /the page did not answer within 0\.05s \(the tab is frozen.*; code timeout; next: the script may have run: check with a short read-only expression before running it again/);
    assert.deepEqual([e.code, e.timedOut], ['timeout', true]);
    return true;
  });
  assert.ok(Date.now() - startedAt < 3000);
  // One call ends within its bound end to end, under the client's ~60 s: 50 s by default, and a screenshot of a frozen tab too.
  assert.equal(cdp.CALL_BOUND_MS, 50_000);
  const shotAt = Date.now();
  await assert.rejects(cdp.screenshot({ port, target, timeoutMs: 50 }), /gave no screenshot within 0\.05s.*code timeout; next: try once more/);
  assert.ok(Date.now() - shotAt < 3000, 'a frozen screenshot ends at its bound');

  // An endpoint that never answers /json/list: finding the target counts against the same bound.
  const silent = http.createServer(() => {});
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const silentPort = silent.address().port;
  const listAt = Date.now();
  await assert.rejects(cdp.evaluate({ port: silentPort, target: 'T-NONE', expression: '1', timeoutMs: 50 }), (e) => {
    assert.match(e.message, /the CDP endpoint 127\.0\.0\.1:\d+ did not answer within 0\.05s; code timeout/);
    assert.doesNotMatch(e.message, /may have run/);
    return true;
  });
  await assert.rejects(cdp.listTargets({ port: silentPort, timeoutMs: 50 }), /the CDP endpoint 127\.0\.0\.1:\d+ did not answer within 0\.05s; code timeout; next: check the app is running with aki__port_status/);
  assert.ok(Date.now() - listAt < 3000, 'a silent endpoint ends at the bound');
  silent.closeAllConnections();
  await new Promise((resolve) => silent.close(resolve));
  for (const socket of frozen.clients) socket.terminate();
  frozenHttp.closeAllConnections();
  await new Promise((resolve) => frozenHttp.close(resolve));

  await client.close();
  console.log('cdp-extensions.test.js: ok');
}

// Two CDP clients on one tab (IMPORTANT-shared-cdp-profiles.md): a call leaves a client already on the tab connected.
async function testCallsLeaveOtherClientsOnTheTab() {
  const pageHttp = http.createServer((req, res) => res.end(protocol));
  const page = new WebSocketServer({ server: pageHttp });
  const connections = [];
  page.on('connection', (socket) => {
    const seen = { methods: [], closed: new Promise((resolve) => socket.on('close', resolve)) };
    connections.push(seen);
    socket.on('message', (raw) => {
      const { id, method } = JSON.parse(raw);
      seen.methods.push(method);
      const result = method === 'Runtime.evaluate' ? { result: { type: 'number', value: 2 } } : method === 'Page.captureScreenshot' ? { data: 'iVBORw0KGgo=' } : {};
      socket.send(JSON.stringify({ id, result }));
    });
  });
  await new Promise((resolve) => pageHttp.listen(0, '127.0.0.1', resolve));
  const { port } = pageHttp.address();
  const target = { id: 'T-SHARED', url: 'https://claude.ai/chat/x', title: 'shared', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/T-SHARED` };

  const WebSocket = requireFromCri('ws');
  const watcher = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { watcher.once('open', resolve); watcher.once('error', reject); });
  const ask = (id, method) => new Promise((resolve) => {
    watcher.once('message', (raw) => resolve(JSON.parse(raw)));
    watcher.send(JSON.stringify({ id, method, params: {} }));
  });
  assert.equal((await ask(1, 'Network.enable')).id, 1);

  assert.equal((await cdp.evaluate({ port, target, expression: '1 + 1' })).value, 2);
  assert.equal((await cdp.screenshot({ port, target })).data, 'iVBORw0KGgo=');
  const [, evaluated, shot] = connections;
  assert.equal(connections.length, 3, 'one connection per call, beside the watcher');
  assert.deepEqual(evaluated.methods, ['Runtime.enable', 'Runtime.evaluate']);
  assert.deepEqual(shot.methods, ['Page.enable', 'Page.captureScreenshot']);
  await Promise.all([evaluated.closed, shot.closed]);
  assert.equal(watcher.readyState, WebSocket.OPEN, 'the watcher keeps its connection');
  assert.equal((await ask(2, 'Runtime.evaluate')).id, 2, 'and still gets answers');
  assert.deepEqual(connections[0].methods, ['Network.enable', 'Runtime.evaluate']);

  watcher.terminate();
  for (const socket of page.clients) socket.terminate();
  pageHttp.closeAllConnections();
  await new Promise((resolve) => pageHttp.close(resolve));
  console.log('cdp-extensions.test.js: shared tab ok');
}

// chrome_interact type runs its page expression against a stub document: only an input or textarea takes a value.
function testTypeNeedsATextField() {
  const run = (tagName, value, args) => {
    const el = { tagName, value, form: null, scrollIntoView() {}, focus() {}, dispatchEvent() {} };
    class Ev { constructor(type, init) { this.type = type; Object.assign(this, init); } }
    const document = { querySelector: () => el };
    return vm.runInNewContext(cdp.typeExpression({ selector: '#f', ...args }), { document, Event: Ev, KeyboardEvent: Ev });
  };
  for (const tag of ['DIV', 'BUTTON', 'SELECT', 'A']) {
    assert.throws(() => run(tag, undefined, { text: 'hi' }), new RegExp(`Element <${tag.toLowerCase()}> is not a text field: typing needs an input or textarea`), `${tag} is refused`);
  }
  const typedInto = (tag, value, args) => { const r = run(tag, value, args); return [r.typed, r.tagName, r.valueLength]; };
  assert.deepEqual(typedInto('INPUT', 'abc', { text: 'xy' }), [true, 'INPUT', 5]);
  assert.deepEqual(typedInto('TEXTAREA', 'abc', { text: 'xy' }), [true, 'TEXTAREA', 5]);
  assert.deepEqual(typedInto('INPUT', 'abc', { text: 'xy', clear: true }), [true, 'INPUT', 2], 'clear replaces what was there');
  assert.throws(() => vm.runInNewContext(cdp.typeExpression({ selector: '#f', text: 'x' }), { document: { querySelector: () => null } }), /Element not found for selector: #f/);
  console.log('cdp-extensions.test.js: type ok');
}

await testCdpExtensions();
await testCallsLeaveOtherClientsOnTheTab();
testTypeNeedsATextField();
