#!/usr/bin/env node
// Every tool that acts refuses a call without the current rule receipt (scripts/rule-gate.js, docs/plan/rule-receipt-gate.md); read-only tools never ask for one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rule-gate-test-')));
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data', 'setting.json'), JSON.stringify({ folders: [tmp] }));
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
const gateMod = await import('../scripts/rule-gate.js');
const { checkReceipt, recordIssued, setAssembler, isGated, withReceipt, gate } = gateMod;

// The check alone, against a fake assembler whose receipt the test controls.
const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;
let current = A;
const asked = [];
setAssembler(async (input) => { asked.push(input); return { receipt: current }; });
assert.equal((await checkReceipt(undefined)).code, 'RULE_RECEIPT_MISSING');
assert.equal((await checkReceipt('')).code, 'RULE_RECEIPT_MISSING');
assert.equal((await checkReceipt('sha256:xyz')).code, 'RULE_RECEIPT_INVALID');
assert.equal((await checkReceipt(A)).code, 'RULE_RECEIPT_UNKNOWN', 'a well-formed receipt this server never issued is refused');
recordIssued(A, { workingPath: '/w', mode: 'effective' });
assert.equal(await checkReceipt(A), null, 'an issued receipt the rules still produce passes');
assert.deepEqual(asked.at(-1), { mode: 'effective', workingPath: '/w' }, 'the check makes the same call that issued the receipt');
current = B;
const stale = await checkReceipt(A);
assert.equal(stale.code, 'RULE_RECEIPT_STALE', 'once the rules change the old receipt is refused');
for (const r of [await checkReceipt(undefined), stale]) assert.match(r.message, /call aki__akidevrule_context, then call this tool again with receipt=/);
setAssembler(async () => { throw new Error('disk gone'); });
recordIssued(A);
assert.equal((await checkReceipt(A)).code, 'RULE_RECEIPT_UNCHECKED', 'rules that cannot be read never let a call through');

// Which tools are gated and how their schema and handler change.
assert.equal(isGated({ annotations: { readOnlyHint: true } }), false);
assert.equal(isGated({ annotations: { readOnlyHint: false } }), true);
assert.equal(isGated({}), true, 'a tool that does not say it is read-only is gated');
assert.deepEqual(Object.keys(withReceipt({ path: 1 })), ['path', 'receipt']);
assert.deepEqual(Object.keys(withReceipt(undefined)), ['receipt']);
assert.throws(() => withReceipt({ receipt: 1 }), /already has an input named receipt/);
setAssembler(async () => ({ receipt: A }));
recordIssued(A);
const seen = [];
const noSchema = gate(async (...args) => { seen.push(args); return 'ok'; }, false);
assert.equal(await noSchema({ receipt: A }, 'extra'), 'ok');
assert.deepEqual(seen.pop(), ['extra'], 'a tool registered without inputs still gets only extra');
const withSchema = gate(async (...args) => { seen.push(args); return 'ok'; }, true);
assert.equal(await withSchema({ receipt: A, path: '/x' }, 'extra'), 'ok');
assert.deepEqual(seen.pop(), [{ path: '/x' }, 'extra'], 'receipt is stripped before the tool sees its input');
assert.equal((await withSchema({ path: '/x' }, 'extra')).isError, true);
assert.equal(seen.length, 0, 'a refused call never reaches the tool');

// End to end through the served tools: the real assembler, the real write_file.
setAssembler(null);
const { createToolsServer } = await import('../scripts/tools-server.js');
const server = createToolsServer();
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'rule-gate-test', version: '1' });
await client.connect(clientSide);
const text = (r) => r.content.map((c) => c.text).join('\n');

const tools = (await client.listTools()).tools;
const props = (name) => Object.keys(tools.find((t) => t.name === name)?.inputSchema.properties || {});
for (const t of tools) {
  const gated = t.annotations?.readOnlyHint !== true;
  assert.equal(props(t.name).includes('receipt'), gated, `${t.name}: receipt only on tools that act`);
}
assert.ok(props('aki__write_file').includes('receipt') && props('aki__run_cmd').includes('receipt'));
assert.ok(!props('aki__read_text_file').includes('receipt') && !props('aki__akidevrule_context').includes('receipt'));

const target = path.join(tmp, 'out.txt');
const refused = await client.callTool({ name: 'aki__write_file', arguments: { path: target, content: 'x' } });
assert.equal(refused.isError, true);
assert.match(text(refused), /^RULE_RECEIPT_MISSING: .*call aki__akidevrule_context, then call this tool again with receipt=/);
assert.ok(!fs.existsSync(target), 'a refused write writes nothing');

const loaded = await client.callTool({ name: 'aki__akidevrule_context', arguments: { workingPath: tmp } });
const { receipt } = loaded.structuredContent;
assert.match(receipt, /^sha256:[a-f0-9]{64}$/);
assert.ok(text(loaded).includes(`Every tool that acts needs receipt=${receipt}`), 'the output names the receipt to pass');
const written = await client.callTool({ name: 'aki__write_file', arguments: { path: target, content: 'x', receipt } });
assert.ok(!written.isError, text(written));
assert.equal(fs.readFileSync(target, 'utf8'), 'x');

const read = await client.callTool({ name: 'aki__read_text_file', arguments: { path: target } });
assert.equal(text(read), 'x', 'a read-only tool needs no receipt');

const forged = await client.callTool({ name: 'aki__write_file', arguments: { path: target, content: 'y', receipt: `sha256:${'c'.repeat(64)}` } });
assert.match(text(forged), /^RULE_RECEIPT_UNKNOWN/);

// A rule file changing under a live server: the project CLAUDE.md the receipt covered.
fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# a new project rule\n');
const after = await client.callTool({ name: 'aki__write_file', arguments: { path: target, content: 'z', receipt } });
assert.match(text(after), /^RULE_RECEIPT_STALE/);
assert.equal(fs.readFileSync(target, 'utf8'), 'x');
const reloaded = (await client.callTool({ name: 'aki__akidevrule_context', arguments: { workingPath: tmp } })).structuredContent.receipt;
assert.notEqual(reloaded, receipt);
assert.ok(!(await client.callTool({ name: 'aki__write_file', arguments: { path: target, content: 'z', receipt: reloaded } })).isError);

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('rule-gate.test.js: ok');
