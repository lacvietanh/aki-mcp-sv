import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSettings } from './allowlist.js';
import { AGY_ROLE_CREDENTIAL_PATH, AGY_ROLE_LEGACY_CREDENTIAL_PATH } from './userdata.js';
import {
  AGY_POOL_ROLES,
  AGY_POOL_WORKSPACE_ROOT,
  DEFAULT_AGY_WORKERS,
  ensureAgyPoolSecrets,
  installDefaultAgyPool,
  readAgyPoolSecrets,
  resolveAgyWorkerToken,
  withDefaultAgyPool,
} from './agy-pool-config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_BIN = path.join(REPO_ROOT, 'bin', 'aki-agy-worker.js');
const PROVISION_SCRIPT = path.join(REPO_ROOT, 'scripts', 'agy-provision-users.ps1');
const ROLE_PROCESS_SCRIPT = path.join(REPO_ROOT, 'scripts', 'agy-role-process.ps1');
const PROVISION_MARKER_PATH = path.join(path.dirname(path.resolve(AGY_POOL_WORKSPACE_ROOT)), 'agy-pool-provisioned.json');
const FIXED_ROLE_USERS = Object.freeze(['agy-executor', 'agy-experiment', 'agy-reviewer']);
const HEALTH_TIMEOUT_MS = 1_200;
const START_WAIT_MS = 8_000;
const READY_WAIT_MS = 65_000;
const STOP_WAIT_MS = 5_000;
const lastObservedAgyAccounts = new Map();
const agyAccountEpoch = new Map();
const ineligibleAgyAccounts = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizedAgyAccountHandle(value) {
  return typeof value === 'string' && /^[a-z0-9._%+-]{1,64}$/i.test(value) ? value : null;
}

function clearObservedAgyAccount(role) {
  agyAccountEpoch.set(role, (agyAccountEpoch.get(role) || 0) + 1);
  lastObservedAgyAccounts.delete(role);
  ineligibleAgyAccounts.delete(role);
}

function workerUrl(entry, pathname) {
  const base = new URL(entry.url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('worker URL must use http://127.0.0.1');
  return new URL(pathname, base).toString();
}

function currentWindowsUser() {
  return os.userInfo().username;
}

function normalizedWindowsUser(value) {
  return String(value || '').trim().toLowerCase().split('\\').pop();
}

function runsAsCurrentUser(value) {
  if (!String(value || '').trim()) return true;
  return normalizedWindowsUser(value) === normalizedWindowsUser(currentWindowsUser());
}

function workerRoot(entry) {
  return path.resolve(entry.root || AGY_POOL_WORKSPACE_ROOT);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function workspaceProvisioned(root) {
  try {
    const marker = JSON.parse(readFileSync(PROVISION_MARKER_PATH, 'utf8'));
    return statSync(root).isDirectory()
      && typeof marker.root === 'string' && samePath(marker.root, root);
  } catch { return false; }
}

function defaultWorkspaceReady() {
  return workspaceProvisioned(AGY_POOL_WORKSPACE_ROOT);
}

function portFromUrl(url) {
  const parsed = new URL(url);
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`worker URL has invalid port: ${url}`);
  return port;
}

async function windowsUserExists(user, { execFileImpl = execFile } = {}) {
  if (!user || runsAsCurrentUser(user)) return true;
  if (process.platform !== 'win32') return false;
  try {
    await execFilePromise(execFileImpl, 'net.exe', ['user', user]);
    return true;
  } catch {
    return false;
  }
}

async function resolveMainAgyBinary({ execFileImpl = execFile } = {}) {
  if (process.platform !== 'win32') return 'agy';
  const stdout = await execFilePromise(execFileImpl, 'where.exe', ['agy']);
  const found = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!found) throw new Error('AGY CLI not found on the main Windows account PATH');
  return path.resolve(found);
}

