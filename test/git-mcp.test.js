#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePorcelainStatus } from '../scripts/git-mcp.js';
import { createToolsServer } from '../scripts/tools-server.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  // Test server registration
  const server = createToolsServer();
  assert.ok(server);

  console.log('git-mcp.test.js: ok');
}

await testGitMcp();
