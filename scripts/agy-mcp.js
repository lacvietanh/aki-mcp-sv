// MCP provider for the local Antigravity CLI (`agy`). Contract: docs/plan/done/audit-tool-drift-oct25.md and docs/plan/done/agy-run-tier-and-long-run.md.
// Runs `agy` directly with execFile / detached spawn (never through a shell), defaults to --mode plan (read-only by mechanism), and discovers models/modes/effort/formats plus account/tier/quota live via agy-capabilities.js.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { resolveOrFail } from './roots.js';
import { readSettings } from './allowlist.js';
import { findOnPath } from './find-on-path.js';
import { ok, err, fail } from './mcp-tool.js';
import { served } from './mcp-name.js';
import { capabilities, refresh, defaultFlashModel, explainMissingModel } from './agy-capabilities.js';
import { startBackgroundProcess } from './task-mcp.js';

const DEFAULT_MODES = ['plan'];
const DEFAULT_SYNC_TIMEOUT_SEC = 120;
const MAX_SYNC_TIMEOUT_SEC = 600;
const DEFAULT_BG_TIMEOUT_SEC = 1800;
const MAX_BG_TIMEOUT_SEC = 1800;
const MIN_TIMEOUT_SEC = 10;
const MAX_CONCURRENT_AGY_BG = 4;

// A caller value starting with "-" would be parsed by agy as another flag. Refusing it before spawn keeps the allowlist the sole way to pick a mode.
const agyValue = z.string().regex(/^[^-]/, 'must not start with "-"');

function loadAllowedModes() {
  const configured = readSettings().agy?.allowedModes;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_MODES;
}

// Model resolved at call time (D2/B5a): explicit arg wins; else setting.json agy.defaultModel; else newest Flash high (fallback medium) from caps (passed in by list to avoid double-spawn).
async function resolveModel(explicit, cwd, caps = null) {
  if (explicit) return explicit;
  const configured = readSettings().agy?.defaultModel;
  if (typeof configured === 'string' && configured) return configured;
  const resolvedCaps = caps ?? await capabilities({ cwd });
  return defaultFlashModel(resolvedCaps.models);
}

function run(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile('agy', args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed && !stdout?.trim()) {
          return resolve({
            result: err(`agy timed out after ${Math.round(timeoutMs / 1000)}s. Retry with a higher timeoutSec (up to ${MAX_SYNC_TIMEOUT_SEC}s) or background=true (track via ${served('task_manage')}).`),
            said: false,
          });
        }
        // agy writes its own errors to stdout, not stderr — check stdout first so real failures do not show as generic "Command failed".
        return resolve({ result: err(stdout || stderr || error.message), said: Boolean(stdout || stderr) });
      }
      // agy headless can't prompt for permission: a denied action auto-fails but still exits 0 with an empty response (docs/ref/harness-fact.md). Treat empty stdout as inconclusive, not clean.
      if (!stdout || !stdout.trim()) {
        return resolve({ result: err('agy returned no output — the call may have been silently denied rather than a clean empty result. Re-check the prompt/scope.') });
      }
      resolve({ result: ok(stdout) });
    });
  });
}

// Value/tier complaint detector (B1): anchored to model/tier context so `--mode plan` in a generic "Command failed" line never false-matches.
export const VALUE_COMPLAINT = /invalid (?:model|effort|output)|not a valid|unsupported|conflicts with --|unknown (?:model|effort|output|option|flag)|(?<!-)\bmodel\b(?:(?!\s--).){0,40}\b(?:not available|not found|requires|plan|tier|entitlement)\b|(?<!mode\s)\b(?:plan|tier|entitlement)\b(?:(?!\s--).){0,40}(?<!-)\bmodel\b/i;

async function runWithValueHelp(args, cwd, timeoutMs, explicitModel) {
  const { result, said } = await run(args, cwd, timeoutMs);
  if (!result.isError) return result;
  const message = result.content[0].text;
  if (!said || !VALUE_COMPLAINT.test(message)) return result;
  const caps = await refresh({ cwd });
  const tierHint = explicitModel && Array.isArray(caps.models) && !caps.models.some((m) => m.id === explicitModel)
    ? `\n\n${explainMissingModel(explicitModel, caps.planTier, caps.models).message}`
    : '';
  const line = (label, values) => `${label}: ${values ? values.join(', ') : 'unavailable'}`;
  return err(`${message}${tierHint}\n\nagy rejected a value. Valid now (agy ${caps.version ?? '?'}${caps.planTier ? `, plan: ${caps.planTier}` : ''}):\n${line('models', caps.models ? caps.models.map((m) => m.id) : null)}\n${line('modes', caps.modes)}\n${line('effort', caps.efforts)}\n${line('output-format', caps.outputFormats)}\nnext: call ${served('agy_run')} with list="capabilities" for the full table.`);
}

