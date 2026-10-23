// Project rules a tool call touches (docs/plan/done/akimcp-tool-refactor.md D23): Claude Code, Codex and Gemini CLI load CLAUDE.md/AGENTS.md beside the code they work on, so a tool that touches a path finds the rule files from that path up to the AkiMCP root holding it.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRoots, containedIn } from './roots.js';
import { PROJECT_FILES } from './rule-context.js';

// Input names the tools use for a path they touch; a relative path is skipped (its base differs per tool).
const PATH_KEYS = ['path', 'paths', 'cwd', 'workdir', 'workingPath', 'source', 'destination', 'directory', 'dir', 'root', 'file', 'files'];
// The subset naming a file the call writes: a cwd or directory says where it runs, not which file type it writes.
const FILE_KEYS = ['path', 'paths', 'source', 'destination', 'file', 'files'];
const MAX_RULE_BYTES = 32 * 1024;

function absolute(p) {
  if (typeof p !== 'string' || !p) return null;
  if (p === '~') return os.homedir();
  if (/^~[/\\]/.test(p)) return path.join(os.homedir(), p.slice(2));
  return path.isAbsolute(p) ? path.resolve(p) : null;
}

export function pathsOf(input, keys = PATH_KEYS) {
  if (!input || typeof input !== 'object') return [];
  const out = new Set();
  for (const key of keys) {
    const value = input[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      const p = absolute(item);
      if (p) out.add(p);
    }
  }
  return [...out];
}

export const filePathsOf = (input) => pathsOf(input, FILE_KEYS);

// The real directory of the path, or of its nearest existing parent (a file about to be created).
async function nearestDir(p) {
  for (let cursor = p; ; cursor = path.dirname(cursor)) {
    try {
      const real = await fs.realpath(cursor);
      return (await fs.stat(real)).isDirectory() ? real : path.dirname(real);
    } catch { /* not there yet: try the parent */ }
    if (path.dirname(cursor) === cursor) return null;
  }
}

// The full sha256 of a file's bytes, or null when it cannot be read.
export async function contentSha(file) {
  try { return createHash('sha256').update(await fs.readFile(file)).digest('hex'); } catch { return null; }
}

// Rule files for the given paths, top-down, no repeats; two files with identical bytes count once, the deepest kept (S6: a worktree's copy of its repo's CLAUDE.md).
export async function rulesFor(paths, roots = getRoots()) {
  const found = await rulesFound(paths, roots);
  const seen = new Set();
  const kept = [];
  for (const file of found.reverse()) {
    const sha = await contentSha(file);
    if (sha !== null && seen.has(sha)) continue;
    if (sha !== null) seen.add(sha);
    kept.push(file);
  }
  return kept.reverse();
}

async function resolveRoots(roots) {
  const realRoots = [];
  for (const root of roots) {
    try { realRoots.push(await fs.realpath(root)); } catch { /* unavailable roots hold no rules */ }
  }
  return realRoots;
}

const deepestRoot = (p, realRoots) => realRoots.filter((r) => containedIn(p, r)).sort((a, b) => b.length - a.length)[0];

async function rulesFound(paths, roots) {
  const realRoots = await resolveRoots(roots);
  const found = [];
  for (const p of paths) {
    const dir = await nearestDir(p);
    if (!dir) continue;
    const root = deepestRoot(dir, realRoots);
    if (!root) continue;
    const dirs = [];
    for (let cursor = dir; containedIn(cursor, root); cursor = path.dirname(cursor)) {
      dirs.push(cursor);
      if (cursor === root || path.dirname(cursor) === cursor) break;
    }
    for (const d of dirs.reverse()) for (const name of PROJECT_FILES) {
      try {
        const real = await fs.realpath(path.join(d, name));
        if ((await fs.stat(real)).isFile() && !found.includes(real)) found.push(real);
      } catch { /* no such file here */ }
    }
  }
  return found;
}

// Stage A (docs/plan/done/rule-presence-check.md D4): the rules a written file's type routes to, from AkiDevRule's route map, the one path → rule map its Claude Code gate reads too.
const ROUTE_FIELDS = new Set(['rules', 'ext', 'name', 'nameRe', 'dirRe', 'dirSkipExt', 'projectHas']);
const UNGATED_FIELDS = new Set(['segments', 'prefixes', 'dirs']);
const slashed = (p) => p.replace(/\\/g, '/');
const exists = (p) => fs.stat(p).then(() => true, () => false);
let mapWarned = false;

function warnMap(file, why) {
  if (mapWarned) return;
  mapWarned = true;
  process.stderr.write(`[rule-gate] ${file} ${why}: only project rule files are pushed\n`);
}

