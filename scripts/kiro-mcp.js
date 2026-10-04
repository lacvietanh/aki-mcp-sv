// Dedicated MCP tool for the `kiro-cli` "arm": passes the prompt as a separate execFile arg so no shell-tokenizing step can mis-split a multi-word prompt (same reason agy-mcp.js exists). Read-only — kiro_write was removed 2026-08-10 (docs/plan/done/remove-kiro-write.md): the filesystem MCP arm's write_file/edit_file already covers the same capability.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { resolveOrFail } from './roots.js';
import { findOnPath } from './find-on-path.js';
import { ok, err, fail } from './mcp-tool.js';

// Owner requirement ("khóa cứng"): the model is not a tool parameter, so a prompt cannot escalate to a pricier or different tier.
// Verified 2026-08-09 against `kiro-cli chat --list-models` (kiro-cli 2.16.2): claude-sonnet-4.5 is a real id (1.30x credits). See docs/ref/harness-fact.md § Kiro.
const MODEL = 'claude-sonnet-4.5';

function run(trustTools, { prompt, effort, cwd }) {
  const r = resolveOrFail(cwd);
  if (!r.ok) return Promise.resolve(fail(r.error));
  // The prompt is kiro-cli's positional argument: one starting with a dash would be parsed as a flag (--trust-all-tools).
  if (String(prompt).trimStart().startsWith('-')) return Promise.resolve(err('rejected: start the prompt with a word, not "-" (kiro-cli would read it as a flag)'));
  const dir = r.dir;
  const args = ['chat', '--no-interactive', '--model', MODEL, `--trust-tools=${trustTools}`];
  if (effort) args.push('--effort', effort);
  args.push(prompt);
  return new Promise((resolve) => {
    execFile('kiro-cli', args, { cwd: dir, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return resolve(err(stdout || stderr || error.message));
      }
      if (!stdout || !stdout.trim()) {
        return resolve(err('kiro-cli returned no output — the call may have been silently denied rather than a clean empty result. Re-check the prompt/scope.'));
      }
      resolve(ok(stdout));
    });
  });
}

const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('kiro-cli --effort, thinking budget');

export const provider = {
  id: 'kiro',
  title: 'Kiro CLI (read-only)',
  optIn: true,
  detect: () => (findOnPath('kiro-cli') ? { available: true } : { available: false, reason: 'kiro-cli is not on PATH' }),
  register,
};

export function register(server) {
  server.registerTool(
    'kiro_read',
    {
      title: 'Kiro CLI (read-only)',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        `Delegate a read-only task to a Kiro CLI session locked to ${MODEL}. ` +
        'Restricted to fs_read by mechanism (--trust-tools=fs_read) — it can read files under the allowed roots but cannot write or run shell. ' +
        'prompt is passed straight to kiro-cli as one argument — no shell quoting, spaces/punctuation are safe as-is.',
      inputSchema: {
        prompt: z.string(),
        effort: effortSchema,
        cwd: z.string().optional().describe('run inside this project dir; must be under an allowed root'),
      },
    },
    async ({ prompt, effort, cwd }) => run('fs_read', { prompt, effort, cwd }),
  );
}
