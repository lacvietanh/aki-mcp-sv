// A chat's session file (ss): aki__akidevrule_context mints its path, the chat passes it back, and this module names, checks and ages it (docs/plan/ss-session-file.md D2-D5, D9-D12). Nothing here creates a file or a folder.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { USER_DIR } from './userdata.js';
import { getRoots, containedIn } from './roots.js';

export const SS_DIR = path.resolve(USER_DIR, 'ss');
// D10: an ss this far behind an acting call is named in that call's result.
export const SS_STALE_MS = 15 * 60_000;
// D12: the file sessions kept before ss, still matched while old threads write it.
export const LEGACY_WORKING_FILE = /[\\/]\.aki[\\/]mcpsv[\\/]task[\\/][^\\/]+[\\/]working\.md$/;
// D2, D4, v2 D7: <YYYY.MM.DD-HHMM>-<label of at most LABEL_MAX>, plus a 3-character collision suffix.
const LABEL_MAX = 24;
const SS_NAME = new RegExp(`^\\d{4}\\.\\d{2}\\.\\d{2}-\\d{4}-[a-z0-9-]{1,${LABEL_MAX + 3}}\\.md$`);
const PROJECT_NAME = /^[A-Za-z0-9._-]+$/;

const random2 = () => randomInt(36 * 36).toString(36).padStart(2, '0');
const two = (n) => String(n).padStart(2, '0');
const sanitizeProject = (name) => (/^\.*$/.test(name) ? '_' : name.replace(/[^A-Za-z0-9._-]/g, '-'));

// D3, v2 B3: the nearest `.git` folder's name, else the working folder as Claude Code keys it, else `_` (docs/arch/rule-context-delivery.md).
export function projectKey(workingPath, workingRoot) {
  if (!workingPath) return '_';
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const here = real(workingPath);
  const stop = workingRoot ? real(workingRoot) : null;
  for (let dir = here; stop; dir = path.dirname(dir)) {
    const rel = path.relative(stop, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) break;
    if (fs.existsSync(path.join(dir, '.git'))) return sanitizeProject(path.basename(dir));
    if (rel === '') break;
  }
  return sanitizeProject(fs.statSync(here, { throwIfNoEntry: false })?.isFile() ? path.dirname(here) : here);
}

// D4, v2 D7: folded to ASCII and lowercased; spaces and underscores become `-`, other symbols drop (`P37·W8` → `p37w8`), at most LABEL_MAX characters, cut at the last whole word.
export function sanitizeLabel(label) {
  if (typeof label !== 'string') return '';
  return cutAtWord(label.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, ''));
}

function cutAtWord(label) {
  const head = label.slice(0, LABEL_MAX);
  if (label.length === head.length || label[LABEL_MAX] === '-') return head;
  const wordEnd = head.lastIndexOf('-');
  return wordEnd > 0 ? head.slice(0, wordEnd) : head;
}

// A minted path creates no file, so a second chat in the same minute would find it free: this process (the only one that mints, CLAUDE.md § Process topology) remembers what it handed out.
const minted = new Set();

