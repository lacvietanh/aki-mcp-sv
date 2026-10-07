#!/usr/bin/env node
// Interim guard: regexes over panel-client.js source text, kept until a vm harness can run its functions; the doesNotMatch pins a removed label whose reason is unrecorded, so it is not dropped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../public/panel-client.js', import.meta.url), 'utf8');
assert.match(source, /newWindow\.disabled = !status\.attached \|\| !status\.ownerTargetId/);
assert.match(source, /status\.attachedPageCount/);
assert.match(source, /daemon PID /);
assert.match(source, /CDP /);
assert.match(source, /attached to /);
assert.doesNotMatch(source, /owned window/);
assert.match(source, /say\('msgPmDaemon', postmanStatusMessage\(s\), s\.attached\)/);
console.log('postman-panel-ownership.test.js: ok');
