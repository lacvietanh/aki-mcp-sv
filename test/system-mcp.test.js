#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import cp from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register, notifyUser, clipboardRead, clipboardWrite } from '../scripts/system-mcp.js';

async function runTests() {
  // 1. Verify functions exist
  assert.equal(typeof notifyUser, 'function');
  assert.equal(typeof clipboardRead, 'function');
  assert.equal(typeof clipboardWrite, 'function');

  // Hermetic: mock execFile/spawn so this never touches the real OS clipboard/notification
  // bridge — a CI runner has no pbcopy/xclip/wl-copy/notify-send, and a real spawn there
  // throws before the module's own error handling can run (real ENOENT crashes the process).
  const execCalls = [];
  mock.method(cp, 'execFile', (file, args, options, cb) => {
    execCalls.push({ file, args, options });
    cb(null, 'aki-test-payload\n', '');
  });
  mock.method(cp, 'exec', () => {
    throw new Error('system-mcp must not run a shell command line');
  });

  const spawnCalls = [];
  mock.method(cp, 'spawn', (cmd, args = []) => {
    spawnCalls.push({ cmd, args });
    let data = '';
    return {
      stdin: { write: (t) => { data += t; }, end() {} },
      on(event, handler) {
        if (event === 'close') setImmediate(() => handler(0));
        return this;
      },
    };
  });

  // 2. clipboardWrite spawns the platform clipboard writer without touching real OS state
  await clipboardWrite('aki-test-payload');
  assert.ok(spawnCalls.length >= 1, 'clipboardWrite must spawn a clipboard writer');

  // 3. clipboardRead resolves via the mocked execFile, not a real system call
  const readBack = await clipboardRead();
  assert.equal(readBack.text.trim(), 'aki-test-payload');

  // 4. notifyUser hands the text over as data: no shell, and never spliced into the script
  execCalls.length = 0;
  const hostile = `x'; touch /tmp/aki-pwned; echo ' "q" $(id) \`id\``;
  const sent = await notifyUser({ message: hostile, title: hostile, sound: false });
  assert.equal(sent.message, hostile, 'the message is returned as given');
  assert.equal(execCalls.length, 1);
  const [{ args, options }] = execCalls;
  const carried = process.platform === 'win32' ? [options.env.AKI_NOTIFY_MESSAGE, options.env.AKI_NOTIFY_TITLE] : args.slice(-2);
  assert.deepEqual(carried, [hostile, hostile], 'title and message travel as whole values');
  const script = process.platform === 'win32' ? args : args.slice(0, -2);
  assert.ok(script.every((a) => !a.includes('aki-pwned')), 'no script or flag contains the text');

  // 5. Test McpServer tool registration
  const server = new McpServer({ name: 'test-system', version: '2.0.0' });
  register(server);

  assert.ok(server._registeredTools['notify_user']);
  assert.ok(server._registeredTools['clipboard_read']);
  assert.ok(server._registeredTools['clipboard_write']);

  console.log('system-mcp.test.js: ok');
}

await runTests();
