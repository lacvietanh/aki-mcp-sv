#!/usr/bin/env node
import '../../../test/setup.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../public/panel-client.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderPostmanState(');
const end = source.indexOf('// Snippets and the token field', start);
assert.ok(start > 0 && end > start, 'Postman daemon panel functions exist');

const els = {
  pmDaemonDot: {},
  pmBtnLaunch: { hidden: false },
  pmBtnQuit: { hidden: true },
  pmBtnNewWindow: { hidden: true, disabled: true },
};
let currentStatus = null;
const said = [];
const sandbox = {
  document: { getElementById: (id) => els[id] },
  setDot: () => {},
  api: async () => currentStatus,
  say: (id, msg, ok) => said.push({ id, msg, ok }),
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.__pm = { renderPostmanState, postmanStatusMessage, loadPostmanDaemon };', sandbox);
const { renderPostmanState, postmanStatusMessage, loadPostmanDaemon } = sandbox.__pm;

currentStatus = { running: true, attached: true, ownerTargetId: 'target-1', mode: 'auto', attachedPageCount: 2, daemonPid: 4242, endpoint: { host: '127.0.0.1', port: 9222 } };
await loadPostmanDaemon();
assert.equal(els.pmBtnNewWindow.disabled, false, 'New Window enabled when attached with ownerTargetId');
assert.equal(els.pmBtnLaunch.hidden, true);
assert.equal(els.pmBtnQuit.hidden, false);
assert.deepEqual(said.at(-1), {
  id: 'msgPmDaemon',
  msg: 'auto · attached to 2 Postman windows · daemon PID 4242 · CDP 127.0.0.1:9222',
  ok: true,
});
assert.doesNotMatch(said.at(-1).msg, /owned window/);

renderPostmanState({ running: true, attached: true, ownerTargetId: null });
assert.equal(els.pmBtnNewWindow.disabled, true, 'New Window disabled without ownerTargetId');
renderPostmanState({ running: true, attached: false, ownerTargetId: 'target-1' });
assert.equal(els.pmBtnNewWindow.disabled, true, 'New Window disabled when detached');
assert.match(postmanStatusMessage({ running: true, attached: false, daemonPid: 99 }), /waiting for a Postman window · daemon PID 99/);
assert.match(postmanStatusMessage({ running: false }), /not running/);

console.log('postman-panel-ownership.test.js: ok');
