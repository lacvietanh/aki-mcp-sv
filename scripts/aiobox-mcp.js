// AIObox windows: aki__aiobox reads, aki__aiobox_write acts. AkiMCP owns only the envelope, window identification and four transports; every op, its arguments and its refusals are AIObox's, published in ~/.aki/aiobox/akimcp-state.json.
// Frozen rows both ways: docs/plan/IMPORTANT-akimcp-aiobox-contract.md. Decisions: docs/plan/akimcp-aiobox-boundary-plan.md § 4.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ok, err } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import { VERSION } from './version.js';
import { aioboxDir, aioboxInstalled, windowsFile, GUIDE_URL, AIOBOX_PITCH } from './aiobox-guide.js';

const refreshFile = () => path.join(aioboxDir(), 'cdp', 'windows.refresh');
const stateFile = () => path.join(aioboxDir(), 'akimcp-state.json');
const guideFile = () => path.join(aioboxDir(), 'guide.md');
const requestsDir = () => path.join(aioboxDir(), 'requests');
const runsFile = () => path.join(aioboxDir(), 'automation.sqlite');

// The versions of the AIObox files this reader understands; a bump on either side is a deliberate release (plan § 4 I7).
const MAP_VERSION = 1;
const STATE_VERSION = 1;
const REQUEST_VERSION = 2;

const OP_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_READ_CAP = 4 * 1024 * 1024;

// One call ends within CALL_WAIT_MAX_S end to end: a client gives up after about a minute with nothing back.
export const CALL_WAIT_MAX_S = 50;
const callDeadline = new AsyncLocalStorage();
const timings = { callBudgetMs: null, requestPickupMs: 5_000, refreshWaitMs: 5_000 }; // callBudgetMs null: no extra cap; tests shorten any of them
export const setTimings = (patch) => Object.assign(timings, patch);
const deadlineAt = () => callDeadline.getStore();
const leftMs = () => { const deadline = deadlineAt(); return deadline === undefined ? Infinity : deadline - Date.now(); };
class OutOfTime extends Error {
  constructor() {
    super('out of time');
    this.outOfTime = true;
  }
}
// A page call raced against the time left: it ends at the deadline even if the page never answers (the CDP side is told the same bound, so its socket closes too).
function inTime(run) {
  const left = leftMs();
  if (left <= 0) return Promise.reject(new OutOfTime());
  if (left === Infinity) return run(undefined);
  let timer;
  const out = new Promise((_, reject) => { timer = setTimeout(() => reject(new OutOfTime()), left); });
  return Promise.race([run(Math.ceil(left) + 100), out]).finally(() => clearTimeout(timer));
}
const page = {
  evaluate: (opts) => inTime((bound) => cdp.evaluate(bound === undefined || (opts.timeoutMs !== undefined && opts.timeoutMs < bound) ? opts : { ...opts, timeoutMs: bound })),
  listTargets: (opts) => inTime(() => cdp.listTargets(opts)),
};
const sleep = (ms) => {
  const left = leftMs();
  if (left <= 0) return Promise.reject(new OutOfTime());
  return new Promise((r) => setTimeout(r, Math.min(ms, left)));
};
const withinCall = (waitS, run) => callDeadline.run(Date.now() + Math.min((waitS ?? CALL_WAIT_MAX_S) * 1000, timings.callBudgetMs ?? Infinity), run);

