#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Stands in for the claude CLI: logs its args and edits ~/.claude.json the way `mcp add` and `mcp remove` do (user scope, or the project it runs in for local scope).
const fakeClaudeSource = (log) => `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('0.0.0'); process.exit(0); }
const cwd = fs.realpathSync(process.cwd());
fs.appendFileSync(${JSON.stringify(log)}, cwd + ' ' + argv.join(' ') + '\\n');
const file = path.join(process.env.CLAUDE_CONFIG_DIR || process.env.HOME, '.claude.json');
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const scopeAt = argv.indexOf('-s') + 1;
const holder = argv[scopeAt] === 'local' ? ((config.projects ??= {})[cwd] ??= {}) : config;
holder.mcpServers ??= {};
if (argv[1] === 'remove') delete holder.mcpServers[argv[2]];
else holder.mcpServers[argv[scopeAt + 1]] = { type: 'http', url: argv[scopeAt + 2] };
fs.writeFileSync(file, JSON.stringify(config));
`;

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
  fs.writeFileSync(codexPath, '[other]\nkeep = true\n\n[mcp_servers."aki-mcp"] # old\nurl = "http://127.0.0.1:9999/mcp"\n\n[mcp_servers.aki-mcp.http_headers]\nAuthorization = "Bearer old"\n\n[tail]\nz = 1\n');
  fs.chmodSync(codexPath, 0o644);
  await ROUTES['POST /api/codex-apply']();
  const swept = read('.codex/config.toml');
  assert.equal(swept.match(/^\[mcp_servers\./gm).length, 1, 'the quoted table and its subtable are gone, one table written');
  assert.ok(!swept.includes('aki-mcp') && swept.includes('[mcp_servers.akimcp]'), 'only the akimcp table remains');
  assert.doesNotMatch(swept, /\n\n\n/, 'removing the retired table leaves no blank-line residue');
  assert.ok(!swept.includes('Bearer old') && swept.includes('[other]') && swept.includes('[tail]'), 'old subtable dropped, siblings kept');
  if (process.platform !== 'win32') assert.equal(fs.statSync(codexPath).mode & 0o777, 0o600, 'a token file is not world-readable');

  // Codex: a literal-quoted key is the same table, and an array row inside it does not end it.
  fs.writeFileSync(codexPath, "[other]\nkeep = true\n\n[mcp_servers.'aki-mcp']\nurl = \"http://127.0.0.1:9999/mcp\"\nargs = [\n  [1, 2],\n  [3, 4]\n]\n\n[tail]\nz = 1\n");
  await ROUTES['POST /api/codex-apply']();
  const literal = read('.codex/config.toml');
  assert.equal(literal.match(/^\[mcp_servers\./gm).length, 1, 'the literal-key table is replaced, not duplicated');
  assert.ok(!literal.includes('[3, 4]') && literal.includes('[tail]'), 'the whole old table goes, the next one stays');

  // Codex: a table whose quoted key holds a path (Codex's own per-project trust tables) ends the retired aki-mcp table and survives.
  fs.writeFileSync(codexPath, '[mcp_servers.aki-mcp]\nurl = "http://127.0.0.1:9999/mcp"\n\n[projects."/Users/me/repo"]\ntrust_level = "trusted"\n\n[projects.\'C:\\code\']\ntrust_level = "trusted"\n');
  await ROUTES['POST /api/codex-apply']();
  const trusted = read('.codex/config.toml');
  assert.ok(trusted.includes('[projects."/Users/me/repo"]') && trusted.includes("[projects.'C:\\code']"), 'both trust tables survive');
  assert.equal(trusted.match(/trust_level = "trusted"/g).length, 2, 'their keys survive with them');

  // Codex: a retired table in the middle goes without leaving a gap behind, whichever table follows it.
  fs.writeFileSync(codexPath, '[head]\na = 1\n\n[mcp_servers.aki-mcp]\nurl = "http://127.0.0.1:9999/mcp"\n\n[mcp_servers.aki-mcp.http_headers]\nk = "v"\n\n[tail]\nz = 1\n');
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
  fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { other: { url: 'x' }, 'aki-mcp': { url: 'http://127.0.0.1:9999/mcp' } } }));
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
  fs.writeFileSync(path.join(binDir, 'claude'), fakeClaudeSource(argsLog), { mode: 0o755 });
  // A local-scope entry (what the pre-3.1 snippet made, no -s) wins over user scope, so Apply removes it inside its own project; a project folder that is gone is skipped.
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config');
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR);
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ mcpServers: { 'aki-mcp': { type: 'http', url: 'http://127.0.0.1:9999/mcp' } }, projects: { [project]: { mcpServers: { 'aki-mcp': { type: 'http', url: 'http://127.0.0.1:9999/mcp' } } }, [path.join(tmp, 'gone')]: { mcpServers: { 'aki-mcp': {} } }, [tmp]: { mcpServers: { other: {}, akimcp: {} } } } }));
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

