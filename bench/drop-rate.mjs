#!/usr/bin/env node
// Ingress drop-rate benchmark for the akimcp gatekeeper; compare one public-edge run per ingress.
// See bench/README.md for modes, options, usage, and the authoritative live-connector benchmark.

import http from 'node:http';
import https from 'node:https';
import { mkdirSync, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] != null ? argv[i + 1] : def;
};

// Network error codes / conditions that mean "the request did not get a clean
// HTTP answer from the origin" — i.e. an ingress drop.
const DROP_ERR = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED', 'ERR_SOCKET_CONNECTION_TIMEOUT',
]);
// HTTP statuses that mean the edge could not reach / serve the origin.
// 520-527/530 are Cloudflare's origin-error family; 502/503/504 are generic gateway errors.
const isEdgeErrorStatus = (s) => s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530);
const NOT_REACHABLE_RE = /isn'?t reachable|does(n'?t| not) resolve|not reachable|bad gateway|error code:\s*52|web server is down|connection timed out/i;

function classify(expected, result) {
  // result: { status, errCode, body }
  if (result.errCode) {
    return DROP_ERR.has(result.errCode) || /timeout|socket hang up|aborted/i.test(result.errCode)
      ? 'drop' : 'error';
  }
  if (result.status === 0) return 'drop';
  if (isEdgeErrorStatus(result.status)) return 'drop';
  if (result.body && NOT_REACHABLE_RE.test(result.body)) return 'drop';
  if (result.status === expected) return 'ok';
  return 'unexpected';
}

// ---- single request --------------------------------------------------------
function buildRequest(mode, opts) {
  let path = '/mcp';
  let method = 'POST';
  let headers = { 'content-type': 'application/json' };
  let body = '';
  if (mode === 'wellknown') {
    path = '/.well-known/oauth-protected-resource/mcp';
    method = 'GET';
    headers = {};
  } else if (mode === 'preflight') {
    body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  } else if (mode === 'mcp') {
    const params = {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'drop-rate-bench', version: '1.0.0' },
    };
    if (opts.payloadKb > 0) params._padding = 'x'.repeat(opts.payloadKb * 1024);
    body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params });
    headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      authorization: `Bearer ${opts.token}`,
    };
  }
  return { path, method, headers, body };
}

function once(mode, origin, opts) {
  const { path, method, headers, body } = buildRequest(mode, opts);
  const t0 = process.hrtime.bigint();
  const done = (extra) => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, ...extra });

  const hop = (targetUrl, redirects) => new Promise((resolve) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method, headers, agent: opts.agent },
      (res) => {
        const status = res.statusCode;
        const loc = res.headers.location;
        // Follow 3xx (method + body preserved) so we exercise the full path a connector takes.
        if (loc && redirects < opts.maxRedirects && status >= 300 && status < 400) {
          res.resume(); // drain
          const next = new URL(loc, u).toString();
          resolve(hop(next, redirects + 1));
          return;
        }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (buf.length < 4096) buf += c; });
        res.on('end', () => resolve(done({ status, errCode: null, body: buf.slice(0, 512), redirects })));
        res.on('error', (e) => resolve(done({ status: status || 0, errCode: e.code || 'RES_ERROR', body: '', redirects })));
      },
    );
    req.setTimeout(opts.timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => resolve(done({ status: 0, errCode: e.code || 'REQ_ERROR', body: '', redirects })));
    if (body) req.write(body);
    req.end();
  });

  return hop(origin.replace(/\/+$/, '') + path, 0);
}

// ---- stats -----------------------------------------------------------------
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]);
}
function summarize(records, meta) {
  const lat = records.map((r) => r.ms).sort((a, b) => a - b);
  const counts = { ok: 0, drop: 0, unexpected: 0, error: 0 };
  const statusHist = {};
  const errHist = {};
  let streak = 0, maxStreak = 0;
  for (const r of records) {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
    if (r.status != null) statusHist[r.status] = (statusHist[r.status] || 0) + 1;
    if (r.errCode) errHist[r.errCode] = (errHist[r.errCode] || 0) + 1;
    if (r.kind === 'drop') { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  }
  const total = records.length || 1;
  return {
    ...meta,
    total: records.length,
    ok: counts.ok,
    drops: counts.drop,
    unexpected: counts.unexpected,
    errors: counts.error,
    dropPct: +((counts.drop / total) * 100).toFixed(3),
    maxDropStreak: maxStreak,
    latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: Math.round(lat[lat.length - 1] || 0) },
    statusHist,
    errHist,
  };
}

