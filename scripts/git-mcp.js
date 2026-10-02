// One read-only git tool (op: status | diff | log | tags): fixed argv per op, compact output, scope-checked against the allowed roots.
// It exists beside run_cmd only for the token saving — parsed status, file-bounded diff (docs/feat/tools.md § When a tool earns its place).
// Served name is prefixed aki__ by tools-server.js.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import { shapeForModel, MAX_SHOWN } from './output-shape.js';
import { resolveUnderRoot } from './roots.js';

function gitCmd(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout || '');
    });
  });
}

export function parsePorcelainStatus(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  let branch = 'unknown';
  let tracking = null;
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const branchInfo = line.slice(3).trim();
      const parts = branchInfo.split('...');
      branch = parts[0];
      if (parts[1]) tracking = parts[1];
      continue;
    }
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();

    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ') staged.push({ status: x, file });
      if (y !== ' ') unstaged.push({ status: y, file });
    }
  }

  const clean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
  return { branch, tracking, clean, staged, unstaged, untracked };
}

// Whole files in order, skipping any that no longer fit; the omitted ones are named first (an end notice gets missed), with size, for a file= re-request.
export function capDiffByFile(diff, budget = MAX_SHOWN) {
  if (diff.length <= budget) return diff;
  const files = diff.split(/^(?=diff --git )/m);
  const shown = [];
  const omitted = [];
  let used = 0;
  for (const chunk of files) {
    const name = /^diff --git a\/(.+?) b\//.exec(chunk)?.[1] ?? '(unnamed)';
    if (used + chunk.length <= budget || shown.length === 0) {
      shown.push(chunk);
      used += chunk.length;
    } else {
      const lines = chunk.split('\n');
      omitted.push(`${name} (+${lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length} -${lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length})`);
    }
  }
  const notice = omitted.length ? `[diff: ${shown.length} of ${files.length} files shown. Omitted, ask again with file=<path>: ${omitted.join(', ')}]\n` : '';
  return notice + shapeForModel(shown.join(''));
}

const REMOTE_NAME = /^[A-Za-z0-9._-]+$/; // a configured remote's name, never a URL: a URL argument can smuggle code execution through git's transport helpers (ext::)

const OPS = {
  async status({ cwd }) {
    return JSON.stringify(parsePorcelainStatus(await gitCmd(['status', '--porcelain=v1', '-b'], cwd)), null, 2);
  },
  async diff({ cwd, staged, file }) {
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    const diff = await gitCmd(args, cwd);
    if (!diff.trim()) return staged ? 'No staged changes.' : 'Working tree clean (no diff).';
    return capDiffByFile(diff);
  },
  async log({ cwd, limit = 10 }) {
    const raw = await gitCmd(['log', `-n${limit}`, '--pretty=format:%h%x09%an%x09%ad%x09%s', '--date=short'], cwd);
    const commits = raw.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, author, date, ...rest] = line.split('\t');
      return { hash, author, date, message: rest.join('\t') };
    });
    return JSON.stringify(commits, null, 2);
  },
  async tags({ cwd, remote }) {
    if (!remote) return (await gitCmd(['tag', '--sort=-creatordate'], cwd)).trim() || 'No tags.';
    if (!REMOTE_NAME.test(remote)) throw new Error('remote must be a configured remote name (e.g. origin), not a URL');
    return (await gitCmd(['ls-remote', '--tags', remote], cwd)).trim() || 'No tags on the remote.';
  },
};

export const provider = { id: 'git', title: 'Git (read-only)', register };

export function register(server) {
  server.registerTool(
    'git',
    {
      title: 'Read-only git',
      // openWorld: op=tags remote= reaches the network through ls-remote.
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        'Read-only git with compact output, cheaper in tokens than run_cmd. op=status: branch, upstream, staged/unstaged/untracked as JSON. op=diff: working-tree diff (staged=true for the index, file= to narrow); a big diff shows whole files first and names the omitted ones so you can ask for them with file=. op=log: last commits as JSON (limit, max 50). op=tags: local tags newest first, or the remote\'s tags when remote=<configured remote name>. Anything that writes (commit, push, branch, tag creation) goes through run_cmd.',
      inputSchema: {
        op: z.enum(Object.keys(OPS)).describe('status | diff | log | tags'),
        repoPath: z.string().optional().describe('Repository directory path (defaults to root)'),
        staged: z.boolean().optional().describe('diff: show the staged (cached) diff'),
        file: z.string().optional().describe('diff: specific file path'),
        limit: z.number().int().min(1).max(50).optional().describe('log: number of commits (default 10)'),
        remote: z.string().optional().describe('tags: configured remote name, to list its tags instead of local ones'),
      },
    },
    async ({ op, repoPath, ...opts }) => {
      try {
        return ok(shapeForModel(await OPS[op]({ cwd: resolveUnderRoot(repoPath), ...opts })));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
