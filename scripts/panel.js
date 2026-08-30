#!/usr/bin/env node
// Loopback-only, never behind the Funnel: it writes config and runs commands. Token-gated so no other browser page can POST to it.
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPanel } from './config-page.js';
import { loadAllowlist, loadAllowlistDirs, readSettings, DEFAULT_ALLOWLIST } from './allowlist.js';
import { getRoots, overlaps } from './roots.js';
import { funnelStatus } from './tailscale.js';
import { SETTINGS_PATH, USER_DIR, INGRESS_CONFIG_PATH, CLOUDFLARED_CRED_PATH, readIngressConfig } from './userdata.js';
import { readBody, json, serveStatic } from './http.js';
import { getLocalVersions, cmpSemver, writeStatusFile } from './update-check.js';

const IS_WIN = process.platform === 'win32';
const REPO_ROOT = process.cwd();
const RULES_DIR = path.join(os.homedir(), '.aki', 'akidevrule');
const SOURCE_REPO_FILE = path.join(RULES_DIR, '.source-repo');
const RULES_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

// Folders are a containment boundary (coding.C4): written atomically so a partial write can never transiently widen it. Mirrors setShellAllowlist below, but folders are security-load-bearing enough to warrant the extra step.
function setFolders(paths) {
  const settings = readSettings();
  settings.folders = paths;
  writeJsonAtomic(SETTINGS_PATH, settings);
}

// Whatever lands here becomes the gate shell-mcp checks, and a wrong type reads as "no restriction", not as an error.
function validateAllowlist(allowlist) {
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) throw new Error('allowlist must be a JSON object');
  for (const [bin, subs] of Object.entries(allowlist)) {
    const ok = subs === null || (Array.isArray(subs) && subs.every((s) => typeof s === 'string'));
    if (!ok) throw new Error(`"${bin}": must be null (any subcommand) or an array of strings`);
  }
  return allowlist;
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
    throw new Error('folder list must be absolute paths');
  }
  if (!paths.length) throw new Error('an empty list cuts off all of Claude\'s file access; add at least one folder');
  return paths.map((p) => path.normalize(p));
}

const sameSubs = (a, b) =>
  a === null || b === null ? a === b : Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// Diff against DEFAULT_ALLOWLIST so a deleted default lands in `revoked`, not silently back to default. `added` is the 2-level array (string = any, [bin, ...subs] = restricted): no hand-written null.
const entryOf = ([bin, subs]) => (subs === null ? bin : [bin, ...subs]);
function toStored(effective) {
  const added = Object.entries(effective)
    .filter(([bin, subs]) => !(bin in DEFAULT_ALLOWLIST) || !sameSubs(subs, DEFAULT_ALLOWLIST[bin]))
    .map(entryOf);
  const revoked = Object.keys(DEFAULT_ALLOWLIST).filter((bin) => !(bin in effective));
  return { added, revoked };
}

