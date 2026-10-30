// resolveIdentity: how the Display name makes the Server ID and Tool prefix, and what is refused (docs/plan/v4-custom-name.md § The identity).
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, problemLine, served, announceIdentity, IDENTITY, IDENTITY_PROBLEM } from '../scripts/mcp-name.js';
import { readSettings } from '../scripts/allowlist.js';

const DEFAULTS = { name: 'AkiMCP', key: 'akimcp', prefix: 'aki__' };

const DERIVED = [
  ['AkiMCP', 'akimcp', 'aki__'],
  ['Aki MCP', 'akimcp', 'aki__'],
  ['AkiMCP Work', 'akimcpwork', 'work__'],
  ['AkiMCP Office PC', 'akimcpofficepc', 'officepc__'],
  ['WorkMCP', 'workmcp', 'work__'],
  ['MCP', 'mcp', 'mcp__'],
  ['AkiMCP 2', 'akimcp2', 'akimcp2__'],
  ['2 AkiMCP', 'akimcp', 'aki__'],
  ['1 Office', 'office', 'office__'],
  ['2 Office', 'office', 'office__'],
  ['ＡｋｉＭＣＰ', 'akimcp', 'aki__'],
  ['Máy Mac', 'maymac', 'maymac__'],
  ['Đà Nẵng', 'danang', 'danang__'],
  ['4Work', 'work', 'work__'],
  ['Æble', 'aeble', 'aeble__'],
  ['Œuvre', 'oeuvre', 'oeuvre__'],
  ['Þór', 'thor', 'thor__'],
  ['STRAẞE', 'strasse', 'strasse__'],
  ['Ðóra', 'dora', 'dora__'],
  ['Ħal', 'hal', 'hal__'],
  ['Ŧur', 'tur', 'tur__'],
  ['Ŋga', 'nga', 'nga__'],
];

for (const [name, key, prefix] of DERIVED) {
  test(`Display name ${name} gives Server ID ${key} and Tool prefix ${prefix}`, () => {
    assert.deepEqual(resolveIdentity({ name }), { identity: { name, key, prefix }, problem: null });
  });
}

test('nothing set gives the defaults and no problem', () => {
  assert.deepEqual(resolveIdentity(), { identity: DEFAULTS, problem: null });
  assert.deepEqual(resolveIdentity({}), { identity: DEFAULTS, problem: null });
  assert.deepEqual(resolveIdentity(null), { identity: DEFAULTS, problem: null });
});

test('a null field counts as not set, and resolveIdentity takes the stored identity alone', () => {
  assert.deepEqual(resolveIdentity({ name: null, key: null, prefix: null }), { identity: DEFAULTS, problem: null });
  assert.deepEqual(resolveIdentity({ name: null }), { identity: DEFAULTS, problem: null });
  assert.equal(resolveIdentity.length, 1);
});

test('the process identity is the default under an empty setting.json, and served() adds the prefix', () => {
  assert.deepEqual(IDENTITY, DEFAULTS);
  assert.deepEqual(IDENTITY_PROBLEM, resolveIdentity(readSettings().identity).problem);
  assert.equal(served('run_cmd'), 'aki__run_cmd');
});

test('the same name typed NFD and NFC gives one result', () => {
  assert.deepEqual(resolveIdentity({ name: 'Ma\u0301y Mac' }), resolveIdentity({ name: 'M\u00e1y Mac' }));
});

const REFUSED_NAMES = [
  ['AkiMCP™', 'a symbol outside the charset'],
  ['', 'nothing in it'],
  ['x'.repeat(41), '41 characters'],
  ['Aki\nMCP', 'a newline'],
  ['</script>', 'markup'],
  [' Work', 'a leading space'],
  ['Aki\u200BMCP', 'a zero-width space'],
  ['Aki\u3164MCP', 'a Hangul filler'],
  ['Aki\u034FMCP', 'a combining grapheme joiner'],
  ['Aki\u202EMCP', 'a direction override'],
];

