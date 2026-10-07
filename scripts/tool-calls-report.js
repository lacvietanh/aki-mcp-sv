#!/usr/bin/env node
// Reads tool-calls.jsonl: bypass (browser tools on an AIObox port), writes with no prior op=state, stale-schema/version errors, refusal codes. Detail: docs/plan/akimcp-aiobox-boundary-plan.md § 4 I1.
// Usage: node scripts/tool-calls-report.js [file] [--days N]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { datedLogFiles } from './tool-call-log.js';

const WRITE_TOOL = 'aki__aiobox_write';
const REFUSAL = /\((\w+); next: /;
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '-');
const errText = (e) => (typeof e.error === 'string' ? e.error : typeof e.errorCode === 'string' ? e.errorCode : '');

export function report(entries, { aioboxPorts = new Set(), version } = {}) {
  const aiobox = entries.filter((e) => e.tool === 'aki__aiobox' || e.tool === WRITE_TOOL);
  const writes = aiobox.filter((e) => e.tool === WRITE_TOOL);
  const bypass = entries.filter((e) => /^aki__(chrome|devtools)_/.test(e.tool) && aioboxPorts.has(Number(e.port)));
  const evalKinds = {};
  for (const e of bypass) for (const k of e.evalKind || []) evalKinds[k] = (evalKinds[k] || 0) + 1;
  // C3: per client, a write call before that client's first op=state.
  const oriented = new Set();
  let unoriented = 0;
  for (const e of aiobox) {
    if (e.tool === 'aki__aiobox' && e.op === 'state') oriented.add(e.client);
    else if (e.tool === WRITE_TOOL && !oriented.has(e.client)) unoriented += 1;
  }
  const stale = entries.filter((e) => errText(e).includes('-32602'));
  const older = version ? entries.filter((e) => e.version && e.version !== version) : [];
  const codes = {};
  for (const e of entries) {
    const code = typeof e.errorCode === 'string' && e.errorCode !== '-32602' ? e.errorCode : REFUSAL.exec(e.error ?? '')?.[1];
    if (code) codes[code] = (codes[code] || 0) + 1;
  }
  return {
    calls: entries.length,
    aioboxCalls: aiobox.length,
    clients: new Set(aiobox.map((e) => e.client)).size,
    aioboxSuccess: pct(aiobox.filter((e) => e.ok).length, aiobox.length),
    C2_bypass: { calls: bypass.length, tools: [...new Set(bypass.map((e) => e.tool))], evalKinds },
    C3_writeBeforeState: { calls: unoriented, share: pct(unoriented, writes.length) },
    C4_staleSchema: stale.length,
    C5_olderVersion: older.length,
    C6_refusals: codes,
  };
}

export function readEntries(file, { sinceMs } = {}) {
  const files = [...datedLogFiles(path.dirname(file)), `${file}.1`, file].filter((f) => fs.existsSync(f));
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { TOOL_CALLS_PATH } = await import('./tool-call-log.js');
  const { VERSION } = await import('./version.js');
  const { aioboxPorts } = await import('./aiobox-guide.js');
  const args = process.argv.slice(2);
  const daysAt = args.indexOf('--days');
  const days = daysAt === -1 ? null : Number(args[daysAt + 1]);
  if (days !== null && !(days > 0)) {
    console.error('--days takes a number of days, e.g. npm run tool-calls -- --days 7');
    process.exit(2);
  }
  const file = args.find((a, i) => !a.startsWith('--') && (daysAt === -1 || i !== daysAt + 1)) || TOOL_CALLS_PATH;
  if (!fs.existsSync(file)) {
    console.error(`no call log at ${file} yet: it is written once an AI calls a tool on AkiMCP ${VERSION}+`);
    process.exit(1);
  }
  const entries = readEntries(file, { sinceMs: days ? Date.now() - days * 86_400_000 : undefined });
  console.log(JSON.stringify({ file, days, ...report(entries, { aioboxPorts: aioboxPorts(), version: VERSION }) }, null, 2));
}