// D2, D4: the local clock the owner reads; a name already taken or already minted gets 2 random base36 characters more.
export function mintSessionPath({ project, label, now = new Date(), dir = SS_DIR }) {
  const stamp = `${now.getFullYear()}.${two(now.getMonth() + 1)}.${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
  const base = `${stamp}-${sanitizeLabel(label) || random2()}`;
  let file = path.join(dir, project, `${base}.md`);
  while (fs.existsSync(file) || minted.has(file)) file = path.join(dir, project, `${base}-${random2()}.md`);
  minted.add(file);
  return file;
}

// D5: the absolute ss path when p is one (directly under <data dir>/ss/<project>/, an ss name, no `..`), else null. pathApi lets a test check Windows paths on any OS.
export function acceptSessionPath(p, { dir = SS_DIR, pathApi = path } = {}) {
  if (typeof p !== 'string' || !pathApi.isAbsolute(p) || p.split(/[\\/]/).includes('..')) return null;
  const file = pathApi.resolve(p);
  const project = pathApi.basename(pathApi.dirname(file));
  const parent = pathApi.dirname(pathApi.dirname(file));
  const root = pathApi.resolve(dir);
  const sameDir = pathApi.sep === '\\' ? parent.toLowerCase() === root.toLowerCase() : parent === root;
  return sameDir && PROJECT_NAME.test(project) && !/^\.+$/.test(project) && SS_NAME.test(pathApi.basename(file)) ? file : null;
}

// D9: a write the filesystem tools name as an ss write.
export const isSessionFile = (real) => Boolean(acceptSessionPath(real)) || LEGACY_WORKING_FILE.test(real);

// v2 D1, D2: the frontmatter keys and headings a new ss is expected to carry.
const SHAPE_KEYS = ['status', 'repo', 'chat', 'started', 'parent', 'successor', 'room', 'plan', 'transcript'];
const SHAPE_HEADINGS = ['Now', 'Asked', 'Next', 'Decisions', 'Open', 'Files', 'Log'];
const SHAPE_LINE = /^ss file written: .* · shape(?: (ok)|: missing (.+))$/m;

// v2 D6: what an ss lacks of the frontmatter keys and headings, as written (`status`, `## Now`); empty when it has them all. A v1 file is reported, never refused.
export function shapeOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const close = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const keys = new Set(lines.slice(1, close < 0 ? 1 : close).map((l) => /^([a-z]+):/.exec(l)?.[1]));
  const heads = new Set(lines.map((l) => /^## (.*\S)\s*$/.exec(l)?.[1]));
  return [...SHAPE_KEYS.filter((k) => !keys.has(k)), ...SHAPE_HEADINGS.filter((h) => !heads.has(h)).map((h) => `## ${h}`)];
}

// v2 D6: the end of the write-time line, a fact about the file just written.
export function shapeNote(text) {
  const missing = shapeOf(text);
  return missing.length ? `shape: missing ${missing.join(', ')}` : 'shape ok';
}

// v2 D6: the call log's `ssShape`, read back from that same result line (no file read): `ok`, how many pieces were missing, or undefined when the result carries no shape.
export function shapeFromResult(text) {
  const m = typeof text === 'string' ? SHAPE_LINE.exec(text) : null;
  return m ? (m[1] ? 'ok' : m[2].split(', ').length) : undefined;
}

// D11: whole minutes since the file was last written, -1 when it does not exist, null when it cannot be read (the tool call it trails has already run).
export function ssAgeMinutes(file, now = Date.now()) {
  let stat;
  try { stat = fs.statSync(file, { throwIfNoEntry: false }); } catch { return null; }
  return stat ? Math.max(0, Math.floor((now - stat.mtimeMs) / 60_000)) : -1;
}

// D10: the line an acting call that names its ss ends with, or null while the file is current. A fact about a file, never an order (F6).
export function staleLine(ss, now = Date.now()) {
  const file = acceptSessionPath(ss);
  if (!file) return 'ss: not an ss path, ignored';
  const age = ssAgeMinutes(file, now);
  if (age === null) return null;
  if (age < 0) return `ss: ${file} · not created yet`;
  return age * 60_000 >= SS_STALE_MS ? `ss: ${file} · last written ${age} min ago` : null;
}

// D5: the ss a context call hands back with its header line: the one passed in when it is an ss path (kept), else a new one. `unavailable` when the file tools cannot write the data dir (F8).
export function sessionFor({ ss, label, workingPath, workingRoot, now = new Date() }) {
  if (!getRoots().some((root) => containedIn(SS_DIR, root))) {
    return { path: null, state: 'unavailable', line: `ss: unavailable · ${path.resolve(USER_DIR)} is outside the allowed folders; add it under Folders in the panel` };
  }
  const given = typeof ss === 'string' && ss !== '';
  const kept = given ? acceptSessionPath(ss) : null;
  if (kept) return { path: kept, state: 'kept', line: `ss: ${kept} · kept${fs.existsSync(kept) ? '' : ' · not created yet'}` };
  const file = mintSessionPath({ project: projectKey(workingPath, workingRoot), label, now });
  if (given) return { path: file, state: 'ignored', line: `ss: ${file} · new (the ss given was ignored: not an ss path)` };
  return { path: file, state: 'new', line: `ss: ${file} · new · folder ${fs.existsSync(path.dirname(file)) ? 'ready' : 'missing'}` };
}
