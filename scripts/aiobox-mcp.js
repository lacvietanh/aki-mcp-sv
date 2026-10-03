// AIObox windows by handle (P7·W2): aki__aiobox reads, aki__aiobox_write runs JS. Built on cdp-engine.js the way postman-mcp.js is: AIObox knowledge lives here, devtools_* stay app-agnostic.
// Contract with aiobox (windows.json shape, handle forms, akipanel.live.chat()): docs/plan/IMPORTANT-akimcp-aiobox-contract.md. Plan: docs/plan/provider-toolkit-architecture.md § Provider aiobox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ok, okImage, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import { USER_DIR } from './userdata.js';
import { VERSION } from './version.js';

// Resolved per call, not at import: HOME is read when the tool runs, so a test (or a changed HOME) is honored.
const aioboxDir = () => path.join(os.homedir(), '.aki', 'aiobox');
const windowsFile = () => path.join(aioboxDir(), 'cdp', 'windows.json');
// What this server last saw of the map, kept on disk so the renumbering check survives an AkiMCP restart too. AkiMCP's own data dir, never AIObox's.
const seenFile = () => path.join(USER_DIR, 'aiobox-seen.json');

const MAP_VERSION = 1;
const CHAT_VERSION = 1; // akipanel.capabilities.chat: the shape of live.chat() this reader understands
const COMPOSE_VERSION = 2; // akipanel.capabilities.compose: live.compose(text) returns a Promise of { ok, error }
const SEND_VERSION = 1; // akipanel.capabilities.send: live.send(text) resolves { ok: true } once the new user message shows in chat(), else { ok: false, error } and nothing sent (empty text, busy, draft in the composer)
const RAW_TEXT_CAP = 20_000; // codepoints of page text returned by op=read without a provider reader; the tail is kept, since the latest message is at the end
const TEXT_ELEMENTS_CAP = 50;
const TEXT_ELEMENT_CAP = 4_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A refusal an AI can act on: a stable code, the one next step, and the running version (a client whose cached tool schema lacks an op can compare with op=state's ops).
class Refusal extends Error {
  constructor(code, message, next) {
    super(`${message} (${code}; next: ${next}; akimcp ${VERSION})`);
    this.code = code;
  }
}
const NEXT_STATE = 'call aki__aiobox op=state and name the window by its chatId';

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

// Provider ids as aiobox names them (desktop/src/domain/provider.ts), keyed by origin host.
const PROVIDER_BY_HOST = {
  'app.notion.com': 'notion',
  'chatgpt.com': 'gpt',
  'claude.ai': 'claude',
  'grok.com': 'grok',
  'gemini.google.com': 'gemini',
  'mail.google.com': 'gmail',
  'dash.cloudflare.com': 'cloudflare',
};
function providerOf(url) {
  try {
    return PROVIDER_BY_HOST[new URL(url).host] || null;
  } catch {
    return null;
  }
}

// The chat id in a provider URL: the one name of a conversation that survives an AIObox or Chrome restart (Notion ?t=<id>, ChatGPT and Grok /c/<id>, Claude /chat/<id>, Gemini /app/<id>). A handle is only the label AIObox gives the window now.
export function chatIdOf(url) {
  try {
    const u = new URL(url);
    if (u.host === 'app.notion.com') return u.searchParams.get('t') || null;
    return /^\/(?:c|chat|app)\/([\w-]+)/.exec(u.pathname)?.[1] || null;
  } catch {
    return null;
  }
}

// Read on every call: AIObox rewrites the file whole whenever a window opens or closes, so a cached copy would name windows that are gone.
// Every read also compares the map with the one seen before (observe), so a call learns when handles moved.
function readMap() {
  let raw;
  let writtenAt;
  try {
    const fd = fs.openSync(windowsFile(), 'r');
    try {
      raw = fs.readFileSync(fd, 'utf8');
      writtenAt = fs.fstatSync(fd).mtime.toISOString();
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e.code === 'ENOENT') throw new Refusal('not_running', 'AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)', 'ask the owner to start AIObox');
    throw e;
  }
  const map = JSON.parse(raw);
  if (map.version !== MAP_VERSION) throw new Error(`windows.json version ${map.version} is not supported (expected ${MAP_VERSION}); update AkiMCP or AIObox`);
  // AIObox's run (desktop 0.8.0+): epoch = ms its run started (a new one = AIObox restarted), appPid, generation = writes in this run, updatedAt. Older AIObox writes none; writtenAt (the file's mtime) is always there.
  map.run = { epoch: map.epoch ?? null, appPid: map.appPid ?? null, generation: map.generation ?? null, updatedAt: map.updatedAt ?? null, writtenAt };
  map.renumbered = observe(map);
  return map;
}

// Ask AIObox to re-read every profile's windows now (desktop 0.8.0+, contract § Định danh bền): one line id in windows.refresh, AIObox deletes it and rewrites windows.json with answered = id. Any later write of the same run (higher generation, or a new epoch) also answers it, so two callers that overwrite each other's id both return; no clock is compared. The only file AkiMCP writes under ~/.aki/aiobox/.
const refreshFile = () => path.join(aioboxDir(), 'cdp', 'windows.refresh');
const REFRESH_WAIT_MS = 5_000;
const REFRESH_POLL_MS = 100;
let refreshSeq = 0;
async function refreshMap(before) {
  const id = `akimcp-${process.pid}-${Date.now()}-${(refreshSeq += 1)}`;
  const asked = Date.now();
  const tmp = `${refreshFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${id}\n`);
  fs.renameSync(tmp, refreshFile());
  for (const end = asked + REFRESH_WAIT_MS; Date.now() < end; await sleep(REFRESH_POLL_MS)) {
    let map;
    try {
      map = readMap();
    } catch {
      continue;
    }
    const newer = map.run.epoch !== before.epoch || (map.run.generation ?? 0) > (before.generation ?? 0);
    if (map.answered === id || newer) return map;
  }
  try {
    if (fs.readFileSync(refreshFile(), 'utf8').trim() === id) fs.unlinkSync(refreshFile());
  } catch {}
  throw new Error(`AIObox did not answer a window refresh within ${REFRESH_WAIT_MS / 1000}s`);
}

