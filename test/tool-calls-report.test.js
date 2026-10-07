#!/usr/bin/env node
// tool-calls-report.js on a fixture log: each of C2–C6 counted from the fields tool-call-log.js writes (basic keeps errorCode, detail keeps the error text).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { report, readEntries } from '../scripts/tool-calls-report.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-calls-report-'));
const file = path.join(dir, 'tool-calls.jsonl');
const now = Date.now();
const at = (ago) => new Date(now - ago).toISOString();
const rows = [
  { ts: at(9 * 86_400_000), client: 'old', tool: 'aki__aiobox_write', op: 'eval', ok: true, version: '2.2.0' },
  { ts: at(5000), client: 'a', tool: 'aki__aiobox_write', op: 'compose', ok: true, version: VERSION },
  { ts: at(4000), client: 'a', tool: 'aki__aiobox', op: 'state', ok: true, version: VERSION },
  { ts: at(3000), client: 'a', tool: 'aki__aiobox_write', op: 'eval', evalKind: ['click', 'submit'], ok: true, version: VERSION },
  { ts: at(2000), client: 'a', tool: 'aki__aiobox', op: 'read', ok: false, errorCode: 'no_window', version: VERSION },
  { ts: at(1500), client: 'b', tool: 'aki__devtools_eval', port: 9222, evalKind: ['click'], ok: true, version: VERSION },
  { ts: at(1000), client: 'b', tool: 'aki__aiobox_write', op: 'bogus', ok: false, errorCode: '-32602', version: VERSION },
  { ts: at(800), client: 'd', tool: 'aki__devtools_eval', ok: false, error: 'refused (busy; next: wait)' },
];
fs.writeFileSync(`${file}.1`, `${JSON.stringify(rows[0])}\n`);
fs.writeFileSync(file, `${rows.slice(1).map((r) => JSON.stringify(r)).join('\n')}\nnot json\n`);

const all = readEntries(file);
assert.equal(all.length, 8, 'the rotated copy is read too, a broken line is skipped');
const r = report(all, { aioboxPorts: new Set([9222]), version: VERSION });
assert.equal(r.aioboxCalls, 6);
assert.equal(r.clients, 3);
assert.equal(r.C1_evalShare, undefined, 'AkiMCP counts no AIObox op since B1');
assert.deepEqual(r.C2_bypass, { calls: 1, tools: ['aki__devtools_eval'], evalKinds: { click: 1 } });
assert.deepEqual(r.C3_writeBeforeState, { calls: 3, share: '75%' }, 'old eval, a compose before state, b without state');
assert.equal(r.C4_staleSchema, 1, 'errorCode -32602 counts like the old error text');
assert.equal(r.C5_olderVersion, 1);
assert.deepEqual(r.C6_refusals, { no_window: 1, busy: 1 }, 'refusal code from errorCode and from detail error text');
assert.equal(r.aioboxSuccess, '66.7%', 'old eval, compose, state, eval ok; read, bogus failed');
assert.equal(readEntries(file, { sinceMs: now - 7 * 86_400_000 }).length, 7, '--days drops older lines');

// A dated sidecar (the D9 keep-days layout) is read together with the current file.
const datedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-calls-report-dated-'));
const datedFile = path.join(datedDir, 'tool-calls.jsonl');
fs.writeFileSync(datedFile, '{"ts":"2026-09-01T00:00:00.000Z","tool":"aki__git","ok":true}\n');
fs.writeFileSync(path.join(datedDir, 'tool-calls-2026-09-01.jsonl'), '{"ts":"2026-09-01T01:00:00.000Z","tool":"aki__sqlite_query","ok":true}\n');
assert.equal(readEntries(datedFile).length, 2);
fs.rmSync(datedDir, { recursive: true, force: true });

// The CLI (npm run tool-calls): a file and --days in either order, a clear message and a non-zero exit for no log or a bad --days. HOME points at the temp dir so the owner's AIObox map is never read.
const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/tool-calls-report.js', import.meta.url)), ...args], { encoding: 'utf8', env: { ...process.env, HOME: dir, USERPROFILE: dir, AKI_MCP_DATA_DIR: dir } });
const whole = cli(file);
assert.equal(whole.status, 0, whole.stderr);
assert.deepEqual([JSON.parse(whole.stdout).file, JSON.parse(whole.stdout).days, JSON.parse(whole.stdout).aioboxCalls], [file, null, 6]);
for (const args of [[file, '--days', '7'], ['--days', '7', file]]) {
  const week = JSON.parse(cli(...args).stdout);
  assert.deepEqual([week.days, week.C5_olderVersion], [7, 0], `--days 7 leaves the 9-day-old 2.2.0 call out (${args.join(' ')})`);
}
const defaultLog = JSON.parse(cli().stdout);
assert.equal(defaultLog.file, path.join(dir, 'tool-calls.jsonl'), 'no file argument reads the log in the data dir');
const none = cli(path.join(dir, 'absent.jsonl'));
assert.equal(none.status, 1);
assert.match(none.stderr, /no call log at .*absent\.jsonl yet/);
for (const bad of [['--days', 'week'], ['--days'], ['--days', '0']]) {
  const refused = cli(file, ...bad);
  assert.equal(refused.status, 2, `--days ${bad[1] ?? ''} is refused`);
  assert.match(refused.stderr, /--days takes a number of days/);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('tool-calls-report.test.js: ok');
