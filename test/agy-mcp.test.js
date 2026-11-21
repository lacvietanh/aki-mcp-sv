#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Isolate HOME, AKI_MCP_DATA_DIR and PATH before importing AkiMCP modules.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-test-')));
const homeDir = path.join(tmp, 'home');
const dataDir = path.join(tmp, 'data');
const binDir = path.join(tmp, 'bin');
const workDir = path.join(tmp, 'work');
for (const d of [homeDir, dataDir, binDir, workDir]) fs.mkdirSync(d, { recursive: true });

const tierDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'aki-plan-tier');
fs.mkdirSync(tierDir, { recursive: true });
fs.writeFileSync(path.join(tierDir, 'pro@example.com'), 'Google AI Pro\n');
fs.writeFileSync(path.join(tierDir, 'starter@example.com'), 'Antigravity Starter Quota\n');

const stateFile = path.join(tmp, 'fake-agy-state.json');
const countsFile = path.join(tmp, 'fake-agy-counts.json');
const lastArgsFile = path.join(tmp, 'fake-agy-last-args.json');

const writeState = (s) => fs.writeFileSync(stateFile, JSON.stringify(s));
const readCounts = () => (fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, 'utf8')) : { models: 0, usage: 0, runs: 0 });
const resetCounts = () => fs.writeFileSync(countsFile, JSON.stringify({ models: 0, usage: 0, runs: 0 }));

const fakeAgyJs = path.join(binDir, 'agy-impl.cjs');
fs.writeFileSync(fakeAgyJs, "const fs = require('node:fs');\nconst state = JSON.parse(fs.readFileSync(process.env.FAKE_AGY_STATE, 'utf8'));\nconst countsPath = process.env.FAKE_AGY_COUNTS;\nconst counts = fs.existsSync(countsPath) ? JSON.parse(fs.readFileSync(countsPath, 'utf8')) : { models: 0, usage: 0, runs: 0 };\nconst bump = (k) => { counts[k] = (counts[k] || 0) + 1; fs.writeFileSync(countsPath, JSON.stringify(counts)); };\nconst args = process.argv.slice(2);\nconst logIdx = args.indexOf('--log-file');\nif (logIdx !== -1 && args[logIdx + 1] && state.account) {\n  fs.writeFileSync(args[logIdx + 1], 'I1121 22:22:28.867 1 server_oauth.go:226] OAuth: authenticated successfully as ' + state.account + '\\n');\n}\nif (args[0] === '--version') { process.stdout.write('1.5.14\\n'); process.exit(0); }\nif (args[0] === 'models') {\n  bump('models');\n  process.stderr.write('Fetching available models...\\n');\n  const rows = state.account === 'pro@example.com'\n    ? ['gemini-4-neon-high\\tGemini 4 Neon (High)', 'gemini-3.8-flash-high\\tGemini 3.8 Flash (High)', 'gemini-3.8-flash-medium\\tGemini 3.8 Flash (Medium)']\n    : ['gemini-3.8-flash-high\\tGemini 3.8 Flash (High)', 'gemini-3.8-flash-medium\\tGemini 3.8 Flash (Medium)'];\n  process.stdout.write(rows.join('\\n') + '\\n');\n  process.exit(0);\n}\nif (args[0] === '--help') {\n  process.stdout.write(['  --effort   Reasoning effort (low|medium|high|xhigh|max)', '  --mode     Execution mode (accept-edits, auto, plan)', '  --output-format Output format (text, json, stream-json)', '  --print-timeout Timeout (default 0s)'].join('\\n') + '\\n');\n  process.exit(0);\n}\nconst pIdx = args.indexOf('-p');\nconst prompt = pIdx !== -1 ? args[pIdx + 1] : '';\nif (prompt === '/usage') {\n  bump('usage');\n  process.stdout.write(JSON.stringify({ status: 'SUCCESS', usage: { total_tokens: 0 }, command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.9, reset_time: '2026-11-28T12:00:00Z' }] }] } } }));\n  process.exit(0);\n}\nbump('runs');\nfs.writeFileSync(process.env.FAKE_AGY_LAST_ARGS, JSON.stringify(args));\nif (state.mode === 'sleep') {\n  setTimeout(() => { process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'woke up', duration_seconds: 1, num_turns: 1, usage: { total_tokens: 5 } })); process.exit(0); }, state.sleepMs || 15000);\n  return;\n}\nif (state.mode === 'empty') { process.stderr.write('permission denied\\n'); process.exit(0); }\nif (state.mode === 'bg_json') {\n  process.stderr.write('Fetching available models...\\nAPI_KEY=supersecretvalue12345\\n');\n  setTimeout(() => { process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'detailed analysis result', duration_seconds: 12, num_turns: 3, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } })); process.exit(0); }, 150);\n  return;\n}\nprocess.stdout.write('sync-ok:' + prompt);\n");

