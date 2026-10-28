#!/usr/bin/env node
// Loopback-only, never behind the Funnel: it writes config and runs commands. Token-gated so no other browser page can POST to it.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPanel, localMcpUrl, httpBearerEntry, claudeCodeLines, CODEX_TABLE, codexBlock, tempTokenKickoff } from './config-page.js';
import { MCP_SERVER_KEY, LEGACY_MCP_SERVER_KEY } from './mcp-name.js';
import { getOrIssueAccessToken, rotateAccessToken, mintTempToken, listTempTokens, revokeTempTokenById, rotatePassphrase, loadOrCreatePassphrase, listClients, removeClient } from './oauth.js';
import { logSecurity, readSecurityLog } from './security-log.js';
import { LOG_DEFAULTS, loadLogSettings, normalizeLogSettings } from './tool-call-log.js';
import { listCallers } from './callers.js';
import { loadAllowlist, loadAllowlistDirs, readSettings, writeSettings, DEFAULT_ALLOWLIST } from './allowlist.js';
import { getRoots } from './roots.js';
import { funnelStatus } from './tailscale.js';
import { SETTINGS_PATH, USER_DIR, INGRESS_CONFIG_PATH, CLOUDFLARED_CRED_PATH, readIngressConfig } from './userdata.js';
import { readBody, json, serveStatic, serveFontAwesome } from './http.js';
import { failures, readLimits, validateLimits, LIMIT_DEFAULTS } from './rate-limit.js';
import { getLocalVersions, cmpSemver, writeStatusFile, getRuleStatus } from './update-check.js';
import { getDaemonStatus, launchPostmanDaemon, killPostmanDaemon, requestNewWindow } from './postman/postman-mcp.js';
import { listProviders, setEnabled, redetect } from './provider-registry.js';
import { fileURLToPath } from 'node:url';
import { launchShim } from './find-on-path.js';

const IS_WIN = process.platform === 'win32';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_DIR = path.join(os.homedir(), '.aki', 'akidevrule');
const SOURCE_REPO_FILE = path.join(RULES_DIR, '.source-repo');
const RULES_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';

const writeJsonAtomic = (file, data) => writeTextAtomic(file, `${JSON.stringify(data, null, 2)}\n`);

// Always 0600: some of these files hold the live bearer token and the rename replaces the target's mode. realpath writes through a dotfile manager's symlink, keeping the link.
function writeTextAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const target = existsSync(file) ? realpathSync(file) : file;
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, target);
}

