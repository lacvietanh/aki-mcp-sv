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

const MAP_VERSION = 1;
const CHAT_VERSION = 1; // akipanel.capabilities.chat: the shape of live.chat() this reader understands
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

// Read on every call: AIObox rewrites the file whole whenever a window opens or closes, so a cached copy would name windows that are gone.
function readMap() {
  let raw;
  try {
    raw = fs.readFileSync(windowsFile(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)');
    throw e;
  }
  const map = JSON.parse(raw);
  if (map.version !== MAP_VERSION) throw new Error(`windows.json version ${map.version} is not supported (expected ${MAP_VERSION}); update AkiMCP or AIObox`);
  return map;
}

const tabsOf = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).flatMap((w) => (w.tabs || []).map((t) => ({ ...t, port: p.port, profile: p }))));
const windowHandles = (map) => (map.profiles || []).flatMap((p) => (p.windows || []).map((w) => w.handle));

function resolveTab(map, input) {
  const h = parseHandle(input);
  const tabs = tabsOf(map);
  const tab = h?.window ? tabs.find((t) => t.handle === formatHandle(h.profile, h.window, h.tab)) : tabs.find((t) => t.targetId === input);
  if (!tab) throw new Error(`no window '${input}'; open: ${windowHandles(map).join(', ') || 'none'}`);
  return tab;
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
  if (caps.chat === ${CHAT_VERSION} && typeof panel?.live?.chat === 'function') {
    const r = panel.live.chat();
    if (!r || r.ok !== true) return { source: 'provider', error: String(r?.error ?? 'live.chat() returned no result') };
    const data = r.data || {};
    return { source: 'provider', busy: !!data.busy, messages: (data.messages || []).slice(-${last}).map((m) => ({ role: m.role, text: m.text })) };
  }
  if (caps.chat !== undefined) return { source: 'provider', unsupported: String(caps.chat) };
  const root = document.body || document.querySelector('main');
  return { source: 'raw', text: root ? root.innerText : '' };
})()`;

const TEXT_JS = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, ${TEXT_ELEMENTS_CAP}).map((el) => ({ text: Array.from(el.innerText || '').slice(0, ${TEXT_ELEMENT_CAP}).join(''), ariaLabel: el.getAttribute('aria-label') }))`;

function need(op, args, fields) {
  const missing = fields.filter((f) => args[f] === undefined || args[f] === '');
  if (missing.length) throw new Error(`op=${op} needs ${missing.join(', ')}`);
}

const READ_OPS = {
  windows() {
    const tabs = tabsOf(readMap()).map((t) => ({ handle: t.handle, provider: providerOf(t.url), profile: t.profile.name, title: stripHandle(t.title), url: t.url }));
    return ok(JSON.stringify(tabs, null, 2));
  },
  async read(args) {
    need('read', args, ['window']);
    const tab = resolveTab(readMap(), args.window);
    const target = await liveTarget(tab);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: READ_JS(args.last ?? 1) });
    if (value?.error !== undefined) throw new Error(`AIObox chat reader in ${tab.handle}: ${value.error}`);
    if (value?.unsupported !== undefined) throw new Error(`AIObox chat capability version ${value.unsupported} in ${tab.handle} is not supported (expected ${CHAT_VERSION}); update AkiMCP or AIObox`);
    const body = value?.source === 'raw' ? { source: 'raw', ...tailCodepoints(value.text, RAW_TEXT_CAP) } : value;
    return ok(JSON.stringify({ window: tab.handle, ...body }, null, 2));
  },
  async text(args) {
    need('text', args, ['window', 'selector']);
    const tab = resolveTab(readMap(), args.window);
    const target = await liveTarget(tab);
    const { value } = await cdp.evaluate({ port: tab.port, target, expression: TEXT_JS(args.selector) });
    return ok(JSON.stringify(value, null, 2));
  },
  async screenshot(args) {
    need('screenshot', args, ['window']);
    const tab = resolveTab(readMap(), args.window);
    const target = await liveTarget(tab);
    const { data, mimeType } = await cdp.screenshot({ port: tab.port, target, format: args.format });
    return okImage(data, mimeType);
  },
};

const WRITE_OPS = {
  async eval(args) {
    need('eval', args, ['window', 'expression']);
    const tab = resolveTab(readMap(), args.window);
    const target = await liveTarget(tab);
    const out = await cdp.evaluate({ port: tab.port, target, expression: args.expression, awaitPromise: args.awaitPromise ?? true });
    return ok(JSON.stringify({ window: tab.handle, ...out }, null, 2));
  },
};

// Detect by install (the ~/.aki/aiobox/ folder), not by AIObox running: a closed AIObox keeps its tools listed and answers "not running".
export const provider = {
  id: 'aiobox',
  title: 'AIObox windows',
  detect: () => (fs.existsSync(aioboxDir()) ? { available: true } : { available: false, reason: 'AIObox is not installed (no ~/.aki/aiobox/)' }),
  register,
};

const windowArg = z.string().optional().describe('read, text, screenshot: handle P#·W# in any typed form, or a CDP targetId');

export function register(server) {
  server.registerTool(
    'aiobox',
    {
      title: 'AIObox: read windows by handle',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Read AIObox Chrome windows by handle. A handle is P#·W# (profile, window; a later tab adds ·T#), the same prefix AIObox puts at the start of each page title; typed forms like p7w2 or P7.W2 work. op=windows: every open tab with handle, provider, profile, title, url; a tab URL carries its chat id (Notion ?t=<id>, ChatGPT /c/<id>), so a chat finds its own window there. op=read: last messages of the chat in window (last=N, default 1), from AIObox\'s reader when the page has one, else the page text. op=text: text of elements matching selector. op=screenshot: image of window. No ~/.aki/aiobox/cdp/windows.json means AIObox is not running. Running JS: aki__aiobox_write.',
      inputSchema: {
        op: z.enum(Object.keys(READ_OPS)).describe('windows | read | text | screenshot'),
        window: windowArg,
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
      title: 'AIObox: run JS in a window',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Run JavaScript in an AIObox window named by handle (P#·W#, see aki__aiobox) and return the serialized result. op=eval: expression runs in window; awaitPromise (default true) waits for a returned Promise. It can click, type and change the page.',
      inputSchema: {
        op: z.enum(Object.keys(WRITE_OPS)).describe('eval'),
        window: z.string().optional().describe('eval: handle P#·W# in any typed form, or a CDP targetId'),
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