const agyBin = path.join(binDir, 'agy');
fs.writeFileSync(agyBin, '#!' + process.execPath + '\nrequire(' + JSON.stringify(fakeAgyJs) + ');\n', { mode: 0o755 });
fs.writeFileSync(path.join(binDir, 'agy.cmd'), '@"' + process.execPath + '" "' + fakeAgyJs + '" %*\r\n');

fs.writeFileSync(path.join(dataDir, 'setting.json'), JSON.stringify({
  folders: [tmp],
  providers: { agy: { enabled: true }, task: { enabled: true } },
}));

const prevEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  AKI_MCP_DATA_DIR: process.env.AKI_MCP_DATA_DIR,
  PATH: process.env.PATH,
};
process.env.HOME = process.env.USERPROFILE = homeDir;
process.env.AKI_MCP_DATA_DIR = dataDir;
process.env.PATH = binDir + path.delimiter + process.env.PATH;
process.env.FAKE_AGY_STATE = stateFile;
process.env.FAKE_AGY_COUNTS = countsFile;
process.env.FAKE_AGY_LAST_ARGS = lastArgsFile;

const { createToolsServer } = await import('../scripts/tools-server.js');
const { setEnabled } = await import('../scripts/provider-registry.js');
const { resetCache, resetUsageCache } = await import('../scripts/agy-capabilities.js');

const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'agy-mcp-test', version: '1' });
await client.connect(clientSide);

const { receipt } = (await client.callTool({ name: 'aki__akidevrule_context', arguments: {} })).structuredContent;
const callAgy = (args) => client.callTool({ name: 'aki__agy_run', arguments: { cwd: workDir, ...args } });
const callManage = (args) => client.callTool({ name: 'aki__task_manage', arguments: { ...args, receipt } });
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitExited(taskId, maxMs = 4000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const list = JSON.parse(textOf(await callManage({ action: 'list' })));
    const row = list.find((t) => t.taskId === taskId);
    if (row && !row.alive) return row;
    await sleep(60);
  }
  throw new Error('task ' + taskId + ' did not exit within ' + maxMs + 'ms');
}

