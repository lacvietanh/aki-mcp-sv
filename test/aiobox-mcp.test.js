#!/usr/bin/env node
// aki__aiobox / aki__aiobox_write against a temp HOME with a sample windows.json and a fake CDP engine: no Chrome, no AIObox needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aiobox-mcp-test-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
// userdata.js fixes the data dir at import, so the env goes first and the modules after.
process.env.AKI_MCP_DATA_DIR = path.join(home, 'mcpsv');
const { default: cdp } = await import('../scripts/cdp-engine.js');
const { register, provider, parseHandle, formatHandle, stripHandle, chatIdOf, waitLimitS, CALL_WAIT_MAX_S } = await import('../scripts/aiobox-mcp.js');
const mapFile = path.join(home, '.aki', 'aiobox', 'cdp', 'windows.json');
const seenFile = path.join(home, 'mcpsv', 'aiobox-seen.json');

assert.equal(chatIdOf('https://app.notion.com/chat?t=3ee3f2314f05808e&wfv=chat'), '3ee3f2314f05808e');
assert.equal(chatIdOf('https://chatgpt.com/c/68a1-b2'), '68a1-b2');
assert.equal(chatIdOf('https://claude.ai/chat/abc-123'), 'abc-123');
assert.equal(chatIdOf('https://gemini.google.com/app/f00d'), 'f00d');
assert.equal(chatIdOf('https://claude.ai/new'), null);
assert.equal(chatIdOf('https://app.notion.com/chat'), null);
assert.equal(chatIdOf('not a url'), null);

// The same examples as aiobox cdp/handle.rs tests, so the two parsers cannot drift apart unnoticed.
const window = { profile: 3, window: 2, tab: null };
for (const typed of ['P3·W2', 'P3.W2', 'p3w2', 'P3-W2', 'P3 W2', ' p3 · w2 ']) assert.deepEqual(parseHandle(typed), window, typed);
assert.deepEqual(parseHandle('P12·W1·T10'), { profile: 12, window: 1, tab: 10 });
assert.deepEqual(parseHandle('p12.w1.t10'), { profile: 12, window: 1, tab: 10 });
assert.deepEqual(parseHandle('P3'), { profile: 3, window: null, tab: null });
for (const typed of ['', 'W2', 'P', 'P0', 'P3W', 'P3T2', 'P3W2X', 'P3·W2·T2·T3', 'Notion']) assert.equal(parseHandle(typed), null, typed);
assert.equal(formatHandle(3, 2, null), 'P3·W2');
assert.equal(formatHandle(3, 2, 1), 'P3·W2');
assert.equal(formatHandle(3, 2, 4), 'P3·W2·T4');
assert.equal(stripHandle('P3·W2 · me@x.com · Inbox'), 'me@x.com · Inbox');
assert.equal(stripHandle('P3·W2·T4 · Claude'), 'Claude');
assert.equal(stripHandle('P3 · Notes'), 'P3 · Notes');
assert.equal(stripHandle('p3w2 · Notes'), 'p3w2 · Notes');
assert.equal(stripHandle('New Tab'), 'New Tab');

assert.equal(provider.detect().available, false, 'no ~/.aki/aiobox/ = not installed');
assert.match(provider.detect().reason, /AIObox \(not installed here\).*https:\/\/aiobox\.app\/guide\/aiobox\.md/, 'the not-installed reason says what AIObox adds (D7)');

const mcp = new McpServer({ name: 't', version: '1' });
register(mcp);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await mcp.connect(serverSide);
const client = new Client({ name: 't', version: '1' });
await client.connect(clientSide);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text, content: r.content };
};

const missing = await call('aiobox', { op: 'windows' });
assert.ok(missing.isError);
assert.match(missing.text, /^rejected: AIObox is not running \(no ~\/\.aki\/aiobox\/cdp\/windows\.json\) \(not_running; next: ask the owner to start AIObox; akimcp \d+\.\d+\.\d+\)$/, 'a refusal carries its code, the next step and the running version');

fs.mkdirSync(path.dirname(mapFile), { recursive: true });
fs.writeFileSync(mapFile, JSON.stringify({
  version: 1,
  profiles: [
    { number: 1, id: 'chrome-profile-11', name: 'nt@x.com', port: 1111, windows: [
      { handle: 'P1·W1', windowId: 1, state: 'normal', tabs: [{ handle: 'P1·W1', targetId: 'T-NOTION', url: 'https://app.notion.com/chat?t=abc&wfv=chat', title: 'P1·W1 · nt@x.com · Chat | Notion' }] },
    ] },
    { number: 7, id: 'chrome-profile-10', name: 'lac', port: 7777, windows: [
      { handle: 'P7·W2', windowId: 2, state: 'normal', tabs: [
        { handle: 'P7·W2', targetId: 'T-GPT', url: 'https://chatgpt.com/c/123', title: 'lac · Review' },
        { handle: 'P7·W2·T2', targetId: 'T-CLAUDE', url: 'https://claude.ai/new', title: 'Claude' },
      ] },
    ] },
  ],
}));
assert.equal(provider.detect().available, true);

// A fake AIObox 0.8.0 refresh responder: takes the id in windows.refresh, deletes the file, rewrites windows.json with answered = id (onRefresh may change the windows first). Only maps that carry epoch are ever refreshed.
const refreshFile = path.join(home, '.aki', 'aiobox', 'cdp', 'windows.refresh');
let onRefresh = null;
let answering = true;
let refreshes = 0;
const responder = setInterval(() => {
  if (!answering || !fs.existsSync(refreshFile)) return;
  const id = fs.readFileSync(refreshFile, 'utf8').trim();
  fs.unlinkSync(refreshFile);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  onRefresh?.(map);
  onRefresh = null;
  refreshes += 1;
  fs.writeFileSync(mapFile, JSON.stringify({ ...map, generation: (map.generation || 0) + 1, updatedAt: new Date().toISOString(), answered: id }));
}, 20);

const listed = JSON.parse((await call('aiobox', { op: 'windows' })).text);
const windows = listed.tabs;
assert.deepEqual(windows.map((w) => [w.handle, w.provider, w.profile]), [['P1·W1', 'notion', 'nt@x.com'], ['P7·W2', 'gpt', 'lac'], ['P7·W2·T2', 'claude', 'lac']]);
assert.equal(windows[0].title, 'nt@x.com · Chat | Notion', 'the handle prefix is stripped from the title');
assert.deepEqual(windows.map((w) => [w.chatId, w.targetId, w.profileId]), [['abc', 'T-NOTION', 'chrome-profile-11'], ['123', 'T-GPT', 'chrome-profile-10'], [null, 'T-CLAUDE', 'chrome-profile-10']], 'every tab carries its stable ids');
assert.match(listed.run.writtenAt, /^\d{4}-\d\d-\d\dT/);
assert.equal(listed.run.epoch, null, 'an AIObox before 0.8.0 writes no epoch');
assert.equal(refreshes, 0, 'and is never asked to refresh');
assert.equal(listed.renumbered, null, 'first sight: nothing to compare with');
assert.ok(fs.existsSync(seenFile), 'the map seen is kept in AkiMCP\'s data dir');

assert.equal((await call('aiobox', { op: 'read' })).text, 'rejected: op=read needs window');
assert.equal((await call('aiobox', { op: 'text', window: 'P1·W1' })).text, 'rejected: op=text needs selector');
assert.match((await call('aiobox', { op: 'read', window: 'P9·W9' })).text, /^rejected: no window 'P9·W9'; open: P1·W1, P7·W2 \(no_window; next: call aki__aiobox op=state/);

// Fake engine: the live targets per port, and what the page would return for each expression.
const live = {
  1111: [{ id: 'T-NOTION', type: 'page', title: 'P1·W1 · nt@x.com · Chat | Notion', url: 'https://app.notion.com/chat?t=abc' }],
  7777: [{ id: 'T-GPT', type: 'page', title: 'P7·W2 · lac · Review', url: 'https://chatgpt.com/c/123' }, { id: 'T-CLAUDE', type: 'page', title: 'P7·W3 · Claude', url: 'https://claude.ai/new' }],
};
// The read expression really runs, in a vm against a fake page, so the capability check and the live.chat() shape are tested, not mocked. akipanel is a readonly Proxy like AIObox's; the result crosses a JSON round trip like CDP returnByValue.
const readonlyPanel = (panel) => new Proxy(panel, { set: () => false, defineProperty: () => false, deleteProperty: () => false });
const chatOk = (messages, busy = false) => () => ({ ok: true, data: { messages, busy } });
const notionMessages = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }, { role: 'user', text: 'q2' }, { role: 'assistant', text: 'done' }];
const pages = {
  'T-NOTION': { akipanel: readonlyPanel({ capabilities: { chat: 1 }, live: { chat: chatOk(notionMessages) } }), body: 'notion body' },
  // No capability: the raw page text, from body since Notion-like pages have no <main>, even if a live.chat happens to exist.
  'T-GPT': { akipanel: readonlyPanel({ capabilities: {}, live: { chat: chatOk([{ role: 'assistant', text: 'never read' }]) } }), body: 'x'.repeat(25_000) + 'END' },
};
const runInPage = (id, expression) => {
  const page = pages[id] || {};
  const document = { body: { innerText: page.body ?? '' }, querySelector: page.querySelector ?? (() => null), readyState: 'complete' };
  return Promise.resolve(vm.runInNewContext(expression, { window: { akipanel: page.akipanel }, document, setTimeout, location: { href: page.url ?? 'about:blank' } })).then((v) => JSON.parse(JSON.stringify(v)));
};
const seen = [];
cdp.listTargets = async ({ port }) => live[port] || [];
cdp.evaluate = async ({ port, target, expression }) => {
  seen.push({ port, target: target.id, expression });
  if (expression.includes('akipanel')) return { value: await runInPage(target.id, expression) };
  if (expression.includes('querySelectorAll')) return { value: [{ text: 'hi', ariaLabel: null }] };
  return { value: 42, type: 'number', target: { id: target.id } };
};
cdp.screenshot = async ({ target }) => ({ data: Buffer.from(target.id).toString('base64'), mimeType: 'image/png' });

const fromProvider = JSON.parse((await call('aiobox', { op: 'read', window: 'p1w1', last: 2 })).text);
assert.deepEqual(fromProvider, { window: 'P1·W1', targetId: 'T-NOTION', chatId: 'abc', url: 'https://app.notion.com/chat?t=abc', source: 'provider', busy: false, messages: notionMessages.slice(-2) });
assert.equal(seen.at(-1).port, 1111);
assert.match(seen.at(-1).expression, /slice\(-2\)/, 'last=N reaches the page reader');