// The map to act on: when AIObox can refresh (its map carries epoch), op=windows always asks first, so the list is never older than this call.
async function freshMap() {
  const map = readMap();
  return map.run.epoch === null ? map : refreshMap(map.run);
}

const tabsOf = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).flatMap((w) => (w.tabs || []).map((t) => ({ ...t, port: p.port, profile: p }))));
const windowHandles = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).map((w) => w.handle));
const appKey = (run) => (run.epoch === null ? null : `${run.appPid}@${run.epoch}`);

function readSeen() {
  try {
    const seen = JSON.parse(fs.readFileSync(seenFile(), 'utf8'));
    return seen && typeof seen.byTarget === 'object' ? seen : null;
  } catch {
    return null;
  }
}

// Handles AIObox gives out live only in its memory: an AIObox restart starts every Chrome at W1 again, and a new Chrome does too, so one handle can name another chat than it did a minute ago and nothing errors. Compared by targetId (same tab, new handle) and by handle (same handle, another tab), against the last map this server saw. The newest renumbering is kept until a later one replaces it, so every caller can still learn of it.
function observe(map) {
  const tabs = tabsOf(map).filter((t) => t.handle);
  const byTarget = Object.fromEntries(tabs.map((t) => [t.targetId, t.handle]));
  const chatOf = Object.fromEntries(tabs.map((t) => [t.targetId, chatIdOf(t.url)]));
  const prev = readSeen();
  const app = appKey(map.run);
  let last = prev?.last || null;
  if (prev) {
    const prevByHandle = Object.fromEntries(Object.entries(prev.byTarget).map(([id, h]) => [h, id]));
    const changes = [];
    for (const t of tabs) {
      const was = prev.byTarget[t.targetId];
      const heldBy = prevByHandle[t.handle];
      if (was && was !== t.handle) changes.push({ handle: t.handle, was, targetId: t.targetId, chatId: chatOf[t.targetId] });
      else if (!was && heldBy && heldBy !== t.targetId) changes.push({ handle: t.handle, was: `${t.handle} of another tab (target ${heldBy}${prev.chatOf?.[heldBy] ? `, chat ${prev.chatOf[heldBy]}` : ''})`, targetId: t.targetId, chatId: chatOf[t.targetId] });
    }
    // Any change of the app block is a new AIObox run: one that starts writing it (an upgrade) restarted too.
    const restarted = (prev.app ?? null) !== app;
    if (changes.length || restarted) last = { since: prev.at, detectedAt: new Date().toISOString(), restarted, changes };
  }
  const same = prev && (prev.app ?? null) === app && JSON.stringify(prev.byTarget) === JSON.stringify(byTarget);
  if (!same) {
    try {
      fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
      const tmp = `${seenFile()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ at: map.run.updatedAt ?? map.run.writtenAt, app, byTarget, chatOf, last }), { mode: 0o600 });
      fs.renameSync(tmp, seenFile());
    } catch (e) {
      process.stderr.write(`[aiobox] ${seenFile()} not written: ${e.message}\n`);
    }
  }
  return last;
}

// A window is named by its handle (the current label), its CDP targetId, or its chat id (stable across restarts).
function resolveTab(map, input) {
  const h = parseHandle(input);
  const tabs = tabsOf(map);
  const tab = h?.window
    ? tabs.find((t) => t.handle === formatHandle(h.profile, h.window, h.tab))
    : tabs.find((t) => t.targetId === input) || tabs.find((t) => chatIdOf(t.url) === input);
  if (!tab) throw new Refusal('no_window', `no window '${input}'; open: ${windowHandles(map).join(', ') || 'none'}`, NEXT_STATE);
  return tab;
}

// expect: the tab the caller means, as a targetId, chat id, or text its url or title contains. Checked against the live target, so a handle that now names another chat is refused instead of acted on.
function checkExpect(tab, live, expect) {
  if (expect === undefined || expect === '') return;
  const url = live.url || tab.url || '';
  const title = stripHandle(live.title || tab.title || '');
  const chatId = chatIdOf(url);
  if (live.id === expect || tab.targetId === expect || chatId === expect || url.includes(expect) || title.includes(expect)) return;
  throw new Refusal('wrong_window', `handle ${tab.handle} now points to "${title}" (${chatId ? `chat ${chatId}` : `target ${tab.targetId}`}), not "${expect}"; handles were renumbered or reassigned`, NEXT_STATE);
}

// Every op on a window says which tab it used, by stable id too, and warns when that tab's handle moved in the newest renumbering.
function usedTab(tab, live, map) {
  const url = live?.url || tab.url;
  const out = { window: tab.handle, targetId: tab.targetId, chatId: chatIdOf(url), url };
  const r = map.renumbered;
  const hit = r?.changes?.some((c) => c.handle === tab.handle || c.targetId === tab.targetId);
  if (hit && Date.now() - Date.parse(r.detectedAt) < WARN_FOR_MS) out.warning = renumberWarning(r);
  return out;
}
// How long an op on a renumbered window keeps warning; op=windows reports the newest renumbering for as long as it is the newest.
const WARN_FOR_MS = 2 * 60 * 60 * 1000;

const renumberWarning = (r) => `handles renumbered since ${r.since}${r.restarted ? ' (AIObox restarted)' : ''}: ${r.changes.map((c) => `${c.was} -> ${c.handle}`).join(', ') || 'see op=windows'}. A handle is only the current label; name a window by its chat id or pass expect.`;

// Resolve and check one window for an op: freshly read map, live target, optional expect. A miss (no such window, target gone, title naming another handle) asks AIObox to refresh once when it can, then decides on the new map; expect is never retried into a match.
async function openTab(args) {
  const attempt = async (map) => {
    const tab = resolveTab(map, args.window);
    const live = await liveTarget(tab);
    return { map, tab, live };
  };
  let found;
  const map = readMap();
  try {
    found = await attempt(map);
  } catch (e) {
    if (map.run.epoch === null) throw e;
    const fresh = await refreshMap(map.run).catch((r) => {
      throw new Error(`${e.message} (${r.message})`);
    });
    found = await attempt(fresh);
  }
  checkExpect(found.tab, found.live, args.expect);
  return { ...found, used: usedTab(found.tab, found.live, found.map) };
}

// The map and Chrome can disagree for a moment (a window just closed, a handle renumbered). A live target whose title carries a different written handle, or no live target at all, means the map is stale: refuse rather than act on the wrong window. A page without a title prefix (chrome://, new tab) is accepted, since AIObox cannot prefix it.
async function liveTarget(tab) {
  const live = (await cdp.listTargets({ port: tab.port })).find((t) => t.id === tab.targetId);
  if (!live) throw new Refusal('stale_map', `window map is stale: ${tab.handle} (target ${tab.targetId}) is no longer open on port ${tab.port}`, NEXT_STATE);
  const head = (live.title || '').split(TITLE_SEP)[0];
  const h = parseHandle(head);
  if (h?.window && formatHandle(h.profile, h.window, h.tab) === head && head !== tab.handle) {
    throw new Refusal('stale_map', `window map is stale: target ${tab.targetId} is titled ${head}, not ${tab.handle}`, NEXT_STATE);
  }
  return live;
}

const tailCodepoints = (text, cap) => {
  const points = Array.from(text || '');
  return points.length > cap ? { text: points.slice(-cap).join(''), truncated: true } : { text: points.join('') };
};

// Chat messages come from AIObox's own provider reader (akipanel.live.chat, owned by aiobox), so the DOM knowledge of each provider lives in one repo; without it, the page text.
// akipanel is a readonly Proxy, so a CDP returnByValue of one of its object fields comes back {}: capabilities is copied through JSON inside the page. live.chat()'s result is a plain object and returns as-is.
const READ_JS = (last) => `(() => {
  const panel = window.akipanel;
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel?.capabilities ?? {})) || {}; } catch {}
  let account = null;
  try { account = JSON.parse(JSON.stringify(panel?.account ?? null)); } catch {}
  const acct = account ? { account } : {};
  if (caps.chat === ${CHAT_VERSION} && typeof panel?.live?.chat === 'function') {
    const r = panel.live.chat();
    if (!r || r.ok !== true) return { source: 'provider', error: String(r?.error ?? 'live.chat() returned no result') };
    const data = r.data || {};
    return { source: 'provider', ...acct, busy: !!data.busy, messages: (data.messages || []).slice(-${last}).map((m) => ({ role: m.role, text: m.text })) };
  }
  if (caps.chat !== undefined) return { source: 'provider', unsupported: String(caps.chat) };
  const root = document.body || document.querySelector('main');
  return { source: 'raw', ...acct, text: root ? root.innerText : '' };
})()`;

const TEXT_JS = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, ${TEXT_ELEMENTS_CAP}).map((el) => ({ text: Array.from(el.innerText || '').slice(0, ${TEXT_ELEMENT_CAP}).join(''), ariaLabel: el.getAttribute('aria-label') }))`;

