#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'aki-postman-status-'));
process.env.AKI_POSTMAN_RUNTIME_DIR = runtimeDir;
writeFileSync(path.join(runtimeDir, 'daemon.pid'), String(process.pid));
const daemonPid = (await import('../scripts/aki-pmcontrol/scripts/daemon-pid.js')).default;
mock.method(daemonPid, 'read', () => process.pid);
mock.method(daemonPid, 'live', (pid) => pid === process.pid);

writeFileSync(path.join(runtimeDir, 'ownership-status.json'), JSON.stringify({
  daemonPid: process.pid,
  attached: true,
  endpoint: { host: '127.0.0.1', port: 9333, browserIdentity: { kind: 'browser-websocket', browserId: 'browser-1' } },
  ownerTargetId: 'target-a',
  attachedWindowCount: 2,
  mode: 'adopted',
  launchProcessPid: null,
}));

const { getDaemonStatus } = await import('../scripts/postman-mcp.js');
const attached = getDaemonStatus();
assert.equal(attached.daemonPid, process.pid);
assert.equal(attached.pid, process.pid);
assert.equal(attached.attached, true);
assert.equal(attached.endpoint.port, 9333);
assert.equal(attached.ownerTargetId, 'target-a');
assert.equal(attached.attachedWindowCount, 2);
assert.equal(attached.mode, 'adopted');

writeFileSync(path.join(runtimeDir, 'ownership-status.json'), JSON.stringify({ ...attached, daemonPid: process.pid + 1 }));
const stale = getDaemonStatus();
assert.equal(stale.running, true);
assert.equal(stale.attached, false);
assert.equal(stale.ownerTargetId, null);
assert.equal(stale.attachedWindowCount, 0);
rmSync(runtimeDir, { recursive: true, force: true });
console.log('postman-status.test.js: ok');
