#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleRuleContext, RuleContextError } from '../scripts/rule-context.js';
import { register, MANDATORY_BLOCK, SHARED_WORK, RULE_CONTEXT_DESCRIPTION, RULE_CONTEXT_TITLE, RULE_CONTEXT_TOOL } from '../scripts/rule-context-mcp.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aki-rule-context-'));
const home = path.join(temp, 'home');
const root = path.join(temp, 'projects');
const project = path.join(root, 'demo', 'src');
const cache = new Map();
const deps = { fs, path, platform: process.platform, homeDir: home, roots: [root], cache };

try {
  await fs.mkdir(path.join(home, '.claude', 'skills', 'akirule'), { recursive: true });
  await fs.mkdir(path.join(home, '.aki', 'akidevrule'), { recursive: true });
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(home, '.claude', 'CLAUDE.md'), '\uFEFFglobal-before\r\n@./shared.md\r\nglobal-after\r\n`@./inline.md`\r\n```\r\n@./fenced.md\r\n```\r\n');
  await fs.writeFile(path.join(home, '.claude', 'shared.md'), 'shared-before\n@./nested.md\nshared-after\n');
  await fs.writeFile(path.join(home, '.claude', 'nested.md'), '@./shared.md\nnested\n');
  await fs.writeFile(path.join(home, '.claude', 'skills', 'akirule', 'SKILL.md'), 'akirule router\n');
  await fs.writeFile(path.join(home, '.aki', 'akidevrule', '.version'), '9.8.7\n');
  await fs.writeFile(path.join(root, 'CLAUDE.md'), 'allowed-root\n');
  await fs.mkdir(path.join(root, 'demo'), { recursive: true });
  await fs.writeFile(path.join(root, 'demo', 'AGENTS.md'), 'project-agent\n');
  await fs.writeFile(path.join(project, 'CLAUDE.local.md'), 'deep-local\n');

  const first = await assembleRuleContext({ workingPath: project }, deps);
  assert.equal(first.status, 'ok');
  assert.equal(first.parity, 'practical-effective');
  assert.equal(first.rulesVersion, '9.8.7');
  assert.equal(first.workingRoot, await fs.realpath(root));
  assert.match(first.receipt, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.sources.every((source) => path.isAbsolute(source.path) && source.bytes > 0 && /^[a-f0-9]{64}$/.test(source.sha256)));
  const positions = ['global-before', 'shared-before', 'nested', 'shared-after', 'global-after', 'akirule router', 'allowed-root', 'project-agent', 'deep-local'].map((text) => first.context.indexOf(text));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'imports and project precedence must preserve deterministic order');
  assert.equal(first.context.includes('inline.md'), true, 'inline code remains literal text');
  assert.ok(first.warnings.some((warning) => warning.code === 'IMPORT_CYCLE'));
  assert.equal(first.sources.filter((source) => source.path.endsWith('shared.md')).length, 1);

  const cached = await assembleRuleContext({ workingPath: project }, deps);
  assert.equal(cached.receipt, first.receipt);
  const unchanged = await assembleRuleContext({ workingPath: project, knownReceipt: first.receipt }, deps);
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.context, '');

  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(path.join(root, 'demo', 'AGENTS.md'), 'project-agent changed\n');
  const changed = await assembleRuleContext({ workingPath: project }, deps);
  assert.notEqual(changed.receipt, first.receipt);
  assert.match(changed.context, /project-agent changed/);

  const audit = await assembleRuleContext({ workingPath: project, mode: 'exact-audit' }, { ...deps, cache: new Map() });
  assert.equal(audit.parity, 'exact-audit-not-guaranteed');
  assert.ok(audit.audit.importGraph.length >= 2);
  assert.ok(audit.audit.candidates.some((candidate) => candidate.endsWith(path.join('src', 'CLAUDE.local.md'))));

  await fs.rm(path.join(home, '.claude', 'skills', 'akirule', 'SKILL.md'));
  const degraded = await assembleRuleContext({}, { ...deps, cache: new Map() });
  assert.equal(degraded.status, 'degraded');
  assert.ok(degraded.warnings.some((warning) => warning.code === 'REQUIRED_SOURCE_MISSING'));
  assert.ok(degraded.warnings.some((warning) => warning.code === 'PROJECT_CONTEXT_NOT_LOADED'));

  await assert.rejects(() => assembleRuleContext({ workingPath: 'relative/path' }, deps), (error) => error instanceof RuleContextError && error.code === 'INVALID_WORKING_PATH');
  await assert.rejects(() => assembleRuleContext({ workingPath: home }, deps), (error) => error instanceof RuleContextError && error.code === 'OUTSIDE_ALLOWED_ROOTS');

  console.log('PASS: rule context import expansion, routing source, provenance, cache invalidation, precedence, and safe degradation');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