// AkiMCP's own refusal, told apart from AIObox's by `by: "akimcp"`: a stable code, why, and the one next step.
class Refusal extends Error {
  constructor(code, why, next, extra = {}) {
    super(why);
    this.code = code;
    this.next = next;
    this.extra = extra;
  }
}
const FILE_ERRORS = /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ELOOP|ENAMETOOLONG|EMFILE|ENFILE|EROFS|EIO|ENOSPC|EEXIST|ERR_SQLITE\w*)$/;
// Whatever is not already a Refusal: a file AkiMCP cannot read is no_file; a page, CDP or transport failure means AIObox is not answering.
const asRefusal = (e, request) => {
  if (e instanceof Refusal) return e;
  const [code, next] = FILE_ERRORS.test(String(e.code))
    ? ['no_file', 'check the file under ~/.aki/aiobox, or ask the owner to update AIObox']
    : ['app_not_listening', 'ask the owner to restart AIObox, then try again'];
  return request === undefined
    ? new Refusal(code, e.message, next)
    : new Refusal(code, e.message, `${next}; request ${request} may already have taken effect: find it in the runs (op=state names the op that reads them) before sending it again`, { request });
};
const refusalOut = (e) => err(JSON.stringify({ ok: false, by: 'akimcp', code: e.code, why: e.message, next: e.next, ...e.extra }, null, 2));
const NEXT_STATE = 'call aki__aiobox op=state and name the window by its handle';
const notRunning = () => new Refusal('not_running', 'AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)', 'ask the owner to open AIObox');

// Out of time: a read is safe to call again; a write may have acted, so it is checked before it is asked again.
const timeoutRefusal = (entry, mode, extra) => new Refusal(
  'timeout',
  "the call's deadline passed before AIObox finished",
  entry?.timeoutNext ?? (mode === 'write'
    ? 'it may have taken effect: check with a read op before trying again; never repeat it before reading'
    : 'call it again; out of time again: the tab may be frozen, so call op=state, or tell the owner'),
  extra,
);

const parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
const readJsonFile = (file) => {
  try {
    return parseJson(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// An AIObox file with a lower or unreadable version needs AIObox updated; a higher one needs AkiMCP updated.
function checkVersion(doc, supported, name) {
  const v = doc?.version;
  if (v === supported) return doc;
  const update = Number.isInteger(v) && v > supported ? 'AkiMCP' : 'AIObox';
  throw new Refusal('version_mismatch', `${name} is ${v === undefined ? 'unreadable or has no version' : `version ${v}`}, this AkiMCP ${VERSION} reads ${supported}`, `update ${update}`);
}

// Same rule as aiobox `cdp/handle.rs::parse_handle`: separators and case are ignored, so P7·W2, p7w2, P7.W2, P7-W2 and "P7 W2" are one handle; ·T# names a later tab.
export function parseHandle(input) {
  const compact = String(input).replace(/[·.\-_:/\s]/g, '').toUpperCase();
  const m = /^P(\d+)(?:W(\d+)(?:T(\d+))?)?$/.exec(compact);
  if (!m) return null;
  const [profile, window, tab] = m.slice(1).map((n) => (n === undefined ? null : Number(n)));
  if (profile < 1 || window === 0 || tab === 0) return null;
  return { profile, window, tab };
}

// A window's first tab carries the window's own handle; later tabs add ·T#.
export const formatHandle = (profile, window, tab) => (tab > 1 ? `P${profile}·W${window}·T${tab}` : `P${profile}·W${window}`);

const TITLE_SEP = ' · ';
// Only a handle in its written form is a prefix: a title that merely starts with "P3" is page text.
export function stripHandle(title = '') {
  const at = title.indexOf(TITLE_SEP);
  const [head, rest] = at === -1 ? [title, ''] : [title.slice(0, at), title.slice(at + TITLE_SEP.length)];
  const h = parseHandle(head);
  return h?.window && formatHandle(h.profile, h.window, h.tab) === head ? rest : title;
}

// Read on every call: AIObox rewrites the file whole whenever a window opens or closes, so a cached copy would name windows that are gone.
const appRunning = () => fs.existsSync(windowsFile());
function readMap() {
  if (!appRunning()) throw notRunning();
  return checkVersion(readJsonFile(windowsFile()), MAP_VERSION, 'windows.json');
}

// AIObox deletes windows.refresh and rewrites windows.json with answered = id (or a higher generation) once it re-read every profile.
const REFRESH_POLL_MS = 100;
let refreshSeq = 0;
async function refreshMap(before) {
  const id = `akimcp-${process.pid}-${Date.now()}-${(refreshSeq += 1)}`;
  const asked = Date.now();
  const tmp = `${refreshFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${id}\n`);
  fs.renameSync(tmp, refreshFile());
  for (const end = asked + timings.refreshWaitMs; Date.now() < end; await sleep(REFRESH_POLL_MS)) {
    let map;
    try {
      map = readMap();
    } catch {
      continue;
    }
    if (map.answered === id || (map.generation ?? 0) > (before.generation ?? 0)) return map;
  }
  try {
    if (fs.readFileSync(refreshFile(), 'utf8').trim() === id) fs.unlinkSync(refreshFile());
  } catch {}
  throw new Refusal('app_not_listening', `AIObox did not answer a window refresh within ${timings.refreshWaitMs / 1000}s`, 'ask the owner to restart AIObox');
}
const freshMap = () => refreshMap(readMap());

const tabsOf = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).flatMap((w) => (w.tabs || []).map((t) => ({ ...t, port: p.port }))));
const windowHandles = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).map((w) => w.handle));