// One short look at a chat tab for op=state and op=whoami: busy and account, the provider's macros, and whether the user's latest message (provider reader) or the page text (no reader) contains quote.
const PROBE_JS = (quote) => `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const panel = window.akipanel;
  const copy = (v, empty) => { try { return JSON.parse(JSON.stringify(v ?? empty)) ?? empty; } catch { return empty; } };
  const caps = copy(panel?.capabilities, {});
  const account = copy(panel?.account, null);
  const macros = copy(panel?.state?.macros, []).map((m) => ({ id: m.id, label: m.label, options: (m.options || []).map((o) => o.id) }));
  const quote = ${quote === undefined ? 'null' : `norm(${JSON.stringify(quote)})`};
  if (caps.chat === ${CHAT_VERSION} && typeof panel?.live?.chat === 'function') {
    const r = panel.live.chat();
    if (r && r.ok === true) {
      const lastUser = [...(r.data?.messages || [])].reverse().find((m) => m.role === 'user');
      return { reader: true, busy: !!r.data?.busy, account, macros, match: quote ? norm(lastUser?.text).includes(quote) : null };
    }
  }
  return { reader: false, busy: null, account, macros, match: quote ? norm(document.body?.innerText).includes(quote) : null };
})()`;
const CHAT_PROVIDERS = new Set(['notion', 'gpt', 'claude', 'grok', 'gemini']);
const PROBE_TIMEOUT_MS = 3_000;
const QUOTE_MIN = 20;

