// One JSON line per tools/call on the tools that drive browsers and AIObox windows, so misuse is measured instead of guessed: which client, which op, ok or not, how long. Written at the bridge, the only layer that sees the external session id and user agent. Never the arguments' text: no prompt, expression or compose text reaches this file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { USER_DIR } from './userdata.js';
import { VERSION } from './version.js';

export const TOOL_CALLS_PATH = path.join(USER_DIR, 'tool-calls.jsonl');
const ROTATE_BYTES = 1024 * 1024;
const LOGGED = /^aki__(aiobox|aiobox_write|chrome_\w+|devtools_\w+)$/;

export const isLoggedTool = (name) => LOGGED.test(String(name));

// What an eval does, as tags, so eval used to send or click shows in the counts without the script itself.
const EVAL_KINDS = ['click', 'submit', 'keydown', 'dispatchEvent', 'fetch', 'innerText'];
const evalKindOf = (expression) => (typeof expression === 'string' ? EVAL_KINDS.filter((k) => expression.includes(k)) : undefined);
// The request header names of each client, once per session: if a provider sends a conversation id, a call could name its own chat without op=whoami.
const headersLogged = new Set();

// Whether a client's tracing headers name its chat: `baggage` as a 12-hex SHA-256 (never its text: it may carry ids or user data) and the trace id of a W3C `traceparent`. The same value on every call of one chat, and another on the next chat, would let a call name its own chat without op=whoami.
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
export function traceFields({ baggage, traceparent } = {}) {
  const out = {};
  if (typeof baggage === 'string' && baggage) out.baggage = crypto.createHash('sha256').update(baggage).digest('hex').slice(0, 12);
  const trace = typeof traceparent === 'string' && TRACEPARENT.exec(traceparent.trim().toLowerCase());
  if (trace && !/^0+$/.test(trace[1])) out.trace = trace[1];
  return out;
}

// Short scalar fields only, cut to fixed lengths; a non-string window or op is dropped, not stringified.
const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? v : undefined);

export function logToolCall({ sessionId, agent, headerNames, trace, params, response, ms }) {
  const args = params?.arguments || {};
  const result = response?.result;
  const failed = Boolean(response?.error) || result?.isError === true;
  const errorText = response?.error?.message ?? (failed ? result?.content?.find((c) => c.type === 'text')?.text : undefined);
  const entry = {
    ts: new Date().toISOString(),
    client: short(sessionId, 8),
    agent: short(agent, 32),
    tool: short(params?.name, 40),
    op: short(args.op, 24),
    window: short(args.window, 48),
    port: short(args.port, 6),
    from: short(args.from, 48),
    macro: short(args.macro, 48),
    evalKind: evalKindOf(args.expression),
    ok: !failed,
    error: short(errorText, 200),
    ms,
    version: VERSION,
    ...traceFields(trace),
  };
  if (sessionId && !headersLogged.has(sessionId)) {
    headersLogged.add(sessionId);
    entry.headers = (headerNames || []).slice(0, 40).map((h) => short(h, 40));
  }
  try {
    if (fs.statSync(TOOL_CALLS_PATH, { throwIfNoEntry: false })?.size > ROTATE_BYTES) fs.renameSync(TOOL_CALLS_PATH, `${TOOL_CALLS_PATH}.1`);
    fs.appendFileSync(TOOL_CALLS_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch (e) {
    process.stderr.write(`[tool-calls] not logged: ${e.message}\n`);
  }
}
