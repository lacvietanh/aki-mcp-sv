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
  const document = { body: { innerText: page.body ?? '' }, querySelector: () => null, readyState: 'complete' };
  return Promise.resolve(vm.runInNewContext(expression, { window: { akipanel: page.akipanel }, document, location: { href: page.url ?? 'about:blank' } })).then((v) => JSON.parse(JSON.stringify(v)));
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
pages['T-NOTION'] = { body: 'notion body', akipanel: readonlyPanel({
  online: true,
  capabilities: { chat: 1 },
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
assert.deepEqual(state.ops, { aiobox: ['windows', 'state', 'whoami', 'read', 'wait_idle', 'text', 'screenshot'], aiobox_write: ['new_window', 'new_chat', 'place_like', 'close_window', 'compose', 'send', 'run_macro', 'eval'] });
assert.deepEqual([state.claims, state.flags, state.blocked], [[], [], []], 'no coordination files yet: empty lists');
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
// Claims, flags and blocked workspaces come from AIObox's agent files, only the ones still in force.
const soon = new Date(Date.now() + 3_600_000).toISOString();
const gone = new Date(Date.now() - 1_000).toISOString();
const aioboxHome = path.join(home, '.aki', 'aiobox');
fs.writeFileSync(path.join(aioboxHome, 'claims.json'), JSON.stringify([{ chatId: 'abc', repo: '/r', paths: ['a.js'], task: 't', since: gone, until: soon }, { chatId: 'old', repo: '/r', paths: ['b.js'], task: 't', since: gone, until: gone }]));
fs.writeFileSync(path.join(aioboxHome, 'flags.json'), JSON.stringify([{ account: 'x@y', profileId: 'p', reason: 'interrupted', flaggedAt: gone, until: gone }]));
fs.writeFileSync(path.join(aioboxHome, 'blocked-workspaces.json'), JSON.stringify({ list: [{ workspace: 'dldn.1', provider: 'notion', reason: 'owner', blockedAt: gone, until: null }] }));
const coordinated = JSON.parse((await call('aiobox', { op: 'state' })).text);
assert.deepEqual(coordinated.claims.map((c) => c.chatId), ['abc'], 'an expired claim is gone');
assert.deepEqual(coordinated.flags, [], 'an expired flag is gone');
assert.deepEqual(coordinated.blocked.map((b) => b.workspace), ['dldn.1'], 'until null stays blocked');
fs.writeFileSync(path.join(aioboxHome, 'claims.json'), 'not json');
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'state' })).text).claims, [], 'an unreadable file is no claim');
for (const name of ['claims.json', 'flags.json', 'blocked-workspaces.json']) fs.rmSync(path.join(aioboxHome, name));
const notionRow = state.tabs.find((t) => t.targetId === 'T-NOTION');
assert.equal(notionRow.busy, true);
assert.deepEqual(notionRow.account, account);
assert.equal(state.tabs.find((t) => t.targetId === 'T-GPT').busy, null, 'no reader: busy is unknown, not guessed');
assert.deepEqual([notionRow.read, state.tabs.find((t) => t.targetId === 'T-GPT').read], ['live', null], 'read comes from akipanel.read; a panel without it is null');
assert.deepEqual(state.macros, { notion: [{ id: 'connect-akimcp', label: 'Connect AkiMCP', options: ['fast', 'full'] }] });

assert.match((await call('aiobox', { op: 'whoami', quote: 'too short' })).text, /short_quote/);
const me = JSON.parse((await call('aiobox', { op: 'whoami', quote: 'please compare  the last two answers' })).text);
assert.deepEqual([me.you.chatId, me.you.handle, me.you.matchedBy, me.you.busy], ['abc', 'P1·W1', 'latest user message', true], "the reader's latest user message outranks page text that also shows the quote");
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

// A chat id names the window too, and expect refuses a handle that now names another chat.
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'abc' })).text).window, 'P1·W1');
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'abc' })).text).chatId, 'abc');
assert.equal(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'Chat | Notion' })).text).window, 'P1·W1', 'expect may be title text');
const wrong = await call('aiobox', { op: 'read', window: 'P1·W1', expect: 'zzz' });
assert.ok(wrong.isError);
assert.match(wrong.text, /handle P1·W1 now points to "nt@x.com · Chat \| Notion" \(chat abc\), not "zzz"; handles were renumbered/);