const ROUTE_OF = { claude: 'POST /api/claude-code-apply', codex: 'POST /api/codex-apply', cursor: 'POST /api/cursor-apply', agy: 'POST /api/agy-apply-mcp' };
const CLIENT_NAME = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', agy: 'AGY' };
const STDIO_JS = path.join(repoRoot, 'scripts', 'stdio.js');
const OURS = { url: 'http://127.0.0.1:9999/mcp', agy: { command: 'node', args: [STDIO_JS] } };
const GITHUB = { url: 'https://github.example/mcp', agy: { command: 'npx', args: ['github-mcp'] }, agyText: 'npx github-mcp' };
const OTHER_MACHINE = { url: 'https://other.example/mcp', agy: { command: 'node', args: ['/other/machine/scripts/stdio.js'] }, agyText: 'node /other/machine/scripts/stdio.js' };

// The identity is read once per process, so each Apply runs in a child that reads this world's setting.json at import.
const CHILD = `const { ROUTES } = await import(process.env.PANEL_URL);
const results = {};
for (const [client, route] of Object.entries(JSON.parse(process.env.ROUTES))) results[client] = await ROUTES[route]().catch((error) => ({ error: error.message }));
process.stdout.write('RESULT ' + JSON.stringify(results) + '\\n', () => process.exit(0));`;

function makeWorld() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'connector-world-')));
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  for (const dir of [home, data, bin]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(bin, 'claude'), fakeClaudeSource(path.join(root, 'claude-args.log')), { mode: 0o755 });
  const settingsFile = path.join(data, 'setting.json');
  const readText = (rel) => (fs.existsSync(path.join(home, rel)) ? fs.readFileSync(path.join(home, rel), 'utf8') : '');
  const readJson = (rel) => JSON.parse(readText(rel) || '{}');
  const writeText = (rel, text) => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), text); };
  const editJson = (rel, edit) => { const json = readJson(rel); edit(json); writeText(rel, JSON.stringify(json)); };
  const savedSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : { folders: [root] });
  return {
    savedSettings,
    settings: (patch) => fs.writeFileSync(settingsFile, JSON.stringify({ ...savedSettings(), ...patch })),
    seed(key, target) {
      editJson('.claude.json', (json) => { json.mcpServers = { ...json.mcpServers, [key]: { type: 'http', url: target.url } }; });
      editJson('.cursor/mcp.json', (json) => { json.mcpServers = { ...json.mcpServers, [key]: { url: target.url } }; });
      editJson('.gemini/config/mcp_config.json', (json) => { json.mcpServers = { ...json.mcpServers, [key]: target.agy }; });
      writeText('.codex/config.toml', `${readText('.codex/config.toml')}[mcp_servers.${key}]\nurl = "${target.url}"\n\n`);
    },
    entryOf: (client, key) => ({
      claude: () => readJson('.claude.json').mcpServers?.[key],
      cursor: () => readJson('.cursor/mcp.json').mcpServers?.[key],
      agy: () => readJson('.gemini/config/mcp_config.json').mcpServers?.[key],
      codex: () => { const found = new RegExp(`\\[mcp_servers\\.${key}\\]\\nurl = "([^"]*)"`).exec(readText('.codex/config.toml')); return found ? { url: found[1] } : undefined; },
    })[client](),
    files: () => ['.claude.json', '.cursor/mcp.json', '.gemini/config/mcp_config.json', '.codex/config.toml'].map(readText),
    apply() {
      const { CLAUDE_CONFIG_DIR, ...env } = process.env;
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...env, HOME: home, USERPROFILE: home, AKI_MCP_DATA_DIR: data, PATH: `${bin}${path.delimiter}${env.PATH}`, PANEL_URL: pathToFileURL(path.join(repoRoot, 'scripts', 'panel.js')).href, ROUTES: JSON.stringify(ROUTE_OF) },
      });
      const line = run.stdout.split('\n').find((text) => text.startsWith('RESULT '));
      assert.ok(line, `Apply printed no result (exit ${run.status}): ${run.stderr}`);
      return JSON.parse(line.slice('RESULT '.length));
    },
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function inWorld(body) {
  const world = makeWorld();
  try {
    return body(world);
  } finally {
    world.remove();
  }
}

