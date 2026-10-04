// traceFields (scripts/tool-call-log.js): what a tool-call line keeps of a client's tracing headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceFields } from '../scripts/tool-call-log.js';

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