// Every live chat tab probed in parallel, each bounded so one frozen page cannot hold the call; a tab that fails is left out, not guessed.
async function probeTabs(map, quote) {
  const tabs = tabsOf(map).filter((t) => CHAT_PROVIDERS.has(providerOf(t.url)));
  const liveByPort = new Map();
  for (const port of new Set(tabs.map((t) => t.port))) liveByPort.set(port, await cdp.listTargets({ port }).catch(() => []));
  const probes = await Promise.allSettled(tabs.map((t) => {
    const live = liveByPort.get(t.port).find((l) => l.id === t.targetId);
    if (!live) return Promise.reject(new Error('not live'));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS).unref());
    return Promise.race([cdp.evaluate({ port: t.port, target: live, expression: PROBE_JS(quote) }), timeout]);
  }));
  return new Map(tabs.flatMap((t, i) => (probes[i].status === 'fulfilled' && probes[i].value?.value ? [[t.targetId, probes[i].value.value]] : [])));
}

const tabRow = (t) => ({ handle: t.handle, chatId: chatIdOf(t.url), targetId: t.targetId, profileId: t.profile.id ?? null, provider: providerOf(t.url), profile: t.profile.name, title: stripHandle(t.title), url: t.url });
const opsList = () => ({ aiobox: Object.keys(READ_OPS), aiobox_write: Object.keys(WRITE_OPS) });

// The rules for acting in AIObox, returned by op=state: a client gets the running server's copy here, while a tool description stays frozen in its cached schema. Plan: docs/plan/aiobox-control-ops.md § Guide.
const GUIDE_VERSION = 2;
const GUIDE = [
  `AIObox guide v${GUIDE_VERSION}.`,
  "1. Find yourself: aki__aiobox op=whoami quote=<20+ characters copied verbatim from the user's latest message>. Keep the chatId it returns; a handle (P#·W#) is only a label, renumbered when Chrome or AIObox restarts.",
  '2. op=state lists every window (chatId, provider, account, busy) and each provider\'s macros.',
  '3. Name a window by its chatId, or pass expect=<chatId> with a handle.',
  '4. New chat: aki__aiobox_write op=new_window window=<a window of that profile and provider>.',
  '5. Message another chat: aki__aiobox_write op=send window=<its chatId> from=<your chatId> wait=<s> sends it once that chat is idle. op=compose only fills its box for the owner to send. Never target your own chat.',
  '6. Before reading an answer: op=wait_idle, then op=read.',
  '7. Macros: aki__aiobox_write op=run_macro macro=<id from macros>.',
  '8. eval is the last resort and never sends a message. Do not use chrome_launch or devtools_* on an AIObox profile.',
  '9. An op listed in ops but missing from your tool schema means your client cached an older AkiMCP: ask the owner to reconnect AkiMCP or start a new chat.',
].join('\n');

