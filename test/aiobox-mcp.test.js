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
import cdp from '../scripts/cdp-engine.js';
import { register, provider, parseHandle, formatHandle, stripHandle } from '../scripts/aiobox-mcp.js';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aiobox-mcp-test-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
const mapFile = path.join(home, '.aki', 'aiobox', 'cdp', 'windows.json');

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
assert.equal(missing.text, 'rejected: AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)');

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

const windows = JSON.parse((await call('aiobox', { op: 'windows' })).text);
assert.deepEqual(windows.map((w) => [w.handle, w.provider, w.profile]), [['P1·W1', 'notion', 'nt@x.com'], ['P7·W2', 'gpt', 'lac'], ['P7·W2·T2', 'claude', 'lac']]);
assert.equal(windows[0].title, 'nt@x.com · Chat | Notion', 'the handle prefix is stripped from the title');

assert.equal((await call('aiobox', { op: 'read' })).text, 'rejected: op=read needs window');
assert.equal((await call('aiobox', { op: 'text', window: 'P1·W1' })).text, 'rejected: op=text needs selector');
assert.equal((await call('aiobox', { op: 'read', window: 'P9·W9' })).text, "rejected: no window 'P9·W9'; open: P1·W1, P7·W2");

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
  const document = { body: { innerText: page.body ?? '' }, querySelector: () => null };
  return JSON.parse(JSON.stringify(vm.runInNewContext(expression, { window: { akipanel: page.akipanel }, document })));
};
const seen = [];
cdp.listTargets = async ({ port }) => live[port] || [];
cdp.evaluate = async ({ port, target, expression }) => {
  seen.push({ port, target: target.id, expression });
  if (expression.includes('akipanel')) return { value: runInPage(target.id, expression) };
  if (expression.includes('querySelectorAll')) return { value: [{ text: 'hi', ariaLabel: null }] };
  return { value: 42, type: 'number', target: { id: target.id } };
};
cdp.screenshot = async ({ target }) => ({ data: Buffer.from(target.id).toString('base64'), mimeType: 'image/png' });

const fromProvider = JSON.parse((await call('aiobox', { op: 'read', window: 'p1w1', last: 2 })).text);
assert.deepEqual(fromProvider, { window: 'P1·W1', source: 'provider', busy: false, messages: notionMessages.slice(-2) });
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
// No akipanel at all (AIObox panel not injected yet): raw body text.
pages['T-NOTION'].akipanel = undefined;
assert.deepEqual(JSON.parse((await call('aiobox', { op: 'read', window: 'P1·W1' })).text), { window: 'P1·W1', source: 'raw', text: 'notion body' });

assert.deepEqual(JSON.parse((await call('aiobox', { op: 'text', window: 'P1·W1', selector: 'h1' })).text), [{ text: 'hi', ariaLabel: null }]);
const shot = await call('aiobox', { op: 'screenshot', window: 'P7·W2' });
assert.equal(shot.content[0].type, 'image');
assert.equal(Buffer.from(shot.content[0].data, 'base64').toString(), 'T-GPT');

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
    map.profiles[1].windows.push({ handle: 'P7·W4', windowId: 4, state: 'normal', tabs: [{ handle: 'P7·W4', targetId: 'T-NEW', url: 'https://chatgpt.com/', title: 'P7·W4 · lac · ChatGPT' }] });
    fs.writeFileSync(mapFile, JSON.stringify(map));
  },
});
const opened = JSON.parse((await call('aiobox_write', { op: 'new_window', window: 'p7w2' })).text);
assert.equal(asked, 1);
assert.deepEqual(opened, { window: 'P7·W4', opener: 'P7·W2', provider: 'gpt', url: 'https://chatgpt.com/', title: 'lac · ChatGPT' });

assert.equal((await call('aiobox_write', { op: 'eval', window: 'P7·W2' })).text, 'rejected: op=eval needs expression');
const evaluated = JSON.parse((await call('aiobox_write', { op: 'eval', window: 'T-GPT', expression: '6*7' })).text);
assert.equal(evaluated.window, 'P7·W2', 'a targetId addresses the window too');
assert.equal(evaluated.value, 42);

await client.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('aiobox-mcp.test.js: ok');