const raw = JSON.parse((await call('aiobox', { op: 'read', window: 'P7.W2' })).text);
assert.equal(raw.source, 'raw');
assert.equal(raw.truncated, true);
assert.equal(Array.from(raw.text).length, 20_000);
assert.ok(raw.text.endsWith('END'), 'raw text keeps the tail, where the latest message is');

// ok:false from AIObox's reader is an error carrying its text, never an empty chat.
pages['T-NOTION'].akipanel = readonlyPanel({ capabilities: { chat: 1 }, live: { chat: () => ({ ok: false, error: 'no conversation in this tab' }) } });
const notOk = await call('aiobox', { op: 'read', window: 'P1·W1' });
assert.ok(notOk.isError);
assert.equal(notOk.text, 'rejected: AIObox chat reader in P1·W1: no conversation in this tab');
// A chat shape this reader does not know is named, not guessed at.
pages['T-NOTION'].akipanel = readonlyPanel({ capabilities: { chat: 2 }, live: { chat: chatOk(notionMessages) } });
assert.match((await call('aiobox', { op: 'read', window: 'P1·W1' })).text, /chat capability version 2 in P1·W1 is not supported \(expected 1\)/);
// The account AIObox saw comes along with the read.
const account = { label: 'nt@x.com', plan: 'free', login: 'signed_in', observedAt: 1 };
pages['T-NOTION'].akipanel = readonlyPanel({ capabilities: { chat: 1 }, account, live: { chat: chatOk(notionMessages) } });
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1' })).text).account, account);
// No akipanel at all (AIObox panel not injected yet): raw body text.
pages['T-NOTION'].akipanel = undefined;
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1' })).text), { window: 'P1·W1', targetId: 'T-NOTION', chatId: 'abc', url: 'https://app.notion.com/chat?t=abc', source: 'raw', text: 'notion body' });

assert.deepEqual(JSON.parse((await call('aiobox', { op: 'text', window: 'P1·W1', selector: 'h1' })).text).elements, [{ text: 'hi', ariaLabel: null }]);
const shot = await call('aiobox', { op: 'screenshot', window: 'P7·W2' });
assert.equal(shot.content[0].type, 'image');
assert.equal(Buffer.from(shot.content[0].data, 'base64').toString(), 'T-GPT');
assert.equal(JSON.parse(shot.content[1].text).targetId, 'T-GPT', 'a screenshot also names the tab it took');

// op=state probes every chat tab once (busy, account, macros) and returns the guide and the ops this server has; whoami finds the caller's own chat from a quote of its latest user message.
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const savedPages = { ...pages };
const macroList = [{ id: 'connect-akimcp', label: 'Connect AkiMCP', icon: 'plug', target: 'individual', options: [{ id: 'fast', label: 'Fast' }, { id: 'full', label: 'Full' }], intro: '', needsAkimcp: true }];
const runs = {};
const panelRuns = [];
let notionBusy = true;
let notionDraft;
// The tab's own usage as AIObox's panel holds it (seen live 2026-10-04): scopePick + exactScope name the workspace, usage.usage is its reading when scopeId is it.
const WS = 'b4fecf59-09a0-811b-976b-000387ab3c62';
const notionUsage = { profileId: 'chrome-profile-11', provider: 'notion', status: 'measured', checkedAt: '2026-10-04T12:34:48.017Z', stale: false, usage: { session: { utilizationPct: 48.97 }, weekly: { utilizationPct: 48.97 }, scopeId: WS, scopes: [{ id: 'other', label: 'Linh1', plan: 'business', session: { utilizationPct: 50.41 }, weekly: { utilizationPct: 50.41 } }, { id: WS, label: 'Linh2', plan: 'business' }, { id: 'free-ws', label: 'nt-free', plan: 'free' }] } };
pages['T-NOTION'] = { body: 'notion body', akipanel: readonlyPanel({
  online: true,
  capabilities: { chat: 1, usage: 1 },
  usage: notionUsage,
  scopePick: WS,
  exactScope: true,
  account,
  read: 'live',
  state: { macros: macroList },
  macroRuns: runs,
  live: { chat: () => ({ ok: true, data: { messages: [{ role: 'user', text: 'please   compare the last two answers now' }, { role: 'assistant', text: 'working' }], busy: notionBusy, draft: notionDraft } }) },
  runMacro: (id, option) => {
    panelRuns.push([id, option]);
    runs[id] = { status: 'running', message: null, at: Date.now() };
    setTimeout(() => { runs[id] = { status: 'done', message: 'connected', at: Date.now() + 1 }; }, 50);
  },
}) };
pages['T-GPT'] = { akipanel: readonlyPanel({ capabilities: {} }), body: 'history: please compare the last two answers now, then more' };
const state = JSON.parse((await call('aiobox', { op: 'state' })).text);
assert.equal(state.akimcp, VERSION);
assert.deepEqual(state.ops, { aiobox: ['windows', 'state', 'whoami', 'read', 'wait_idle', 'text', 'screenshot', 'runs', 'profiles'], aiobox_write: ['new_window', 'handoff_open', 'open_url', 'new_chat', 'switch_workspace', 'place_like', 'close_window', 'flag', 'unflag', 'compose', 'send', 'run_macro', 'eval'] });
assert.deepEqual(state.flags, [], 'no flags.json yet: empty list');
assert.equal('claims' in state, false, 'claims are gone (aiobox plan cleanup-ai-leftovers)');
// No ~/.aki/aiobox/guide.md yet: the short fallback, pointing at the web guide.
assert.match(state.guide, /^AIObox guide \(short fallback.*https:\/\/aiobox\.app\/guide\/aiobox\.md/);
assert.equal(state.guideVersion, null);
assert.ok(state.guide.length <= 900, `fallback is ${state.guide.length} chars`);
// AIObox's copy is returned verbatim, frontmatter included; a file without the contract's head is not trusted.
const guidePath = path.join(home, '.aki', 'aiobox', 'guide.md');
const guideText = '---\nversion: 5\n---\n# AIObox guide\n\n1. Find yourself.\n';
fs.writeFileSync(guidePath, guideText);
const withFile = JSON.parse((await call('aiobox', { op: 'state' })).text);
assert.deepEqual([withFile.guide, withFile.guideVersion], [guideText, 5]);
fs.writeFileSync(guidePath, '# AIObox guide\nno frontmatter\n');
assert.equal(JSON.parse((await call('aiobox', { op: 'state' })).text).guideVersion, null, 'a malformed head falls back');
fs.rmSync(guidePath);
// Flags come from flags.json, only the ones still in force; it is { list } or a bare array (guide v10), scope account or workspace, no until = until unflag.
const soon = new Date(Date.now() + 3_600_000).toISOString();
const gone = new Date(Date.now() - 1_000).toISOString();
const aioboxHome = path.join(home, '.aki', 'aiobox');
const flagsPath = path.join(aioboxHome, 'flags.json');
fs.writeFileSync(flagsPath, JSON.stringify({ list: [
  { scope: 'account', account: 'x@y', profileId: 'p', provider: 'notion', reason: 'interrupted', flaggedAt: gone, until: gone },
  { scope: 'workspace', workspace: 'dldn.1', provider: 'notion', reason: 'usage policy', flaggedAt: gone },
  { scope: 'account', account: 'z@y', profileId: 'q', provider: 'notion', reason: 'interrupted', flaggedAt: gone, until: soon },
] }));
const coordinated = JSON.parse((await call('aiobox', { op: 'state' })).text);
assert.deepEqual(coordinated.flags.map((f) => f.workspace ?? f.account), ['dldn.1', 'z@y'], 'an expired flag is gone, one without until stays');
// An until that cannot be read holds, as AIObox reads it; a number is epoch ms (P9·W6 review of 14ea2a0, L1).
fs.writeFileSync(flagsPath, JSON.stringify({ list: [{ account: 'a', profileId: 'p', reason: 'r', until: 'soon' }, { account: 'b', profileId: 'p', reason: 'r', until: Date.now() - 1 }, { account: 'c', profileId: 'p', reason: 'r', until: Date.now() + 60_000 }] }));
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'state' })).text).flags.map((f) => f.account), ['a', 'c']);
fs.writeFileSync(path.join(aioboxHome, 'flags.json'), JSON.stringify([{ account: 'old@v9', profileId: 'p', reason: 'interrupted', flaggedAt: gone, until: soon }]));
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'state' })).text).flags.map((f) => [f.scope, f.account]), [['account', 'old@v9']], 'a v9 bare array still reads, without scope = account');
// op=flag / op=unflag are the one way to write it: whole file as { list }, entries no longer in force dropped, the same target replaced, no window needed.
const flagged = JSON.parse((await call('aiobox_write', { op: 'flag', workspace: 'dldn.1', reason: 'usage policy' })).text);
assert.deepEqual([flagged.flagged.scope, flagged.flagged.workspace, flagged.flagged.until], ['workspace', 'dldn.1', undefined], 'no hours: until unflagged');
let onDisk = JSON.parse(fs.readFileSync(flagsPath, 'utf8'));
assert.deepEqual(onDisk.list.map((f) => f.workspace ?? f.account), ['old@v9', 'dldn.1'], 'the v9 array is rewritten as { list }');
const timed = JSON.parse((await call('aiobox_write', { op: 'flag', account: 'x@y', profile: 'p', reason: 'interrupted x2', hours: 8 })).text);
assert.ok(Math.abs(Date.parse(timed.flagged.until) - Date.now() - 8 * 3_600_000) < 60_000, 'hours sets until');
await call('aiobox_write', { op: 'flag', account: 'x@y', profile: 'p', reason: 'again', hours: 1 });
onDisk = JSON.parse(fs.readFileSync(flagsPath, 'utf8'));
assert.deepEqual(onDisk.list.map((f) => [f.account ?? f.workspace, f.reason]), [['old@v9', 'interrupted'], ['dldn.1', 'usage policy'], ['x@y', 'again']], 'flagging again replaces');
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'state' })).text).flags.map((f) => f.account ?? f.workspace), ['old@v9', 'dldn.1', 'x@y'], 'op=state reads what op=flag wrote');
const un = JSON.parse((await call('aiobox_write', { op: 'unflag', workspace: 'dldn.1' })).text);
assert.deepEqual([un.removed, un.flags.map((f) => f.account)], [1, ['old@v9', 'x@y']]);
assert.equal(JSON.parse((await call('aiobox_write', { op: 'unflag', account: 'x@y', profile: 'other' })).text).removed, 0, 'an account is matched with its profile');
// An account flag names one provider of the profile (default notion), so the same profile's Claude can be flagged apart (P9·W6 review of 14ea2a0, M1).
const claudeFlag = JSON.parse((await call('aiobox_write', { op: 'flag', account: 'x@y', profile: 'p', provider: 'claude', reason: 'interrupted x2' })).text);
assert.equal(claudeFlag.flagged.provider, 'claude');
assert.deepEqual(claudeFlag.flags.filter((f) => f.account === 'x@y').map((f) => f.provider), ['notion', 'claude'], 'the notion flag of that profile stays');
assert.equal(JSON.parse((await call('aiobox_write', { op: 'unflag', account: 'x@y', profile: 'p', provider: 'claude' })).text).removed, 1, 'unflag takes the provider too');
assert.deepEqual(JSON.parse(fs.readFileSync(flagsPath, 'utf8')).list.filter((f) => f.account === 'x@y').map((f) => f.provider), ['notion']);
assert.match((await call('aiobox_write', { op: 'flag', account: 'x@y', reason: 'r' })).text, /op=flag needs workspace, or account and profile/);
assert.match((await call('aiobox_write', { op: 'flag', workspace: 'w' })).text, /op=flag needs reason/);
assert.ok(!fs.readdirSync(aioboxHome).some((n) => n.endsWith('.tmp')), 'no temp file left behind');
fs.writeFileSync(flagsPath, 'not json');
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'state' })).text).flags, [], 'an unreadable file is no flag');
assert.match((await call('aiobox_write', { op: 'flag', workspace: 'w', reason: 'r' })).text, /flags\.json is not readable JSON.*fix or delete it first/);
assert.equal(fs.readFileSync(flagsPath, 'utf8'), 'not json', 'and is never overwritten');
fs.rmSync(flagsPath);
const notionRow = state.tabs.find((t) => t.targetId === 'T-NOTION');
assert.equal(notionRow.busy, true);
assert.deepEqual(notionRow.account, account);
assert.equal(state.tabs.find((t) => t.targetId === 'T-GPT').busy, null, 'no reader: busy is unknown, not guessed');
assert.deepEqual([notionRow.read, state.tabs.find((t) => t.targetId === 'T-GPT').read], ['live', null], 'read comes from akipanel.read; a panel without it is null');
assert.deepEqual(state.macros, { notion: [{ id: 'connect-akimcp', label: 'Connect AkiMCP', options: ['fast', 'full'] }] });
// Workspace and usage come from the tab's akipanel, never from the title; missing is null with usageWhy.
assert.deepEqual([notionRow.workspace, notionRow.usage, notionRow.usageWhy], [{ id: WS, label: 'Linh2', status: 'measured' }, { session: 48.97, weekly: 48.97, readAt: '2026-10-04T12:34:48.017Z' }, undefined]);
assert.deepEqual(state.workspaces[notionRow.profileId].map((w) => [w.label, w.status, w.session]), [['Linh1', null, 50.41], ['Linh2', null, null], ['nt-free', 'free', null]], 'op=state lists the account workspaces per profile, for choosing where to go');
const gptRow = state.tabs.find((t) => t.targetId === 'T-GPT');
assert.deepEqual([gptRow.workspace, gptRow.usage, gptRow.usageWhy], [null, null, 'this AIObox panel reports no usage']);
const usageCase = async (fields) => {
  const saved = pages['T-NOTION'].akipanel;
  pages['T-NOTION'].akipanel = readonlyPanel({ capabilities: { usage: 1 }, usage: notionUsage, exactScope: true, scopePick: null, ...fields });
  const row = JSON.parse((await call('aiobox', { op: 'state' })).text).tabs.find((t) => t.targetId === 'T-NOTION');
  pages['T-NOTION'].akipanel = saved;
  return [row.workspace, row.usage, row.usageWhy];
};
assert.deepEqual(await usageCase({}), [null, null, 'AIObox is still finding the workspace of this tab'], 'a tab still resolving names no workspace');
assert.deepEqual(await usageCase({ scopeWait: 'no usage reader in this page · Refresh' }), [null, null, 'no usage reader in this page · Refresh'], "AIObox's own reason is passed on");
assert.deepEqual(await usageCase({ scopePick: 'other' }), [{ id: 'other', label: 'Linh1', status: 'measured' }, { session: 50.41, weekly: 50.41, readAt: null }, 'from the account snapshot, not a reading of this tab']);
assert.deepEqual(await usageCase({ scopePick: 'free-ws' }), [{ id: 'free-ws', label: 'nt-free', status: 'free' }, null, 'free workspace: no AI quota']);
assert.deepEqual(await usageCase({ exactScope: false, usage: { status: 'measured', checkedAt: 't', stale: true, usage: { session: { utilizationPct: 7 }, weekly: { utilizationPct: 9 } } } }), [null, { session: 7, weekly: 9, readAt: 't', stale: true }, 'this provider has no workspaces: usage is for the whole account']);