async function resolveCurrentUserSid({ execFileImpl = execFile } = {}) {
  const stdout = await execFilePromise(execFileImpl, 'whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  const match = /"(S-\d+(?:-\d+)+)"\s*$/.exec(String(stdout || ''));
  if (!match) throw new Error('could not resolve the current Windows user SID');
  return match[1];
}

function sharedAgyRoot(agyBinary) {
  return path.dirname(path.dirname(path.resolve(agyBinary)));
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function roleCredentialFileLooksValid(file = AGY_ROLE_CREDENTIAL_PATH) {
  try {
    const bytes = readFileSync(file);
    if (!bytes.length) return false;
    const value = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8').replace(/^\uFEFF/, '');
    return value.includes('<Objs') && value.includes('PSCredential') && value.includes('<SS N="Password">');
  } catch {
    return false;
  }
}

export function quoteWindowsArg(value) {
  const s = String(value);
  if (!/[\s"]/u.test(s)) return s;
  let out = '"';
  let slashes = 0;
  for (const ch of s) {
    if (ch === '\\') {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
      slashes = 0;
      continue;
    }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  out += '\\'.repeat(slashes * 2) + '"';
  return out;
}

export function buildWorkerArgs(role, entry, authArgs = [], { agyBinary } = {}) {
  const args = [
    WORKER_BIN,
    '--name', role,
    '--port', String(portFromUrl(entry.url)),
    '--root', workerRoot(entry),
  ];
  if (agyBinary) args.push('--agy-bin', agyBinary);
  args.push(...authArgs, '--allowed-modes', entry.allowedModes.join(','));
  return args;
}

export function buildRunasArgs(user, workerArgs) {
  if (!/^[A-Za-z0-9_.\\-]+$/.test(user)) throw new Error('Windows user contains unsupported characters');
  const commandLine = [process.execPath, ...workerArgs].map(quoteWindowsArg).join(' ');
  return ['/savecred', `/user:${user}`, commandLine];
}

export function buildRunasCommandArgs(user, commandLine) {
  if (!/^[A-Za-z0-9_.\\-]+$/.test(user)) throw new Error('Windows user contains unsupported characters');
  if (typeof commandLine !== 'string' || !commandLine.trim()) throw new Error('command line is required');
  return ['/savecred', `/user:${user}`, commandLine];
}

async function fetchJson(url, {
  method = 'GET',
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = HEALTH_TIMEOUT_MS,
} = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetchImpl(url, {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(body?.error || `HTTP ${response.status}`), { statusCode: response.status });
  return body;
}

export async function workerHealth(entry, { fetchImpl = globalThis.fetch, expectedName = null } = {}) {
  try {
    const body = await fetchJson(workerUrl(entry, '/health'), { fetchImpl });
    if (expectedName && body?.name !== expectedName) {
      return { running: false, pid: null, startedAt: null, name: body?.name || null, allowedModes: [], root: null, error: `port belongs to worker "${body?.name || 'unknown'}", expected "${expectedName}"` };
    }
    return {
      running: Boolean(body?.ok),
      pid: Number(body?.pid) || null,
      startedAt: body?.startedAt || null,
      name: body?.name || null,
      allowedModes: Array.isArray(body?.allowedModes) ? body.allowedModes : [],
      root: body?.root || null,
      busy: Boolean(body?.busy),
      checking: Boolean(body?.checking),
      agyAvailable: body?.agyAvailable !== false,
      agyReady: body?.agyReady === true,
      agyError: body?.agyError ? summarizeAgyFailure(body.agyError) : null,
      agyPath: body?.agyPath || null,
      error: null,
    };
  } catch (error) {
    return { running: false, pid: null, startedAt: null, name: null, allowedModes: [], root: null, busy: false, checking: false, agyAvailable: false, agyReady: false, agyError: null, agyPath: null, error: error?.message || String(error) };
  }
}

function livePoolSettings(settings = readSettings()) {
  const initialized = Boolean(settings.agy?.workers && typeof settings.agy.workers === 'object');
  return { initialized, settings: withDefaultAgyPool(settings) };
}

export async function getAgyPoolStatus({
  settings = readSettings(),
  fetchImpl = globalThis.fetch,
  execFileImpl = execFile,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  const { initialized, settings: merged } = livePoolSettings(settings);
  const roles = {};
  const snapshots = Object.fromEntries(await Promise.all(AGY_POOL_ROLES.map(async (role) => {
    const entry = merged.agy.workers[role];
    const [health, identityExists] = await Promise.all([
      initialized ? workerHealth(entry, { fetchImpl, expectedName: role }) : Promise.resolve({ running: false, pid: null, startedAt: null, error: null }),
      windowsUserExists(entry.user, { execFileImpl }),
    ]);
    return [role, { health, identityExists }];
  })));
  for (const role of AGY_POOL_ROLES) {
    const entry = merged.agy.workers[role];
    roles[role] = {
      role,
      configuredUser: entry.user || '',
      user: entry.user || currentWindowsUser(),
      usesCurrentUser: runsAsCurrentUser(entry.user),
      url: entry.url,
      allowedModes: entry.allowedModes,
      identityExists: snapshots[role].identityExists,
      accountIneligible: !snapshots[role].health.running && ineligibleAgyAccounts.has(role),
      ...snapshots[role].health,
      root: workerRoot(entry),
    };
  }
  const missingIdentityCount = Object.values(roles).filter((role) => !role.identityExists).length;
  const roleCredentialReady = process.platform !== 'win32' || roleCredentialFileLooksValid(credentialFile);
  const workspaceReady = defaultWorkspaceReady();
  const roots = Object.values(roles).map((role) => role.root);
  const commonRoot = roots.every((root) => samePath(root, roots[0])) ? roots[0] : null;
  return {
    initialized,
    platform: process.platform,
    currentUser: currentWindowsUser(),
    roles,
    runningCount: Object.values(roles).filter((role) => role.running).length,
    readyCount: Object.values(roles).filter((role) => role.running && role.agyReady && role.identityExists).length,
    missingIdentityCount,
    roleCredentialReady,
    defaultWorkspaceReady: workspaceReady,
    provisionRequired: missingIdentityCount > 0 || !roleCredentialReady || (commonRoot !== null && !workspaceProvisioned(commonRoot)),
  };
}

export async function getAgyPoolUsage({
  settings = readSettings(),
  secrets = readAgyPoolSecrets(),
  fetchImpl = globalThis.fetch,
  fresh = false,
} = {}) {
  const { initialized, settings: merged } = livePoolSettings(settings);
  const roles = Object.fromEntries(await Promise.all(AGY_POOL_ROLES.map(async (role) => {
    if (!initialized) return [role, { state: 'uninitialized' }];
    const accountEpoch = agyAccountEpoch.get(role) || 0;
    const entry = merged.agy.workers[role];
    const health = await workerHealth(entry, { fetchImpl, expectedName: role });
    const lastAccount = lastObservedAgyAccounts.get(role) || null;
    if (!health.running) return [role, { state: 'offline', accountHandle: lastAccount }];
    if (health.checking) return [role, { state: 'busy', accountHandle: lastAccount }];
    if (!health.agyReady) return [role, { state: 'unavailable', accountHandle: lastAccount }];
    const token = resolveAgyWorkerToken(entry, { secrets });
    if (!token) return [role, { state: 'unavailable', accountHandle: lastAccount }];
    try {
      const usage = await fetchJson(workerUrl(entry, fresh ? '/usage?fresh=1' : '/usage'), { token, fetchImpl, timeoutMs: 30_000 });
      if (usage?.ok !== true || !usage.quotas || typeof usage.checkedAt !== 'string') return [role, { state: 'error' }];
      const accountHandle = normalizedAgyAccountHandle(usage.accountHandle);
      if (accountEpoch === (agyAccountEpoch.get(role) || 0)) {
        if (accountHandle) lastObservedAgyAccounts.set(role, accountHandle);
        else lastObservedAgyAccounts.delete(role);
        ineligibleAgyAccounts.delete(role);
      }
      return [role, { state: 'ready', quotas: usage.quotas, accountHandle, checkedAt: usage.checkedAt, workerStartedAt: usage.workerStartedAt, stale: Boolean(usage.stale) }];
    } catch (error) {
      const state = error?.statusCode === 409 ? 'busy' : error?.statusCode === 503 ? 'unavailable' : error?.statusCode ? 'error' : 'offline';
      return [role, { state, accountHandle: lastAccount }];
    }
  })));
  return { roles };
}

function waitForChildClose(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    child.once?.('error', (error) => done(reject, error));
    child.once?.('close', (code) => done(resolve, code));
  });
}

function execFilePromise(execFileImpl, file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || stdout || error.message).trim()));
      else resolve(stdout);
    });
  });
}

