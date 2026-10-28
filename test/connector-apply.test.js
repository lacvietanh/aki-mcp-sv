#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A data dir of our own so getOrIssueAccessToken writes there, never the owner's; set before importing panel.js (docs/plan/done/audit-tool-drift-oct25.md D10).
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
  assert.equal(codex.match(/\[mcp_servers\.akimcp\]/g).length, 1, 'exactly one akimcp table after two applies');
  assert.ok(codex.includes('[other]') && codex.includes('keep = true'), 'the sibling table survives');
  assert.ok(codex.includes(`Bearer ${token}`), 'the table carries the live token');

  // Codex: the retired aki-mcp key (quoted, commented, with a subtable) is removed whole; the written file is owner-only.
  fs.writeFileSync(codexPath, '[other]\nkeep = true\n\n[mcp_servers."aki-mcp"] # old\nurl = "x"\n\n[mcp_servers.aki-mcp.http_headers]\nAuthorization = "Bearer old"\n\n[tail]\nz = 1\n');
  fs.chmodSync(codexPath, 0o644);
  await ROUTES['POST /api/codex-apply']();
  const swept = read('.codex/config.toml');
  assert.equal(swept.match(/^\[mcp_servers\./gm).length, 1, 'the quoted table and its subtable are gone, one table written');
  assert.ok(!swept.includes('aki-mcp') && swept.includes('[mcp_servers.akimcp]'), 'only the akimcp table remains');
  assert.doesNotMatch(swept, /\n\n\n/, 'removing the retired table leaves no blank-line residue');
  assert.ok(!swept.includes('Bearer old') && swept.includes('[other]') && swept.includes('[tail]'), 'old subtable dropped, siblings kept');
  if (process.platform !== 'win32') assert.equal(fs.statSync(codexPath).mode & 0o777, 0o600, 'a token file is not world-readable');

  // Codex: a literal-quoted key is the same table, and an array row inside it does not end it.
  fs.writeFileSync(codexPath, "[other]\nkeep = true\n\n[mcp_servers.'aki-mcp']\nargs = [\n  [1, 2],\n  [3, 4]\n]\n\n[tail]\nz = 1\n");
  await ROUTES['POST /api/codex-apply']();
  const literal = read('.codex/config.toml');
  assert.equal(literal.match(/^\[mcp_servers\./gm).length, 1, 'the literal-key table is replaced, not duplicated');
  assert.ok(!literal.includes('[3, 4]') && literal.includes('[tail]'), 'the whole old table goes, the next one stays');

  // Codex: a table whose quoted key holds a path (Codex's own per-project trust tables) ends the retired aki-mcp table and survives.
  fs.writeFileSync(codexPath, '[mcp_servers.aki-mcp]\nurl = "x"\n\n[projects."/Users/me/repo"]\ntrust_level = "trusted"\n\n[projects.\'C:\\code\']\ntrust_level = "trusted"\n');
  await ROUTES['POST /api/codex-apply']();
  const trusted = read('.codex/config.toml');
  assert.ok(trusted.includes('[projects."/Users/me/repo"]') && trusted.includes("[projects.'C:\\code']"), 'both trust tables survive');
  assert.equal(trusted.match(/trust_level = "trusted"/g).length, 2, 'their keys survive with them');

  // Codex: a retired table in the middle goes without leaving a gap behind, whichever table follows it.
  fs.writeFileSync(codexPath, '[head]\na = 1\n\n[mcp_servers.aki-mcp]\nurl = "x"\n\n[mcp_servers.aki-mcp.http_headers]\nk = "v"\n\n[tail]\nz = 1\n');
  await ROUTES['POST /api/codex-apply']();
  const middle = read('.codex/config.toml');
  assert.ok(middle.startsWith('[head]\na = 1\n\n[tail]\nz = 1\n\n[mcp_servers.akimcp]\n'), 'siblings stay joined by one blank line');
  assert.doesNotMatch(middle, /\n\n\n/);

  // Codex: a corrupt file stops with the path named, never a half-write.
  fs.writeFileSync(codexPath, 'ok = 1\n\u0000');
  await assert.rejects(async () => ROUTES['POST /api/codex-apply'](), /config\.toml/);

  // Cursor: merges akimcp into mcp.json and deletes the retired aki-mcp key, other servers untouched; invalid JSON stops with the path.
  const cursorPath = path.join(HOME, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { other: { url: 'x' }, 'aki-mcp': { url: 'old' } } }));
  await ROUTES['POST /api/cursor-apply']();
  const cursor = JSON.parse(read('.cursor/mcp.json'));
  assert.ok(cursor.mcpServers.other, 'the other server survives');
  assert.equal(cursor.mcpServers.akimcp.headers.Authorization, `Bearer ${token}`);
  assert.equal(cursor.mcpServers['aki-mcp'], undefined, 'the retired key is deleted');
  fs.writeFileSync(cursorPath, '{ not json');
  await assert.rejects(async () => ROUTES['POST /api/cursor-apply'](), /mcp\.json/);

  // Claude Code: a fake `claude` on PATH records its args; Apply must remove then add with -s user and the live token.
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  const argsLog = path.join(tmp, 'claude-args.log');
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\necho "$(pwd -P) $@" >> "${argsLog}"\nexit 0\n`);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);
  // A local-scope entry (what the pre-3.1 snippet made, no -s) wins over user scope, so Apply removes it inside its own project; a project folder that is gone is skipped.
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config');
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR);
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ projects: { [project]: { mcpServers: { 'aki-mcp': { type: 'http' } } }, [path.join(tmp, 'gone')]: { mcpServers: { 'aki-mcp': {} } }, [tmp]: { mcpServers: { other: {}, akimcp: {} } } } }));
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
  const applied = await ROUTES['POST /api/claude-code-apply']();
  process.env.PATH = savedPath;
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.equal(applied.ok, true);
  const log = fs.readFileSync(argsLog, 'utf8');
  assert.match(log, /mcp remove akimcp -s user/, 'removes the current key first');
  assert.match(log, /mcp remove aki-mcp -s user/, 'removes the retired key too');
  assert.match(log, /mcp add --transport http -s user akimcp .* --header Authorization: Bearer /, 'adds in user scope with the token');
  assert.equal(log.match(/-s local/g)?.length, 1, 'one retired local entry removed; the gone folder, the other server and an akimcp project entry left alone');
  assert.ok(log.includes(`${project} mcp remove aki-mcp -s local`), 'the local entry is removed from inside its project');
  assert.match(applied.message, /1 project/, 'the message says a project-only entry was removed');

  // Claude Code with no `claude` on PATH: a usable two-line fallback, never a bare error.
  process.env.PATH = path.join(tmp, 'empty');
  fs.mkdirSync(path.join(tmp, 'empty'));
  const noBin = await ROUTES['POST /api/claude-code-apply']();
  process.env.PATH = savedPath;
  assert.equal(noBin.ok, false);
  assert.match(noBin.message, /claude is not on PATH/);
  assert.match(noBin.message, /claude mcp remove akimcp -s user/);
  assert.match(noBin.message, /claude mcp add --transport http -s user akimcp/);
  assert.doesNotMatch(noBin.message, /aki-mcp/, 'a pasted snippet never carries the legacy removal');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('connector-apply.test.js: ok');
}

await runTests();
