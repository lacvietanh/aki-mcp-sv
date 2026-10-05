// AIObox windows by handle (P7·W2): aki__aiobox reads, aki__aiobox_write runs JS. Built on cdp-engine.js the way postman-mcp.js is: AIObox knowledge lives here, devtools_* stay app-agnostic.
// Contract with aiobox (windows.json shape, handle forms, akipanel.live.chat()): docs/plan/IMPORTANT-akimcp-aiobox-contract.md. Plan: docs/plan/done/provider-toolkit-architecture.md § Provider aiobox; next steps: docs/plan/aiobox-control-ops.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ok, okImage, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import { USER_DIR } from './userdata.js';
import { VERSION } from './version.js';
import { aioboxDir, aioboxInstalled, readGuide, AIOBOX_PITCH, OPEN_RULE } from './aiobox-guide.js';

const windowsFile = () => path.join(aioboxDir(), 'cdp', 'windows.json');
// What this server last saw of the map, kept on disk so the moved-handle check survives an AkiMCP restart too. AkiMCP's own data dir, never AIObox's.
const seenFile = () => path.join(USER_DIR, 'aiobox-seen.json');

const MAP_VERSION = 1;
const CHAT_VERSION = 1; // akipanel.capabilities.chat: the shape of live.chat() this reader understands
const COMPOSE_VERSION = 2; // akipanel.capabilities.compose: live.compose(text) returns a Promise of { ok, error }
// akipanel.capabilities.send, contract row live.send: v2 owns busy, drafts and its queue, resolving { ok: true, data: { delivered: true, midAnswer?, draft? } } or { ok: true, data: { queued: true, position, reason } }; v1 refuses busy and drafts and resolves { ok: true } once the message shows. v1 stays read until every AIObox build has v2.
const SEND_VERSION = 2;
const SEND_V1 = 1;
// A user message counts as the one sent when it holds this many codepoints of the sent text, markup and spacing dropped (a provider renders Markdown).
const DELIVERED_MATCH = 60;
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
const NEXT_STATE = 'call aki__aiobox op=state and name the window by its handle';

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

// The chat id in a provider URL: the one name of a conversation that survives an AIObox or Chrome restart (Notion ?t=<id>, ChatGPT and Grok /c/<id>, Claude /chat/<id>, Gemini /app/<id>). It changes when a window opens another chat; the window's own lasting name is its handle.
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

function readSeen() {
  try {
    const seen = JSON.parse(fs.readFileSync(seenFile(), 'utf8'));
    return seen && typeof seen.byTarget === 'object' ? seen : null;
  } catch {
    return null;
  }
}

