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
const { checkReceipt, recordIssued, setAssembler, setNow, isGated, withReceipt, gate } = gateMod;

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
assert.deepEqual(asked.at(-1), { mode: 'effective', workingPath: '/w', extraFiles: [] }, 'the check makes the same call that issued the receipt');
current = B;
const stale = await checkReceipt(A);
assert.equal(stale.code, 'RULE_RECEIPT_STALE', 'once the rules change the old receipt is refused');
for (const r of [await checkReceipt(undefined), stale]) assert.match(r.message, /call aki__akidevrule_context \(without knownReceipt if the rules are no longer in your context\), then call this tool again with receipt=/);
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
assert.match(text(refused), /^RULE_RECEIPT_MISSING: .*call aki__akidevrule_context .*then call this tool again with receipt=/);
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

// D23: a call touching a project whose rule files the receipt does not cover gets those rules and a new receipt first.
const { rulesFor, rulesBlock } = await import('../scripts/project-rules.js');
const r1 = path.join(tmp, 'r1');
const r2 = path.join(tmp, 'r2');
fs.mkdirSync(path.join(r1, 'src'), { recursive: true });
fs.mkdirSync(r2);
fs.writeFileSync(path.join(r1, 'AGENTS.md'), '# r1 rule\n');
fs.writeFileSync(path.join(r2, 'CLAUDE.md'), '# r2 rule\n');
const write = (p, receipt) => client.callTool({ name: 'aki__write_file', arguments: { path: p, content: 'w', receipt } });
const newReceipt = (r) => text(r).match(/Call again with receipt=(sha256:[a-f0-9]{64})\.$/)?.[1];

