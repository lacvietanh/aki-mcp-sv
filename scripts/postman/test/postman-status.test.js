#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import and exports it as AKI_DATA_DIR: the daemon's runtime files land in a temp dir, never the owner's.
const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'postman-status-test-'));
process.env.AKI_MCP_DATA_DIR = runtimeDir;
writeFileSync(path.join(runtimeDir, 'daemon.pid'), String(process.pid));
writeFileSync(path.join(runtimeDir, 'ownership-status.json'), JSON.stringify({
  daemonPid: process.pid,
  attached: true,
  endpoint: { host: '127.0.0.1', port: 9333, browserIdentity: { kind: 'browser-websocket', browserId: 'browser-1' } },
  ownerTargetId: 'target-a',
  attachedPageCount: 2,
  mode: 'adopted',
  launchProcessPid: null,
}));

const { getDaemonStatus } = await import('../postman-mcp.js');
const attached = getDaemonStatus();
assert.equal(attached.daemonPid, process.pid);
assert.equal(attached.pid, process.pid);
assert.equal(attached.attached, true);
assert.equal(attached.endpoint.port, 9333);
assert.equal(attached.ownerTargetId, 'target-a');
assert.equal(attached.attachedPageCount, 2);
assert.equal(attached.mode, 'adopted');

writeFileSync(path.join(runtimeDir, 'ownership-status.json'), JSON.stringify({ ...attached, daemonPid: process.pid + 1 }));
const stale = getDaemonStatus();
assert.equal(stale.running, true);
assert.equal(stale.attached, false);
assert.equal(stale.ownerTargetId, null);
assert.equal(stale.attachedPageCount, 0);
rmSync(runtimeDir, { recursive: true, force: true });
console.log('postman-status.test.js: ok');