function need(op, args, fields) {
  const missing = fields.filter((f) => args[f] === undefined || args[f] === '');
  if (missing.length) throw new Error(`op=${op} needs ${missing.join(', ')}`);
}

const WAIT_IDLE_DEFAULT_S = 120;
const WAIT_IDLE_POLL_MS = 1_000;
const renumberedOf = (map) => (map.renumbered ? { ...map.renumbered, warning: renumberWarning(map.renumbered) } : null);

const READ_OPS = {
  async windows() {
    const map = await freshMap();
    return ok(JSON.stringify({ akimcp: VERSION, ops: opsList(), run: map.run, renumbered: renumberedOf(map), tabs: tabsOf(map).map(tabRow) }, null, 2));
  },
  async state() {
    const map = await freshMap();
    const probed = await probeTabs(map);
    const macros = {};
    const tabs = tabsOf(map).map((t) => {
      const p = probed.get(t.targetId);
      const row = tabRow(t);
      if (p?.macros?.length && !macros[row.provider]) macros[row.provider] = p.macros;
      return p ? { ...row, busy: p.busy, account: p.account } : row;
    });
    return ok(JSON.stringify({ akimcp: VERSION, ops: opsList(), guide: GUIDE, run: map.run, renumbered: renumberedOf(map), macros, tabs }, null, 2));
  },
  // The caller's own window: the AI cannot see its tab, but it sees the user's latest message verbatim, and that text is in exactly one chat (the busy one, while it answers). Two chats showing it are returned as ambiguous, never guessed between.
  async whoami(args) {
    need('whoami', args, ['quote']);
    const quote = args.quote.replace(/\s+/g, ' ').trim();
    if (Array.from(quote).length < QUOTE_MIN) throw new Refusal('short_quote', `quote has ${Array.from(quote).length} characters`, `pass at least ${QUOTE_MIN} characters copied verbatim from the user's latest message`);
    const map = await freshMap();
    const probed = await probeTabs(map, quote);
    const hits = tabsOf(map).filter((t) => probed.get(t.targetId)?.match).map((t) => ({ tab: t, probe: probed.get(t.targetId) }));
    const byReader = hits.filter((h) => h.probe.reader);
    const pool = byReader.length ? byReader : hits;
    const busy = pool.filter((h) => h.probe.busy);
    const pick = pool.length === 1 ? pool[0] : busy.length === 1 ? busy[0] : null;
    const row = (h) => ({ ...tabRow(h.tab), busy: h.probe.busy, account: h.probe.account, matchedBy: h.probe.reader ? 'latest user message' : 'page text' });
    if (!pool.length) throw new Refusal('not_found', 'no AIObox chat window shows that quote', 'copy a longer exact passage of the latest user message; a chat outside AIObox has no window here');
    if (!pick) return ok(JSON.stringify({ akimcp: VERSION, ambiguous: pool.map(row) }, null, 2));
    return ok(JSON.stringify({ akimcp: VERSION, you: row(pick), keep: 'chatId, not the handle' }, null, 2));
  },
  async read(args) {
    need('read', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(args.last ?? 1) });
    if (value?.error !== undefined) throw new Error(`AIObox chat reader in ${tab.handle}: ${value.error}`);
    if (value?.unsupported !== undefined) throw new Error(`AIObox chat capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${CHAT_VERSION}); update AkiMCP or AIObox`);
    const body = value?.source === 'raw' ? { source: 'raw', ...tailCodepoints(value.text, RAW_TEXT_CAP) } : value;
    return ok(JSON.stringify({ ...used, ...body }, null, 2));
  },
  // Until the chat stops answering, by AIObox's reader (busy); a page without one has no busy to read, so it is refused rather than guessed from the DOM.
  async wait_idle(args) {
    need('wait_idle', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const limitMs = (args.timeout ?? WAIT_IDLE_DEFAULT_S) * 1000;
    const started = Date.now();
    for (;;) {
      const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(args.last ?? 1) });
      if (value?.source !== 'provider' || value.unsupported !== undefined) throw new Refusal('no_adapter', `${tab.handle} has no AIObox chat reader, so whether it is answering is unknown`, 'read it with op=read and judge from the text');
      if (value.error !== undefined) throw new Error(`AIObox chat reader in ${tab.handle}: ${value.error}`);
      const waitedMs = Date.now() - started;
      if (!value.busy) return ok(JSON.stringify({ ...used, busy: false, waitedMs, messages: value.messages }, null, 2));
      if (waitedMs >= limitMs) return ok(JSON.stringify({ ...used, busy: true, timedOut: true, waitedMs }, null, 2));
      await sleep(WAIT_IDLE_POLL_MS);
    }
  },
  async text(args) {
    need('text', args, ['window', 'selector']);
    const { tab, live: target, used } = await openTab(args);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: TEXT_JS(args.selector) });
    return ok(JSON.stringify({ ...used, elements: value }, null, 2));
  },
  async screenshot(args) {
    need('screenshot', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const { data, mimeType } = await cdp.screenshot({ port: tab.port, target, format: args.format });
    const shot = okImage(data, mimeType);
    shot.content.push({ type: 'text', text: JSON.stringify(used) });
    return shot;
  },
};

