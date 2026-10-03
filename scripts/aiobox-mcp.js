// AIObox windows by handle (P7·W2): aki__aiobox reads, aki__aiobox_write runs JS. Built on cdp-engine.js the way postman-mcp.js is: AIObox knowledge lives here, devtools_* stay app-agnostic.
// Contract with aiobox (windows.json shape, handle forms, akipanel.live.chat()): docs/plan/IMPORTANT-akimcp-aiobox-contract.md. Plan: docs/plan/provider-toolkit-architecture.md § Provider aiobox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ok, okImage, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';

// Resolved per call, not at import: HOME is read when the tool runs, so a test (or a changed HOME) is honored.
const aioboxDir = () => path.join(os.homedir(), '.aki', 'aiobox');
const windowsFile = () => path.join(aioboxDir(), 'cdp', 'windows.json');
// What this server last saw of the map, kept on disk so the renumbering check survives an AkiMCP restart too. AkiMCP's own data dir, never AIObox's.
const seenFile = () => path.join(process.env.AKI_MCP_DATA_DIR || path.join(os.homedir(), '.aki', 'mcpsv'), 'aiobox-seen.json');

const MAP_VERSION = 1;
const CHAT_VERSION = 1; // akipanel.capabilities.chat: the shape of live.chat() this reader understands
const COMPOSE_VERSION = 2; // akipanel.capabilities.compose: live.compose(text) returns a Promise of { ok, error }
const RAW_TEXT_CAP = 20_000; // codepoints of page text returned by op=read without a provider reader; the tail is kept, since the latest message is at the end
const TEXT_ELEMENTS_CAP = 50;
const TEXT_ELEMENT_CAP = 4_000;

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
    if (e.code === 'ENOENT') throw new Error('AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)');
    throw e;
  }
  const map = JSON.parse(raw);
  if (map.version !== MAP_VERSION) throw new Error(`windows.json version ${map.version} is not supported (expected ${MAP_VERSION}); update AkiMCP or AIObox`);
  // app { pid, startedAt }: AIObox's run, when it writes one (proposed in the contract); writtenAt: the file's mtime, always.
  map.generation = { writtenAt, app: map.app && typeof map.app === 'object' ? { pid: map.app.pid ?? null, startedAt: map.app.startedAt ?? null } : null };
  map.renumbered = observe(map);
  return map;
}

const tabsOf = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).flatMap((w) => (w.tabs || []).map((t) => ({ ...t, port: p.port, profile: p }))));
const windowHandles = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).map((w) => w.handle));
const appKey = (g) => (g.app ? `${g.app.pid}@${g.app.startedAt}` : null);

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
  const app = appKey(map.generation);
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
      fs.writeFileSync(tmp, JSON.stringify({ at: map.generation.writtenAt, app, byTarget, chatOf, last }));
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
  if (!tab) throw new Error(`no window '${input}'; open: ${windowHandles(map).join(', ') || 'none'}`);
  return tab;
}

