import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRoots } from './roots.js';

const PROJECT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];
const DEFAULT_LIMITS = { maxDepth: 32, maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
const defaultCache = new Map();

export class RuleContextError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleContextError'; this.code = code; }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (buffer) => buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const comparable = (value, platform) => platform === 'win32' ? value.toLowerCase() : value;
const contains = (child, parent, pathApi, platform) => {
  const c = comparable(pathApi.resolve(child), platform);
  const p = comparable(pathApi.resolve(parent), platform);
  return c === p || c.startsWith(p.endsWith(pathApi.sep) ? p : `${p}${pathApi.sep}`);
};

function importTarget(line, inFence) {
  if (inFence || !/^\s*@/.test(line)) return null;
  const match = line.match(/^\s*@([^\s`]+)\s*$/);
  return match?.[1] || null;
}

function rejectImport(target) {
  return /^(?:https?:|file:|[a-z]+:\/\/)/i.test(target)
    || /\$\{|\$\(|`|%[^%]+%|[*?{}[\]]/.test(target)
    || target.split(/[\\/]+/).includes('ref-ECC');
}

function resolveImport(target, declaringFile, homeDir, pathApi) {
  if (target === '~') return homeDir;
  if (/^~[\\/]/.test(target)) return pathApi.resolve(homeDir, target.slice(2));
  if (pathApi.isAbsolute(target)) return pathApi.resolve(target);
  return pathApi.resolve(pathApi.dirname(declaringFile), target);
}

function versionFrom(text) {
  const match = text?.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return match?.[1] || null;
}

async function productionDeps() {
  return { fs, path, platform: process.platform, homeDir: os.homedir(), roots: getRoots(), limits: DEFAULT_LIMITS, cache: defaultCache };
}

export async function assembleRuleContext(input = {}, suppliedDeps = {}) {
  const base = suppliedDeps.fs ? suppliedDeps : { ...(await productionDeps()), ...suppliedDeps };
  const fsp = base.fs;
  const pathApi = base.path || path;
  const platform = base.platform || process.platform;
  const homeDir = pathApi.resolve(base.homeDir || os.homedir());
  const roots = (base.roots || []).map((root) => pathApi.resolve(root));
  const limits = { ...DEFAULT_LIMITS, ...(base.limits || {}) };
  const cache = base.cache || new Map();
  const mode = input.mode || 'effective';
  if (!['effective', 'exact-audit'].includes(mode)) throw new RuleContextError('INVALID_MODE', 'mode must be effective or exact-audit');

  let workingDir = null;
  let workingRoot = null;
  if (input.workingPath != null) {
    if (typeof input.workingPath !== 'string' || !pathApi.isAbsolute(input.workingPath)) {
      throw new RuleContextError('INVALID_WORKING_PATH', 'workingPath must be an absolute local path');
    }
    let real;
    try { real = await fsp.realpath(pathApi.resolve(input.workingPath)); }
    catch (error) { throw new RuleContextError('WORKING_PATH_UNAVAILABLE', `workingPath cannot be resolved (${error.code || 'unknown'})`); }
    const stat = await fsp.stat(real);
    workingDir = stat.isDirectory() ? real : pathApi.dirname(real);
    const resolvedRoots = [];
    for (const root of roots) {
      try { resolvedRoots.push(await fsp.realpath(root)); } catch { /* unavailable roots authorize nothing */ }
    }
    workingRoot = resolvedRoots.filter((root) => contains(workingDir, root, pathApi, platform)).sort((a, b) => b.length - a.length)[0] || null;
    if (!workingRoot) throw new RuleContextError('OUTSIDE_ALLOWED_ROOTS', 'workingPath is outside configured roots');
  }

  const cacheKey = `${mode}\0${workingDir || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    let valid = true;
    for (const dep of cached.dependencies) {
      try {
        const stat = await fsp.stat(dep.path);
        if (`${stat.size}:${stat.mtimeMs}` !== dep.fingerprint) { valid = false; break; }
      } catch (error) {
        if (dep.fingerprint !== `missing:${error.code || 'ERR'}`) { valid = false; break; }
      }
    }
    if (valid) return input.knownReceipt === cached.result.receipt
      ? { ...cached.result, status: 'unchanged', context: '' }
      : { ...cached.result };
  }

  const globalZones = [];
  for (const zone of [pathApi.join(homeDir, '.claude'), pathApi.join(homeDir, '.aki', 'akidevrule')]) {
    try { globalZones.push(await fsp.realpath(zone)); } catch { globalZones.push(zone); }
  }
  const required = [
    { path: pathApi.join(homeDir, '.claude', 'CLAUDE.md'), kind: 'global' },
    { path: pathApi.join(homeDir, '.claude', 'skills', 'akirule', 'SKILL.md'), kind: 'local' },
  ];
  const warnings = [];
  const sources = [];
  const chunks = [];
  const seen = new Set();
  const active = new Set();
  const dependencies = new Map();
  const importGraph = [];
  const candidates = [];
  let totalBytes = 0;
  let rulesVersion = null;

  const remember = async (file) => {
    try { const stat = await fsp.stat(file); dependencies.set(file, `${stat.size}:${stat.mtimeMs}`); return stat; }
    catch (error) { dependencies.set(file, `missing:${error.code || 'ERR'}`); throw error; }
  };
  const authorized = (file) => globalZones.some((zone) => contains(file, zone, pathApi, platform))
    || (!!workingRoot && contains(file, workingRoot, pathApi, platform));

  async function load(file, kind, depth, requiredSource = false) {
    if (depth > limits.maxDepth) { warnings.push({ code: 'IMPORT_DEPTH_LIMIT', path: file }); return; }
    let real;
    try {
      await remember(file);
      real = await fsp.realpath(file);
      if (!authorized(real)) { warnings.push({ code: 'IMPORT_OUTSIDE_TRUST_ZONE', path: file }); return; }
    } catch (error) {
      if (requiredSource) warnings.push({ code: 'REQUIRED_SOURCE_MISSING', path: file });
      return;
    }
    if (active.has(real)) { warnings.push({ code: 'IMPORT_CYCLE', path: real }); return; }
    if (seen.has(real)) return;
    const stat = await remember(real);
    if (stat.size > limits.maxFileBytes) { warnings.push({ code: 'FILE_SIZE_LIMIT', path: real }); return; }
    let buffer;
    try { buffer = await fsp.readFile(real); }
    catch { warnings.push({ code: requiredSource ? 'REQUIRED_SOURCE_UNREADABLE' : 'SOURCE_UNREADABLE', path: real }); return; }
    if (totalBytes + buffer.length > limits.maxTotalBytes) { warnings.push({ code: 'ASSEMBLED_SIZE_LIMIT', path: real }); return; }
    const text = normalizeText(buffer);
    seen.add(real); active.add(real); totalBytes += buffer.length;
    sources.push({ path: real, kind, sha256: sha256(buffer), bytes: buffer.length });
    chunks.push(`<!-- source: ${real} -->\n`);
    let inFence = false;
    for (const line of text.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; chunks.push(`${line}\n`); continue; }
      const target = importTarget(line, inFence);
      if (!target) { chunks.push(`${line}\n`); continue; }
      if (rejectImport(target)) { warnings.push({ code: 'IMPORT_REJECTED', path: real, target }); chunks.push(`${line}\n`); continue; }
      const imported = resolveImport(target, real, homeDir, pathApi);
      importGraph.push({ from: real, to: imported });
      await load(imported, 'import', depth + 1, false);
    }
    active.delete(real);
  }

  for (const source of required) await load(source.path, source.kind, 0, true);
  const versionPath = pathApi.join(homeDir, '.aki', 'akidevrule', '.version');
  try { await remember(versionPath); rulesVersion = (await fsp.readFile(versionPath, 'utf8')).trim() || null; } catch { /* optional */ }
  if (!rulesVersion) {
    const changelogPath = pathApi.join(homeDir, '.aki', 'akidevrule', 'CHANGELOG.md');
    try { await remember(changelogPath); rulesVersion = versionFrom(await fsp.readFile(changelogPath, 'utf8')); } catch { /* optional */ }
  }

  if (workingDir) {
    const dirs = [];
    for (let cursor = workingDir; contains(cursor, workingRoot, pathApi, platform); cursor = pathApi.dirname(cursor)) {
      dirs.push(cursor);
      if (comparable(cursor, platform) === comparable(workingRoot, platform)) break;
    }
    dirs.reverse();
    for (const dir of dirs) for (const name of PROJECT_FILES) {
      const candidate = pathApi.join(dir, name); candidates.push(candidate);
      try { await remember(candidate); await load(candidate, name === 'CLAUDE.local.md' ? 'local' : 'project', 0, false); }
      catch { /* optional candidate */ }
    }
  } else warnings.push({ code: 'PROJECT_CONTEXT_NOT_LOADED' });

  const context = chunks.join('').trimEnd();
  const canonical = JSON.stringify({ mode, workingRoot, sources, context });
  const receipt = `sha256:${sha256(canonical)}`;
  const degraded = warnings.some((warning) => warning.code.startsWith('REQUIRED_') || warning.code.endsWith('_LIMIT'));
  const result = {
    status: degraded ? 'degraded' : 'ok',
    parity: mode === 'exact-audit' ? 'exact-audit-not-guaranteed' : 'practical-effective',
    receipt, rulesVersion, workingRoot, sources, warnings, context,
  };
  if (mode === 'exact-audit') result.audit = { candidates, importGraph, precedence: sources.map((source) => source.path), totalBytes };
  cache.set(cacheKey, { result, dependencies: [...dependencies].map(([file, fingerprint]) => ({ path: file, fingerprint })) });
  return input.knownReceipt === receipt ? { ...result, status: 'unchanged', context: '' } : result;
}
