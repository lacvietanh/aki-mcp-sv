#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import: an empty dir means the DEFAULT allowlist, never the machine owner's edited one.
process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-mcp-test-'));
process.on('exit', () => fs.rmSync(process.env.AKI_MCP_DATA_DIR, { recursive: true, force: true }));
const { Shell } = await import('../scripts/shell-mcp.js');
const { MAX_SHOWN } = await import('../scripts/output-shape.js');

async function run() {
  const shell = new Shell();

  // Shell metacharacters inside quotes are inert argv literals (execFile never spawns a shell): a quoted `|`/`$` is not rejected and tokenizes to the real bin.
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

  // Default allowlist: git's write forms are refused, read forms pass, and the refusal says why.
  const allowed = (cmd) => { const { bin, args } = shell.parse(cmd); shell.checkPermission(bin, args); };
  for (const cmd of ['git branch -a', 'git branch', 'git tag', "git tag -l 'v*'", 'git remote -v', 'git remote get-url origin', 'git status', 'git log -5']) {
    assert.doesNotThrow(() => allowed(cmd), cmd);
  }
  for (const cmd of ['git branch -D x', 'git branch newbranch', 'git tag -d v1', 'git tag v9', 'git remote set-url origin x', 'git remote add o x', 'git diff --output=/tmp/x']) {
    assert.throws(() => allowed(cmd), /write form/, cmd);
  }
  assert.throws(() => allowed('git push'), /"git" is limited to: .*status/, 'a blocked subcommand names what is allowed');
  assert.throws(() => allowed('docker ps'), /not in the allowlist.*shell\.allowlist\.added in .*setting\.json \(live on the next call\).*control panel/, 'a blocked binary says where to add it, the file first');
  assert.throws(() => allowed('git tag -f 3.0.0 HEAD'), /write form.*bare "git" to shell\.allowlist\.added in .*setting\.json/, 'a git write form says how to allow it');

  // Bare "git" added to setting.json allows every write form on the next call, no restart, even listed twice beside the default git entry.
  const settingsPath = path.join(process.env.AKI_MCP_DATA_DIR, 'setting.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ shell: { allowlist: { added: ['git', 'rm', 'git'], revoked: [] } } }));
  for (const cmd of ['git tag -f 3.0.0 HEAD', 'git tag -d v1', 'git push', 'git branch -D x']) {
    assert.doesNotThrow(() => allowed(cmd), cmd);
  }
  fs.rmSync(settingsPath);
  assert.throws(() => allowed('git tag -f 3.0.0 HEAD'), /write form/, 'removing the entry restores the read-only default');

  // A failing command returns what it printed AND why it failed; a passing one returns stdout only.
  const node = (code) => shell.run(process.execPath, ['-e', code], process.cwd());
  const failed = await node('console.log("OUT-LINE");console.error("ERR-LINE");process.exit(3)');
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, '[exit code 3]\nOUT-LINE\nERR-LINE', 'stdout, stderr and exit code all survive');
  const silent = await node('process.exit(1)');
  assert.equal(silent.content[0].text, '[exit code 1]', 'no output still says why');
  const passed = await node('console.log("fine");console.error("warn")');
  assert.equal(passed.isError, undefined);
  assert.equal(passed.content[0].text, 'fine\n');
  assert.equal((await node('')).content[0].text, '(no output)');
  const floodLines = Math.ceil(MAX_SHOWN / 36);
  const flood = await node(`for (let i=0;i<${floodLines};i++) console.log("line "+i+" "+"z".repeat(30))`);
  assert.match(flood.content[0].text.split('\n')[0], /^\[output cut: /, 'a flood is cut and announced on line 1');

  const missing = await shell.run('aki-no-such-binary-xyz', [], process.cwd());
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /^\["aki-no-such-binary-xyz" is not an executable on PATH \(on Windows: grep, tail and the other Unix tools come with Git for Windows/, 'a binary that is not there says so, with the Windows cause');

  // Windows rules, driven here through the platform argument: Git's usr/bin joins PATH once, at the end, and only when it exists.
  const { extendPath, launchOf } = await import('../scripts/find-on-path.js');
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-for-windows-'));
  for (const dir of ['cmd', 'usr/bin']) fs.mkdirSync(path.join(gitRoot, dir), { recursive: true });
  for (const name of ['git', 'git.exe']) fs.writeFileSync(path.join(gitRoot, 'cmd', name), '', { mode: 0o755 });
  const env = { PATH: ['/nowhere', path.join(gitRoot, 'cmd')].join(path.delimiter) };
  assert.deepEqual(extendPath(env, 'win32'), [path.join(gitRoot, 'usr', 'bin')]);
  assert.equal(env.PATH.split(path.delimiter).at(-1), path.join(gitRoot, 'usr', 'bin'), 'appended, so names that already resolve keep their program');
  assert.deepEqual(extendPath(env, 'win32'), [], 'a second call adds nothing');
  assert.deepEqual(extendPath({ PATH: '/nowhere' }, 'win32'), [], 'no Git for Windows, nothing added');
  assert.deepEqual(extendPath({ ...env }, 'linux'), [], 'other platforms add nothing');
  assert.deepEqual(launchOf('git', ['status'], 'win32'), ['git', ['status']], 'a real executable starts as itself');
  fs.rmSync(gitRoot, { recursive: true, force: true });

  console.log('shell-mcp.test.js: ok');
}

await run();
