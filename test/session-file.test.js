// session-file.js: the ss path's project key, label, mint, acceptance, age and the header a context call returns (docs/plan/ss-session-file.md P1).
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USER_DIR, SETTINGS_PATH } from '../scripts/userdata.js';
import { SS_DIR, projectKey, sanitizeLabel, mintSessionPath, acceptSessionPath, isSessionFile, shapeOf, shapeNote, shapeFromResult, ssAgeMinutes, staleLine, sessionFor } from '../scripts/session-file.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')));
const at = new Date(2026, 9, 24, 18, 12);
const cwdKey = (p) => p.replace(/[^A-Za-z0-9._-]/g, '-');
const minutesAgo = (file, n) => { const t = new Date(Date.now() - n * 60_000); fs.utimesSync(file, t, t); };

test('projectKey is the basename of the nearest git folder at or under the root, else the working folder as Claude Code keys it, and _ only without a path', () => {
  const root = path.join(tmp, 'roots');
  const repo = path.join(root, 'my repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  assert.equal(projectKey(path.join(repo, 'src', 'deep'), root), 'my-repo', 'a character outside [A-Za-z0-9._-] becomes -');
  assert.equal(projectKey(path.join(repo, 'src', 'not-yet', 'a.md'), root), 'my-repo', 'a path not created yet walks up the same way');
  const worktree = path.join(root, 'wt');
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere\n');
  assert.equal(projectKey(worktree, root), 'wt', '.git as a file (worktree, submodule) counts');
  fs.mkdirSync(path.join(root, 'plain'));
  assert.equal(projectKey(path.join(root, 'plain'), root), cwdKey(path.join(root, 'plain')), 'no .git on the walk: the working folder path, every other character -');
  const outer = path.join(tmp, 'outer');
  fs.mkdirSync(path.join(outer, '.git'), { recursive: true });
  fs.mkdirSync(path.join(outer, 'inner'));
  assert.equal(projectKey(path.join(outer, 'inner'), path.join(outer, 'inner')), cwdKey(path.join(outer, 'inner')), 'a .git above the root is not this project');
  assert.equal(projectKey(undefined, root), '_');
});

test('sanitizeLabel folds to lowercase ASCII, joins words with -, cuts at 24 on a whole word', () => {
  assert.equal(sanitizeLabel('P37·W8'), 'p37w8');
  assert.equal(sanitizeLabel('Sửa lỗi đăng nhập'), 'sua-loi-dang-nhap');
  assert.equal(sanitizeLabel('council secretary tachnhac'), 'council-secretary', 'a word that would be cut mid-way is dropped');
  assert.equal(sanitizeLabel(`${'a'.repeat(24)} bbb`), 'a'.repeat(24), 'a word ending exactly at 24 stays');
  assert.equal(sanitizeLabel('a'.repeat(30)), 'a'.repeat(24), 'one long word is cut at 24');
  assert.equal(sanitizeLabel('  --  '), '');
  assert.equal(sanitizeLabel(undefined), '');
});

test('mintSessionPath names the file by local time and label, and never reuses a taken name', () => {
  const dir = path.join(tmp, 'mint');
  const named = mintSessionPath({ project: 'aki-mcp-sv', label: 'P37·W8', now: at, dir });
  assert.equal(named, path.join(dir, 'aki-mcp-sv', '2026.10.24-1812-p37w8.md'));
  assert.match(path.basename(mintSessionPath({ project: '_', now: at, dir })), /^2026\.10\.24-1812-[a-z0-9]{2}\.md$/, 'no label: 2 random characters');
  fs.mkdirSync(path.dirname(named), { recursive: true });
  fs.writeFileSync(named, '');
  const second = mintSessionPath({ project: 'aki-mcp-sv', label: 'P37·W8', now: at, dir });
  assert.match(path.basename(second), /^2026\.10\.24-1812-p37w8-[a-z0-9]{2}\.md$/);
  assert.equal(acceptSessionPath(second, { dir }), second, 'the collision name is still an ss name');
  const twinA = mintSessionPath({ project: 'aki-mcp-sv', label: 'twin', now: at, dir });
  const twinB = mintSessionPath({ project: 'aki-mcp-sv', label: 'twin', now: at, dir });
  assert.notEqual(twinA, twinB, 'two chats minting in the same minute never share a path, though neither file exists yet');
  const longest = mintSessionPath({ project: 'aki-mcp-sv', label: 'a'.repeat(30), now: at, dir });
  assert.equal(path.basename(longest), `2026.10.24-1812-${'a'.repeat(24)}.md`);
  assert.equal(acceptSessionPath(longest, { dir }), longest, 'a 24-character label is accepted back, so a kept ss stays kept');
});

test('acceptSessionPath takes only an ss name directly under <ss dir>/<project>/', () => {
  const good = path.join(SS_DIR, 'aki-mcp-sv', '2026.10.24-1812-ab.md');
  assert.equal(acceptSessionPath(good), good);
  for (const bad of [
    path.join(tmp, 'aki-mcp-sv', '2026.10.24-1812-ab.md'),
    `${SS_DIR}/aki-mcp-sv/../x/2026.10.24-1812-ab.md`,
    path.join(SS_DIR, 'aki-mcp-sv', 'notes.md'),
    path.join(SS_DIR, 'aki-mcp-sv', 'sub', '2026.10.24-1812-ab.md'),
    path.join(SS_DIR, '2026.10.24-1812-ab.md'),
    'ss/aki-mcp-sv/2026.10.24-1812-ab.md',
    42,
  ]) assert.equal(acceptSessionPath(bad), null, String(bad));
  const win = { dir: 'C:\\Users\\a\\.aki\\mcpsv\\ss', pathApi: path.win32 };
  assert.equal(acceptSessionPath('C:/Users/a/.aki/mcpsv/ss/proj/2026.10.24-1812-ab.md', win), 'C:\\Users\\a\\.aki\\mcpsv\\ss\\proj\\2026.10.24-1812-ab.md', 'forward slashes on Windows');
  assert.ok(acceptSessionPath('c:\\users\\A\\.aki\\mcpsv\\ss\\proj\\2026.10.24-1812-ab.md', win), 'Windows paths compare case-insensitively');
});

test('isSessionFile names an ss and a legacy task working.md, nothing else', () => {
  assert.equal(isSessionFile(path.join(SS_DIR, 'p', '2026.10.24-1812-ab.md')), true);
  assert.equal(isSessionFile(path.join(tmp, '.aki', 'mcpsv', 'task', 'old-thread', 'working.md')), true);
  assert.equal(isSessionFile(path.join(tmp, 'working.md')), false);
});

test('staleLine says nothing for a fresh file and names a missing or stale one', () => {
  const file = path.join(SS_DIR, 'stale', '2026.10.24-1812-ab.md');
  assert.equal(ssAgeMinutes(file), -1);
  assert.equal(staleLine(file), `ss: ${file} · not created yet`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# t\n');
  assert.equal(staleLine(file), null);
  minutesAgo(file, 14);
  assert.equal(staleLine(file), null, 'under 15 minutes is current');
  minutesAgo(file, 20);
  assert.equal(ssAgeMinutes(file), 20);
  assert.equal(staleLine(file), `ss: ${file} · last written 20 min ago`);
  assert.equal(staleLine('/etc/hosts'), 'ss: not an ss path, ignored');
  const unreadable = path.join(SS_DIR, 'p'.repeat(300), '2026.10.24-1812-ab.md');
  assert.equal(ssAgeMinutes(unreadable), null, 'a stat error other than a missing file is not a throw');
  assert.equal(staleLine(unreadable), null);
});

test('sessionFor mints, keeps, ignores, and reports an unreachable data dir', () => {
  const repo = path.join(tmp, 'demo-repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const fresh = sessionFor({ label: 'Fix bug', workingPath: repo, workingRoot: tmp, now: at });
  assert.equal(fresh.state, 'new');
  assert.equal(fresh.path, path.join(SS_DIR, 'demo-repo', '2026.10.24-1812-fix-bug.md'));
  assert.equal(fresh.line, `ss: ${fresh.path} · new · folder missing`);
  fs.mkdirSync(path.dirname(fresh.path), { recursive: true });
  assert.match(sessionFor({ workingPath: repo, workingRoot: tmp, now: at }).line, / · new · folder ready$/);
  assert.deepEqual(sessionFor({ ss: fresh.path }), { path: fresh.path, state: 'kept', line: `ss: ${fresh.path} · kept · not created yet` });
  fs.writeFileSync(fresh.path, '# t\n');
  assert.equal(sessionFor({ ss: fresh.path, label: 'other' }).line, `ss: ${fresh.path} · kept`, 'a later label never renames a kept ss');
  const ignored = sessionFor({ ss: '/etc/hosts', workingPath: repo, workingRoot: tmp, now: at });
  assert.equal(ignored.state, 'ignored');
  assert.match(ignored.line, /^ss: .+ · new \(the ss given was ignored: not an ss path\)$/);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ folders: [tmp] }));
  try {
    assert.deepEqual(sessionFor({ ss: fresh.path }), { path: null, state: 'unavailable', line: `ss: unavailable · ${path.resolve(USER_DIR)} is outside the allowed folders; add it under Folders in the panel` });
  } finally {
    fs.rmSync(SETTINGS_PATH, { force: true });
  }
});

