#!/usr/bin/env node
// tool-calls-report.js on a fixture log: each of C1–C6 counted from the fields tool-call-log.js writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { report, readEntries } from '../scripts/tool-calls-report.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-calls-report-'));
const file = path.join(dir, 'tool-calls.jsonl');
const now = Date.now();
const at = (ago) => new Date(now - ago).toISOString();
const rows = [
  { ts: at(9 * 86_400_000), client: 'old', tool: 'aki__aiobox_write', op: 'eval', ok: true, version: '2.2.0' },
  { ts: at(5000), client: 'a', tool: 'aki__aiobox_write', op: 'compose', ok: true, version: '3.0.0' },
  { ts: at(4000), client: 'a', tool: 'aki__aiobox', op: 'state', ok: true, version: '3.0.0' },
  { ts: at(3000), client: 'a', tool: 'aki__aiobox_write', op: 'eval', evalKind: ['click', 'submit'], ok: true, version: '3.0.0' },
  { ts: at(2000), client: 'a', tool: 'aki__aiobox', op: 'read', ok: false, error: 'no window \'P9·W9\'; open: P1·W1 (no_window; next: call aki__aiobox op=state and name the window by its chatId; akimcp 3.0.0)', version: '3.0.0' },
  { ts: at(1500), client: 'b', tool: 'aki__devtools_eval', port: 9222, ok: true, version: '3.0.0' },
  { ts: at(1000), client: 'b', tool: 'aki__aiobox_write', op: 'bogus', ok: false, error: 'MCP error -32602: Invalid enum value', version: '3.0.0' },
];
fs.writeFileSync(`${file}.1`, `${JSON.stringify(rows[0])}\n`);
fs.writeFileSync(file, `${rows.slice(1).map((r) => JSON.stringify(r)).join('\n')}\nnot json\n`);

const all = readEntries(file);
assert.equal(all.length, 7, 'the rotated copy is read too, a broken line is skipped');
const r = report(all, { aioboxPorts: new Set([9222]), version: '3.0.0' });
assert.equal(r.aioboxCalls, 6);
assert.equal(r.clients, 3);
assert.deepEqual(r.C1_evalShare, { share: '50%', evals: 2, writes: 4, kinds: { other: 1, click: 1, submit: 1 } });
assert.deepEqual(r.C2_bypass, { calls: 1, tools: ['aki__devtools_eval'] });
assert.deepEqual(r.C3_writeBeforeState, { calls: 3, share: '75%' }, 'old eval, a compose before state, b without state');
assert.equal(r.C4_staleSchema, 1);
assert.equal(r.C5_olderVersion, 1);
assert.deepEqual(r.C6_refusals, { no_window: 1 });
assert.equal(r.typedOpSuccess, '50%', 'compose, state ok; read, bogus failed');
assert.equal(readEntries(file, { sinceMs: now - 7 * 86_400_000 }).length, 6, '--days drops older lines');

fs.rmSync(dir, { recursive: true, force: true });
console.log('tool-calls-report.test.js: ok');
