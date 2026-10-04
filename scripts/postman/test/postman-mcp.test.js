#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import: an empty temp data dir, so no real daemon.pid/data.json/ownership file of the owner's can leak in.
process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'postman-mcp-test-'));
const { register, getDaemonStatus } = await import('../postman-mcp.js');
const { ROUTES } = await import('../../panel.js');
const { default: daemonPid } = await import('../postman-daemon-pid.cjs');

// Hermetic: neutralize the real on-disk daemon pid file so a daemon actually running on this machine (e.g. one serving a live session) cannot leak into the baseline. cp.spawn is mocked below for the same reason — the test asserts the module's own behavior, not ambient machine state.
mock.method(daemonPid, 'read', () => null);

// Read-only by default: importing/registering the tool must never spawn or assume a daemon.
let handler;
register({ registerTool: (name, _def, fn) => { if (name === 'postman_status') handler = fn; } });
assert.ok(handler, 'postman_status tool must be registered');
const before = JSON.parse((await handler()).content[0].text);
assert.equal(before.running, false, 'importing the module must not spawn or assume a daemon');
assert.equal(before.pid, null);

// Mocked so no real process (and never real Postman) launches from this test. `kill` mirrors Node's real ChildProcess: `.killed` flips and `exitCode` settles, which is what the quit handler waits for before returning stopped.
let killCount = 0;
const spawnMock = mock.method(cp, 'spawn', () => ({
  pid: 4242,
  exitCode: null,
  killed: false,
  on() { return this; },
  off() { return this; },
  kill() { killCount += 1; this.killed = true; this.exitCode = 0; return true; },
}));

const first = await ROUTES['POST /api/postman-launch']();
assert.equal(first.running, true);
assert.equal(first.pid, 4242);
assert.equal(spawnMock.mock.calls.length, 1, 'POST /api/postman-launch must spawn the daemon');
assert.equal(killCount, 0, 'launch must not kill');

const second = await ROUTES['POST /api/postman-launch']();
assert.equal(second.running, true);
assert.equal(second.pid, 4242);
assert.equal(spawnMock.mock.calls.length, 1, 'a live daemon must not be spawned twice');
assert.match(second.message, /already running/);

assert.deepEqual(getDaemonStatus().pid, 4242);

const quit = await ROUTES['POST /api/postman-quit']();
assert.equal(quit.running, false, 'quit handler must return not-running only after kill');
assert.equal(quit.pid, null);
assert.equal(killCount, 1, 'POST /api/postman-quit must kill the spawned child');
assert.equal(getDaemonStatus().running, false, 'status must be not-running right after quit');
assert.equal(getDaemonStatus().pid, null);

const idle = await ROUTES['POST /api/postman-quit']();
assert.equal(idle.running, false);
assert.equal(idle.pid, null);
assert.equal(killCount, 1, 'quit when not running must not fake a kill');
assert.equal(spawnMock.mock.calls.length, 1);
fs.rmSync(process.env.AKI_MCP_DATA_DIR, { recursive: true, force: true });

console.log('postman-mcp.test.js: ok');