assert.match((await call('aiobox', { op: 'whoami', quote: 'too short' })).text, /short_quote/);
const me = JSON.parse((await call('aiobox', { op: 'whoami', quote: 'please compare  the last two answers' })).text);
assert.deepEqual([me.you.chatId, me.you.handle, me.you.matchedBy, me.you.busy], ['abc', 'P1·W1', 'latest user message', true], "the reader's latest user message outranks page text that also shows the quote");
assert.deepEqual([me.you.workspace, me.you.usage], [{ id: WS, label: 'Linh2', status: 'measured' }, { session: 48.97, weekly: 48.97, readAt: '2026-10-04T12:34:48.017Z' }], 'whoami says which workspace you are on and its usage');
assert.equal(JSON.parse((await call('aiobox', { op: 'whoami', quote: 'history: please compare the last two' })).text).you.targetId, 'T-GPT', 'without a reader match, page text decides');
pages['T-CLAUDE'] = { body: 'history: please compare the last two answers' };
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'whoami', quote: 'history: please compare the last two' })).text).ambiguous.map((t) => t.targetId), ['T-GPT', 'T-CLAUDE'], 'two chats showing the quote are not guessed between');
assert.match((await call('aiobox', { op: 'whoami', quote: 'nothing like this anywhere at all' })).text, /no AIObox chat window shows that quote \(not_found/);

// wait_idle reads busy from AIObox's reader only.
assert.match((await call('aiobox', { op: 'wait_idle', window: 'P7·W2' })).text, /P7·W2 has no AIObox chat reader.*\(no_adapter/);
const stillBusy = JSON.parse((await call('aiobox', { op: 'wait_idle', window: 'abc', timeout: 1 })).text);
assert.deepEqual([stillBusy.busy, stillBusy.timedOut], [true, true]);
assert.match(stillBusy.next, /call op=wait_idle again/, 'a timed-out wait says how to go on');
// One call never outlasts the client's own tool-call timeout (about a minute): a longer wait is clamped, the caller loops.
assert.deepEqual([waitLimitS(240, 50), waitLimitS(undefined, 50), waitLimitS(5, 50), waitLimitS(undefined, 0)], [CALL_WAIT_MAX_S, CALL_WAIT_MAX_S, 5, 0]);
assert.ok(CALL_WAIT_MAX_S <= 55);
notionBusy = false;
const idle = JSON.parse((await call('aiobox', { op: 'wait_idle', window: 'abc' })).text);
assert.deepEqual([idle.busy, idle.messages], [false, [{ role: 'assistant', text: 'working' }]]);
assert.equal(idle.draft, undefined, 'no draft: plain idle, no warning');
// A draft makes Notion read busy false mid-answer: returned at once, flagged, not waited on.
notionDraft = true;
const drafted = JSON.parse((await call('aiobox', { op: 'wait_idle', window: 'abc' })).text);
assert.deepEqual([drafted.busy, drafted.draft], [false, true]);
assert.match(drafted.warning, /holds a draft, so busy may read false while it still answers/);
assert.ok(drafted.waitedMs < 1000, `a draft is not waited on (${drafted.waitedMs} ms)`);
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text).draft, true, 'op=read carries the reader\'s draft');
notionDraft = undefined;
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text).draft, undefined, 'a reader that reports no draft adds no field');
// Answers cut off as Interrupted twice in a row, as the provider reader counts them (data.interrupted): AIObox hands off itself; read and wait_idle say follow it, open nothing, never resend (owner 2026-10-05).
const panelBeforeCut = pages['T-NOTION'].akipanel;
const cutPanel = (interrupted) => readonlyPanel({ capabilities: { chat: 1 }, account, live: { chat: () => ({ ok: true, data: { messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'Interrupted' }], busy: false, ...(interrupted === undefined ? {} : { interrupted }) } }) } });
pages['T-NOTION'].akipanel = cutPanel(2);
const cut = JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text);
assert.equal(cut.interrupted, 2);
assert.match(cut.next, /AIObox hands it off itself \(automation interrupted-handoff\); follow it in aki__aiobox op=runs, open no window, never send/);
assert.match(JSON.parse((await call('aiobox', { op: 'wait_idle', window: 'abc' })).text).next, /AIObox hands it off itself/, 'wait_idle says it too');
pages['T-NOTION'].akipanel = cutPanel(undefined);
const healed = JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text);
assert.deepEqual([healed.interrupted, healed.next], [undefined, undefined], 'AkiMCP never counts the text itself: no data.interrupted, no field');
pages['T-NOTION'].akipanel = cutPanel(1);
const once = JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text);
assert.deepEqual([once.interrupted, once.next], [1, undefined], 'one cut is counted, not yet a handoff');
pages['T-NOTION'].akipanel = panelBeforeCut;