for (const [name, why] of REFUSED_NAMES) {
  test(`Display name with ${why} is refused and the defaults are served`, () => {
    const { identity, problem } = resolveIdentity({ name });
    assert.deepEqual(identity, DEFAULTS);
    assert.equal(problem.field, 'Display name');
  });
}

test('a Display name that makes no Server ID is a problem on Server ID, never a guess', () => {
  for (const name of ['123', 'Мой']) {
    const { identity, problem } = resolveIdentity({ name });
    assert.deepEqual(identity, DEFAULTS);
    assert.equal(problem.field, 'Server ID');
    assert.match(problem.reason, /set it by hand/);
  }
});

test('Server ID and Tool prefix set by hand win over the Display name, and an empty prefix is allowed', () => {
  assert.deepEqual(resolveIdentity({ name: 'Work Laptop', key: 'mytools', prefix: 'my__' }).identity, { name: 'Work Laptop', key: 'mytools', prefix: 'my__' });
  assert.deepEqual(resolveIdentity({ prefix: '' }).identity, { name: 'AkiMCP', key: 'akimcp', prefix: '' });
});

test('a hand-set Server ID is kept while the Display name changes', () => {
  assert.equal(resolveIdentity({ name: 'Other Name', key: 'akimcp' }).identity.key, 'akimcp');
});

test('a Display name with no letters is usable once Server ID and Tool prefix are both set by hand', () => {
  assert.deepEqual(resolveIdentity({ name: '123', key: 'home', prefix: 'home__' }).identity, { name: '123', key: 'home', prefix: 'home__' });
  assert.equal(resolveIdentity({ name: '123', key: 'home' }).problem.field, 'Tool prefix');
});

const INVALID = [
  [{ key: 'my.tools' }, 'Server ID'],
  [{ key: 'a_b' }, 'Server ID'],
  [{ key: 'My-Tools' }, 'Server ID'],
  [{ prefix: 'x_' }, 'Tool prefix'],
  [{ key: 'a'.repeat(14), prefix: `${'b'.repeat(13)}__` }, 'Server ID and Tool prefix'],
  [{ name: 'Laptop văn phòng' }, 'Server ID and Tool prefix'],
  [{ key: ['akimcp'] }, 'Server ID'],
  [{ prefix: ['work__'] }, 'Tool prefix'],
  [{ name: true }, 'Display name'],
  ['Work', 'identity'],
  [5, 'identity'],
  [true, 'identity'],
  [['Work'], 'identity'],
];

for (const [stored, field] of INVALID) {
  test(`${JSON.stringify(stored)} serves the defaults with a problem on ${field}`, () => {
    const { identity, problem } = resolveIdentity(stored);
    assert.deepEqual(identity, DEFAULTS);
    assert.equal(problem.field, field);
  });
}

test('Server ID and Tool prefix of exactly 28 characters are accepted', () => {
  assert.equal(resolveIdentity({ key: 'a'.repeat(13), prefix: `${'b'.repeat(13)}__` }).problem, null);
});

test('a refused value holding ESC, BEL and U+009B prints none of them raw in the boot line', () => {
  const { problem } = resolveIdentity({ key: 'a\u001b\u0007\u009b' });
  const line = problemLine(problem, 'setting.json');
  assert.doesNotMatch(line, /\p{Cc}/u);
  for (const escaped of ['\\u001b', '\\u0007', '\\u009b']) assert.ok(line.includes(escaped), `${escaped} written out`);
  assert.match(line, /^Server ID ".*" in setting\.json is not valid: /);
});

test('the boot line goes to console.error and states the serving identity', (t) => {
  const lines = [];
  t.mock.method(console, 'error', (line) => lines.push(line));
  announceIdentity();
  assert.deepEqual(lines, ['Serving as AkiMCP · Server ID akimcp · tools aki__*']);
});
