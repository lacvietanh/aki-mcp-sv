// The one place that knows what the agy CLI offers: it runs `agy --version`, `agy models`, `agy --help` and 0-token `agy -p "/usage" --output-format json`, parses them, and caches per authenticated account (docs/plan/done/agy-run-tier-and-long-run.md). agy-mcp.js holds no model list, no effort/mode/output-format enum — this module reads them live so a new agy release needs no AkiMCP edit.
// The model list is server-side and plan-scoped: each account's cache lives 1 h (1 min when the models probe failed), /usage has a 30 s micro-TTL (bypassed on refresh()), and a probe that fails leaves its field null (pass-through).
import { execFile, spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { containedIn } from './roots.js';
import { launchOf } from './find-on-path.js';
import { killProcessGroup, supportsDetachedProcessGroup } from './task-mcp.js';

export const PROBE_TIMEOUT_MS = 15_000;
export const TTL_MS = 60 * 60_000;
export const RETRY_MS = 60_000;
export const USAGE_TTL_MS = 30_000;
export const FRAME_MAX_AGE_MS = 6 * 60 * 60_000;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_TIER_BYTES = 4 * 1024;
const MAX_PROBE_LOG_BYTES = 1024 * 1024;
const SAFE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Defaults are injectable so the fixture tests exercise the parsers and resolver with recorded CLI text and never spawn agy.
function runAgy(args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile('agy', args, { cwd, timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      // agy prints "Fetching available models…" and some notices to stderr while the payload goes to stdout; a non-zero exit with usable stdout is still parsed.
      resolve({ ok: !error || Boolean(stdout?.trim()), stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// `agy models` lines are `id<TAB>label`; the "Fetching…" progress line and anything without a tab are dropped. Empty or unparsable output → null (pass-through), never [].
export function parseModels(text) {
  const rows = String(text).split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.includes('\t'))
    .map((line) => { const i = line.indexOf('\t'); return { id: line.slice(0, i).trim(), label: line.slice(i + 1).trim() }; })
    .filter((m) => /^[\w.-]+$/.test(m.id));
  return rows.length ? rows : null;
}

// `agy --help` lists each enum after its flag as `(a|b|c)` or `(a, b, c)`. The flag must start the line so another flag's prose cannot match.
export function parseHelpEnum(text, flag) {
  const line = String(text).split('\n').find((l) => new RegExp(`^\\s*--${flag}(\\s|$)`).test(l));
  if (!line) return null;
  const m = line.match(/\(([^()]*)\)/);
  if (!m) return null;
  const values = m[1].split(/[|,]/).map((v) => v.trim()).filter(Boolean);
  return values.length ? values : null;
}

// Discovery default (Q3 / D2): newest gemini-<n>-flash-high (numeric segment compare so 3.10 beats 3.9), falling back to -flash-medium when -high is absent; null when neither exists.
const versionKey = (v) => v.split('.').map(Number);
function versionGreater(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
function newestMatching(models, pattern) {
  let best = null;
  let bestKey = null;
  for (const m of models) {
    const match = pattern.exec(m.id);
    if (!match) continue;
    const key = versionKey(match[1]);
    if (!bestKey || versionGreater(key, bestKey)) { bestKey = key; best = m.id; }
  }
  return best;
}
export function defaultFlashModel(models) {
  if (!Array.isArray(models)) return null;
  return newestMatching(models, /^gemini-(\d+(?:\.\d+)?)-flash-high$/)
    ?? newestMatching(models, /^gemini-(\d+(?:\.\d+)?)-flash-medium$/);
}

// Extract the authenticated OAuth email from agy's --log-file. Raw log text never leaves the probe.
export function parseAuthEmail(logText) {
  if (typeof logText !== 'string' || !logText) return null;
  const matches = [...logText.matchAll(/OAuth:\s+authenticated successfully as\s+([^\s]+)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const email = matches[i][1].trim();
    if (SAFE_EMAIL.test(email)) return email;
  }
  return null;
}

// Normalize usage groups from both live `agy -p "/usage" --output-format json` and .frame line 2 (B5c).
export function normalizeUsageGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const out = [];
  for (const g of groups) {
    if (!g || typeof g.name !== 'string' || !Array.isArray(g.buckets)) continue;
    const buckets = g.buckets
      .filter((b) => b && typeof b.id === 'string')
      .map((b) => ({
        id: b.id,
        ...(typeof b.name === 'string' && b.name ? { name: b.name } : {}),
        window: typeof b.window === 'string' ? b.window : null,
        remainingFraction: typeof b.remaining_fraction === 'number' ? b.remaining_fraction : null,
        resetTime: typeof b.reset_time === 'string' ? b.reset_time : null,
      }));
    if (buckets.length) out.push({ name: g.name, buckets });
  }
  return out.length ? out : null;
}

export function parseUsageJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    const groups = normalizeUsageGroups(parsed?.command?.data?.groups);
    return groups ? { source: 'live', groups } : null;
  } catch {
    return null;
  }
}

export function parseFrameText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  let email = null;
  let planTier = null;
  let groups = null;
  try {
    const header = JSON.parse(lines[0]);
    if (typeof header?.email === 'string' && SAFE_EMAIL.test(header.email)) email = header.email;
    if (typeof header?.userTier?.name === 'string' && header.userTier.name.trim()) planTier = header.userTier.name.trim();
  } catch {
    return null;
  }
  if (lines[1]) {
    try {
      const payload = JSON.parse(lines[1]);
      groups = normalizeUsageGroups(payload?.command?.data?.groups);
    } catch {}
  }
  return { email, planTier, groups };
}

function readEmailScopedFile(baseDir, email, suffix, maxBytes) {
  if (typeof email !== 'string' || !SAFE_EMAIL.test(email)) return null;
  const root = path.resolve(baseDir);
  const candidates = [...new Set([`${email}${suffix}`, `${email.toLowerCase()}${suffix}`])];
  for (const name of candidates) {
    const abs = path.resolve(root, name);
    if (!containedIn(abs, root)) continue;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size === 0 || st.size > maxBytes) continue;
      return { text: fs.readFileSync(abs, 'utf8'), mtimeMs: st.mtimeMs };
    } catch {}
  }
  return null;
}

export function readLocalPlanTier(account, { homeDir = os.homedir() } = {}) {
  if (!account) return null;
  const dir = path.join(homeDir, '.gemini', 'antigravity-cli', 'aki-plan-tier');
  const hit = readEmailScopedFile(dir, account, '', MAX_TIER_BYTES);
  if (!hit) return null;
  const line = hit.text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line || null;
}

export function readLocalQuotaFrame(account, { homeDir = os.homedir(), now = Date.now } = {}) {
  if (!account) return null;
  const dir = path.join(homeDir, '.gemini', 'antigravity-cli', 'rate-limits');
  const hit = readEmailScopedFile(dir, account, '.frame', MAX_FRAME_BYTES);
  if (!hit) return null;
  const parsed = parseFrameText(hit.text);
  if (!parsed) return null;
  const ageMs = Math.max(0, now() - hit.mtimeMs);
  const quota = parsed.groups && ageMs <= FRAME_MAX_AGE_MS
    ? { source: 'frame', groups: parsed.groups, updatedAt: new Date(hit.mtimeMs).toISOString() }
    : null;
  return { email: parsed.email, planTier: parsed.planTier, quota };
}

// Model-family tier requirements (B3): only plan-gated families live here (no pinned version IDs, no Starter/all-plan row).
const GATED_MODEL_FAMILIES = [
  { pattern: /carbon/i, plans: ['Google AI Ultra'] },
  { pattern: /^gemini-4-|argon|neon|hydrogen|orchestrator/i, plans: ['Google AI Pro', 'Google AI Ultra'] },
];

function planSatisfies(planTier, requiredPlans) {
  if (typeof planTier !== 'string' || !planTier.trim()) return false;
  const lower = planTier.toLowerCase();
  return requiredPlans.some((req) => {
    const reqLower = req.toLowerCase();
    const short = reqLower.replace(/^google ai\s+/, '');
    return lower === reqLower || (short.length >= 3 && new RegExp(`\\b${short}\\b`).test(lower));
  });
}

// Explain why an explicit model is absent from the active account's live model list (B3).
export function explainMissingModel(model, planTier, availableModels) {
  const availableText = Array.isArray(availableModels) && availableModels.length
    ? availableModels.map((m) => m.id).join(', ')
    : 'unavailable';
  const gated = GATED_MODEL_FAMILIES.find((g) => g.pattern.test(String(model)));
  if (gated && !planSatisfies(planTier, gated.plans)) {
    const tierLabel = planTier || 'unknown plan';
    return {
      kind: 'plan_mismatch',
      requiredPlans: gated.plans,
      message: `Plan "${tierLabel}" does not include model "${model}" (available on: ${gated.plans.join(', ')}). Models available on this account: ${availableText}.`,
    };
  }
  return {
    kind: 'unknown_model',
    requiredPlans: null,
    message: `Model "${model}" is not available on this account${planTier ? ` (plan: ${planTier})` : ''}. Valid models now: ${availableText}.`,
  };
}

// 0-token live /usage probe (B5b): writes stdout + --log-file inside a 0o700 tmpdir, kills process group on timeout, removes tmpdir in finally, never exposes raw log.
export function runUsageProbe({ timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let tmpDir = null;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-usage-'));
      try { fs.chmodSync(tmpDir, 0o700); } catch {}
    } catch {
      return resolve({ ok: false, account: null, groups: null });
    }

    const outFile = path.join(tmpDir, 'usage.json');
    const logFile = path.join(tmpDir, 'cli.log');
    let outFd;
    try {
      outFd = fs.openSync(outFile, 'w');
    } catch {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return resolve({ ok: false, account: null, groups: null });
    }

    const cleanup = () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    };

    let child;
    try {
      child = spawnProcess(
        ...launchOf('agy', ['--log-file', logFile, '--output-format', 'json', '-p', '/usage']),
        {
          cwd: os.tmpdir(),
          detached: supportsDetachedProcessGroup(),
          stdio: ['ignore', outFd, 'ignore'],
          windowsHide: true,
        },
      );
    } catch {
      try { fs.closeSync(outFd); } catch {}
      cleanup();
      return resolve({ ok: false, account: null, groups: null });
    } finally {
      try { fs.closeSync(outFd); } catch {}
    }

    let settled = false;
    let timedOut = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let account = null;
      let groups = null;
      try {
        if (fs.existsSync(logFile)) {
          const st = fs.statSync(logFile);
          if (st.isFile() && st.size > 0 && st.size <= MAX_PROBE_LOG_BYTES) {
            account = parseAuthEmail(fs.readFileSync(logFile, 'utf8'));
          }
        }
      } catch {}
      try {
        if (fs.existsSync(outFile)) {
          const st = fs.statSync(outFile);
          if (st.isFile() && st.size > 0 && st.size <= MAX_FRAME_BYTES) {
            groups = parseUsageJson(fs.readFileSync(outFile, 'utf8'))?.groups ?? null;
          }
        }
      } catch {}
      cleanup();
      resolve({ ok: Boolean(ok && !timedOut && (account || groups)), account, groups });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, 'SIGKILL');
      finish(false);
    }, timeoutMs);

    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
  });
}

