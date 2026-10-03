#!/usr/bin/env node
// Reads tool-calls.jsonl (scripts/tool-call-log.js) and answers whether AIs use AIObox through its typed ops: C1 eval share, C2 browser tools on an AIObox port (bypass), C3 write ops with no state/whoami first, C4 stale-schema errors, C5 calls from an older server version, C6 refusal codes. Targets: docs/plan/aiobox-control-ops.md § Order and target.
// Usage: node scripts/tool-calls-report.js [file] [--days N]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WRITE_TOOL = 'aki__aiobox_write';
const ORIENT_OPS = new Set(['state', 'whoami']);
const REFUSAL = /\((\w+); next: /;
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '-');

export function report(entries, { aioboxPorts = new Set(), version } = {}) {
  const aiobox = entries.filter((e) => e.tool === 'aki__aiobox' || e.tool === WRITE_TOOL);
  const writes = aiobox.filter((e) => e.tool === WRITE_TOOL);
  const evals = writes.filter((e) => e.op === 'eval');
  const evalKinds = {};
  for (const e of evals) for (const k of e.evalKind?.length ? e.evalKind : ['other']) evalKinds[k] = (evalKinds[k] || 0) + 1;
  const bypass = entries.filter((e) => /^aki__(chrome|devtools)_/.test(e.tool) && aioboxPorts.has(Number(e.port)));
  // C3: per client, a write op before that client's first state/whoami.
  const oriented = new Set();
  let unoriented = 0;
  for (const e of aiobox) {
    if (e.tool === 'aki__aiobox' && ORIENT_OPS.has(e.op)) oriented.add(e.client);
    else if (e.tool === WRITE_TOOL && !oriented.has(e.client)) unoriented += 1;
  }
  const stale = entries.filter((e) => typeof e.error === 'string' && e.error.includes('-32602'));
  const older = version ? entries.filter((e) => e.version && e.version !== version) : [];
  const codes = {};
  for (const e of entries) {
    const code = typeof e.error === 'string' ? REFUSAL.exec(e.error)?.[1] : null;
    if (code) codes[code] = (codes[code] || 0) + 1;
  }
  const typed = writes.filter((e) => e.op !== 'eval').concat(aiobox.filter((e) => e.tool === 'aki__aiobox'));
  return {
    calls: entries.length,
    aioboxCalls: aiobox.length,
    clients: new Set(aiobox.map((e) => e.client)).size,
    typedOpSuccess: pct(typed.filter((e) => e.ok).length, typed.length),
    C1_evalShare: { share: pct(evals.length, writes.length), evals: evals.length, writes: writes.length, kinds: evalKinds },
    C2_bypass: { calls: bypass.length, tools: [...new Set(bypass.map((e) => e.tool))] },
    C3_writeBeforeState: { calls: unoriented, share: pct(unoriented, writes.length) },
    C4_staleSchema: stale.length,
    C5_olderVersion: older.length,
    C6_refusals: codes,
  };
}

export function readEntries(file, { sinceMs } = {}) {
  const files = [`${file}.1`, file].filter((f) => fs.existsSync(f));
  return files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const e = JSON.parse(line);
      return sinceMs && Date.parse(e.ts) < sinceMs ? [] : [e];
    } catch {
      return [];
    }
  });
}

function aioboxPortsNow() {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.aki', 'aiobox', 'cdp', 'windows.json'), 'utf8'));
    return new Set((map.profiles || []).map((p) => p.port));
  } catch {
    return new Set();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { TOOL_CALLS_PATH } = await import('./tool-call-log.js');
  const { VERSION } = await import('./version.js');
  const args = process.argv.slice(2);
  const daysAt = args.indexOf('--days');
  const days = daysAt === -1 ? null : Number(args[daysAt + 1]);
  const file = args.find((a, i) => !a.startsWith('--') && (daysAt === -1 || i !== daysAt + 1)) || TOOL_CALLS_PATH;
  if (!fs.existsSync(file)) {
    console.error(`no call log at ${file} yet: it is written once an AI calls aki__aiobox, aki__aiobox_write, aki__chrome_* or aki__devtools_* on AkiMCP ${VERSION}+`);
    process.exit(1);
  }
  const entries = readEntries(file, { sinceMs: days ? Date.now() - days * 86_400_000 : undefined });
  console.log(JSON.stringify({ file, days, ...report(entries, { aioboxPorts: aioboxPortsNow(), version: VERSION }) }, null, 2));
}