// Pre-flight check for an explicit model (B2/B3/D3): refreshes once when absent from cache before rejecting with a clear tier/model explanation.
async function validateExplicitModel(explicitModel, cwd, { verifyAccount }) {
  if (!explicitModel) return null;
  let caps = await capabilities({ cwd, verifyAccount });
  if (!Array.isArray(caps.models)) return null;
  if (caps.models.some((m) => m.id === explicitModel)) return null;
  caps = await refresh({ cwd });
  if (!Array.isArray(caps.models)) return null;
  if (caps.models.some((m) => m.id === explicitModel)) return null;
  return err(explainMissingModel(explicitModel, caps.planTier, caps.models).message);
}

function listReply(kind, caps, defaultModel, allowedModes) {
  if (kind === 'models') {
    return ok(JSON.stringify({
      account: caps.account,
      planTier: caps.planTier,
      quota: caps.quota,
      models: caps.models,
      resolvedDefaultModel: defaultModel,
      agyVersion: caps.version,
    }, null, 2));
  }
  const body = {
    agyVersion: caps.version,
    account: caps.account,
    planTier: caps.planTier,
    quota: caps.quota,
    models: caps.models,
    modes: caps.modes,
    effort: caps.efforts,
    outputFormats: caps.outputFormats,
    resolvedDefaultModel: defaultModel,
    allowedModes,
    probedAt: new Date(caps.at).toISOString(),
  };
  return ok(JSON.stringify(body, null, 2));
}

export const provider = {
  id: 'agy',
  title: 'Antigravity CLI (agy)',
  optIn: true,
  detect: () => (findOnPath('agy') ? { available: true } : { available: false, reason: 'agy is not on PATH' }),
  register,
};

// Built at registration from the allowlist; widening agy.allowedModes takes a restart to redraw description and readOnlyHint (N5).
// readOnlyHint stays true while 'plan' is the sole allowed mode: background=true writes only bookkeeping/log files under USER_DIR, never repository files (B4b).
function describe(modes) {
  const readOnly = modes.length === 1 && modes[0] === 'plan';
  const modeClause = readOnly
    ? 'Default mode: "plan" (read-only by mechanism). '
    : `Modes allowed: ${modes.join(', ')} — only "plan" is read-only; it is the default. `;
  return 'Delegate to local agy CLI. Flash tier (default: newest Flash high, override agy.defaultModel): retrieval/reading only, never judgment. ' +
    'Pro-tier models: single-turn advisory with mode="plan" when the active plan includes them (check list="capabilities" for account/tier/quota). ' +
    modeClause +
    'Include a BLOCKED-on-tool-failure clause in prompt and treat empty output as silent denial. ' +
    `Long runs (>2m): set background=true and track via ${served('task_manage')}. ` +
    'Name exact paths (agy resolves outside cwd); prompt is one verbatim arg.';
}