const accountCaches = new Map(); // accountKey -> { version, models, modes, efforts, outputFormats, at, ttl }
let usageCache = null; // { account, groups, at }
let lastAccountKey = null;

// One probe of the three capability commands; each field is null when its command failed or parsed to nothing.
export async function probe({ spawn = runAgy, cwd, now = Date.now } = {}) {
  const ver = await spawn(['--version'], { cwd });
  const version = ver.ok ? ver.stdout.trim() || null : null;
  const [models, help] = await Promise.all([spawn(['models'], { cwd }), spawn(['--help'], { cwd })]);
  const helpText = help.ok ? help.stderr + '\n' + help.stdout : '';
  return {
    version,
    models: models.ok ? parseModels(models.stdout) : null,
    modes: parseHelpEnum(helpText, 'mode'),
    efforts: parseHelpEnum(helpText, 'effort'),
    outputFormats: parseHelpEnum(helpText, 'output-format'),
    at: now(),
  };
}

async function resolveUsage({ probeUsage, homeDir, now, forceUsage }) {
  let raw = usageCache;
  if (forceUsage || !raw || now() - raw.at >= USAGE_TTL_MS) {
    const res = await probeUsage();
    raw = {
      account: typeof res?.account === 'string' && SAFE_EMAIL.test(res.account) ? res.account : null,
      groups: Array.isArray(res?.groups) && res.groups.length ? res.groups : null,
      at: now(),
    };
    usageCache = raw;
  }

  const account = raw.account;
  const frame = account ? readLocalQuotaFrame(account, { homeDir, now }) : null;
  const planTier = account ? (readLocalPlanTier(account, { homeDir }) ?? frame?.planTier ?? null) : null;
  const quota = raw.groups
    ? { source: 'live', groups: raw.groups }
    : (frame?.quota ?? null);

  return { account, planTier, quota };
}