function runClaude(args, cwd) {
  const launch = launchShim('claude', args);
  return new Promise((resolve) => {
    execFile(launch.file, launch.args, { timeout: 20_000, windowsHide: true, cwd, ...launch.options }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout || ''}${stderr || ''}`.trim(), code: error?.code });
    });
  });
}
// Local scope beats user scope, and only the pre-3.1 snippet (no -s, legacy key) ever wrote a local entry, so the sweep targets the legacy key alone.
function projectsWithLocalEntry() {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');
  try {
    const { projects = {} } = JSON.parse(readFileSync(file, 'utf8'));
    return Object.keys(projects).filter((dir) => projects[dir]?.mcpServers?.[LEGACY_MCP_SERVER_KEY] && existsSync(dir));
  } catch {
    return [];
  }
}
// Remove-then-add, for the reason on claudeCodeLines in config-page.js.
async function applyClaudeCode() {
  const url = localMcpUrl();
  const token = getOrIssueAccessToken();
  const byHand = `Run these two lines in a terminal instead:\n${claudeCodeLines(url, token)}`;
  const probe = await runClaude(['--version']);
  if (!probe.ok && probe.code === 'ENOENT') return { ok: false, message: `claude is not on PATH. ${byHand}` };
  for (const key of [MCP_SERVER_KEY, LEGACY_MCP_SERVER_KEY]) await runClaude(['mcp', 'remove', key, '-s', 'user']); // an absent entry is not an error
  const added = await runClaude(['mcp', 'add', '--transport', 'http', '-s', 'user', MCP_SERVER_KEY, url, '--header', `Authorization: Bearer ${token}`]);
  if (!added.ok) return { ok: false, message: `claude mcp add failed: ${added.out || 'unknown error'}\n${byHand}` };
  const local = projectsWithLocalEntry();
  const failed = [];
  for (const dir of local) if (!(await runClaude(['mcp', 'remove', LEGACY_MCP_SERVER_KEY, '-s', 'local'], dir)).ok) failed.push(dir);
  const removed = local.length - failed.length;
  const localNote = (removed ? ` Also removed the old ${LEGACY_MCP_SERVER_KEY} entry kept inside ${removed} project${removed > 1 ? 's' : ''}.` : '')
    + (failed.length ? ` Could not remove the old entry inside: ${failed.join(', ')}. Run "claude mcp remove ${LEGACY_MCP_SERVER_KEY} -s local" in each.` : '');
  return { ok: true, message: `Applied — ${MCP_SERVER_KEY} now carries the current token in user scope; an older ${LEGACY_MCP_SERVER_KEY} entry is gone.${localNote} Restart the session or run /mcp in Claude Code.` };
}

// A Codex table = header (bare or quoted key, trailing comment ok) + every `.sub` table: a leftover subtable duplicates the inline http_headers key; a second same-name table is invalid TOML.
const TOML_HEADER = /^\s*(\[\[?)\s*((?:[\w.\- ]|"[^"]*"|'[^']*')+?)\s*\]\]?\s*(?:#.*)?$/;
const tableName = (line) => {
  const header = TOML_HEADER.exec(line);
  return header?.[1] === '[' ? header[2].replace(/\s*\.\s*/g, '.').replace(/["']/g, '') : undefined;
};
const isTableHeader = (line) => TOML_HEADER.test(line);
function withoutTomlTable(text, header) {
  const name = header.slice(1, -1);
  const owned = (line) => { const found = tableName(line); return found === name || Boolean(found?.startsWith(`${name}.`)); };
  const kept = [];
  let at = -1;
  let dropping = false;
  for (const line of text.split('\n')) {
    if (isTableHeader(line)) dropping = owned(line);
    if (!dropping) kept.push(line);
    else if (at < 0) at = kept.length;
  }
  return { kept, at };
}
const splitAround = (kept, at) => [kept.slice(0, at).join('\n').replace(/\n*$/, ''), kept.slice(at).join('\n').replace(/^\n*/, '')];
function replaceTomlTable(text, header, block) {
  const { kept, at } = withoutTomlTable(text, header);
  if (at < 0) return `${text.replace(/\n*$/, '')}\n\n${block}\n`;
  const [before, after] = splitAround(kept, at);
  return `${before ? before + '\n\n' : ''}${block}\n${after ? '\n' + after : ''}`;
}
function removeTomlTable(text, header) {
  const { kept, at } = withoutTomlTable(text, header);
  if (at < 0) return text;
  const rest = splitAround(kept, at).filter(Boolean).join('\n\n').replace(/\n*$/, '');
  return rest ? `${rest}\n` : '';
}
function applyCodex() {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  const block = codexBlock(localMcpUrl(), getOrIssueAccessToken());
  let existing = '';
  if (existsSync(file)) {
    existing = readFileSync(file, 'utf8');
    if (existing.includes('\u0000')) throw new Error(`${file} looks corrupt (null byte) — fix or remove it, then retry`);
  }
  writeTextAtomic(file, replaceTomlTable(removeTomlTable(existing, `[mcp_servers.${LEGACY_MCP_SERVER_KEY}]`), CODEX_TABLE, block));
  return { ok: true, message: `Applied — ${CODEX_TABLE} in ~/.codex/config.toml now carries the current token and an older [mcp_servers.${LEGACY_MCP_SERVER_KEY}] table is gone (other tables untouched). Restart Codex.` };
}

// Cursor (D10): merge mcpServers.akimcp into ~/.cursor/mcp.json; other servers untouched. Unparsable file stops with the path named.
function applyCursor() {
  const file = path.join(os.homedir(), '.cursor', 'mcp.json');
  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8')) || {};
    } catch {
      throw new Error(`${file} is not valid JSON — fix or remove it, then retry`);
    }
  }
  config.mcpServers = config.mcpServers || {};
  delete config.mcpServers[LEGACY_MCP_SERVER_KEY];
  config.mcpServers[MCP_SERVER_KEY] = httpBearerEntry(localMcpUrl(), getOrIssueAccessToken());
  writeJsonAtomic(file, config);
  return { ok: true, message: `Applied — ${MCP_SERVER_KEY} in ~/.cursor/mcp.json now carries the current token; an older ${LEGACY_MCP_SERVER_KEY} entry is gone. Reload Cursor.` };
}

// Every setting.json write goes through writeSettings (atomic): a partial file reads back as empty, which means defaults, i.e. a wider folder list or allowlist than the owner saved.
function setFolders(paths) {
  const settings = readSettings();
  settings.folders = paths;
  writeSettings(settings);
}

function setRateLimit(limits) {
  const settings = readSettings();
  settings.rateLimit = limits;
  writeSettings(settings);
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
  writeSettings(settings);
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
  writeSettings(settings);
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
  // Only the saved pick: Funnel never lands here, so AIObox takes the running origin from instance.json (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
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
  // Windows uses install.ps1: a bare `bash.exe` resolves to the WSL launcher and fails with "execvpe(/bin/bash) failed" when no distro is installed.
  let cmd, args;
  if (IS_WIN) {
    if (existsSync(path.join(repo, 'install.ps1'))) {
      cmd = 'powershell';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'install.ps1')];
    } else {
      throw new Error('this akidevrule clone has no install.ps1 for Windows — pull the latest akidevrule and retry');
    }
  } else {
    cmd = 'bash';
    args = [path.join(repo, 'install.sh')];
  }
  try {
    const log = await run(cmd, args, repo);
    return `${log.trim().split('\n').pop()} (source: ${repo})`;
  } catch (e) {
    if (IS_WIN && /ENOENT|not found|not recognized|execvpe|\/bin\/bash|WSL/i.test(e.message)) {
      throw new Error('Windows install failed — could not run install.ps1 (do not use WSL bash): ' + e.message);
    }
    throw e;
  }
}

// Pull only on a clean tree (a pull over local edits can conflict or lose work), checked at click-time since the tree can change after page-load.
async function pullUpdate() {
  if (!existsSync(path.join(REPO_ROOT, '.git'))) {
    throw new Error('installed via npm: run `npm i -g @akinet/akimcp` in your terminal to update');
  }
  const dirty = (await run('git', ['-C', REPO_ROOT, 'status', '--porcelain'])).trim();
  if (dirty && dirty !== '(no output)') {
    throw new Error('working tree has uncommitted changes — commit or stash them first, then pull');
  }
  await run('git', ['-C', REPO_ROOT, 'pull', '--ff-only']);
  return 'pulled latest — restart akimcp to load the new code';
}

// A rule install updates the on-disk corpus but not the boot-time updateInfo; recompute current from disk, else a reload shows a stale "update available" banner.
function refreshLocalVersions(updateInfo) {
  const local = getLocalVersions();
  updateInfo.mcp.current = local.mcp;
  updateInfo.mcp.updateAvailable = cmpSemver(local.mcp, updateInfo.mcp.latest) < 0;
  // Rebuild the whole rule branch (installed/unreleasedOnly/state), not just current, so a post-install reload flips "not installed" -> "installed" and clears the update badge — same source as boot.
  updateInfo.rule = getRuleStatus(updateInfo.rule?.latest ?? null);
  writeStatusFile(updateInfo);
}

export const ROUTES = {
  'GET /api/state': async (body, ctx) => ({
    // Same call shell/find_path/search_content enforce with (roots.js:getRoots()), so the list can never show a set that isn't the live one.
    paths: getRoots(),
    allowlist: loadAllowlist(),
    trustedDirs: loadAllowlistDirs(),
    ingressConfig: readIngressConfig(),
  }),
  'GET /api/tailscale': async () => funnelStatus(process.env.GATEKEEPER_PORT || '9999'),
  // Same function aki__postman_status calls (scripts/postman/postman-mcp.js) — one status shape, two readers.
  'GET /api/postman-status': async () => getDaemonStatus(),
  // Spawn-or-recognize lives in launchPostmanDaemon (scripts/postman/postman-mcp.js), so N clicks behave like one.
  'POST /api/postman-launch': async () => launchPostmanDaemon(),
  // Quit returns the real post-kill status (running/pid), never a placeholder "stopping…".
  'POST /api/postman-quit': async () => killPostmanDaemon(),
  // New window shown only while running — asks the already-running daemon to fire the same mediator trigger its own injected panel button uses (requestNewWindow, scripts/postman/postman-mcp.js).
  'POST /api/postman-new-window': async () => requestNewWindow(),
  // Servers go to mcp_config.json, permissions to settings.json — docs/ref/fact-agy-mcp-config.md § CLI-1, CLI-3, CLI-4.
  // The panel's instance token is not a /mcp access token (401), hence stdio. Idempotent: merges, never clobbers other entries.
  'POST /api/agy-apply-mcp': async () => {
    // (A) MCP server -> ~/.gemini/config/mcp_config.json as a stdio entry.
    const mcpConfigPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    let mcpConfig = {};
    if (existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) || {};
      } catch {
        throw new Error(`${mcpConfigPath} is not valid JSON — fix or remove it, then retry`);
      }
    }
    mcpConfig.mcpServers = mcpConfig.mcpServers || {};
    mcpConfig.mcpServers[MCP_SERVER_KEY] = { command: 'node', args: [path.join(REPO_ROOT, 'scripts', 'stdio.js')] };
    writeJsonAtomic(mcpConfigPath, mcpConfig);

    // (B) Pre-allow -> ~/.gemini/antigravity-cli/settings.json (permissions only; agy does NOT read MCP servers here).
    // Also drop any stale akimcp server entry a previous (wrong) version wrote under mcpServers here.
    const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
    let settings = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8')) || {};
      } catch {
        throw new Error(`${settingsPath} is not valid JSON — fix or remove it, then retry`);
      }
    }
    if (settings.mcpServers && settings.mcpServers[MCP_SERVER_KEY]) delete settings.mcpServers[MCP_SERVER_KEY];
    settings.permissions = settings.permissions || { allow: [], deny: [] };
    settings.permissions.allow = settings.permissions.allow || [];
    settings.permissions.allow = [...new Set([...settings.permissions.allow, `mcp(${MCP_SERVER_KEY}/*)`])];
    writeJsonAtomic(settingsPath, settings);

    return { ok: true, message: 'Applied — akimcp (stdio) → ~/.gemini/config/mcp_config.json + pre-allow → antigravity-cli/settings.json. Restart agy to pick it up.' };
  },
  // One-click Apply with the live token, so Roll token is a re-click (docs/plan/done/audit-tool-drift-oct25.md D10, F9, F10); idempotent: a second Apply replaces the entry.
  'POST /api/claude-code-apply': async () => applyClaudeCode(),
  'POST /api/codex-apply': async () => applyCodex(),
  'POST /api/cursor-apply': async () => applyCursor(),
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
  // Same registry the tools server mounts from (provider-registry.js), in this process: a switch enables/disables the tools on the live shared server, and clients see it on their next tools/list.
  'GET /api/providers': async () => listProviders(),
  'POST /api/providers': async (body) => {
    if (body.redetect === true) return redetect();
    setEnabled(body.id, body.enabled);
    return listProviders();
  },
  // AIObox reads clients[] and callers[] here with x-panel-token (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
  'GET /api/log': async () => ({ settings: loadLogSettings(), defaults: LOG_DEFAULTS }),
  'POST /api/log': async (body) => {
    const settings = readSettings();
    settings.log = normalizeLogSettings(body.log, { strict: true });
    writeSettings(settings);
    return { ok: true, message: 'saved — the next logged call uses it; past lines keep their shape' };
  },
  'GET /api/security': async () => ({ limits: readLimits(), defaults: LIMIT_DEFAULTS, blocked: failures.blockedList(), clients: listClients(), callers: listCallers(), log: readSecurityLog() }),
  // AIObox's connect and readiness read the bearer token here with x-panel-token instead of tokens.json, so that file's format stays free (docs/plan/done/akimcp-aiobox-boundary-plan.md § 4 I4).
  'GET /api/access-token': async () => ({ accessToken: getOrIssueAccessToken() }),
  // The plain token leaves only in this reply (docs/plan/done/web-chat-client.md); a web chat reaches the public origin, so loopback-only runs have nothing to hand out.
  'POST /api/temp-token': async (body, ctx) => {
    if (!ctx.origin) throw new Error('a web chat needs a public address: set one up in section 0 first');
    const { token, expires } = mintTempToken();
    return { ok: true, expires, kickoff: tempTokenKickoff({ mcpUrl: `${ctx.origin}/mcp`, token, expires }) };
  },
  'GET /api/temp-tokens': async () => ({ tokens: listTempTokens() }),
  'POST /api/temp-token/revoke': async (body) => {
    const ids = body.all === true ? listTempTokens().map((t) => t.id) : [body.id];
    const ended = ids.filter(revokeTempTokenById).length;
    return { ok: true, message: `revoked ${ended} temporary token${ended === 1 ? '' : 's'}` };
  },
  // Only roll === true rolls: a removed client still holds the shared token, so cutting it rolls it for every Bearer holder. AIObox calls this (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
  'POST /api/clients/remove': async (body) => {
    const outcome = removeClient(typeof body.clientId === 'string' ? body.clientId : '');
    if (body.roll !== true) return { ok: true, message: outcome };
    rotateAccessToken({ revokeRefresh: false });
    return { ok: true, message: `${outcome} and rolled the access token. Signed-in OAuth connectors renew on their next request (ClickUp may need one reconnect); Bearer clients (Buda, local Claude Code, Codex and Cursor) need the new token: click Apply again or re-paste.` };
  },
  'POST /api/rate-limit': async (body) => {
    setRateLimit(validateLimits(body.limits));
    logSecurity('connection limits saved');
    return { ok: true, message: 'saved — applies from the next request' };
  },
  'POST /api/rate-limit/release': async (body) => {
    const key = typeof body.key === 'string' ? body.key : undefined;
    failures.release(key);
    logSecurity(key ? `released ${key.slice(0, 64)}` : 'released every blocked caller');
    return { ok: true, message: body.key ? 'released' : 'everyone released' };
  },
  'POST /api/install-rules': async (body, ctx) => {
    const message = await installRules();
    refreshLocalVersions(ctx.updateInfo);
    return { ok: true, message };
  },
  // The page reloads after this so every server-rendered snippet carries the new token; the token itself is never returned.
  'POST /api/roll-token': async (body) => {
    rotateAccessToken({ revokeRefresh: body.hard === true });
    // D10: Applied Bearer clients now hold a stale token; all three are named because the panel does not track which were used (lighter than a state file).
    const reapply = 're-click Apply on the Claude Code, Codex and Cursor tabs (or re-paste their snippets)';
    return { ok: true, message: body.hard === true ? `rolled — every client must re-authorize; ${reapply}` : `rolled — ${reapply}` };
  },
  'POST /api/roll-passphrase': async () => {
    rotatePassphrase();
    return { ok: true, message: 'rolled — the old passphrase no longer authorizes; connected AIs keep working' };
  },
  // No refresh: a repo pull only lands on disk; the process keeps the old version until restart, so the banner stays as a restart reminder and clears on the next boot.
  'POST /api/pull-update': async () => ({ ok: true, message: await pullUpdate() }),
  // Ingress is decided at start.js boot, not live-switchable — saving here never restarts anything, only records the pick for the next `npm start`.
  'POST /api/ingress/cloudflared': async (body) => {
    const saved = saveCloudflaredIngress(body.credContent, body.origin);
    return { ok: true, message: 'saved — restart akimcp to use this ingress', saved };
  },
  'POST /api/ingress/clear': async () => {
    clearSavedIngress();
    return { ok: true, message: 'cleared — restart akimcp to go back to Tailscale Funnel', saved: null };
  },
};

export function startPanel({ port, token, origin, ingress, client, passphrase, updateInfo, isDev = false, onFatal }) {
  const server = http.createServer(async (req, res) => {
    const [urlPath, query] = (req.url || '').split('?');
    const route = `${req.method} ${urlPath}`;

    if (route === 'GET /') {
      if (new URLSearchParams(query).get('t') !== token) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('wrong token — open the URL printed in your terminal');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPanel({ origin, ingress, client, passphrase: loadOrCreatePassphrase(), token, accessToken: getOrIssueAccessToken(), repoRoot: REPO_ROOT, rulesDir: RULES_DIR, userDir: USER_DIR, updateInfo, savedIngress: readIngressConfig(), isDev }));
    }

    if (req.method === 'GET' && (await serveStatic(res, urlPath) || await serveFontAwesome(res, urlPath))) return;

    const handler = ROUTES[route];
    if (!handler) return json(res, 404, { error: 'not found' });
    if (req.headers['x-panel-token'] !== token) return json(res, 403, { error: 'wrong panel token: reload the panel from the URL printed in the terminal' });

    try {
      json(res, 200, await handler(JSON.parse((await readBody(req)) || '{}'), { updateInfo, origin }));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  // Unlike the gatekeeper (mapped to a fixed port by Tailscale/cloudflared ingress), nothing external pins the panel's port, so stepping past a conflict is safe.
  const MAX_PORT_ATTEMPTS = 20;
  let attempt = 0;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      attempt++;
      server.listen(port + attempt, '127.0.0.1');
      return;
    }
    console.error(`[panel] failed to listen on :${port + attempt}: ${e.message}`);
    onFatal?.();
  });
  server.on('listening', () => {
    server.actualPort = server.address().port;
    console.log(`[panel] http://127.0.0.1:${server.actualPort}/?t=${token}`);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
