// Dedicated MCP tool for the `agy` CLI. The default path executes the local CLI directly; an optional named worker routes the same request to a loopback worker running under a different OS login, which gives AGY an independent credential vault without copying OAuth material into Aki MCP.
import { z } from 'zod';
import { readSettings } from './allowlist.js';
import { resolveOrFail } from './roots.js';
import { ok, err } from './mcp-tool.js';
import { DEFAULT_AGY_MODEL, runAgyProcess } from './agy-runner.js';
import { readAgyPoolSecrets, resolveAgyWorkerToken } from './agy-pool-config.js';

const DEFAULT_MODES = ['plan'];
const REMOTE_TIMEOUT_MS = 125_000;
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/;

export function loadAllowedModes(settings = readSettings()) {
  const configured = settings.agy?.allowedModes;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_MODES;
}

export function resolveWorkerConfig(name, settings = readSettings(), env = process.env, secrets = readAgyPoolSecrets()) {
  const workers = settings.agy?.workers;
  if (!workers || typeof workers !== 'object' || Array.isArray(workers)) {
    throw new Error('rejected: no AGY workers are configured in setting.json');
  }

  const entry = workers[name];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`rejected: unknown AGY worker "${name}"`);
  }

  let base;
  try {
    base = new URL(entry.url);
  } catch {
    throw new Error(`rejected: AGY worker "${name}" has an invalid url`);
  }
  if (!LOOPBACK_URL.test(entry.url) || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port) {
    throw new Error(`rejected: AGY worker "${name}" url must be loopback HTTP`);
  }

  if (entry.tokenEnv !== undefined && (typeof entry.tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.tokenEnv))) {
    throw new Error(`rejected: AGY worker "${name}" has invalid tokenEnv`);
  }
  if (entry.secretRef !== undefined && (typeof entry.secretRef !== 'string' || !entry.secretRef)) {
    throw new Error(`rejected: AGY worker "${name}" has invalid secretRef`);
  }
  const token = resolveAgyWorkerToken(entry, { env, secrets });
  if (!token) throw new Error(`rejected: missing AGY worker token for "${name}"`);

  let allowedModes = null;
  if (entry.allowedModes !== undefined) {
    if (!Array.isArray(entry.allowedModes) || !entry.allowedModes.length || !entry.allowedModes.every((m) => typeof m === 'string' && m)) {
      throw new Error(`rejected: AGY worker "${name}" allowedModes must be a non-empty string array`);
    }
    allowedModes = entry.allowedModes;
  }

  return {
    name,
    runUrl: new URL('/run', base).toString(),
    token,
    allowedModes,
  };
}

export async function runRemoteWorker(worker, payload, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(worker.runUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${worker.token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`AGY worker "${worker.name}" returned invalid JSON (HTTP ${response.status})`);
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `AGY worker "${worker.name}" failed with HTTP ${response.status}`);
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    throw new Error(`AGY worker "${worker.name}" returned no output`);
  }
  return body.text;
}

export async function executeAgy(
  { prompt, mode, model, effort, outputFormat, cwd, worker },
  {
    settings = readSettings(),
    env = process.env,
    secrets = readAgyPoolSecrets(),
    resolveCwd = resolveOrFail,
    runLocal = runAgyProcess,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const useMode = mode ?? 'plan';
  const allowed = loadAllowedModes(settings);
  if (!allowed.includes(useMode)) {
    throw new Error(`rejected: mode "${useMode}" is not allowlisted (allowed: ${allowed.join(', ')})`);
  }

  const resolved = !worker || cwd !== undefined ? resolveCwd(cwd) : null;
  if (resolved && !resolved.ok) throw resolved.error;
  const payload = {
    prompt,
    mode: useMode,
    model: model ?? DEFAULT_AGY_MODEL,
    effort,
    outputFormat,
    ...(resolved && { cwd: resolved.dir }),
  };

  if (!worker) return runLocal(payload);

  const workerConfig = resolveWorkerConfig(worker, settings, env, secrets);
  if (workerConfig.allowedModes && !workerConfig.allowedModes.includes(useMode)) {
    throw new Error(`rejected: mode "${useMode}" is not allowlisted for AGY worker "${worker}"`);
  }
  return runRemoteWorker(workerConfig, payload, { fetchImpl });
}

export function register(server) {
  server.registerTool(
    'agy_run',
    {
      title: 'Antigravity CLI',
      description:
        'Run the agy CLI for retrieval/delegation. Defaults to local mode "plan" (read-only by mechanism) and model ' +
        `"${DEFAULT_AGY_MODEL}". Other modes must be allowlisted in setting.json under agy.allowedModes. ` +
        'Optional worker selects a named AGY worker on http://127.0.0.1 from agy.workers, allowing separate OS-login credential contexts. ' +
        'Name exact paths and the exact output shape in the prompt — agy\'s workspace index can resolve files outside cwd, so cwd is not a hard scope boundary. ' +
        'prompt is passed straight to agy as one argument — no shell quoting, spaces/punctuation are safe as-is.',
      inputSchema: {
        prompt: z.string(),
        mode: z.string().optional().describe('agy --mode, defaults to "plan"'),
        model: z.string().optional().describe(`agy --model, defaults to "${DEFAULT_AGY_MODEL}". Valid ids depend on the installed agy CLI`),
        effort: z.enum(['low', 'medium', 'high']).optional().describe('agy --effort, thinking budget'),
        outputFormat: z.enum(['text', 'json']).optional().describe('agy --output-format, use "json" when a program parses the result'),
        cwd: z.string().optional().describe('run inside this project dir; must be under an allowed root'),
        worker: z.string().optional().describe('named entry under setting.json -> agy.workers; omit to use the current OS account'),
      },
    },
    async (input) => {
      try {
        return ok(await executeAgy(input));
      } catch (error) {
        return err(error?.message || String(error));
      }
    },
  );
}