// A handle is the window's lasting name: AIObox numbers windows per profile, never gives a number twice, and keeps it across AIObox and Chrome restarts (aiobox plan window-control D6). So a new AIObox run is no event, and a handle on a new target is its window restored. The one thing that must not happen is an open tab (same targetId) changing handle: an AIObox fault, compared against the last map this server saw and kept until a later one replaces it, so every caller can still learn of it.
function observe(map) {
  const tabs = tabsOf(map).filter((t) => t.handle);
  const byTarget = Object.fromEntries(tabs.map((t) => [t.targetId, t.handle]));
  const chatOf = Object.fromEntries(tabs.map((t) => [t.targetId, chatIdOf(t.url)]));
  const prev = readSeen();
  // A record from before D6 that only says AIObox restarted (no moved tab) is dropped.
  let last = prev?.last?.changes?.length ? prev.last : null;
  if (prev) {
    const changes = tabs
      .filter((t) => prev.byTarget[t.targetId] && prev.byTarget[t.targetId] !== t.handle)
      .map((t) => ({ handle: t.handle, was: prev.byTarget[t.targetId], targetId: t.targetId, chatId: chatOf[t.targetId] }));
    if (changes.length) last = { since: prev.at, detectedAt: new Date().toISOString(), changes };
  }
  const same = prev && JSON.stringify(prev.byTarget) === JSON.stringify(byTarget) && (prev.last ?? null) === (last ?? null);
  if (!same) {
    try {
      fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
      const tmp = `${seenFile()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ at: map.run.updatedAt ?? map.run.writtenAt, byTarget, chatOf, last }), { mode: 0o600 });
      fs.renameSync(tmp, seenFile());
    } catch (e) {
      process.stderr.write(`[aiobox] ${seenFile()} not written: ${e.message}\n`);
    }
  }
  return last;
}

// A window is named by its handle (its lasting name), its CDP targetId, or its chat id (the chat open in it now). A handle AIObox retired at a handoff (close_window after place_like: windows.json retired[] { handle, successor, at }) leads hop by hop to the window that took over, and the result says resolvedFrom.
function resolveTab(map, input) {
  const tabs = tabsOf(map);
  const h = parseHandle(input);
  const open = () => `open: ${windowHandles(map).join(', ') || 'none'}`;
  if (!h?.window) {
    const tab = tabs.find((t) => t.targetId === input) || tabs.find((t) => chatIdOf(t.url) === input);
    if (!tab) throw new Refusal('no_window', `no window '${input}'; ${open()}`, NEXT_STATE);
    return tab;
  }
  const asked = formatHandle(h.profile, h.window, h.tab);
  const chain = [asked];
  for (let name = asked; ; ) {
    const tab = tabs.find((t) => t.handle === name);
    if (tab) return chain.length > 1 ? { ...tab, resolvedFrom: asked } : tab;
    const next = successorOf(map, name);
    if (!next) break;
    if (chain.includes(next)) throw new Refusal('retired_loop', `retired handles loop: ${[...chain, next].join(' -> ')}`, NEXT_STATE);
    chain.push(next);
    name = next;
  }
  const retired = chain.length > 1 ? ` (retired: ${chain.join(' -> ')}, which is not open)` : '';
  throw new Refusal('no_window', `no window '${input}'${retired}; ${open()}`, NEXT_STATE);
}

const writtenHandle = (s) => {
  const h = parseHandle(s ?? '');
  return h?.window ? formatHandle(h.profile, h.window, h.tab) : null;
};
const successorOf = (map, name) => {
  const r = (Array.isArray(map.retired) ? map.retired : []).find((x) => writtenHandle(x?.handle) === name);
  return r ? writtenHandle(r.successor) : null;
};

// A chat no tab shows any more, as AIObox saved it (contract: archive/<chatId>.json; quota_handoff before a switch_workspace in the same tab, close at close_window). AIObox is its one writer; AkiMCP only reads.
const archiveDir = () => path.join(aioboxDir(), 'archive');
const ARCHIVE_VERSION = 1;
const ARCHIVE_MAX_BYTES = 4 * 1024 * 1024 + 64 * 1024; // the app keeps a file at 4 MiB; a little slack for the frame
const chatKey = (id) => String(id).replace(/-/g, '').toLowerCase();
function readArchiveFile(file) {
  if (fs.statSync(file).size > ARCHIVE_MAX_BYTES) throw new Error(`archive ${path.basename(file)} is over ${ARCHIVE_MAX_BYTES} bytes`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc?.version !== ARCHIVE_VERSION) throw new Error(`archive ${path.basename(file)} has version ${doc?.version}, AkiMCP reads ${ARCHIVE_VERSION}; update AkiMCP or AIObox`);
  return doc;
}
// window = a chatId: its file; a handle: the newest savedAt of the files naming it. null: none saved.
function findArchive(input) {
  let names;
  try {
    names = fs.readdirSync(archiveDir()).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const h = parseHandle(input);
  if (!h?.window) {
    const name = names.find((n) => chatKey(n.slice(0, -5)) === chatKey(input));
    return name ? readArchiveFile(path.join(archiveDir(), name)) : null;
  }
  const handle = formatHandle(h.profile, h.window, h.tab);
  let best = null;
  for (const n of names) {
    let doc;
    try {
      doc = readArchiveFile(path.join(archiveDir(), n));
    } catch {
      continue;
    }
    if (writtenHandle(doc.handle) === handle && (!best || Date.parse(doc.savedAt) > Date.parse(best.savedAt))) best = doc;
  }
  return best;
}
const archivedRead = (input, doc, last) => {
  const messages = Array.isArray(doc.messages) ? doc.messages : [];
  return { window: input, archived: true, chatId: doc.chatId ?? null, handle: doc.handle ?? null, provider: doc.provider ?? null, profileId: doc.profileId ?? null, url: doc.url ?? null, title: doc.title ?? null, workspace: doc.workspace ?? null, savedAt: doc.savedAt ?? null, reason: doc.reason ?? null, successor: doc.successor ?? null, truncated: doc.truncated === true, total: messages.length, messages: messages.slice(-last), next: doc.successor ? `the chat went on in ${doc.successor}: op=read window=${doc.successor}` : 'no tab shows this chat now; this is the copy AIObox saved' };
};

// expect: the tab the caller means, as a targetId, chat id, or text its url or title contains. Checked against the live target, so a handle that now names another chat is refused instead of acted on.
function checkExpect(tab, live, expect) {
  if (expect === undefined || expect === '') return;
  const url = live.url || tab.url || '';
  const title = stripHandle(live.title || tab.title || '');
  const chatId = chatIdOf(url);
  if (live.id === expect || tab.targetId === expect || chatId === expect || url.includes(expect) || title.includes(expect)) return;
  throw new Refusal('wrong_window', `handle ${tab.handle} now points to "${title}" (${chatId ? `chat ${chatId}` : `target ${tab.targetId}`}), not "${expect}"; the window shows another chat now`, NEXT_STATE);
}

// Every op on a window says which tab it used (and the retired handle it was asked by), and warns when that tab's handle, or the handle asked for, moved in the newest moved-handle record.
function usedTab(tab, live, map) {
  const url = live?.url || tab.url;
  const out = { window: tab.handle, targetId: tab.targetId, chatId: chatIdOf(url), url };
  if (tab.resolvedFrom) out.resolvedFrom = tab.resolvedFrom;
  const r = map.renumbered;
  const hit = r?.changes?.some((c) => c.handle === tab.handle || c.was === tab.handle || c.targetId === tab.targetId);
  if (hit && Date.now() - Date.parse(r.detectedAt) < WARN_FOR_MS) out.warning = renumberWarning(r);
  return out;
}
// How long an op on a window whose handle moved keeps warning; op=windows reports the newest record for as long as it is the newest.
const WARN_FOR_MS = 2 * 60 * 60 * 1000;

const renumberWarning = (r) => `AIObox moved a handle on an open tab since ${r.since}: ${r.changes.map((c) => `${c.was} -> ${c.handle} (target ${c.targetId}${c.chatId ? `, chat ${c.chatId}` : ''})`).join(', ')}. Handles should never move; check op=windows and pass expect.`;

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

// The map and Chrome can disagree for a moment (a window just closed or restored). A live target whose title carries a different written handle, or no live target at all, means the map is stale: refuse rather than act on the wrong window. A page without a title prefix (chrome://, new tab) is accepted, since AIObox cannot prefix it.
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
    return { source: 'provider', ...acct, busy: !!data.busy, ...(data.draft === undefined ? {} : { draft: !!data.draft }), messages: (data.messages || []).slice(-${last}).map((m) => ({ role: m.role, text: m.text })) };
  }
  if (caps.chat !== undefined) return { source: 'provider', unsupported: String(caps.chat) };
  const root = document.body || document.querySelector('main');
  return { source: 'raw', ...acct, text: root ? root.innerText : '' };
})()`;

const TEXT_JS = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, ${TEXT_ELEMENTS_CAP}).map((el) => ({ text: Array.from(el.innerText || '').slice(0, ${TEXT_ELEMENT_CAP}).join(''), ariaLabel: el.getAttribute('aria-label') }))`;

// One short look at a chat tab for op=state and op=whoami: busy and account, the provider's macros, read (how its chat takes a message sent mid-answer: live | queued | blocked | null; no panel = no field), the tab's own workspace and usage (here, below; no panel = no field), and whether the user's latest message (provider reader) or the page text (no reader) contains quote.
const PROBE_JS = (quote) => `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const panel = window.akipanel;
  const copy = (v, empty) => { try { return JSON.parse(JSON.stringify(v ?? empty)) ?? empty; } catch { return empty; } };
  const caps = copy(panel?.capabilities, {});
  const account = copy(panel?.account, null);
  const macros = copy(panel?.state?.macros, []).map((m) => ({ id: m.id, label: m.label, options: (m.options || []).map((o) => o.id) }));
  const quote = ${quote === undefined ? 'null' : `norm(${JSON.stringify(quote)})`};
  const read = panel ? (['live', 'queued', 'blocked'].includes(panel.read) ? panel.read : null) : undefined;
  // Workspace and usage as AIObox reads them for this tab (contract row akipanel.usage): Notion's scopePick with exactScope is the tab's own workspace, usage.usage is its reading when scopeId is that workspace. Never guessed from the title: what is missing is null with why.
  const here = (() => {
    if (!panel) return undefined;
    const u = copy(panel.usage, null);
    if (caps.usage === undefined || !u) return { workspace: null, usage: null, why: 'this AIObox panel reports no usage' };
    const pct = (v) => (typeof v?.utilizationPct === 'number' ? v.utilizationPct : null);
    const reading = (r, readAt) => ({ session: pct(r?.session), weekly: pct(r?.weekly), readAt, ...(u.stale ? { stale: true } : {}) });
    const inner = u.usage || {};
    if (panel.exactScope !== true) return { workspace: null, usage: reading(inner, u.checkedAt ?? null), why: 'this provider has no workspaces: usage is for the whole account' };
    // Every workspace of the account as the snapshot holds them, for choosing where to go (op=state workspaces).
    const scopes = (inner.scopes || []).map((s) => ({ id: s.id, label: s.label ?? null, status: s.plan === 'free' ? 'free' : (s.status ?? null), session: pct(s.session), weekly: pct(s.weekly) }));
    const id = typeof panel.scopePick === 'string' ? panel.scopePick : null;
    if (!id) {
      let wait = null;
      try { wait = typeof panel.scopeWait === 'function' ? panel.scopeWait() : panel.scopeWait; } catch {}
      return { workspace: null, usage: null, why: wait ? String(wait) : 'AIObox is still finding the workspace of this tab', scopes };
    }
    const scope = (inner.scopes || []).find((s) => s.id === id) || null;
    const workspace = { id, label: scope?.label ?? null, status: scope?.plan === 'free' ? 'free' : (u.status ?? null) };
    if (inner.scopeId === id) return { workspace, usage: reading(inner, u.checkedAt ?? null), scopes };
    if (scope?.session || scope?.weekly) return { workspace, usage: reading(scope, null), why: 'from the account snapshot, not a reading of this tab', scopes };
    return { workspace, usage: null, why: scope?.plan === 'free' ? 'free workspace: no AI quota' : 'no usage reading for this workspace yet', scopes };
  })();
  if (caps.chat === ${CHAT_VERSION} && typeof panel?.live?.chat === 'function') {
    const r = panel.live.chat();
    if (r && r.ok === true) {
      const lastUser = [...(r.data?.messages || [])].reverse().find((m) => m.role === 'user');
      return { reader: true, busy: !!r.data?.busy, account, read, here, macros, match: quote ? norm(lastUser?.text).includes(quote) : null };
    }
  }
  return { reader: false, busy: null, account, read, here, macros, match: quote ? norm(document.body?.innerText).includes(quote) : null };
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
    return cdp.evaluate({ port: t.port, target: live, expression: PROBE_JS(quote), timeoutMs: PROBE_TIMEOUT_MS });
  }));
  return new Map(tabs.flatMap((t, i) => (probes[i].status === 'fulfilled' && probes[i].value?.value ? [[t.targetId, probes[i].value.value]] : [])));
}

// The probe's here as row fields: workspace and usage, usageWhy when one is missing or not the tab's own reading.
const hereOf = (p) => (p?.here === undefined ? {} : { workspace: p.here.workspace, usage: p.here.usage, ...(p.here.why ? { usageWhy: p.here.why } : {}) });
const tabRow = (t) => ({ handle: t.handle, chatId: chatIdOf(t.url), targetId: t.targetId, profileId: t.profile.id ?? null, provider: providerOf(t.url), profile: t.profile.name, title: stripHandle(t.title), url: t.url });
const opsList = () => ({ aiobox: Object.keys(READ_OPS), aiobox_write: Object.keys(WRITE_OPS) });


