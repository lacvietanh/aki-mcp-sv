#!/usr/bin/env node
// aki__aiobox / aki__aiobox_write against a temp HOME with a fixture akimcp-state.json, windows.json and guide.md, a fake CDP engine and a fake AIObox request taker: no Chrome, no AIObox needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aiobox-mcp-test-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { default: cdp } = await import('../scripts/cdp-engine.js');
const { register, provider, parseHandle, formatHandle, stripHandle, CALL_WAIT_MAX_S, setTimings } = await import('../scripts/aiobox-mcp.js');
const { GUIDE_URL } = await import('../scripts/aiobox-guide.js');
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const aioboxHome = path.join(home, '.aki', 'aiobox');
const stateFile = path.join(aioboxHome, 'akimcp-state.json');
const mapFile = path.join(aioboxHome, 'cdp', 'windows.json');
const refreshFile = path.join(aioboxHome, 'cdp', 'windows.refresh');
const guideFile = path.join(aioboxHome, 'guide.md');
const requestsPath = path.join(aioboxHome, 'requests');
const runsFile = path.join(aioboxHome, 'automation.sqlite');

// The same examples as aiobox cdp/handle.rs tests, so the two parsers cannot drift apart unnoticed.
const p3w2 = { profile: 3, window: 2, tab: null };
for (const typed of ['P3·W2', 'P3.W2', 'p3w2', 'P3-W2', 'P3 W2', ' p3 · w2 ']) assert.deepEqual(parseHandle(typed), p3w2, typed);
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
assert.equal(CALL_WAIT_MAX_S, 50);

assert.equal(provider.detect().available, false, 'no ~/.aki/aiobox/ = not installed');
assert.match(provider.detect().reason, /AIObox \(not installed here\).*https:\/\/aiobox\.app\/guide\/aiobox\.md\?from=akimcp$/, 'the not-installed reason says what AIObox adds (D7)');

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
const body = (r) => JSON.parse(r.text);
// AkiMCP's own refusal: an error result whose JSON says by: "akimcp" and carries its code.
const refused = (r, code) => {
  assert.ok(r.isError, r.text);
  const b = body(r);
  assert.equal(b.by, 'akimcp', r.text);
  assert.equal(b.code, code, r.text);
  assert.equal(b.ok, false);
  return b;
};
const rejectedBySchema = async (name, args) => {
  try {
    return (await client.callTool({ name, arguments: args })).isError === true;
  } catch {
    return true;
  }
};