let name, definition, handler;
register({ registerTool(n, d, h) { name = n; definition = d; handler = h; } }, {
  assemble: async () => ({
    status: 'ok', parity: 'practical-effective', receipt: `sha256:${'a'.repeat(64)}`, rulesVersion: '1.2.3', workingRoot: '/tmp/project',
    sources: [{ path: '/tmp/project/CLAUDE.md', kind: 'project', sha256: 'b'.repeat(64), bytes: 5 }], warnings: [], context: 'rules',
  }),
  aioboxInstalled: () => true,
});
assert.equal(name, RULE_CONTEXT_TOOL);
assert.equal(name, 'akidevrule_context');
assert.equal(definition.title, RULE_CONTEXT_TITLE);
assert.equal(definition.description, RULE_CONTEXT_DESCRIPTION);
assert.deepEqual(Object.keys(definition.inputSchema), ['workingPath', 'mode', 'knownReceipt']);
const output = await handler({ workingPath: '/tmp/project' });
assert.equal(output.structuredContent.status, 'ok');
assert.ok(output.content[0].text.startsWith(`NO YAPPING AT ALL\n${MANDATORY_BLOCK}\n\ncontext loaded: practical-effective · sha256:`), 'the mandatory block comes first, then the receipt');
assert.ok(output.content[0].text.endsWith(` · 1 sources\nEvery tool that acts needs receipt=sha256:${'a'.repeat(64)}\n\n${SHARED_WORK}\n\nrules`), 'the receipt to pass on every acting tool, then the shared-work convention, then the corpus');
// G2–G4 of aiobox audit-content-context (owner 2026-10-04): the AIObox guide drops them, so they must ship here.
for (const must of ['git status', 'someone else', '$HOME/.aki/mcpsv/task/<slug>/working.md', '-- <your paths>', 'git add -A', '.claude/worktrees/<role>', '~/.aki/handoff/', '~/.aki/aiobox/']) assert.ok(SHARED_WORK.includes(must), must);
assert.equal(/push|release|deploy/.test(SHARED_WORK), false, 'commit and push rules stay in AkiDevRule');
assert.equal(/^\[RULES\] (?!agent \(core\))/m.test(output.content[0].text), false, 'no line of the output is a [RULES] line a model could copy as its receipt');
for (const must of ['BLOCKING', 'no rule Read, no action', '`[RULES] agent (core) + <topics> (router)`', 'code → coding + pattern', '.md → docs', '→ think', 'agent.B2']) assert.ok(MANDATORY_BLOCK.includes(must), must);
assert.ok(MANDATORY_BLOCK.length <= 400, `the block stays short (${MANDATORY_BLOCK.length} chars)`);
assert.match(RULE_CONTEXT_DESCRIPTION, /a receipt without \(router\)[^.]*is a violation/);
assert.equal(output.isError, undefined);
assert.equal('context' in output.structuredContent, false, 'corpus must ship only in content, never duplicated into structuredContent');
assert.equal(output.structuredContent.sources.length, 1, 'provenance is preserved in structuredContent');

// Without ~/.aki/aiobox/ one line after the header says what AIObox adds and links the web guide (D7).
let bareHandler;
register({ registerTool(_n, _d, h) { bareHandler = h; } }, {
  assemble: async () => ({ status: 'ok', parity: 'practical-effective', receipt: `sha256:${'a'.repeat(64)}`, rulesVersion: '1', workingRoot: null, sources: [], warnings: [], context: 'rules' }),
  aioboxInstalled: () => false,
});
assert.match((await bareHandler({})).content[0].text, /\ncontext loaded: [^\n]+\nEvery tool that acts needs receipt=sha256:[a-f0-9]{64}\nAIObox \(not installed here\)[^\n]+https:\/\/aiobox\.app\/guide\/aiobox\.md\n\nWorking beside other sessions[^]*\n\nrules$/);

let errorHandler;
register({ registerTool(_n, _d, h) { errorHandler = h; } }, { assemble: async () => { throw new Error('boom'); } });
const failure = await errorHandler({});
assert.equal(failure.isError, true);
assert.equal(failure.structuredContent.status, 'error');
assert.match(failure.content[0].text, /^NO YAPPING AT ALL\ncontext NOT loaded · RULE_CONTEXT_ERROR: boom; no \[RULES\] line/);
console.log('PASS: rule context MCP metadata, structured provenance, text fallback, and typed failure');
