#!/usr/bin/env node
import assert from 'node:assert/strict';
import { register, RULE_CONTEXT_DESCRIPTION, RULE_CONTEXT_TITLE, RULE_CONTEXT_TOOL } from '../scripts/rule-context-mcp.js';

let name, definition, handler;
register({ registerTool(n, d, h) { name = n; definition = d; handler = h; } }, {
  assemble: async () => ({
    status: 'ok', parity: 'practical-effective', receipt: `sha256:${'a'.repeat(64)}`, rulesVersion: '1.2.3', workingRoot: '/tmp/project',
    sources: [{ path: '/tmp/project/CLAUDE.md', kind: 'project', sha256: 'b'.repeat(64), bytes: 5 }], warnings: [], context: 'rules',
  }),
});
assert.equal(name, RULE_CONTEXT_TOOL);
assert.equal(name, 'akidevrule_context');
assert.equal(definition.title, RULE_CONTEXT_TITLE);
assert.equal(definition.description, RULE_CONTEXT_DESCRIPTION);
assert.deepEqual(Object.keys(definition.inputSchema), ['workingPath', 'mode', 'knownReceipt']);
const output = await handler({ workingPath: '/tmp/project' });
assert.equal(output.structuredContent.status, 'ok');
assert.match(output.content[0].text, /^\[RULES\] practical-effective · sha256:[a-f0-9]{64} · 1 sources\n\nrules$/);
assert.equal(output.isError, undefined);

let errorHandler;
register({ registerTool(_n, _d, h) { errorHandler = h; } }, { assemble: async () => { throw new Error('boom'); } });
const failure = await errorHandler({});
assert.equal(failure.isError, true);
assert.equal(failure.structuredContent.status, 'error');
assert.match(failure.content[0].text, /^\[RULES\] error/);
console.log('PASS: rule context MCP metadata, structured provenance, text fallback, and typed failure');