// A handle AIObox retired at a handoff leads to the window that took over; the result says resolvedFrom.
function resolveTab(map, input) {
  const tabs = tabsOf(map);
  const h = parseHandle(input);
  const open = () => `open: ${windowHandles(map).join(', ') || 'none'}`;
  if (!h?.window) {
    const tab = tabs.find((t) => t.targetId === input || t.chatId === input);
    if (!tab) throw new Refusal('no_window', `no window '${input}'; ${open()}`, NEXT_STATE);
    return tab;
  }
  const asked = formatHandle(h.profile, h.window, h.tab);
  const tab = tabs.find((t) => t.handle === asked);
  if (tab) return tab;
  const retired = (map.retired ?? []).find((r) => r.handle === asked);
  const successor = retired && tabs.find((t) => t.handle === retired.end);
  if (successor) return { ...successor, resolvedFrom: asked };
  const note = retired ? ` (retired: ${asked} -> ${retired.end ?? 'nothing'}, which is not open)` : '';
  throw new Refusal('no_window', `no window '${input}'${note}; ${open()}`, NEXT_STATE);
}

// A target gone, or titled with another handle, means the map is stale: refuse rather than act on the wrong window.
async function liveTarget(tab) {
  const live = (await page.listTargets({ port: tab.port })).find((t) => t.id === tab.targetId);
  if (!live) throw new Refusal('stale_map', `window map is stale: ${tab.handle} (target ${tab.targetId}) is no longer open on port ${tab.port}`, NEXT_STATE);
  const head = (live.title || '').split(TITLE_SEP)[0];
  const h = parseHandle(head);
  if (h?.window && formatHandle(h.profile, h.window, h.tab) === head && head !== tab.handle) {
    throw new Refusal('stale_map', `window map is stale: target ${tab.targetId} is titled ${head}, not ${tab.handle}`, NEXT_STATE);
  }
  return live;
}

// Checked against the live target, so a handle that now names another chat is refused instead of acted on.
function checkExpect(tab, live, expect) {
  if (expect === undefined || expect === '') return;
  const url = live.url || tab.url || '';
  const title = stripHandle(live.title || tab.title || '');
  if (live.id === expect || url.includes(expect) || title.includes(expect)) return;
  throw new Refusal('wrong_window', `handle ${tab.handle} now shows "${title}" (${url}), not "${expect}"`, 'the window shows another chat now; find the right one with the guide and pass its handle');
}

// A miss asks AIObox to refresh the map once and decides on the new one; expect is never retried into a match.
async function openTab(window, expect) {
  const attempt = async (map) => {
    const tab = resolveTab(map, window);
    return { tab, live: await liveTarget(tab) };
  };
  const map = readMap();
  let found;
  try {
    found = await attempt(map);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    found = await attempt(await refreshMap(map).catch((r) => { throw r instanceof Refusal ? e : r; }));
  }
  checkExpect(found.tab, found.live, expect);
  const { tab } = found;
  return { ...found, used: { window: tab.handle, targetId: tab.targetId, ...(tab.resolvedFrom ? { resolvedFrom: tab.resolvedFrom } : {}) } };
}