// run_macro goes through akipanel.runMacro and waits for its outcome in macroRuns.
assert.match((await call('aiobox_write', { op: 'run_macro', window: 'abc', macro: 'nope' })).text, /P1·W1 has no macro 'nope'; it has: connect-akimcp \(no_macro/);
assert.match((await call('aiobox_write', { op: 'run_macro', window: 'abc', macro: 'connect-akimcp', option: 'zzz' })).text, /no option 'zzz'; it has: fast, full \(no_option/);
const ran = JSON.parse((await call('aiobox_write', { op: 'run_macro', window: 'abc', macro: 'connect-akimcp', option: 'full' })).text);
assert.deepEqual([ran.window, ran.status, ran.message], ['P1·W1', 'done', 'connected']);
assert.deepEqual(panelRuns, [['connect-akimcp', 'full']]);

// chrome_launch warns while AIObox runs (O2 warn phase): the profiles are AIObox's.
const { aioboxWarning } = await import('../scripts/chrome-mcp.js');
assert.match(aioboxWarning(), /AIObox is running and owns these profiles: .*aki__aiobox_write op=new_window/);

// from: a session never composes into its own chat.
assert.match((await call('aiobox_write', { op: 'compose', window: 'abc', text: 'x', from: 'abc' })).text, /P1·W1 is your own chat \(abc\) \(self_target/);
delete pages['T-CLAUDE'];
Object.assign(pages, savedPages);

// A chat id names the window too, and expect refuses a window that now shows another chat.
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text).window, 'P1·W1');
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'abc' })).text).chatId, 'abc');
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'Chat | Notion' })).text).window, 'P1·W1', 'expect may be title text');
const wrong = await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'zzz' });
assert.ok(wrong.isError);
assert.match(wrong.text, /handle P1·W1 now points to "nt@x.com · Chat \| Notion" \(chat abc\), not "zzz"; the window shows another chat now/);

// Handles are lasting (aiobox plan D6): an AIObox restart with Chrome still running is a new epoch with the same numbers, and is no event.
const before = fs.readFileSync(mapFile, 'utf8');
const rerun = JSON.parse(before);
Object.assign(rerun, { epoch: 1, appPid: 4242, generation: 1, updatedAt: '2026-10-03T18:38:05.000Z', answered: null });
fs.writeFileSync(mapFile, JSON.stringify(rerun));
const same = JSON.parse((await call('aiobox', { op: 'windows' })).text);
assert.equal(refreshes, 1, 'op=windows asks an AIObox that can refresh, every time');
assert.deepEqual([same.run.epoch, same.run.appPid, same.run.generation], [1, 4242, 2], 'the list is the one AIObox wrote after the request');
assert.ok(!fs.existsSync(refreshFile));
assert.equal(same.renumbered, null, 'an AIObox restart that keeps every handle warns nothing');
assert.equal(JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P7·W2', expression: '1' })).text).warning, undefined);
// Chrome restarted and session restore put P7·W2 back on a new target: the same window, so no warning either; nor when it comes back to the first target.
const restored = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
restored.profiles[1].windows[0].tabs[0].targetId = 'T-RESTORED';
fs.writeFileSync(mapFile, JSON.stringify(restored));
assert.equal(JSON.parse((await call('aiobox', { op: 'windows' })).text).renumbered, null, 'a handle on a new target is its window restored');
fs.writeFileSync(mapFile, JSON.stringify(rerun));
assert.equal(JSON.parse((await call('aiobox', { op: 'windows' })).text).renumbered, null);

// The one fault left: an open tab whose handle changes (AIObox gave T-GPT P7·W1, and P7·W2 to another tab).
const moved = JSON.parse(JSON.stringify(rerun));
moved.profiles[1].windows = [
  { handle: 'P7·W1', windowId: 2, state: 'normal', tabs: [{ handle: 'P7·W1', targetId: 'T-GPT', url: 'https://chatgpt.com/c/123', title: 'lac · Review' }] },
  { handle: 'P7·W2', windowId: 9, state: 'normal', tabs: [{ handle: 'P7·W2', targetId: 'T-OTHER', url: 'https://chatgpt.com/c/999', title: 'lac · Other' }] },
];
fs.writeFileSync(mapFile, JSON.stringify(moved));
const after = JSON.parse((await call('aiobox', { op: 'windows' })).text);
assert.deepEqual(after.renumbered.changes.map((c) => [c.was, c.handle, c.targetId]), [['P7·W2', 'P7·W1', 'T-GPT']], 'only the tab that changed handle, not the handle now on another tab');
assert.match(after.renumbered.warning, /^AIObox moved a handle on an open tab since .*: P7·W2 -> P7·W1 \(target T-GPT, chat 123\)\. Handles should never move/);
live[7777] = [{ id: 'T-GPT', type: 'page', title: 'P7·W1 · lac · Review', url: 'https://chatgpt.com/c/123' }, { id: 'T-OTHER', type: 'page', title: 'P7·W2 · lac · Other', url: 'https://chatgpt.com/c/999' }];
// An agent still holding "P7·W2" for chat 123 is refused with expect, warned without it, and reaches it by chat id.
assert.match((await call('aiobox_write', { op: 'eval', window: 'P7·W2', expression: '1', expect: '123' })).text, /handle P7·W2 now points to "lac · Other" \(chat 999\), not "123"/);
assert.match(JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P7·W2', expression: '1' })).text).warning, /AIObox moved a handle/);
const byChat = JSON.parse((await call('aiobox_write', { op: 'eval', window: '123', expression: '1' })).text);
assert.equal(byChat.window, 'P7·W1');
assert.equal(byChat.targetId, 'T-GPT');
// The record is kept on disk, so a restarted AkiMCP (or another call) still reports it; an unchanged map adds nothing new.
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'windows' })).text).renumbered.changes, after.renumbered.changes);