// akipanel.newWindow() is AIObox's own way to open a window (same profile and provider, AIObox's start page and panel), so a new chat opened here is the same as one opened from the panel button.
const NEW_WINDOW_JS = `(() => {
  const panel = window.akipanel;
  if (!panel || typeof panel.newWindow !== 'function') return { error: 'this window has no AIObox panel' };
  if (!panel.online) return { error: 'the AIObox panel in this window is offline' };
  if (panel.opening) return { resting: true };
  panel.newWindow();
  return { ok: true };
})()`;
// live.compose (AIObox's provider adapter) appends to the composer and never sends; the person sends.
const COMPOSE_JS = (text) => `(async () => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel.capabilities ?? {})) || {}; } catch {}
  if (caps.compose === undefined || typeof panel.live?.compose !== 'function') return { error: 'this page has no compose capability (AIObox has it on the Notion AI chat page)' };
  if (caps.compose !== ${COMPOSE_VERSION}) return { unsupported: String(caps.compose) };
  const r = await panel.live.compose(${JSON.stringify(text)});
  return r && r.ok === true ? { ok: true } : { error: String(r?.error ?? 'live.compose() returned no result') };
})()`;
// live.send (AIObox's provider adapter) sends one user message and resolves only once it shows in the chat; it refuses (sending nothing) when busy or when the composer holds a draft, and does not wait itself.
const SEND_JS = (text) => `(async () => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel.capabilities ?? {})) || {}; } catch {}
  if (caps.send === undefined || typeof panel.live?.send !== 'function') return { missing: true };
  if (caps.send !== ${SEND_VERSION}) return { unsupported: String(caps.send) };
  const r = await panel.live.send(${JSON.stringify(text)});
  return r && r.ok === true ? { ok: true } : { error: String(r?.error ?? 'live.send() returned no result') };
})()`;
// akipanel.runMacro is AIObox's panel button: the macro runs on the window the call came from, and its outcome lands in akipanel.macroRuns[id] (running, then done, started, skipped or error; aiobox docs/arch/provider-macros.md).
const MACRO_JS = (id, option) => `(() => {
  const panel = window.akipanel;
  if (!panel || typeof panel.runMacro !== 'function') return { error: 'this window has no AIObox panel' };
  if (!panel.online) return { error: 'the AIObox panel in this window is offline' };
  let macros = [];
  try { macros = JSON.parse(JSON.stringify(panel.state?.macros ?? [])) || []; } catch {}
  const macro = macros.find((m) => m.id === ${JSON.stringify(id)});
  if (!macro) return { unknown: macros.map((m) => m.id) };
  const options = (macro.options || []).map((o) => o.id);
  const option = ${option === undefined ? 'undefined' : JSON.stringify(option)};
  if (option !== undefined && !options.includes(option)) return { badOption: options };
  const before = panel.macroRuns?.[macro.id]?.at ?? 0;
  panel.runMacro(macro.id, option);
  return { ok: true, before };
})()`;
const MACRO_RUN_JS = (id) => `(() => { const r = window.akipanel?.macroRuns?.[${JSON.stringify(id)}]; return r ? { status: r.status, message: r.message ?? null, at: r.at } : null; })()`;
const MACRO_ENDED = new Set(['done', 'started', 'skipped', 'error']);
const MACRO_WAIT_MS = 60_000;
const MACRO_POLL_MS = 500;
const NEW_WINDOW_WAIT_MS = 15_000;
const NEW_WINDOW_POLL_MS = 500;
const NEW_WINDOW_REST_MS = 1_100; // aiobox akipanel.ts NEW_WINDOW_REST_MS (1 s) plus a margin: while the panel rests, newWindow() is a no-op

