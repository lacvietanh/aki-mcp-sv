// Dedicated MCP tool for the `kiro-cli` "arm": passes the prompt as a separate execFile arg so no shell-tokenizing step can mis-split a multi-word prompt (same reason agy-mcp.js exists). Read-only — kiro_write was removed 2026-08-10 (docs/plan/done/remove-kiro-write.md): the filesystem MCP arm's write_file/edit_file already covers the same capability.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { resolveOrFail } from './roots.js';
import { ok, err, fail } from './mcp-tool.js';

// Owner requirement ("khóa cứng"): the model is not a tool parameter, so a prompt cannot escalate to a pricier or different tier.
// Verified 2026-08-09 against `kiro-cli chat --list-models` (kiro-cli 2.16.2): claude-sonnet-4.5 is a real id (1.30x credits). See docs/ref/harness-fact.md § Kiro.
const MODEL = 'claude-sonnet-4.5';

function run(trustTools, { prompt, effort, cwd }) {
  const r = resolveOrFail(cwd);
  if (!r.ok) return Promise.resolve(fail(r.error));
  const dir = r.dir;
  const args = ['chat', '--no-interactive', '--model', MODEL, `--trust-tools=${trustTools}`];
  if (effort) args.push('--effort', effort);
  args.push(prompt);
  // Fallback probes use 60s/1MiB limits to fail faster and bound memory under concurrency (AGY uses 120s/4MiB).
  return new Promise((resolve) => {
    execFile('kiro-cli', args, { cwd: dir, timeout: 60_000, maxBuffer: 1 * 1024 * 1024 }, (error, stdout, stderr) => {
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

export function register(server) {
  server.registerTool(
    'kiro_read',
    {
      title: 'Kiro CLI (read-only)',
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
