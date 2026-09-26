#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'aki-agy-pool-manager-'));
process.env.AKI_MCP_DATA_DIR = tmp;
const {
  buildWorkerArgs,
  getAgyPoolStatus,
  getAgyPoolUsage,
  loginAgyPoolRole,
  logoutAgyPoolRole,
  provisionAgyRoleUsers,
  quoteWindowsArg,
  startAgyPoolRole,
  stopAgyPoolRole,
} = await import('../scripts/agy-pool-manager.js');
const { AGY_POOL_WORKSPACE_ROOT } = await import('../scripts/agy-pool-config.js');

assert.equal(quoteWindowsArg('plain'), 'plain');
assert.equal(quoteWindowsArg('C:\\Program Files\\node.exe'), '"C:\\Program Files\\node.exe"');

const credentialFile = path.join(tmp, 'role.dpapi');
const root = path.resolve(os.tmpdir());
const agyBin = path.join(root, 'agy.exe');
const ownerSid = 'S-1-5-21-100-200-300-1001';
const entry = {
  url: 'http://127.0.0.1:7411',
  secretRef: 'advisor',
  user: '',
  root,
  allowedModes: ['plan'],
};
const settings = {
  folders: [root],
  agy: {
    allowedModes: ['plan', 'accept-edits'],
    workers: {
      advisor: entry,
      executor: { ...entry, url: 'http://127.0.0.1:7412', secretRef: 'executor', user: 'agy-executor', allowedModes: ['plan', 'accept-edits'] },
      experiment: { ...entry, url: 'http://127.0.0.1:7413', secretRef: 'experiment', user: 'agy-experiment', allowedModes: ['plan', 'accept-edits'] },
      reviewer: { ...entry, url: 'http://127.0.0.1:7414', secretRef: 'reviewer', user: 'agy-reviewer' },
    },
  },
};
const defaultSettings = { ...settings, agy: { ...settings.agy, workers: {} } };

const workerArgs = buildWorkerArgs('advisor', entry, ['--token-file', 'C:\\Temp\\worker.token'], { agyBinary: agyBin });
assert.ok(workerArgs.includes('--agy-bin'));
assert.ok(workerArgs.includes(agyBin));
assert.deepEqual(workerArgs.slice(-4), ['--token-file', 'C:\\Temp\\worker.token', '--allowed-modes', 'plan']);
const defaultWorkerArgs = buildWorkerArgs('advisor', { ...entry, root: '' }, [], { agyBinary: agyBin });
assert.equal(defaultWorkerArgs[defaultWorkerArgs.indexOf('--root') + 1], AGY_POOL_WORKSPACE_ROOT);

let running = false;
let spawnCall = null;
let icaclsArgs = null;
const execFileImpl = (file, args, options, cb) => {
  if (file === 'where.exe') return cb(null, agyBin + '\r\n', '');
  if (file === 'whoami.exe') {
    assert.deepEqual(args, ['/user', '/fo', 'csv', '/nh']);
    assert.equal(options.windowsHide, true);
    return cb(null, `"COMPUTER\\test-user","${ownerSid}"\r\n`, '');
  }
  if (file === 'net.exe') return cb(null, 'ok', '');
  if (file === 'icacls.exe') { icaclsArgs = args; return cb(null, 'ok', ''); }
  if (file === 'cmd.exe') return cb(null, 'ok', '');
  if (file === 'powershell.exe') {
    if (args.includes('-Command')) {
      assert.equal(options.windowsHide, true);
      if (options.env?.AKI_AGY_ROLE_PASSWORD) {
        writeFileSync(options.env.AKI_AGY_ROLE_CRED_PATH, '<?xml version="1.0"?><Objs><Obj><TN><T>System.Management.Automation.PSCredential</T></TN><Props><S N="UserName">AKIMCP\\agy-role</S><SS N="Password">fake</SS></Props></Obj></Objs>');
        return cb(null, '', '');
      }
      if (options.env?.AKI_AGY_ROLE_CRED_PATH) {
        const content = existsSync(options.env.AKI_AGY_ROLE_CRED_PATH)
          ? readFileSync(options.env.AKI_AGY_ROLE_CRED_PATH, 'utf8')
          : '';
        const valid = content.includes('PSCredential') && content.includes('<SS N="Password">');
        return valid ? cb(null, '', '') : cb(new Error('invalid credential'), '', 'invalid credential');
      }
    }
    assert.ok(args.includes('-WindowStyle'));
    assert.ok(args.includes('Hidden'));
    return cb(null, 'ok', '');
  }
  throw new Error('unexpected execFile: ' + file);
};

