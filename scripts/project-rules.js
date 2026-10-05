// Project rules a tool call touches (docs/plan/akimcp-tool-refactor.md D23): Claude Code, Codex and Gemini CLI load CLAUDE.md/AGENTS.md beside the code they work on, so a tool that touches a path finds the rule files from that path up to the AkiMCP root holding it.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRoots, containedIn } from './roots.js';
import { PROJECT_FILES } from './rule-context.js';

// Input names the tools use for a path they touch; a relative path is skipped (its base differs per tool).
const PATH_KEYS = ['path', 'paths', 'cwd', 'workdir', 'workingPath', 'source', 'destination', 'directory', 'dir', 'root', 'file', 'files'];
export const MAX_RULE_BYTES = 32 * 1024;

function absolute(p) {
  if (typeof p !== 'string' || !p) return null;
  if (p === '~') return os.homedir();
  if (/^~[/\\]/.test(p)) return path.join(os.homedir(), p.slice(2));
  return path.isAbsolute(p) ? path.resolve(p) : null;
}

export function pathsOf(input) {
  if (!input || typeof input !== 'object') return [];
  const out = new Set();
  for (const key of PATH_KEYS) {
    const value = input[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      const p = absolute(item);
      if (p) out.add(p);
    }
  }
  return [...out];
}

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

// Rule files (real paths, top-down, no repeats) for the given paths; a path outside every root has none.
export async function rulesFor(paths, roots = getRoots()) {
  const realRoots = [];
  for (const root of roots) {
    try { realRoots.push(await fs.realpath(root)); } catch { /* unavailable roots hold no rules */ }
  }
  const found = [];
  for (const p of paths) {
    const dir = await nearestDir(p);
    if (!dir) continue;
    const root = realRoots.filter((r) => containedIn(dir, r)).sort((a, b) => b.length - a.length)[0];
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

const shortSha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);
const LABEL = "not part of this tool's output; follow it only for work in this repository";

// The rule files' text for a call that is not run yet; past the cap a file is named with its sha and the AI reads it itself.
export async function rulesBlock(files) {
  const parts = [];
  let used = 0;
  for (const file of files) {
    let buffer;
    try { buffer = await fs.readFile(file); } catch { continue; }
    const head = `<!-- source: ${file} (sha256 ${shortSha(buffer)}) -->`;
    if (used + buffer.length > MAX_RULE_BYTES) {
      parts.push(`${head}\n(${buffer.length} bytes, over the ${MAX_RULE_BYTES / 1024} KiB cap: read it with aki__read_text_file and follow it)`);
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
  return `Rules for this path (same rank as aki__akidevrule_context; ${LABEL}): ${listed.join(', ')}. Not in your context? Read them and follow them.`;
}