// A handoff retires a handle (close_window after place_like): windows.json retired[] leads to the successor, hop by hop; the result says resolvedFrom. A loop and a chain ending in a closed window are refused.
const withRetired = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
withRetired.retired = [
  { handle: 'P5·W3', successor: 'p7w8', at: '2026-10-04T10:00:00Z' },
  { handle: 'P7·W8', successor: 'P7·W1', at: '2026-10-04T10:05:00Z' },
  { handle: 'P5·W4', successor: 'P5·W5', at: '2026-10-04T10:00:00Z' },
  { handle: 'P5·W5', successor: 'P5·W4', at: '2026-10-04T10:01:00Z' },
  { handle: 'P5·W6', successor: 'P5·W7', at: '2026-10-04T10:00:00Z' },
];
fs.writeFileSync(mapFile, JSON.stringify(withRetired));
const followed = JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P5·W3', expression: '1' })).text);
assert.deepEqual([followed.window, followed.targetId, followed.resolvedFrom], ['P7·W1', 'T-GPT', 'P5·W3'], 'two hops to the window that took over');
assert.equal(JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P7·W1', expression: '1' })).text).resolvedFrom, undefined, 'a live handle is not resolved from anything');
assert.match((await call('aiobox', { op: 'read', window: 'P5·W4' })).text, /retired handles loop: P5·W4 -> P5·W5 -> P5·W4 \(retired_loop/);
assert.match((await call('aiobox', { op: 'read', window: 'P5·W6' })).text, /no window 'P5·W6' \(retired: P5·W6 -> P5·W7, which is not open\); open: /);
fs.writeFileSync(mapFile, JSON.stringify(moved));
// A window the map does not name yet (just opened) is found after one refresh; without an answer the call fails naming both, and leaves no request behind.
live[7777].push({ id: 'T-W5', type: 'page', title: 'P7·W5 · lac · Fresh', url: 'https://chatgpt.com/c/555' });
onRefresh = (map) => map.profiles[1].windows.push({ handle: 'P7·W5', windowId: 5, state: 'normal', tabs: [{ handle: 'P7·W5', targetId: 'T-W5', url: 'https://chatgpt.com/c/555', title: 'lac · Fresh' }] });
assert.equal(JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P7·W5', expression: '1' })).text).targetId, 'T-W5');
answering = false;
const unanswered = await call('aiobox_write', { op: 'eval', window: 'P7·W9', expression: '1' });
assert.match(unanswered.text, /no window 'P7·W9'.*\(AIObox did not answer a window refresh within 5s\)/);
assert.ok(!fs.existsSync(refreshFile), 'an unanswered request is taken back');
answering = true;
fs.writeFileSync(mapFile, before);
await call('aiobox', { op: 'windows' });
live[7777] = [{ id: 'T-GPT', type: 'page', title: 'P7·W2 · lac · Review', url: 'https://chatgpt.com/c/123' }, { id: 'T-CLAUDE', type: 'page', title: 'P7·W3 · Claude', url: 'https://claude.ai/new' }];

// A live title naming another handle means windows.json is behind Chrome: refuse, never act on the wrong tab.
assert.match((await call('aiobox', { op: 'read', window: 'P7·W2·T2' })).text, /window map is stale: target T-CLAUDE is titled P7·W3, not P7·W2·T2/);
live[1111] = [];
assert.match((await call('aiobox', { op: 'read', window: 'P1·W1' })).text, /window map is stale: P1·W1 \(target T-NOTION\) is no longer open/);

// new_window goes through akipanel.newWindow(), then finds the handle AIObox adds to this profile in windows.json.
assert.equal((await call('aiobox_write', { op: 'new_window' })).text, 'rejected: op=new_window needs window, or profile and provider');
pages['T-GPT'].akipanel = undefined;
assert.equal((await call('aiobox_write', { op: 'new_window', window: 'P7·W2' })).text, 'rejected: P7·W2: this window has no AIObox panel');
pages['T-GPT'].akipanel = readonlyPanel({ online: false, newWindow: () => assert.fail('offline panel must not be asked') });
assert.equal((await call('aiobox_write', { op: 'new_window', window: 'P7·W2' })).text, 'rejected: P7·W2: the AIObox panel in this window is offline');
let asked = 0;
pages['T-GPT'].akipanel = readonlyPanel({
  online: true,
  newWindow: () => {
    asked += 1;
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    map.profiles[1].windows.push({ handle: 'P7·W4', windowId: 4, state: 'normal', tabs: [{ handle: 'P7·W4', targetId: 'T-NEW', url: 'about:blank', title: '' }] });
    fs.writeFileSync(mapFile, JSON.stringify(map));
    // The new window's tab starts blank and reaches the provider a moment later; new_window waits for that.
    setTimeout(() => {
      const later = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      later.profiles[1].windows.at(-1).tabs[0] = { handle: 'P7·W4', targetId: 'T-NEW', url: 'https://chatgpt.com/', title: 'P7·W4 · lac · ChatGPT' };
      fs.writeFileSync(mapFile, JSON.stringify(later));
    }, 700);
  },
});
const opened = JSON.parse((await call('aiobox_write', { op: 'new_window', window: 'p7w2' })).text);
assert.equal(asked, 1);
assert.equal(opened.warning !== undefined, true, 'T-GPT moved back to P7·W2 in this run, so acting on it warns');
delete opened.warning;
assert.deepEqual(opened, { window: 'P7·W4', targetId: 'T-NEW', chatId: null, opener: 'P7·W2', openerTargetId: 'T-GPT', provider: 'gpt', url: 'https://chatgpt.com/', title: 'lac · ChatGPT' });
// The owner clicked New window a moment ago: the panel rests (newWindow would be a no-op) and their window lands in the map. new_window waits the rest out and returns a window of its own, never theirs.
let resting = true;
const addWindow = (handle, targetId) => {
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.profiles[1].windows.push({ handle, windowId: Number(handle.at(-1)), state: 'normal', tabs: [{ handle, targetId, url: 'https://chatgpt.com/', title: `${handle} · lac · ChatGPT` }] });
  fs.writeFileSync(mapFile, JSON.stringify(map));
};
setTimeout(() => { addWindow('P7·W5', 'T-OWNER'); resting = false; }, 300);
pages['T-GPT'].akipanel = readonlyPanel({
  online: true,
  get opening() { return resting; },
  newWindow: () => { asked += 1; addWindow('P7·W6', 'T-MINE'); },
});
const mine = JSON.parse((await call('aiobox_write', { op: 'new_window', window: 'p7w2' })).text);
assert.deepEqual([asked, mine.window, mine.targetId], [2, 'P7·W6', 'T-MINE'], 'the window someone else opened is not taken for ours');
resting = true;
assert.match((await call('aiobox_write', { op: 'new_window', window: 'p7w2' })).text, /still opening another window \(opening;/);
assert.equal(asked, 2, 'a panel that keeps resting is never asked');

// new_chat calls akipanel.newChat() (sync: it refuses itself, else asks AIObox to navigate) and returns once the tab shows the new page: panel online, reader ok with no messages, no chat id in the URL. The old page is still there right after the call, and the navigation may destroy the call's own context.
assert.equal((await call('aiobox_write', { op: 'new_chat' })).text, 'rejected: op=new_chat needs window');
pages['T-GPT'].akipanel = readonlyPanel({ online: true, capabilities: {} });
assert.match((await call('aiobox_write', { op: 'new_chat', window: 'P7·W2' })).text, /P7·W2 has no AIObox newChat.*\(no_new_chat/);
pages['T-GPT'].akipanel = readonlyPanel({ online: true, capabilities: {}, newChat: () => ({ ok: false, error: 'the provider is still answering' }) });
assert.equal((await call('aiobox_write', { op: 'new_chat', window: 'P7·W2' })).text, 'rejected: P7·W2: the provider is still answering', "the panel's own refusal comes back verbatim");
const newChats = [];
const gptPage = (destroyContext) => {
  pages['T-GPT'].url = 'https://chatgpt.com/c/123';
  pages['T-GPT'].akipanel = readonlyPanel({
    online: true,
    capabilities: { chat: 1 },
    live: { chat: () => ({ ok: true, data: { messages: [{ role: 'user', text: 'old' }], busy: false, draft: false } }) },
    newChat: () => {
      newChats.push(pages['T-GPT'].url);
      setTimeout(() => {
        pages['T-GPT'].url = 'https://chatgpt.com/';
        pages['T-GPT'].akipanel = readonlyPanel({ online: true, capabilities: { chat: 1 }, live: { chat: chatOk([]) } });
      }, 700);
      if (destroyContext) throw new Error('Execution context was destroyed.');
      return { ok: true, data: null };
    },
  });
};
gptPage(false);
assert.match((await call('aiobox_write', { op: 'new_chat', window: '123', from: '123' })).text, /is your own chat \(123\) \(self_target/);
assert.deepEqual(newChats, [], 'a refusal navigates nothing');
const expected = { window: 'P7·W2', targetId: 'T-GPT', chatId: null, previousChatId: '123', url: 'https://chatgpt.com/', next: 'op=send the first message, then op=state shows its chatId' };
for (const destroyContext of [false, true]) {
  gptPage(destroyContext);
  const fresh = JSON.parse((await call('aiobox_write', { op: 'new_chat', window: '123' })).text);
  delete fresh.warning;
  assert.deepEqual(fresh, expected, destroyContext ? 'a destroyed context is the navigation, not an error' : 'the old page is not taken for the new chat');
}
assert.deepEqual(newChats, ['https://chatgpt.com/c/123', 'https://chatgpt.com/c/123']);
delete pages['T-GPT'].url;

// switch_workspace (aiobox G2) asks akipanel.switchWorkspace(id) on a Notion tab for the workspace AkiMCP matched by id or label in the account's usage; it refuses a flagged one, the caller's own chat and a tab already there (moved: false), and returns once the page's panel names the new workspace.
{
  const savedNotion = pages['T-NOTION'];
  live[1111] = [{ id: 'T-NOTION', type: 'page', title: 'P1·W1 · nt@x.com · Chat | Notion', url: 'https://app.notion.com/chat?t=abc' }];
  assert.equal((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1' })).text, 'rejected: op=switch_workspace needs workspace');
  assert.match((await call('aiobox_write', { op: 'switch_workspace', window: 'P7·W2', workspace: 'Linh1' })).text, /P7·W2 is not a Notion window \(not_notion/);
  pages['T-NOTION'] = { akipanel: readonlyPanel({ online: true, usage: notionUsage, scopePick: WS }) };
  assert.match((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'Linh1' })).text, /P1·W1 has no AIObox switchWorkspace.*\(no_switch_workspace/);
  const switched = [];
  const notionPage = (refusal) => {
    pages['T-NOTION'] = { url: 'https://app.notion.com/chat?t=abc', akipanel: readonlyPanel({ online: true, usage: notionUsage, scopePick: WS, switchWorkspace: (id) => {
      switched.push(id);
      if (refusal) return { ok: false, error: refusal };
      // As seen live (run 969): scopePick names the workspace already on Notion's app.notion.com/<domain> page, before AIObox reaches Notion AI's home.
      setTimeout(() => { pages['T-NOTION'] = { url: 'https://app.notion.com/nova-cathedral-7fd', akipanel: readonlyPanel({ online: true, capabilities: { chat: 1 }, usage: notionUsage, scopePick: 'other', live: { chat: () => ({ ok: false, error: 'no conversation in this tab' }) } }) }; }, 300);
      // Then Notion's /p/<id> doc page, whose reader may well read an empty chat (P9·W6 review of 7d9f406, M): only the address tells it from the home.
      setTimeout(() => { pages['T-NOTION'] = { url: 'https://app.notion.com/p/1f2e3d4c5b6a', akipanel: readonlyPanel({ online: true, capabilities: { chat: 1 }, usage: notionUsage, scopePick: 'other', live: { chat: chatOk([]) } }) }; }, 800);
      setTimeout(() => { pages['T-NOTION'] = { url: 'https://app.notion.com/ai', akipanel: readonlyPanel({ online: true, capabilities: { chat: 1 }, usage: notionUsage, scopePick: 'other', live: { chat: chatOk([]) } }) }; }, 1500);
      return { ok: true, data: null };
    } }) };
  };
  notionPage('the provider is still answering');
  assert.equal((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'Linh1' })).text, 'rejected: P1·W1: the provider is still answering', "the panel's own refusal comes back verbatim");
  notionPage();
  assert.match((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'nobody' })).text, /'nobody' is no workspace of P1·W1's account \(no_workspace/);
  assert.match((await call('aiobox_write', { op: 'switch_workspace', window: 'abc', workspace: 'Linh1', from: 'abc' })).text, /is your own chat \(abc\) \(self_target/);
  const stay = JSON.parse((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: ' linh2 ' })).text);
  assert.deepEqual([stay.moved, stay.workspace], [false, { id: WS, label: 'Linh2' }], 'a label matches trimmed and in any case; already there moves nothing');
  // One rule with AIObox's workspace_flagged (P9·W6 review, L1): label trimmed in any case; another profile's or provider's flag does not count.
  fs.writeFileSync(flagsPath, JSON.stringify({ list: [{ scope: 'workspace', workspace: ' LINH1', provider: 'notion', reason: 'quota', flaggedAt: '2026-10-04T00:00:00.000Z' }, { scope: 'workspace', workspace: 'Linh2', profileId: 'chrome-profile-99', provider: 'notion', reason: 'elsewhere', flaggedAt: '2026-10-04T00:00:00.000Z' }, { scope: 'workspace', workspace: 'Linh2', provider: 'claude', reason: 'not notion', flaggedAt: '2026-10-04T00:00:00.000Z' }] }));
  assert.match((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'other' })).text, /Linh1 is flagged: quota \(flagged/);
  assert.equal(JSON.parse((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'Linh2' })).text).moved, false, "another profile's or provider's flag does not refuse");
  fs.rmSync(flagsPath);
  assert.deepEqual(switched, ['other'], 'only the panel refusal reached the panel');
  const moved = JSON.parse((await call('aiobox_write', { op: 'switch_workspace', window: 'P1·W1', workspace: 'Linh1' })).text);
  delete moved.warning;
  assert.deepEqual(moved, { window: 'P1·W1', targetId: 'T-NOTION', chatId: null, previousChatId: 'abc', url: 'https://app.notion.com/ai', workspace: { id: 'other', label: 'Linh1' }, previousWorkspace: { id: WS, label: 'Linh2' }, moved: true, next: 'op=send the first message there, then op=state shows its chatId' }, 'neither the old page nor the intermediate workspace page is taken for the switch');
  assert.deepEqual(switched, ['other', 'other']);
  pages['T-NOTION'] = savedNotion;
  live[1111] = [];
}

// place_like goes through akipanel.placeLike(like) in the new window; a chatId as like is sent as that tab's targetId; AIObox's rejection comes back verbatim.
assert.equal((await call('aiobox_write', { op: 'place_like', window: 'P7·W2' })).text, 'rejected: op=place_like needs like');
pages['T-GPT'].akipanel = readonlyPanel({ online: true });
assert.match((await call('aiobox_write', { op: 'place_like', window: 'P7·W2', like: 'abc' })).text, /P7·W2 has no AIObox placeLike.*\(no_place_like/);
assert.match((await call('aiobox_write', { op: 'place_like', window: 'P7·W2', like: '123' })).text, /cannot be placed like itself \(same_window/);
const placed = [];
pages['T-GPT'].akipanel = readonlyPanel({ online: true, placeLike: async (like) => { placed.push(like); if (like === 'P9·W9') throw new Error('no window P9·W9'); return { left: 10, top: 20, width: 800, height: 900 }; } });
const placedOut = JSON.parse((await call('aiobox_write', { op: 'place_like', window: 'P7·W2', like: 'abc' })).text);
delete placedOut.warning;
assert.deepEqual(placedOut, { window: 'P7·W2', targetId: 'T-GPT', chatId: '123', url: 'https://chatgpt.com/c/123', like: 'T-NOTION', placed: true, bounds: { left: 10, top: 20, width: 800, height: 900 } });
assert.equal((await call('aiobox_write', { op: 'place_like', window: 'P7·W2', like: 'P9·W9' })).text, 'rejected: P7·W2: no window P9·W9', 'a like the map does not know goes as given, its rejection verbatim');
assert.deepEqual(placed, ['T-NOTION', 'P9·W9']);

// close_window goes through akipanel.closeWindow() (sync Result): its refusal verbatim, the caller's own chat refused, never a CDP close; successor goes to AIObox as the live handle it names (audit P1-2: AIObox writes no inferred edge).
pages['T-GPT'].akipanel = readonlyPanel({ online: true });
assert.match((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text, /no AIObox closeWindow.*\(no_close_window/);
let closes = 0;
let closeRefusal = 'the chat holds a draft';
let closeArgs = [];
// The tab counts as closed once it leaves the target list; AIObox refusing a successor leaves it open with { ok: true } (one-way call).
let closedTab = null;
let stayOpen = false;
const listBeforeClose = cdp.listTargets;
cdp.listTargets = async (a) => (await listBeforeClose(a)).filter((t) => t.id !== closedTab);
pages['T-GPT'].akipanel = readonlyPanel({ online: true, closeWindow: (...a) => (closes += 1, closeArgs = a, closeRefusal ? { ok: false, error: closeRefusal } : (stayOpen || (closedTab = 'T-GPT'), { ok: true, data: null })) });
assert.equal((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text, 'rejected: P7·W2: the chat holds a draft');
assert.match((await call('aiobox_write', { op: 'close_window', window: '123', from: '123' })).text, /is your own chat \(123\) \(self_target/);
closeRefusal = null;
assert.equal(JSON.parse((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text).closed, true);
assert.equal(closes, 2, 'the self refusal never reached the panel');
assert.deepEqual(closeArgs, [], 'no successor, no argument');
closedTab = null;
const handedOff = JSON.parse((await call('aiobox_write', { op: 'close_window', window: 'P7·W2', successor: 'abc' })).text);
assert.deepEqual([handedOff.closed, handedOff.successor, closeArgs].map((x) => JSON.stringify(x)), [true, 'P1·W1', [{ successor: 'P1·W1' }]].map((x) => JSON.stringify(x)));
closedTab = null;
stayOpen = true;
assert.match((await call('aiobox_write', { op: 'close_window', window: 'P7·W2', successor: 'abc' })).text, /P7·W2 is still open 3s after closeWindow: AIObox refused it \(successor P1·W1 closed, the same window, or a loop\); nothing was retired/);
stayOpen = false;
assert.match((await call('aiobox_write', { op: 'close_window', window: 'P7·W2', successor: '123' })).text, /cannot succeed itself \(same_window/);
assert.match((await call('aiobox_write', { op: 'close_window', window: 'P7·W2', successor: 'P9·W9' })).text, /no window 'P9·W9'.*\(no_window/);
assert.equal(closes, 4, 'a bad successor never reached the panel');
cdp.listTargets = listBeforeClose;

// compose goes through akipanel.live.compose (v2, async), never sends, and names a page or version it cannot use.
assert.equal((await call('aiobox_write', { op: 'compose', window: 'P7·W2' })).text, 'rejected: op=compose needs text');
assert.match((await call('aiobox_write', { op: 'compose', window: 'P7·W2', text: 'hi' })).text, /P7·W2: this page has no compose capability/);
const composed = [];
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { compose: 2 }, live: { compose: async (t) => { composed.push(t); return { ok: true, data: null }; } } });
const composedOut = JSON.parse((await call('aiobox_write', { op: 'compose', window: 'P7·W2', text: 'say "hi"\nthen `stop`' })).text);
delete composedOut.warning;
assert.deepEqual(composedOut, { window: 'P7·W2', targetId: 'T-GPT', chatId: '123', url: 'https://chatgpt.com/c/123', composed: true, sent: false });
assert.deepEqual(composed, ['say "hi"\nthen `stop`'], 'the text reaches the page unchanged');
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { compose: 2 }, live: { compose: async () => ({ ok: false, error: 'Notion composer did not take the text' }) } });
assert.equal((await call('aiobox_write', { op: 'compose', window: 'P7·W2', text: 'x' })).text, 'rejected: P7·W2: Notion composer did not take the text');
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { compose: 1 }, live: { compose: () => ({ ok: true }) } });
assert.match((await call('aiobox_write', { op: 'compose', window: 'P7·W2', text: 'x' })).text, /compose capability version 1 in P7·W2 is not supported \(expected 2\)/);

// send v1 (AIObox before L0): a chat answering that takes no message mid-answer, or a draft in the box, holds the message back untouched; wait= retries; delivered only once the text shows as a new user message.
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /P7·W2 has no AIObox send capability.*\(no_send/);
let gptBusy = true;
const sent = [];
const gptMsgs = [];
pages['T-GPT'].akipanel = readonlyPanel({
  capabilities: { chat: 1, send: 1 },
  live: { chat: () => ({ ok: true, data: { messages: gptMsgs, busy: gptBusy } }), send: async (t) => (gptBusy ? { ok: false, error: 'the chat is answering' } : (sent.push(t), gptMsgs.push({ role: 'user', text: t }), { ok: true, data: null })) },
});
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /P7·W2 is answering and its provider takes no message mid-answer.*\(busy/);
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x', wait: 1 })).text, /still after 1s.*\(busy/);
setTimeout(() => { gptBusy = false; }, 1200);
const sentOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'go **on**', wait: 5 })).text);
assert.deepEqual([sentOut.sent, sentOut.delivered, sentOut.chatId, sent], [true, true, '123', ['go **on**']]);
assert.ok(sentOut.waitedMs >= 1000, 'it waited for the answer to end');
assert.match((await call('aiobox_write', { op: 'send', window: '123', text: 'x', from: '123' })).text, /is your own chat \(123\) \(self_target/);
assert.deepEqual(sent, ['go **on**'], 'refusals send nothing');
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { send: 3 }, live: { send: async () => ({ ok: true }) } });
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /send capability version 3 in P7·W2 is not supported \(expected 2 or 1\)/);
// A page that can send but has no chat reader: nothing to wait for, a send that reports nothing is an error, and one that reports ok is sent but never delivered.
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { send: 1 }, live: { send: async () => undefined } });
const noReaderStarted = Date.now();
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x', wait: 30 })).text, 'rejected: P7·W2: live.send() returned no result');
assert.ok(Date.now() - noReaderStarted < 2000, 'no wait without a reader');
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { send: 1 }, live: { send: async () => ({ ok: true, data: null }) } });
const unreadOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text);
assert.deepEqual([unreadOut.sent, unreadOut.delivered], [true, false]);
assert.match(unreadOut.next, /no chat reader: op=read last=3 on P7·W2/);
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2' })).text, 'rejected: op=send needs text');
// An older user message with the same text is not the delivery: only messages after the send count.
const dupMsgs = [{ role: 'user', text: 'same' }];
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { chat: 1, send: 1 }, live: { chat: () => ({ ok: true, data: { messages: dupMsgs, busy: false } }), send: async () => ({ ok: true, data: null }) } });
const dupOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'same' })).text);
assert.deepEqual([dupOut.sent, dupOut.delivered], [true, false], 'the old copy is skipped');
assert.match(dupOut.next, /does not show in the chat yet/);
// read=live/queued has no busy (owner): mid-answer the text goes in by compose + the send button at once, only into an empty box; a draft holds it back untouched until wait= sees the box empty.
const liveMsgs = [{ role: 'user', text: 'q' }];
let liveDraft = false;
let liveBox = '';
const liveSent = [];
pages['T-GPT'].akipanel = readonlyPanel({
  read: 'live',
  capabilities: { chat: 1, compose: 2, send: 1 },
  live: { chat: () => ({ ok: true, data: { messages: liveMsgs, busy: true, draft: liveDraft } }), compose: async (t) => { liveBox = t; return { ok: true }; }, send: async () => ({ ok: false, error: 'the chat is answering' }) },
});
pages['T-GPT'].querySelector = (s) => (s === 'button[data-testid="send-button"]' ? { disabled: false, click: () => { liveSent.push(liveBox); liveMsgs.push({ role: 'user', text: liveBox }); liveBox = ''; } } : null);
const midOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'now' })).text);
assert.deepEqual([midOut.sent, midOut.delivered, midOut.midAnswer, liveSent], [true, true, true, ['now']]);
assert.ok(midOut.waitedMs < 2000, 'sent at once, no busy wait');
liveDraft = true;
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /P7·W2 holds a draft in its message box; it is left untouched \(draft; next: op=send wait=50 in this turn; still there: ask another window to relay it/);
assert.deepEqual(liveSent, ['now'], 'a draft is never touched');
setTimeout(() => { liveDraft = false; }, 1200);
const afterDraft = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'later', wait: 5 })).text);
assert.deepEqual([afterDraft.delivered, liveSent], [true, ['now', 'later']], 'sent once the box is empty');
delete pages['T-GPT'].querySelector;
// send v2 (L0): AIObox's live.send owns busy, drafts and the queue, so AkiMCP calls it whatever the chat shows and only checks the delivery.
const v2Msgs = [];
let v2Reply = (t) => (v2Msgs.push({ role: 'user', text: t }), { ok: true, data: { delivered: true, midAnswer: true, draft: 'restored' } });
pages['T-GPT'].akipanel = readonlyPanel({ read: 'blocked', capabilities: { chat: 1, send: 2 }, live: { chat: () => ({ ok: true, data: { messages: v2Msgs, busy: true, draft: true } }), send: async (t) => v2Reply(t) } });
const v2Out = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'v2' })).text);
assert.deepEqual([v2Out.sent, v2Out.delivered, v2Out.midAnswer, v2Out.draft], [true, true, true, 'restored']);
v2Reply = () => ({ ok: true, data: { queued: true, position: 2, reason: 'busy' } });
const queuedOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'q2' })).text);
assert.deepEqual([queuedOut.sent, queuedOut.delivered, queuedOut.queued, queuedOut.position, queuedOut.reason], [false, false, true, 2, 'busy']);
v2Reply = () => ({ ok: false, error: 'the message box did not take the text' });
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, 'rejected: P7·W2: the message box did not take the text');