// AIObox restarts: the same tabs come back under new numbers (P7's window becomes W1) and the old P7·W2 now names a new tab. Every read compares with the map seen before.
const before = fs.readFileSync(mapFile, 'utf8');
const moved = JSON.parse(before);
Object.assign(moved, { epoch: 1, appPid: 4242, generation: 1, updatedAt: '2026-10-03T18:38:05.000Z', answered: null });
moved.profiles[1].windows = [
  { handle: 'P7·W1', windowId: 2, state: 'normal', tabs: [{ handle: 'P7·W1', targetId: 'T-GPT', url: 'https://chatgpt.com/c/123', title: 'lac · Review' }] },
  { handle: 'P7·W2', windowId: 9, state: 'normal', tabs: [{ handle: 'P7·W2', targetId: 'T-OTHER', url: 'https://chatgpt.com/c/999', title: 'lac · Other' }] },
];
fs.writeFileSync(mapFile, JSON.stringify(moved));
const after = JSON.parse((await call('aiobox', { op: 'windows' })).text);
assert.equal(refreshes, 1, 'op=windows asks an AIObox that can refresh, every time');
assert.equal(after.run.epoch, 1);
assert.equal(after.run.appPid, 4242);
assert.equal(after.run.generation, 2, 'the list is the one AIObox wrote after the request');
assert.ok(!fs.existsSync(refreshFile));
assert.deepEqual(after.renumbered.changes.map((c) => [c.was.split(' ')[0], c.handle, c.targetId]), [['P7·W2', 'P7·W1', 'T-GPT'], ['P7·W2', 'P7·W2', 'T-OTHER']]);
assert.match(after.renumbered.warning, /^handles renumbered since .*: P7·W2 -> P7·W1, P7·W2 of another tab \(target T-GPT, chat 123\) -> P7·W2\./);
live[7777] = [{ id: 'T-GPT', type: 'page', title: 'P7·W1 · lac · Review', url: 'https://chatgpt.com/c/123' }, { id: 'T-OTHER', type: 'page', title: 'P7·W2 · lac · Other', url: 'https://chatgpt.com/c/999' }];
// An agent still holding "P7·W2" for chat 123 is refused with expect, warned without it, and reaches it by chat id.
assert.match((await call('aiobox_write', { op: 'eval', window: 'P7·W2', expression: '1', expect: '123' })).text, /handle P7·W2 now points to "lac · Other" \(chat 999\), not "123"/);
assert.match(JSON.parse((await call('aiobox_write', { op: 'eval', window: 'P7·W2', expression: '1' })).text).warning, /handles renumbered since/);
const byChat = JSON.parse((await call('aiobox_write', { op: 'eval', window: '123', expression: '1' })).text);
assert.equal(byChat.window, 'P7·W1');
assert.equal(byChat.targetId, 'T-GPT');
// The renumbering is remembered on disk, so a restarted AkiMCP (or another call) still reports it; an unchanged map adds nothing new.
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'windows' })).text).renumbered.changes, after.renumbered.changes);
assert.ok(JSON.parse(fs.readFileSync(seenFile, 'utf8')).last.restarted, 'a new epoch: AIObox restarted');
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
assert.equal((await call('aiobox_write', { op: 'new_window' })).text, 'rejected: op=new_window needs window');
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
assert.equal(opened.warning !== undefined, true, 'P7·W2 was renumbered in this run, so acting on it warns');
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

// close_window goes through akipanel.closeWindow() (sync Result): its refusal verbatim, the caller's own chat refused, never a CDP close.
pages['T-GPT'].akipanel = readonlyPanel({ online: true });
assert.match((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text, /no AIObox closeWindow.*\(no_close_window/);
let closes = 0;
let closeRefusal = 'the chat holds a draft';
pages['T-GPT'].akipanel = readonlyPanel({ online: true, closeWindow: () => (closes += 1, closeRefusal ? { ok: false, error: closeRefusal } : { ok: true, data: null }) });
assert.equal((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text, 'rejected: P7·W2: the chat holds a draft');
assert.match((await call('aiobox_write', { op: 'close_window', window: '123', from: '123' })).text, /is your own chat \(123\) \(self_target/);
closeRefusal = null;
assert.equal(JSON.parse((await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).text).closed, true);
assert.equal(closes, 2, 'the self refusal never reached the panel');

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

// send goes through akipanel.live.send (v1) and really sends: an older panel is named, wait= waits out an answer, the page's refusal comes back verbatim, the caller's own chat is refused.
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /P7·W2 has no AIObox send capability.*\(no_send/);
let gptBusy = true;
const sent = [];
pages['T-GPT'].akipanel = readonlyPanel({
  capabilities: { chat: 1, send: 1 },
  live: { chat: () => ({ ok: true, data: { messages: [], busy: gptBusy } }), send: async (t) => (gptBusy ? { ok: false, error: 'the chat is answering' } : (sent.push(t), { ok: true, data: null })) },
});
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, 'rejected: P7·W2: the chat is answering', 'without wait the page refuses, verbatim');
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x', wait: 1 })).text, /P7·W2 was still answering after 1s.*\(busy/);
setTimeout(() => { gptBusy = false; }, 1200);
const sentOut = JSON.parse((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'go on', wait: 5 })).text);
assert.deepEqual([sentOut.sent, sentOut.chatId, sent], [true, '123', ['go on']]);
assert.ok(sentOut.waitedMs >= 1000, 'it waited for the answer to end');
assert.match((await call('aiobox_write', { op: 'send', window: '123', text: 'x', from: '123' })).text, /is your own chat \(123\) \(self_target/);
assert.deepEqual(sent, ['go on'], 'refusals send nothing');
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { send: 2 }, live: { send: async () => ({ ok: true }) } });
assert.match((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x' })).text, /send capability version 2 in P7·W2 is not supported \(expected 1\)/);
// A page that can send but has no chat reader has no busy state to wait for: wait= is skipped, and a send that reports nothing is an error, never "sent".
pages['T-GPT'].akipanel = readonlyPanel({ capabilities: { send: 1 }, live: { send: async () => undefined } });
const noReaderStarted = Date.now();
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2', text: 'x', wait: 30 })).text, 'rejected: P7·W2: live.send() returned no result');
assert.ok(Date.now() - noReaderStarted < 2000, 'no wait without a reader');
assert.equal((await call('aiobox_write', { op: 'send', window: 'P7·W2' })).text, 'rejected: op=send needs text');

assert.equal((await call('aiobox_write', { op: 'eval', window: 'P7·W2' })).text, 'rejected: op=eval needs expression');
const evaluated = JSON.parse((await call('aiobox_write', { op: 'eval', window: 'T-GPT', expression: '6*7' })).text);
assert.equal(evaluated.window, 'P7·W2', 'a targetId addresses the window too');
assert.equal(evaluated.value, 42);

clearInterval(responder);
await client.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('aiobox-mcp.test.js: ok');