export async function ensureAgyRoleCredential({
  file = AGY_ROLE_CREDENTIAL_PATH,
  execFileImpl = execFile,
  random = () => `${randomBytes(24).toString('base64url')}!aA1`,
} = {}) {
  if (existsSync(file)) {
    try {
      await execFilePromise(
        execFileImpl,
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
          '$ErrorActionPreference="Stop"; $c=Import-Clixml -LiteralPath $env:AKI_AGY_ROLE_CRED_PATH; if(-not ($c -is [System.Management.Automation.PSCredential]) -or -not $c.Password){throw "invalid credential"}'],
        { env: { ...process.env, AKI_AGY_ROLE_CRED_PATH: file } },
      );
      return file;
    } catch {
      rmSync(file, { force: true });
    }
  }

  const password = random();
  const command = [
    '$ErrorActionPreference="Stop"',
    '$secure = ConvertTo-SecureString $env:AKI_AGY_ROLE_PASSWORD -AsPlainText -Force',
    '$cred = [System.Management.Automation.PSCredential]::new("AKIMCP\\agy-role", $secure)',
    '$cred | Export-Clixml -LiteralPath $env:AKI_AGY_ROLE_CRED_PATH -Encoding UTF8 -Force',
  ].join('; ');
  await execFilePromise(
    execFileImpl,
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    { env: { ...process.env, AKI_AGY_ROLE_PASSWORD: password, AKI_AGY_ROLE_CRED_PATH: file } },
  );
  try { rmSync(AGY_ROLE_LEGACY_CREDENTIAL_PATH, { force: true }); } catch {}
  if (!roleCredentialFileLooksValid(file)) throw new Error('failed to create AGY role credential');
  return file;
}