const windowsOfProfile = (map, port) => (map.profiles || []).find((p) => p.port === port)?.windows || [];
const handlesOfProfile = (map, port) => new Set(windowsOfProfile(map, port).map((w) => w.handle));

const WRITE_OPS = {
  async new_window(args) {
    need('new_window', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const ask = async () => (await cdp.evaluate({ port: tab.port, target, expression: NEW_WINDOW_JS })).value;
    let before = handlesOfProfile(readMap(), tab.port);
    let value = await ask();
    // The panel was resting from a window someone opened a moment ago: asking now would open nothing and that window would be taken for ours. Wait the rest out, count their window as existing, then ask once more.
    if (value?.resting) {
      await sleep(NEW_WINDOW_REST_MS);
      before = handlesOfProfile(await freshMap().catch(() => readMap()), tab.port);
      value = await ask();
      if (value?.resting) throw new Refusal('opening', `${tab.handle}'s panel is still opening another window`, 'wait a few seconds, then call op=state: that window may be the one you need');
    }
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    // AIObox rewrites windows.json once the window exists; the new handle is the one this profile did not have before. Its first tab starts blank, so the window counts once it shows the opener's provider.
    const wanted = providerOf(tab.url);
    let opened = null;
    for (const end = Date.now() + NEW_WINDOW_WAIT_MS; Date.now() < end; await sleep(NEW_WINDOW_POLL_MS)) {
      let map;
      try {
        map = readMap();
      } catch {
        continue;
      }
      opened = windowsOfProfile(map, tab.port).find((w) => !before.has(w.handle) && w.tabs?.[0]) || opened;
      if (opened && providerOf(opened.tabs[0].url) === wanted) break;
    }
    if (!opened) throw new Error(`AIObox did not list a new window for ${tab.handle}'s profile within ${NEW_WINDOW_WAIT_MS / 1000}s`);
    const first = opened.tabs[0];
    const warning = [used.warning, providerOf(first.url) === wanted ? null : `the new window still shows ${first.url}, not a ${wanted} page`].filter(Boolean).join(' ');
    return ok(JSON.stringify({ window: opened.handle, targetId: first.targetId, chatId: chatIdOf(first.url), opener: tab.handle, openerTargetId: tab.targetId, provider: providerOf(first.url), url: first.url, title: stripHandle(first.title), ...(warning ? { warning } : {}) }, null, 2));
  },
  async compose(args) {
    need('compose', args, ['window', 'text']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, "compose into the other session's window, found by its chatId in op=state");
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: COMPOSE_JS(args.text), awaitPromise: true });
    if (value?.unsupported !== undefined) throw new Error(`AIObox compose capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${COMPOSE_VERSION}); update AkiMCP or AIObox`);
    if (!value?.ok) throw new Error(`${tab.handle}: ${value?.error ?? 'compose returned no result'}`);
    return ok(JSON.stringify({ ...used, composed: true, sent: false }, null, 2));
  },
  // Sends for real. wait=<s> first waits out an answer in progress (as op=wait_idle); live.send's own refusal comes back verbatim.
  async send(args) {
    need('send', args, ['window', 'text']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, "send to the other session's window, found by its chatId in op=state");
    const started = Date.now();
    for (const end = started + (args.wait ?? 0) * 1000; ; await sleep(WAIT_IDLE_POLL_MS)) {
      const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(1) });
      if (value?.source !== 'provider' || !value.busy || Date.now() >= end) {
        if (value?.busy && args.wait) throw new Refusal('busy', `${tab.handle} was still answering after ${args.wait}s`, 'raise wait, or check it later with op=wait_idle');
        break;
      }
    }
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: SEND_JS(args.text), awaitPromise: true });
    if (value?.missing) throw new Refusal('no_send', `${tab.handle} has no AIObox send capability (an older AIObox build, or not a chat page)`, 'use op=compose and ask the owner to press Enter, or rebuild AIObox');
    if (value?.unsupported !== undefined) throw new Error(`AIObox send capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${SEND_VERSION}); update AkiMCP or AIObox`);
    if (!value?.ok) throw new Error(`${tab.handle}: ${value?.error ?? 'send returned no result'}`);
    return ok(JSON.stringify({ ...used, sent: true, waitedMs: Date.now() - started }, null, 2));
  },
  async run_macro(args) {
    need('run_macro', args, ['window', 'macro']);
    const { tab, live: target, used } = await openTab(args);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: MACRO_JS(args.macro, args.option) });
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    if (value?.unknown) throw new Refusal('no_macro', `${tab.handle} has no macro '${args.macro}'; it has: ${value.unknown.join(', ') || 'none'}`, 'pick an id from op=state macros');
    if (value?.badOption) throw new Refusal('no_option', `macro '${args.macro}' has no option '${args.option}'; it has: ${value.badOption.join(', ') || 'none'}`, 'pick one of those, or omit option for the default');
    for (const end = Date.now() + MACRO_WAIT_MS; Date.now() < end; await sleep(MACRO_POLL_MS)) {
      const run = (await cdp.evaluate({ port: tab.port, target, expression: MACRO_RUN_JS(args.macro) })).value;
      if (run && run.at > value.before && MACRO_ENDED.has(run.status)) return ok(JSON.stringify({ ...used, macro: args.macro, status: run.status, message: run.message }, null, 2));
    }
    // macroRuns lives in the page: a macro that navigates or reloads it (connect-akimcp does) never reports back here.
    return ok(JSON.stringify({ ...used, macro: args.macro, status: 'unknown', timedOut: true, next: 'the macro may have reloaded the page; check the outcome with op=read or op=state' }, null, 2));
  },
  async eval(args) {
    need('eval', args, ['window', 'expression']);
    const { tab, live: target, used } = await openTab(args);
    const out = await cdp.evaluate({ port: tab.port, target, expression: args.expression, awaitPromise: args.awaitPromise ?? true });
    return ok(JSON.stringify({ ...used, value: out.value, type: out.type }, null, 2));
  },
};

