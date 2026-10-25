#!/usr/bin/env node
import '../../../test/setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../page');
const pageFiles = ['postman-autoclick-target-match.cjs', 'postman-dom-util.js', 'postman-autoclick.js', 'postman-page-loop.js', 'postman-panel.js'];
const pageScript = `(function () {\n${pageFiles.map((f) => readFileSync(path.join(pageDir, f), 'utf8')).join('\n')}\n})();`;

const APPROVAL_CARD = '.tool-approval-wrapper, .tool-approval-single-item, .external-mcp-tool-approval, .ai-chat-loop-approval-message';
const CONVERSATION = '[data-testid="ai-chat-conversation-container"]';
const CHAT = '[data-testid="ai-chat-container"]';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Runs the real page scripts in a vm against a scripted Postman: the composer shows Send only while idle, a click on Send records the message and turns busy, and a fake clock drives the handoff's polling.
function loadPage(config = {}) {
  const state = { busy: false, noButtons: false, flipDelayMs: 0, approval: false, conversation: '', input: '', sent: [], newChats: 0, clipboard: null, clipboardFails: false, noInput: false, reply: '', thinking: '' };
  const statusNode = { textContent: '' };
  const logs = [];
  const timers = [];
  let now = 0;

  const sendButton = {
    get disabled() { return !state.input.trim(); },
    getAttribute: () => null,
    __reactProps$test: {
      onClick() {
        const message = state.input;
        const showMessage = () => { state.conversation += `\nUSER: ${message}`; };
        state.sent.push(message);
        state.input = '';
        if (state.flipDelayMs) {
          schedule(showMessage, state.flipDelayMs / 4);
          schedule(() => { state.busy = true; }, state.flipDelayMs);
        } else {
          showMessage();
          state.busy = true;
        }
      },
    },
  };
  const newChatButton = {
    __reactProps$test: {
      onClick() {
        state.conversation = '';
        state.input = '';
        state.busy = false;
        state.newChats += 1;
      },
    },
  };
  const conversation = { get innerText() { return state.conversation; }, get textContent() { return state.conversation; } };
  const input = { focus() {}, get textContent() { return state.input; }, closest: () => chat };
  const nodes = {
    [CHAT]: () => chat,
    [`${CHAT} ${CONVERSATION}`]: () => conversation,
    [CONVERSATION]: () => conversation,
    '[data-testid="ai-chat-input-editor"] [contenteditable="true"]': () => (state.noInput ? null : input),
    '.ai-chat-input-send-button': () => (state.busy || state.noButtons ? null : sendButton),
    '.ai-chat-input-cancel-button': () => (state.busy ? {} : null),
    [APPROVAL_CARD]: () => (state.approval ? {} : null),
    '[data-testid="ai-chat-new-conversation-button"]': () => newChatButton,
  };
  const query = (selector) => (nodes[selector] ? nodes[selector]() : null);
  const chat = { querySelector: query };
  const replyNode = { get innerText() { return state.reply; }, querySelectorAll: () => (state.thinking ? [{ innerText: state.thinking }] : []) };

  const schedule = (fn, ms = 0) => { timers.push({ at: now + ms, fn }); return timers.length; };
  const sandbox = {
    document: {
      querySelector: query,
      querySelectorAll: (selector) => (selector === '.ai-chat-message-group--last .ai-chat-agent-message' && state.reply ? [replyNode] : []),
      getElementById: (id) => (id === 'aki-chat-status' ? statusNode : null),
      addEventListener() {},
      createRange: () => ({ selectNodeContents() {} }),
      execCommand: (command, _ui, value) => { if (command === 'insertText') state.input = value; },
    },
    navigator: { clipboard: { writeText: async (text) => { if (state.clipboardFails) throw new Error('Document is not focused'); state.clipboard = text; } } },
    localStorage: { getItem: () => null },
    console: { log: (...args) => logs.push(args.join(' ')), error() {}, warn() {} },
    setTimeout: schedule,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: (fn) => schedule(fn, 16),
    Date: class { static now() { return now; } },
    __pmStats: {},
    __pmInitialConfig: config,
    __pmInitialInstruction: 'INSTR',
  };
  sandbox.window = sandbox;
  sandbox.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  vm.runInContext(pageScript, vm.createContext(sandbox));

  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };
  async function advance(ms) {
    const target = now + ms;
    await settle();
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > target) break;
      const next = timers.shift();
      now = Math.max(now, next.at);
      next.fn();
      await settle();
    }
    now = target;
    await settle();
  }
  return { state, logs, advance, summarize: () => sandbox.__pmDeliverSummarizePrompt('SUMMARIZE'), locked: () => sandbox.__pmSendInFlight, status: () => statusNode.textContent };
}

