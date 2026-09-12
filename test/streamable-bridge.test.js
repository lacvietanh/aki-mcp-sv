#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { handleStreamableMcp } from '../scripts/streamable-bridge.js';

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
    assert.equal(firstBody.result.serverInfo?.version, '2.0.0');
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
    originalConsoleLog(
      `PASS: repeated initialize reused one internal session and tools/list accepted MCP-Session-Id (${response.result.tools.length} tools)`,
    );
  } finally {
    console.log = originalConsoleLog;
    server.close();
    await once(server, 'close');
  }
}

// The bridge intentionally owns a process-lifetime shared InMemoryTransport, so a standalone test exits explicitly after reporting the result instead of changing that production architecture.
run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
