import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { DEFAULT_AGY_TIMEOUT_MS, runAgyProcess, runAgyUsageProcess } from './agy-runner.js';

const BODY_LIMIT = 1024 * 1024;
const RUN_SCHEMA = z.object({
  prompt: z.string().min(1),
  mode: z.string().default('plan'),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  outputFormat: z.enum(['text', 'json']).optional(),
  cwd: z.string().optional(),
});

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function tokenMatches(header, expected) {
  const prefix = 'Bearer ';
  if (typeof header !== 'string' || !header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

function isWithinRoot(candidate, root) {
  const fold = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const rel = path.relative(fold(root), fold(candidate));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function findAgyBinary(explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    return existsSync(resolved) ? resolved : null;
  }
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, ['agy'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 });
  }
}

export async function startAgyWorker(
  {
    name = 'worker',
    port,
    root = process.cwd(),
    allowedModes = ['plan'],
    token,
    agyBin,
    verifyAgy = true,
    timeoutMs = DEFAULT_AGY_TIMEOUT_MS,
  },
  { runProcess = runAgyProcess, readUsage = runAgyUsageProcess } = {},
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer from 0 to 65535');
  if (!token) throw new Error('worker token is required');
  if (!Array.isArray(allowedModes) || !allowedModes.length || !allowedModes.every((m) => typeof m === 'string' && m)) {
    throw new Error('allowedModes must contain at least one mode');
  }

  const workerRoot = path.resolve(root);
  const realWorkerRoot = realpathSync(workerRoot);
  const modes = new Set(allowedModes);
  const startedAt = new Date().toISOString();
  const agyPath = findAgyBinary(agyBin);
  let busy = false;
  let activeRun = null;
  let checking = Boolean(agyPath && verifyAgy);
  let readinessRun = null;
  let agyReady = Boolean(agyPath && !verifyAgy);
  let agyError = agyPath ? null : 'AGY executable not found';
  let accountHandle = null;
  let usageCache = null;
  let usageRead = null;
  let usageRun = null;
  let usageDirty = false;
  let usageGeneration = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, name, pid: process.pid, startedAt, root: workerRoot, busy: busy || checking, checking, agyAvailable: Boolean(agyPath), agyReady, agyError, agyPath, allowedModes: [...modes] });
        return;
      }

      const usageRequest = req.method === 'GET' && url.pathname === '/usage';
      const identityRequest = req.method === 'GET' && url.pathname === '/identity';
      if (!usageRequest && !identityRequest && (req.method !== 'POST' || !['/run', '/stop'].includes(url.pathname))) {
        sendJson(res, 404, { ok: false, error: 'not found' });
        return;
      }

      if (!tokenMatches(req.headers.authorization, token)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (identityRequest) {
        sendJson(res, 200, { ok: true, accountHandle });
        return;
      }

      if (url.pathname === '/stop') {
        activeRun?.abort();
        readinessRun?.abort();
        usageRun?.abort();
        sendJson(res, 200, { ok: true, message: `${name} stopping`, pid: process.pid });
        setImmediate(() => server.close());
        return;
      }

      if (checking) {
        sendJson(res, 409, { ok: false, error: `worker "${name}" is checking AGY login/eligibility` });
        return;
      }

      if (!agyReady) {
        sendJson(res, 503, { ok: false, error: agyError || `worker "${name}" is not AGY-ready` });
        return;
      }

      if (usageRequest) {
        if (busy) {
          if (usageCache) sendJson(res, 200, { ok: true, ...usageCache, stale: true });
          else sendJson(res, 409, { ok: false, error: `worker "${name}" is busy` });
          return;
        }
        if (usageCache && !usageDirty && url.searchParams.get('fresh') !== '1' && Date.now() - Date.parse(usageCache.checkedAt) < 120_000) {
          sendJson(res, 200, { ok: true, ...usageCache, stale: false });
          return;
        }
        if (!usageRead) {
          const controller = new AbortController();
          const generation = usageGeneration;
          usageRun = controller;
          usageRead = Promise.resolve().then(() => readUsage(agyPath, { cwd: workerRoot, signal: controller.signal }))
            .then((reading) => {
              if (generation !== usageGeneration) throw new Error('AGY usage read was superseded by a job');
              const quotas = reading?.quotas || reading;
              const observedHandle = reading?.accountHandle || null;
              accountHandle = observedHandle;
              usageCache = { quotas, accountHandle, checkedAt: new Date().toISOString(), workerStartedAt: startedAt };
              usageDirty = false;
              return usageCache;
            }).finally(() => { usageRead = null; usageRun = null; });
        }
        sendJson(res, 200, { ok: true, ...await usageRead, stale: false });
        return;
      }

      const parsed = RUN_SCHEMA.safeParse(await readJson(req));
      if (!parsed.success) {
        sendJson(res, 400, { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') });
        return;
      }

      const input = parsed.data;
      if (!modes.has(input.mode)) {
        sendJson(res, 403, { ok: false, error: `mode "${input.mode}" is not allowed by worker "${name}"` });
        return;
      }

      const cwd = path.resolve(input.cwd || workerRoot);
      if (!isWithinRoot(cwd, workerRoot)) {
        sendJson(res, 403, { ok: false, error: `cwd is outside worker root: ${workerRoot}` });
        return;
      }
      const realCwd = realpathSync(cwd);
      if (!isWithinRoot(realCwd, realWorkerRoot)) {
        sendJson(res, 403, { ok: false, error: `cwd is outside worker root: ${workerRoot}` });
        return;
      }

      if (busy) {
        sendJson(res, 409, { ok: false, error: `worker "${name}" is busy` });
        return;
      }

      usageRun?.abort();
      usageGeneration += 1;
      usageDirty = true;
      busy = true;
      activeRun = new AbortController();
      try {
        const text = await runProcess({ ...input, cwd: realCwd, agyBin: agyPath || 'agy' }, { timeoutMs, signal: activeRun.signal });
        sendJson(res, 200, { ok: true, text });
      } finally {
        activeRun = null;
        busy = false;
      }
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      sendJson(res, status, { ok: false, error: error?.message || String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  if (checking) {
    readinessRun = new AbortController();
    void runProcess({
      prompt: 'Reply exactly AKI_READY. Do not inspect files or perform any other task.',
      mode: 'plan',
      cwd: workerRoot,
      agyBin: agyPath,
    }, {
      timeoutMs: Math.min(timeoutMs, 45_000),
      signal: readinessRun.signal,
    }).then(() => {
      agyReady = true;
      agyError = null;
    }).catch(async (error) => {
      if (!readinessRun.signal.aborted) {
        try {
          const reading = await readUsage(agyPath, { cwd: workerRoot, timeoutMs: 12_000, signal: readinessRun.signal });
          accountHandle = reading?.accountHandle || null;
        } catch (probeError) {
          accountHandle = probeError?.accountHandle || null;
        }
      }
      agyReady = false;
      agyError = error?.message || String(error);
    }).finally(() => {
      readinessRun = null;
      checking = false;
    });
  }

  return server;
}

function parseArgs(argv) {
  const out = {
    name: 'worker',
    port: null,
    root: process.cwd(),
    tokenEnv: 'AKI_AGY_WORKER_TOKEN',
    token: null,
    tokenFile: null,
    agyBin: null,
    allowedModes: ['plan'],
    timeoutMs: DEFAULT_AGY_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === '--name') out.name = value;
    else if (flag === '--port') out.port = Number(value);
    else if (flag === '--root') out.root = value;
    else if (flag === '--token-env') out.tokenEnv = value;
    else if (flag === '--token') out.token = value;
    else if (flag === '--token-file') out.tokenFile = value;
    else if (flag === '--agy-bin') out.agyBin = value;
    else if (flag === '--allowed-modes') out.allowedModes = value.split(',').map((v) => v.trim()).filter(Boolean);
    else if (flag === '--timeout-ms') out.timeoutMs = Number(value);
    else throw new Error(`unknown argument: ${flag}`);
  }

  return out;
}

function usage() {
  return [
    'Usage: aki-agy-worker --port <n> [options]',
    '',
    'Options:',
    '  --name <role>             Worker name shown by /health',
    '  --root <path>             Allowed cwd root (default: current directory)',
    '  --token-env <ENV>         Env var containing bearer token (default: AKI_AGY_WORKER_TOKEN)',
    '  --token <secret>          Bearer token (legacy/manual; prefer env or token file)',
    '  --token-file <path>       Read bearer token once from file, then delete the file',
    '  --agy-bin <path>          Explicit shared AGY executable path',
    '  --allowed-modes <csv>     Worker-side mode allowlist (default: plan)',
    '  --timeout-ms <n>          Per-AGY process timeout (default: 120000)',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage() + '\n');
    return;
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error('--port is required and must be 1..65535');
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1) throw new Error('--timeout-ms must be a positive number');

  let token = args.token || process.env[args.tokenEnv];
  if (!token && args.tokenFile) {
    token = readFileSync(args.tokenFile, 'utf8').trim();
    try { unlinkSync(args.tokenFile); } catch {}
  }
  if (!token) throw new Error(`missing worker token (--token, --token-file, or env ${args.tokenEnv})`);

  const server = await startAgyWorker({ ...args, token });
  const address = server.address();
  process.stdout.write(`[agy-worker:${args.name}] http://127.0.0.1:${address.port} root=${path.resolve(args.root)} modes=${args.allowedModes.join(',')}\n`);
}
