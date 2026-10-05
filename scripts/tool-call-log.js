// One JSON line per tool call, for every tool, so misuse is measured instead of guessed: which client, which op, ok or not, how long. Written at the bridge, the only layer that sees the external session id and user agent. Never the arguments' text: no prompt, expression or compose text reaches this file.
// The shape follows the owner's call-log decision (docs/plan/akimcp-tool-refactor.md § D9): every tool is logged, the default line is lean (basic), a detail level adds the full error text plus the from chat and macro, and keep-by-age cleanup (default 40 days) replaces the old 1 MB size rotation.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readSettings } from './allowlist.js';
import { USER_DIR } from './userdata.js';
import { VERSION } from './version.js';

export const TOOL_CALLS_PATH = path.join(USER_DIR, 'tool-calls.jsonl');

// The owner-decided defaults (D9). maxMB is this seat's proposal: keep-days is the real retention, and this only rolls the current file to a dated sidecar when it grows large, so report and tail reads never load one giant file.
export const LOG_DEFAULTS = Object.freeze({ enabled: true, level: 'basic', days: 40, maxMB: 16 });

// The bridge still gates on this name (streamable-bridge.js:218). D9 logs every tool, so the only filter left is that the name is a tool: every aki__ tool passes, non-string names (non-tool messages) do not.
export const isLoggedTool = (name) => typeof name === 'string' && name.startsWith('aki__');

const DATED_NAME = /^tool-calls-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.jsonl$/;
const REFUSAL = /\((\w+); next: /;
const dayOf = (d) => d.toISOString().slice(0, 10);

// Clamps a stored or incoming log section back onto the defaults; strict mode throws instead of falling back, so a panel save surfaces the mistake instead of silently widening or dropping logs.
export function normalizeLogSettings(log, { strict = false } = {}) {
  const s = log && typeof log === 'object' ? log : {};
  const bad = (m) => { if (strict) throw new Error(m); };
  let level = s.level ?? LOG_DEFAULTS.level;
  if (level !== 'basic' && level !== 'detail') { bad('level must be "basic" or "detail"'); level = LOG_DEFAULTS.level; }
  let days = s.days ?? LOG_DEFAULTS.days;
  if (!Number.isFinite(days) || days < 1) { bad('days must be a number ≥ 1'); days = LOG_DEFAULTS.days; }
  let maxMB = s.maxMB ?? LOG_DEFAULTS.maxMB;
  if (!Number.isFinite(maxMB) || maxMB < 1) { bad('maxMB must be a number ≥ 1'); maxMB = LOG_DEFAULTS.maxMB; }
  return { enabled: s.enabled !== false, level, days: Math.floor(days), maxMB: Math.floor(maxMB) };
}

// Fresh read on every call, the same as roots.js and the allowlist: a panel save applies to the next logged call, no restart.
export function loadLogSettings() {
  try {
    return normalizeLogSettings(readSettings().log);
  } catch (e) {
    process.stderr.write(`[tool-calls] ignoring malformed log settings: ${e.message}\n`);
    return { ...LOG_DEFAULTS };
  }
}

// What a client's tracing headers reduce to: a 12-hex SHA-256 of baggage (never its text) and the W3C trace id. The same value on every call of one chat would let a call name its own chat without op=whoami.
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
export function traceFields({ baggage, traceparent } = {}) {
  const out = {};
  if (typeof baggage === 'string' && baggage) out.baggage = crypto.createHash('sha256').update(baggage).digest('hex').slice(0, 12);
  const trace = typeof traceparent === 'string' && TRACEPARENT.exec(traceparent.trim().toLowerCase());
  if (trace && !/^0+$/.test(trace[1])) out.trace = trace[1];
  return out;
}

// What an eval does, as tags, so eval used to send or click shows in the counts without the script itself.
const EVAL_KINDS = ['click', 'submit', 'keydown', 'dispatchEvent', 'fetch', 'innerText'];
const evalKindOf = (expression) => (typeof expression === 'string' ? EVAL_KINDS.filter((k) => expression.includes(k)) : undefined);

export function errorCodeOf(message) {
  if (typeof message !== 'string' || !message) return undefined;
  const code = REFUSAL.exec(message)?.[1];
  if (code) return code;
  return message.includes('-32602') ? '-32602' : undefined;
}

const exprHashOf = (expression) => (typeof expression === 'string' && expression ? crypto.createHash('sha256').update(expression).digest('hex').slice(0, 12) : undefined);

// Short scalar fields only, cut to fixed lengths; a non-string window or op is dropped, not stringified.
const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? v : undefined);

