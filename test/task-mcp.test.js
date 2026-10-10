#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  register,
  taskStart,
  taskManage,
  isProcessAlive,
  readLogTail,
} from '../scripts/task-mcp.js';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, what, deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    assert.ok(Date.now() < deadline, `${what} not reached within ${deadlineMs} ms`);
    await sleep(20);
  }
}

async function runTests() {
  console.log('Testing task-mcp...');

  // 1. Verify McpServer registration
  const server = new McpServer({ name: 'test-tasks', version: '2.0.0' });
  register(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const served = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(served.includes('task_start'), 'task_start must be registered');
  assert.ok(served.includes('task_manage'), 'task_manage must be registered');
  await client.close();

  // 2. Test liveness check function
  assert.equal(isProcessAlive(process.pid), true, 'Current process PID must be alive');
  assert.equal(isProcessAlive(999999), false, 'Non-existent PID must not be alive');
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);

  // 3. Test log tailing logic
  const tempLog = path.join(os.tmpdir(), `test-tail-${Date.now()}.log`);
  fs.writeFileSync(tempLog, 'line1\nline2\nline3\nline4\nline5\n', 'utf8');
  try {
    const fullLog = readLogTail(tempLog, 1024);
    assert.equal(fullLog, 'line1\nline2\nline3\nline4\nline5\n');

    const last2Lines = readLogTail(tempLog, 1024, 2);
    assert.equal(last2Lines, 'line4\nline5\n');

    const smallByteTail = readLogTail(tempLog, 10);
    assert.ok(smallByteTail.includes('truncated'));
  } finally {
    try { fs.unlinkSync(tempLog); } catch {}
  }

  // 4. Security gates: disallowed commands & malicious task IDs
  await assert.rejects(
    () => taskStart({ command: 'unauthorized_test_cmd --flag' }),
    /not in the allowlist/,
    'Disallowed command must be rejected by allowlist',
  );

  await assert.rejects(
    () => taskStart({ command: 'ls; whoami' }),
    /command chaining/,
    'Command chaining must be rejected',
  );

  await assert.rejects(
    () => taskStart({ command: 'ls', taskId: '../../evil' }),
    /taskId must only contain alphanumeric/,
    'Path traversal in taskId must be rejected',
  );

  // 4b. A failed spawn must reject with its reason and must not crash the process (regression:
  // the child's 'error' event used to be unhandled, so a missing cwd or a non-executable file
  // killed the whole server). Reaching the next line at all proves the process survived.
  const missingCwd = path.join(os.homedir(), `missing-cwd-${Date.now()}`);
  await assert.rejects(
    () => taskStart({ command: 'node -v', cwd: missingCwd, taskId: `test_badcwd_${Date.now()}` }),
    /Failed to spawn background task process: ENOENT/,
    'A missing cwd must be reported, not crash the server',
  );
  await sleep(200);

  // 5. Starting an allowlisted command under the allowed roots. `node -v` is in the default allowlist, is an executable on every OS, and prints a known line.
  const testId = `test_nodev_${Date.now()}`;
  const expectedOutput = `${process.version}\n`;
  const startResult = await taskStart({
    command: 'node -v',
    cwd: os.homedir(),
    taskId: testId,
  });

  assert.equal(startResult.taskId, testId);
  assert.ok(startResult.pid > 0);
  assert.equal(startResult.status, 'running');
  assert.ok(fs.existsSync(startResult.logFile));

  // 6. Test task_manage: status
  const statusResult = await waitFor(async () => {
    const status = await taskManage({ action: 'status', taskId: testId });
    return status.status !== 'running' && status;
  }, 'the finished task status');
  assert.equal(statusResult.taskId, testId);
  assert.equal(statusResult.status, 'completed');
  assert.equal(statusResult.alive, false);
  assert.equal(statusResult.logSize, Buffer.byteLength(expectedOutput));

  // 7. Test task_manage: tail_logs
  assert.equal(await taskManage({ action: 'tail_logs', taskId: testId }), expectedOutput);

  // 8. Test task_manage: stop with a long-running process
  const stopTestId = `test_stop_${Date.now()}`;
  const dummyFile = path.join(os.tmpdir(), `dummy-${Date.now()}.txt`);
  fs.writeFileSync(dummyFile, 'hello\n');
  try {
    const longTask = await taskStart({
      command: `tail -f ${dummyFile}`,
      taskId: stopTestId,
    });
    assert.equal(longTask.status, 'running');
    const runningStatus = await taskManage({ action: 'status', taskId: stopTestId });
    assert.equal(runningStatus.alive, true);

    const stopRes = await taskManage({ action: 'stop', taskId: stopTestId });
    assert.equal(stopRes.stopped, true);
    assert.equal(stopRes.wasAlive, true);

    await waitFor(() => !isProcessAlive(longTask.pid), 'the stopped process exit');
    const afterStopStatus = await taskManage({ action: 'status', taskId: stopTestId });
    assert.equal(afterStopStatus.alive, false);
    assert.equal(afterStopStatus.status, 'stopped');

    await taskManage({ action: 'delete', taskId: stopTestId });
  } finally {
    await taskManage({ action: 'stop', taskId: stopTestId }).catch(() => {});
    try { fs.unlinkSync(dummyFile); } catch {}
  }

  // 9. Test task_manage: list
  const listResult = await taskManage({ action: 'list' });
  assert.ok(Array.isArray(listResult));
  const found = listResult.find((t) => t.taskId === testId);
  assert.ok(found, 'Task must appear in task list');

  // 10. Test task_manage: delete
  const delResult = await taskManage({ action: 'delete', taskId: testId });
  assert.equal(delResult.deleted, true);
  const afterDeleteList = await taskManage({ action: 'list' });
  assert.ok(!afterDeleteList.find((t) => t.taskId === testId), 'Task must be removed after delete');

  console.log('task-mcp.test.js: ok');
}

await runTests();