const fetchImpl = async (url) => {
  const pathname = new URL(url).pathname;
  if (pathname === '/stop') {
    running = false;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (!running) throw new Error('offline');
  return new Response(JSON.stringify({
    ok: true, name: 'advisor', pid: 1234,
    startedAt: '2026-09-25T00:00:00.000Z', root,
    agyAvailable: true, agyReady: true, agyError: null, agyPath: agyBin, allowedModes: ['plan'],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  writeFileSync(credentialFile, '0'.repeat(120) + '\r\n' + '0'.repeat(120));
  const initial = await getAgyPoolStatus({ settings, fetchImpl, execFileImpl, credentialFile });
  assert.equal(initial.initialized, true);
  assert.equal(initial.missingIdentityCount, process.platform === 'win32' ? 0 : 3);
  assert.equal(initial.roles.executor.identityExists, process.platform === 'win32');
  assert.equal(initial.roleCredentialReady, process.platform !== 'win32', 'only Windows checks the role credential');
  assert.equal(initial.provisionRequired, true, 'panel must offer Create role identities to repair a missing role credential');

  const utf16CredentialFile = path.join(tmp, 'role-utf16.clixml');
  const utf16Xml = '<?xml version="1.0"?><Objs><Obj><TN><T>System.Management.Automation.PSCredential</T></TN><Props><S N="UserName">AKIMCP\\agy-role</S><SS N="Password">fake</SS></Props></Obj></Objs>';
  const utf16Body = Buffer.from(utf16Xml, 'utf16le');
  writeFileSync(utf16CredentialFile, Buffer.concat([Buffer.from([0xff, 0xfe]), utf16Body]));
  const utf16Status = await getAgyPoolStatus({ settings, fetchImpl, execFileImpl, credentialFile: utf16CredentialFile });
  assert.equal(utf16Status.roleCredentialReady, true, 'Windows PowerShell 5.1 UTF-16LE CLIXML must be recognized');
  assert.equal(utf16Status.provisionRequired, true, 'a common custom root needs successful provisioning');
  const missingWorkspaceStatus = await getAgyPoolStatus({ settings: defaultSettings, fetchImpl, execFileImpl, credentialFile: utf16CredentialFile });
  assert.equal(missingWorkspaceStatus.defaultWorkspaceReady, false);
  assert.equal(missingWorkspaceStatus.provisionRequired, true, 'default workspace must be created before the roles can start');
  for (const role of Object.values(missingWorkspaceStatus.roles)) assert.equal(role.root, AGY_POOL_WORKSPACE_ROOT);
  await assert.rejects(startAgyPoolRole('advisor', { settings: defaultSettings }), /click Create role identities first/);

  if (process.platform === 'win32') {
    const mixedRoots = { ...defaultSettings, agy: { ...defaultSettings.agy, workers: { executor: { root } } } };
    const mixedStatus = await getAgyPoolStatus({ settings: mixedRoots, fetchImpl, execFileImpl, credentialFile: utf16CredentialFile });
    assert.equal(mixedStatus.provisionRequired, false, 'mixed roots retain the manual ACL workflow');
    await assert.rejects(provisionAgyRoleUsers({
      settings: mixedRoots,
      spawnImpl: () => { throw new Error('unexpected elevation'); },
      execFileImpl: () => { throw new Error('unexpected helper'); },
      credentialFile,
    }), /set the same root for all roles/);
    assert.equal(existsSync(AGY_POOL_WORKSPACE_ROOT), false, 'mixed roots must fail before creating the default workspace');
    await assert.rejects(provisionAgyRoleUsers({
      settings: defaultSettings,
      spawnImpl: () => { throw new Error('unexpected elevation'); },
      execFileImpl: (file, args, options, cb) => file === 'whoami.exe'
        ? cb(null, '"COMPUTER\\test-user","invalid"\r\n', '')
        : execFileImpl(file, args, options, cb),
      credentialFile,
    }), /could not resolve the current Windows user SID/);
    assert.equal(existsSync(AGY_POOL_WORKSPACE_ROOT), false, 'invalid SID must fail before creating the default workspace');

    const cancelledSpawn = () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('close', 1));
      return child;
    };
    await assert.rejects(provisionAgyRoleUsers({
      settings: defaultSettings, spawnImpl: cancelledSpawn, execFileImpl, credentialFile,
    }), /role identity provisioning exited with code 1/);
    assert.equal(existsSync(AGY_POOL_WORKSPACE_ROOT), true, 'workspace may exist after cancelled elevation');
    const failedStatus = await getAgyPoolStatus({ settings: defaultSettings, fetchImpl, execFileImpl, credentialFile });
    assert.equal(failedStatus.roleCredentialReady, true);
    assert.equal(failedStatus.defaultWorkspaceReady, false, 'directory existence alone must not mark provisioning complete');
    assert.equal(failedStatus.provisionRequired, true);
    await assert.rejects(startAgyPoolRole('advisor', { settings: defaultSettings }), /click Create role identities first/);

    let provisionCall = null;
    const provisionSpawn = (command, args, options) => {
      provisionCall = { command, args, options };
      assert.equal(existsSync(AGY_POOL_WORKSPACE_ROOT), true, 'default workspace must exist before elevation');
      const child = new EventEmitter();
      child.pid = 7002;
      setImmediate(() => child.emit('close', 0));
      return child;
    };
    const provision = await provisionAgyRoleUsers({
      settings: defaultSettings, spawnImpl: provisionSpawn, execFileImpl, credentialFile,
    });
    assert.equal(provision.ok, true);
    assert.equal(provisionCall.command, 'powershell.exe');
    assert.equal(provisionCall.options.windowsHide, true);
    assert.equal(provisionCall.options.stdio, 'ignore');
    assert.ok(provisionCall.args.includes('Hidden'));
    assert.match(provisionCall.args.join(' '), /OwnerHome/);
    assert.match(provisionCall.args.join(' '), /OwnerSid/);
    assert.ok(provisionCall.args.join(' ').includes(ownerSid));
    assert.equal(existsSync(credentialFile), true);
    assert.match(readFileSync(credentialFile, 'utf8'), /PSCredential/);
    const provisionedStatus = await getAgyPoolStatus({ settings: defaultSettings, fetchImpl, execFileImpl, credentialFile });
    assert.equal(provisionedStatus.roleCredentialReady, true);
    assert.equal(provisionedStatus.defaultWorkspaceReady, true);
    assert.equal(provisionedStatus.provisionRequired, false);

    const customBefore = await getAgyPoolStatus({ settings, fetchImpl, execFileImpl, credentialFile });
    assert.equal(customBefore.provisionRequired, true, 'default-root marker must not authorize a custom root');
    await provisionAgyRoleUsers({ settings, spawnImpl: provisionSpawn, execFileImpl, credentialFile });
    const customAfter = await getAgyPoolStatus({ settings, fetchImpl, execFileImpl, credentialFile });
    assert.equal(customAfter.provisionRequired, false, 'successful provisioning must authorize the common custom root');

    let currentLoginCall = null;
    const currentLogin = await loginAgyPoolRole('advisor', {
      settings,
      fetchImpl,
      execFileImpl,
      credentialFile,
      spawnImpl: (command, args, options) => {
        currentLoginCall = { command, args, options };
        return { pid: 7000, unref() {} };
      },
    });
    assert.equal(currentLogin.ok, true);
    assert.equal(currentLoginCall.command, 'cmd.exe');
    assert.deepEqual(currentLoginCall.args, ['/d', '/k', agyBin]);
    assert.equal(currentLoginCall.options.windowsHide, false, 'only explicit Login may open a visible console');
    assert.equal(currentLoginCall.options.detached, true);
    assert.equal(currentLoginCall.options.stdio, 'ignore');

    let loginCall = null;
    const loginExecFileImpl = (file, args, options, cb) => {
      if (file === 'powershell.exe' && args.includes('-File') && args.includes('login')) {
        loginCall = { file, args, options };
        assert.equal(options.windowsHide, true, 'automatic PowerShell helper must remain hidden');
        const resultPath = args[args.indexOf('-ResultFile') + 1];
        assert.ok(resultPath);
        assert.equal(args.includes('-StdoutFile'), false);
        assert.equal(args.includes('-StderrFile'), false);
        assert.equal(args.includes('-CodeFile'), false);
        writeFileSync(resultPath, 'OK:8123');
        return cb(null, '', '');
      }
      return execFileImpl(file, args, options, cb);
    };
    const login = await loginAgyPoolRole('executor', {
      settings, fetchImpl, execFileImpl: loginExecFileImpl, credentialFile,
    });
    assert.equal(login.ok, true);
    assert.equal(login.launcherPid, 8123);
    assert.ok(loginCall);
    assert.match(login.message, /AGY CLI opened/);
    assert.match(login.message, /sign in directly in that window/i);
    const loginStatus = await getAgyPoolStatus({ settings, fetchImpl, execFileImpl, credentialFile });
    assert.equal('loginPending' in loginStatus.roles.executor, false);
    assert.equal('loginActive' in loginStatus.roles.executor, false);
  }

  const spawnImpl = (command, args, options) => {
    spawnCall = { command, args, options };
    running = true;
    return { pid: 999, unref() {} };
  };
  const started = await startAgyPoolRole('advisor', {
    settings, secrets: { advisor: 'secret' }, fetchImpl, spawnImpl, execFileImpl, credentialFile,
  });
  assert.equal(started.ok, true);
  assert.equal(spawnCall.command, process.execPath);
  assert.equal(spawnCall.options.windowsHide, true);
  assert.equal(spawnCall.options.stdio, 'ignore');
  assert.equal(spawnCall.options.env.AKI_AGY_WORKER_TOKEN, 'secret');

  const usageQuotas = { gemini: { fiveHour: { remainingPercent: 40, resetAt: '2026-09-26T10:00:00Z' }, weekly: null }, claudeGpt: { fiveHour: null, weekly: null } };
  const usageFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.port !== '7411') throw new Error('offline');
    if (parsed.pathname === '/health') return fetchImpl(url);
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.equal(parsed.pathname, '/usage');
    return new Response(JSON.stringify({ ok: true, quotas: usageQuotas, accountHandle: 'advisor94', checkedAt: '2026-09-26T09:00:00Z', workerStartedAt: '2026-09-25T00:00:00Z' }), { status: 200 });
  };
  const usage = await getAgyPoolUsage({ settings, secrets: { advisor: 'secret' }, fetchImpl: usageFetch, fresh: true });
  assert.equal(usage.roles.advisor.state, 'ready');
  assert.equal(usage.roles.advisor.accountHandle, 'advisor94');
  assert.deepEqual(usage.roles.advisor.quotas, usageQuotas);

  if (process.platform === 'win32') {
    let crossRunning = false;
    let stagedPath = null;
    const crossFetch = async () => {
      if (!crossRunning) throw new Error('offline');
      return new Response(JSON.stringify({
        ok: true, name: 'executor', pid: 4321,
        startedAt: '2026-09-25T00:00:00.000Z', root,
        agyAvailable: true, agyReady: true, agyError: null, agyPath: agyBin, allowedModes: ['plan', 'accept-edits'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const crossExecFileImpl = (file, args, options, cb) => {
      if (file === 'powershell.exe' && args.includes('-File') && args.includes('worker')) {
        assert.equal(options.windowsHide, true);
        const tokenIndex = args.indexOf('-TokenFile');
        const resultIndex = args.indexOf('-ResultFile');
        assert.ok(tokenIndex > 0);
        assert.ok(resultIndex > 0);
        stagedPath = args[tokenIndex + 1];
        const resultPath = args[resultIndex + 1];
        assert.equal(readFileSync(stagedPath, 'utf8'), 'cross-secret');
        writeFileSync(resultPath, 'OK:4321');
        crossRunning = true;
        return cb(null, '', '');
      }
      return execFileImpl(file, args, options, cb);
    };
    const crossStarted = await startAgyPoolRole('executor', {
      settings, secrets: { executor: 'cross-secret' }, fetchImpl: crossFetch,
      execFileImpl: crossExecFileImpl, credentialFile,
    });
    assert.equal(crossStarted.ok, true);
    assert.ok(icaclsArgs.includes('/inheritance:r'));
    assert.equal(existsSync(stagedPath), false);

    const loggedOut = await logoutAgyPoolRole('executor', {
      settings, secrets: { executor: 'cross-secret' }, fetchImpl: crossFetch,
      execFileImpl, credentialFile,
    });
    assert.equal(loggedOut.ok, true);
  }

  if (process.platform === 'win32') {
    let failedExperimentRunning = true;
    const eligibilityFetch = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/identity') return new Response(JSON.stringify({ ok: true, accountHandle: 'guaanthony94' }), { status: 200 });
      if (pathname === '/stop') {
        failedExperimentRunning = false;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!failedExperimentRunning) throw new Error('offline');
      return new Response(JSON.stringify({
        ok: true,
        name: 'experiment',
        pid: 7777,
        startedAt: '2026-09-25T00:00:00.000Z',
        root,
        agyAvailable: true,
        agyReady: false,
        agyError: 'Eligibility check failed: Your current account is not eligible for Antigravity. Verify your account: https://accounts.google.com/signin/continue?secret=should-not-leak',
        agyPath: agyBin,
        allowedModes: ['plan', 'accept-edits'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const eligibilityResult = await startAgyPoolRole('experiment', {
      settings,
      secrets: { experiment: 'experiment-secret' },
      fetchImpl: eligibilityFetch,
      execFileImpl,
      credentialFile,
    });
    assert.equal(eligibilityResult.ok, false);
    assert.equal(failedExperimentRunning, false, 'eligibility failure must auto-stop the worker');
    assert.equal(eligibilityResult.status.running, false);
    assert.equal((await getAgyPoolStatus({ settings, fetchImpl: eligibilityFetch, execFileImpl, credentialFile })).roles.experiment.accountIneligible, true);
    assert.equal((await getAgyPoolUsage({ settings, secrets: { experiment: 'experiment-secret' }, fetchImpl: eligibilityFetch })).roles.experiment.accountHandle, 'guaanthony94');
    assert.match(eligibilityResult.message, /not eligible for Antigravity/);
    assert.match(eligibilityResult.message, /Logout, then Login/);
    assert.doesNotMatch(eligibilityResult.message, /https?:\/\//, 'OAuth URLs must not leak into panel errors');
  }

  const stopped = await stopAgyPoolRole('advisor', { settings, secrets: { advisor: 'secret' }, fetchImpl });
  assert.equal(stopped.ok, true);
  const offlineUsage = await getAgyPoolUsage({ settings, secrets: { advisor: 'secret' }, fetchImpl });
  assert.equal(offlineUsage.roles.advisor.state, 'offline');
  assert.equal(offlineUsage.roles.advisor.accountHandle, 'advisor94', 'stopped role retains the last known handle');
  if (process.platform === 'win32') {
    await loginAgyPoolRole('advisor', {
      settings, fetchImpl, execFileImpl, credentialFile,
      spawnImpl: () => ({ pid: 7003, unref() {} }),
    });
    const changedAccount = await getAgyPoolUsage({ settings, secrets: { advisor: 'secret' }, fetchImpl });
    assert.equal(changedAccount.roles.advisor.accountHandle, null, 'Login must clear the previous account label');
  }

  console.log('agy-pool-manager.test.js: ok');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