// akipanel.call never rejects; the expression is built only by JSON.stringify, so no caller text is code.
const CALL_JS = (op, args, ctx) => `(async () => {
  const panel = window.akipanel;
  if (!panel) return { panel: 'none' };
  if (typeof panel.call !== 'function') return { panel: 'no_call' };
  return { panel: 'ok', result: await panel.call(${JSON.stringify(op)}, ${JSON.stringify(args ?? {})}, ${JSON.stringify(ctx)}) };
})()`;
async function callPanel(label, port, target, op, args, ctx) {
  const { value } = await page.evaluate({ port, target, expression: CALL_JS(op, args, ctx) });
  if (value?.panel === 'none') throw new Refusal('no_panel', `${label} has no AIObox panel`, 'the tab is not an AIObox window, or its panel has not loaded: reload the window');
  if (value?.panel !== 'ok') throw new Refusal('version_mismatch', `the AIObox panel in ${label} has no call`, 'reload the window or update AIObox');
  return value.result;
}
const panelCtx = (mode, call) => ({ deadlineAt: deadlineAt(), mode, expect: call.expect, from: call.from });

async function viaWindow({ op, mode, call }) {
  if (call.window === undefined) throw new Refusal('no_window', `op=${op} needs window`, NEXT_STATE);
  const { tab, live, used } = await openTab(call.window, call.expect);
  const result = await callPanel(tab.handle, tab.port, live, op, call.args, panelCtx(mode, call));
  return (result?.ok === true ? ok : err)(JSON.stringify({ ...result, ...used }, null, 2));
}

// Every live tab answers for itself: one frozen tab shows as its own timeout row and holds nobody else's.
async function viaEach({ op, entry, mode, call }) {
  const tabs = tabsOf(await freshMap());
  const ports = [...new Set(tabs.map((t) => t.port))];
  const liveByPort = new Map(await Promise.all(ports.map(async (port) => [port, await page.listTargets({ port })])));
  const rows = await Promise.all(tabs.map(async (t) => {
    const target = liveByPort.get(t.port).find((l) => l.id === t.targetId);
    try {
      if (!target) throw new Refusal('stale_map', `${t.handle} is no longer open on port ${t.port}`, NEXT_STATE);
      return { window: t.handle, ...(await callPanel(t.handle, t.port, target, op, call.args, panelCtx(mode, call))) };
    } catch (e) {
      const refusal = e.outOfTime ? timeoutRefusal(entry, mode) : asRefusal(e);
      return { window: t.handle, ok: false, by: 'akimcp', code: refusal.code, why: refusal.message, next: refusal.next };
    }
  }));
  return ok(JSON.stringify(rows, null, 2));
}