test('projectKey keys a no-git file by its folder, like a folder', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'nogit-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, 'x');
  assert.equal(projectKey(file), cwdKey(dir));
  assert.equal(projectKey(dir), cwdKey(dir));
});

test('shapeOf names what an ss lacks of the v2 frontmatter and headings, and reports a v1 file instead of refusing it', () => {
  const shaped = ['---', ...['status', 'repo', 'chat', 'started', 'parent', 'successor', 'room', 'plan', 'transcript'].map((k) => `${k}: none`), '---', '# t', ...['Now', 'Asked', 'Next', 'Decisions', 'Open', 'Files', 'Log'].map((h) => `## ${h}`), ''].join('\n');
  assert.deepEqual(shapeOf(shaped), []);
  assert.deepEqual(shapeOf(shaped.replace(/\n/g, '\r\n')), [], 'CRLF files count');
  assert.deepEqual(shapeOf(shaped.replace('status: none\n', '').replace('## Now\n', '')), ['status', '## Now']);
  assert.deepEqual(shapeOf(shaped.replace('transcript: none\n---\n', '---\ntranscript: none\n')), ['transcript'], 'a key after the closing --- is body, not frontmatter');
  assert.deepEqual(shapeOf(`status: active\n${shaped.slice(shaped.indexOf('# t'))}`), ['status', 'repo', 'chat', 'started', 'parent', 'successor', 'room', 'plan', 'transcript'], 'frontmatter has to open the file');
  const v1 = shapeOf('# goal\n## State\n## Next\n');
  assert.equal(v1.length, 9 + 6, 'a v1 file is told everything it lacks');
  assert.deepEqual([v1[0], v1.at(-1), v1.includes('## Next')], ['status', '## Log', false]);
});

test('the write-time note and the call log field are one format, written and read back', () => {
  assert.equal(shapeNote('---\nstatus: active\n---\n'), `shape: missing ${shapeOf('---\nstatus: active\n---\n').join(', ')}`);
  assert.equal(shapeFromResult('wrote /p\nss file written: /p · shape ok'), 'ok');
  assert.equal(shapeFromResult('```diff\n+x\n```\nss file written: /p · shape: missing status, ## Now'), 2, 'the count of what is missing');
  assert.equal(shapeFromResult('wrote /p\nss file written: /p'), undefined, 'a legacy write has no shape');
  assert.equal(shapeFromResult('wrote /p'), undefined);
  assert.equal(shapeFromResult(undefined), undefined);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
