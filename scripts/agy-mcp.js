// Dedicated MCP tool for the `agy` CLI: passes prompt/model/mode as separate execFile args so no shell-tokenizing step can mis-split a multi-word -p prompt (the reason it is not routed through the generic shell tool). Modes are allowlisted via allowlist.js.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { readSettings } from './allowlist.js';
import { findOnPath } from './find-on-path.js';
import { resolveOrFail } from './roots.js';
import { ok, err, fail } from './mcp-tool.js';

// 'plan' is agy's non-mutating mode — the only one enabled out of the box. Anything else must be explicitly opted into via setting.json -> { "agy": { "allowedModes": [...] } }.
const DEFAULT_MODES = ['plan'];
// Discovery-tier default per akiflow/harness-facts.md: fastest wide-context tier, generous quota.
const DEFAULT_MODEL = 'gemini-3.7-flash-medium';

function loadAllowedModes() {
  const configured = readSettings().agy?.allowedModes;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_MODES;
}

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile('agy', args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // agy writes its own errors to stdout, not stderr — check stdout first or real failures show up as Node's generic "Command failed: <cmd>" with no explanation (see shell-mcp.js's same bug).
        return resolve(err(stdout || stderr || error.message));
      }
      // agy headless can't prompt for permission: a denied action auto-fails but still exits 0 with an empty response (harness-facts.md § Cross-CLI worker). Treat empty stdout as inconclusive, not clean.
      if (!stdout || !stdout.trim()) {
        return resolve(err('agy returned no output — the call may have been silently denied rather than a clean empty result. Re-check the prompt/scope.'));
      }
      resolve(ok(stdout));
    });
  });
}

export const provider = {
  id: 'agy',
  title: 'Antigravity CLI (agy)',
  optIn: true,
  detect: () => (findOnPath('agy') ? { available: true } : { available: false, reason: 'agy is not on PATH' }),
  register,
};

export function register(server) {
  // Read once at registration: read-only by mechanism only while 'plan' is the sole allowed mode; widening the modes takes a restart to drop the hint.
  const modes = loadAllowedModes();
  server.registerTool(
    'agy_run',
    {
      title: 'Antigravity CLI',
      annotations: { readOnlyHint: modes.length === 1 && modes[0] === 'plan', destructiveHint: false, openWorldHint: false },
      description:
        'Run the agy CLI for read-only retrieval, never judgment (akiflow/harness-facts.md § Model tiers). ' +
        `Defaults to mode "plan" (read-only by mechanism) and model "${DEFAULT_MODEL}" (fast, wide-context discovery tier). ` +
        'Other modes must be allowlisted in setting.json under agy.allowedModes before use. Name exact paths and the exact ' +
        "output shape in the prompt — agy's workspace index can resolve files outside cwd, so cwd is not a hard scope boundary. " +
        'prompt is passed straight to agy as one argument — no shell quoting, spaces/punctuation are safe as-is.',
      inputSchema: {
        prompt: z.string(),
        mode: z.string().optional().describe('agy --mode, defaults to "plan"'),
        model: z.string().optional().describe(`agy --model, defaults to "${DEFAULT_MODEL}". Valid ids: gemini-3.7-flash-{low,medium,high}, gemini-3.6-flash-{low,medium,high}, gemini-3.5-flash-{low,medium,high}, gemini-3.1-pro-{low,high}, claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium`),
        effort: z.enum(['low', 'medium', 'high']).optional().describe('agy --effort, thinking budget'),
        outputFormat: z.enum(['text', 'json']).optional().describe('agy --output-format, use "json" when a program parses the result'),
        cwd: z.string().optional().describe('run inside this project dir; must be under an allowed root'),
      },
    },
    async ({ prompt, mode, model, effort, outputFormat, cwd }) => {
      const useMode = mode ?? 'plan';
      const allowed = loadAllowedModes();
      if (!allowed.includes(useMode)) {
        return err(`rejected: mode "${useMode}" is not allowlisted (allowed: ${allowed.join(', ')})`);
      }
      const r = resolveOrFail(cwd);
      if (!r.ok) return fail(r.error);
      const dir = r.dir;
      // -p takes the prompt as its value and must come last — anything after it is silently swallowed as part of the prompt, not parsed as a flag (harness-facts.md § Cross-CLI worker, the flag-order trap).
      const args = ['--mode', useMode, '--model', model ?? DEFAULT_MODEL];
      if (effort) args.push('--effort', effort);
      if (outputFormat) args.push('--output-format', outputFormat);
      args.push('-p', prompt);
      return run(args, dir);
    },
  );
}