// window (the resolved targetId) and from ride beside the frozen envelope keys; AIObox answers with a runs row whose `request` is the id.
const REQUEST_POLL_MS = 250;
let requestSeq = 0;
const takeBack = (file) => {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false; // AIObox took it just now
    throw e;
  }
};
async function sendRequest(envelope) {
  fs.mkdirSync(requestsDir(), { recursive: true });
  const file = path.join(requestsDir(), `${envelope.id}.json`);
  const tmp = path.join(requestsDir(), `.${envelope.id}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(envelope)}\n`);
  fs.renameSync(tmp, file);
  try {
    for (const end = Date.now() + timings.requestPickupMs; fs.existsSync(file); await sleep(REQUEST_POLL_MS)) {
      if (Date.now() < end) continue;
      if (takeBack(file)) throw new Refusal('app_not_listening', `AIObox did not take request ${envelope.id} within ${timings.requestPickupMs / 1000}s; it was taken back`, 'ask the owner to start or update AIObox');
      break;
    }
  } catch (e) {
    if (e.outOfTime) takeBack(file);
    throw e;
  }
}
function readRun(request) {
  if (!fs.existsSync(runsFile())) return null;
  const db = new DatabaseSync(runsFile(), { readOnly: true });
  try {
    // AIObox rewrites a run while it runs; wait out its lock instead of failing with "database is locked".
    db.exec('PRAGMA busy_timeout = 2000');
    return db.prepare('SELECT outcome, detail FROM runs WHERE request = ? ORDER BY started_at DESC, id DESC LIMIT 1').get(request) ?? null;
  } finally {
    db.close();
  }
}
async function awaitRun(request) {
  for (;; await sleep(REQUEST_POLL_MS)) {
    let run = null;
    try {
      run = readRun(request);
    } catch (e) {
      if (!/database is (locked|busy)/i.test(String(e.message))) throw e;
    }
    if (run && run.outcome !== null) return run;
  }
}
async function viaRequest({ op, mode, call }) {
  const tab = call.window === undefined ? null : (await openTab(call.window, call.expect)).tab;
  const id = `akimcp-${process.pid}-${Date.now()}-${(requestSeq += 1)}`;
  let taken = false;
  try {
    await sendRequest({ version: REQUEST_VERSION, id, op, args: call.args ?? {}, at: new Date().toISOString(), deadline: deadlineAt(), mode, window: tab?.targetId, from: call.from });
    taken = true;
    const run = await awaitRun(id);
    return (run.outcome === 'ok' ? ok : err)(JSON.stringify({ request: id, outcome: run.outcome, detail: run.detail }, null, 2));
  } catch (e) {
    if (e.outOfTime || taken) e.request = id;
    throw e;
  }
}