function hiddenPowerShellArgs(script, namedArgs) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script];
  for (const [name, value] of Object.entries(namedArgs)) {
    if (value === undefined || value === null || value === '') continue;
    args.push(`-${name}`, String(value));
  }
  return args;
}

async function stageWindowsRoleDir(user, prefix, { execFileImpl = execFile } = {}) {
  if (!/^[A-Za-z0-9_.\\-]+$/.test(user)) throw new Error('Windows user contains unsupported characters');
  const publicRoot = process.env.PUBLIC || path.join(process.env.SystemDrive || 'C:', 'Users', 'Public');
  const dir = path.join(publicRoot, `${prefix}-${randomUUID()}`);
  mkdirSync(dir, { recursive: false });
  const current = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${currentWindowsUser()}` : currentWindowsUser();
  try {
    await execFilePromise(execFileImpl, 'icacls.exe', [dir, '/inheritance:r', '/grant:r', `${current}:(OI)(CI)F`, `${user}:(OI)(CI)M`]);
    return dir;
  } catch (error) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    throw new Error(`could not stage AGY files for ${user}: ${error.message}`);
  }
}

async function stageWindowsTokenFile(user, token, { execFileImpl = execFile } = {}) {
  const tokenDir = await stageWindowsRoleDir(user, 'aki-agy-worker', { execFileImpl });
  const tokenFile = path.join(tokenDir, 'worker.token');
  try {
    writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    try { rmSync(tokenDir, { recursive: true, force: true }); } catch {}
    throw new Error(`could not stage worker secret for ${user}: ${error.message}`);
  }
  return { tokenFile, tokenDir };
}

const CROSS_USER_LAUNCHERS = {
  win32: async ({ role, entry, user, token, agyBinary, credentialFile, execFileImpl }) => {
    if (!existsSync(credentialFile)) throw new Error('role credential is not provisioned — click Create role identities');
    const { tokenFile, tokenDir } = await stageWindowsTokenFile(user, token, { execFileImpl });
    const resultFile = path.join(tokenDir, 'launch.result');
    const startupErrorFile = path.join(tokenDir, 'startup.error');
    try {
      await execFilePromise(execFileImpl, 'powershell.exe', hiddenPowerShellArgs(ROLE_PROCESS_SCRIPT, {
        Mode: 'worker',
        User: user,
        CredentialFile: credentialFile,
        AgyBin: agyBinary,
        NodeBin: process.execPath,
        WorkerBin: WORKER_BIN,
        Role: role,
        Port: portFromUrl(entry.url),
        Root: workerRoot(entry),
        TokenFile: tokenFile,
        StartupErrorFile: startupErrorFile,
        AllowedModes: entry.allowedModes.join(','),
        WorkingDirectory: REPO_ROOT,
        ResultFile: resultFile,
      }), {
        cwd: REPO_ROOT,
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      });
      let result = '';
      try { result = readFileSync(resultFile, 'utf8').trim(); } catch {}
      const launchMatch = /^OK:([1-9]\d*)$/.exec(result);
      if (!launchMatch) throw new Error('worker launcher did not confirm startup');
      try { rmSync(tokenDir, { recursive: true, force: true }); } catch {}
      return { launcher: 'hidden-powershell', launcherPid: Number(launchMatch[1]) };
    } catch {
      let detail = '';
      try {
        const result = readFileSync(resultFile, 'utf8').trim();
        if (result.startsWith('ERROR:')) detail = result.slice('ERROR:'.length).trim();
      } catch {}
      for (const [file, label] of [
        [tokenFile, '[token file]'],
        [startupErrorFile, '[startup diagnostic]'],
        [resultFile, '[result file]'],
        [tokenDir, '[staged files]'],
        [credentialFile, '[credential store]'],
      ]) detail = detail.replaceAll(file, label);
      try { rmSync(tokenDir, { recursive: true, force: true }); } catch {}
      throw new Error(`${role} Start failed: ${detail || 'hidden worker launcher exited without a diagnostic'}`);
    }
  },
};

const CROSS_USER_HINT = {
  win32: ' Verify the role has completed Login, then retry Start.',
};

async function launchWorkerProcess(role, entry, token, {
  spawnImpl = spawn,
  execFileImpl = execFile,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  const agyBinary = await resolveMainAgyBinary({ execFileImpl });
  if (!runsAsCurrentUser(entry.user)) {
    const launch = CROSS_USER_LAUNCHERS[process.platform];
    if (!launch) throw new Error('cross-user auto-launch is not available on this platform');
    return launch({ role, entry, user: entry.user, token, agyBinary, credentialFile, spawnImpl, execFileImpl });
  }

  const tokenEnv = 'AKI_AGY_WORKER_TOKEN';
  const args = buildWorkerArgs(role, entry, ['--token-env', tokenEnv], { agyBinary });
  const child = spawnImpl(process.execPath, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, [tokenEnv]: token },
  });
  child.unref?.();
  return { launcher: 'direct', launcherPid: child.pid || null };
}

async function waitForState(role, entry, wantRunning, {
  fetchImpl = globalThis.fetch,
  timeoutMs,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await workerHealth(entry, { fetchImpl, expectedName: role });
  while (last.running !== wantRunning && Date.now() < deadline) {
    await sleep(180);
    last = await workerHealth(entry, { fetchImpl, expectedName: role });
  }
  return last;
}

async function waitForReady(role, entry, {
  fetchImpl = globalThis.fetch,
  timeoutMs = READY_WAIT_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await workerHealth(entry, { fetchImpl, expectedName: role });
  while (last.running && !last.agyReady && !last.agyError && Date.now() < deadline) {
    await sleep(250);
    last = await workerHealth(entry, { fetchImpl, expectedName: role });
  }
  return last;
}

function summarizeAgyFailure(error) {
  const text = String(error || '').replace(/\s+/g, ' ').trim();
  if (/eligibility check failed|not eligible for antigravity|verify your account/i.test(text)) {
    return 'account is not eligible for Antigravity — click Logout, then Login with another eligible Google account';
  }
  if (/invalid_grant|authorization code|verification code|invalid code|expired code|code.*expired/i.test(text)) {
    return 'AGY sign-in failed — click Login and try again';
  }
  if (/not logged in|login required|unauthori[sz]ed|authentication failed|invalid credential/i.test(text)) {
    return 'AGY login is required — click Logout, then Login';
  }
  const redacted = text.replace(/https?:\/\/\S+/gi, '[link removed]');
  if (!redacted) return 'AGY readiness check failed';
  return redacted.length > 240 ? `${redacted.slice(0, 237)}…` : redacted;
}

async function stopFailedWorker(role, { settings, secrets, fetchImpl }) {
  try {
    const entry = roleEntry(role, settings);
    const health = await workerHealth(entry, { fetchImpl, expectedName: role });
    if (/account is not eligible/i.test(health.agyError || '')) ineligibleAgyAccounts.add(role);
    else ineligibleAgyAccounts.delete(role);
    const token = health.running && resolveAgyWorkerToken(entry, { secrets });
    if (token) {
      const identity = await fetchJson(workerUrl(entry, '/identity'), { token, fetchImpl, timeoutMs: HEALTH_TIMEOUT_MS });
      const accountHandle = normalizedAgyAccountHandle(identity?.accountHandle);
      if (accountHandle) lastObservedAgyAccounts.set(role, accountHandle);
    }
  } catch {}
  try {
    return await stopAgyPoolRole(role, { settings, secrets, fetchImpl });
  } catch {
    return null;
  }
}

function roleEntry(role, settings = readSettings()) {
  if (!AGY_POOL_ROLES.includes(role)) throw new Error(`unknown AGY role "${role}"`);
  const merged = withDefaultAgyPool(settings);
  return merged.agy.workers[role];
}

export async function provisionAgyRoleUsers({
  settings = readSettings(),
  spawnImpl = spawn,
  execFileImpl = execFile,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  if (process.platform !== 'win32') throw new Error('role identity provisioning is currently Windows-only');
  const workers = withDefaultAgyPool(settings).agy.workers;
  const workspaceRoot = workerRoot(workers.executor);
  if (AGY_POOL_ROLES.some((role) => !samePath(workerRoot(workers[role]), workspaceRoot))) {
    throw new Error('automatic provisioning requires the same root for all AGY roles — set the same root for all roles');
  }
  const agyBinary = await resolveMainAgyBinary({ execFileImpl });
  const ownerSid = await resolveCurrentUserSid({ execFileImpl });
  rmSync(PROVISION_MARKER_PATH, { force: true });
  if (samePath(workspaceRoot, AGY_POOL_WORKSPACE_ROOT)) mkdirSync(AGY_POOL_WORKSPACE_ROOT, { recursive: true });
  await ensureAgyRoleCredential({ file: credentialFile, execFileImpl });
  const resultFile = path.join(os.tmpdir(), `aki-agy-provision-${randomUUID()}.log`);
  const elevatedArgs = [
    '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',
    PROVISION_SCRIPT,
    '-AgyRoot', sharedAgyRoot(agyBinary),
    '-WorkspaceRoot', workspaceRoot,
    '-OwnerHome', os.homedir(),
    '-OwnerSid', ownerSid,
    '-CredentialFile', credentialFile,
    '-ResultFile', resultFile,
  ];
  const argList = elevatedArgs.map(psLiteral).join(',');
  const command = `$p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @(${argList}); exit $p.ExitCode`;
  const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  const code = await waitForChildClose(child);
  if (code !== 0) {
    let detail = '';
    try { detail = readFileSync(resultFile, 'utf8').trim(); } catch {}
    try { rmSync(resultFile, { force: true }); } catch {}
    throw new Error(detail || `role identity provisioning exited with code ${code}`);
  }
  try { rmSync(resultFile, { force: true }); } catch {}
  const missing = [];
  for (const user of FIXED_ROLE_USERS) if (!await windowsUserExists(user, { execFileImpl })) missing.push(user);
  if (missing.length) throw new Error(`role identities still missing: ${missing.join(', ')}`);
  writeFileSync(PROVISION_MARKER_PATH, `${JSON.stringify({ root: workspaceRoot })}\n`, { mode: 0o600 });
  return { ok: true, message: 'fixed AGY role identities are ready; Login opens one AGY CLI window for that role' };
}

export async function loginAgyPoolRole(role, {
  settings = readSettings(),
  spawnImpl = spawn,
  execFileImpl = execFile,
  fetchImpl = globalThis.fetch,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  if (process.platform !== 'win32') throw new Error('AGY login launcher is currently Windows-only');
  const entry = roleEntry(role, settings);
  const effectiveUser = entry.user || currentWindowsUser();
  if (!await windowsUserExists(entry.user, { execFileImpl })) {
    throw new Error(`${effectiveUser} does not exist — click Create role identities first`);
  }
  const health = await workerHealth(entry, { fetchImpl, expectedName: role });
  if (health.running) throw new Error(`${role} is running — click Stop before Login`);
  const agyBinary = await resolveMainAgyBinary({ execFileImpl });
  clearObservedAgyAccount(role);

  if (runsAsCurrentUser(entry.user)) {
    const child = spawnImpl('cmd.exe', ['/d', '/k', agyBinary], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref?.();
    return {
      ok: true,
      role,
      user: effectiveUser,
      launcherPid: child.pid || null,
      message: `${role} AGY CLI opened — sign in directly in that window; close it when done, then click Start`,
    };
  }

  if (!existsSync(credentialFile)) throw new Error('role credential is not provisioned — click Create role identities');
  const resultFile = path.join(os.tmpdir(), `aki-agy-login-${role}-${randomUUID()}.log`);
  try {
    await execFilePromise(execFileImpl, 'powershell.exe', hiddenPowerShellArgs(ROLE_PROCESS_SCRIPT, {
      Mode: 'login',
      User: effectiveUser,
      CredentialFile: credentialFile,
      AgyBin: agyBinary,
      WorkingDirectory: REPO_ROOT,
      ResultFile: resultFile,
    }), {
      cwd: REPO_ROOT,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    let result = '';
    try { result = readFileSync(resultFile, 'utf8').trim(); } catch {}
    const launchMatch = /^OK:([1-9]\d*)$/.exec(result);
    if (!launchMatch) throw new Error(result.replace(/^ERROR:/, '') || 'AGY login launcher did not confirm the CLI opened');
    return {
      ok: true,
      role,
      user: effectiveUser,
      launcherPid: Number(launchMatch[1]),
      message: `${role} AGY CLI opened — sign in directly in that window; close it when done, then click Start`,
    };
  } catch (error) {
    let result = '';
    try { result = readFileSync(resultFile, 'utf8').trim(); } catch {}
    if (result.startsWith('ERROR:')) {
      const detail = result.slice('ERROR:'.length).trim()
        .replaceAll(credentialFile, '[credential store]')
        .replaceAll(resultFile, '[result file]');
      throw new Error(`${role} Login failed: ${detail || 'role launcher reported an empty error'}`);
    }
    if (error?.message === 'AGY login launcher did not confirm the CLI opened') {
      throw new Error(`${role} Login failed: ${error.message}`);
    }
    throw new Error(`${role} Login failed: hidden launcher exited without a diagnostic — check role credentials and Windows permissions`);
  } finally {
    try { rmSync(resultFile, { force: true }); } catch {}
  }
}

export async function logoutAgyPoolRole(role, {
  settings = readSettings(),
  secrets = readAgyPoolSecrets(),
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  execFileImpl = execFile,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  const entry = roleEntry(role, settings);
  const effectiveUser = entry.user || currentWindowsUser();
  if (!await windowsUserExists(entry.user, { execFileImpl })) throw new Error(`${effectiveUser} does not exist`);
  try { await stopAgyPoolRole(role, { settings, secrets, fetchImpl }); } catch {}
  const cmd = 'cmdkey /delete:gemini:antigravity >nul 2>&1 & cmdkey /delete:gemini-cli-api-key/default-api-key >nul 2>&1 & exit /b 0';
  if (runsAsCurrentUser(entry.user)) {
    await execFilePromise(execFileImpl, 'cmd.exe', ['/d', '/c', cmd]);
  } else {
    if (!existsSync(credentialFile)) throw new Error('role credential is not provisioned — click Create role identities');
    await execFilePromise(execFileImpl, 'powershell.exe', hiddenPowerShellArgs(ROLE_PROCESS_SCRIPT, {
      Mode: 'logout',
      User: effectiveUser,
      CredentialFile: credentialFile,
      WorkingDirectory: REPO_ROOT,
    }));
  }
  clearObservedAgyAccount(role);
  return { ok: true, role, message: `${role} AGY credential cleared in background; click Login to choose another account` };
}

export async function startAgyPoolRole(role, {
  settings = readSettings(),
  secrets = readAgyPoolSecrets(),
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  execFileImpl = execFile,
  credentialFile = AGY_ROLE_CREDENTIAL_PATH,
} = {}) {
  const entry = roleEntry(role, settings);
  const effectiveUser = entry.user || currentWindowsUser();
  if (samePath(workerRoot(entry), AGY_POOL_WORKSPACE_ROOT) && !defaultWorkspaceReady()) {
    throw new Error('default AGY workspace is not provisioned — click Create role identities first');
  }
  if (!await windowsUserExists(entry.user, { execFileImpl })) {
    throw new Error(`${effectiveUser} does not exist — click Create role identities first`);
  }
  const existing = await workerHealth(entry, { fetchImpl, expectedName: role });
  if (existing.running) {
    if (existing.agyReady) return { ok: true, message: `${role} already ready · PID ${existing.pid}`, status: existing };
    if (existing.agyError) {
      const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
      return { ok: false, message: `${role}: ${summarizeAgyFailure(existing.agyError)}`, status: stopped?.status || existing };
    }
    const readiness = await waitForReady(role, entry, { fetchImpl });
    if (readiness.agyError) {
      const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
      return { ok: false, message: `${role}: ${summarizeAgyFailure(readiness.agyError)}`, status: stopped?.status || readiness };
    }
    if (!readiness.agyReady) {
      const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
      return { ok: false, message: `${role} worker did not become AGY-ready`, status: stopped?.status || readiness };
    }
    return { ok: true, message: `${role} ready · PID ${readiness.pid}`, status: readiness };
  }

  const token = resolveAgyWorkerToken(entry, { secrets });
  if (!token) throw new Error(`missing worker secret for ${role}; initialize the pool first`);

  clearObservedAgyAccount(role);
  const launch = await launchWorkerProcess(role, entry, token, { spawnImpl, execFileImpl, credentialFile });
  const status = await waitForState(role, entry, true, { fetchImpl, timeoutMs: START_WAIT_MS });
  if (!status.running) {
    const hint = !runsAsCurrentUser(entry.user) ? (CROSS_USER_HINT[process.platform] || '') : '';
    return { ok: false, launching: true, message: `${role} launch requested but health is not ready yet.${hint}`, launch, status };
  }
  if (status.agyAvailable === false) {
    const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
    return { ok: false, message: `${role} shared AGY executable is unavailable to ${effectiveUser}`, launch, status: stopped?.status || status };
  }
  const readiness = await waitForReady(role, entry, { fetchImpl });
  if (readiness.agyError) {
    const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
    return { ok: false, message: `${role}: ${summarizeAgyFailure(readiness.agyError)}`, launch, status: stopped?.status || readiness };
  }
  if (!readiness.agyReady) {
    const stopped = await stopFailedWorker(role, { settings, secrets, fetchImpl });
    return { ok: false, message: `${role} worker did not become AGY-ready`, launch, status: stopped?.status || readiness };
  }
  return { ok: true, message: `${role} ready · PID ${readiness.pid}`, launch, status: readiness };
}

export async function stopAgyPoolRole(role, {
  settings = readSettings(),
  secrets = readAgyPoolSecrets(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const entry = roleEntry(role, settings);
  const before = await workerHealth(entry, { fetchImpl, expectedName: role });
  if (!before.running) return { ok: true, message: `${role} already stopped`, status: before };
  const token = resolveAgyWorkerToken(entry, { secrets });
  if (!token) throw new Error(`missing worker secret for ${role}`);
  await fetchJson(workerUrl(entry, '/stop'), { method: 'POST', token, fetchImpl, timeoutMs: 2_000 });
  const status = await waitForState(role, entry, false, { fetchImpl, timeoutMs: STOP_WAIT_MS });
  return {
    ok: !status.running,
    message: status.running ? `${role} did not stop within ${STOP_WAIT_MS}ms` : `${role} stopped`,
    status,
  };
}

export async function startAgyPool(options = {}) {
  installDefaultAgyPool();
  ensureAgyPoolSecrets();
  const entries = await Promise.all(AGY_POOL_ROLES.map(async (role) => {
    try { return [role, await startAgyPoolRole(role, options)]; }
    catch (error) { return [role, { ok: false, message: error?.message || String(error) }]; }
  }));
  const results = Object.fromEntries(entries);
  const statusOptions = {};
  if (options.settings) statusOptions.settings = options.settings;
  if (options.fetchImpl) statusOptions.fetchImpl = options.fetchImpl;
  if (options.execFileImpl) statusOptions.execFileImpl = options.execFileImpl;
  if (options.credentialFile) statusOptions.credentialFile = options.credentialFile;
  return { ok: Object.values(results).every((r) => r.ok), results, status: await getAgyPoolStatus(statusOptions) };
}

export async function stopAgyPool(options = {}) {
  const results = {};
  for (const role of [...AGY_POOL_ROLES].reverse()) {
    try { results[role] = await stopAgyPoolRole(role, options); }
    catch (error) { results[role] = { ok: false, message: error?.message || String(error) }; }
  }
  return { ok: Object.values(results).every((r) => r.ok), results, status: await getAgyPoolStatus() };
}

export function initializeAgyPool() {
  const settings = installDefaultAgyPool();
  const secrets = ensureAgyPoolSecrets();
  return {
    ok: true,
    message: 'AGY pool initialized with fixed role identities; create missing identities, then Login each role once',
    workers: settings.agy.workers,
    secretCount: Object.keys(secrets).length,
  };
}

export { AGY_POOL_ROLES, DEFAULT_AGY_WORKERS };
