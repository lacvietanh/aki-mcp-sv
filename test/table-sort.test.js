#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The comparator is a classic browser script, so it is loaded the way a page would: into a bare context, no module exports.
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/table-sort.js', import.meta.url), 'utf8'), sandbox);
const sorted = (values, dir) => [...values].sort((a, b) => sandbox.compareTableValues(a, b, dir));

assert.deepEqual(sorted([3, null, 1, '', 2], 'asc'), [1, 2, 3, null, ''], 'nil sinks to the bottom ascending');
assert.deepEqual(sorted([3, null, 1, '', 2], 'desc'), [3, 2, 1, null, ''], 'nil sinks to the bottom descending too');
for (const dir of ['asc', 'desc']) {
  assert.ok(sandbox.compareTableValues(undefined, 1, dir) > 0 && sandbox.compareTableValues(1, undefined, dir) < 0, `undefined is nil, ${dir}`);
  assert.equal(sandbox.compareTableValues(null, '', dir), 0, `two nils tie, ${dir}`);
}
assert.deepEqual(sorted([2, 0, 1, null], 'asc'), [0, 1, 2, null], '0 is a real value, not nil');
assert.deepEqual(sorted([2, 0, 1, null], 'desc'), [2, 1, 0, null]);
assert.deepEqual(sorted(['10', '9', '100'], 'asc'), ['9', '10', '100'], 'numeric strings compare as numbers');
assert.deepEqual(sorted([10, '9'], 'asc'), ['9', 10], 'a number and a numeric string compare as numbers');
assert.deepEqual(sorted(['banana', 'Apple', 'cherry'], 'asc'), ['Apple', 'banana', 'cherry'], 'text compares case-insensitively');
assert.deepEqual(sorted(['file10', 'file2'], 'asc'), ['file2', 'file10'], 'digits inside text compare numerically');
assert.deepEqual(sorted(['abc', 5], 'asc'), [5, 'abc'], 'a number sorts before text');
assert.deepEqual(sorted(['abc', 'abd'], 'desc'), ['abd', 'abc']);

console.log('table-sort.test.js: ok');