function setShellAllowlist(allowlist) {
  const settings = readSettings();
  settings.shell = { ...settings.shell, allowlist: toStored(allowlist) };
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function validateTrustedDirs(dirs) {
  if (!Array.isArray(dirs) || !dirs.every((d) => typeof d === 'string' && path.isAbsolute(d))) {
    throw new Error('trusted directories must be absolute paths');
  }
  return dirs.map((p) => path.normalize(p));
}

function setTrustedDirs(dirs) {
  const settings = readSettings();
  settings.shell = { ...settings.shell, allowlistDirs: dirs };
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

// Mirrors the same TunnelID check start.js does at boot (spawnCloudflared), so a bad file is caught here instead of silently tearing down the stack on next `npm start`.
function validateCloudflaredCred(credContent) {
  let parsed;
  try {
    parsed = JSON.parse(credContent);
  } catch {
    throw new Error('not valid JSON — upload the cloudflared credentials file as-is');
  }
  if (!parsed.TunnelID) throw new Error('no TunnelID field — this does not look like a cloudflared credentials JSON');
  return credContent;
}

function validateIngressOrigin(origin) {
  const trimmed = (origin || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(trimmed)) throw new Error('origin must be a full URL, e.g. https://your-host');
  return trimmed;
}

// Browser file inputs cannot hand back an OS path, so the content is persisted here and referenced by path instead.
function saveCloudflaredIngress(credContent, origin) {
  writeFileSync(CLOUDFLARED_CRED_PATH, validateCloudflaredCred(credContent), { mode: 0o600 });
  const saved = { mode: 'cloudflared', credPath: CLOUDFLARED_CRED_PATH, origin: validateIngressOrigin(origin) };
  writeFileSync(INGRESS_CONFIG_PATH, `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}

// Clears only the pointer, not the persisted cred file — a re-save can reuse it without a re-upload.
function clearSavedIngress() {
  if (existsSync(INGRESS_CONFIG_PATH)) unlinkSync(INGRESS_CONFIG_PATH);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 180_000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout || stderr || '(no output)'),
    );
  });
}

// Three states, one button: already cloned locally, cloned by us before, or never seen on this machine.
async function installRules() {
  const recorded = existsSync(SOURCE_REPO_FILE) ? readFileSync(SOURCE_REPO_FILE, 'utf8').trim() : null;
  let repo = recorded && existsSync(path.join(recorded, 'install.sh')) ? recorded : null;

  if (!repo) {
    if (existsSync(path.join(RULES_CLONE_DIR, '.git'))) {
      await run('git', ['-C', RULES_CLONE_DIR, 'pull', '--ff-only']);
    } else {
      mkdirSync(path.dirname(RULES_CLONE_DIR), { recursive: true });
      await run('git', ['clone', '--depth', '1', RULES_REPO_URL, RULES_CLONE_DIR]);
    }
    repo = RULES_CLONE_DIR;
  }
  const bash = IS_WIN ? 'bash.exe' : 'bash';
  try {
    const log = await run(bash, [path.join(repo, 'install.sh')], repo);
    return `${log.trim().split('\n').pop()} (source: ${repo})`;
  } catch (e) {
    if (IS_WIN && /ENOENT|not found|not recognized/i.test(e.message)) {
      throw new Error('bash not found — install Git for Windows (includes bash) or run the install command from the panel manually');
    }
    throw e;
  }
}

// Pull this repo, but only when the tree is clean — an unattended pull over local edits can conflict or lose work (agent.B3). Checked at click-time, not page-load, since the tree can change in between.
async function pullUpdate() {
  if (!existsSync(path.join(REPO_ROOT, '.git'))) {
    throw new Error('this is not a git checkout — download the latest zip from the repo instead');
  }
  const dirty = (await run('git', ['-C', REPO_ROOT, 'status', '--porcelain'])).trim();
  if (dirty && dirty !== '(no output)') {
    throw new Error('working tree has uncommitted changes — commit or stash them first, then pull');
  }
  await run('git', ['-C', REPO_ROOT, 'pull', '--ff-only']);
  return 'pulled latest — press Ctrl+C and run `npm start` again to load the new code';
}

// Mirror shell-mcp's classification: a zone overlapping a writable root is dropped (write+exec = RCE). Name the offending root so the panel can show why a zone is disabled.
function trustedDirStatus() {
  const roots = getRoots().map((p) => path.resolve(p));
  return loadAllowlistDirs().map((dir) => {
    const conflict = roots.find((root) => overlaps(dir, root)) || null;
    return { dir, active: !conflict, conflict };
  });
}

// A rule install updates the on-disk corpus but not the boot-time updateInfo, so without this a reload re-rendered a stale "update available" banner. Recompute current from disk against the boot-time latest.
function refreshLocalVersions(updateInfo) {
  const local = getLocalVersions();
  for (const key of ['mcp', 'rule']) {
    updateInfo[key].current = local[key];
    updateInfo[key].updateAvailable = cmpSemver(local[key], updateInfo[key].latest) < 0;
  }
  writeStatusFile(updateInfo);
}

const ROUTES = {
  'GET /api/state': async (body, ctx) => ({
    // Same call shell/find_path/search_content enforce with (roots.js:getRoots()), so the list can never show a set that isn't the live one.
    paths: getRoots(),
    allowlist: loadAllowlist(),
    trustedDirs: trustedDirStatus(),
    ruleFiles: existsSync(RULES_DIR) ? readdirSync(RULES_DIR).filter((f) => /^(index|RULE-.+|METHOD-.+)\.md$/.test(f)).sort() : [],
    ingressConfig: readIngressConfig(),
  }),
  'GET /api/tailscale': async () => funnelStatus(process.env.GATEKEEPER_PORT || '9999'),
  // No hub restart: setFolders writes setting.json, and roots.js reads it fresh per call — a save takes effect on the next shell/find_path/search_content call, same as the allowlist.
  'POST /api/paths': async (body) => {
    setFolders(validatePaths(body.paths));
    return { ok: true, message: 'saved — shell, find, and search pick this up on their next call' };
  },
  'POST /api/allowlist': async (body) => {
    setShellAllowlist(validateAllowlist(body.allowlist));
    return { ok: true, message: `saved allowlist to ${SETTINGS_PATH}` };
  },
  // No hub restart: shell-mcp reads allowlistDirs fresh per command (checkPermission → preallowedByDir), so a save takes effect on the next run_cmd.
  'POST /api/trusted-dirs': async (body) => {
    setTrustedDirs(validateTrustedDirs(body.dirs));
    return { ok: true, message: `saved trusted directories to ${SETTINGS_PATH}` };
  },
  'POST /api/install-rules': async (body, ctx) => {
    const message = await installRules();
    refreshLocalVersions(ctx.updateInfo);
    return { ok: true, message };
  },
  // No refresh: a repo pull only lands on disk; the process keeps the old version until restart, so the banner stays as a restart reminder and clears on the next boot.
  'POST /api/pull-update': async () => ({ ok: true, message: await pullUpdate() }),
  // Ingress is decided at start.js boot, not live-switchable — saving here never restarts anything, only records the pick for the next `npm start`.
  'POST /api/ingress/cloudflared': async (body) => {
    const saved = saveCloudflaredIngress(body.credContent, body.origin);
    return { ok: true, message: 'saved — restart `npm start` to use this ingress', saved };
  },
  'POST /api/ingress/clear': async () => {
    clearSavedIngress();
    return { ok: true, message: 'cleared — restart `npm start` to go back to Tailscale Funnel', saved: null };
  },
};

// Plain !== leaks timing info a remote-timing attacker could use to guess the token byte-by-byte; timingSafeEqual removes that side channel (requires equal-length buffers, hence the length check first).
function tokenMatches(candidate, expected) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function startPanel({ port, token, origin, ingress, client, passphrase, updateInfo }) {
  const server = http.createServer(async (req, res) => {
    const [urlPath, query] = (req.url || '').split('?');
    const route = `${req.method} ${urlPath}`;

    if (route === 'GET /') {
      if (!tokenMatches(new URLSearchParams(query).get('t'), token)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('wrong token — open the URL that `npm start` printed');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPanel({ origin, ingress, client, passphrase, token, repoRoot: REPO_ROOT, rulesDir: RULES_DIR, userDir: USER_DIR, updateInfo, hasGit: existsSync(path.join(REPO_ROOT, '.git')), savedIngress: readIngressConfig() }));
    }

    if (req.method === 'GET' && await serveStatic(res, urlPath)) return;

    const handler = ROUTES[route];
    if (!handler) return json(res, 404, { error: 'not found' });
    if (!tokenMatches(req.headers['x-panel-token'], token)) return json(res, 403, { error: 'sai token' });

    try {
      json(res, 200, await handler(JSON.parse((await readBody(req)) || '{}'), { updateInfo }));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  server.listen(port, '127.0.0.1', () => console.log(`[panel] http://127.0.0.1:${port}/?t=${token}`));
  return server;
}