function need(op, args, fields) {
  const missing = fields.filter((f) => args[f] === undefined || args[f] === '');
  if (missing.length) throw new Error(`op=${op} needs ${missing.join(', ')}`);
}

// A client gives up on a tool call after about a minute (-32001 Request timed out, seen 2026-10-04 with timeout=240), and a call it gave up on returns nothing at all. So one call waits at most CALL_WAIT_MAX_S; a longer wait is the caller's loop, told by `next`.
export const CALL_WAIT_MAX_S = 50;
export const waitLimitS = (asked, fallback) => Math.min(asked ?? fallback, CALL_WAIT_MAX_S);
const WAIT_IDLE_DEFAULT_S = CALL_WAIT_MAX_S;
const WAIT_IDLE_POLL_MS = 1_000;
const WAIT_AGAIN = 'still answering: call op=wait_idle again (one call waits at most 50 s)';

// flags.json, the one "do not use X" list every window sees (contract row flags.json, guide v10): { list: [...] } (a bare array still reads), scope account (account + profileId; the default) or workspace (its label), no until = until op=unflag. AkiMCP is its one writer (aiobox plan cleanup-ai-leftovers C1); AIObox and op=state read it.
const flagsFile = () => path.join(aioboxDir(), 'flags.json');
const listOf = (raw) => {
  const list = Array.isArray(raw) ? raw : raw?.list;
  return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : [];
};
// For op=state a missing or unreadable file is no flag.
function readFlags() {
  try {
    return listOf(JSON.parse(fs.readFileSync(flagsFile(), 'utf8')));
  } catch {
    return [];
  }
}
// An until that cannot be read holds, as AIObox reads it (fail closed); a number is epoch ms.
const inForce = (e, now) => {
  if (e.until === undefined || e.until === null) return true;
  const until = typeof e.until === 'number' ? e.until : Date.parse(e.until);
  return Number.isNaN(until) || until > now;
};
const scopeOf = (f) => f.scope ?? 'account';
// One rule with AIObox's request.rs workspace_flagged: a Notion workspace flag, of this profile or of none, naming the workspace by label (trimmed, any case) or id.
const workspaceFlagged = (f, { label, id, profileId }) =>
  scopeOf(f) === 'workspace' && (f.provider ?? 'notion') === 'notion' && (!f.profileId || !profileId || f.profileId === profileId) &&
  ((label != null && String(f.workspace ?? '').trim().toLowerCase() === String(label).trim().toLowerCase()) || (id != null && String(f.workspace ?? '').replace(/-/g, '').toLowerCase() === String(id).replace(/-/g, '').toLowerCase()));
const coordination = (now = Date.now()) => ({ flags: readFlags().filter((e) => inForce(e, now)).map((e) => ({ ...e, scope: scopeOf(e) })) });

const HOUR_MS = 3_600_000;
function flagTarget(op, args) {
  if (args.workspace) return { scope: 'workspace', workspace: args.workspace };
  if (!args.account || !args.profile) throw new Error(`op=${op} needs workspace, or account and profile`);
  // An account flag holds for one provider of that profile (no provider = notion, as AIObox and accountFlag read it), so a Claude or ChatGPT account can be kept off a handoff too.
  return { scope: 'account', account: args.account, profileId: args.profile, provider: args.provider ?? 'notion' };
}
const sameTarget = (f, t) => scopeOf(f) === t.scope && (t.scope === 'workspace' ? f.workspace === t.workspace : f.account === t.account && f.profileId === t.profileId && (f.provider ?? 'notion') === t.provider);
// Read, change and write back in one synchronous step (no await in between), whole file, tmp + rename, as { list }; entries no longer in force are dropped. A file that is there but not JSON is refused rather than overwritten.
function changeFlags(change) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(flagsFile(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`${flagsFile()} is not readable JSON (${e.message}); fix or delete it first`);
  }
  const now = Date.now();
  const list = change(listOf(raw).filter((e) => inForce(e, now)), now);
  fs.mkdirSync(path.dirname(flagsFile()), { recursive: true });
  const tmp = `${flagsFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ list }, null, 2)}\n`);
  fs.renameSync(tmp, flagsFile());
  return list.map((e) => ({ ...e, scope: scopeOf(e) }));
}
// AIObox's automation runs (aiobox docs/arch/automation-scheduler.md § Store): the scheduler is the only writer, so this opens read-only. Stamps are fixed-width RFC 3339 UTC, so since compares as text; outcome null = still running.
const runsFile = () => path.join(aioboxDir(), 'automation.sqlite');
const RUNS_DEFAULT = 10;
// A request's run (aiobox plan aio-control-gaps D3) carries request (the id AkiMCP wrote) and steps (JSON [{ step, status, at, info }], rewritten after each step); a store before G1 has neither column, and a run without them shows neither key.
const RUN_EXTRA_COLUMNS = ['request', 'steps'];
const parseSteps = (raw) => {
  try {
    const steps = JSON.parse(raw);
    return Array.isArray(steps) ? steps : null;
  } catch {
    return null;
  }
};
export function readRuns(file, { automation, since, last = RUNS_DEFAULT, id, request } = {}) {
  if (!fs.existsSync(file)) throw new Refusal('no_runs', 'AIObox has no automation store yet', 'start an AIObox build with the automation scheduler');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // AIObox writes a request's steps while it runs; wait out its lock instead of failing with "database is locked" (seen live 2026-10-04, G5).
    db.exec('PRAGMA busy_timeout = 2000');
    const columns = new Set(db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name));
    const extra = RUN_EXTRA_COLUMNS.filter((c) => columns.has(c));
    const where = [];
    const params = [];
    if (id !== undefined) {
      where.push('id = ?');
      params.push(id);
    }
    if (request) {
      if (!columns.has('request')) return [];
      where.push('request = ?');
      params.push(request);
    }
    if (automation) {
      where.push('automation_id = ?');
      params.push(automation);
    }
    if (since) {
      where.push('started_at >= ?');
      params.push(since);
    }
    const sql = `SELECT id, automation_id AS automation, trigger, handle, started_at AS startedAt, ended_at AS endedAt, outcome, detail${extra.map((c) => `, ${c}`).join('')} FROM runs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC, id DESC LIMIT ?`;
    return db.prepare(sql).all(...params, last).map(({ request: req, steps, ...r }) => ({ ...r, running: r.outcome === null, ...(req ? { request: req } : {}), ...(steps ? { steps: parseSteps(steps) } : {}) }));
  } finally {
    db.close();
  }
}

