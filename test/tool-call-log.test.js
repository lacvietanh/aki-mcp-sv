// tool-call-log.js: trace fields, the D9 log-settings shape, the basic/detail split, and the day-rotation + keep-days cleanup (docs/plan/akimcp-tool-refactor.md § D9).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traceFields, errorCodeOf, isLoggedTool, normalizeLogSettings, buildLogEntry, appendLogEntry, datedLogFiles, LOG_DEFAULTS } from '../scripts/tool-call-log.js';

const dayBefore = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const linesOf = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length;

test('baggage is kept as a 12-hex hash, never its text, the same for the same value', () => {
  const a = traceFields({ baggage: 'sentry-trace_id=abc,thread=123' });
  assert.match(a.baggage, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(a).includes('thread'));
  assert.equal(traceFields({ baggage: 'sentry-trace_id=abc,thread=123' }).baggage, a.baggage);
  assert.notEqual(traceFields({ baggage: 'sentry-trace_id=abc,thread=124' }).baggage, a.baggage);
});

test('traceparent gives its trace id; a malformed or all-zero one gives nothing', () => {
  assert.deepEqual(traceFields({ traceparent: '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01' }), { trace: '4bf92f3577b34da6a3ce929d0e0e4736' });
  assert.deepEqual(traceFields({ traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01' }), {});
  assert.deepEqual(traceFields({ traceparent: 'not-a-trace' }), {});
  assert.deepEqual(traceFields({ baggage: '', traceparent: undefined }), {});
  assert.deepEqual(traceFields(), {});
});

test('normalizeLogSettings keeps good values and falls back (or throws in strict mode) on bad ones', () => {
  assert.deepEqual(normalizeLogSettings({ enabled: true, level: 'detail', days: 7, maxMB: 3 }), { enabled: true, level: 'detail', days: 7, maxMB: 3 });
  assert.deepEqual(normalizeLogSettings(undefined), LOG_DEFAULTS);
  assert.deepEqual(normalizeLogSettings({ enabled: false }), { ...LOG_DEFAULTS, enabled: false });
  assert.equal(normalizeLogSettings({ level: 'loud' }).level, 'basic');
  assert.equal(normalizeLogSettings({ days: 0 }).days, 40);
  assert.equal(normalizeLogSettings({ maxMB: -5 }).maxMB, 16);
  assert.throws(() => normalizeLogSettings({ level: 'loud' }, { strict: true }), /level/);
  assert.throws(() => normalizeLogSettings({ days: 0 }, { strict: true }), /days/);
  assert.throws(() => normalizeLogSettings({ maxMB: 0 }, { strict: true }), /maxMB/);
});

test('isLoggedTool logs every aki__ tool and skips non-tool names', () => {
  assert.equal(isLoggedTool('aki__git'), true);
  assert.equal(isLoggedTool('aki__anything_else'), true);
  assert.equal(isLoggedTool(undefined), false);
  assert.equal(isLoggedTool(''), false);
});

test('errorCodeOf extracts a refusal code and -32602, nothing otherwise', () => {
  assert.equal(errorCodeOf("no window 'x'; open: P1·W1 (no_window; next: call op=state)"), 'no_window');
  assert.equal(errorCodeOf('MCP error -32602: Invalid enum value'), '-32602');
  assert.equal(errorCodeOf('something failed'), undefined);
  assert.equal(errorCodeOf(undefined), undefined);
});

test('buildLogEntry keeps the code only at basic; detail adds error, from and exprHash', () => {
  const params = { name: 'aki__aiobox_write', arguments: { op: 'compose', from: 'chat-1', notWhitelisted: 'connect-akimcp', expression: 'el.click()' } };
  const response = { error: { message: 'refused (busy; next: wait)' } };
  const ctx = { sessionId: 'sess-1234567890abcdef', agent: 'Notion-MCP-Client/1.0', headerNames: ['host'], trace: {}, params, response, ms: 12 };
  const basic = buildLogEntry(ctx, { level: 'basic' }, new Set());
  assert.equal(basic.tool, 'aki__aiobox_write');
  assert.equal(basic.errorCode, 'busy');
  assert.equal(basic.error, undefined);
  assert.equal(basic.from, undefined);
  assert.equal(basic.notWhitelisted, undefined);
  assert.equal(basic.exprHash, undefined);
  assert.deepEqual(basic.evalKind, ['click']);
  assert.equal(basic.client, 'sess-123');
  assert.match(basic.ts, /^\d{4}-\d{2}-\d{2}T/);
  const detail = buildLogEntry(ctx, { level: 'detail' }, new Set());
  assert.equal(detail.error, 'refused (busy; next: wait)');
  assert.equal(detail.from, 'chat-1');
  assert.equal(detail.notWhitelisted, undefined, 'a field outside the whitelist is never logged, at any level');
  assert.match(detail.exprHash, /^[0-9a-f]{12}$/);
  assert.equal(detail.errorCode, 'busy');
});

test('buildLogEntry finds the error code written past the 200-char cut line', () => {
  const message = 'x'.repeat(220) + ' (blocked; next: wait)';
  const ctx = { sessionId: 'sess-code-tail', agent: 'A', params: { name: 'aki__git', arguments: {} }, response: { error: { message } }, ms: 1 };
  const basic = buildLogEntry(ctx, { level: 'basic' }, new Set());
  assert.equal(basic.errorCode, 'blocked');
  assert.equal(basic.error, undefined);
  const detail = buildLogEntry(ctx, { level: 'detail' }, new Set());
  assert.equal(detail.errorCode, 'blocked');
  assert.equal(detail.error, message.slice(0, 200));
});

test('buildLogEntry writes the request headers once per session', () => {
  const seen = new Set();
  const ctx = { sessionId: 's1', agent: 'A', headerNames: ['host', 'x-custom'], params: { name: 'aki__git', arguments: {} }, response: {}, ms: 1 };
  assert.deepEqual(buildLogEntry(ctx, { level: 'basic' }, seen).headers, ['host', 'x-custom']);
  assert.equal(buildLogEntry(ctx, { level: 'basic' }, seen).headers, undefined);
});

test('appendLogEntry rotates a not-today current file to a dated sidecar and prunes sidecars older than keep-days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-call-log-'));
  const file = path.join(dir, 'tool-calls.jsonl');
  fs.writeFileSync(file, '{"ts":"2020-01-01T00:00:00.000Z","tool":"aki__git"}\n');
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  fs.utimesSync(file, yesterday, yesterday);
  appendLogEntry({ ts: new Date().toISOString(), tool: 'aki__git', ok: true }, { dir, settings: { ...LOG_DEFAULTS } });
  const sides = datedLogFiles(dir);
  assert.equal(sides.length, 1);
  assert.match(path.basename(sides[0]), /^tool-calls-\d{4}-\d{2}-\d{2}\.jsonl$/);
  const [yesterdaySidecar] = sides;
  assert.equal(linesOf(file), 1);
  const old = path.join(dir, `tool-calls-${dayBefore(50)}.jsonl`);
  fs.writeFileSync(old, '{"ts":"old"}\n');
  appendLogEntry({ ts: new Date().toISOString(), tool: 'aki__git', ok: true }, { dir, settings: { ...LOG_DEFAULTS } });
  assert.equal(fs.existsSync(old), false, 'a sidecar older than 40 days is deleted');
  assert.deepEqual(datedLogFiles(dir), [yesterdaySidecar], 'only the 50-day sidecar is pruned; yesterday\'s survives');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('appendLogEntry rolls the current file over once it passes the MB cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-call-log-cap-'));
  const file = path.join(dir, 'tool-calls.jsonl');
  const settings = { enabled: true, level: 'basic', days: 40, maxMB: 1 };
  const append = () => appendLogEntry({ ts: new Date().toISOString(), tool: 'aki__git' }, { dir, settings });
  append();
  append();
  assert.equal(datedLogFiles(dir).length, 0, 'under the cap today\'s file keeps growing');
  assert.equal(linesOf(file), 2);
  fs.appendFileSync(file, `${'x'.repeat(1024 * 1024)}\n`);
  append();
  assert.equal(datedLogFiles(dir).length, 1);
  assert.equal(linesOf(file), 1);
  assert.equal(linesOf(datedLogFiles(dir)[0]), 3);
  fs.rmSync(dir, { recursive: true, force: true });
});
