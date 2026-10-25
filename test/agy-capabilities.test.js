#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { parseModels, parseHelpEnum, newestFlashMedium, probe, capabilities, refresh, resetCache } from '../scripts/agy-capabilities.js';
import { VALUE_COMPLAINT } from '../scripts/agy-mcp.js';
import { MODEL_COMPLAINT } from '../scripts/kiro-mcp.js';

// Recorded verbatim from this machine, agy 1.4.7, 2026-10-25 (docs/plan/audit-tool-drift-oct25.md § P0).
const MODELS_2026_10_25 = [
  'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-4-argon-low\tGemini 4 Argon (Low)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n') + '\n';

// `agy models` prints a progress line to stderr, but a buffered run can interleave it into stdout; it has no tab, so it must be dropped.
const MODELS_WITH_PROGRESS = 'Fetching available models...\n' + MODELS_2026_10_25;

const HELP_2026_10_25 = [
  '  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)',
  // The input-format row mentions "--output-format stream-json" mid-prose with its own (text, stream-json) list: a loose match would read output-format off this row and drop json.
  '  --input-format                  Input format for print mode (text, stream-json). stream-json reads one NDJSON message per line from stdin; it requires --output-format stream-json (default text)',
  '  --mode                          Set the agent execution mode for this session (accept-edits, auto, plan)',
  '  --output-format                 Output format for print mode (text, json, stream-json) (default text)',
  '  -p                              Short alias for --print',
].join('\n');

async function runTests() {
  // parseModels: 13 id/label rows, the progress line dropped.
  const models = parseModels(MODELS_WITH_PROGRESS);
  assert.equal(models.length, 13);
  assert.deepEqual(models[3], { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' });
  assert.ok(!models.some((m) => m.id.includes('Fetching')));

  // parseHelpEnum: the pipe list and the comma list both parse.
  assert.deepEqual(parseHelpEnum(HELP_2026_10_25, 'effort'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseHelpEnum(HELP_2026_10_25, 'mode'), ['accept-edits', 'auto', 'plan']);
  assert.deepEqual(parseHelpEnum(HELP_2026_10_25, 'output-format'), ['text', 'json', 'stream-json']);

  // newestFlashMedium: numeric compare, so 3.10 beats 3.9; a renamed family (argon) never matches.
  assert.equal(newestFlashMedium(models), 'gemini-3.8-flash-medium');
  assert.equal(newestFlashMedium([{ id: 'gemini-3.9-flash-medium' }, { id: 'gemini-3.10-flash-medium' }]), 'gemini-3.10-flash-medium');
  assert.equal(newestFlashMedium([{ id: 'gemini-4-argon-medium' }]), null);

  // Changed format: agy emits JSON one day instead of TAB lines, or help drops the enum — each list falls back to null (pass-through), never throws.
  assert.equal(parseModels('[{"id":"x"}]'), null);
  assert.equal(parseModels(''), null);
  assert.equal(parseHelpEnum('  --effort   Reasoning effort for the session', 'effort'), null);
  assert.equal(parseHelpEnum(HELP_2026_10_25, 'nonsuch'), null);

  // probe() with an injected spawn: never touches the real agy, each field reflects its command, a failed command → null.
  const fakeSpawn = (args) => {
    if (args[0] === '--version') return Promise.resolve({ ok: true, stdout: '1.4.7\n', stderr: '' });
    if (args[0] === 'models') return Promise.resolve({ ok: true, stdout: MODELS_2026_10_25, stderr: 'Fetching available models...' });
    return Promise.resolve({ ok: true, stdout: '', stderr: HELP_2026_10_25 });
  };
  const caps = await probe({ spawn: fakeSpawn });
  assert.equal(caps.version, '1.4.7');
  assert.equal(caps.models.length, 13);
  assert.deepEqual(caps.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(caps.modes, ['accept-edits', 'auto', 'plan']);
  assert.deepEqual(caps.outputFormats, ['text', 'json', 'stream-json']);

  const blindSpawn = () => Promise.resolve({ ok: false, stdout: '', stderr: '' });
  const blind = await probe({ spawn: blindSpawn });
  assert.equal(blind.version, null);
  assert.equal(blind.models, null);
  assert.equal(blind.efforts, null);
  assert.equal(blind.modes, null);

  // A failed models probe is retried after a minute, not an hour, and a failed refresh keeps the entry that has models.
  resetCache();
  await capabilities({ spawn: blindSpawn });
  assert.equal((await capabilities({ spawn: fakeSpawn })).models, null, 'inside the retry window the failure is reused');
  assert.equal((await capabilities({ spawn: fakeSpawn, now: () => Date.now() + 61_000 })).models.length, 13, 'after the retry window it probes again');
  assert.equal((await refresh({ spawn: blindSpawn })).models.length, 13, 'a failed refresh does not erase a good list');

  // The two CLI arms re-probe or point at the model list only for a complaint about the value, not for quota or the "Command failed" fallback that names the model.
  assert.ok(VALUE_COMPLAINT.test('invalid model selection: nope conflicts with --effort'));
  assert.ok(!VALUE_COMPLAINT.test('Resource exhausted: quota for model gemini-3.8-flash-medium'));
  assert.ok(!VALUE_COMPLAINT.test('Command failed: agy --mode plan --model gemini-3.8-flash-medium --effort high -p hello'));
  assert.ok(MODEL_COMPLAINT.test('Error: model claude-sonnet-4.5 not found'));
  assert.ok(!MODEL_COMPLAINT.test('Rate limit: quota exhausted for model claude-sonnet-4.5'));
  assert.ok(!MODEL_COMPLAINT.test('Command failed: kiro-cli chat --no-interactive --model claude-sonnet-4.5 --trust-tools=fs_read hello'));

  console.log('agy-capabilities.test.js: ok');
}

await runTests();