// profiles.json (aiobox plan aio-control-gaps G1a, contract row profiles.json): AIObox writes it whole (tmp + rename) whenever a profile, a login or a usage reading changes. Only profiles registered in AIObox; no cookie, no email beyond the account label AIObox already shows.
const profilesFile = () => path.join(aioboxDir(), 'profiles.json');
const PROFILES_VERSION = 1;
function readProfiles() {
  let raw;
  try {
    raw = fs.readFileSync(profilesFile(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Refusal('no_profiles', 'AIObox has not written ~/.aki/aiobox/profiles.json (a build before G1, or not started since)', 'ask the owner to update and start AIObox; until then open a window with op=new_window window=<a window of that profile>');
    throw e;
  }
  const doc = JSON.parse(raw);
  if (doc.version !== PROFILES_VERSION) throw new Error(`profiles.json version ${doc.version} is not supported (expected ${PROFILES_VERSION}); update AkiMCP or AIObox`);
  return doc;
}
// The flag that keeps an AI off a profile's provider: an account flag in force for that profileId and provider (a flag without provider is Notion's, guide v9). AIObox checks the same flags.json when it runs the request (D2).
const accountFlag = (flags, profileId, provider) => flags.find((f) => f.scope === 'account' && f.profileId === profileId && (f.provider ?? 'notion') === provider) || null;
function profilesView(now = Date.now()) {
  const doc = readProfiles();
  const { flags } = coordination(now);
  const providerView = (profileId) => (pr) => {
    const flag = accountFlag(flags, profileId, pr.id);
    const workspaceFlag = (w) => (pr.id === 'notion' && flags.find((f) => workspaceFlagged(f, { label: w.label, id: w.id, profileId }))) || null;
    const workspaces = Array.isArray(pr.workspaces) ? { workspaces: pr.workspaces.map((w) => ({ ...w, flag: workspaceFlag(w) })) } : {};
    return { ...pr, ...workspaces, flag, eligible: pr.login === 'signed_in' && !flag };
  };
  return { updatedAt: doc.updatedAt ?? null, profiles: (doc.profiles || []).map((p) => ({ ...p, providers: (p.providers || []).map(providerView(p.id)) })) };
}
// AIObox's url_allowed (request.rs, G4), checked here first so a bad address costs no request: lower-case http(s)://, at most 2048 bytes, no space or control character, no user@, a host of letters, digits, '.', '-' (or [IPv6]).
export const URL_MAX_BYTES = 2048;
export function urlNotAllowed(url) {
  if (Buffer.byteLength(url) > URL_MAX_BYTES) return `longer than ${URL_MAX_BYTES} bytes`;
  const rest = url.startsWith('https://') ? url.slice(8) : url.startsWith('http://') ? url.slice(7) : null;
  if (rest === null) return 'only an http:// or https:// address';
  if (/[\s\p{Cc}]/u.test(url)) return 'an address with a space or a control character';
  const authority = rest.split(/[/?#]/)[0];
  if (authority.includes('@')) return 'an address with a user@ before its host';
  const host = authority.startsWith('[') ? authority.slice(1).split(']')[0] : authority.split(':')[0];
  if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) return `no host an address can name ('${host}')`;
  return null;
}
// A profile by id or P#, registered in AIObox; no provider, so no sign-in or flag to check (open_url).
function registeredProfile(profile) {
  const view = profilesView();
  const number = /^P?(\d+)$/i.exec(String(profile).trim())?.[1];
  const p = view.profiles.find((x) => x.id === profile || (number !== undefined && String(x.number).replace(/^P/i, '') === number));
  if (!p) throw new Refusal('not_registered', `no AIObox profile '${profile}'; registered: ${view.profiles.map((x) => `${x.id} (P${x.number})`).join(', ') || 'none'}`, 'pick one from aki__aiobox op=profiles, or leave profile out for the system browser');
  return p.id;
}
// profile = its id, or its number as AIObox shows it (P9, 9). Refused with the same codes AIObox uses, so the AI reads one vocabulary.
function pickProfile(profile, provider) {
  const view = profilesView();
  const number = /^P?(\d+)$/i.exec(String(profile).trim())?.[1];
  const p = view.profiles.find((x) => x.id === profile || (number !== undefined && String(x.number).replace(/^P/i, '') === number));
  if (!p) throw new Refusal('not_registered', `no AIObox profile '${profile}'; registered: ${view.profiles.map((x) => `${x.id} (P${x.number})`).join(', ') || 'none'}`, 'pick an eligible one from aki__aiobox op=profiles');
  const pr = p.providers.find((x) => x.id === provider);
  if (!pr || pr.login !== 'signed_in') throw new Refusal('not_signed_in', `${p.id} is not signed in to ${provider} (${pr ? pr.login : 'AIObox has never seen it there'})`, 'pick an eligible profile from aki__aiobox op=profiles; an AI never signs in');
  if (pr.flag) throw new Refusal('flagged', `${p.id} ${provider} is flagged: ${pr.flag.reason}`, 'pick another eligible profile from aki__aiobox op=profiles');
  return { profileId: p.id, provider: pr.id };
}

// The request channel (aiobox plan aio-control-gaps D1): one file per request in ~/.aki/aiobox/requests/ (tmp + rename), { version: 1, id, op, args, at }. AIObox scans every 500 ms, deletes the file and runs it as an automation (ai-new-window, ai-handoff-open, ai-open-url) whose runs row carries request = id; there is no reply file. The third thing AkiMCP writes under ~/.aki/aiobox/, after windows.refresh and flags.json.
const requestsDir = () => path.join(aioboxDir(), 'requests');
const REQUEST_VERSION = 1;
const REQUEST_MAX_BYTES = 16 * 1024;
export const HANDOFF_TEXT_MAX_BYTES = 8 * 1024;
const REQUEST_PICKUP_MS = 5_000;
const REQUEST_POLL_MS = 250;
let requestSeq = 0;
async function sendRequest(op, args) {
  const id = `akimcp-${process.pid}-${Date.now()}-${(requestSeq += 1)}`;
  const body = `${JSON.stringify({ version: REQUEST_VERSION, id, op, args, at: new Date().toISOString() })}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > REQUEST_MAX_BYTES) throw new Refusal('too_large', `the ${op} request is ${bytes} bytes, over ${REQUEST_MAX_BYTES}`, 'shorten the text');
  fs.mkdirSync(requestsDir(), { recursive: true });
  const file = path.join(requestsDir(), `${id}.json`);
  const tmp = path.join(requestsDir(), `.${id}.tmp`);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  for (const end = Date.now() + REQUEST_PICKUP_MS; fs.existsSync(file); await sleep(REQUEST_POLL_MS)) {
    if (Date.now() < end) continue;
    try {
      fs.unlinkSync(file);
    } catch (e) {
      if (e.code === 'ENOENT') break; // AIObox took it just now
      throw e;
    }
    throw new Refusal('app_not_listening', `AIObox did not take request ${id} within ${REQUEST_PICKUP_MS / 1000}s; it was taken back`, 'ask the owner to start or update AIObox (a build with the request channel)');
  }
  return id;
}
// The run of a request, once it ended or the wait is over (null: no row yet).
async function awaitRequestRun(request, waitMs) {
  for (const end = Date.now() + waitMs; ; await sleep(REQUEST_POLL_MS)) {
    let run = null;
    try {
      run = readRuns(runsFile(), { request, last: 1 })[0] ?? null;
    } catch (e) {
      if (e.code !== 'no_runs' && !/database is (locked|busy)/i.test(String(e.message))) throw e;
    }
    if ((run && !run.running) || Date.now() >= end) return run;
  }
}
const stepsLine = (steps) => (steps || []).map((s) => `${s.step} ${s.status}${s.info ? ` (${s.info})` : ''}`).join(' → ') || 'none';
// What a request's run says: refused = a Refusal with AIObox's own code; ended badly = an error naming the step; still running = runId and how to read on; ok = detail as AIObox's machine-readable JSON.
function requestOutcome(op, request, run) {
  if (!run) return { request, runId: null, done: false, steps: [], next: `AIObox took the request but shows no run of it yet: aki__aiobox op=runs request=${request}; do not ask again` };
  if (run.outcome === 'refused') {
    const detail = String(run.detail ?? '');
    const at = detail.indexOf(': ');
    const [code, why] = at === -1 ? ['refused', detail] : [detail.slice(0, at), detail.slice(at + 2)];
    const next = code === 'budget' ? `AIObox opens few ${op === 'open_url' ? 'links' : 'windows'} an hour for AIs: do not ask again now; report "not opened: budget" or wait an hour` : code === 'url_not_allowed' ? 'pass a plain http:// or https:// address with a host' : code === 'invalid' || code === 'unknown_op' ? 'update AkiMCP or AIObox so they speak the same request version, or report it' : 'read aki__aiobox op=profiles and pick an eligible profile, or report it';
    throw new Refusal(code, `AIObox refused ${op} (run ${run.id}): ${why}`, next);
  }
  const base = { request, runId: run.id, done: !run.running, steps: run.steps ?? [] };
  if (run.running) return { ...base, next: `still running: aki__aiobox op=runs id=${run.id} reads each step; do not ask again` };
  if (run.outcome !== 'ok') throw new Error(`${op} run ${run.id} ended ${run.outcome}: ${run.detail ?? 'no detail'} (steps: ${stepsLine(run.steps)})`);
  let result = run.detail;
  try {
    result = JSON.parse(run.detail);
  } catch {}
  return { ...base, outcome: run.outcome, result };
}

const DRAFT_WARNING = 'the message box holds a draft, so busy may read false while it still answers (Notion); read it again later with op=read, and never touch the draft';
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
    // Per profile, every workspace of its account with its usage, from the first tab of it that holds the snapshot (Notion).
    const workspaces = {};
    const tabs = tabsOf(map).map((t) => {
      const p = probed.get(t.targetId);
      const row = tabRow(t);
      if (p?.macros?.length && !macros[row.provider]) macros[row.provider] = p.macros;
      if (p?.here?.scopes?.length && row.profileId && !workspaces[row.profileId]) workspaces[row.profileId] = p.here.scopes;
      return p ? { ...row, busy: p.busy, account: p.account, ...(p.read === undefined ? {} : { read: p.read }), ...hereOf(p) } : row;
    });
    return ok(JSON.stringify({ akimcp: VERSION, ops: opsList(), ...readGuide(), run: map.run, renumbered: renumberedOf(map), macros, ...coordination(), workspaces, tabs }, null, 2));
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
    const row = (h) => ({ ...tabRow(h.tab), busy: h.probe.busy, account: h.probe.account, ...hereOf(h.probe), matchedBy: h.probe.reader ? 'latest user message' : 'page text' });
    if (!pool.length) throw new Refusal('not_found', 'no AIObox chat window shows that quote', 'copy a longer exact passage of the latest user message; a chat outside AIObox has no window here');
    if (!pick) return ok(JSON.stringify({ akimcp: VERSION, ambiguous: pool.map(row) }, null, 2));
    return ok(JSON.stringify({ akimcp: VERSION, you: row(pick), keep: 'chatId, not the handle' }, null, 2));
  },
  async read(args) {
    need('read', args, ['window']);
    let opened;
    try {
      opened = await openTab(args);
    } catch (e) {
      // No tab shows it any more: the copy AIObox saved when the chat left its tab (quota handoff or close).
      const doc = e instanceof Refusal && e.code === 'no_window' && args.expect === undefined ? findArchive(args.window) : null;
      if (!doc) throw e;
      return ok(JSON.stringify(archivedRead(args.window, doc, args.last ?? 1), null, 2));
    }
    const { tab, live: target, used } = opened;
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(args.last ?? 1) });
    if (value?.error !== undefined) throw new Error(`AIObox chat reader in ${tab.handle}: ${value.error}`);
    if (value?.unsupported !== undefined) throw new Error(`AIObox chat capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${CHAT_VERSION}); update AkiMCP or AIObox`);
    const body = value?.source === 'raw' ? { source: 'raw', ...tailCodepoints(value.text, RAW_TEXT_CAP) } : value;
    return ok(JSON.stringify({ ...used, ...body }, null, 2));
  },
  // Until the chat stops answering, by AIObox's reader (busy); a page without one has no busy to read, so it is refused rather than guessed from the DOM.
  // A draft in the box makes Notion read busy false even mid-answer (aiobox f18ca9c), so idle with a draft is returned at once with a warning, not trusted and not waited on: only the owner clears a draft.
  async wait_idle(args) {
    need('wait_idle', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const limitMs = waitLimitS(args.timeout, WAIT_IDLE_DEFAULT_S) * 1000;
    const started = Date.now();
    for (;;) {
      const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(args.last ?? 1) });
      if (value?.source !== 'provider' || value.unsupported !== undefined) throw new Refusal('no_adapter', `${tab.handle} has no AIObox chat reader, so whether it is answering is unknown`, 'read it with op=read and judge from the text');
      if (value.error !== undefined) throw new Error(`AIObox chat reader in ${tab.handle}: ${value.error}`);
      const waitedMs = Date.now() - started;
      if (!value.busy && value.draft) return ok(JSON.stringify({ ...used, busy: false, draft: true, warning: [used.warning, DRAFT_WARNING].filter(Boolean).join(' Also: '), waitedMs, messages: value.messages }, null, 2));
      if (!value.busy) return ok(JSON.stringify({ ...used, busy: false, waitedMs, messages: value.messages }, null, 2));
      if (waitedMs >= limitMs) return ok(JSON.stringify({ ...used, busy: true, timedOut: true, waitedMs, next: WAIT_AGAIN }, null, 2));
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
  async runs(args) {
    return ok(JSON.stringify({ akimcp: VERSION, runs: readRuns(runsFile(), args) }, null, 2));
  },
  // Where a window can open (G1a): AIObox's profiles.json with each provider's flag and eligible (signed in, not flagged) laid over it.
  async profiles() {
    return ok(JSON.stringify({ akimcp: VERSION, ...profilesView() }, null, 2));
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
// One send, nothing sent on any refusal. v2: AIObox's live.send decides (busy, draft, queue). v1: a draft holds the message back untouched ({ held: 'draft' }); a chat answering takes it mid-answer only when it reads live/queued (owner 2026-10-04: those have no busy), by compose and the provider's send button into the empty box, else { held: 'busy' }; idle: live.send. users = user messages before, so the delivery check skips older copies of the same text.
const SUBMIT_SELECTORS = ['[aria-label="Submit AI message"]', 'button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Submit"]', 'button[type="submit"]'];
const SEND_JS = (text) => `(async () => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel.capabilities ?? {})) || {}; } catch {}
  if (caps.send === undefined || typeof panel.live?.send !== 'function') return { missing: true };
  if (caps.send !== ${SEND_VERSION} && caps.send !== ${SEND_V1}) return { unsupported: String(caps.send) };
  const reader = caps.chat === ${CHAT_VERSION} && typeof panel.live.chat === 'function';
  const now = reader ? panel.live.chat() : null;
  const users = now?.ok === true ? (now.data?.messages || []).filter((m) => m.role === 'user').length : null;
  const sendBy = async (r) => (r && r.ok === true ? { ok: true, users, ...(r.data || {}) } : { error: String(r?.error ?? 'live.send() returned no result') });
  if (caps.send === ${SEND_VERSION}) return sendBy(await panel.live.send(${JSON.stringify(text)}));
  if (now?.ok === true && now.data?.draft) return { held: 'draft' };
  if (now?.ok === true && now.data?.busy) {
    if ((panel.read !== 'live' && panel.read !== 'queued') || caps.compose !== ${COMPOSE_VERSION} || typeof panel.live.compose !== 'function') return { held: 'busy' };
    const c = await panel.live.compose(${JSON.stringify(text)});
    if (!c || c.ok !== true) return { error: String(c?.error ?? 'live.compose() returned no result') };
    const button = ${JSON.stringify(SUBMIT_SELECTORS)}.map((s) => document.querySelector(s)).find((b) => b && !b.disabled);
    if (!button) return { error: 'composed mid-answer but found no send button; the text is still in the message box' };
    button.click();
    return { ok: true, users, midAnswer: true };
  }
  return sendBy(await panel.live.send(${JSON.stringify(text)}));
})()`;
// delivered = a user message after the first `after` ones holds the sent text; polled 5 s, since a provider draws the new turn late.
const DELIVERED_JS = (text, after) => `(async () => {
  const panel = window.akipanel;
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel?.capabilities ?? {})) || {}; } catch {}
  if (caps.chat !== ${CHAT_VERSION} || typeof panel?.live?.chat !== 'function') return { unread: true };
  const plain = (s) => [...String(s ?? '').replace(/[*_\`~#>|\\[\\]()]/g, '').replace(/\\s+/g, ' ').trim()];
  const want = plain(${JSON.stringify(text)}).slice(0, ${DELIVERED_MATCH}).join('');
  for (let i = 0; i < 50; i++) {
    const r = panel.live.chat();
    const fresh = (r?.data?.messages || []).filter((m) => m.role === 'user').slice(${Number(after) || 0});
    if (fresh.some((m) => plain(m.text).join('').includes(want))) return { seen: true };
    await new Promise((res) => setTimeout(res, 100));
  }
  return { seen: false };
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
// akipanel.newChat() refuses itself (offline, busy, draft) and only asks AIObox to navigate this tab to the provider's home, so the old page is still there when it returns, and the navigation may even destroy the context of this very call.
const NEW_CHAT_JS = `(() => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  if (typeof panel.newChat !== 'function') return { missing: true };
  const r = panel.newChat();
  return r && r.ok === true ? { ok: true } : { error: String(r?.error ?? 'newChat() returned no result') };
})()`;
// Ready = the new page's panel is online and its chat reader shows an empty chat; a page without a reader only has its load state.
const NEW_CHAT_READY_JS = `(() => {
  const panel = window.akipanel;
  if (!panel?.online) return { ready: false, url: location.href };
  let caps = {};
  try { caps = JSON.parse(JSON.stringify(panel.capabilities ?? {})) || {}; } catch {}
  if (caps.chat !== ${CHAT_VERSION} || typeof panel.live?.chat !== 'function') return { ready: document.readyState === 'complete', url: location.href };
  const r = panel.live.chat();
  return { ready: !!(r && r.ok && r.data.messages.length === 0), url: location.href };
})()`;
// akipanel.placeLike(like) moves the calling window onto the bounds of `like` (handle or targetId, any profile) and resolves with them; AIObox itself sets the bounds, never a CDP call from here (owner 2026-10-04).
const PLACE_LIKE_JS = (like) => `(async () => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  if (typeof panel.placeLike !== 'function') return { missing: true };
  try {
    return { ok: true, bounds: JSON.parse(JSON.stringify(await panel.placeLike(${JSON.stringify(like)}) ?? null)) };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
})()`;
// akipanel.closeWindow({ successor }) closes the calling tab and refuses itself like newChat (offline, busy, draft, unreadable chat); the tab may be gone before the reply arrives. successor (a live handle, contract row closeWindow) is the one handoff edge AIObox writes to retired[]: it no longer infers one from placeLike (audit P1-2: any page can call placeLike).
const CLOSE_WINDOW_JS = (successor) => `(() => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  if (typeof panel.closeWindow !== 'function') return { missing: true };
  const r = panel.closeWindow(${successor ? JSON.stringify({ successor }) : ''});
  return r && r.ok === true ? { ok: true } : { error: String(r?.error ?? 'closeWindow() returned no result') };
})()`;
// akipanel.switchWorkspace(idOrLabel) (aiobox plan aio-control-gaps G2): Notion only, refused like newChat (busy, draft); AIObox then navigates the tab there (app.notion.com/<domain>, then Notion AI's home), so the old page is still there right after the call.
const WORKSPACES_JS = `(() => {
  const panel = window.akipanel;
  if (!panel) return { error: 'this window has no AIObox panel' };
  if (typeof panel.switchWorkspace !== 'function') return { missing: true };
  let scopes = [];
  try { scopes = JSON.parse(JSON.stringify(panel.usage?.usage?.scopes ?? [])) || []; } catch {}
  return { scopes: scopes.map((s) => ({ id: s.id, label: s.label ?? null })), pick: typeof panel.scopePick === 'string' ? panel.scopePick : null };
})()`;
const SWITCH_WORKSPACE_JS = (id) => `(() => {
  const r = window.akipanel.switchWorkspace(${JSON.stringify(id)});
  return r && r.ok === true ? { ok: true } : { error: String(r?.error ?? 'switchWorkspace() returned no result') };
})()`;
// scopePick already names the workspace on Notion's intermediate app.notion.com/<domain> page; the switch is done only once AIObox reached Notion AI's home, i.e. the new_chat readiness.
const SWITCHED_JS = `(() => ({ ...${NEW_CHAT_READY_JS}, pick: typeof window.akipanel?.scopePick === 'string' ? window.akipanel.scopePick : null }))()`;
// The id and label matching of akipanel.switchWorkspace: an id with or without dashes, a label trimmed, both case-insensitive.
const spaceKey = (id) => String(id).replace(/-/g, '').toLowerCase();
// Notion AI's home (provider/notion/mod.rs home_url) or an empty /chat: not the /<domain> or /p/<id> pages a switch passes through.
const atNotionAiHome = (url) => {
  try {
    const u = new URL(url);
    return u.pathname === '/ai' || (u.pathname === '/chat' && !u.searchParams.get('t'));
  } catch {
    return false;
  }
};
const findWorkspace = (scopes, wanted) => {
  const w = wanted.trim().toLowerCase();
  return scopes.find((s) => spaceKey(s.id) === spaceKey(w) || String(s.label ?? '').trim().toLowerCase() === w) || null;
};
const NAVIGATED = /context was destroyed|navigated or closed|Cannot find context/i;
// closeWindow is one-way to AIObox (P8·W1 a81d28d): the app refuses a successor not open, the same window or a loop only in its log, so a close counts once the tab is gone.
const CLOSE_WAIT_MS = 3_000;
const CLOSE_POLL_MS = 250;
const NEW_CHAT_WAIT_MS = 15_000;
// AIObox waits up to 20 s for app.notion.com and 8 s for scopePick (aiobox cdp/panel.rs switch_workspace), plus the navigation itself; under one tool call.
const SWITCH_WAIT_MS = 40_000;
const MACRO_RUN_JS = (id) => `(() => { const r = window.akipanel?.macroRuns?.[${JSON.stringify(id)}]; return r ? { status: r.status, message: r.message ?? null, at: r.at } : null; })()`;
const MACRO_ENDED = new Set(['done', 'started', 'skipped', 'error']);
const MACRO_WAIT_MS = CALL_WAIT_MAX_S * 1000;
const MACRO_POLL_MS = 500;
const NEW_WINDOW_WAIT_MS = 15_000;
const NEW_WINDOW_POLL_MS = 500;
const NEW_WINDOW_REST_MS = 1_100; // aiobox akipanel.ts NEW_WINDOW_REST_MS (1 s) plus a margin: while the panel rests, newWindow() is a no-op

const windowsOfProfile = (map, port) => (map.profiles || []).find((p) => p.port === port)?.windows || [];
const handlesOfProfile = (map, port) => new Set(windowsOfProfile(map, port).map((w) => w.handle));

// new_window without a window (G1b): AIObox opens one in any eligible profile, launching it when it is not running.
async function newWindowIn(args) {
  if (args.profile === undefined || args.provider === undefined) throw new Error('op=new_window needs window, or profile and provider');
  const target = pickProfile(args.profile, args.provider);
  const request = await sendRequest('new_window', target);
  const out = requestOutcome('new_window', request, await awaitRequestRun(request, waitLimitS(args.wait, CALL_WAIT_MAX_S) * 1000));
  const opened = out.result?.handle ? { window: out.result.handle, targetId: out.result.targetId ?? null } : {};
  return ok(JSON.stringify({ ...opened, ...target, ...out }, null, 2));
}

const WRITE_OPS = {
  async new_window(args) {
    if (args.window === undefined) return newWindowIn(args);
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
  // A whole handoff in one request (G5): AIObox opens the window, runs Connect AkiMCP there, verifies it, places it like `like` and sends text through send v2 with a reply; the old window stays for the caller to close once it read the new one.
  async handoff_open(args) {
    need('handoff_open', args, ['profile', 'provider', 'like', 'text']);
    const bytes = Buffer.byteLength(args.text);
    if (bytes > HANDOFF_TEXT_MAX_BYTES) throw new Refusal('too_large', `text is ${bytes} bytes, over ${HANDOFF_TEXT_MAX_BYTES}`, 'put the details in the working file or a handoff letter and send a short pointer');
    const like = resolveTab(readMap(), args.like).handle;
    const target = pickProfile(args.profile, args.provider);
    const request = await sendRequest('handoff_open', { ...target, like, text: args.text });
    const out = requestOutcome('handoff_open', request, await awaitRequestRun(request, waitLimitS(args.wait, CALL_WAIT_MAX_S) * 1000));
    const opened = out.result?.handle ? { window: out.result.handle, targetId: out.result.targetId ?? null, chatId: out.result.chatId ?? null } : {};
    const next = out.outcome === 'ok' ? { next: `op=read last=2 on ${opened.window ?? 'the new window'} to see it took the text; only if ${like} is the window handing off, then op=close_window window=${like} successor=${opened.window ?? '<new window>'}` } : {};
    return ok(JSON.stringify({ ...opened, ...target, like, ...out, ...next }, null, 2));
  },
  // A link for the user to see (G4): AIObox opens it in the system's browser, or with profile in a new browser window of that profile; 20 an hour, apart from the windows' budget.
  async open_url(args) {
    need('open_url', args, ['url']);
    const url = args.url.trim();
    const why = urlNotAllowed(url);
    if (why) throw new Refusal('url_not_allowed', `${why}: ${url.slice(0, 120)}`, 'pass a plain http:// or https:// address with a host');
    const profileId = args.profile === undefined ? null : registeredProfile(args.profile);
    const request = await sendRequest('open_url', { url, ...(profileId ? { profileId } : {}) });
    const out = requestOutcome('open_url', request, await awaitRequestRun(request, waitLimitS(args.wait, CALL_WAIT_MAX_S) * 1000));
    return ok(JSON.stringify({ url, profileId, opened: out.result?.opened ?? null, ...out }, null, 2));
  },
  // Same tab, fresh chat: the chat id is only in the URL after the first message, so the result has none.
  async new_chat(args) {
    need('new_chat', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, 'open another chat with op=new_window instead');
    let value;
    try {
      value = (await cdp.evaluate({ port: tab.port, target, expression: NEW_CHAT_JS })).value;
    } catch (e) {
      if (!NAVIGATED.test(e.message)) throw e;
      value = { ok: true };
    }
    if (value?.missing) throw new Refusal('no_new_chat', `${tab.handle} has no AIObox newChat (an older AIObox build)`, 'use op=new_window, or rebuild AIObox');
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    let last = null;
    for (const end = Date.now() + NEW_CHAT_WAIT_MS; Date.now() < end; await sleep(NEW_WINDOW_POLL_MS)) {
      last = (await cdp.evaluate({ port: tab.port, target, expression: NEW_CHAT_READY_JS }).catch(() => null))?.value ?? last;
      if (last?.ready && chatIdOf(last.url) === null) {
        return ok(JSON.stringify({ ...used, previousChatId: used.chatId, chatId: null, url: last.url, next: 'op=send the first message, then op=state shows its chatId' }, null, 2));
      }
    }
    throw new Error(`${tab.handle} did not show an empty chat within ${NEW_CHAT_WAIT_MS / 1000}s (now at ${last?.url ?? 'unknown'})`);
  },
  // Notion: the tab moves to another workspace of its account; AkiMCP refuses a flagged one and returns once the new page's panel names it.
  async switch_workspace(args) {
    need('switch_workspace', args, ['window', 'workspace']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, "switch your own tab with Notion's sidebar switcher");
    if (providerOf(tab.url) !== 'notion') throw new Refusal('not_notion', `${tab.handle} is not a Notion window`, 'only Notion has workspaces');
    const seen = (await cdp.evaluate({ port: tab.port, target, expression: WORKSPACES_JS })).value;
    if (seen?.missing) throw new Refusal('no_switch_workspace', `${tab.handle} has no AIObox switchWorkspace (an older AIObox build)`, "rebuild AIObox, or use Notion's sidebar switcher");
    if (seen?.error) throw new Error(`${tab.handle}: ${seen.error}`);
    const scope = findWorkspace(seen.scopes, args.workspace);
    if (!scope) throw new Refusal('no_workspace', `'${args.workspace}' is no workspace of ${tab.handle}'s account`, 'pick one by id or label from aki__aiobox op=state workspaces');
    const flag = coordination().flags.find((f) => workspaceFlagged(f, { label: scope.label, id: scope.id, profileId: tab.profile.id ?? null }));
    if (flag) throw new Refusal('flagged', `${scope.label ?? scope.id} is flagged: ${flag.reason}`, 'pick another workspace from aki__aiobox op=state workspaces');
    const workspace = { id: scope.id, label: scope.label };
    if (seen.pick && spaceKey(seen.pick) === spaceKey(scope.id)) return ok(JSON.stringify({ ...used, workspace, moved: false }, null, 2));
    const previousWorkspace = seen.pick ? findWorkspace(seen.scopes, seen.pick) ?? { id: seen.pick, label: null } : null;
    let value;
    try {
      value = (await cdp.evaluate({ port: tab.port, target, expression: SWITCH_WORKSPACE_JS(scope.id) })).value;
    } catch (e) {
      if (!NAVIGATED.test(e.message)) throw e;
      value = { ok: true };
    }
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    let last = null;
    for (const end = Date.now() + SWITCH_WAIT_MS; Date.now() < end; await sleep(NEW_WINDOW_POLL_MS)) {
      last = (await cdp.evaluate({ port: tab.port, target, expression: SWITCHED_JS }).catch(() => null))?.value ?? last;
      if (last?.ready && atNotionAiHome(last.url) && last.pick && spaceKey(last.pick) === spaceKey(scope.id)) {
        return ok(JSON.stringify({ ...used, previousChatId: used.chatId, chatId: chatIdOf(last.url), url: last.url, workspace, previousWorkspace, moved: true, next: 'op=send the first message there, then op=state shows its chatId' }, null, 2));
      }
    }
    throw new Error(`${tab.handle} did not show an empty chat in ${workspace.label ?? workspace.id} within ${SWITCH_WAIT_MS / 1000}s (now at ${last?.url ?? 'unknown'}, workspace ${last?.pick ?? 'unknown'})`);
  },
  // The new window of a handoff takes the old one's place; `like` may be a chatId too, sent to AIObox as that tab's targetId.
  async place_like(args) {
    need('place_like', args, ['window', 'like']);
    const { tab, live: target, used } = await openTab(args);
    let like = args.like;
    try { like = resolveTab(readMap(), args.like).targetId; } catch {}
    if (like === tab.targetId) throw new Refusal('same_window', `${tab.handle} cannot be placed like itself`, 'pass the old window as like and the new one as window');
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: PLACE_LIKE_JS(like), awaitPromise: true });
    if (value?.missing) throw new Refusal('no_place_like', `${tab.handle} has no AIObox placeLike (an older AIObox build)`, 'rebuild AIObox, or leave the window where it is');
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    return ok(JSON.stringify({ ...used, like, placed: true, bounds: value.bounds }, null, 2));
  },
  // Last step of a handoff: the old window closes itself through AIObox, naming the window that took over. A tool never closes a tab over CDP (owner 2026-10-04).
  async close_window(args) {
    need('close_window', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, 'only a successor closes the window it took over');
    const successor = args.successor ? resolveTab(readMap(), args.successor).handle : undefined;
    if (successor === tab.handle) throw new Refusal('same_window', `${tab.handle} cannot succeed itself`, 'pass the window that took over as successor, or leave it out');
    let value;
    try {
      value = (await cdp.evaluate({ port: tab.port, target, expression: CLOSE_WINDOW_JS(successor) })).value;
    } catch (e) {
      if (!NAVIGATED.test(e.message)) throw e;
      value = { ok: true };
    }
    if (value?.missing) throw new Refusal('no_close_window', `${tab.handle} has no AIObox closeWindow (an older AIObox build)`, 'ask the owner to close it; never close a tab over CDP');
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    for (const end = Date.now() + CLOSE_WAIT_MS; ; await new Promise((r) => setTimeout(r, CLOSE_POLL_MS))) {
      const open = (await cdp.listTargets({ port: tab.port }).catch(() => null))?.some((t) => t.id === tab.targetId);
      if (open === false) break;
      if (Date.now() >= end) throw new Error(`${tab.handle} is still open ${CLOSE_WAIT_MS / 1000}s after closeWindow: AIObox refused it${successor ? ` (successor ${successor} closed, the same window, or a loop)` : ''}; nothing was retired. Check op=windows, then try again`);
    }
    return ok(JSON.stringify({ ...used, closed: true, ...(successor && { successor }) }, null, 2));
  },
  // No window: flags.json is AIObox-wide. Flagging the same account or workspace again replaces its entry.
  async flag(args) {
    const target = flagTarget('flag', args);
    need('flag', args, ['reason']);
    let entry;
    const flags = changeFlags((list, now) => {
      entry = { provider: 'notion', ...target, reason: args.reason, flaggedAt: new Date(now).toISOString() };
      if (args.hours !== undefined) entry.until = new Date(now + args.hours * HOUR_MS).toISOString();
      return [...list.filter((f) => !sameTarget(f, target)), entry];
    });
    return ok(JSON.stringify({ flagged: entry, flags }, null, 2));
  },
  async unflag(args) {
    const target = flagTarget('unflag', args);
    let removed = 0;
    const flags = changeFlags((list) => {
      const kept = list.filter((f) => !sameTarget(f, target));
      removed = list.length - kept.length;
      return kept;
    });
    return ok(JSON.stringify({ unflagged: target, removed, flags }, null, 2));
  },
  async compose(args) {
    need('compose', args, ['window', 'text']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, "compose into the other session's window, found by its handle in op=state");
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: COMPOSE_JS(args.text), awaitPromise: true });
    if (value?.unsupported !== undefined) throw new Error(`AIObox compose capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${COMPOSE_VERSION}); update AkiMCP or AIObox`);
    if (!value?.ok) throw new Error(`${tab.handle}: ${value?.error ?? 'compose returned no result'}`);
    return ok(JSON.stringify({ ...used, composed: true, sent: false }, null, 2));
  },
  // Sends for real (SEND_JS); delivered: true only once DELIVERED_JS sees the text as a new user message. wait=<s> retries a message send v1 held back (a draft, or a blocked chat answering); send v2 queues those itself.
  async send(args) {
    need('send', args, ['window', 'text']);
    const { tab, live: target, used } = await openTab(args);
    if (args.from && args.from === used.chatId) throw new Refusal('self_target', `${tab.handle} is your own chat (${used.chatId})`, "send to the other session's window, found by its handle in op=state");
    const started = Date.now();
    const waitS = waitLimitS(args.wait, 0);
    let value;
    for (const end = started + waitS * 1000; ; await sleep(WAIT_IDLE_POLL_MS)) {
      ({ value } = await cdp.evaluate({ port: tab.port, target, expression: SEND_JS(args.text), awaitPromise: true }));
      if (!value?.held || Date.now() >= end) break;
    }
    const retry = waitS < CALL_WAIT_MAX_S ? 'op=send wait=50 in this turn' : 'op=send wait=50 again in this turn';
    if (value?.held === 'draft') throw new Refusal('draft', `${tab.handle} holds a draft in its message box${waitS ? ` after ${waitS}s` : ''}; it is left untouched`, `${retry}; still there: ask another window to relay it, or report "not sent: ${tab.handle} draft"`);
    if (value?.held) throw new Refusal('busy', `${tab.handle} is answering and its provider takes no message mid-answer (read=blocked)${waitS ? `, still after ${waitS}s` : ''}`, `${retry}; still busy: report "not sent: ${tab.handle} busy", never promise a later send`);
    if (value?.missing) throw new Refusal('no_send', `${tab.handle} has no AIObox send capability (an older AIObox build, or not a chat page)`, 'use op=compose and ask the owner to press Enter, or rebuild AIObox');
    if (value?.unsupported !== undefined) throw new Error(`AIObox send capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${SEND_VERSION} or ${SEND_V1}); update AkiMCP or AIObox`);
    if (!value?.ok) throw new Error(`${tab.handle}: ${value?.error ?? 'send returned no result'}`);
    const how = { ...(value.midAnswer ? { midAnswer: true } : {}), ...(value.draft ? { draft: value.draft } : {}) };
    if (value.queued) return ok(JSON.stringify({ ...used, sent: false, delivered: false, queued: true, position: value.position, reason: value.reason, waitedMs: Date.now() - started, next: `AIObox holds it and sends it once ${tab.handle} can take it; it arrived only when op=read there shows it` }, null, 2));
    const seen = (await cdp.evaluate({ port: tab.port, target, expression: DELIVERED_JS(args.text, value.users), awaitPromise: true })).value;
    const delivered = seen?.seen === true;
    return ok(JSON.stringify({ ...used, sent: true, delivered, ...how, waitedMs: Date.now() - started, ...(delivered ? {} : { next: `${seen?.unread ? 'this page has no chat reader' : 'the message does not show in the chat yet'}: op=read last=3 on ${tab.handle} before saying it arrived; never send it again before reading` }) }, null, 2));
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
  detect: () => (aioboxInstalled() ? { available: true } : { available: false, reason: `no ~/.aki/aiobox/. ${AIOBOX_PITCH}` }),
  register,
};

