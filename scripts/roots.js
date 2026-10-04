// Path containment shared by every MCP tool that touches the filesystem — one implementation, because a second copy of a security boundary is a second chance to get it subtly wrong.
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFolders, loadAllowlistDirs } from './allowlist.js';
import { TOKENS_PATH, PASSPHRASE_PATH, CLIENT_PATH, DCR_CLIENTS_PATH, CLOUDFLARED_CRED_PATH } from './userdata.js';

// Fallback when setting.json carries no `folders` key yet (fresh install, or a folder edit was never saved via the panel): reconstructs the same default the old boot-time MCP_DATA_DIR env var used to expand to (dataDir + ~/.aki + ~/.claude), so behavior is unchanged until the first save — including the rule/config dirs the panel's own prompt-builder tells the AI to read.
function envDefaultRoots() {
  const base = (process.env.MCP_DATA_DIR || os.homedir())
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const always = [path.join(os.homedir(), '.aki'), path.join(os.homedir(), '.claude')];
  return [...new Set([...(base.length ? base : [path.resolve(os.homedir())]), ...always])];
}

// Per-call read (no module-level snapshot): a folder add/remove in setting.json takes effect on the very next call, the same way the shell allowlist already does. An empty/malformed read must never widen to "no restriction" — the safe-default fallback below is mandatory, never optional.
export function getRoots() {
  const stored = loadFolders().map((p) => path.resolve(p));
  const roots = stored.length ? stored : envDefaultRoots();
  return roots.length ? roots : [path.resolve(os.homedir())];
}

export function containedIn(abs, root) {
  // Windows paths are case-insensitive; drive letter casing from different APIs must not bypass the boundary.
  if (process.platform === 'win32') {
    const a = abs.toLowerCase();
    const r = root.toLowerCase();
    return a === r || a.startsWith(r + path.sep.toLowerCase());
  }
  return abs === root || abs.startsWith(root + path.sep);
}

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (/^~[/\\]/.test(p)) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function resolveUnderRoot(target) {
  const roots = getRoots();
  if (!target) return roots[0];
  const expanded = expandTilde(target);
  const abs = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(roots[0], expanded);
  const allowed = roots.some((root) => containedIn(abs, root));
  if (!allowed) {
    throw new Error(`path is outside the allowed roots: ${roots.join(', ')}`);
  }
  return abs;
}

// Symlink-safe variant for filesystem-mcp.js's read/write/edit tools: resolveUnderRoot only checks the requested path's string prefix, which a symlink can defeat (a link *inside* a root pointing *outside* it). Ported from @modelcontextprotocol/server-filesystem's validatePath() — realpath the target and re-check containment on the resolved path, not the requested one. A target that doesn't exist yet (new file) falls back to validating its parent directory's real path instead, so file creation still works.
export async function resolveRealUnderRoot(target) {
  const abs = resolveUnderRoot(target);
  try {
    const real = await realpath(abs);
    if (!getRoots().some((root) => containedIn(real, root))) {
      throw new Error(`symlink target escapes the allowed roots: ${real}`);
    }
    return real;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const parent = path.dirname(abs);
    let realParent;
    try {
      realParent = await realpath(parent);
    } catch {
      throw new Error(`parent directory does not exist: ${parent}`);
    }
    if (!getRoots().some((root) => containedIn(realParent, root))) {
      throw new Error(`parent directory escapes the allowed roots: ${realParent}`);
    }
    return abs;
  }
}

// Trusted script zones (shell.allowlistDirs) run without a command row, so a file tool writing into one would be write + run = code execution. Refused by shape here, which is why a zone may sit inside a writable root. One helper, shared by both write resolvers, so the refusal cannot drift between them.
async function refuseTrustedZone(real) {
  const zones = await Promise.all(loadAllowlistDirs().map((dir) => realpath(dir).catch(() => dir)));
  const zone = zones.find((dir) => containedIn(real, dir));
  if (zone) throw new Error(`read-only for file tools: ${zone} is a trusted script directory`);
}

// The server's own credential files stay readable like any file under an allowed folder, but a file tool never writes them: the panel does (Roll passphrase, Roll token). setting.json is left writable on purpose (owner decision), so an AI can adjust folders and the allowlist when asked.
const CREDENTIAL_FILES = [TOKENS_PATH, PASSPHRASE_PATH, CLIENT_PATH, DCR_CLIENTS_PATH, CLOUDFLARED_CRED_PATH];
async function refuseCredentialFile(real) {
  const files = await Promise.all(CREDENTIAL_FILES.map(async (file) => path.join(await realpath(path.dirname(file)).catch(() => path.dirname(file)), path.basename(file))));
  if (files.some((file) => containedIn(real, file))) throw new Error(`read-only for file tools: ${path.basename(real)} holds akimcp's credentials; change it from the control panel (section 1)`);
}

// Write variant for a single file/dir whose immediate parent already exists.
export async function resolveRealWritable(target) {
  const real = await resolveRealUnderRoot(target);
  await refuseTrustedZone(real);
  await refuseCredentialFile(real);
  return real;
}

// mkdir -p variant: the target AND any number of intermediate parents may be missing. resolveRealUnderRoot only tolerates ONE missing level (correct for file writes, which never create parents), so directory creation gets its own resolver instead of loosening the shared one. Climb to the nearest EXISTING ancestor and realpath it: that is the symlink-safe check, because the not-yet-existing segments cannot be symlinks, so once the nearest real ancestor is contained, the path rebuilt from it is safe to create.
export async function resolveRealWritableDir(target) {
  const abs = resolveUnderRoot(target); // tilde/relative expansion + string containment
  const missing = [];
  let existing = abs;
  for (;;) {
    try {
      await realpath(existing);
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error(`no existing ancestor within the allowed roots: ${abs}`);
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
  const realExisting = await realpath(existing);
  const realTarget = missing.length ? path.join(realExisting, ...missing.reverse()) : realExisting;
  if (!getRoots().some((root) => containedIn(realTarget, root))) {
    throw new Error(`path escapes the allowed roots: ${realTarget}`);
  }
  await refuseTrustedZone(realTarget);
  return realTarget;
}

// Non-throwing variant for CLI-arm handlers: returns { ok, dir } or { ok:false, error }, so a caller wraps the failure however its context needs (sync fail() vs async) without repeating the try/catch and its Promise-wrapping footgun.
export function resolveOrFail(target) {
  try {
    return { ok: true, dir: resolveUnderRoot(target) };
  } catch (e) {
    return { ok: false, error: e };
  }
}