const targetOf = (client, target) => (client === 'agy' ? target.agyText : target.url);

test('A then B then C leaves no client holding A or B, and a foreign server beside them is untouched', () => inWorld((world) => {
  world.seed('akimcp', OURS);
  world.seed('github', GITHUB);
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    world.settings({ identity: { name } });
    const results = world.apply();
    for (const client of Object.keys(ROUTE_OF)) assert.equal(results[client].error, undefined, `${client} applied under ${name}`);
  }
  for (const client of Object.keys(ROUTE_OF)) {
    for (const gone of ['akimcp', 'alpha', 'bravo']) assert.equal(world.entryOf(client, gone), undefined, `${client} still holds ${gone}`);
    assert.ok(world.entryOf(client, 'charlie'), `${client} holds charlie`);
    assert.ok(world.entryOf(client, 'github'), `${client} keeps github`);
  }
  assert.deepEqual(world.savedSettings().applied.keys, ['aki-mcp', 'akimcp', 'alpha', 'bravo', 'charlie']);
}));

test('a foreign github entry is never removed or overwritten, even with github in applied.keys', () => inWorld((world) => {
  world.seed('github', GITHUB);
  world.settings({ identity: { name: 'Work' }, applied: { keys: ['aki-mcp', 'akimcp', 'github'] } });
  const results = world.apply();
  for (const client of Object.keys(ROUTE_OF)) {
    assert.deepEqual(world.entryOf(client, 'github'), client === 'agy' ? GITHUB.agy : client === 'claude' ? { type: 'http', url: GITHUB.url } : { url: GITHUB.url }, `${client} github entry unchanged`);
    assert.ok(world.entryOf(client, 'work'), `${client} holds work`);
    assert.ok(results[client].message.includes(`Kept github in ${CLIENT_NAME[client]}: it points at ${targetOf(client, GITHUB)}, not at this AkiMCP.`), `${client}: ${results[client].message}`);
  }
}));

test('an akimcp entry pointing at another machine survives and Apply says it kept it', () => inWorld((world) => {
  world.seed('akimcp', OTHER_MACHINE);
  world.settings({ identity: { name: 'Work' } });
  const results = world.apply();
  for (const client of Object.keys(ROUTE_OF)) {
    assert.ok(world.entryOf(client, 'akimcp'), `${client} keeps akimcp`);
    assert.ok(world.entryOf(client, 'work'), `${client} holds work`);
    assert.ok(results[client].message.includes(`Kept akimcp in ${CLIENT_NAME[client]}: it points at ${targetOf(client, OTHER_MACHINE)}, not at this AkiMCP.`), `${client}: ${results[client].message}`);
  }
}));

test('Server ID github over a foreign github entry is refused in every client, naming it, and nothing is written', () => inWorld((world) => {
  world.seed('github', GITHUB);
  world.settings({ identity: { name: 'Work', key: 'github', prefix: 'work__' } });
  const before = world.files();
  const results = world.apply();
  for (const client of Object.keys(ROUTE_OF)) {
    assert.equal(results[client].error, `Apply stopped: ${CLIENT_NAME[client]} already has a server named github that points at ${targetOf(client, GITHUB)}, not at this AkiMCP. Pick another Server ID, or remove that entry in ${CLIENT_NAME[client]} yourself.`);
  }
  assert.deepEqual(world.files(), before);
  assert.equal(world.savedSettings().applied, undefined, 'a refused Apply records no key');
}));

test('Apply is refused while setting.json holds an invalid identity, and nothing is written', () => inWorld((world) => {
  world.settings({ identity: { key: 'my.tools' } });
  const results = world.apply();
  for (const client of Object.keys(ROUTE_OF)) {
    assert.equal(results[client].error, 'Apply stopped: Server ID "my.tools" in setting.json is not valid, so AkiMCP is serving the default names. Fix it above or press Reset to AkiMCP, then Apply again.');
  }
  assert.deepEqual(world.files(), ['', '', '', '']);
  assert.equal(world.savedSettings().applied, undefined);
}));
