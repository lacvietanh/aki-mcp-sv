#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getBrowserInfo,
  listInstalledBrowsers,
  listProfiles,
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

  // 5. Active session & stop
  assert.equal(typeof getActivePort, 'function');
  assert.equal(typeof getActiveSession, 'function');
  const stopRes = stopChrome();
  assert.ok(stopRes);

  console.log('chrome-profile.test.js: ok');
}

await runTests();