async function loadForAccount({ accountKey, spawn, cwd, now }) {
  const fresh = await probe({ spawn, cwd, now });
  const prev = accountCaches.get(accountKey);
  const entry = fresh.models
    ? { ...fresh, ttl: TTL_MS }
    : { ...(prev?.models ? prev : fresh), at: fresh.at, ttl: RETRY_MS };
  accountCaches.set(accountKey, entry);
  return entry;
}

const noopUsage = () => Promise.resolve({ ok: false, account: null, groups: null });

// Lazily probed and cached per authenticated account (D1, Q2, B2).
export async function capabilities({
  spawn = runAgy,
  probeUsage,
  cwd,
  homeDir = os.homedir(),
  now = Date.now,
  includeUsage = false,
  verifyAccount = false,
} = {}) {
  const usageFn = probeUsage ?? (spawn === runAgy ? runUsageProbe : noopUsage);
  let usage = null;
  if (includeUsage || verifyAccount || !lastAccountKey) {
    usage = await resolveUsage({ probeUsage: usageFn, homeDir, now, forceUsage: false });
  }
  const accountKey = usage?.account || lastAccountKey || '__default__';
  lastAccountKey = accountKey;

  const cached = accountCaches.get(accountKey);
  const entry = cached && now() - cached.at < cached.ttl
    ? cached
    : await loadForAccount({ accountKey, spawn, cwd, now });

  const account = usage?.account ?? (accountKey === '__default__' ? null : accountKey);
  const planTier = usage
    ? usage.planTier
    : (account ? (readLocalPlanTier(account, { homeDir }) ?? readLocalQuotaFrame(account, { homeDir, now })?.planTier ?? null) : null);

  return {
    ...entry,
    account,
    planTier,
    quota: usage?.quota ?? null,
  };
}

// Forced re-probe: bypasses both the 30 s /usage micro-TTL (Q2) and the 1 h per-account cache.
export async function refresh({
  spawn = runAgy,
  probeUsage,
  cwd,
  homeDir = os.homedir(),
  now = Date.now,
} = {}) {
  const usageFn = probeUsage ?? (spawn === runAgy ? runUsageProbe : noopUsage);
  const usage = await resolveUsage({ probeUsage: usageFn, homeDir, now, forceUsage: true });
  const accountKey = usage.account || lastAccountKey || '__default__';
  lastAccountKey = accountKey;
  const entry = await loadForAccount({ accountKey, spawn, cwd, now });
  return {
    ...entry,
    account: usage.account,
    planTier: usage.planTier,
    quota: usage.quota,
  };
}

// Test seam: drop all per-account and /usage caches so a test starts cold.
export function resetUsageCache() {
  usageCache = null;
}

export function resetCache() {
  accountCaches.clear();
  usageCache = null;
  lastAccountKey = null;
}
