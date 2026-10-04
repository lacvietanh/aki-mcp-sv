// Whole-tree search MCP tool in one call. The filesystem MCP's search_files returns no directories and times out on a large root.
import { execFile } from 'node:child_process';
import { opendirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { resolveUnderRoot, credentialFiles } from './roots.js';
import { ok, fail } from './mcp-tool.js';
import './find-on-path.js'; // on Windows this puts Git for Windows' grep on PATH

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt', '.output', '.cache',
  'vendor', '.venv', 'venv', '__pycache__', 'target', 'Pods', 'DerivedData',
  '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems',
]);
const MAX_DEPTH = 12;
const DEFAULT_LIMIT = 100;

function toMatcher(query) {
  if (!/[*?]/.test(query)) {
    const needle = query.toLowerCase();
    return (rel) => rel.toLowerCase().includes(needle);
  }
  const source = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const re = new RegExp(`^${source}$`, 'i');
  const scoped = query.includes('/');
  return (rel) => re.test(scoped ? rel : path.basename(rel));
}

function walk(base, matches) {
  const stack = [[base, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let handle;
    try {
      handle = opendirSync(dir);
    } catch {
      continue;
    }
    let entry;
    while ((entry = handle.readSync())) {
      const full = path.join(dir, entry.name);
      const isDir = entry.isDirectory();
      matches(full, isDir);
      if (isDir && depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) stack.push([full, depth + 1]);
    }
    handle.closeSync();
  }
}

function findPath(query, from, limit) {
  const base = resolveUnderRoot(from);
  const test = toMatcher(query);
  const found = [];
  walk(base, (full, isDir) => {
    const rel = path.relative(base, full);
    if (test(rel)) found.push(isDir ? `${full}${path.sep}` : full);
  });
  found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
  const head = found.slice(0, limit);
  if (!found.length) return `nothing matched "${query}" under ${base}`;
  const note = found.length > head.length ? `\n… ${found.length - head.length} more result(s) (raise limit or narrow the query)` : '';
  return `${found.length} result(s) under ${base}:\n${head.join('\n')}${note}`;
}

export function searchContent(query, from, glob, limit) {
  const base = resolveUnderRoot(from);
  const args = ['-rniIE', '--binary-files=without-match', ...[...SKIP_DIRS].map((d) => `--exclude-dir=${d}`)];
  if (glob) args.push(`--include=${glob}`);
  args.push('-e', query, base);
  return new Promise((resolve) => {
    execFile('grep', args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // grep on Windows joins the base and the rest with "/", so both sides are compared with one separator.
      const slashed = (text) => text.split(path.sep).join('/');
      const closed = credentialFiles().map((file) => `${slashed(file)}:`);
      const lines = (stdout || '').split('\n').filter((line) => line && !closed.some((prefix) => slashed(line).startsWith(prefix)));
      if (!lines.length) return resolve(err && stderr ? `error: ${stderr.trim()}` : `no lines matched "${query}" under ${base}`);
      const head = lines.slice(0, limit);
      const note = lines.length > head.length ? `\n… ${lines.length - head.length} more line(s)` : '';
      resolve(`${lines.length} matching line(s):\n${head.join('\n')}${note}`);
    });
  });
}

export const provider = { id: 'search', title: 'Search (find_path, search_content)', required: true, register };

export function register(server) {
  server.registerTool(
    'find_path',
    {
      title: 'Find Path',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Find files AND directories anywhere under the configured roots in one call — use this first when locating a project, repo, or file by name, instead of walking directories one level at a time. query is a case-insensitive substring by default ("mcp" finds aki-mcp-sv), or a glob when it contains * or ? ("*.config.js", "src/**/*.ts"). Globs without a slash match the basename. Skips node_modules/.git/build output automatically. Directories come back with a trailing slash.',
      inputSchema: {
        query: z.string(),
        path: z.string().optional().describe('subdirectory to search under, absolute or relative to the root'),
        limit: z.number().optional(),
      },
    },
    ({ query, path: from, limit }) => {
      try {
        return ok(findPath(query, from, limit ?? DEFAULT_LIMIT));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_content',
    {
      title: 'Search Content',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Search file contents recursively under the configured roots and return file:line:text. Case-insensitive extended regex (grep -iE): put every alias in one query with | — "funnel|ingress|thay.*funnel" hits EN+VI+synonym in one call, no need for separate calls per term. Use after find_path when you need where a string actually appears. glob narrows by filename (e.g. "*.json"). Skips binaries and build/vendor directories.',
      inputSchema: {
        query: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ query, path: from, glob, limit }) => {
      try {
        return ok(await searchContent(query, from, glob, limit ?? DEFAULT_LIMIT));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