// A file under ~/.aki/aiobox, read verbatim. `{x}` in the name is args.x, an id of [A-Za-z0-9_-] only; the name cannot leave the folder.
function fileUnder(template, args) {
  const rel = template.replace(/\{([^{}]+)\}/g, (_, key) => {
    const value = args?.[key];
    if (typeof value !== 'string' || !FILE_ID.test(value)) throw new Refusal('no_file', `args.${key} must match ${FILE_ID}`, 'pass it as the op guide says');
    return value;
  });
  const full = path.resolve(aioboxDir(), rel);
  if (rel.split(/[\\/]/).includes('..') || !full.startsWith(`${aioboxDir()}${path.sep}`)) throw new Refusal('no_file', `${rel} is outside ~/.aki/aiobox`, 'AIObox names a file inside its folder only');
  return full;
}
// null: no such file.
function readVerbatim(full) {
  let size;
  try {
    size = fs.statSync(full).size;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (size > FILE_READ_CAP) throw new Refusal('no_file', `${path.basename(full)} is ${size} bytes, over the ${FILE_READ_CAP} AkiMCP reads`, 'ask AIObox for a smaller file');
  return fs.readFileSync(full, 'utf8');
}
async function viaFile({ op, entry, call }) {
  if (typeof entry.file !== 'string') throw new Refusal('no_file', `op=${op} names no file`, 'update AIObox');
  const full = fileUnder(entry.file, call.args);
  if (full === windowsFile()) await freshMap();
  const text = readVerbatim(full);
  if (text === null) throw appRunning() ? new Refusal('no_file', `${path.relative(aioboxDir(), full)} does not exist`, 'check the args against op=state') : notRunning();
  return ok(text);
}

// The one op AkiMCP knows. It answers with the app off too: the guide and the op table are files.
function stateOut(ops) {
  const running = appRunning();
  const guide = readVerbatim(guideFile()) ?? `guide missing: update AIObox (${GUIDE_URL})`;
  return ok(JSON.stringify({ akimcp: VERSION, running, ...(running ? {} : { next: 'ask the owner to open AIObox; ops on files still answer' }), guide, ops }, null, 2));
}

const CHANNELS = { window: viaWindow, each: viaEach, request: viaRequest, file: viaFile };
const NEEDS_APP = new Set(['window', 'each', 'request']);

function routeOp(ops, op, mode) {
  const named = (name) => (Object.hasOwn(ops, name) ? ops[name] : null);
  let actual = op;
  let entry = named(op);
  // An alias row: AIObox publishes it and the new op validates its own args, so AkiMCP only follows the name.
  if (entry?.renamed !== undefined) {
    actual = entry.renamed;
    entry = named(actual);
  }
  if (!entry) throw new Refusal('unknown_op', `no op '${op}'; ops: ${Object.keys(ops).join(', ') || 'none'}`, 'call op=state: it lists every op with its args');
  if (mode === 'read' && entry.tool !== 'read') throw new Refusal('wrong_tool', `op=${actual} acts, so it is not a read`, 'call it with aki__aiobox_write');
  if (NEEDS_APP.has(entry.channel) && !appRunning()) throw notRunning();
  return { entry, actual, renamed: actual === op ? null : { from: op, to: actual } };
}

const withRenamed = (result, renamed) => (renamed ? { ...result, content: [...result.content, { type: 'text', text: `op=${renamed.from} is now op=${renamed.to}: AIObox renamed it, so call it by the new name` }] } : result);

const serve = (mode) => async ({ op, ...call }) => {
  let entry = null;
  let renamed = null;
  try {
    const result = await withinCall(call.wait, async () => {
      if (!aioboxInstalled()) throw new Refusal('not_running', 'AIObox is not installed here', AIOBOX_PITCH);
      const doc = readJsonFile(stateFile());
      const ops = checkVersion(doc, STATE_VERSION, 'akimcp-state.json').ops ?? {};
      if (op === 'state') return stateOut(ops);
      const route = routeOp(ops, op, mode);
      ({ entry, renamed } = route);
      const channel = Object.hasOwn(CHANNELS, entry.channel) ? CHANNELS[entry.channel] : null;
      if (!channel) throw new Refusal('version_mismatch', `op=${route.actual} uses channel '${entry.channel}', which this AkiMCP ${VERSION} does not have`, 'update AkiMCP');
      return channel({ op: route.actual, entry, mode, call });
    });
    return withRenamed(result, renamed);
  } catch (e) {
    const refusal = e.outOfTime ? timeoutRefusal(entry, mode, e.request === undefined ? {} : { request: e.request }) : e;
    return withRenamed(refusalOut(asRefusal(refusal, e.request)), renamed);
  }
};

// Detect by install (the ~/.aki/aiobox/ folder), not by AIObox running: a closed AIObox keeps its tools listed and answers "not running".
export const provider = {
  id: 'aiobox',
  title: 'AIObox windows',
  detect: () => (aioboxInstalled() ? { available: true } : { available: false, reason: `no ~/.aki/aiobox/. ${AIOBOX_PITCH}` }),
  register,
};

const envelope = {
  op: z.string().regex(OP_NAME).describe('op name; op=state lists them'),
  window: z.string().optional().describe('handle P#·W#, chatId or targetId'),
  expect: z.string().optional().describe("text the target chat's url or title must contain; refused if the window shows another"),
  wait: z.number().int().min(1).max(CALL_WAIT_MAX_S).optional().describe(`seconds this call may take (default and most ${CALL_WAIT_MAX_S})`),
  args: z.record(z.string(), z.any()).optional().describe('op arguments, as the guide says'),
};

export function register(server) {
  server.registerTool(
    'aiobox',
    {
      title: 'AIObox: read windows',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "AIObox windows. Call op=state first: it returns the guide and every op with its args. window = handle, chatId or targetId; expect = text the target chat's url or title must contain; args as the guide says. Each op's help in op=state overrides the guide. Reads only; to act use aki__aiobox_write.",
      inputSchema: envelope,
    },
    serve('read'),
  );

  server.registerTool(
    'aiobox_write',
    {
      title: 'AIObox: act in windows',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description: "AIObox windows, acting. Same envelope as aki__aiobox plus receipt (the sha256:... from aki__akidevrule_context); call its op=state first: op, window, expect, args as the guide says. Each op's help in op=state overrides the guide. from = your own window, so AIObox can refuse acting on yourself. One call takes at most 50 s.",
      inputSchema: { ...envelope, from: z.string().optional().describe('your own window') },
    },
    serve('write'),
  );
}
