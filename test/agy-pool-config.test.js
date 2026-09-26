#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGY_POOL_ROLES,
  AGY_POOL_WORKSPACE_ROOT,
  DEFAULT_AGY_WORKERS,
  ensureAgyPoolSecrets,
  installDefaultAgyPool,
  resolveAgyWorkerToken,
  withDefaultAgyPool,
} from '../scripts/agy-pool-config.js';
import { USER_DIR } from '../scripts/userdata.js';

assert.equal(AGY_POOL_WORKSPACE_ROOT, path.join(USER_DIR, 'agy-workspaces'));
for (const role of AGY_POOL_ROLES) {
  assert.equal(DEFAULT_AGY_WORKERS[role].root, AGY_POOL_WORKSPACE_ROOT);
}

const original = {
  folders: ['D:\\work'],
  shell: { allowlist: { added: ['git'], revoked: [] } },
  agy: {
    customField: 'keep-me',
    workers: { executor: { user: 'custom-executor', root: 'D:\\custom' } },
  },
};

const merged = withDefaultAgyPool(original);
assert.deepEqual(merged.folders, original.folders);
assert.deepEqual(merged.shell, original.shell);
assert.equal(merged.agy.customField, 'keep-me');
assert.deepEqual(merged.agy.allowedModes, ['plan', 'accept-edits']);
assert.equal(merged.agy.workers.executor.user, 'agy-executor', 'role identity must stay fixed');
assert.equal(merged.agy.workers.executor.root, 'D:\\custom');
assert.equal(merged.agy.workers.advisor.root, AGY_POOL_WORKSPACE_ROOT);
assert.equal(merged.agy.workers.advisor.secretRef, 'advisor');
assert.notEqual(merged.agy.workers, DEFAULT_AGY_WORKERS, 'worker map must be cloned before mutation');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-agy-pool-config-'));
const settingsPath = path.join(dir, 'setting.json');
const secretsPath = path.join(dir, 'secrets.json');
try {
  installDefaultAgyPool({ settings: original, settingsPath, secretsPath });
  const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(saved.folders, original.folders);
  assert.deepEqual(saved.shell, original.shell);
  assert.equal(saved.agy.customField, 'keep-me');
  assert.equal(saved.agy.workers.executor.user, 'agy-executor');
  assert.equal(saved.agy.workers.executor.root, 'D:\\custom');
  assert.equal(saved.agy.workers.reviewer.root, AGY_POOL_WORKSPACE_ROOT);

  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  assert.deepEqual(Object.keys(secrets).sort(), ['advisor', 'executor', 'experiment', 'reviewer']);
  assert.ok(Object.values(secrets).every((value) => typeof value === 'string' && value.length === 64));

  const same = ensureAgyPoolSecrets({ file: secretsPath, random: () => 'x'.repeat(64) });
  assert.deepEqual(same, secrets, 'existing secrets must be stable across init');

  assert.equal(resolveAgyWorkerToken({ tokenEnv: 'TOKEN' }, { env: { TOKEN: 'env-secret' }, secrets: {} }), 'env-secret');
  assert.equal(resolveAgyWorkerToken({ secretRef: 'advisor' }, { env: {}, secrets }), secrets.advisor);

  console.log('agy-pool-config.test.js: ok');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
