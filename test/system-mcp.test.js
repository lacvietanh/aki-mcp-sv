#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import cp from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { register, notifyUser, clipboardRead, clipboardWrite } from '../scripts/system-mcp.js';

async function runTests() {
  // Hermetic: mock execFile so this never touches the real clipboard/notification bridge — CI has no pbcopy/xclip/notify-send, and a real ENOENT there would crash before our own error handling runs.
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
    const call = { cmd, args, stdin: '' };
    spawnCalls.push(call);
    return {
      stdin: { write: (t) => { call.stdin += t; }, end() {} },
      on(event, handler) {
        if (event === 'close') setImmediate(() => handler(0));
        return this;
      },
    };
  });

  // 2. clipboardWrite spawns the platform clipboard writer without touching real OS state
  await clipboardWrite('aki-test-payload');
  assert.equal(spawnCalls.length, 1, 'clipboardWrite spawns one clipboard writer');
  assert.equal(spawnCalls[0].stdin, 'aki-test-payload', 'the payload reaches the writer on stdin');

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

  // 4b. A failed notifier never reads as delivered (A15): linux throws with a next step, win32 beep says notified:false.
  const enoent = Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' });
  cp.execFile.mock.mockImplementation((file, args, options, cb) => cb(enoent));
  await assert.rejects(notifyUser({ message: 'hi' }, 'linux'), /notify-send failed: .*\(no_notifier; next: install libnotify .*give the message in chat\)/);
  let calls = 0;
  cp.execFile.mock.mockImplementation((file, args, options, cb) => (calls++ === 0 ? cb(enoent) : cb(null, '', '')));
  const beeped = await notifyUser({ message: 'hi' }, 'win32');
  assert.equal(calls, 2, 'toast tried, then the beep');
  assert.equal(beeped.notified, false);
  assert.equal(beeped.fallback, 'beep');
  assert.match(beeped.next, /give the message in chat/);
  cp.execFile.mock.mockImplementation((file, args, options, cb) => cb(null, '', ''));
  for (const os of ['darwin', 'win32', 'linux']) assert.equal((await notifyUser({ message: 'hi' }, os)).notified, true, `${os} success stays notified:true`);

  // 5. Test McpServer tool registration
  const server = new McpServer({ name: 'test-system', version: '2.0.0' });
  register(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const served = (await client.listTools()).tools.map((t) => t.name);
  for (const name of ['notify_user', 'clipboard_read', 'clipboard_write']) assert.ok(served.includes(name), `${name} must be registered`);
  await client.close();

  console.log('system-mcp.test.js: ok');
}

await runTests();
