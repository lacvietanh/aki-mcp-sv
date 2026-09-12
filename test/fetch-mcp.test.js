#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register, executeFetch, isBlockedHost } from '../scripts/fetch-mcp.js';

async function runTests() {
  // 1. SSRF block patterns
  assert.equal(isBlockedHost('169.254.169.254'), true);
  assert.equal(isBlockedHost('169.254.1.1'), true);
  assert.equal(isBlockedHost('metadata.google.internal'), true);
  assert.equal(isBlockedHost('localhost'), false);
  assert.equal(isBlockedHost('127.0.0.1'), false);
  assert.equal(isBlockedHost('192.168.1.100'), false);

  // 2. Protocol block
  await assert.rejects(
    () => executeFetch({ url: 'file:///etc/passwd' }),
    /Forbidden protocol/i,
  );

  // 3. Cloud metadata block
  await assert.rejects(
    () => executeFetch({ url: 'http://169.254.169.254/latest/meta-data/' }),
    /Access to link-local\/cloud-metadata host/i,
  );

  // 4. Test actual local fetch with a mini loopback server
  const server = http.createServer((req, res) => {
    if (req.url === '/api/test' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: JSON.parse(body), ok: true }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('hello from local');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // GET test
    const getRes = await executeFetch({ url: `http://127.0.0.1:${port}/` });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data, 'hello from local');
    assert.equal(getRes.isJson, false);

    // POST JSON test
    const postRes = await executeFetch({
      url: `http://127.0.0.1:${port}/api/test`,
      method: 'POST',
      body: { msg: 'ping' },
    });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.isJson, true);
    assert.equal(postRes.data.received.msg, 'ping');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 5. Tool registration in McpServer
  const mcp = new McpServer({ name: 'test-fetch', version: '2.0.0' });
  register(mcp);
  assert.ok(mcp._registeredTools['local_fetch']);

  console.log('fetch-mcp.test.js: ok');
}

await runTests();
