// Dedicated MCP tool for the `agy` CLI: passes prompt/model/mode as separate execFile args so no shell-tokenizing step can mis-split a multi-word -p prompt (the reason it is not routed through the generic shell tool). Modes are allowlisted via allowlist.js.
// The interface holds NO model list and no effort/mode/output-format enum: the valid values are server-side and change without an agy release, so they are read live by scripts/agy-capabilities.js and the values are passed straight to agy, which validates them (docs/plan/done/audit-tool-drift-oct25.md D1-D5). The only pre-spawn checks are AkiMCP's own mode allowlist and that no value starts with "-".
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { readSettings } from './allowlist.js';
import { findOnPath } from './find-on-path.js';
import { resolveOrFail } from './roots.js';
import { ok, err, fail } from './mcp-tool.js';
import { capabilities, refresh, newestFlashMedium } from './agy-capabilities.js';

// 'plan' is agy's non-mutating mode — the only one enabled out of the box. Anything else must be explicitly opted into via setting.json -> { "agy": { "allowedModes": [...] } }.
const DEFAULT_MODES = ['plan'];

// A value agy would read as one more flag (`--mode=…` after the allowlisted --mode) is refused before spawn, so the allowlist stays the only way to pick a mode.
const agyValue = z.string().regex(/^[^-]/, 'must not start with "-"');

function loadAllowedModes() {
  const configured = readSettings().agy?.allowedModes;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_MODES;
}

// D3: the model to pass, resolved at call time. The owner's explicit setting.json pick wins (not pre-validated); else the newest gemini-<n>-flash-medium the probe found; else null, so --model is omitted and agy uses its own default.
async function resolveModel(explicit, cwd) {
  if (explicit) return explicit;
  const configured = readSettings().agy?.defaultModel;
  if (typeof configured === 'string' && configured) return configured;
  const caps = await capabilities({ cwd });
  return newestFlashMedium(caps.models);
}

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile('agy', args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // agy writes its own errors to stdout, not stderr — check stdout first or real failures show up as Node's generic "Command failed: <cmd>" with no explanation (see shell-mcp.js's same bug).
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

// agy rejects an unknown model/effort/output-format naming the field (spike 2026-10-25: "invalid model selection … conflicts with --effort"). On such a failure, refresh the probe once (the list may have moved server-side) and return agy's own error plus the live valid values, so the caller sees what agy accepts now without a second tool.
export const VALUE_COMPLAINT = /invalid (?:model|effort|output)|not a valid|unsupported|conflicts with --|unknown (?:model|effort|output|option|flag)/i;
async function runWithValueHelp(args, cwd) {
  const { result, said } = await run(args, cwd);
  if (!result.isError) return result;
  const message = result.content[0].text;
  if (!said || !VALUE_COMPLAINT.test(message)) return result;
  const caps = await refresh({ cwd });
  const models = caps.models ? caps.models.map((m) => m.id).join(', ') : 'unavailable (agy models did not parse)';
  const line = (label, values) => `${label}: ${values ? values.join(', ') : 'unavailable'}`;
  return err(`${message}\n\nagy rejected a value. Valid now (agy ${caps.version ?? '?'}):\n${line('models', caps.models ? caps.models.map((m) => m.id) : null)}\n${line('modes', caps.modes)}\n${line('effort', caps.efforts)}\n${line('output-format', caps.outputFormats)}\nnext: call agy_run with list="capabilities" for the full table.`);
}

function listReply(kind, caps, defaultModel, allowedModes) {
  const body = {
    agyVersion: caps.version,
    models: caps.models,
    modes: caps.modes,
    effort: caps.efforts,
    outputFormats: caps.outputFormats,
    resolvedDefaultModel: defaultModel,
    allowedModes,
    probedAt: new Date(caps.at).toISOString(),
  };
  if (kind === 'models') return ok(JSON.stringify({ models: caps.models, resolvedDefaultModel: defaultModel, agyVersion: caps.version }, null, 2));
  return ok(JSON.stringify(body, null, 2));
}

export const provider = {
  id: 'agy',
  title: 'Antigravity CLI (agy)',
  optIn: true,
  detect: () => (findOnPath('agy') ? { available: true } : { available: false, reason: 'agy is not on PATH' }),
  register,
};

// D4: the read-only promise is true only while 'plan' is the sole allowed mode; otherwise name the modes that can write. Built at registration from the allowlist; widening the modes takes a restart to redraw it.
function describe(modes) {
  const readOnly = modes.length === 1 && modes[0] === 'plan';
  const modeClause = readOnly
    ? 'Mode defaults to "plan" (read-only by mechanism). '
    : `Modes allowed: ${modes.join(', ')} — only "plan" is read-only; it is the default. `;
  return 'Delegate a task to the local agy CLI (read-only retrieval, never judgment). ' +
    modeClause +
    'Model defaults to the newest Gemini Flash (medium) discovery tier the installed CLI reports, not a pinned id (override: agy.defaultModel in setting.json). ' +
    'list="models"/"capabilities" (no prompt) reads the ids, modes, effort levels and formats the installed agy accepts now. ' +
    'model/effort/outputFormat pass straight to agy, which validates them; a rejected value returns agy\'s error and the live list. ' +
    "Name exact paths in the prompt — agy resolves files outside cwd, so cwd is not a hard boundary. prompt is one verbatim arg, no shell quoting.";
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
        list: z.enum(['models', 'capabilities']).optional().describe('read-only: return what the installed agy offers (no prompt spawned)'),
        mode: agyValue.optional().describe('agy --mode (agy validates; "plan" is read-only and the default). Modes beyond the allowlist in setting.json are refused here'),
        model: agyValue.optional().describe('agy --model (agy validates). Omitted → the discovery-tier default; use list="models" to see the ids'),
        effort: agyValue.optional().describe('agy --effort thinking budget (agy validates; use list="capabilities" for the levels)'),
        outputFormat: agyValue.optional().describe('agy --output-format (agy validates; use list="capabilities" for the formats). Use "json" when a program parses the result'),
        cwd: z.string().optional().describe('run inside this project dir; must be under an allowed root'),
      },
    },
    async ({ prompt, list, mode, model, effort, outputFormat, cwd }) => {
      const r = resolveOrFail(cwd);
      if (!r.ok) return fail(r.error);
      const dir = r.dir;
      const allowed = loadAllowedModes();

      if (list) {
        const caps = await capabilities({ cwd: dir });
        return listReply(list, caps, await resolveModel(undefined, dir), allowed);
      }
      if (!prompt || !String(prompt).trim()) {
        return err('rejected: prompt is required unless list="models" or list="capabilities" is set.');
      }

      const useMode = mode ?? 'plan';
      if (!allowed.includes(useMode)) {
        return err(`rejected: mode "${useMode}" is not allowlisted (allowed: ${allowed.join(', ')}). Set agy.allowedModes in setting.json to widen it.`);
      }

      const resolvedModel = await resolveModel(model, dir);
      const args = ['--mode', useMode];
      if (resolvedModel) args.push('--model', resolvedModel);
      if (effort) args.push('--effort', effort);
      if (outputFormat) args.push('--output-format', outputFormat);
      // -p takes the prompt as its value and must come last — anything after it is silently swallowed as part of the prompt, not parsed as a flag (docs/ref/harness-fact.md, the flag-order trap).
      args.push('-p', prompt);
      return runWithValueHelp(args, dir);
    },
  );
}
