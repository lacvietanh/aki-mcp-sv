#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// userdata.js reads AKI_MCP_DATA_DIR at import: a temp data dir whose only allowed folder is a temp repo, so the machine owner's settings and repos are never touched.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-mcp-test-')));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data', 'setting.json'), JSON.stringify({ folders: [repo] }));
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
const { parsePorcelainStatus, capDiffByFile } = await import('../scripts/git-mcp.js');
const { createToolsServer } = await import('../scripts/tools-server.js');

async function testGitMcp() {
  // Test parsing porcelain output
  const sampleOutput = `## main...origin/main [ahead 1]
 M package.json
M  scripts/start.js
?? new-file.txt
`;
  const parsed = parsePorcelainStatus(sampleOutput);
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.tracking, 'origin/main [ahead 1]');
  assert.equal(parsed.clean, false);
  assert.equal(parsed.staged.length, 1);
  assert.equal(parsed.staged[0].file, 'scripts/start.js');
  assert.equal(parsed.unstaged.length, 1);
  assert.equal(parsed.unstaged[0].file, 'package.json');
  assert.equal(parsed.untracked.length, 1);
  assert.equal(parsed.untracked[0], 'new-file.txt');

  // Test clean status parsing
  const cleanParsed = parsePorcelainStatus('## master...origin/master\n');
  assert.equal(cleanParsed.branch, 'master');
  assert.equal(cleanParsed.clean, true);
  assert.equal(cleanParsed.staged.length, 0);

  // A big diff shows whole files, names the omitted ones first with their size, and never cuts a file's header away.
  const fileChunk = (name, n) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n` + Array.from({ length: n }, (_, i) => `+added ${i}`).join('\n') + '\n';
  const big = fileChunk('one.txt', 1200) + fileChunk('two.txt', 900) + fileChunk('three.txt', 5);
  const capped = capDiffByFile(big, 15_000);
  assert.match(capped.split('\n')[0], /^\[diff: 2 of 3 files shown\. Omitted, ask again with file=<path>: two\.txt \(\+900 -0\)\]$/);
  assert.ok(capped.includes('diff --git a/three.txt'), 'a later small file still fits after a big one is skipped');
  assert.ok(capped.includes('diff --git a/one.txt b/one.txt'));
  assert.ok(!capped.includes('diff --git a/two.txt'));
  assert.equal(capDiffByFile(fileChunk('s.txt', 3), 15_000), fileChunk('s.txt', 3), 'a small diff is returned unchanged');

  // The tool end to end, against a real temp repo with one commit, two tags, and a bare "remote" holding the same tags.
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  git('tag', 'v1');
  git('tag', 'v2');
  const bare = path.join(tmp, 'bare.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git('remote', 'add', 'origin', bare);
  git('push', '-q', 'origin', 'main', '--tags');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createToolsServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const call = async (args) => {
    const result = await client.callTool({ name: 'aki__git', arguments: { repoPath: repo, ...args } });
    return { isError: !!result.isError, text: result.content[0].text };
  };

  const status = JSON.parse((await call({ op: 'status' })).text);
  assert.equal(status.branch, 'main');
  assert.deepEqual(status.unstaged.map((f) => f.file), ['a.txt']);
  assert.deepEqual(status.untracked, ['b.txt']);

  assert.match((await call({ op: 'diff' })).text, /^diff --git a\/a\.txt/);
  assert.equal((await call({ op: 'diff', staged: true })).text, 'No staged changes.');
  assert.equal(JSON.parse((await call({ op: 'log', limit: 1 })).text)[0].message, 'first');

  assert.equal((await call({ op: 'tags' })).text.split('\n').length, 2, 'local tags');
  const remoteTags = await call({ op: 'tags', remote: 'origin' });
  assert.match(remoteTags.text, /refs\/tags\/v1/);
  assert.match(remoteTags.text, /refs\/tags\/v2/);

  // A URL (or anything that is not a bare remote name) must be refused before git runs: ext:: / --upload-pack= smuggle code execution.
  for (const remote of ['https://example.com/x.git', 'ext::sh -c id', '--upload-pack=id', '../bare.git']) {
    const refused = await call({ op: 'tags', remote });
    assert.ok(refused.isError && /configured remote name/.test(refused.text), remote);
  }
  assert.ok((await call({ op: 'status', repoPath: os.tmpdir() })).isError, 'a path outside the allowed folders is refused');

  console.log('git-mcp.test.js: ok');
}

await testGitMcp();
fs.rmSync(tmp, { recursive: true, force: true });