// Detect by install (the ~/.aki/aiobox/ folder), not by AIObox running: a closed AIObox keeps its tools listed and answers "not running".
export const provider = {
  id: 'aiobox',
  title: 'AIObox windows',
  detect: () => (fs.existsSync(aioboxDir()) ? { available: true } : { available: false, reason: 'AIObox is not installed (no ~/.aki/aiobox/)' }),
  register,
};

const windowArg = z.string().optional().describe('handle P#·W#, chatId or targetId');
const expectArg = z.string().optional().describe('targetId, chatId, or text the url or title must contain; refused if window names another tab');

export function register(server) {
  server.registerTool(
    'aiobox',
    {
      title: 'AIObox: read windows by handle',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Read AIObox Chrome windows. Start with op=state: every window (chatId, provider, account, busy), macros, and the guide for acting in AIObox. op=whoami quote=<20+ chars verbatim from the latest user message> finds your own window. Name a window by chatId (stable) or handle P#·W# (a label, renumbered on restart) or targetId; expect refuses a handle that now names another tab. op=windows: tabs only. op=read: last messages (last=N), else page text. op=wait_idle: waits until the chat stops answering (timeout s), returns its last messages. op=text: elements by selector. op=screenshot. Results name the tab used. Acting: aki__aiobox_write.',
      inputSchema: {
        op: z.enum(Object.keys(READ_OPS)).describe(Object.keys(READ_OPS).join(' | ')),
        window: windowArg,
        expect: expectArg,
        quote: z.string().optional().describe('whoami: 20+ characters copied verbatim from the latest user message'),
        timeout: z.number().int().min(1).max(300).optional().describe('wait_idle: seconds (default 120)'),
        last: z.number().int().min(1).max(50).optional().describe('read, wait_idle: messages from the end (default 1)'),
        selector: z.string().optional().describe('text: CSS selector'),
        format: z.enum(['png', 'jpeg']).optional().describe('screenshot: default png'),
      },
    },
    async ({ op, ...args }) => {
      try {
        return await READ_OPS[op](args);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'aiobox_write',
    {
      title: 'AIObox: open a window, send or fill a chat, run JS',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Act in an AIObox window (chatId, handle or targetId; rules: aki__aiobox op=state). Pass expect to refuse a renumbered handle and from=<your chatId> so your own chat is refused. op=new_window: a new chat of the same profile and provider, as the panel button; returns handle, chatId, targetId. op=send: sends text as a message (wait=s first waits for the chat to go idle); op=compose only fills the chat box. op=run_macro: runs one of the window\'s AIObox macros (macro, option) and returns its status. op=eval: expression runs in the page, result returned; awaitPromise (default true). It can click, type and change the page.',
      inputSchema: {
        op: z.enum(Object.keys(WRITE_OPS)).describe(Object.keys(WRITE_OPS).join(' | ')),
        window: windowArg,
        expect: expectArg,
        from: z.string().optional().describe('your own chatId (aki__aiobox op=whoami); send and compose refuse it'),
        macro: z.string().optional().describe('run_macro: macro id (op=state macros)'),
        option: z.string().optional().describe('run_macro: option id (default: the first)'),
        text: z.string().optional().describe('send, compose: the text'),
        wait: z.number().int().min(0).max(300).optional().describe('send: seconds to wait for a busy chat (default 0)'),
        expression: z.string().optional().describe('eval: JS evaluated in the page; the last expression is returned'),
        awaitPromise: z.boolean().optional().describe('eval: await a returned Promise (default true)'),
      },
    },
    async ({ op, ...args }) => {
      try {
        return await WRITE_OPS[op](args);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
