#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as agyCaps from '../scripts/agy-capabilities.js';
import {
  parseModels,
  parseHelpEnum,
  defaultFlashModel,
  parseAuthEmail,
  parseUsageJson,
  parseFrameText,
  readLocalPlanTier,
  readLocalQuotaFrame,
  explainMissingModel,
  runUsageProbe,
  probe,
  capabilities,
  refresh,
  createCapabilitiesStore,
} from '../scripts/agy-capabilities.js';
import { VALUE_COMPLAINT } from '../scripts/agy-mcp.js';
import { MODEL_COMPLAINT } from '../scripts/kiro-mcp.js';

// Recorded from agy 1.5.14 on Google AI Pro (2026-11-21).
const MODELS_PRO_2026_11_21 = [
  'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-high\tGemini 4 Neon (High)',
  'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
  'gemini-4-argon-low\tGemini 4 Argon (Low)',
  'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
  'gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
  'gemini-pro-orchestrator-neon\tGemini Pro Orchestrator (Neon)',
  'gemini-pro-orchestrator-g1-pro\tGemini Pro Orchestrator (G1 Pro)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n') + '\n';

const MODELS_STARTER = [
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n') + '\n';

const MODELS_WITH_PROGRESS = 'Fetching available models...\n' + MODELS_PRO_2026_11_21;

const HELP_2026_11_21 = [
  '  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)',
  // The input-format row mentions "--output-format stream-json" mid-prose with its own (text, stream-json) list.
  '  --input-format                  Input format for print mode (text, stream-json). stream-json reads one NDJSON message per line from stdin; it requires --output-format stream-json (default text)',
  '  --log-file                      Write CLI logs to a file',
  '  --mode                          Set the agent execution mode for this session (accept-edits, auto, plan)',
  '  --output-format                 Output format for print mode (text, json, stream-json) (default text)',
  '  --print-timeout                 Timeout for print mode (default 0s)',
  '  -p                              Short alias for --print',
].join('\n');

// Recorded verbatim structure from 0-token `agy -p "/usage" --output-format json` (agy 1.5.14, 2026-11-21, B5c).
const LIVE_USAGE_JSON = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  response: 'Gemini Models\tWeekly Limit Remaining\t85%\t2026-11-28T12:30:24Z\n',
  duration_seconds: 0,
  num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.85, reset_time: '2026-11-28T12:30:24Z' },
            { id: 'gemini-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.5, reset_time: '2026-11-21T17:30:24Z' },
          ],
        },
        {
          name: 'Gemini 4 Argon',
          buckets: [
            { id: 'gemini-argon-wtu-weekly', name: 'Gemini 4 Argon Weekly Limit', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-28T16:57:25Z' },
          ],
        },
      ],
    },
  },
});

// Recorded verbatim 2-line NDJSON structure from ~/.gemini/antigravity-cli/rate-limits/<email>.frame (B5c).
const FRAME_TEXT = [
  JSON.stringify({ email: 'pro@example.com', userTier: { name: 'Google AI Pro' } }),
  JSON.stringify({
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [
              { id: 'gemini-5h', window: '5h', remaining_fraction: 0.88, reset_time: '2026-11-21T20:14:55Z' },
              { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.94, reset_time: '2026-11-28T15:14:55Z' },
            ],
          },
        ],
      },
    },
  }),
].join('\n') + '\n';