const windowArg = z.string().optional().describe('handle P#·W#, chatId or targetId');
const expectArg = z.string().optional().describe('targetId, chatId, or text the url or title must contain; refused if the window shows another');

export function register(server) {
  server.registerTool(
    'aiobox',
    {
      title: 'AIObox: read windows by handle',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Read AIObox windows. Start with op=state: every window (chatId, provider, account, busy, workspace, usage), macros, flags, the guide for acting. op=whoami quote=<20+ chars verbatim of the latest user message> finds your window. Name a window by handle P#·W# (lasting; a retired one leads to its successor), chatId or targetId; expect refuses a window showing another chat. op=windows: tabs only. op=profiles: where a new window can open (login, usage, flag, eligible). op=read: last=N messages, or the saved copy of a chat no tab shows. op=wait_idle: until it stops answering. op=text: by selector. op=screenshot. op=runs: automation runs; id= or request=: one, with steps. Acting: aki__aiobox_write.',
      inputSchema: {
        op: z.enum(Object.keys(READ_OPS)).describe(Object.keys(READ_OPS).join(' | ')),
        window: windowArg,
        expect: expectArg,
        quote: z.string().optional().describe('whoami: 20+ characters copied verbatim from the latest user message'),
        timeout: z.number().int().min(1).max(300).optional().describe('wait_idle: seconds (default and most 50 per call; call again while next says so)'),
        last: z.number().int().min(1).max(50).optional().describe('read, wait_idle: messages from the end (default 1); runs: runs (default 10)'),
        automation: z.string().optional().describe('runs: automation id, e.g. usage, connect-akimcp-notion, ai-handoff-open'),
        since: z.string().optional().describe('runs: started at or after this RFC 3339 UTC stamp'),
        id: z.number().int().positive().optional().describe('runs: one run (a runId)'),
        request: z.string().optional().describe('runs: by AkiMCP request id'),
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
        `Act in an AIObox window (handle, chatId or targetId; rules: aki__aiobox op=state); from=<your chatId>. op=new_window: window= or profile+provider (aki__aiobox op=profiles). op=handoff_open: profile, provider, like, text; steps: op=runs id=<runId>. ${OPEN_RULE} op=open_url: url, profile?. op=new_chat: fresh chat. op=switch_workspace: workspace=. op=send: even mid-answer (delivered:true shown, queued:true held). op=compose: fills only. op=run_macro: macro, option. op=place_like: bounds of like. op=close_window: idle; successor= retires. op=flag/unflag: no-use list. op=eval: page JS.`,
      inputSchema: {
        op: z.enum(Object.keys(WRITE_OPS)).describe(Object.keys(WRITE_OPS).join(' | ')),
        window: windowArg,
        expect: expectArg,
        from: z.string().optional().describe('your own chatId (aki__aiobox op=whoami); send, compose, new_chat, switch_workspace, close_window refuse it'),
        like: z.string().optional().describe('place_like, handoff_open: the window to copy the place of (handle, chatId or targetId)'),
        provider: z.string().optional().describe('new_window, handoff_open, flag, unflag: notion, claude, gpt or grok (flag default notion)'),
        successor: z.string().optional().describe('close_window: the window that took over (handle, chatId or targetId); the closed handle then leads to it'),
        macro: z.string().optional().describe('run_macro: macro id (op=state macros)'),
        option: z.string().optional().describe('run_macro: option id (default: the first)'),
        text: z.string().optional().describe('send, compose, handoff_open: the text (handoff_open ≤8 KB)'),
        wait: z.number().int().min(0).max(300).optional().describe('send: seconds to retry a draft or blocked chat (default 0); new_window, handoff_open, open_url: run wait (default 50); max 50 per call'),
        url: z.string().optional().describe('open_url: http(s) link for the user; system browser, or profile\'s new window'),
        expression: z.string().optional().describe('eval: JS evaluated in the page; the last expression is returned'),
        awaitPromise: z.boolean().optional().describe('eval: await a returned Promise (default true)'),
        account: z.string().optional().describe('flag, unflag: account label (op=state account)'),
        profile: z.string().optional().describe('flag, unflag: its profileId; new_window, handoff_open, open_url: profileId or P#'),
        workspace: z.string().optional().describe('flag, unflag: a workspace label instead; switch_workspace: its id or label (Notion)'),
        reason: z.string().optional().describe('flag: why'),
        hours: z.number().positive().max(720).optional().describe('flag: hours in force (none = until unflag)'),
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