// expect: the tab the caller means, as a targetId, chat id, or text its url or title contains. Checked against the live target, so a handle that now names another chat is refused instead of acted on.
function checkExpect(tab, live, expect) {
  if (expect === undefined || expect === '') return;
  const url = live.url || tab.url || '';
  const title = stripHandle(live.title || tab.title || '');
  const chatId = chatIdOf(url);
  if (live.id === expect || tab.targetId === expect || chatId === expect || url.includes(expect) || title.includes(expect)) return;
  throw new Error(`handle ${tab.handle} now points to "${title}" (${chatId ? `chat ${chatId}` : `target ${tab.targetId}`}), not "${expect}"; handles were renumbered or reassigned: call aki__aiobox op=windows and name the window by its chat id`);
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

// Resolve and check one window for an op: fresh map, live target, optional expect.
async function openTab(args) {
  const map = readMap();
  const tab = resolveTab(map, args.window);
  const live = await liveTarget(tab);
  checkExpect(tab, live, args.expect);
  return { map, tab, live, used: usedTab(tab, live, map) };
}

// The map and Chrome can disagree for a moment (a window just closed, a handle renumbered). A live target whose title carries a different written handle, or no live target at all, means the map is stale: refuse rather than act on the wrong window. A page without a title prefix (chrome://, new tab) is accepted, since AIObox cannot prefix it.
async function liveTarget(tab) {
  const live = (await cdp.listTargets({ port: tab.port })).find((t) => t.id === tab.targetId);
  if (!live) throw new Error(`window map is stale: ${tab.handle} (target ${tab.targetId}) is no longer open on port ${tab.port}`);
  const head = (live.title || '').split(TITLE_SEP)[0];
  const h = parseHandle(head);
  if (h?.window && formatHandle(h.profile, h.window, h.tab) === head && head !== tab.handle) {
    throw new Error(`window map is stale: target ${tab.targetId} is titled ${head}, not ${tab.handle}`);
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

function need(op, args, fields) {
  const missing = fields.filter((f) => args[f] === undefined || args[f] === '');
  if (missing.length) throw new Error(`op=${op} needs ${missing.join(', ')}`);
}

const READ_OPS = {
  windows() {
    const map = readMap();
    const tabs = tabsOf(map).map((t) => ({ handle: t.handle, chatId: chatIdOf(t.url), targetId: t.targetId, profileId: t.profile.id ?? null, provider: providerOf(t.url), profile: t.profile.name, title: stripHandle(t.title), url: t.url }));
    const renumbered = map.renumbered ? { ...map.renumbered, warning: renumberWarning(map.renumbered) } : null;
    return ok(JSON.stringify({ generation: map.generation, renumbered, tabs }, null, 2));
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
const NEW_WINDOW_WAIT_MS = 15_000;
const NEW_WINDOW_POLL_MS = 500;

const windowsOfProfile = (map, port) => (map.profiles || []).find((p) => p.port === port)?.windows || [];

const WRITE_OPS = {
  async new_window(args) {
    need('new_window', args, ['window']);
    const { tab, live: target, used } = await openTab(args);
    const before = new Set(windowsOfProfile(readMap(), tab.port).map((w) => w.handle));
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: NEW_WINDOW_JS });
    if (value?.error) throw new Error(`${tab.handle}: ${value.error}`);
    // AIObox rewrites windows.json once the window exists; the new handle is the one this profile did not have before.
    for (const end = Date.now() + NEW_WINDOW_WAIT_MS; Date.now() < end; await new Promise((r) => setTimeout(r, NEW_WINDOW_POLL_MS))) {
      let map;
      try {
        map = readMap();
      } catch {
        continue;
      }
      const opened = windowsOfProfile(map, tab.port).find((w) => !before.has(w.handle));
      const first = opened?.tabs?.[0];
      if (first) return ok(JSON.stringify({ window: opened.handle, targetId: first.targetId, chatId: chatIdOf(first.url), opener: tab.handle, openerTargetId: tab.targetId, provider: providerOf(first.url), url: first.url, title: stripHandle(first.title), ...(used.warning ? { warning: used.warning } : {}) }, null, 2));
    }
    throw new Error(`AIObox did not list a new window for ${tab.handle}'s profile within ${NEW_WINDOW_WAIT_MS / 1000}s`);
  },
  async compose(args) {
    need('compose', args, ['window', 'text']);
    const { tab, live: target, used } = await openTab(args);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: COMPOSE_JS(args.text), awaitPromise: true });
    if (value?.unsupported !== undefined) throw new Error(`AIObox compose capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${COMPOSE_VERSION}); update AkiMCP or AIObox`);
    if (!value?.ok) throw new Error(`${tab.handle}: ${value?.error ?? 'compose returned no result'}`);
    return ok(JSON.stringify({ ...used, composed: true, sent: false }, null, 2));
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

const windowArg = z.string().optional().describe('read, text, screenshot: handle P#·W#, chatId or targetId');
const expectArg = z.string().optional().describe('targetId, chatId, or text the url or title must contain; refused if window names another tab');

export function register(server) {
  server.registerTool(
    'aiobox',
    {
      title: 'AIObox: read windows by handle',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Read AIObox Chrome windows. A handle P#·W# (·T# for a later tab; p7w2, P7.W2 work) is only the label AIObox gives a window now, and a restart renumbers it. Stable names: chatId (URL: Notion ?t=, ChatGPT /c/) and targetId; window takes any of the three. Before acting on another session call op=windows (tabs with chatId, targetId, profileId, plus generation and renumbered) and name it by chatId or pass expect. op=read: last messages (last=N) from AIObox\'s reader, else page text, plus account. op=text: elements matching selector. op=screenshot. Results name the tab used. No windows.json: AIObox not running. JS: aki__aiobox_write.',
      inputSchema: {
        op: z.enum(Object.keys(READ_OPS)).describe('windows | read | text | screenshot'),
        window: windowArg,
        expect: expectArg,
        last: z.number().int().min(1).max(50).optional().describe('read: messages from the end (default 1)'),
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
      title: 'AIObox: open a window, fill its chat box or run JS',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Act in an AIObox window (handle, chatId or targetId; see aki__aiobox). A handle can be renumbered: pass expect to refuse a tab that is not the one meant. op=new_window: a new window (new chat) of the same profile and provider, as the panel button does; returns its handle, chatId, targetId. op=compose: text is added to the chat box (Notion AI chat), never sent. op=eval: expression runs in the page and the serialized result returns; awaitPromise (default true). It can click, type and change the page.',
      inputSchema: {
        op: z.enum(Object.keys(WRITE_OPS)).describe('new_window | compose | eval'),
        window: z.string().optional().describe('new_window, compose, eval: handle P#·W#, chatId or targetId'),
        expect: expectArg,
        text: z.string().optional().describe('compose: text to add'),
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
