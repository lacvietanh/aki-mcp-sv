#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  getBrowserInfo,
  listInstalledBrowsers,
  listProfiles,
  findAvailableLoopbackPort,
  waitForCdpEndpoint,
  waitForDevToolsActivePort,
  getActivePort,
  getActiveSession,
  stopChrome,
} from '../scripts/chrome-profile.js';

async function runTests() {
  // 1. Browser Info resolution
  const chromeInfo = getBrowserInfo('chrome');
  assert.ok(chromeInfo.name.includes('Chrome'));
  assert.ok(chromeInfo.binary);
  assert.ok(chromeInfo.userDataDir);
  if (process.platform === 'win32' && fs.existsSync(chromeInfo.userDataDir)) {
    assert.ok(fs.existsSync(chromeInfo.binary), `Chrome binary must resolve to an existing file: ${chromeInfo.binary}`);
  }

  const braveInfo = getBrowserInfo('brave');
  assert.ok(braveInfo.name.includes('Brave'));

  const edgeInfo = getBrowserInfo('edge');
  assert.ok(edgeInfo.name.includes('Edge'));

  // 2. Installed browsers detection
  const detected = listInstalledBrowsers();
  assert.ok(Array.isArray(detected));

  // 3. Profiles listing (does not throw)
  const profiles = listProfiles('chrome');
  assert.ok(Array.isArray(profiles));
  if (profiles.length > 0) {
    const p = profiles[0];
    assert.ok(p.id);
    assert.ok(p.name !== undefined);
  }

  // 4. DevToolsActivePort parsing
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-test-port-'));
  try {
    const portPromise = waitForDevToolsActivePort(tmpDir, 3000);
    // Write fake DevToolsActivePort
    fs.writeFileSync(path.join(tmpDir, 'DevToolsActivePort'), '59123\n/devtools/browser/abc-123\n');
    const res = await portPromise;
    assert.equal(res.port, 59123);
    assert.equal(res.wsPath, '/devtools/browser/abc-123');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 5. Explicit CDP endpoint probing does not depend on DevToolsActivePort.
  const availablePort = await findAvailableLoopbackPort();
  assert.ok(Number.isInteger(availablePort) && availablePort > 0);

  const fakeCdp = http.createServer((request, response) => {
    if (request.url !== '/json/version') {
      response.writeHead(404);
      response.end();
      return;
    }
    const address = fakeCdp.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test-browser-id`,
    }));
  });
  await new Promise((resolve, reject) => {
    fakeCdp.once('error', reject);
    fakeCdp.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = fakeCdp.address();
    assert.ok(address && typeof address === 'object');
    const cdp = await waitForCdpEndpoint(address.port, 3000);
    assert.equal(cdp.port, address.port);
    assert.equal(cdp.wsPath, '/devtools/browser/test-browser-id');
  } finally {
    await new Promise((resolve) => fakeCdp.close(resolve));
  }

  // 6. Active session & stop
  assert.equal(typeof getActivePort, 'function');
  assert.equal(typeof getActiveSession, 'function');
  const stopRes = stopChrome();
  assert.ok(stopRes);

  console.log('chrome-profile.test.js: ok');
}

await runTests();
