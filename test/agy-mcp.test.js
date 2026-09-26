#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { buildAgyArgs, parseAgyAccountHandle, parseAgyUsage, runAgyProcess, runAgyUsageProcess } from '../scripts/agy-runner.js';
import { executeAgy, resolveWorkerConfig } from '../scripts/agy-mcp.js';
import { startAgyWorker } from '../scripts/agy-worker.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'aki-agy-worker-'));
let server;
let secondServer;
let usageServer;

try {
  const usageJson = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [
    { buckets: [
      { id: 'gemini-5h', remaining_fraction: 0.375, reset_time: '2026-09-26T10:00:00Z' },
      { id: 'gemini-weekly', remaining_fraction: 0.8, reset_time: '2026-09-27T10:00:00Z' },
      { id: '3p-5h', remaining_fraction: 0.5, reset_time: '2026-09-26T11:00:00Z' },
      { id: '3p-weekly', remaining_fraction: 1, reset_time: '2026-09-28T11:00:00Z' },
    ] },
  ] } } });
  const expectedQuotas = parseAgyUsage(usageJson);
  assert.equal(expectedQuotas.gemini.fiveHour.remainingPercent, 38);
  assert.equal(expectedQuotas.claudeGpt.weekly.remainingPercent, 100);
  assert.equal(parseAgyAccountHandle('x applyAuthResult: email=first@example.com, ok\napplyAuthResult: email=guaanthony94@gmail.com, ok'), 'guaanthony94');
  assert.equal(parseAgyAccountHandle('other: email=token@example.com'), null);
  let usageLogFile;
  const usageReading = await runAgyUsageProcess(process.execPath, {
    cwd: root,
    execFileImpl: (file, argv, options, callback) => {
      assert.equal(file, process.execPath);
      assert.equal(options.windowsHide, true, 'background usage probes must not open a console');
      assert.deepEqual(argv.slice(0, 4), ['-p', '/usage', '--output-format', 'json']);
      usageLogFile = argv[argv.indexOf('--log-file') + 1];
      writeFileSync(usageLogFile, 'applyAuthResult: email=guaanthony94@gmail.com, ok\n');
      callback(null, usageJson, '');
    },
  });
  assert.deepEqual(usageReading, { quotas: expectedQuotas, accountHandle: 'guaanthony94' });
  assert.equal(existsSync(usageLogFile), false, 'temporary AGY log must be removed');
  await assert.rejects(() => runAgyUsageProcess(process.execPath, {
    execFileImpl: (file, argv, options, callback) => {
      writeFileSync(argv[argv.indexOf('--log-file') + 1], 'applyAuthResult: email=failed@example.com, ok');
      callback(new Error('CLI exit'), '', '');
    },
  }), (error) => error.message === 'AGY usage command failed' && error.accountHandle === 'failed');

  const args = buildAgyArgs({
    prompt: 'read two files',
    mode: 'plan',
    model: 'gemini-3.7-flash-medium',
    effort: 'medium',
    outputFormat: 'json',
  });
  assert.deepEqual(args.slice(-2), ['-p', 'read two files'], '-p prompt must stay last');
  assert.deepEqual(args.slice(0, 4), ['--mode', 'plan', '--model', 'gemini-3.7-flash-medium']);

  const hidden = await runAgyProcess({ prompt: 'hidden', cwd: root }, {
    execFileImpl: (file, argv, options, callback) => {
      assert.equal(options.windowsHide, true, 'headless AGY must not open a console window');
      assert.equal(options.timeout, 120_000);
      assert.equal(options.maxBuffer, 4 * 1024 * 1024);
      assert.deepEqual(argv.slice(-2), ['-p', 'hidden']);
      callback(null, 'hidden-ok', '');
    },
  });
  assert.equal(hidden, 'hidden-ok');

  let localPayload;
  const local = await executeAgy(
    { prompt: 'local', cwd: root },
    {
      settings: { agy: { allowedModes: ['plan'] } },
      resolveCwd: () => ({ ok: true, dir: root }),
      runLocal: async (payload) => {
        localPayload = payload;
        return 'local-ok';
      },
    },
  );
  assert.equal(local, 'local-ok');
  assert.equal(localPayload.cwd, root);
  assert.equal(localPayload.mode, 'plan');

  assert.throws(
    () => resolveWorkerConfig(
      'advisor',
      { agy: { workers: { advisor: { url: 'https://example.com:7411', tokenEnv: 'TOKEN' } } } },
      { TOKEN: 'x' },
      {},
    ),
    /loopback HTTP/,
    'remote/non-loopback worker URLs must be rejected',
  );

  const secretWorker = resolveWorkerConfig(
    'advisor',
    { agy: { workers: { advisor: { url: 'http://127.0.0.1:7411', secretRef: 'advisor' } } } },
    {},
    { advisor: 'secret-from-file' },
  );
  assert.equal(secretWorker.token, 'secret-from-file');
  assert.throws(
    () => resolveWorkerConfig('advisor', { agy: { workers: { advisor: { url: 'http://2130706433:7411', secretRef: 'advisor' } } } }, {}, { advisor: 'secret' }),
    /loopback HTTP/,
    'worker URL must contain the literal loopback address',
  );

  let workerPayload;
  let holdStarted;
  const holdReady = new Promise((resolve) => { holdStarted = resolve; });
  server = await startAgyWorker(
    {
      name: 'advisor',
      port: 0,
      root,
      allowedModes: ['plan'],
      token: 'test-secret',
      agyBin: process.execPath,
      verifyAgy: false,
    },
    {
      runProcess: async (payload, options = {}) => {
        workerPayload = payload;
        if (payload.prompt !== 'hold') return 'worker-ok';
        holdStarted();
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    },
  );

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.name, 'advisor');
  assert.equal(healthBody.pid, process.pid);
  assert.equal(healthBody.root, path.resolve(root));
  assert.deepEqual(healthBody.allowedModes, ['plan']);
  assert.match(healthBody.startedAt, /^\d{4}-\d{2}-\d{2}T/);

  const unauthorized = await fetch(base + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'x', mode: 'plan', cwd: root }),
  });
  assert.equal(unauthorized.status, 401);

  const blockedMode = await fetch(base + '/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-secret',
    },
    body: JSON.stringify({ prompt: 'x', mode: 'accept-edits', cwd: root }),
  });
  assert.equal(blockedMode.status, 403);

  const outsideRoot = await fetch(base + '/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-secret',
    },
    body: JSON.stringify({ prompt: 'x', mode: 'plan', cwd: path.dirname(root) }),
  });
  assert.equal(outsideRoot.status, 403);

  if (process.platform === 'win32') {
    const caseVariant = await fetch(base + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
      body: JSON.stringify({ prompt: 'case-check', mode: 'plan', cwd: root.toLowerCase() }),
    });
    assert.equal(caseVariant.status, 200, 'Windows cwd containment must be case-insensitive');
  }

  const remote = await executeAgy(
    { prompt: 'remote', cwd: root, worker: 'advisor' },
    {
      settings: {
        agy: {
          allowedModes: ['plan'],
          workers: {
            advisor: {
              url: base,
              secretRef: 'advisor',
              allowedModes: ['plan'],
            },
          },
        },
      },
      env: {},
      secrets: { advisor: 'test-secret' },
      resolveCwd: () => ({ ok: true, dir: root }),
      runLocal: async () => {
        throw new Error('local runner must not be used when worker is selected');
      },
    },
  );
  assert.equal(remote, 'worker-ok');
  assert.equal(workerPayload.prompt, 'remote');
  assert.equal(workerPayload.mode, 'plan');
  assert.equal(workerPayload.cwd, root);

  const customRoot = path.join(root, 'custom');
  mkdirSync(customRoot);
  secondServer = await startAgyWorker(
    { name: 'executor', port: 0, root: customRoot, allowedModes: ['plan'], token: 'custom-secret', agyBin: process.execPath, verifyAgy: false },
    { runProcess: async (payload) => { workerPayload = payload; return 'custom-ok'; } },
  );
  const customBase = `http://127.0.0.1:${secondServer.address().port}`;
  const defaultCwdResult = await executeAgy(
    { prompt: 'use worker root', worker: 'executor' },
    {
      settings: { agy: { allowedModes: ['plan'], workers: { executor: { url: customBase, secretRef: 'executor', allowedModes: ['plan'] } } } },
      secrets: { executor: 'custom-secret' },
      resolveCwd: () => ({ ok: true, dir: root }),
    },
  );
  assert.equal(defaultCwdResult, 'custom-ok');
  assert.equal(workerPayload.cwd, customRoot, 'omitted cwd must use the selected worker root');

  const unicodePrompt = 'Kiểm tra tiếng Việt';
  const unicodeBody = Buffer.from(JSON.stringify({ prompt: unicodePrompt }));
  const splitAt = unicodeBody.indexOf(Buffer.from('ể')) + 1;
  const unicodeResponse = await new Promise((resolve, reject) => {
    const request = http.request(customBase + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer custom-secret' },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.write(unicodeBody.subarray(0, splitAt));
    setTimeout(() => request.end(unicodeBody.subarray(splitAt)), 20);
  });
  assert.equal(unicodeResponse.status, 200);
  assert.equal(workerPayload.prompt, unicodePrompt, 'split UTF-8 request chunks must preserve prompt text');

  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  const link = path.join(customRoot, 'escape');
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const symlinkEscape = await fetch(customBase + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer custom-secret' },
      body: JSON.stringify({ prompt: 'escape', cwd: link }),
    });
    assert.equal(symlinkEscape.status, 403, 'worker cwd must reject links outside its root');
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }
  await new Promise((resolve) => secondServer.close(resolve));
  secondServer = null;

  await assert.rejects(
    () => executeAgy(
      { prompt: 'mutate', cwd: root, worker: 'advisor', mode: 'accept-edits' },
      {
        settings: {
          agy: {
            allowedModes: ['plan', 'accept-edits'],
            workers: {
              advisor: {
                url: base,
                secretRef: 'advisor',
                allowedModes: ['plan'],
              },
            },
          },
        },
        secrets: { advisor: 'test-secret' },
        resolveCwd: () => ({ ok: true, dir: root }),
      },
    ),
    /not allowlisted for AGY worker/,
  );

  const badStop = await fetch(base + '/stop', { method: 'POST' });
  assert.equal(badStop.status, 401);

  const slowArrived = new Promise((resolve) => server.once('request', resolve));
  let finishSlow;
  const slowRequest = new Promise((resolve, reject) => {
    const request = http.request(base + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write('{"prompt":"slow"');
    finishSlow = () => request.end('}');
  });
  await slowArrived;
  const holdRequest = fetch(base + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ prompt: 'hold', mode: 'plan', cwd: root }),
  });
  await holdReady;
  finishSlow();
  assert.equal(await slowRequest, 409, 'a request waiting for its body must recheck worker occupancy');
  const busyHealth = await (await fetch(base + '/health')).json();
  assert.equal(busyHealth.busy, true);
  const concurrent = await fetch(base + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ prompt: 'second', mode: 'plan', cwd: root }),
  });
  assert.equal(concurrent.status, 409);

  const stop = await fetch(base + '/stop', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-secret' },
  });
  assert.equal(stop.status, 200);
  assert.equal((await stop.json()).ok, true);
  assert.equal((await holdRequest).status, 500, 'stop must abort the active run');

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(server.listening, false);

  server = await startAgyWorker(
    {
      name: 'experiment',
      port: 0,
      root,
      allowedModes: ['plan'],
      token: 'probe-secret',
      agyBin: process.execPath,
      verifyAgy: true,
    },
    {
      runProcess: async () => {
        throw new Error('Eligibility check failed: current account is not eligible for Antigravity');
      },
      readUsage: async () => { throw Object.assign(new Error('usage unavailable'), { accountHandle: 'guaanthony94' }); },
    },
  );
  const probeBase = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const probeHealth = await (await fetch(probeBase + '/health')).json();
  assert.equal(probeHealth.agyReady, false);
  assert.equal(probeHealth.checking, false);
  assert.match(probeHealth.agyError, /Eligibility check failed/);
  const failedIdentity = await (await fetch(probeBase + '/identity', { headers: { Authorization: 'Bearer probe-secret' } })).json();
  assert.equal(failedIdentity.accountHandle, 'guaanthony94', 'failed eligibility must retain the authenticated account label');
  await new Promise((resolve) => server.close(resolve));

  let usageReads = 0;
  usageServer = await startAgyWorker(
    { name: 'reviewer', port: 0, root, allowedModes: ['plan'], token: 'usage-secret', agyBin: process.execPath, verifyAgy: false },
    {
      runProcess: async () => 'done',
      readUsage: async () => { usageReads += 1; return { quotas: expectedQuotas, accountHandle: 'reviewer94' }; },
    },
  );
  const usageBase = `http://127.0.0.1:${usageServer.address().port}`;
  assert.equal((await fetch(usageBase + '/usage')).status, 401);
  assert.equal((await fetch(usageBase + '/identity')).status, 401);
  const usageHeaders = { Authorization: 'Bearer usage-secret' };
  assert.equal((await (await fetch(usageBase + '/identity', { headers: usageHeaders })).json()).accountHandle, null);
  const firstUsage = await (await fetch(usageBase + '/usage', { headers: usageHeaders })).json();
  assert.deepEqual(firstUsage.quotas, expectedQuotas);
  assert.equal(firstUsage.accountHandle, 'reviewer94');
  assert.equal(firstUsage.stale, false);
  assert.equal(usageReads, 1);
  assert.equal((await (await fetch(usageBase + '/identity', { headers: usageHeaders })).json()).accountHandle, 'reviewer94');
  await fetch(usageBase + '/usage', { headers: usageHeaders });
  assert.equal(usageReads, 1, 'fresh cached usage must not start another CLI probe');
  await fetch(usageBase + '/usage?fresh=1', { headers: usageHeaders });
  assert.equal(usageReads, 2, 'explicit refresh must bypass cache');
  await fetch(usageBase + '/run', {
    method: 'POST', headers: { ...usageHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'work', mode: 'plan', cwd: root }),
  });
  await fetch(usageBase + '/usage', { headers: usageHeaders });
  assert.equal(usageReads, 3, 'a completed AGY job must invalidate cached usage');
  await new Promise((resolve) => usageServer.close(resolve));
  usageServer = null;

  console.log('agy-mcp.test.js: ok');
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (secondServer?.listening) await new Promise((resolve) => secondServer.close(resolve));
  if (usageServer?.listening) await new Promise((resolve) => usageServer.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