const activeTaskIds = [];
try {
  // 1. B5a: list="capabilities" returns account, planTier, quota, Flash high default, and probes models ONCE (no double-spawn).
  resetCache();
  resetCounts();
  writeState({ account: 'pro@example.com', mode: 'sync' });
  const listRes = await callAgy({ list: 'capabilities' });
  assert.ok(!listRes.isError, textOf(listRes));
  const caps = JSON.parse(textOf(listRes));
  assert.equal(caps.account, 'pro@example.com');
  assert.equal(caps.planTier, 'Google AI Pro');
  assert.equal(caps.resolvedDefaultModel, 'gemini-3.8-flash-high');
  assert.equal(caps.quota.source, 'live');
  assert.equal(caps.quota.groups[0].buckets[0].remainingFraction, 0.9);
  assert.equal(readCounts().models, 1, 'list must probe models exactly once (B5a)');

  // 2. Plan-mismatch check on Starter account blocks before spawning agy prompt.
  resetCache();
  resetCounts();
  writeState({ account: 'starter@example.com', mode: 'sync' });
  const mismatch = await callAgy({ prompt: 'review arch', model: 'gemini-4-neon-high' });
  assert.equal(mismatch.isError, true);
  assert.match(textOf(mismatch), /Antigravity Starter Quota/);
  assert.match(textOf(mismatch), /gemini-4-neon-high/);
  assert.match(textOf(mismatch), /Google AI Pro/);
  assert.equal(readCounts().runs, 0, 'plan mismatch must reject before spawning prompt');

  // 3. B2: Switching Pro -> Starter inside 1h cache window (without clearing account cache) blocks background=true before spawn.
  resetCache();
  resetCounts();
  writeState({ account: 'pro@example.com', mode: 'bg_json' });
  const warmPro = await callAgy({ list: 'models' });
  assert.ok(!warmPro.isError, textOf(warmPro));
  // Switch live account to Starter and expire only the 30s /usage micro-TTL (Pro's 1h account cache remains warm).
  writeState({ account: 'starter@example.com', mode: 'bg_json' });
  resetUsageCache();
  const bgMismatch = await callAgy({ prompt: 'long research', model: 'gemini-4-neon-high', background: true });
  assert.equal(bgMismatch.isError, true);
  assert.match(textOf(bgMismatch), /Antigravity Starter Quota/);
  assert.equal(readCounts().runs, 0, 'background=true must catch Pro->Starter switch and block before spawn (B2)');

  // 4. Q1: Refuses background=true when task provider is disabled, naming panel section 4 and sync timeoutSec.
  writeState({ account: 'pro@example.com', mode: 'bg_json' });
  resetUsageCache();
  setEnabled('task', false);
  const noTask = await callAgy({ prompt: 'long research', background: true });
  assert.equal(noTask.isError, true);
  assert.match(textOf(noTask), /section 4/);
  assert.match(textOf(noTask), /timeoutSec/);
  assert.equal(readCounts().runs, 0);
  setEnabled('task', true);

  // 5. Sync timeoutSec > 600 rejected cleanly.
  const tooLong = await callAgy({ prompt: 'hello', timeoutSec: 900 });
  assert.equal(tooLong.isError, true);
  assert.match(textOf(tooLong), /600s/);
  assert.match(textOf(tooLong), /background=true/);

  // 6. background=true happy path: separate stdout/stderr, --print-timeout 1800, -p last, N2 no prompt in tasks.json, B4a lazy summary after list(), B4c redacted errTail, delete cleans both logs.
  resetCache();
  resetCounts();
  writeState({ account: 'pro@example.com', mode: 'bg_json' });
  const secretPrompt = 'SENSITIVE_LONG_PROMPT_MARKER_DO_NOT_STORE_IN_TASKS_JSON';
  const startedRes = await callAgy({ prompt: secretPrompt, background: true });
  assert.ok(!startedRes.isError, textOf(startedRes));
  const started = JSON.parse(textOf(startedRes));
  activeTaskIds.push(started.taskId);
  assert.equal(started.outputFormat, 'json');
  assert.equal(started.printTimeoutSec, 1800);
  assert.ok(started.errLogFile);

  // N2: prompt text must NOT appear in tasks.json.
  const tasksJsonRaw = fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8');
  assert.ok(!tasksJsonRaw.includes(secretPrompt), 'tasks.json must not store raw prompt text (N2)');
  assert.match(tasksJsonRaw, /prompt: 55 chars/);

  // Wait via action="list" first (simulates B4a: list flips status to exited before status is called!).
  await waitExited(started.taskId);

  // Verify fake agy got --print-timeout 1800 and -p <prompt> last.
  const passedArgs = JSON.parse(fs.readFileSync(lastArgsFile, 'utf8'));
  const ptIdx = passedArgs.indexOf('--print-timeout');
  assert.ok(ptIdx !== -1 && passedArgs[ptIdx + 1] === '1800', 'background=true must pass --print-timeout 1800');
  assert.equal(passedArgs[passedArgs.length - 2], '-p');
  assert.equal(passedArgs[passedArgs.length - 1], secretPrompt);

  // Simulate post-restart lazy extract after list() already flipped status to exited (B4a).
  const tasksOnDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'));
  delete tasksOnDisk[started.taskId].agySummaryExtracted;
  delete tasksOnDisk[started.taskId].agySummary;
  tasksOnDisk[started.taskId].status = 'exited';
  fs.writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify(tasksOnDisk, null, 2));

  const statusRes = await callManage({ action: 'status', taskId: started.taskId });
  assert.ok(!statusRes.isError, textOf(statusRes));
  const status = JSON.parse(textOf(statusRes));
  assert.equal(status.agySummaryExtracted, true, 'lazy extract ran even when status was already exited (B4a)');
  assert.equal(status.agySummary.status, 'SUCCESS');
  assert.equal(status.agySummary.durationSeconds, 12);
  assert.equal(status.agySummary.numTurns, 3);
  assert.equal(status.agySummary.usage.total_tokens, 150);
  assert.equal(status.emptyOutput, false);
  assert.ok(status.errLogSize > 0);
  assert.match(status.errTail, /API_KEY=\[redacted\]/, 'errTail must redact secrets (B4c)');
  assert.doesNotMatch(status.errTail, /supersecretvalue12345/);

  // tail_logs reads clean stdout JSON unpolluted by stderr.
  const tailRes = await callManage({ action: 'tail_logs', taskId: started.taskId });
  const tailJson = JSON.parse(textOf(tailRes));
  assert.equal(tailJson.response, 'detailed analysis result');

  // delete removes both .log and .err.log.
  const delRes = await callManage({ action: 'delete', taskId: started.taskId });
  assert.ok(!delRes.isError);
  assert.equal(fs.existsSync(started.logFile), false);
  assert.equal(fs.existsSync(started.errLogFile), false);

  // 7. Silent denial in background=true (exit 0 + empty stdout -> emptyOutput: true, status: failed).
  writeState({ account: 'pro@example.com', mode: 'empty' });
  const emptyStart = JSON.parse(textOf(await callAgy({ prompt: 'blocked op', background: true })));
  activeTaskIds.push(emptyStart.taskId);
  await waitExited(emptyStart.taskId);
  const emptyStatus = JSON.parse(textOf(await callManage({ action: 'status', taskId: emptyStart.taskId })));
  assert.equal(emptyStatus.emptyOutput, true);
  assert.equal(emptyStatus.status, 'failed');
  assert.match(emptyStatus.emptyOutputHint, /silently denied/i);
  await callManage({ action: 'delete', taskId: emptyStart.taskId });

  // 8. B4b: Concurrency cap of 4 active background agy tasks; 5th refused; stop cleans all 4.
  writeState({ account: 'pro@example.com', mode: 'sleep', sleepMs: 20000 });
  const bgIds = [];
  for (let i = 0; i < 4; i++) {
    const s = await callAgy({ prompt: 'sleep ' + i, background: true, timeoutSec: 60 });
    assert.ok(!s.isError, textOf(s));
    const parsed = JSON.parse(textOf(s));
    bgIds.push(parsed.taskId);
    activeTaskIds.push(parsed.taskId);
  }
  const fifth = await callAgy({ prompt: 'sleep 5', background: true });
  assert.equal(fifth.isError, true, '5th concurrent agy background task must be refused (B4b)');
  assert.match(textOf(fifth), /concurrency limit/i);

  for (let i = 0; i < bgIds.length; i++) {
    const id = bgIds[i];
    const stopped = JSON.parse(textOf(await callManage({ action: 'stop', taskId: id })));
    assert.equal(stopped.stopped, true);
    if (i === 0) {
      const stoppedStatus = JSON.parse(textOf(await callManage({ action: 'status', taskId: id })));
      assert.equal(stoppedStatus.status, 'stopped');
      assert.equal(stoppedStatus.agySummaryExtracted, true);
      assert.equal(stoppedStatus.emptyOutput, true);
      assert.equal(stoppedStatus.emptyOutputHint, undefined, 'user-stopped task must not claim silent denial');
    }
    await callManage({ action: 'delete', taskId: id });
  }

  // 9. applyAgySummary edge cases: exited gets emptyOutputHint; stopped never gets silently-denied hint.
  const { applyAgySummary } = await import('../scripts/task-mcp.js');
  const emptyJsonLog = path.join(tmp, 'empty-json.log');
  fs.writeFileSync(emptyJsonLog, JSON.stringify({ status: 'SUCCESS', response: '   ', duration_seconds: 1, num_turns: 1, usage: { total_tokens: 10 } }));
  const exitedEmptyJsonTask = { kind: 'agy', status: 'exited', outputFormat: 'json', logFile: emptyJsonLog };
  assert.equal(applyAgySummary(exitedEmptyJsonTask), true);
  assert.equal(exitedEmptyJsonTask.emptyOutput, true);
  assert.match(exitedEmptyJsonTask.emptyOutputHint, /empty.*silent denial/i, 'exited task with empty JSON response must attach emptyOutputHint');

  const zeroLog = path.join(tmp, 'zero.log');
  fs.writeFileSync(zeroLog, '');
  const exitedZeroTask = { kind: 'agy', status: 'exited', outputFormat: 'json', logFile: zeroLog };
  assert.equal(applyAgySummary(exitedZeroTask), true);
  assert.equal(exitedZeroTask.emptyOutput, true);
  assert.match(exitedZeroTask.emptyOutputHint, /silently denied/i, 'exited task with empty stdout must attach emptyOutputHint');

  const stoppedZeroTask = { kind: 'agy', status: 'stopped', outputFormat: 'json', logFile: zeroLog };
  assert.equal(applyAgySummary(stoppedZeroTask), true);
  assert.equal(stoppedZeroTask.status, 'stopped');
  assert.equal(stoppedZeroTask.emptyOutput, true);
  assert.equal(stoppedZeroTask.emptyOutputHint, undefined, 'stopped task with empty stdout must not attach silently-denied hint');

  const wsLog = path.join(tmp, 'ws.log');
  fs.writeFileSync(wsLog, '   \n  ');
  const stoppedWsTask = { kind: 'agy', status: 'stopped', outputFormat: 'json', logFile: wsLog };
  assert.equal(applyAgySummary(stoppedWsTask), true);
  assert.equal(stoppedWsTask.status, 'stopped');
  assert.equal(stoppedWsTask.emptyOutput, true);
  assert.equal(stoppedWsTask.emptyOutputHint, undefined, 'stopped task with whitespace stdout must not attach silently-denied hint');

  const stoppedEmptyJsonTask = { kind: 'agy', status: 'stopped', outputFormat: 'json', logFile: emptyJsonLog };
  assert.equal(applyAgySummary(stoppedEmptyJsonTask), true);
  assert.equal(stoppedEmptyJsonTask.status, 'stopped');
  assert.equal(stoppedEmptyJsonTask.emptyOutput, true);
  assert.equal(stoppedEmptyJsonTask.emptyOutputHint, undefined, 'stopped task with empty JSON response must not attach silently-denied hint');

  console.log('agy-mcp.test.js: ok');
} finally {
  for (const id of activeTaskIds) {
    try { await callManage({ action: 'stop', taskId: id }); } catch {}
  }
  await client.close();
  Object.assign(process.env, prevEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
}
