#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { esc } from '../scripts/html.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const href = (name) => pathToFileURL(path.join(repoRoot, 'scripts', name)).href;

// The identity is read once per process, so each world is a child that reads its own setting.json at import: a job is a route call, the rendered page, or the identity the process serves.
const CHILD = `const { ROUTES } = await import(process.env.PANEL_URL);
const { renderPanel } = await import(process.env.PAGE_URL);
const { IDENTITY } = await import(process.env.NAME_URL);
const out = [];
for (const job of JSON.parse(process.env.JOBS)) {
  if (job.page) out.push(renderPanel({ origin: 'http://127.0.0.1:19999', client: 'test', passphrase: 'p', token: 't', accessToken: 'a', repoRoot: process.cwd(), rulesDir: '/rules', userDir: process.env.AKI_MCP_DATA_DIR, isDev: true }));
  else if (job.serving) out.push(IDENTITY);
  else out.push(await ROUTES[job.route](job.body).catch((error) => ({ error: error.message })));
}
process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));`;

function inWorld(settings, body) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-world-')));
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(root, 'home'));
  fs.mkdirSync(data);
  const file = path.join(data, 'setting.json');
  fs.writeFileSync(file, JSON.stringify({ folders: [root], ...settings }));
  const world = {
    saved: () => JSON.parse(fs.readFileSync(file, 'utf8')),
    run(jobs) {
      const { CLAUDE_CONFIG_DIR, ...env } = process.env;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), AKI_MCP_DATA_DIR: data, PANEL_URL: href('panel.js'), PAGE_URL: href('config-page.js'), NAME_URL: href('mcp-name.js'), JOBS: JSON.stringify(jobs) },
      });
      const line = child.stdout.split('\n').find((text) => text.startsWith('RESULT '));
      assert.ok(line, `the child printed no result (exit ${child.status}): ${child.stderr}`);
      return JSON.parse(line.slice('RESULT '.length));
    },
  };
  try {
    return body(world);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const PREVIEW = 'POST /api/identity-preview';
const preview = (body) => ({ route: PREVIEW, body });
const page = { page: true };

test('a Display name that closes the script tag serves AkiMCP in the script block, and the red row shows the refused value as text', () => inWorld({ identity: { name: '</script><script>alert(1)</script>' } }, (world) => {
  const [html] = world.run([page]);
  assert.ok(html.includes('const MCP_NAME = "AkiMCP";'), 'the script block gets the default name');
  assert.ok(!html.includes('<script>alert(1)'), 'the refused value never becomes markup');
  assert.ok(html.includes('Display name &quot;&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot; in setting.json is not valid'), 'the red row quotes the value as escaped text');
  assert.ok(html.includes('AkiMCP is serving the default names until you fix it.'));
  assert.ok(html.includes('data-act="resetIdentityNow">Reset to AkiMCP</button>'));
}));

test('a default user sees the field, the derived rows and S7a, with nothing to save or reset', () => inWorld({}, (world) => {
  const [html] = world.run([page]);
  for (const text of ['<label for="idName">Display name</label>', 'The name AI clients list this server as. The Server ID and Tool prefix below are made from it as you type; to set either one yourself, open Customize fields.', '<span class="mono">akimcp</span>', '<span class="mono">aki__</span>', '<span class="mono">aki__run_cmd</span>', 'Serving now: AkiMCP · Server ID akimcp · tools aki__*']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('id="idSave" data-act="saveIdentity" disabled>Save name</button>'));
  assert.ok(html.includes('id="idReset" data-act="resetIdentityFields" hidden>Reset to AkiMCP</button>'));
  assert.ok(!html.includes('MCP Name'), 'the read-only row is gone');
  assert.ok(!html.includes('msg err">Display name'), 'no red row');
}));

test('an empty Tool prefix drops the prefix words from the paste-in instruction and the other-computer note', () => inWorld({ identity: { name: 'Work', prefix: '' } }, (world) => {
  const [html] = world.run([page]);
  assert.ok(html.includes('Always use the work tools for local files, shell and browser.'));
  assert.ok(html.includes('The <span class="mono">work</span> tools run on the machine running AkiMCP'));
  assert.ok(html.includes('Serving now: Work · Server ID work · tools with no prefix'));
}));

test('the AIObox warning shows for Aki-MCP and WorkMCP and stays silent for AkiMCP Work and Aki MCP', () => inWorld({}, (world) => {
  const names = ['Aki-MCP', 'WorkMCP', 'AkiMCP Work', 'Aki MCP'];
  const replies = world.run(names.map((name) => preview({ name })));
  const warned = replies.map((reply) => reply.html.notes.includes('AIObox connects claude.ai by itself only when the Display name contains AkiMCP'));
  assert.deepEqual(warned, [true, true, false, false]);
}));

const SERVER_ID_AND_PREFIX = 'Server ID and Tool prefix together are 30 characters, 28 at most. Shorten the Display name, or set Tool prefix by hand in Customize fields.';
const ERRORS = [
  ['an empty name', { name: '' }, 'name', 'Display name is empty. Type a name, for example AkiMCP.'],
  ['a name over the budget', { name: 'Laptop văn phòng' }, 'name', SERVER_ID_AND_PREFIX],
  ['a name with no letter a to z', { name: '123' }, 'key', 'No Server ID can be made from "123": a Server ID uses only a to z and 0 to 9, and this name has no letter a to z. Set Server ID in Customize fields.'],
  ['a Cyrillic name', { name: 'Мой' }, 'key', 'No Server ID can be made from "Мой": a Server ID uses only a to z and 0 to 9, and this name has no letter a to z. Set Server ID in Customize fields.'],
  ['41 characters', { name: 'a'.repeat(41) }, 'name', 'Display name is 41 characters, 40 at most. Shorten it.'],
  ['a leading dot', { name: '.Work' }, 'name', 'Display name must start with a letter or digit. Remove "." at the start.'],
  ['a line break', { name: 'Work\nLaptop' }, 'name', 'Display name can use only letters, digits, spaces and . _ -. Remove line break.'],
  ['a zero-width space', { name: 'Aki​MCP' }, 'name', 'Display name can use only letters, digits, spaces and . _ -. Remove zero-width space (U+200B).'],
  ['a symbol', { name: 'AkiMCP™' }, 'name', 'Display name can use only letters, digits, spaces and . _ -. Remove "™".'],
  ['an emptied Server ID', { name: 'Work Laptop', key: '' }, 'key', 'Server ID is empty. Type one, for example worklaptop.'],
  ['an uppercase Server ID', { name: 'Work', key: 'Work' }, 'key', 'Server ID must be lowercase. Use work.'],
  ['a Server ID starting with a digit', { name: 'Work', key: '1work' }, 'key', 'Server ID must start with a letter. Remove "1" at the start.'],
  ['a Server ID with a symbol', { name: 'Work', key: 'my.tools' }, 'key', 'Server ID can use only letters a to z and digits. Remove ".".'],
  ['a Server ID with capitals and a symbol', { name: 'Work', key: 'My.Tools' }, 'key', 'Server ID can use only letters a to z and digits. Remove ".".'],
  ['a Tool prefix without two underscores', { name: 'Work', prefix: 'x_' }, 'prefix', 'Tool prefix must be empty or end with two underscores, for example x__.'],
];
test('each refused draft shows its own text under its own field and disables Save', () => inWorld({}, (world) => {
  const replies = world.run(ERRORS.map(([, draft]) => preview(draft)));
  ERRORS.forEach(([label, , slot, text], i) => {
    const { canSave, html } = replies[i];
    assert.equal(canSave, false, `${label}: Save is disabled`);
    const where = slot === 'name' ? html.name : html.rows;
    assert.ok(where.includes(esc(text)), `${label}: ${text}`);
  });
}));

test('Save with keep writes the serving Server ID and Tool prefix as hand-set values, and after a restart the served names are unchanged', () => inWorld({ identity: { name: 'Work Laptop' } }, (world) => {
  const [offer, kept, saved, restarted] = world.run([
    preview({ name: 'Work Desktop' }),
    preview({ name: 'Work Desktop', key: 'worklaptop', prefix: 'worklaptop__' }),
    { route: 'POST /api/identity', body: { name: 'Work Desktop', key: 'worklaptop', prefix: 'worklaptop__' } },
    { serving: true },
  ]);
  assert.ok(offer.html.notes.includes('>Keep worklaptop and worklaptop__</button>'), 'the keep button names the serving values');
  assert.ok(offer.html.notes.includes('Claude and AGY ask you to allow every tool again'), 'a changed Server ID warns about the approvals');
  assert.ok(!kept.html.notes.includes('Keep worklaptop'), 'no offer once they are kept');
  assert.ok(kept.html.notes.includes('The Server ID and tool names stay the same, so no client needs to reconnect'));
  assert.equal(saved.ok, true);
  assert.deepEqual(world.saved().identity, { name: 'Work Desktop', key: 'worklaptop', prefix: 'worklaptop__' });
  assert.deepEqual(restarted, { name: 'Work Laptop', key: 'worklaptop', prefix: 'worklaptop__' }, 'this process still serves what it started with');
  const [after] = world.run([{ serving: true }]);
  assert.deepEqual(after, { name: 'Work Desktop', key: 'worklaptop', prefix: 'worklaptop__' }, 'a new process serves the new name on the same tool names');
}));

test('Reset to AkiMCP in the fields writes only on Save; the Save clears identity and leaves applied.keys', () => inWorld({ identity: { name: 'Work Laptop' }, applied: { keys: ['aki-mcp', 'akimcp', 'worklaptop'] } }, (world) => {
  const [filled] = world.run([preview({ name: 'AkiMCP' })]);
  assert.ok(filled.html.notes.includes('After Save, restart AkiMCP (press Ctrl+C in the terminal where it runs'), 'S8 line 1 shows');
  assert.equal(filled.canSave, true);
  assert.deepEqual(world.saved().identity, { name: 'Work Laptop' }, 'a preview writes nothing');
  const [saved] = world.run([{ route: 'POST /api/identity', body: { name: 'AkiMCP' } }]);
  assert.equal(saved.ok, true);
  assert.equal(world.saved().identity, undefined, 'the default is stored as no identity');
  assert.deepEqual(world.saved().applied.keys, ['aki-mcp', 'akimcp', 'worklaptop']);
}));

test('the red row Reset clears identity at once and leaves applied.keys', () => inWorld({ identity: { name: 'Work', key: 'my.tools' }, applied: { keys: ['aki-mcp', 'akimcp'] } }, (world) => {
  const [reset] = world.run([{ route: 'POST /api/identity-reset' }]);
  assert.equal(reset.ok, true);
  assert.equal(world.saved().identity, undefined);
  assert.deepEqual(world.saved().applied.keys, ['aki-mcp', 'akimcp']);
}));

test('Save of the names already serving asks for no restart', () => inWorld({ identity: { name: 'Work Laptop', key: 'worklaptop' } }, (world) => {
  const [saved] = world.run([{ route: 'POST /api/identity', body: { name: 'Work Laptop' } }]);
  assert.equal(saved.message, 'Saved. Work Laptop is already serving.');
}));

test('Save refuses an invalid draft and writes nothing', () => inWorld({}, (world) => {
  const [refused] = world.run([{ route: 'POST /api/identity', body: { name: 'Work', key: 'my.tools' } }]);
  assert.equal(refused.error, 'Server ID can use only letters a to z and digits. Remove ".".');
  assert.equal(world.saved().identity, undefined);
}));
