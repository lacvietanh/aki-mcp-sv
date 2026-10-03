// One JSON line per tools/call on the tools that drive browsers and AIObox windows, so misuse is measured instead of guessed: which client, which op, ok or not, how long. Written at the bridge, the only layer that sees the external session id and user agent. Never the arguments' text: no prompt, expression or compose text reaches this file.
import fs from 'node:fs';
import path from 'node:path';
import { USER_DIR } from './userdata.js';
import { VERSION } from './version.js';

export const TOOL_CALLS_PATH = path.join(USER_DIR, 'tool-calls.jsonl');
const ROTATE_BYTES = 1024 * 1024;
const LOGGED = /^aki__(aiobox|aiobox_write|chrome_\w+|devtools_\w+)$/;

export const isLoggedTool = (name) => LOGGED.test(String(name));

// Short scalar fields only, cut to fixed lengths; a non-string window or op is dropped, not stringified.
const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? v : undefined);

export function logToolCall({ sessionId, agent, params, response, ms }) {
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
    ok: !failed,
    error: short(errorText, 200),
    ms,
    version: VERSION,
  };
  try {
    if (fs.statSync(TOOL_CALLS_PATH, { throwIfNoEntry: false })?.size > ROTATE_BYTES) fs.renameSync(TOOL_CALLS_PATH, `${TOOL_CALLS_PATH}.1`);
    fs.appendFileSync(TOOL_CALLS_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch (e) {
    process.stderr.write(`[tool-calls] not logged: ${e.message}\n`);
  }
}