function agentAnswers(page, text) {
  page.state.reply = text;
  page.state.conversation += `\nAGENT: ${text}`;
  page.state.busy = false;
}

test('sends the summarize prompt once the agent stops, then pastes its reply unsent into a new chat', async () => {
  const page = loadPage();
  page.state.busy = true;
  page.state.flipDelayMs = 400;
  page.state.conversation = 'earlier work';
  page.state.reply = 'earlier answer';
  page.summarize();

  await page.advance(12 * 60_000);
  assert.deepEqual(page.state.sent, [], 'nothing is sent while Stop is showing, however long that lasts');
  assert.equal(page.state.input, 'SUMMARIZE');
  assert.equal(page.locked(), true);

  page.state.busy = false;
  await page.advance(1_000);
  assert.deepEqual(page.state.sent, ['SUMMARIZE']);

  await page.advance(60_000);
  assert.equal(page.state.newChats, 0, 'Send is back before Stop shows, which must not read as the summary being done');

  page.state.thinking = 'musing about it';
  agentAnswers(page, 'musing about it\nSummary: X');
  await page.advance(1_000);

  assert.equal(page.state.newChats, 1);
  assert.equal(page.state.clipboard, 'Summary: X');
  assert.equal(page.state.input, 'Summary: X');
  assert.equal(page.state.sent.length, 1, 'the summary is pasted, never sent');
  assert.equal(page.locked(), false);
  assert.equal(page.status(), '');
});

test('does not send while a tool approval card is up even though Send is showing', async () => {
  const page = loadPage();
  page.state.approval = true;
  page.state.conversation = 'earlier work';
  page.summarize();

  await page.advance(10 * 60_000);
  assert.deepEqual(page.state.sent, []);

  page.state.approval = false;
  await page.advance(1_000);
  assert.deepEqual(page.state.sent, ['SUMMARIZE']);
});

test('sends the saved instruction in the new chat before pasting the summary when auto-inject is on', async () => {
  const page = loadPage({ autoInjectInstruction: true });
  page.state.conversation = 'earlier work';
  page.summarize();
  await page.advance(1_000);
  agentAnswers(page, 'Summary: X');
  await page.advance(1_000);

  assert.equal(page.state.newChats, 1);
  assert.equal(page.state.sent.length, 2);
  assert.match(page.state.sent[1], /^\[akidevrule .+\]\n\nINSTR$/);
  assert.equal(page.state.input, '', 'the summary waits until the instruction reply ends');

  agentAnswers(page, 'instruction understood');
  await page.advance(1_000);
  assert.equal(page.state.input, 'Summary: X');
  assert.equal(page.state.sent.length, 2);
});

test('gives up after five minutes with neither Send nor Stop showing, sends nothing and frees the composer', async () => {
  const page = loadPage();
  page.state.noButtons = true;
  page.state.conversation = 'earlier work';
  page.summarize();

  await page.advance(FIVE_MINUTES_MS + 1_000);
  assert.deepEqual(page.state.sent, []);
  assert.equal(page.state.input, 'SUMMARIZE');
  assert.equal(page.locked(), false);
  assert.ok(page.logs.some((line) => line.includes('[⚡ AutoRun]') && line.includes('timed out')));
  assert.match(page.status(), /^Stopped: timed out waiting for .+\. Try again\.$/);
});

test('says the chat panel did not open and frees the composer when no chat input ever mounts', async () => {
  const page = loadPage();
  page.state.noInput = true;
  page.summarize();

  await page.advance(10_000);
  assert.deepEqual(page.state.sent, []);
  assert.equal(page.locked(), false);
  assert.match(page.status(), /^Stopped: the AI chat panel did not open\./);
});

test('pastes the summary and says copying was skipped when the clipboard write fails', async () => {
  const page = loadPage();
  page.state.clipboardFails = true;
  page.state.conversation = 'earlier work';
  page.summarize();
  await page.advance(1_000);
  agentAnswers(page, 'Summary: X');
  await page.advance(1_000);

  assert.equal(page.state.input, 'Summary: X');
  assert.equal(page.state.clipboard, null);
  assert.match(page.status(), /Copying it was skipped/);
});