// The tool surface is the closed envelope; descriptions are static and name no op, threshold or macro.
const tools = (await client.listTools()).tools;
const readTool = tools.find((t) => t.name === 'aiobox');
const writeTool = tools.find((t) => t.name === 'aiobox_write');
assert.deepEqual(Object.keys(readTool.inputSchema.properties), ['op', 'window', 'expect', 'wait', 'args']);
assert.deepEqual(Object.keys(writeTool.inputSchema.properties), ['op', 'window', 'expect', 'wait', 'args', 'from']);
assert.deepEqual(readTool.inputSchema.required, ['op']);
assert.equal(readTool.description, "AIObox windows. Call op=state first: it returns the guide and every op with its args. window = handle, chatId or targetId; expect = text the target chat's url or title must contain; args as the guide says. Each op's help in op=state overrides the guide. Reads only; to act use aki__aiobox_write.");
assert.match(writeTool.description, /plus receipt/);
assert.match(writeTool.description, /Each op's help in op=state overrides the guide\./);
assert.match(writeTool.description, /from = your own window, so AIObox can refuse acting on yourself/);
assert.match(writeTool.description, /50 s/);
for (const t of [readTool, writeTool]) assert.doesNotMatch(t.description, /whoami|send|macro|quota|handoff|%|KB/i, 'no op list, no threshold, no macro name');
assert.equal(readTool.annotations.readOnlyHint, true);
assert.equal(writeTool.annotations.readOnlyHint, false, 'the registry gates a tool that is not read-only with the receipt');
assert.ok(await rejectedBySchema('aiobox', { op: 'Bad-Op' }), 'op is validated as a name');
assert.ok(await rejectedBySchema('aiobox', { op: "a');b('" }), 'no caller text can become code');
assert.ok(await rejectedBySchema('aiobox', { op: 'x'.repeat(65) }), 'op is at most 64 characters');
assert.ok(await rejectedBySchema('aiobox', { op: 'read', wait: 51 }), 'wait is at most 50 s');
assert.ok(await rejectedBySchema('aiobox', { op: 'read', args: 'text' }), 'args is a record');

// Not installed (no ~/.aki/aiobox/): refused before anything is read.
assert.match(refused(await call('aiobox', { op: 'state' }), 'not_running').why, /not installed/);

// The op table is read first: missing, unreadable or lower version means AIObox is old; a higher version means AkiMCP is.
fs.mkdirSync(path.join(aioboxHome, 'cdp'), { recursive: true });
const missingTable = refused(await call('aiobox', { op: 'state' }), 'version_mismatch');
assert.equal(missingTable.next, 'update AIObox');
fs.writeFileSync(stateFile, 'not json');
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P1·W1' }), 'version_mismatch').next, 'update AIObox', 'a corrupt table is an old AIObox');
fs.writeFileSync(stateFile, JSON.stringify({ version: 0, ops: {} }));
assert.equal(refused(await call('aiobox', { op: 'state' }), 'version_mismatch').next, 'update AIObox');
fs.writeFileSync(stateFile, JSON.stringify({ version: 2, ops: {} }));
const newer = refused(await call('aiobox', { op: 'state' }), 'version_mismatch');
assert.equal(newer.next, 'update AkiMCP');
assert.match(newer.why, new RegExp(`this AkiMCP ${VERSION.replaceAll('.', '\\.')} reads 1`));

const ops = {
  windows: { tool: 'read', channel: 'file', file: 'cdp/windows.json', help: 'every window as AIObox lists it' },
  profiles: { tool: 'read', channel: 'file', file: 'profiles.json' },
  archive: { tool: 'read', channel: 'file', file: 'archive/{chatId}.json', args: { chatId: 'a chat id' } },
  escape: { tool: 'read', channel: 'file', file: '../outside.json' },
  absolute: { tool: 'read', channel: 'file', file: '/etc/passwd' },
  nofile: { tool: 'read', channel: 'file' },
  big: { tool: 'read', channel: 'file', file: 'big.json' },
  edge: { tool: 'read', channel: 'file', file: 'edge.json' },
  dir: { tool: 'read', channel: 'file', file: 'dir.json' },
  whoami: { tool: 'read', channel: 'each', args: { quote: '20+ characters' }, help: 'which window am I' },
  read: { tool: 'read', channel: 'window', timeoutNext: 'read again with op=read' },
  peek: { tool: 'read', channel: 'window' },
  send: { tool: 'write', channel: 'window', args: { text: 'what to send' } },
  close_window: { tool: 'write', channel: 'request' },
  new_window: { tool: 'write', channel: 'request' },
  chat: { renamed: 'read' },
  old_send: { renamed: 'send' },
  lost: { renamed: 'gone' },
  future: { tool: 'read', channel: 'stream' },
};
fs.writeFileSync(stateFile, JSON.stringify({ version: 1, ops }));
assert.equal(provider.detect().available, true);

// op=state works with the app off: running false, the guide (one line while it is missing) and the op table as AIObox published it.
const off = body(await call('aiobox', { op: 'state' }));
assert.deepEqual([off.akimcp, off.running], [VERSION, false]);
assert.match(off.next, /open AIObox/);
assert.equal(off.guide, `guide missing: update AIObox (${GUIDE_URL})`);
assert.deepEqual(off.ops, ops);
const guideText = '---\nversion: 44\n---\n# AIObox guide\n\n1. Find yourself.\n';
fs.writeFileSync(guideFile, guideText);
assert.equal(body(await call('aiobox', { op: 'state' })).guide, guideText, 'the guide is the file, verbatim, frontmatter included');
assert.equal(body(await call('aiobox_write', { op: 'state' })).running, false, 'either tool answers state');

// Call order with the app off: unknown_op and wrong_tool come before not_running; an op that needs the app then says not_running, one on files does not.
const unknown = refused(await call('aiobox', { op: 'nope' }), 'unknown_op');
assert.match(unknown.why, /no op 'nope'; ops: windows, profiles, archive/);
assert.match(unknown.next, /op=state/);
assert.equal(refused(await call('aiobox', { op: 'send', window: 'P1·W1' }), 'wrong_tool').next, 'call it with aki__aiobox_write');
for (const [tool, op] of [['aiobox', 'read'], ['aiobox', 'whoami'], ['aiobox_write', 'close_window'], ['aiobox_write', 'send']]) {
  assert.match(refused(await call(tool, { op, window: 'P1·W1' }), 'not_running').next, /open AIObox/, `${op} needs the app`);
}
assert.match(refused(await call('aiobox', { op: 'windows' }), 'not_running').why, /not running/, 'no windows.json: the app is off');
const profilesText = '{"version": 1,\n "profiles": []}\n';
fs.writeFileSync(path.join(aioboxHome, 'profiles.json'), profilesText);
assert.equal((await call('aiobox', { op: 'profiles' })).text, profilesText, 'a file op answers with the app off (S1), verbatim');
refused(await call('aiobox', { op: 'archive', args: { chatId: 'abc-1' } }), 'not_running');

// A fake CDP engine. The page expression really runs, in a vm against a fake page whose akipanel is a readonly Proxy like AIObox's; the result crosses a JSON round trip like CDP returnByValue.
fs.writeFileSync(mapFile, JSON.stringify({
  version: 1,
  generation: 1,
  profiles: [
    { number: 1, id: 'chrome-profile-11', name: 'nt@x.com', port: 1111, windows: [
      { handle: 'P1·W1', state: 'normal', tabs: [{ handle: 'P1·W1', targetId: 'T-NOTION', url: 'https://app.notion.com/chat?t=abc', title: 'P1·W1 · nt@x.com · Chat | Notion', chatId: 'abc', provider: 'notion' }] },
    ] },
    { number: 7, id: 'chrome-profile-10', name: 'lac', port: 7777, windows: [
      { handle: 'P7·W2', state: 'normal', tabs: [
        { handle: 'P7·W2', targetId: 'T-GPT', url: 'https://chatgpt.com/c/123', title: 'P7·W2 · lac · Review', chatId: '123', provider: 'gpt' },
        { handle: 'P7·W2·T2', targetId: 'T-CLAUDE', url: 'https://claude.ai/new', title: 'P7·W2·T2 · Claude', chatId: null, provider: 'claude' },
      ] },
    ] },
  ],
  retired: [
    { handle: 'P7·W9', successor: 'P7·W2', at: '2026-10-07T00:00:00.000Z', end: 'P7·W2' },
    { handle: 'P7·W8', successor: 'P7·W7', at: '2026-10-07T00:00:00.000Z', end: 'P7·W7' },
  ],
}));
const liveTargets = () => ({
  1111: [{ id: 'T-NOTION', type: 'page', title: 'P1·W1 · nt@x.com · Chat | Notion', url: 'https://app.notion.com/chat?t=abc' }],
  7777: [{ id: 'T-GPT', type: 'page', title: 'P7·W2 · lac · Review', url: 'https://chatgpt.com/c/123' }, { id: 'T-CLAUDE', type: 'page', title: 'P7·W2·T2 · Claude', url: 'https://claude.ai/new' }],
});
let live = liveTargets();
const readonlyPanel = (panel) => new Proxy(panel, { set: () => false, defineProperty: () => false, deleteProperty: () => false });
const calls = [];
const panelWith = (handler) => readonlyPanel({
  call: async (op, args, ctx) => {
    calls.push(JSON.parse(JSON.stringify({ op, args, ctx })));
    return handler(op, args, ctx);
  },
});
const echo = (op, args) => ({ ok: true, data: { op, args } });
const pages = {
  'T-NOTION': { akipanel: panelWith(echo) },
  'T-GPT': { akipanel: panelWith(echo) },
  'T-CLAUDE': {},
};
const frozen = new Set();
cdp.listTargets = async ({ port }) => live[port] || [];
cdp.evaluate = async ({ port, target, expression }) => {
  if (frozen.has(target.id)) return new Promise(() => {});
  const result = await vm.runInNewContext(expression, { window: { akipanel: pages[target.id]?.akipanel } });
  return { value: JSON.parse(JSON.stringify(result)) };
};

// A fake AIObox answering windows.refresh: takes the id, deletes the file, rewrites windows.json with answered = id and a higher generation.
let answering = true;
let refreshes = 0;
const responder = setInterval(() => {
  if (!answering || !fs.existsSync(refreshFile)) return;
  const id = fs.readFileSync(refreshFile, 'utf8').trim();
  fs.unlinkSync(refreshFile);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  refreshes += 1;
  fs.writeFileSync(mapFile, JSON.stringify({ ...map, generation: (map.generation || 0) + 1, answered: id }));
}, 20);

// Channel window: handle, chatId or targetId resolve to a live target, then akipanel.call(op, args, ctx) runs there; { ok, data } or { ok:false, code, why, next } comes back as AIObox wrote it.
const started = Date.now();
const first = await call('aiobox', { op: 'read', window: 'p1w1', args: { last: 2 } });
assert.deepEqual(body(first), { window: 'P1·W1', targetId: 'T-NOTION', ok: true, data: { op: 'read', args: { last: 2 } } });
assert.equal(first.isError, false);
assert.equal(refreshes, 0, 'a hit never asks AIObox to refresh');
const sent = calls.at(-1);
assert.deepEqual([sent.op, sent.args], ['read', { last: 2 }]);
assert.deepEqual(Object.keys(sent.ctx).sort(), ['deadlineAt', 'mode'], 'ctx = { deadlineAt, mode } until expect or from are given');
assert.equal(sent.ctx.mode, 'read');
assert.ok(sent.ctx.deadlineAt > started && sent.ctx.deadlineAt <= Date.now() + CALL_WAIT_MAX_S * 1000, 'deadlineAt is this call\'s 50 s limit as epoch ms');
for (const name of ['abc', 'T-NOTION']) assert.equal(body(await call('aiobox', { op: 'read', window: name })).window, 'P1·W1', `${name} names the same window`);
const shortWait = await call('aiobox', { op: 'peek', window: 'P7·W2', wait: 5 });
assert.ok(calls.at(-1).ctx.deadlineAt - started <= 5_000 + 1_000, 'wait shortens the deadline AIObox is given');
assert.equal(body(shortWait).ok, true);
const callsBeforePeek = calls.length;
await call('aiobox', { op: 'peek', window: 'P7·W2' });
assert.deepEqual(calls[callsBeforePeek].args, {}, 'no args reaches AIObox as an empty record');

// The write tool forwards any op with mode write, from and expect in ctx; the read tool refuses an op published as write.
await call('aiobox_write', { op: 'read', window: 'P7·W2', from: 'abc', expect: 'chatgpt.com/c/123' });
assert.deepEqual(calls.at(-1).ctx, { deadlineAt: calls.at(-1).ctx.deadlineAt, mode: 'write', expect: 'chatgpt.com/c/123', from: 'abc' });
const before = calls.length;
refused(await call('aiobox', { op: 'send', window: 'P7·W2', args: { text: 'x' } }), 'wrong_tool');
assert.equal(calls.length, before, 'a refused op never reaches the page');

// AIObox's own refusal is forwarded verbatim and carries nothing from AkiMCP; the call is an error.
pages['T-GPT'].akipanel = panelWith(() => ({ ok: false, code: 'busy', why: 'it is answering', next: 'wait and read again' }));
const busy = await call('aiobox_write', { op: 'send', window: 'P7·W2', args: { text: 'x' } });
assert.ok(busy.isError);
assert.deepEqual(body(busy), { window: 'P7·W2', targetId: 'T-GPT', ok: false, code: 'busy', why: 'it is answering', next: 'wait and read again' });
pages['T-GPT'].akipanel = panelWith(echo);

// Caller text is data: the args reach the page unchanged, whatever they contain.
const hostile = { text: '"); throw new Error("x"); (" `${process.exit(1)}`\n\\' };
const hostileOut = await call('aiobox_write', { op: 'send', window: 'P7·W2', args: hostile });
assert.deepEqual(calls.at(-1).args, hostile);
assert.equal(hostileOut.isError, false);

// The envelope fields are authoritative: an AIObox payload that carries window or targetId cannot overwrite them.
pages['T-GPT'].akipanel = panelWith(() => ({ ok: true, data: {}, window: 'evil', targetId: 'evil' }));
const pinned = body(await call('aiobox', { op: 'peek', window: 'P7·W2' }));
assert.deepEqual([pinned.window, pinned.targetId], ['P7·W2', 'T-GPT']);
pages['T-GPT'].akipanel = panelWith(echo);

// A retired handle leads to the window that took over (retired[].end) and says so; one whose end is not open is no_window.
const succeeded = body(await call('aiobox', { op: 'read', window: 'p7w9' }));
assert.deepEqual([succeeded.window, succeeded.resolvedFrom, succeeded.targetId], ['P7·W2', 'P7·W9', 'T-GPT']);
refreshes = 0;
const gone = refused(await call('aiobox', { op: 'read', window: 'P7·W8' }), 'no_window');
assert.match(gone.why, /\(retired: P7·W8 -> P7·W7, which is not open\); open: P1·W1, P7·W2/);
assert.equal(refreshes, 1, 'a miss asks AIObox to refresh once, then decides');
refused(await call('aiobox', { op: 'read', window: 'P9·W9' }), 'no_window');
refused(await call('aiobox', { op: 'read' }), 'no_window');

// expect is checked here, on the live target, before anything runs: a substring of its url or title, or its targetId.
for (const expect of ['chatgpt.com/c/123', 'Review', 'T-GPT']) assert.equal(body(await call('aiobox', { op: 'read', window: 'P7·W2', expect })).ok, true, expect);
const callsBefore = calls.length;
const wrong = refused(await call('aiobox_write', { op: 'send', window: 'P7·W2', expect: 'some other chat' }), 'wrong_window');
assert.match(wrong.why, /P7·W2 now shows "lac · Review" \(https:\/\/chatgpt\.com\/c\/123\), not "some other chat"/);
assert.equal(calls.length, callsBefore, 'a wrong window is refused before any call');

// The map and Chrome disagree: a target that is gone, or titled with another handle, is stale_map.
live[7777] = [live[7777][0]];
refreshes = 0;
refused(await call('aiobox', { op: 'read', window: 'T-CLAUDE' }), 'stale_map');
assert.equal(refreshes, 1);
live = liveTargets();
live[7777][0].title = 'P7·W5 · lac · Review';
assert.match(refused(await call('aiobox', { op: 'read', window: 'P7·W2' }), 'stale_map').why, /target T-GPT is titled P7·W5, not P7·W2/);
live = liveTargets();

// A tab without akipanel is no_panel; one with akipanel but no call is version_mismatch (reload or update AIObox).
assert.match(refused(await call('aiobox', { op: 'read', window: 'T-CLAUDE' }), 'no_panel').why, /P7·W2·T2 has no AIObox panel/);
pages['T-CLAUDE'] = { akipanel: readonlyPanel({}) };
assert.equal(refused(await call('aiobox', { op: 'read', window: 'T-CLAUDE' }), 'version_mismatch').next, 'reload the window or update AIObox');

// Anything that is not a Refusal is classified, never a bare rejection: a CDP or page failure is app_not_listening with the raw message, in rows too.
const goodEvaluate = cdp.evaluate;
cdp.evaluate = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:7777'); };
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P7·W2' }), 'app_not_listening').why, 'connect ECONNREFUSED 127.0.0.1:7777');
assert.deepEqual(body(await call('aiobox', { op: 'whoami' })).map((r) => [r.by, r.code, r.why]), Array(3).fill(['akimcp', 'app_not_listening', 'connect ECONNREFUSED 127.0.0.1:7777']));
cdp.evaluate = goodEvaluate;
const goodList = cdp.listTargets;
cdp.listTargets = async () => { throw new Error('no CDP endpoint on 7777'); };
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P7·W2' }), 'app_not_listening').why, 'no CDP endpoint on 7777');
assert.equal(refused(await call('aiobox', { op: 'whoami' }), 'app_not_listening').why, 'no CDP endpoint on 7777', 'a listTargets failure refuses the whole each call, not every row as stale_map');
cdp.listTargets = goodList;

// Channel each: akipanel.call on every live tab, one row per window; a tab that cannot answer is its own row and holds nobody else's.
pages['T-NOTION'].akipanel = panelWith(() => ({ ok: true, data: { you: true } }));
pages['T-GPT'].akipanel = panelWith(() => ({ ok: false, code: 'not_here', why: 'no quote shown', next: 'ask again' }));
pages['T-CLAUDE'] = {};
const each = body(await call('aiobox', { op: 'whoami', args: { quote: 'x'.repeat(20) } }));
assert.deepEqual(each.slice(0, 2), [{ window: 'P1·W1', ok: true, data: { you: true } }, { window: 'P7·W2', ok: false, code: 'not_here', why: 'no quote shown', next: 'ask again' }]);
assert.deepEqual([each[2].window, each[2].ok, each[2].by, each[2].code], ['P7·W2·T2', false, 'akimcp', 'no_panel']);
assert.deepEqual(calls.at(-1).args, { quote: 'x'.repeat(20) });
live[7777] = [live[7777][0]];
const eachStale = body(await call('aiobox', { op: 'whoami' }));
assert.deepEqual([eachStale[2].by, eachStale[2].code], ['akimcp', 'stale_map']);
live = liveTargets();
pages['T-GPT'].akipanel = panelWith(echo);
pages['T-NOTION'].akipanel = panelWith(echo);

// S4: one call ends within its deadline even when a tab never answers, and says what is safe next: the op's own timeoutNext, else a generic line by mode.
setTimings({ callBudgetMs: 800 });
const timed = async (name, args) => { const t0 = Date.now(); const r = await call(name, args); return { ...r, ms: Date.now() - t0 }; };
frozen.add('T-GPT');
const frozenRead = await timed('aiobox', { op: 'read', window: 'P7·W2' });
assert.equal(refused(frozenRead, 'timeout').next, 'read again with op=read', 'timeoutNext of the op');
assert.ok(frozenRead.ms < 800 + 400, `a frozen read ends at the deadline (${frozenRead.ms} ms)`);
assert.match(refused(await timed('aiobox', { op: 'peek', window: 'P7·W2' }), 'timeout').next, /^call it again; out of time again/, 'a read without timeoutNext gets the generic read line');
const frozenSend = await timed('aiobox_write', { op: 'send', window: 'P7·W2' });
assert.match(refused(frozenSend, 'timeout').next, /may have taken effect: check with a read op before trying again/, 'a write without timeoutNext gets the generic write line');
assert.ok(frozenSend.ms < 800 + 400);
setTimings({ callBudgetMs: 2_000 });
const eachFrozen = body(await call('aiobox', { op: 'whoami' }));
assert.deepEqual([eachFrozen[0].ok, eachFrozen[1].by, eachFrozen[1].code], [true, 'akimcp', 'timeout'], 'one frozen tab is one timeout row');
setTimings({ callBudgetMs: null });
frozen.clear();

// Channel request: requests/<id>.json, envelope v2, then the runs row; only outcome and detail come back. A fake AIObox takes each file the way the app does.
const db = new DatabaseSync(runsFile);
db.exec('CREATE TABLE runs (id INTEGER PRIMARY KEY, request TEXT, started_at TEXT, ended_at TEXT, outcome TEXT, detail TEXT)');
const addRun = db.prepare('INSERT INTO runs (request, started_at, outcome, detail) VALUES (?, ?, ?, ?)');
let takerMode = 'ok';
const taken = [];
const taker = setInterval(() => {
  if (takerMode === 'ignore' || !fs.existsSync(requestsPath)) return;
  for (const name of fs.readdirSync(requestsPath).filter((n) => n.endsWith('.json'))) {
    const file = path.join(requestsPath, name);
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.unlinkSync(file);
    taken.push(envelope);
    const now = new Date().toISOString();
    if (takerMode === 'ok') addRun.run(envelope.id, now, 'ok', '{"closed":true}');
    else if (takerMode === 'refused') addRun.run(envelope.id, now, 'refused', '{"code":"not_idle","why":"it is answering","next":"wait"}');
    else if (takerMode === 'retried') {
      addRun.run(envelope.id, '2000-01-01T00:00:00.000Z', 'refused', '{"first":true}');
      addRun.run(envelope.id, now, 'ok', '{"retry":true}');
    }
    else if (takerMode === 'broken') db.exec('ALTER TABLE runs RENAME TO runs_gone');
    else if (takerMode === 'running') addRun.run(envelope.id, now, null, null);
    else if (takerMode === 'late') {
      addRun.run(envelope.id, now, null, null);
      setTimeout(() => db.prepare('UPDATE runs SET outcome = ?, detail = ? WHERE request = ?').run('ok', '{"late":true}', envelope.id), 600);
    }
  }
}, 20);
const closed = await call('aiobox_write', { op: 'close_window', window: 'P7·W2', from: 'abc', args: { successor: 'P1·W1' } });
const envelope = taken.at(-1);
assert.deepEqual(Object.keys(envelope).sort(), ['args', 'at', 'deadline', 'from', 'id', 'mode', 'op', 'version', 'window']);
assert.deepEqual([envelope.version, envelope.op, envelope.mode, envelope.window, envelope.from, envelope.args], [2, 'close_window', 'write', 'T-GPT', 'abc', { successor: 'P1·W1' }], 'window is the resolved targetId, from rides beside the frozen keys');
assert.match(envelope.id, /^akimcp-\d+-\d+-\d+$/);
assert.ok(!Number.isNaN(Date.parse(envelope.at)));
assert.ok(envelope.deadline > Date.now() && envelope.deadline <= Date.now() + CALL_WAIT_MAX_S * 1000);
assert.deepEqual(body(closed), { request: envelope.id, outcome: 'ok', detail: '{"closed":true}' });
assert.equal(closed.isError, false);
assert.deepEqual(fs.readdirSync(requestsPath), [], 'AIObox took the file; no tmp file is left');
// No window: the envelope has no window or from, args default to an empty record.
await call('aiobox_write', { op: 'new_window' });
assert.deepEqual(Object.keys(taken.at(-1)).sort(), ['args', 'at', 'deadline', 'id', 'mode', 'op', 'version']);
assert.deepEqual(taken.at(-1).args, {});
// AIObox's refusal is a run with outcome refused: forwarded as written, an error, nothing added.
takerMode = 'refused';
const refusedRun = await call('aiobox_write', { op: 'close_window', window: 'P7·W2' });
assert.ok(refusedRun.isError);
assert.deepEqual(body(refusedRun), { request: taken.at(-1).id, outcome: 'refused', detail: '{"code":"not_idle","why":"it is answering","next":"wait"}' });
// A run that ends later is waited for.
takerMode = 'late';
const late = await call('aiobox_write', { op: 'close_window', window: 'P7·W2' });
assert.deepEqual([body(late).outcome, body(late).detail], ['ok', '{"late":true}']);
// wrong_window stops a request too: nothing is written.
takerMode = 'ok';
const takenBefore = taken.length;
refused(await call('aiobox_write', { op: 'close_window', window: 'P7·W2', expect: 'some other chat' }), 'wrong_window');
assert.equal(taken.length, takenBefore);
assert.deepEqual(fs.readdirSync(requestsPath), []);
// A retried run leaves two rows for one request: the newest wins.
takerMode = 'retried';
assert.deepEqual([body(await call('aiobox_write', { op: 'close_window', window: 'P7·W2' })).outcome], ['ok']);
// Taken but never ended: timeout carrying the request id, and the generic write line.
takerMode = 'running';
setTimings({ callBudgetMs: 900 });
const stuck = refused(await call('aiobox_write', { op: 'close_window', window: 'P7·W2' }), 'timeout');
assert.equal(stuck.request, taken.at(-1).id);
assert.match(stuck.next, /may have taken effect/);
// Taken, then the runs row cannot be read (not a lock): classified, and it carries the request id with a check-before-resend next.
takerMode = 'broken';
const broken = refused(await call('aiobox_write', { op: 'close_window', window: 'P7·W2' }), 'no_file');
assert.equal(broken.request, taken.at(-1).id);
assert.match(broken.next, /may already have taken effect: find it in the runs \(op=state names the op that reads them\) before sending it again/);
db.exec('ALTER TABLE runs_gone RENAME TO runs');
// Never taken: the file is taken back when the deadline passes or when AIObox is not listening.
takerMode = 'ignore';
const ignored = refused(await call('aiobox_write', { op: 'close_window', window: 'P7·W2' }), 'timeout');
assert.match(ignored.request, /^akimcp-/);
assert.deepEqual(fs.readdirSync(requestsPath), [], 'the request file is deleted when the call gives up');
setTimings({ callBudgetMs: null, requestPickupMs: 300 });
const silent = refused(await call('aiobox_write', { op: 'close_window', window: 'P7·W2' }), 'app_not_listening');
assert.match(silent.why, /did not take request akimcp-/);
assert.deepEqual(fs.readdirSync(requestsPath), []);
takerMode = 'ok';

// Channel file: the file named by the op, verbatim; windows.json first goes through windows.refresh.
refreshes = 0;
const listedText = (await call('aiobox', { op: 'windows' })).text;
assert.equal(listedText, fs.readFileSync(mapFile, 'utf8'), 'windows.json as AIObox wrote it');
assert.equal(refreshes, 1, 'reading windows.json asks AIObox to refresh first');
assert.match(JSON.parse(listedText).answered, /^akimcp-/);
assert.equal((await call('aiobox', { op: 'profiles' })).text, profilesText);
assert.equal(refreshes, 1, 'only windows.json is refreshed');
answering = false;
setTimings({ refreshWaitMs: 300 });
refused(await call('aiobox', { op: 'windows' }), 'app_not_listening');
answering = true;
fs.mkdirSync(path.join(aioboxHome, 'archive'));
const archived = '{ "chatId":"abc-1",  "messages": [] }\n';
fs.writeFileSync(path.join(aioboxHome, 'archive', 'abc-1.json'), archived);
assert.equal((await call('aiobox', { op: 'archive', args: { chatId: 'abc-1' } })).text, archived, '{chatId} is args.chatId');
assert.match(refused(await call('aiobox', { op: 'archive', args: { chatId: 'zzz' } }), 'no_file').why, /archive.*zzz\.json does not exist/, 'with the app up, a missing file is no_file');
for (const chatId of ['../profiles', 'a/b', 'a\\b', '', 'x'.repeat(129), 'a b', 'a.b']) refused(await call('aiobox', { op: 'archive', args: { chatId } }), 'no_file');
refused(await call('aiobox', { op: 'archive', args: { chatId: 7 } }), 'no_file');
refused(await call('aiobox', { op: 'archive' }), 'no_file');
assert.match(refused(await call('aiobox', { op: 'escape' }), 'no_file').why, /outside ~\/\.aki\/aiobox/);
refused(await call('aiobox', { op: 'absolute' }), 'no_file');
refused(await call('aiobox', { op: 'nofile' }), 'no_file');
fs.writeFileSync(path.join(aioboxHome, 'edge.json'), 'a'.repeat(4 * 1024 * 1024));
assert.equal((await call('aiobox', { op: 'edge' })).text.length, 4 * 1024 * 1024, 'exactly 4 MiB is read');
fs.writeFileSync(path.join(aioboxHome, 'big.json'), 'a'.repeat(4 * 1024 * 1024 + 1));
assert.match(refused(await call('aiobox', { op: 'big' }), 'no_file').why, /over the 4194304/);
fs.rmSync(path.join(aioboxHome, 'big.json'));
fs.mkdirSync(path.join(aioboxHome, 'dir.json'));
assert.match(refused(await call('aiobox', { op: 'dir' }), 'no_file').why, /EISDIR/, 'a filesystem error is no_file with the raw message');
fs.rmSync(path.join(aioboxHome, 'edge.json'));

// An entry with renamed is an alias: the named op runs and the result says so; an alias to nothing is unknown_op, and one to a write op stays fail-closed on the read tool.
const aliased = await call('aiobox', { op: 'chat', window: 'P1·W1', args: { last: 1 } });
assert.equal(calls.at(-1).op, 'read', 'AIObox is called by the new name');
assert.equal(body(aliased).ok, true);
assert.match(aliased.content[1].text, /op=chat is now op=read/);
const aliasMiss = await call('aiobox', { op: 'chat', window: 'P9·W9' });
assert.equal(body(aliasMiss).code, 'no_window');
assert.match(aliasMiss.content[1].text, /op=chat is now op=read/, 'a refusal after the alias says so too');
refused(await call('aiobox', { op: 'lost' }), 'unknown_op');
assert.match(refused(await call('aiobox', { op: 'old_send', window: 'P1·W1' }), 'wrong_tool').why, /op=send acts/);

// A channel this AkiMCP does not have, and windows.json of another version.
assert.equal(refused(await call('aiobox', { op: 'future' }), 'version_mismatch').next, 'update AkiMCP');
const mapText = fs.readFileSync(mapFile, 'utf8');
fs.writeFileSync(mapFile, JSON.stringify({ ...JSON.parse(mapText), version: 2 }));
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P1·W1' }), 'version_mismatch').next, 'update AkiMCP');
fs.writeFileSync(mapFile, JSON.stringify({ ...JSON.parse(mapText), version: 0 }));
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P1·W1' }), 'version_mismatch').next, 'update AIObox');
fs.writeFileSync(mapFile, 'not json');
assert.equal(refused(await call('aiobox', { op: 'read', window: 'P1·W1' }), 'version_mismatch').next, 'update AIObox');
fs.writeFileSync(mapFile, mapText);

// State with the app up.
assert.equal(body(await call('aiobox', { op: 'state' })).running, true);
assert.equal('next' in body(await call('aiobox', { op: 'state' })), false);

clearInterval(responder);
clearInterval(taker);
db.close();
await client.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('aiobox-mcp.test.js: ok');