// null when no map is installed, or when it carries a field this reader does not know: guessing its meaning could push the wrong rules.
async function routeMap(file) {
  let map;
  try { map = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
  const known = Array.isArray(map?.routes) && map.routes.every((r) => Array.isArray(r?.rules) && Object.keys(r).every((k) => ROUTE_FIELDS.has(k)))
    && map.ungated && typeof map.ungated === 'object' && Object.keys(map.ungated).every((k) => UNGATED_FIELDS.has(k));
  if (known) return map;
  warnMap(file, 'has a field this AkiMCP does not read');
  return null;
}

// The path with the symlinks of its existing part resolved and its not-yet-created tail kept.
async function realTarget(p) {
  const tail = [];
  for (let cursor = p; ; cursor = path.dirname(cursor)) {
    try { return path.join(await fs.realpath(cursor), ...tail.reverse()); } catch { /* not there yet */ }
    if (path.dirname(cursor) === cursor) return p;
    tail.push(path.basename(cursor));
  }
}

// Scratch space, AkiMCP and agent state, and the rule corpus itself: no project rule governs them.
function isUngated(map, p, home) {
  const u = map.ungated;
  const s = slashed(p);
  return (u.segments || []).some((seg) => s.includes(seg)) || (u.prefixes || []).some((pre) => s.startsWith(pre))
    || (u.dirs || []).some((d) => s.includes(`/${d}/`)) || s.startsWith(`${slashed(path.join(home, '.claude'))}/`);
}

// The nearest folder holding .git between the file and its root, else the root.
async function projectDirOf(file, root) {
  for (let cursor = path.dirname(file); containedIn(cursor, root); cursor = path.dirname(cursor)) {
    if (await exists(path.join(cursor, '.git'))) return cursor;
    if (cursor === root || path.dirname(cursor) === cursor) break;
  }
  return root;
}

async function routedRules(map, file, projectDir) {
  const name = path.basename(file);
  const ext = path.extname(name).slice(1).toLowerCase();
  const rel = `/${slashed(path.relative(projectDir, file))}`; // folder routes match inside the project only, as in the Claude Code gate
  const rules = new Set();
  for (const r of map.routes) {
    const hit = (r.ext || []).includes(ext) || (r.name || []).includes(name) || (r.nameRe && new RegExp(r.nameRe).test(name))
      || (r.dirRe && !(r.dirSkipExt || []).includes(ext) && new RegExp(r.dirRe).test(rel));
    if (!hit) continue;
    if (r.projectHas && !(await Promise.all(r.projectHas.map((f) => exists(path.join(projectDir, f))))).includes(true)) continue;
    for (const rule of r.rules) rules.add(rule);
  }
  return rules;
}

// Installed rule files the written paths route to; none without a map, for a folder, or for a path outside every root.
export async function routeRulesFor(paths, roots = getRoots(), home = os.homedir()) {
  const ruleDir = path.join(home, '.aki', 'akidevrule');
  const mapFile = path.join(ruleDir, 'route-map.json');
  const map = await routeMap(mapFile);
  if (!map) return [];
  const realRoots = await resolveRoots(roots);
  const out = [];
  try {
    for (const p of paths) {
      const file = await realTarget(p);
      if (isUngated(map, p, home) || isUngated(map, file, home)) continue;
      if ((await fs.stat(file).catch(() => null))?.isDirectory()) continue;
      const root = deepestRoot(file, realRoots);
      if (!root) continue;
      for (const rule of await routedRules(map, file, await projectDirOf(file, root))) {
        try {
          const real = await fs.realpath(path.join(ruleDir, rule));
          if (!out.includes(real)) out.push(real);
        } catch { /* that rule file is not installed */ }
      }
    }
  } catch (error) {
    warnMap(mapFile, `could not be applied (${error.message})`);
    return [];
  }
  return out;
}

const shortSha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);
// Descriptive, never imperative: host AI firewalls stop a chat when tool output tells the model what to do.
const LABEL = "separate from this tool's output; applies to work in this repository only";

// The rule files' text for a call that is not run yet; past the cap a file is named with its sha and the AI reads it itself.
export async function rulesBlock(files) {
  const parts = [];
  let used = 0;
  for (const file of files) {
    let buffer;
    try { buffer = await fs.readFile(file); } catch { continue; }
    const head = `<!-- source: ${file} (sha256 ${shortSha(buffer)}) -->`;
    if (used + buffer.length > MAX_RULE_BYTES) {
      parts.push(`${head}\n(${buffer.length} bytes, over the ${MAX_RULE_BYTES / 1024} KiB cap; readable with aki__read_text_file)`);
      continue;
    }
    used += buffer.length;
    parts.push(`${head}\n${buffer.toString('utf8').replace(/^\uFEFF/, '').trimEnd()}`);
  }
  return `Project rules for the path this call touches (${LABEL}):\n\n${parts.join('\n\n')}`;
}

// One line a read tool appends: which rule files govern the path, by sha, without their text.
export async function rulesLine(files) {
  const listed = [];
  for (const file of files) {
    try { listed.push(`${file} (sha256 ${shortSha(await fs.readFile(file))})`); } catch { /* vanished */ }
  }
  if (!listed.length) return null;
  return `Rule files applying to this path (${LABEL}): ${listed.join(', ')}. Readable with aki__read_text_file.`;
}
