// Structured Git operations (git_status / git_diff / git_log).
// Validated against allowed directory roots with smart context truncation.
// Served names are prefixed aki__ by tools-server.js.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { ok, err, fail } from './mcp-tool.js';
import { resolveUnderRoot } from './roots.js';

function gitCmd(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout || '');
    });
  });
}

function truncateDiff(text, maxChars = 30_000) {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, 15_000);
  const tail = text.slice(-10_000);
  const omitted = text.length - 25_000;
  return `${head}\n\n[... diff truncated (${omitted} characters omitted) ...]\n\n${tail}`;
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

export function register(server) {
  server.registerTool(
    'git_status',
    {
      title: 'Get structured git status',
      description:
        'Get clean structured Git status (current branch, upstream tracking, staged files, unstaged files, untracked files). Scope-checked against allowed roots.',
      inputSchema: {
        repoPath: z.string().optional().describe('Repository directory path (defaults to root)'),
      },
    },
    async ({ repoPath }) => {
      try {
        const cwd = resolveUnderRoot(repoPath);
        const raw = await gitCmd(['status', '--porcelain=v1', '-b'], cwd);
        const parsed = parsePorcelainStatus(raw);
        return ok(JSON.stringify(parsed, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'git_diff',
    {
      title: 'Get git diff with smart truncation',
      description:
        'Inspect working tree or staged diffs. Supports filtering by file and automatically truncates oversized diffs to preserve LLM context budget.',
      inputSchema: {
        repoPath: z.string().optional().describe('Repository directory path (defaults to root)'),
        staged: z.boolean().optional().describe('Show staged (cached) diff instead of working tree diff'),
        file: z.string().optional().describe('Specific file path to diff'),
      },
    },
    async ({ repoPath, staged, file }) => {
      try {
        const cwd = resolveUnderRoot(repoPath);
        const args = ['diff'];
        if (staged) args.push('--cached');
        if (file) args.push('--', file);
        const diff = await gitCmd(args, cwd);
        if (!diff.trim()) return ok(staged ? 'No staged changes.' : 'Working tree clean (no diff).');
        return ok(truncateDiff(diff));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'git_log',
    {
      title: 'Get recent git commit history',
      description:
        'Get structured commit history (hash, author, date, message) without terminal pager formatting.',
      inputSchema: {
        repoPath: z.string().optional().describe('Repository directory path (defaults to root)'),
        limit: z.number().int().min(1).max(50).optional().describe('Number of commits to return (default 10, max 50)'),
      },
    },
    async ({ repoPath, limit = 10 }) => {
      try {
        const cwd = resolveUnderRoot(repoPath);
        const format = '%h%x09%an%x09%ad%x09%s';
        const raw = await gitCmd(['log', `-n${limit}`, `--pretty=format:${format}`, '--date=short'], cwd);
        const commits = raw
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash, author, date, ...rest] = line.split('\t');
            return { hash, author, date, message: rest.join('\t') };
          });
        return ok(JSON.stringify(commits, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