const first = await write(path.join(r1, 'src', 'a.txt'), reloaded);
assert.ok(!first.isError, 'not run yet is not an error');
assert.doesNotMatch(text(first), /RULE_/);
assert.equal(first.content.length, 2);
assert.match(first.content[0].text, /# r1 rule/);
assert.doesNotMatch(first.content[0].text, /a new project rule/, 'rules already covered are not shown again');
assert.match(first.content[1].text, /^Not run yet: rules for this path are above\. Call again with receipt=sha256:/);
assert.ok(!fs.existsSync(path.join(r1, 'src', 'a.txt')), 'the first call writes nothing');
const rec1 = newReceipt(first);
const retry = await write(path.join(r1, 'src', 'a.txt'), rec1);
assert.ok(!retry.isError && !newReceipt(retry), text(retry));
assert.equal(fs.readFileSync(path.join(r1, 'src', 'a.txt'), 'utf8'), 'w', 'the retry runs (not STALE)');

const other = await write(path.join(r2, 'b.txt'), rec1);
assert.match(other.content[0].text, /# r2 rule/);
assert.doesNotMatch(other.content[0].text, /# r1 rule/);
const rec2 = newReceipt(other);
for (const p of [path.join(r2, 'b.txt'), path.join(r1, 'c.txt'), path.join(r2, 'd.txt')]) {
  const r = await write(p, rec2);
  assert.ok(!r.isError && !newReceipt(r), `alternating repos never asks again: ${text(r)}`);
}

const covering = (await client.callTool({ name: 'aki__akidevrule_context', arguments: { workingPath: r1 } })).structuredContent.receipt;
assert.ok(!newReceipt(await write(path.join(r1, 'e.txt'), covering)), 'a receipt already covering the path runs at once');
assert.ok(fs.existsSync(path.join(r1, 'e.txt')));

const readR1 = await client.callTool({ name: 'aki__read_text_file', arguments: { path: path.join(r1, 'src', 'a.txt') } });
assert.equal(readR1.content.length, 2, 'a read tool always runs and appends one line');
assert.equal(readR1.content[0].text, 'w');
assert.match(readR1.content[1].text, /^Rules for this path \(same rank as aki__akidevrule_context; .*AGENTS\.md \(sha256 [a-f0-9]{12}\).*Not in your context\? Read them and follow them\.$/);

assert.deepEqual(await rulesFor([path.join(path.dirname(tmp), 'elsewhere', 'x.txt')], [r1]), [], 'a path outside every root has no rules');
assert.deepEqual(await rulesFor([], [tmp]), [], 'no path, no rules');
assert.deepEqual(await rulesFor([path.join(r1, 'src', 'new', 'deep.txt')], [tmp]), [path.join(tmp, 'CLAUDE.md'), path.join(r1, 'AGENTS.md')], 'a path not created yet walks up from its nearest folder, top-down');
// S6: a git worktree nested in its repo carries the same CLAUDE.md; it counts once (the worktree's copy), and a receipt covering the repo's copy covers it.
const wt = path.join(r1, '.claude', 'worktrees', 'w1');
fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
fs.writeFileSync(path.join(r1, 'CLAUDE.md'), '# r1 claude\n');
fs.writeFileSync(path.join(wt, 'CLAUDE.md'), '# r1 claude\n');
const wtRules = await rulesFor([path.join(wt, 'src', 'x.txt')], [tmp]);
assert.deepEqual(wtRules.filter((f) => f.endsWith(path.join('r1', 'CLAUDE.md')) || f === path.join(wt, 'CLAUDE.md')), [path.join(wt, 'CLAUDE.md')], 'a worktree nested in its repo gets the same CLAUDE.md once');
assert.ok(wtRules.includes(path.join(r1, 'AGENTS.md')), 'other rule files on the way up stay');
const wtReadLine = (await client.callTool({ name: 'aki__read_text_file', arguments: { path: path.join(wt, 'CLAUDE.md') } })).content.at(-1).text;
assert.equal(wtReadLine.split('CLAUDE.md (sha256 ').length - 1, wtRules.filter((f) => f.endsWith('CLAUDE.md')).length, 'the read line names the copy once');
const coveringR1 = (await client.callTool({ name: 'aki__akidevrule_context', arguments: { workingPath: r1 } })).structuredContent.receipt;
const wtWrite = await write(path.join(wt, 'src', 'y.txt'), coveringR1);
assert.ok(!newReceipt(wtWrite), `a receipt covering the repo's CLAUDE.md covers the worktree's copy: ${text(wtWrite)}`);
assert.ok(fs.existsSync(path.join(wt, 'src', 'y.txt')));
// S9: calls made together with one receipt into a project it does not cover: one result carries the rule file, the others point at it with the same new receipt.
const r3 = path.join(tmp, 'r3');
fs.mkdirSync(path.join(r3, 'deep'), { recursive: true });
fs.writeFileSync(path.join(r3, 'CLAUDE.md'), '# r3 rule\n');
fs.writeFileSync(path.join(r3, 'deep', 'AGENTS.md'), '# r3 deep rule\n');
const together = await Promise.all(['a', 'b', 'c'].map((n) => write(path.join(r3, `${n}.txt`), coveringR1)));
const withBlock = together.filter((r) => text(r).includes('<!-- source:'));
assert.equal(withBlock.length, 1, `one of three calls made together carries the rule file: ${together.map(text).join('\n---\n')}`);
assert.match(text(withBlock[0]), /# r3 rule/);
const pointers = together.filter((r) => r !== withBlock[0]);
const rec3 = newReceipt(withBlock[0]);
assert.ok(rec3);
for (const r of pointers) {
  assert.equal(r.content.length, 1);
  assert.doesNotMatch(text(r), /# r3 rule/);
  assert.match(text(r), new RegExp(`^Not run yet: the rules for this path, ${path.join(r3, 'CLAUDE.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(sha256 [a-f0-9]{12}\\) went with another call a moment ago; if no result in this turn shows it, read it with aki__read_text_file first\\. Call again with receipt=`));
  assert.equal(newReceipt(r), rec3, 'a pointer names the same new receipt as the result with the rules');
}
for (const n of ['a', 'b', 'c']) assert.ok(!fs.existsSync(path.join(r3, `${n}.txt`)), 'none of them ran');
const mixed = await write(path.join(r3, 'deep', 'x.txt'), coveringR1);
assert.match(mixed.content[0].text, /# r3 deep rule/, 'a rule file not shown yet is shown');
assert.doesNotMatch(mixed.content[0].text, /# r3 rule\n/, 'the one just shown is not repeated');
assert.match(mixed.content[1].text, /^Not run yet: rules for this path are above\. .*CLAUDE\.md \(sha256 [a-f0-9]{12}\) went with another call a moment ago; .*Call again with receipt=sha256:/);
setNow(() => Date.now() + 11_000);
assert.match(text(await write(path.join(r3, 'a.txt'), coveringR1)), /# r3 rule/, 'after the shown window the rule file is shown again');
setNow(null);
for (const n of ['a', 'b', 'c']) {
  const r = await write(path.join(r3, `${n}.txt`), rec3);
  assert.ok(!r.isError && !newReceipt(r), `the new receipt runs every one of them: ${text(r)}`);
}
const big = path.join(tmp, 'big', 'CLAUDE.md');
fs.mkdirSync(path.dirname(big));
fs.writeFileSync(big, `# big\n${'x'.repeat(40 * 1024)}\n`);
const capped = await rulesBlock([big]);
assert.match(capped, /over the 32 KiB cap: read it with aki__read_text_file/);
assert.ok(capped.length < 2048, 'a file over the cap is named, not inlined');

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('rule-gate.test.js: ok');
