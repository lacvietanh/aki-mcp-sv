#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { parseModels, parseHelpEnum, newestFlashMedium, probe } from '../scripts/agy-capabilities.js';

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

  console.log('agy-capabilities.test.js: ok');
}

await runTests();
