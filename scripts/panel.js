#!/usr/bin/env node
// Loopback-only, never behind the Funnel: it writes config and runs commands. Token-gated so no other browser page can POST to it.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPanel } from './config-page.js';
import { loadAllowlist, loadAllowlistDirs, readSettings, DEFAULT_ALLOWLIST } from './allowlist.js';
import { overlaps } from './roots.js';
import { funnelStatus } from './tailscale.js';
import { HUB_CONFIG_PATH as HUB_CONFIG, SETTINGS_PATH, USER_DIR } from './userdata.js';
import { readBody, json, serveStatic } from './http.js';

const IS_WIN = process.platform === 'win32';
const REPO_ROOT = process.cwd();
const RULES_DIR = path.join(os.homedir(), '.aki', 'akidevrule');
const SOURCE_REPO_FILE = path.join(RULES_DIR, '.source-repo');
const RULES_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

// Shows placeholders expanded and saves back what it shows: a folder list is only checkable if it reads as real folders.
const expandPath = (p, dataDir) =>
  p
    .replace(/\$\{MCP_DATA_DIR\}/g, dataDir)
    .replace(/\$\{HOME\}/g, os.homedir())
    .replace(/\$\{userHome\}/g, os.homedir())
    .replace(/\$\{pathSeparator\}/g, path.sep)
    .replace(/\$\{\/\}/g, path.sep);

function filesystemPaths(dataDir) {
  return readJson(HUB_CONFIG, {}).mcpServers.filesystem.args.slice(2).map((p) => expandPath(p, dataDir));
}

// The tool arms enforce path containment via this same list, so it never drifts from what the panel shows as "allowed". Update every server scoped by MCP_DATA_DIR, whichever exist, so it holds across both the pre- and post-consolidation config shape.
function setFilesystemPaths(paths) {
  const config = readJson(HUB_CONFIG, {});
  const [flag, pkg] = config.mcpServers.filesystem.args;
  config.mcpServers.filesystem.args = [flag, pkg, ...paths];
  const rootsEnv = paths.join(',');
  for (const srv of Object.values(config.mcpServers)) {
    if (srv.env && 'MCP_DATA_DIR' in srv.env) srv.env.MCP_DATA_DIR = rootsEnv;
  }
  writeFileSync(HUB_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
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
function trustedDirStatus(dataDir) {
  const roots = filesystemPaths(dataDir).map((p) => path.resolve(p));
  return loadAllowlistDirs().map((dir) => {
    const conflict = roots.find((root) => overlaps(dir, root)) || null;
    return { dir, active: !conflict, conflict };
  });
}

const ROUTES = {
  'GET /api/state': async (_body, ctx) => ({
    paths: filesystemPaths(ctx.dataDir),
    // The same call the MCP server enforces with, so the textarea can never show a set that isn't the live one.
    allowlist: loadAllowlist(),
    trustedDirs: trustedDirStatus(ctx.dataDir),
    ruleFiles: existsSync(RULES_DIR) ? readdirSync(RULES_DIR).filter((f) => /^(index|RULE-.+|METHOD-.+)\.md$/.test(f)).sort() : [],
  }),
  'GET /api/tailscale': async (_body, ctx) => ctx.ingressMode === 'frp' ? { frp: true, origin: ctx.origin } : funnelStatus(process.env.GATEKEEPER_PORT || '9999'),
  'POST /api/paths': async (body, ctx) => {
    setFilesystemPaths(validatePaths(body.paths));
    ctx.restartHub();
    return { ok: true, message: 'saved folders and restarted mcp-hub' };
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
  'POST /api/restart': async (_body, ctx) => {
    ctx.restartHub();
    return { ok: true, message: 'restarted mcp-hub' };
  },
  'POST /api/install-rules': async () => ({ ok: true, message: await installRules() }),
  'POST /api/pull-update': async () => ({ ok: true, message: await pullUpdate() }),
};

export function startPanel({ port, token, origin, client, passphrase, dataDir, restartHub, updateInfo, ingressMode = 'tailscale' }) {
  const server = http.createServer(async (req, res) => {
    const [urlPath, query] = (req.url || '').split('?');
    const route = `${req.method} ${urlPath}`;

    if (route === 'GET /') {
      if (new URLSearchParams(query).get('t') !== token) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('wrong token — open the URL that `npm start` printed');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPanel({ origin, client, passphrase, token, repoRoot: REPO_ROOT, rulesDir: RULES_DIR, userDir: USER_DIR, updateInfo, hasGit: existsSync(path.join(REPO_ROOT, '.git')), ingressMode }));
    }

    if (req.method === 'GET' && await serveStatic(res, urlPath)) return;

    const handler = ROUTES[route];
    if (!handler) return json(res, 404, { error: 'not found' });
    if (req.headers['x-panel-token'] !== token) return json(res, 403, { error: 'sai token' });

    try {
      json(res, 200, await handler(JSON.parse((await readBody(req)) || '{}'), { restartHub, dataDir, ingressMode, origin }));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  server.listen(port, '127.0.0.1', () => console.log(`[panel] http://127.0.0.1:${port}/?t=${token}`));
  return server;
}
