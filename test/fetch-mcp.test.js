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
  for (const host of ['[fe80::1]', '[FE80::1]', '[febf::1]', '[::ffff:a9fe:a9fe]', '[fd00:ec2::254]', '169.254.169.254.', 'Metadata.Google.Internal']) {
    assert.equal(isBlockedHost(host), true, `${host} is blocked`);
  }
  for (const host of ['[::1]', '[fd7a:115c:a1e0::1]', '[2001:db8::1]']) {
    assert.equal(isBlockedHost(host), false, `${host} stays reachable`);
  }
  await assert.rejects(() => executeFetch({ url: 'http://[::ffff:169.254.169.254]/latest/meta-data/' }), /Access to link-local\/cloud-metadata host/i);
  await assert.rejects(() => executeFetch({ url: 'http://[fe80::1]/' }), /Access to link-local\/cloud-metadata host/i);

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
    if (req.url === '/to-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    if (req.url === '/hop') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
      return res.end();
    }
    if (req.url === '/see-other') {
      res.writeHead(303, { Location: '/method' });
      return res.end();
    }
    if (req.url === '/method') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(req.method);
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('x'.repeat(2 * 1024 * 1024));
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

    // Redirects: followed on the same host, re-checked on every hop, bounded
    const hopRes = await executeFetch({ url: `http://127.0.0.1:${port}/hop` });
    assert.equal(hopRes.data, 'hello from local');
    assert.equal(hopRes.url, `http://127.0.0.1:${port}/`);
    await assert.rejects(() => executeFetch({ url: `http://127.0.0.1:${port}/to-metadata` }), /Access to link-local\/cloud-metadata host/i, 'a redirect to a blocked host is refused');
    await assert.rejects(() => executeFetch({ url: `http://127.0.0.1:${port}/loop` }), /Too many redirects/);
    const seeOther = await executeFetch({ url: `http://127.0.0.1:${port}/see-other`, method: 'POST', body: { a: 1 } });
    assert.equal(seeOther.data, 'GET', 'a 303 turns the follow-up into a GET');

    // Size cap: reading stops at 512 KB
    const big = await executeFetch({ url: `http://127.0.0.1:${port}/big` });
    assert.equal(big.truncated, true);
    assert.equal(big.data.length, 512 * 1024);
    assert.ok(big.bytesReceived < 2 * 1024 * 1024, 'the rest of the body is not read');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  // 5. Tool registration in McpServer
  const mcp = new McpServer({ name: 'test-fetch', version: '2.0.0' });
  register(mcp);
  assert.ok(mcp._registeredTools['local_fetch']);

  console.log('fetch-mcp.test.js: ok');
}

await runTests();
