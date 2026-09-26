import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_AGY_MODEL = 'gemini-3.7-flash-medium';
export const DEFAULT_AGY_TIMEOUT_MS = 120_000;
export const DEFAULT_AGY_MAX_BUFFER = 4 * 1024 * 1024;
export const AGY_USAGE_TIMEOUT_MS = 25_000;

const QUOTA_BUCKETS = {
  'gemini-5h': ['gemini', 'fiveHour'],
  'gemini-weekly': ['gemini', 'weekly'],
  '3p-5h': ['claudeGpt', 'fiveHour'],
  '3p-weekly': ['claudeGpt', 'weekly'],
};

export function parseAgyUsage(stdout) {
  let report;
  try { report = JSON.parse(stdout); } catch { throw new Error('AGY usage format is invalid'); }
  if (report?.status !== 'SUCCESS' || report?.command?.name !== 'usage' || !Array.isArray(report.command.data?.groups)) {
    throw new Error('AGY usage is unavailable');
  }
  const quotas = { gemini: { fiveHour: null, weekly: null }, claudeGpt: { fiveHour: null, weekly: null } };
  let found = 0;
  for (const group of report.command.data.groups) {
    if (!Array.isArray(group?.buckets)) continue;
    for (const bucket of group.buckets) {
      const target = Object.hasOwn(QUOTA_BUCKETS, bucket?.id) ? QUOTA_BUCKETS[bucket.id] : null;
      const fraction = bucket?.remaining_fraction;
      const reset = Date.parse(bucket?.reset_time);
      if (!target || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || !Number.isFinite(reset)) continue;
      quotas[target[0]][target[1]] = { remainingPercent: Math.round(fraction * 100), resetAt: new Date(reset).toISOString() };
      found += 1;
    }
  }
  if (!found) throw new Error('AGY usage has no supported quota buckets');
  return quotas;
}

export function parseAgyAccountHandle(log) {
  let handle = null;
  for (const line of String(log).split(/\r?\n/)) {
    const match = /\bapplyAuthResult:\s*email=([a-z0-9._%+-]{1,64})@[a-z0-9.-]+\.[a-z]{2,63}(?=,|\s|$)/i.exec(line);
    if (match) handle = match[1];
  }
  return handle;
}

export function runAgyUsageProcess(agyBin, {
  execFileImpl = execFile,
  cwd,
  timeoutMs = AGY_USAGE_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    const logDir = mkdtempSync(path.join(os.tmpdir(), 'aki-agy-usage-'));
    const logFile = path.join(logDir, 'cli.log');
    const cleanup = () => {
      try { rmSync(logFile, { force: true }); } catch {}
      try { rmdirSync(logDir); } catch {}
    };
    try {
      execFileImpl(agyBin, ['-p', '/usage', '--output-format', 'json', '--log-file', logFile], {
        cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, signal, windowsHide: true,
      }, (error, stdout) => {
        let accountHandle = null;
        try { accountHandle = parseAgyAccountHandle(readFileSync(logFile, 'utf8')); } catch {}
        cleanup();
        if (error) return reject(Object.assign(new Error('AGY usage command failed'), { accountHandle }));
        try { resolve({ quotas: parseAgyUsage(stdout), accountHandle }); }
        catch (parseError) { reject(Object.assign(parseError, { accountHandle })); }
      });
    } catch {
      cleanup();
      reject(new Error('AGY usage command failed'));
    }
  });
}

export function buildAgyArgs({ prompt, mode = 'plan', model = DEFAULT_AGY_MODEL, effort, outputFormat }) {
  const args = ['--mode', mode, '--model', model];
  if (effort) args.push('--effort', effort);
  if (outputFormat) args.push('--output-format', outputFormat);
  args.push('-p', prompt);
  return args;
}

export function runAgyProcess(
  { prompt, mode = 'plan', model = DEFAULT_AGY_MODEL, effort, outputFormat, cwd, agyBin = 'agy' },
  { execFileImpl = execFile, timeoutMs = DEFAULT_AGY_TIMEOUT_MS, maxBuffer = DEFAULT_AGY_MAX_BUFFER, signal } = {},
) {
  const args = buildAgyArgs({ prompt, mode, model, effort, outputFormat });
  return new Promise((resolve, reject) => {
    execFileImpl(agyBin, args, { cwd, timeout: timeoutMs, maxBuffer, signal, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stdout || stderr || error.message).trim()));
        return;
      }
      if (!stdout || !stdout.trim()) {
        reject(new Error('agy returned no output — the call may have been silently denied rather than a clean empty result. Re-check the prompt/scope.'));
        return;
      }
      resolve(stdout);
    });
  });
}