// ---- run -------------------------------------------------------------------
async function run() {
  const origin = flag('origin');
  if (!origin) { console.error('error: --origin is required'); process.exit(2); }
  const mode = flag('mode', 'preflight');
  if (!['preflight', 'wellknown', 'mcp'].includes(mode)) { console.error(`error: unknown --mode ${mode}`); process.exit(2); }
  const token = flag('token');
  if (mode === 'mcp' && !token) { console.error('error: --mode mcp needs --token <bearer>'); process.exit(2); }

  const label = flag('label', new URL(origin).hostname);
  const minutes = Number(flag('minutes', '30'));
  const concurrency = Number(flag('concurrency', '4'));
  const gapMs = Number(flag('gap-ms', '500'));
  const timeoutMs = Number(flag('timeout-ms', '15000'));
  const payloadKb = Number(flag('payload-kb', '0'));
  const maxRedirects = Number(flag('max-redirects', '3'));
  const reportSec = Number(flag('report-sec', '30'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = flag('out', join(HERE, 'out', `${label}-${mode}-${stamp}.jsonl`));
  mkdirSync(dirname(outFile), { recursive: true });

  const expected = mode === 'wellknown' ? 200 : mode === 'preflight' ? 401 : 200;
  const u = new URL(origin);
  const Agent = u.protocol === 'https:' ? https.Agent : http.Agent;
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency, keepAliveMsecs: 30000 });
  const opts = { token, payloadKb, timeoutMs, maxRedirects, agent };

  const records = [];
  const out = createWriteStream(outFile, { flags: 'a' });
  const startedAt = Date.now();
  const endAt = startedAt + minutes * 60_000;
  let stop = false;
  let seq = 0;

  console.log(`[bench] ${label} · mode=${mode} · expect=${expected} · ${concurrency} workers · gap=${gapMs}ms · ${minutes}min`);
  console.log(`[bench] origin=${origin}  out=${outFile}`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function worker(id) {
    while (!stop && Date.now() < endAt) {
      const res = await once(mode, origin, opts);
      const kind = classify(expected, res);
      const rec = { t: Date.now(), seq: seq++, w: id, ms: +res.ms.toFixed(1), kind, status: res.status, errCode: res.errCode };
      if (kind === 'drop' || kind === 'unexpected') rec.body = res.body?.slice(0, 200);
      records.push(rec);
      out.write(JSON.stringify(rec) + '\n');
      if (gapMs > 0) await sleep(gapMs);
    }
  }

  const reporter = setInterval(() => {
    const windowStart = Date.now() - reportSec * 1000;
    const recent = records.filter((r) => r.t >= windowStart);
    const wDrop = recent.length ? ((recent.filter((r) => r.kind === 'drop').length / recent.length) * 100).toFixed(2) : '0.00';
    const total = records.length || 1;
    const drop = records.filter((r) => r.kind === 'drop').length;
    const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
    process.stdout.write(`[bench] +${mins}min  n=${records.length}  drops=${drop} (${((drop / total) * 100).toFixed(2)}%)  last${reportSec}s=${wDrop}%\n`);
  }, reportSec * 1000);

  const finish = () => {
    stop = true;
    clearInterval(reporter);
    out.end();
    const summary = summarize(records, {
      label, mode, origin, expected,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      durationMin: +((Date.now() - startedAt) / 60000).toFixed(2),
      concurrency, gapMs, timeoutMs, payloadKb, maxRedirects, out: outFile,
    });
    const summaryFile = outFile.replace(/\.jsonl$/, '.summary.json');
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log('\n[bench] ===== summary =====');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[bench] wrote ${summaryFile}`);
  };
  process.on('SIGINT', () => { console.log('\n[bench] SIGINT — finalizing…'); finish(); process.exit(0); });

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  finish();
}

// ---- compare ---------------------------------------------------------------
function loadSummary(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw) ? summarize(raw.map((r) => r), { label: path }) : raw; // accept jsonl-array too
}
function compare() {
  const [aPath, bPath] = argv.filter((a) => !a.startsWith('--'));
  if (!aPath || !bPath) { console.error('usage: compare <baseline.summary.json> <candidate.summary.json>'); process.exit(2); }
  const a = loadSummary(aPath);
  const b = loadSummary(bPath);
  const row = (s) => `${String(s.label).padEnd(22)} n=${String(s.total).padStart(6)}  drop=${String(s.dropPct).padStart(6)}%  maxStreak=${String(s.maxDropStreak).padStart(3)}  p95=${String(s.latencyMs?.p95).padStart(5)}ms`;
  console.log('baseline  ' + row(a));
  console.log('candidate ' + row(b));
  const delta = +(a.dropPct - b.dropPct).toFixed(3);
  const rel = a.dropPct > 0 ? ((delta / a.dropPct) * 100).toFixed(1) : 'n/a';
  console.log(`\ndrop%: ${a.dropPct} -> ${b.dropPct}  (Δ ${delta >= 0 ? '-' : '+'}${Math.abs(delta)} pts${rel !== 'n/a' ? `, ${rel}% fewer` : ''})`);
  // Verdict against the plan's success / failure criteria.
  if (b.dropPct <= 0.01 && a.dropPct > 0.5) console.log('VERDICT: candidate is materially better (≈zero drops) — success criterion met.');
  else if (a.dropPct > 0 && b.dropPct <= a.dropPct * 0.5) console.log('VERDICT: candidate roughly halves drops or better — success criterion likely met.');
  else if (Math.abs(delta) <= Math.max(0.2, a.dropPct * 0.2)) console.log('VERDICT: drops persist at a similar rate — stop criterion: the edge is NOT the cause; keep Funnel for zero-config.');
  else console.log('VERDICT: mixed/insufficient — extend the window and re-run.');
}

// ---- main ------------------------------------------------------------------
if (sub === 'compare') compare();
else await run();
