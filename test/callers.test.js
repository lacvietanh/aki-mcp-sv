#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { createCallers, recordCaller, listCallers } from '../scripts/callers.js';

let t = 1000;
const { recordCaller: record, listCallers: list } = createCallers({ max: 3, now: () => t });

assert.equal(record('a', 'agent-a'), true, 'first sight is new');
assert.equal(record('a', 'agent-a2'), false, 'second sight is not new');
assert.equal(list()[0].requests, 2);
assert.equal(list()[0].agent, 'agent-a2', 'latest agent wins');
assert.equal(list()[0].firstSeen, 1000);

t = 2000; record('b', 'x');
t = 3000; record('c', undefined);
assert.equal(list()[0].agent, '', 'missing user agent becomes empty');
assert.deepEqual(list().map((c) => c.key), ['c', 'b', 'a'], 'sorted by lastSeen descending');

t = 4000; record('a', 'x');
assert.equal(list()[0].key, 'a');
assert.equal(list().find((c) => c.key === 'a').firstSeen, 1000, 'firstSeen survives later hits');

t = 5000; assert.equal(record('d', 'x'), true);
assert.equal(list().length, 3, 'cap never exceeded');
assert.deepEqual(list().map((c) => c.key).sort(), ['a', 'c', 'd'], 'least recently seen (b) evicted');
t = 6000; assert.equal(record('b', 'x'), true, 'evicted key counts as new again');
assert.equal(list().length, 3);

record('long', 'y'.repeat(200));
assert.equal(list().find((c) => c.key === 'long').agent.length, 64, 'agent cut to 64 chars');

for (let i = 0; i < 200; i++) recordCaller(`k${i}`, 'x');
assert.equal(listCallers().length, 64, 'default singleton caps at 64');

console.log('callers.test.js: ok');