export function register(server) {
  const modes = loadAllowedModes();
  server.registerTool(
    'agy_run',
    {
      title: 'Antigravity CLI',
      annotations: { readOnlyHint: modes.length === 1 && modes[0] === 'plan', destructiveHint: false, openWorldHint: false },
      description: describe(modes),
      inputSchema: {
        prompt: z.string().optional().describe('the task for agy; required unless list is set'),
        list: z.enum(['models', 'capabilities']).optional().describe('read-only: return models/capabilities plus active account, plan tier and quota (no prompt spawned)'),
        mode: agyValue.optional().describe('agy --mode (agy validates; "plan" is read-only and the default). Modes beyond the allowlist in setting.json are refused here'),
        model: agyValue.optional().describe('agy --model (agy validates). Omitted → the discovery-tier default; use list="models" to see the ids'),
        effort: agyValue.optional().describe('agy --effort thinking budget (agy validates; use list="capabilities" for the levels)'),
        outputFormat: agyValue.optional().describe('agy --output-format (agy validates; use list="capabilities" for the formats). Use "json" when a program parses the result'),
        cwd: z.string().optional().describe('run inside this project dir; must be under an allowed root'),
        background: z.boolean().optional().describe('run detached in background (defaults outputFormat="json", up to 1800s); track via ' + served('task_manage')),
        timeoutSec: z.number().int().min(MIN_TIMEOUT_SEC).max(MAX_BG_TIMEOUT_SEC).optional().describe('timeout in seconds (sync 10..600 default 120; background 10..1800 default 1800)'),
      },
    },
    async ({ prompt, list, mode, model, effort, outputFormat, cwd, background, timeoutSec }) => {
      const r = resolveOrFail(cwd);
      if (!r.ok) return fail(r.error);
      const dir = r.dir;
      const allowed = loadAllowedModes();

      if (list) {
        const caps = await capabilities({ cwd: dir, includeUsage: true });
        return listReply(list, caps, await resolveModel(undefined, dir, caps), allowed);
      }
      if (!prompt || !String(prompt).trim()) {
        return err('rejected: prompt is required unless list="models" or list="capabilities" is set.');
      }

      const useMode = mode ?? 'plan';
      if (!allowed.includes(useMode)) {
        return err(`rejected: mode "${useMode}" is not allowlisted (allowed: ${allowed.join(', ')}). Set agy.allowedModes in setting.json to widen it.`);
      }

      if (background) {
        // Q1 / N1: dynamic import avoids circular dependency with provider-registry.js.
        const { providerServed } = await import('./provider-registry.js');
        if (!providerServed('task')) {
          return err(`rejected: background=true requires the task provider (${served('task_manage')}) to be enabled. Switch "task" on in the control panel (section 4) or run synchronously with timeoutSec (up to ${MAX_SYNC_TIMEOUT_SEC}s).`);
        }

        const rejected = await validateExplicitModel(model, dir, { verifyAccount: true });
        if (rejected) return rejected;

        const resolvedModel = await resolveModel(model, dir);
        const useFormat = outputFormat ?? 'json';
        const bgTimeoutSec = timeoutSec ?? DEFAULT_BG_TIMEOUT_SEC;
        const args = ['--mode', useMode];
        if (resolvedModel) args.push('--model', resolvedModel);
        if (effort) args.push('--effort', effort);
        args.push('--output-format', useFormat);
        args.push('--print-timeout', String(bgTimeoutSec));
        // -p takes the prompt as its value and must come last (docs/ref/harness-fact.md).
        args.push('-p', prompt);

        // N2: keep long prompts out of tasks.json — record a compact summary only.
        const summaryCmd = `agy --mode ${useMode}${resolvedModel ? ` --model ${resolvedModel}` : ''} (prompt: ${prompt.length} chars)`;
        try {
          const started = await startBackgroundProcess({
            bin: 'agy',
            args,
            cwd: dir,
            command: summaryCmd,
            kind: 'agy',
            storeArgs: false,
            separateStderr: true,
            maxConcurrentKind: MAX_CONCURRENT_AGY_BG,
            meta: {
              model: resolvedModel,
              mode: useMode,
              outputFormat: useFormat,
              printTimeoutSec: bgTimeoutSec,
            },
          });
          return ok(JSON.stringify({
            ...started,
            kind: 'agy',
            model: resolvedModel,
            mode: useMode,
            outputFormat: useFormat,
            printTimeoutSec: bgTimeoutSec,
            next: `poll with ${served('task_manage')} action="status"|"tail_logs"|"stop"`,
          }, null, 2));
        } catch (e) {
          return fail(e);
        }
      }

      if (timeoutSec !== undefined && timeoutSec > MAX_SYNC_TIMEOUT_SEC) {
        return err(`rejected: timeoutSec ${timeoutSec} exceeds the ${MAX_SYNC_TIMEOUT_SEC}s synchronous ceiling. Use background=true (up to ${MAX_BG_TIMEOUT_SEC}s) and track via ${served('task_manage')}.`);
      }

      const rejected = await validateExplicitModel(model, dir, { verifyAccount: false });
      if (rejected) return rejected;

      const resolvedModel = await resolveModel(model, dir);
      const syncTimeoutMs = (timeoutSec ?? DEFAULT_SYNC_TIMEOUT_SEC) * 1000;
      const args = ['--mode', useMode];
      if (resolvedModel) args.push('--model', resolvedModel);
      if (effort) args.push('--effort', effort);
      if (outputFormat) args.push('--output-format', outputFormat);
      // -p takes the prompt as its value and must come last — anything after it is silently swallowed as part of the prompt, not parsed as a flag (docs/ref/harness-fact.md, the flag-order trap).
      args.push('-p', prompt);
      return runWithValueHelp(args, dir, syncTimeoutMs, model);
    },
  );
}
