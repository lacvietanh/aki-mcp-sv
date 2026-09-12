#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Shell } from '../scripts/shell-mcp.js';

async function run() {
  const shell = new Shell();

  // Fix 2: shell metacharacters INSIDE quotes are inert argv literals (execFile never spawns a shell), so a quoted `|`/`$` must NOT be rejected and must tokenize to the real bin.
  const parsed = shell.parse("grep -E '^(name|description):' file");
  assert.equal(parsed.bin, 'grep', 'quoted metacharacters must not block the grep command');
  assert.deepEqual(
    parsed.args,
    ['-E', '^(name|description):', 'file'],
    'quotes must be stripped, leaving the pattern as one argv literal',
  );

  // A quoted trailing `$` is likewise inert.
  assert.doesNotThrow(
    () => shell.parse("grep -E 'foo$' file"),
    'a quoted $ must not be rejected',
  );

  // The guard still holds for metacharacters OUTSIDE quotes: real chaining/redirection is rejected.
  assert.throws(
    () => shell.parse('a | b'),
    /chaining\/redirection/,
    'an unquoted pipe must still be rejected',
  );
  assert.throws(
    () => shell.parse('echo $HOME'),
    /chaining\/redirection/,
    'an unquoted $ must still be rejected',
  );

  console.log('shell-mcp.test.js: ok');
}

run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