assert.equal((await call('aiobox_write', { op: 'eval', window: 'P7·W2' })).text, 'rejected: op=eval needs expression');
const evaluated = JSON.parse((await call('aiobox_write', { op: 'eval', window: 'T-GPT', expression: '6*7' })).text);
assert.equal(evaluated.window, 'P7·W2', 'a targetId addresses the window too');
assert.equal(evaluated.value, 42);

const runsFile = path.join(home, '.aki', 'aiobox', 'automation.sqlite');
assert.match((await call('aiobox', { op: 'runs' })).text, /^rejected: AIObox has no automation store yet \(no_runs;/, 'no store = a refusal with its next step');
{
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(runsFile);
  db.exec('CREATE TABLE runs (id INTEGER PRIMARY KEY, automation_id TEXT, trigger TEXT, handle TEXT, started_at TEXT, ended_at TEXT, outcome TEXT, detail TEXT)');
  const add = db.prepare('INSERT INTO runs (automation_id, trigger, handle, started_at, ended_at, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  add.run('usage', 'cron', null, '2026-10-04T01:00:00.000Z', '2026-10-04T01:00:02.000Z', 'ok', null);
  add.run('connect-akimcp-notion', 'manual', 'P1·W2', '2026-10-04T02:00:00.000Z', '2026-10-04T02:00:40.000Z', 'ok', '2 window(s): 1 done · 1 timeout');
  add.run('usage', 'cron', null, '2026-10-04T03:00:00.000Z', null, null, null);
  db.close();
}
const allRuns = JSON.parse((await call('aiobox', { op: 'runs' })).text).runs;
assert.deepEqual(allRuns.map((r) => [r.automation, r.running]), [['usage', true], ['connect-akimcp-notion', false], ['usage', false]], 'newest first; outcome null = running');
assert.deepEqual(allRuns[1], { id: 2, automation: 'connect-akimcp-notion', trigger: 'manual', handle: 'P1·W2', startedAt: '2026-10-04T02:00:00.000Z', endedAt: '2026-10-04T02:00:40.000Z', outcome: 'ok', detail: '2 window(s): 1 done · 1 timeout', running: false });
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'runs', automation: 'usage', last: 1 })).text).runs.map((r) => r.id), [3]);
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'runs', since: '2026-10-04T02:00:00.000Z' })).text).runs.map((r) => r.id), [3, 2], 'since compares the stamps as text');

