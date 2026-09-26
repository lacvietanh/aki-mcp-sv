import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readSettings } from './allowlist.js';
import { USER_DIR, SETTINGS_PATH, AGY_POOL_SECRETS_PATH } from './userdata.js';

export const AGY_POOL_ROLES = Object.freeze(['advisor', 'executor', 'experiment', 'reviewer']);
export const AGY_POOL_WORKSPACE_ROOT = path.join(USER_DIR, 'agy-workspaces');

export const DEFAULT_AGY_WORKERS = Object.freeze({
  advisor: {
    url: 'http://127.0.0.1:7411',
    secretRef: 'advisor',
    user: '',
    root: AGY_POOL_WORKSPACE_ROOT,
    allowedModes: ['plan'],
  },
  executor: {
    url: 'http://127.0.0.1:7412',
    secretRef: 'executor',
    user: 'agy-executor',
    root: AGY_POOL_WORKSPACE_ROOT,
    allowedModes: ['plan', 'accept-edits'],
  },
  experiment: {
    url: 'http://127.0.0.1:7413',
    secretRef: 'experiment',
    user: 'agy-experiment',
    root: AGY_POOL_WORKSPACE_ROOT,
    allowedModes: ['plan', 'accept-edits'],
  },
  reviewer: {
    url: 'http://127.0.0.1:7414',
    secretRef: 'reviewer',
    user: 'agy-reviewer',
    root: AGY_POOL_WORKSPACE_ROOT,
    allowedModes: ['plan'],
  },
});

function writeJsonAtomic(file, data, mode = 0o600) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  renameSync(tmp, file);
}

export function readAgyPoolSecrets(file = AGY_POOL_SECRETS_PATH) {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function ensureAgyPoolSecrets({
  file = AGY_POOL_SECRETS_PATH,
  secrets = readAgyPoolSecrets(file),
  random = () => randomBytes(32).toString('hex'),
} = {}) {
  const next = { ...secrets };
  let changed = false;
  for (const role of AGY_POOL_ROLES) {
    if (typeof next[role] === 'string' && next[role].length >= 32) continue;
    next[role] = random();
    changed = true;
  }
  if (changed || !existsSync(file)) writeJsonAtomic(file, next);
  return next;
}

export function resolveAgyWorkerToken(worker, {
  env = process.env,
  secrets = readAgyPoolSecrets(),
} = {}) {
  if (typeof worker.tokenEnv === 'string' && worker.tokenEnv) {
    const value = env[worker.tokenEnv];
    if (value) return value;
  }
  if (typeof worker.secretRef === 'string' && worker.secretRef) {
    const value = secrets[worker.secretRef];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export function withDefaultAgyPool(settings = {}) {
  const currentWorkers = settings.agy?.workers && typeof settings.agy.workers === 'object' && !Array.isArray(settings.agy.workers)
    ? settings.agy.workers
    : {};
  const workers = {};
  for (const role of AGY_POOL_ROLES) {
    workers[role] = {
      ...DEFAULT_AGY_WORKERS[role],
      ...(currentWorkers[role] || {}),
      user: DEFAULT_AGY_WORKERS[role].user,
    };
  }
  return {
    ...settings,
    agy: {
      ...settings.agy,
      allowedModes: ['plan', 'accept-edits'],
      workers,
    },
  };
}

export function installDefaultAgyPool({
  settings = readSettings(),
  settingsPath = SETTINGS_PATH,
  secretsPath = AGY_POOL_SECRETS_PATH,
} = {}) {
  const next = withDefaultAgyPool(settings);
  writeJsonAtomic(settingsPath, next);
  ensureAgyPoolSecrets({ file: secretsPath });
  return next;
}

export function printAgyPoolSummary(out = process.stdout) {
  out.write([
    `AGY worker pool configured in ${SETTINGS_PATH}`,
    `Worker secrets generated in ${AGY_POOL_SECRETS_PATH}`,
    'Daily control is available from the AKIMCP panel; no four-terminal workflow is required.',
    'First-time Windows/AGY account sign-in is still per identity.',
    '',
  ].join('\n'));
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      'Usage: aki-agy-pool-init',
      '',
      'Adds/repairs the default advisor/executor/experiment/reviewer worker map and generates local worker secrets.',
      'Existing unrelated settings and non-identity worker customizations are preserved; role Windows identities are fixed.',
      'AGY OAuth credentials are never read or written.',
      '',
    ].join('\n'));
    return;
  }
  if (argv.length) throw new Error(`unknown argument: ${argv[0]}`);
  installDefaultAgyPool();
  printAgyPoolSummary();
}
