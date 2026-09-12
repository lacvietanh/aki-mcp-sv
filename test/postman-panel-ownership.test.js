#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/panel-client.js', import.meta.url), 'utf8');
assert.match(source, /newWindow\.disabled = !status\.attached \|\| !status\.ownerTargetId/);
assert.match(source, /status\.attachedWindowCount/);
assert.match(source, /daemon PID /);
assert.match(source, /CDP /);
assert.match(source, /attached to /);
assert.doesNotMatch(source, /owned window/);
assert.match(source, /say\('msgPmDaemon', postmanStatusMessage\(s\), s\.attached\)/);
console.log('postman-panel-ownership.test.js: ok');