// G1/G5 (aiobox plan aio-control-gaps): profiles.json, the request channel and request runs. A fake AIObox takes each request file, deletes it and writes its run the way the scheduler does.
{
  const { OPEN_RULE, GUIDE_FALLBACK } = await import('../scripts/aiobox-guide.js');
  assert.ok(GUIDE_FALLBACK.includes(OPEN_RULE) && aioboxWarning().includes(OPEN_RULE), 'D5: the fallback guide and chrome_launch carry the one opening rule');
  assert.ok(mcp._registeredTools.aiobox_write.description.includes(OPEN_RULE), 'D5: aiobox_write carries it too');
  const chromeServer = new McpServer({ name: 'c', version: '1' });
  (await import('../scripts/chrome-mcp.js')).register(chromeServer);
  assert.match(chromeServer._registeredTools.chrome_launch.description, /chat windows open only via aki__aiobox_write op=new_window or op=handoff_open/);
  assert.doesNotMatch(GUIDE_FALLBACK, /never launches a profile/i);

  const profilesPath = path.join(aioboxHome, 'profiles.json');
  assert.match((await call('aiobox', { op: 'profiles' })).text, /profiles\.json.*\(no_profiles;/, 'an AIObox before G1 = a refusal with its next step');
  fs.writeFileSync(path.join(aioboxHome, 'flags.json'), JSON.stringify({ list: [{ scope: 'account', account: 'n@x', profileId: 'chrome-profile-18', provider: 'notion', reason: 'interrupted x2', flaggedAt: '2026-10-04T00:00:00.000Z' }, { scope: 'workspace', workspace: 'dldn.1', provider: 'notion', reason: 'quota', flaggedAt: '2026-10-04T00:00:00.000Z' }] }));
  fs.writeFileSync(profilesPath, JSON.stringify({ version: 1, updatedAt: '2026-10-04T18:00:00.000Z', profiles: [
    { id: 'chrome-profile-7', number: 2, name: 'Work', browser: 'chrome', running: false, providers: [
      { id: 'claude', login: 'signed_in', account: 'c@x', observedAt: '2026-10-04T17:00:00.000Z', stale: false, windows: 0, usage: null },
      { id: 'gpt', login: 'signed_out', account: null, observedAt: null, stale: true, windows: 0, usage: null },
    ] },
    { id: 'chrome-profile-18', number: 9, name: 'Aki', browser: 'chrome', running: true, providers: [
      { id: 'notion', login: 'signed_in', account: 'n@x', observedAt: '2026-10-04T17:00:00.000Z', stale: false, windows: 3, usage: { session: 10, weekly: 40, readAt: '2026-10-04T17:59:00.000Z' }, workspaces: [{ id: 'w1', label: 'dldn.1', plan: 'plus', session: 99, weekly: 99 }, { id: 'w2', label: 'lva.1', plan: 'plus', session: 2, weekly: 5 }] },
    ] },
  ] }));
  const view = JSON.parse((await call('aiobox', { op: 'profiles' })).text);
  const prov = (pid, id) => view.profiles.find((p) => p.id === pid).providers.find((x) => x.id === id);
  assert.deepEqual([prov('chrome-profile-7', 'claude').eligible, prov('chrome-profile-7', 'gpt').eligible, prov('chrome-profile-18', 'notion').eligible], [true, false, false], 'eligible = signed in and not flagged');
  assert.equal(prov('chrome-profile-18', 'notion').flag.reason, 'interrupted x2', 'the account flag is laid over its profile and provider');
  assert.deepEqual(prov('chrome-profile-18', 'notion').workspaces.map((w) => w.flag?.reason ?? null), ['quota', null], 'a workspace flag marks that workspace only');

  assert.equal((await call('aiobox_write', { op: 'new_window', profile: 'chrome-profile-7' })).text, 'rejected: op=new_window needs window, or profile and provider');
  assert.match((await call('aiobox_write', { op: 'new_window', profile: 'chrome-profile-99', provider: 'claude' })).text, /no AIObox profile 'chrome-profile-99'; registered: chrome-profile-7 \(P2\), chrome-profile-18 \(P9\) \(not_registered;/);
  assert.match((await call('aiobox_write', { op: 'new_window', profile: 'P2', provider: 'gpt' })).text, /chrome-profile-7 is not signed in to gpt \(signed_out\) \(not_signed_in;/, 'P# names a profile too');
  assert.match((await call('aiobox_write', { op: 'new_window', profile: 'chrome-profile-18', provider: 'notion' })).text, /chrome-profile-18 notion is flagged: interrupted x2 \(flagged;/);
  const requestsPath = path.join(aioboxHome, 'requests');
  assert.equal(fs.existsSync(requestsPath), false, 'a refused call writes no request');

  // No AIObox reading requests: the file is taken back after 5 s.
  assert.match((await call('aiobox_write', { op: 'new_window', profile: '2', provider: 'claude' })).text, /AIObox did not take request akimcp-\d+-\d+-\d+ within 5s; it was taken back \(app_not_listening;/);
  assert.deepEqual(fs.readdirSync(requestsPath), [], 'nothing left behind');

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(runsFile);
  db.exec('ALTER TABLE runs ADD COLUMN request TEXT; ALTER TABLE runs ADD COLUMN steps TEXT');
  const addRun = db.prepare('INSERT INTO runs (automation_id, trigger, handle, started_at, ended_at, outcome, detail, request, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const seen = [];
  const app = setInterval(() => {
    for (const name of fs.readdirSync(requestsPath).filter((n) => n.endsWith('.json'))) {
      const file = path.join(requestsPath, name);
      const req = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      seen.push(req);
      const at = new Date().toISOString();
      const step = (s, status = 'ok') => ({ step: s, status, at, info: null });
      if (req.op === 'open_url') addRun.run('ai-open-url', 'request', null, at, at, req.args.url.includes('refuse') ? 'refused' : 'ok', req.args.url.includes('refuse') ? 'url_not_allowed: an address with a user@ before its host' : JSON.stringify({ opened: req.args.profileId ?? 'system' }), req.id, JSON.stringify([step('scope'), step('open')]));
      else if (req.op === 'new_window') addRun.run('ai-new-window', 'request', null, at, at, 'ok', JSON.stringify({ handle: 'P2·W1', targetId: 'T-NEW' }), req.id, JSON.stringify(['scope', 'launch', 'open', 'panel'].map((s) => step(s))));
      else if (req.args.text === 'over budget') addRun.run('ai-handoff-open', 'request', null, at, at, 'refused', 'budget: 6 new windows in the last hour', req.id, JSON.stringify([step('scope', 'error')]));
      else if (req.args.text === 'slow') addRun.run('ai-handoff-open', 'request', null, at, null, null, null, req.id, JSON.stringify([step('scope'), step('launch', 'skipped'), step('open'), step('connect', 'running')]));
      else if (req.args.text === 'broken') addRun.run('ai-handoff-open', 'request', null, at, at, 'error', 'verify: no signed-in claude.ai client', req.id, JSON.stringify([step('open'), step('connect'), { ...step('verify', 'error'), info: 'no signed-in claude.ai client' }]));
      else addRun.run('ai-handoff-open', 'request', null, at, at, 'ok', JSON.stringify({ handle: 'P2·W2', targetId: 'T-H', chatId: 'c-1' }), req.id, JSON.stringify(['scope', 'launch', 'open', 'panel', 'connect', 'verify', 'place', 'send'].map((s) => step(s))));
    }
  }, 50);

  const opened = JSON.parse((await call('aiobox_write', { op: 'new_window', profile: 'chrome-profile-7', provider: 'claude' })).text);
  assert.deepEqual([opened.window, opened.targetId, opened.profileId, opened.provider, opened.done, opened.outcome, opened.steps.map((s) => s.step)], ['P2·W1', 'T-NEW', 'chrome-profile-7', 'claude', true, 'ok', ['scope', 'launch', 'open', 'panel']]);
  assert.match(seen[0].id, /^akimcp-\d+-\d+-\d+$/);
  assert.deepEqual([seen[0].version, seen[0].op, seen[0].args, typeof seen[0].at], [1, 'new_window', { profileId: 'chrome-profile-7', provider: 'claude' }, 'string'], 'the request shape of the contract');
  assert.equal(opened.request, seen[0].id);
  assert.ok(!fs.readdirSync(requestsPath).some((n) => n.endsWith('.tmp')), 'no temp file left behind');

  assert.match((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P1·W1' })).text, /op=handoff_open needs text/);
  assert.match((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P9·W9', text: 'x' })).text, /no window 'P9·W9'.*\(no_window/, 'like must be an open window');
  assert.match((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P1·W1', text: 'x'.repeat(8 * 1024 + 1) })).text, /text is 8193 bytes, over 8192 \(too_large;/);
  const handed = JSON.parse((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'abc', text: 'take over: read working.md' })).text);
  assert.deepEqual([handed.window, handed.chatId, handed.like, handed.done, handed.steps.length], ['P2·W2', 'c-1', 'P1·W1', true, 8], 'like is passed on as the handle it names');
  assert.equal(seen.at(-1).args.text, 'take over: read working.md');
  assert.match(handed.next, /op=close_window window=P1·W1 successor=P2·W2/);
  assert.match((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P1·W1', text: 'over budget' })).text, /^rejected: AIObox refused handoff_open \(run \d+\): 6 new windows in the last hour \(budget; next: AIObox's hourly budget for AI handoff_open is used up/, "AIObox's refusal keeps its own code");
  assert.match((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P1·W1', text: 'broken' })).text, /handoff_open run \d+ ended error: verify: no signed-in claude\.ai client \(steps: open ok → connect ok → verify error \(no signed-in claude\.ai client\)\)/);
  const slow = JSON.parse((await call('aiobox_write', { op: 'handoff_open', profile: 'P2', provider: 'claude', like: 'P1·W1', text: 'slow', wait: 1 })).text);
  assert.deepEqual([slow.done, slow.window, slow.steps.at(-1)], [false, undefined, { step: 'connect', status: 'running', at: slow.steps.at(-1).at, info: null }]);
  assert.match(slow.next, new RegExp(`still running: aki__aiobox op=runs id=${slow.runId} reads each step`));
  const one = JSON.parse((await call('aiobox', { op: 'runs', id: slow.runId })).text).runs;
  assert.deepEqual([one.length, one[0].request, one[0].running, one[0].steps.length], [1, slow.request, true, 4], 'op=runs id= reads one run with its steps');
  assert.equal(JSON.parse((await call('aiobox', { op: 'runs', request: opened.request })).text).runs[0].automation, 'ai-new-window');
  assert.equal('steps' in JSON.parse((await call('aiobox', { op: 'runs', automation: 'usage', last: 1 })).text).runs[0], false, 'a run without steps shows no key');

  // G4 open_url: AkiMCP checks the address as AIObox's url_allowed does, so a bad one writes no request; a profile must be registered; AIObox's refusal keeps its code.
  const before = seen.length;
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'HTTPS://EXAMPLE.COM', 'https://', 'https:///p', 'https://user:pw@evil.example/', 'https://exa mple.com', 'https://ex%61mple.com', `https://example.com/${'a'.repeat(2048)}`]) {
    assert.match((await call('aiobox_write', { op: 'open_url', url: bad })).text, /\(url_not_allowed;/, bad);
  }
  assert.equal((await call('aiobox_write', { op: 'open_url' })).text, 'rejected: op=open_url needs url');
  assert.match((await call('aiobox_write', { op: 'open_url', url: 'https://example.com', profile: 'P77' })).text, /no AIObox profile 'P77'.*\(not_registered;/);
  assert.equal(seen.length, before, 'a refused link writes no request');
  const link = JSON.parse((await call('aiobox_write', { op: 'open_url', url: ' https://example.com/a?b#c ' })).text);
  assert.deepEqual([link.url, link.profileId, link.opened, link.outcome, seen.at(-1).op, seen.at(-1).args], ['https://example.com/a?b#c', null, 'system', 'ok', 'open_url', { url: 'https://example.com/a?b#c' }]);
  const inProfile = JSON.parse((await call('aiobox_write', { op: 'open_url', url: 'http://[::1]:8443/', profile: 'P2' })).text);
  assert.deepEqual([inProfile.profileId, inProfile.opened, seen.at(-1).args], ['chrome-profile-7', 'chrome-profile-7', { url: 'http://[::1]:8443/', profileId: 'chrome-profile-7' }], 'a profile even when not signed in to anything: no provider to check');
  assert.match((await call('aiobox_write', { op: 'open_url', url: 'https://refuse.example/' })).text, /AIObox refused open_url \(run \d+\): an address with a user@ before its host \(url_not_allowed;/);
  assert.match(inProfile.next, /close the tab it opened: op=close_window/, 'open_url in a profile says to clean up after the check');
  assert.equal(link.next, undefined, "the system's browser has no tab AkiMCP sees, so no clean-up next");
  // A link tab op=open_url opened has no panel: close_window closes it over CDP; any other panel-less tab stays the owner's (owner 2026-10-05).
  const linkTarget = live[7777].find((t) => t.id === 'T-CLAUDE');
  const [keptUrl, keptTitle, keptPage] = [linkTarget.url, linkTarget.title, pages['T-CLAUDE']];
  pages['T-CLAUDE'] = { body: '' };
  linkTarget.title = 'P7·W2·T2 · Example Domain';
  linkTarget.url = 'https://other.example/';
  assert.match((await call('aiobox_write', { op: 'close_window', window: 'T-CLAUDE' })).text, /is no link op=open_url opened.*\(no_panel/);
  linkTarget.url = 'https://example.com/a?b#c';
  assert.match((await call('aiobox_write', { op: 'close_window', window: 'T-CLAUDE' })).text, /is no link op=open_url opened.*\(no_panel/, "a link the system's browser opened is not recorded");
  linkTarget.url = 'http://[::1]:8443/';
  assert.match((await call('aiobox_write', { op: 'close_window', window: 'T-CLAUDE', successor: 'abc' })).text, /succeeds nothing \(no_panel/);
  const closedTabs = [];
  const realCloseTab = cdp.closeTab;
  cdp.closeTab = async ({ port, targetId }) => {
    closedTabs.push(targetId);
    live[port] = live[port].filter((t) => t.id !== targetId);
  };
  const linkClosed = JSON.parse((await call('aiobox_write', { op: 'close_window', window: 'T-CLAUDE' })).text);
  assert.deepEqual([linkClosed.closed, linkClosed.link, closedTabs], [true, 'http://[::1]:8443/', ['T-CLAUDE']]);
  live[7777].push(linkTarget);
  assert.match((await call('aiobox_write', { op: 'close_window', window: 'T-CLAUDE' })).text, /\(no_panel/, 'a closed link is forgotten');
  cdp.closeTab = realCloseTab;
  [linkTarget.url, linkTarget.title, pages['T-CLAUDE']] = [keptUrl, keptTitle, keptPage];

  // A chat no tab shows any more: op=read returns the copy AIObox saved in archive/<chatId>.json (quota handoff, close).
  const archivePath = path.join(aioboxHome, 'archive');
  assert.match((await call('aiobox', { op: 'read', window: 'gone-chat' })).text, /no window 'gone-chat'.*\(no_window/, 'no archive yet: still no_window');
  fs.mkdirSync(archivePath, { recursive: true });
  const saved = (chatId, savedAt, extra = {}) => fs.writeFileSync(path.join(archivePath, `${chatId}.json`), JSON.stringify({ version: 1, chatId, provider: 'notion', profileId: 'chrome-profile-18', handle: 'P9·W6', url: `https://app.notion.com/chat?t=${chatId}`, title: 'old chat', workspace: { id: 'w1', label: 'dldn.1' }, savedAt, reason: 'quota_handoff', successor: 'P9·W6', truncated: false, messages: [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }, { role: 'user', text: 'q2' }], ...extra }));
  saved('3f0f022c-5a74-801b-becf-00a9c9fe60c9', '2026-10-05T04:00:00Z');
  saved('older0chat', '2026-10-05T03:00:00Z', { reason: 'close', successor: null });
  saved('future0chat', '2026-10-05T05:00:00Z', { version: 2 });
  saved('cut0chat', '2026-10-05T02:00:00Z', { reason: 'interrupted', successor: null });
  const arch = JSON.parse((await call('aiobox', { op: 'read', window: '3F0F022C5A74801BBECF00A9C9FE60C9', last: 2 })).text);
  assert.deepEqual([arch.archived, arch.chatId, arch.reason, arch.successor, arch.truncated, arch.total, arch.messages.map((m) => m.text), arch.workspace.label], [true, '3f0f022c-5a74-801b-becf-00a9c9fe60c9', 'quota_handoff', 'P9·W6', false, 3, ['a1', 'q2'], 'dldn.1'], 'a chatId matches without dashes, in any case; last=N cut by AkiMCP');
  assert.match(arch.next, /op=read window=P9·W6/);
  const byHandle = JSON.parse((await call('aiobox', { op: 'read', window: 'p9w6' })).text);
  assert.deepEqual([byHandle.chatId, byHandle.messages.length], ['3f0f022c-5a74-801b-becf-00a9c9fe60c9', 1], 'a handle no tab has: the newest copy naming it, skipping a version AkiMCP cannot read');
  assert.match((await call('aiobox', { op: 'read', window: 'future0chat' })).text, /archive future0chat\.json has version 2, AkiMCP reads 1/);
  const cutArch = JSON.parse((await call('aiobox', { op: 'read', window: 'cut0chat' })).text);
  assert.deepEqual([cutArch.reason, cutArch.successor], ['interrupted', null], 'an interrupted handoff saves before its successor exists');
  assert.match(cutArch.next, /AIObox is handing this chat off; the successor shows in aki__aiobox op=runs/);
  assert.match(JSON.parse((await call('aiobox', { op: 'read', window: 'older0chat' })).text).next, /no tab shows this chat now/, 'a plain close keeps the plain next');
  assert.match((await call('aiobox', { op: 'read', window: 'older0chat', expect: 'x' })).text, /\(no_window/, 'expect names a live tab: no archive');
  assert.match((await call('aiobox', { op: 'read', window: 'P1·W1' })).text, /\(stale_map;/, 'only no_window falls back to the archive, never a stale map');
  fs.rmSync(archivePath, { recursive: true });
  clearInterval(app);
  db.close();
  fs.rmSync(path.join(aioboxHome, 'flags.json'));
}

clearInterval(responder);
await client.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('aiobox-mcp.test.js: ok');