async function runTests() {
  // Q3: newestFlashMedium removed completely with no backward-compat alias.
  assert.equal('newestFlashMedium' in agyCaps, false, 'newestFlashMedium export must be removed');

  // parseModels: drops progress line and parses id/label rows.
  const proModels = parseModels(MODELS_WITH_PROGRESS);
  assert.equal(proModels.length, 23);
  assert.ok(!proModels.some((m) => m.id.includes('Fetching')));

  // parseHelpEnum: pipe list and comma list both parse.
  assert.deepEqual(parseHelpEnum(HELP_2026_11_21, 'effort'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseHelpEnum(HELP_2026_11_21, 'mode'), ['accept-edits', 'auto', 'plan']);
  assert.deepEqual(parseHelpEnum(HELP_2026_11_21, 'output-format'), ['text', 'json', 'stream-json']);

  // defaultFlashModel: prefers newest flash-high (numeric compare 3.10 > 3.9), falls back to flash-medium, ignores non-flash.
  assert.equal(defaultFlashModel(proModels), 'gemini-3.8-flash-high');
  assert.equal(defaultFlashModel([{ id: 'gemini-3.9-flash-high' }, { id: 'gemini-3.10-flash-high' }]), 'gemini-3.10-flash-high');
  assert.equal(defaultFlashModel([{ id: 'gemini-3.8-flash-low' }, { id: 'gemini-3.8-flash-medium' }]), 'gemini-3.8-flash-medium');
  assert.equal(defaultFlashModel([{ id: 'gemini-4-argon-high' }]), null);

  // Changed format falls back to null (pass-through), never throws.
  assert.equal(parseModels('[{"id":"x"}]'), null);
  assert.equal(parseModels(''), null);
  assert.equal(parseHelpEnum('  --effort   Reasoning effort for the session', 'effort'), null);
  assert.equal(parseHelpEnum(HELP_2026_11_21, 'nonsuch'), null);

  // parseAuthEmail: reads authenticated OAuth email from --log-file, takes last valid match, rejects traversal.
  const sampleLog = [
    'I1121 22:22:28.100 1 server_oauth.go:226] OAuth: authenticated successfully as old@example.com',
    'I1121 22:22:28.867 1 server_oauth.go:226] OAuth: authenticated successfully as Pro.User@Example.com',
  ].join('\n');
  assert.equal(parseAuthEmail(sampleLog), 'Pro.User@Example.com');
  assert.equal(parseAuthEmail('OAuth: authenticated successfully as ../../etc/passwd'), null);
  assert.equal(parseAuthEmail('no auth line here'), null);

  // B5c: parseUsageJson and parseFrameText map remaining_fraction -> remainingFraction, reset_time -> resetTime.
  const liveUsage = parseUsageJson(LIVE_USAGE_JSON);
  assert.equal(liveUsage.source, 'live');
  assert.equal(liveUsage.groups.length, 2);
  assert.deepEqual(liveUsage.groups[0].buckets[0], {
    id: 'gemini-weekly',
    name: 'Weekly Limit Remaining',
    window: 'weekly',
    remainingFraction: 0.85,
    resetTime: '2026-11-28T12:30:24Z',
  });

  const parsedFrame = parseFrameText(FRAME_TEXT);
  assert.equal(parsedFrame.email, 'pro@example.com');
  assert.equal(parsedFrame.planTier, 'Google AI Pro');
  assert.deepEqual(parsedFrame.groups[0].buckets[0], {
    id: 'gemini-5h',
    window: '5h',
    remainingFraction: 0.88,
    resetTime: '2026-11-21T20:14:55Z',
  });

  // N3: local tier + .frame readers in isolated HOME (exact + lowercase fallback, traversal refusal, size cap, 6h TTL).
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cap-home-'));
  try {
    const tierDir = path.join(fakeHome, '.gemini', 'antigravity-cli', 'aki-plan-tier');
    const rateDir = path.join(fakeHome, '.gemini', 'antigravity-cli', 'rate-limits');
    fs.mkdirSync(tierDir, { recursive: true });
    fs.mkdirSync(rateDir, { recursive: true });
    fs.writeFileSync(path.join(tierDir, 'pro@example.com'), 'Google AI Pro\n');
    fs.writeFileSync(path.join(tierDir, 'huge@example.com'), 'x'.repeat(5000));
    const framePath = path.join(rateDir, 'pro@example.com.frame');
    fs.writeFileSync(framePath, FRAME_TEXT);
    fs.writeFileSync(path.join(rateDir, 'huge@example.com.frame'), 'x'.repeat(300 * 1024));

    assert.equal(readLocalPlanTier('pro@example.com', { homeDir: fakeHome }), 'Google AI Pro');
    assert.equal(readLocalPlanTier('Pro@Example.com', { homeDir: fakeHome }), 'Google AI Pro', 'falls back to lowercase filename');
    assert.equal(readLocalPlanTier('../pro@example.com', { homeDir: fakeHome }), null, 'traversal rejected');
    assert.equal(readLocalPlanTier('huge@example.com', { homeDir: fakeHome }), null, 'tier file over 4 KB skipped');

    const nowMs = Date.now();
    const freshFrame = readLocalQuotaFrame('Pro@Example.com', { homeDir: fakeHome, now: () => nowMs });
    assert.equal(freshFrame.planTier, 'Google AI Pro');
    assert.equal(freshFrame.quota.source, 'frame');
    assert.equal(freshFrame.quota.groups[0].buckets[0].remainingFraction, 0.88);

    const staleFrame = readLocalQuotaFrame('pro@example.com', { homeDir: fakeHome, now: () => nowMs + 7 * 60 * 60_000 });
    assert.equal(staleFrame.planTier, 'Google AI Pro', 'line 1 planTier still readable when frame quota is stale');
    assert.equal(staleFrame.quota, null, 'frame quota older than 6 h is dropped');
    assert.equal(readLocalQuotaFrame('huge@example.com', { homeDir: fakeHome }), null, 'frame file over 256 KB skipped');

    // Per-account 1h cache isolation + 30s /usage micro-TTL.
    const multiStore = createCapabilitiesStore();
    let clock = 1_000_000;
    let activeAccount = 'pro@example.com';
    let modelProbeCount = 0;
    let usageProbeCount = 0;

    const multiSpawn = (args) => {
      if (args[0] === '--version') return Promise.resolve({ ok: true, stdout: '1.5.14\n', stderr: '' });
      if (args[0] === 'models') {
        modelProbeCount++;
        return Promise.resolve({ ok: true, stdout: activeAccount === 'pro@example.com' ? MODELS_PRO_2026_11_21 : MODELS_STARTER, stderr: '' });
      }
      return Promise.resolve({ ok: true, stdout: '', stderr: HELP_2026_11_21 });
    };
    const multiUsage = () => {
      usageProbeCount++;
      return Promise.resolve({
        ok: true,
        account: activeAccount,
        groups: parseUsageJson(LIVE_USAGE_JSON).groups,
      });
    };

    const proCaps1 = await capabilities({ spawn: multiSpawn, probeUsage: multiUsage, homeDir: fakeHome, now: () => clock, includeUsage: true, store: multiStore });
    assert.equal(proCaps1.account, 'pro@example.com');
    assert.equal(proCaps1.planTier, 'Google AI Pro');
    assert.equal(proCaps1.models.length, 23);
    assert.equal(proCaps1.quota.source, 'live');
    assert.equal(modelProbeCount, 1);
    assert.equal(usageProbeCount, 1);

    // Within 30s micro-TTL: neither /usage nor models re-probes.
    clock += 10_000;
    const proCaps2 = await capabilities({ spawn: multiSpawn, probeUsage: multiUsage, homeDir: fakeHome, now: () => clock, includeUsage: true, store: multiStore });
    assert.equal(proCaps2.account, 'pro@example.com');
    assert.equal(usageProbeCount, 1, '/usage reused within 30s micro-TTL');
    assert.equal(modelProbeCount, 1);

    // Switch account after micro-TTL expires: probes models for Starter without polluting Pro cache.
    fs.writeFileSync(path.join(tierDir, 'starter@example.com'), 'Antigravity Starter Quota\n');
    activeAccount = 'starter@example.com';
    clock += 31_000;
    const starterCaps = await capabilities({ spawn: multiSpawn, probeUsage: multiUsage, homeDir: fakeHome, now: () => clock, includeUsage: true, store: multiStore });
    assert.equal(starterCaps.account, 'starter@example.com');
    assert.equal(starterCaps.planTier, 'Antigravity Starter Quota');
    assert.equal(starterCaps.models.length, 5);
    assert.equal(usageProbeCount, 2);
    assert.equal(modelProbeCount, 2);

    // Switch back to Pro within 1h: Pro cache is still hot (modelProbeCount stays 2).
    activeAccount = 'pro@example.com';
    clock += 31_000;
    const proAgain = await capabilities({ spawn: multiSpawn, probeUsage: multiUsage, homeDir: fakeHome, now: () => clock, includeUsage: true, store: multiStore });
    assert.equal(proAgain.models.length, 23);
    assert.equal(usageProbeCount, 3);
    assert.equal(modelProbeCount, 2, 'Pro account cache stayed isolated and warm');

    // refresh() bypasses the 30s /usage micro-TTL immediately.
    clock += 1_000;
    await refresh({ spawn: multiSpawn, probeUsage: multiUsage, homeDir: fakeHome, now: () => clock, store: multiStore });
    assert.equal(usageProbeCount, 4, 'refresh() bypasses 30s /usage micro-TTL');
    assert.equal(modelProbeCount, 3);

    // Live /usage fails -> falls back to fresh .frame quota.
    const fallbackCaps = await capabilities({
      spawn: multiSpawn,
      probeUsage: () => Promise.resolve({ ok: false, account: 'pro@example.com', groups: null }),
      homeDir: fakeHome,
      now: () => nowMs,
      includeUsage: true,
      store: createCapabilitiesStore(),
    });
    assert.equal(fallbackCaps.quota.source, 'frame');
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }

  // probe() + retry window + failed refresh preserves good models.
  const fakeSpawn = (args) => {
    if (args[0] === '--version') return Promise.resolve({ ok: true, stdout: '1.5.14\n', stderr: '' });
    if (args[0] === 'models') return Promise.resolve({ ok: true, stdout: MODELS_PRO_2026_11_21, stderr: 'Fetching available models...' });
    return Promise.resolve({ ok: true, stdout: '', stderr: HELP_2026_11_21 });
  };
  const blindSpawn = () => Promise.resolve({ ok: false, stdout: '', stderr: '' });
  const blind = await probe({ spawn: blindSpawn });
  assert.equal(blind.version, null);
  assert.equal(blind.models, null);

  const retryStore = createCapabilitiesStore();
  await capabilities({ spawn: blindSpawn, store: retryStore });
  assert.equal((await capabilities({ spawn: fakeSpawn, store: retryStore })).models, null, 'inside the retry window the failure is reused');
  assert.equal((await capabilities({ spawn: fakeSpawn, now: () => Date.now() + 61_000, store: retryStore })).models.length, 23, 'after the retry window it probes again');
  assert.equal((await refresh({ spawn: blindSpawn, store: retryStore })).models.length, 23, 'a failed refresh does not erase a good list');

  // explainMissingModel — plan_mismatch only when planTier is null or does not satisfy required plans.
  const starterModels = parseModels(MODELS_STARTER);
  const m1 = explainMissingModel('gemini-4-neon-high', 'Antigravity Starter Quota', starterModels);
  assert.equal(m1.kind, 'plan_mismatch');
  assert.match(m1.message, /Antigravity Starter Quota/);
  assert.match(m1.message, /Google AI Pro/);

  const m2 = explainMissingModel('gemini-4-carbon-high', 'Google AI Pro', proModels);
  assert.equal(m2.kind, 'plan_mismatch');
  assert.match(m2.message, /Google AI Ultra/);

  const m3 = explainMissingModel('gemini-4-neon-high', null, starterModels);
  assert.equal(m3.kind, 'plan_mismatch');
  assert.match(m3.message, /unknown plan/);

  const m4 = explainMissingModel('gemini-4-neon-typo', 'Google AI Pro', proModels);
  assert.equal(m4.kind, 'unknown_model', 'Pro user typing wrong Pro model id gets unknown_model, not plan_mismatch');
  assert.doesNotMatch(m4.message, /available on:/);

  const m5 = explainMissingModel('gemini-3.8-flash-typo', 'Antigravity Starter Quota', starterModels);
  assert.equal(m5.kind, 'unknown_model', 'un-gated flash family has no plan-mismatch row');

  // B1: VALUE_COMPLAINT anchored to model/tier context; --mode plan must stay false.
  assert.ok(VALUE_COMPLAINT.test('invalid model selection: nope conflicts with --effort'));
  assert.ok(VALUE_COMPLAINT.test('Error: model gemini-4-neon-high is not available on your current plan'));
  assert.ok(VALUE_COMPLAINT.test('Error: plan tier does not include model gemini-4-argon-high'));
  assert.ok(!VALUE_COMPLAINT.test('Resource exhausted: quota for model gemini-3.8-flash-high'));
  assert.ok(!VALUE_COMPLAINT.test('Command failed: agy --mode plan --model gemini-3.8-flash-high --effort high -p hello'));
  assert.ok(!VALUE_COMPLAINT.test('Command failed: agy --mode plan -p hello'));

  // kiro MODEL_COMPLAINT unchanged.
  assert.ok(MODEL_COMPLAINT.test('Error: model claude-sonnet-4.5 not found'));
  assert.ok(!MODEL_COMPLAINT.test('Rate limit: quota exhausted for model claude-sonnet-4.5'));
  assert.ok(!MODEL_COMPLAINT.test('Command failed: kiro-cli chat --no-interactive --model claude-sonnet-4.5 --trust-tools=fs_read hello'));

  // runUsageProbe timeout/SIGKILL branch: kills hung child and removes tmpDir cleanly after close.
  const probeTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-probe-timeout-')));
  const probeBin = path.join(probeTmp, 'bin');
  const markerFile = path.join(probeTmp, 'marker.json');
  fs.mkdirSync(probeBin, { recursive: true });
  const stubJs = path.join(probeBin, 'agy-hang.cjs');
  fs.writeFileSync(stubJs, "const fs = require('node:fs');\nconst path = require('node:path');\nconst args = process.argv.slice(2);\nconst idx = args.indexOf('--log-file');\nconst logFile = idx !== -1 ? args[idx + 1] : null;\nif (logFile) {\n  fs.writeFileSync(logFile, 'probe started\\n');\n  fs.writeFileSync(process.env.FAKE_PROBE_MARKER, JSON.stringify({ tmpDir: path.dirname(logFile), pid: process.pid }));\n}\nsetTimeout(() => {}, 15000);\n");
  fs.writeFileSync(path.join(probeBin, 'agy'), "#!/bin/sh\nLOG=\"\"\nwhile [ \"$#\" -gt 0 ]; do\n  if [ \"$1\" = \"--log-file\" ]; then LOG=\"$2\"; shift 2; continue; fi\n  shift\ndone\nif [ -n \"$LOG\" ]; then\n  printf 'probe started\\n' > \"$LOG\"\n  printf '{\"tmpDir\":\"%s\",\"pid\":%s}\\n' \"$(dirname \"$LOG\")\" \"$$\" > \"$FAKE_PROBE_MARKER\"\nfi\nexec sleep 15\n", { mode: 0o755 });
  fs.writeFileSync(path.join(probeBin, 'agy.cmd'), '@"' + process.execPath + '" "' + stubJs + '" %*\r\n');
  const prevPath = process.env.PATH;
  const prevMarker = process.env.FAKE_PROBE_MARKER;
  let recorded = null;
  try {
    process.env.PATH = probeBin + path.delimiter + prevPath;
    process.env.FAKE_PROBE_MARKER = markerFile;
    const t0 = Date.now();
    const probeRes = await runUsageProbe({ timeoutMs: 800 });
    const elapsed = Date.now() - t0;
    assert.equal(probeRes.ok, false, 'timed-out runUsageProbe must return ok: false');
    assert.ok(elapsed < 2500, 'timed-out runUsageProbe must abort promptly, got ' + elapsed + 'ms');
    const waitDeadline = Date.now() + 2000;
    while (Date.now() < waitDeadline) {
      if (fs.existsSync(markerFile)) {
        recorded = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
        let alive = false;
        try { process.kill(recorded.pid, 0); alive = true; } catch {}
        if (!alive && !fs.existsSync(recorded.tmpDir)) break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(recorded && recorded.tmpDir && recorded.pid, 'fake hanging agy stub must have started');
    let stillAlive = false;
    try { process.kill(recorded.pid, 0); stillAlive = true; } catch {}
    assert.equal(stillAlive, false, 'hung probe process must be killed by SIGKILL');
    assert.equal(fs.existsSync(recorded.tmpDir), false, 'probe tmpDir must be cleaned up after SIGKILL/close');
  } finally {
    if (recorded?.pid) { try { process.kill(recorded.pid, 'SIGKILL'); } catch {} }
    process.env.PATH = prevPath;
    if (prevMarker === undefined) delete process.env.FAKE_PROBE_MARKER; else process.env.FAKE_PROBE_MARKER = prevMarker;
    fs.rmSync(probeTmp, { recursive: true, force: true });
  }

  console.log('agy-capabilities.test.js: ok');
}

await runTests();
