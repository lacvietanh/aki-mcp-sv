#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  register,
  taskStart,
  taskManage,
  isProcessAlive,
  killProcessGroup,
  readLogTail,
  loadTasks,
  saveTask,
  saveTasks,
  TASK_LOGS_DIR,
} from '../scripts/task-mcp.js';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Testing task-mcp...');

  // 1. Verify McpServer registration
  const server = new McpServer({ name: 'test-tasks', version: '2.0.0' });
  register(server);
  assert.ok(server._registeredTools['task_start'], 'task_start must be registered');
  assert.ok(server._registeredTools['task_manage'], 'task_manage must be registered');

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

  // 5. Test starting an allowlisted command (e.g. "pwd")
  const testId = `test_pwd_${Date.now()}`;
  const startResult = await taskStart({
    command: 'pwd',
    cwd: process.cwd(),
    taskId: testId,
  });

  assert.equal(startResult.taskId, testId);
  assert.ok(startResult.pid > 0);
  assert.equal(startResult.status, 'running');
  assert.ok(fs.existsSync(startResult.logFile));

  // Wait for command to complete
  await sleep(300);

  // 6. Test task_manage: status
  const statusResult = await taskManage({ action: 'status', taskId: testId });
  assert.equal(statusResult.taskId, testId);
  assert.ok(['completed', 'exited'].includes(statusResult.status));
  assert.equal(statusResult.alive, false);
  assert.ok(statusResult.logSize > 0);

  // 7. Test task_manage: tail_logs
  const logOutput = await taskManage({ action: 'tail_logs', taskId: testId });
  assert.ok(typeof logOutput === 'string');
  assert.ok(logOutput.includes(process.cwd()) || logOutput.length > 0);

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

    await sleep(200);
    const afterStopStatus = await taskManage({ action: 'status', taskId: stopTestId });
    assert.equal(afterStopStatus.alive, false);
    assert.equal(afterStopStatus.status, 'stopped');

    await taskManage({ action: 'delete', taskId: stopTestId });
  } finally {
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
