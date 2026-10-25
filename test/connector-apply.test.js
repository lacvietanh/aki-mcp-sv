#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A data dir of our own so getOrIssueAccessToken writes there, never the owner's; set before importing panel.js (docs/plan/audit-tool-drift-oct25.md D10).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'connector-apply-')));
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data', 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
const { ROUTES } = await import('../scripts/panel.js');
const { getOrIssueAccessToken } = await import('../scripts/oauth.js');

const HOME = process.env.HOME; // setup.js already pointed HOME at a fresh temp dir
const read = (p) => fs.readFileSync(path.join(HOME, p), 'utf8');

async function runTests() {
  const token = getOrIssueAccessToken();

  // Codex: first apply writes the table; a second apply replaces it in place (one table, not two); a sibling table is untouched.
  const codexPath = path.join(HOME, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(codexPath), { recursive: true });
  fs.writeFileSync(codexPath, '[other]\nkeep = true\n');
  await ROUTES['POST /api/codex-apply']();
  await ROUTES['POST /api/codex-apply']();
  const codex = read('.codex/config.toml');
  assert.equal(codex.match(/\[mcp_servers\.aki-mcp\]/g).length, 1, 'exactly one aki-mcp table after two applies');
  assert.ok(codex.includes('[other]') && codex.includes('keep = true'), 'the sibling table survives');
  assert.ok(codex.includes(`Bearer ${token}`), 'the table carries the live token');

  // Codex: a corrupt file stops with the path named, never a half-write.
  fs.writeFileSync(codexPath, 'ok = 1\n\u0000');
  await assert.rejects(async () => ROUTES['POST /api/codex-apply'](), /config\.toml/);

  // Cursor: merges aki-mcp into mcp.json, other servers untouched; invalid JSON stops with the path.
  const cursorPath = path.join(HOME, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
  await ROUTES['POST /api/cursor-apply']();
  const cursor = JSON.parse(read('.cursor/mcp.json'));
  assert.ok(cursor.mcpServers.other, 'the other server survives');
  assert.equal(cursor.mcpServers['aki-mcp'].headers.Authorization, `Bearer ${token}`);
  fs.writeFileSync(cursorPath, '{ not json');
  await assert.rejects(async () => ROUTES['POST /api/cursor-apply'](), /mcp\.json/);

  // Claude Code: a fake `claude` on PATH records its args; Apply must remove then add with -s user and the live token.
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  const argsLog = path.join(tmp, 'claude-args.log');
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\necho "$@" >> "${argsLog}"\nexit 0\n`);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
  const applied = await ROUTES['POST /api/claude-code-apply']();
  process.env.PATH = savedPath;
  assert.equal(applied.ok, true);
  const log = fs.readFileSync(argsLog, 'utf8');
  assert.match(log, /mcp remove aki-mcp -s user/, 'removes the old entry first');
  assert.match(log, /mcp add --transport http -s user aki-mcp .* --header Authorization: Bearer /, 'adds in user scope with the token');

  // Claude Code with no `claude` on PATH: a usable two-line fallback, never a bare error.
  process.env.PATH = path.join(tmp, 'empty');
  fs.mkdirSync(path.join(tmp, 'empty'));
  const noBin = await ROUTES['POST /api/claude-code-apply']();
  process.env.PATH = savedPath;
  assert.equal(noBin.ok, false);
  assert.match(noBin.message, /claude is not on PATH/);
  assert.match(noBin.message, /claude mcp remove aki-mcp -s user/);
  assert.match(noBin.message, /claude mcp add --transport http -s user aki-mcp/);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('connector-apply.test.js: ok');
}

await runTests();
