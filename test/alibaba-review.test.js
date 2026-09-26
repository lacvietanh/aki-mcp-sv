#!/usr/bin/env node
import assert from 'node:assert/strict';
import { launchAlibabaReview, ROUTES } from '../scripts/panel.js';

let call = null;
let unrefCalled = false;
const result = await launchAlibabaReview({
  claudeCmd: 'C:\\fake\\clpm.cmd',
  existsFn: () => true,
  spawnFn: (command, args, options) => {
    call = { command, args, options };
    return { pid: 4242, unref: () => { unrefCalled = true; } };
  },
});

assert.equal(result.ok, true);
assert.equal(result.launched, true);
assert.equal(result.pid, 4242);
assert.match(result.message, /Claude PM/i);
assert.equal(call.command, 'C:\\fake\\clpm.cmd');
assert.equal(call.args[0], '-p');
assert.match(call.args[1], /Alibaba Open Code Review/);
assert.equal(call.options.detached, true);
assert.equal(call.options.stdio, 'ignore');
assert.equal(unrefCalled, true);
assert.equal(typeof ROUTES['POST /api/alibaba-review'], 'function');

console.log('alibaba-review.test.js: ok');