// One entry per call, assembled without fs so the level split is unit-testable. Basic keeps the error code only; detail adds the full error text, the from chat, the macro and a 12-hex hash of the eval expression.
export function buildLogEntry({ sessionId, agent, headerNames, trace, params, response, ms }, settings, headersLogged = new Set()) {
  const args = params?.arguments || {};
  const result = response?.result;
  const failed = Boolean(response?.error) || result?.isError === true;
  const errorText = short(
    response?.error?.message ?? (failed ? result?.content?.find((c) => c.type === 'text')?.text : undefined),
    200,
  );
  const entry = {
    ts: new Date().toISOString(),
    client: short(sessionId, 8),
    agent: short(agent, 32),
    tool: short(params?.name, 40),
    op: short(args.op, 24),
    window: short(args.window, 48),
    port: short(args.port, 6),
    evalKind: evalKindOf(args.expression),
    ok: !failed,
    errorCode: errorCodeOf(errorText),
    ms,
    version: VERSION,
    ...traceFields(trace),
  };
  if (settings.level === 'detail') {
    entry.error = errorText;
    entry.from = short(args.from, 48);
    entry.macro = short(args.macro, 48);
    entry.exprHash = exprHashOf(args.expression);
  }
  if (sessionId && !headersLogged.has(sessionId)) {
    headersLogged.add(sessionId);
    entry.headers = (headerNames || []).slice(0, 40).map((h) => short(h, 40));
  }
  return entry;
}

export function datedLogFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => DATED_NAME.test(f)).map((f) => path.join(dir, f)).sort();
  } catch {
    return [];
  }
}

function freeDatedPath(dir, day) {
  const base = path.join(dir, `tool-calls-${day}.jsonl`);
  if (!fs.existsSync(base)) return base;
  let n = 2;
  while (fs.existsSync(path.join(dir, `tool-calls-${day}-${n}.jsonl`))) n += 1;
  return path.join(dir, `tool-calls-${day}-${n}.jsonl`);
}

// A file that is not today's, or already at the MB cap, rolls to a dated sidecar so the current file stays today-scoped and small. Sidecars older than keep-days are then deleted.
export function appendLogEntry(entry, { dir = USER_DIR, settings } = {}) {
  const maxMB = settings?.maxMB ?? LOG_DEFAULTS.maxMB;
  const days = settings?.days ?? LOG_DEFAULTS.days;
  const file = path.join(dir, 'tool-calls.jsonl');
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat && stat.size > 0) {
    const fileDay = dayOf(new Date(stat.mtime));
    if (fileDay !== dayOf(new Date()) || stat.size >= maxMB * 1024 * 1024) {
      try { fs.renameSync(file, freeDatedPath(dir, fileDay)); } catch {}
    }
  }
  const cutoff = dayOf(new Date(Date.now() - days * 86_400_000));
  for (const f of datedLogFiles(dir)) {
    if (DATED_NAME.exec(path.basename(f))[1] < cutoff) { try { fs.unlinkSync(f); } catch {} }
  }
  try {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch (e) {
    process.stderr.write(`[tool-calls] not logged: ${e.message}\n`);
  }
}

const headersLogged = new Set();

export function logToolCall({ sessionId, agent, headerNames, trace, params, response, ms }) {
  const settings = loadLogSettings();
  if (!settings.enabled) return;
  appendLogEntry(
    buildLogEntry({ sessionId, agent, headerNames, trace, params, response, ms }, settings, headersLogged),
    { settings },
  );
}
