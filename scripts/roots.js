// Path containment shared by every MCP tool that touches the filesystem — one implementation, because a second copy of a security boundary is a second chance to get it subtly wrong.
import fs from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFolders, loadAllowlistDirs } from './allowlist.js';
import { USER_DIR, TOKENS_PATH, PASSPHRASE_PATH, CLIENT_PATH, DCR_CLIENTS_PATH, CLOUDFLARED_CRED_PATH } from './userdata.js';

// Used while setting.json has no `folders` key: MCP_DATA_DIR (or home) plus ~/.aki and ~/.claude, the rule/config dirs the panel prompt tells the AI to read.
function envDefaultRoots() {
  const base = (process.env.MCP_DATA_DIR || os.homedir())
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const always = [path.join(os.homedir(), '.aki'), path.join(os.homedir(), '.claude')];
  return [...new Set([...(base.length ? base : [path.resolve(os.homedir())]), ...always])];
}

// Read per call so a setting.json folder edit applies on the next call; an empty or malformed read must fall back to a safe root, never to "no restriction".
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

// Symlink-safe: resolveUnderRoot checks only the string prefix, which a link inside a root can defeat, so re-check the realpath; a not-yet-existing target is validated via its parent's realpath.
export async function resolveRealUnderRoot(target) {
  const abs = resolveUnderRoot(target);
  try {
    const real = await realpath(abs);
    if (!getRoots().some((root) => containedIn(real, root))) {
      throw new Error(`symlink target escapes the allowed roots: ${real}`);
    }
    refuseCredentialFile(real);
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
    refuseCredentialFile(abs);
    return abs;
  }
}

// Trusted script zones (shell.allowlistDirs) run without a command row, so a file tool writing into one would be write + run = code execution; shared by both write resolvers.
async function refuseTrustedZone(real) {
  const zones = await Promise.all(loadAllowlistDirs().map((dir) => realpath(dir).catch(() => dir)));
  const zone = zones.find((dir) => containedIn(real, dir));
  if (zone) throw new Error(`read-only for file tools: ${zone} is a trusted script directory; to write here, remove it in the control panel, section 6 → Trusted script directories`);
}

// Closed to every tool that takes a path, so a token never lands in a chat by accident. setting.json stays open on purpose (owner decision).
const CREDENTIAL_FILES = [TOKENS_PATH, PASSPHRASE_PATH, CLIENT_PATH, DCR_CLIENTS_PATH, CLOUDFLARED_CRED_PATH];
// Both spellings of each file, because a root can reach the data dir through a symlink.
export function credentialFiles() {
  return CREDENTIAL_FILES.flatMap((file) => {
    let dir = path.dirname(file);
    try { dir = fs.realpathSync(dir); } catch {}
    return [file, path.join(dir, path.basename(file))];
  });
}
function refuseCredentialFile(abs) {
  if (credentialFiles().some((file) => containedIn(abs, file))) throw new Error(`${path.basename(abs)} holds akimcp's credentials and is closed to the tools; view or roll it in the control panel (section 1)`);
}
export function refuseCredentialArgs(args, cwd) {
  for (const arg of args) refuseCredentialFile(path.resolve(cwd, arg));
}

// A path check alone misses a grep -r, a spilled file or a task log reaching the same bytes; every result passes through provider-registry.js into this filter first, so no route leaks a credential.
const SECRET_SHAPE = /^[A-Za-z0-9+/=_-]{20,}$/;
function credentialSecrets() {
  const found = new Set();
  const collect = (v) => {
    if (typeof v === 'string') {
      if (SECRET_SHAPE.test(v)) found.add(v);
    } else if (v && typeof v === 'object') {
      for (const [key, value] of Object.entries(v)) {
        collect(key);
        collect(value);
      }
    }
  };
  for (const file of CREDENTIAL_FILES) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (file === PASSPHRASE_PATH) {
      if (text.trim().length >= 8) found.add(text.trim());
      continue;
    }
    try {
      collect(JSON.parse(text));
    } catch {}
  }
  // instance.json stays readable (AIObox and AIs read its ports and origin), but its token opens the panel (/?t=, x-panel-token), which shows the passphrase and rolls credentials (instance-lock.js).
  try {
    const { token } = JSON.parse(fs.readFileSync(path.join(USER_DIR, 'instance.json'), 'utf8'));
    if (typeof token === 'string' && token.length >= 16) found.add(token);
  } catch {}
  return [...found];
}
// A secret akimcp does not own (a project's .env, a pasted token) has no file to read it from, so it is known by its shape (docs/feat/security.md).
const SECRET_WORD = 'TOKEN|SECRET|KEY|APIKEY|PASSWORD|PASSWD|PASS|PWD|PASSPHRASE|CREDENTIAL|AUTH|SID|COOKIE|PRIVATE|DSN';
const SECRET_SHAPES = [
  // NAME=value as .env and shell write it; a $reference stays visible, so a script that reads the secret stays editable.
  [new RegExp(`\\b((?:[A-Z0-9]+_)*(?:${SECRET_WORD})S?(?:_[A-Z0-9]+)*=)(?!["']?\\$)("[^"\\n]+"|'[^'\\n]+'|[^\\s"']+)`, 'g'), '$1[redacted]'],
  [/(?<![\w-])\d{8,10}:[A-Za-z0-9_-]{35}(?![\w-])/g, '[redacted]'], // Telegram bot
  [/(?<![\w-])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|xox[abposr]-[A-Za-z0-9-]{10,}|PMAK-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{35})/g, '[redacted]'], // OpenAI/Anthropic, GitHub, Slack, Postman, Google
  [/(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g, '[redacted]'], // AWS access key id
  [/\b(Bearer\s+)(?!\$)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[redacted]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?!\$)[^\s@/]+(?=@)/gi, '$1[redacted]'], // scheme://user:password@host
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted]'],
];
const redactWith = (secrets, text) => SECRET_SHAPES.reduce((t, [shape, to]) => t.replace(shape, to), secrets.reduce((t, secret) => t.split(secret).join('[redacted]'), text));
// Also called before an output is cut (output-shape.js), so a cut cannot split a secret into halves the result pass no longer recognizes.
export const redactText = (text) => redactWith(credentialSecrets(), text);
export function redactResult(result) {
  if (!Array.isArray(result?.content)) return result;
  const secrets = credentialSecrets();
  return { ...result, content: result.content.map((c) => (c.type === 'text' && typeof c.text === 'string' ? { ...c, text: redactWith(secrets, c.text) } : c)) };
}
// The AI sees [redacted], not the value, so writing that marker into a file that holds a hidden value would destroy the value.
export function refuseRedactedWrite(original, next) {
  const markers = (text) => text.split('[redacted]').length - 1;
  if (original !== null && markers(next) > markers(original) && redactText(original) !== original) {
    throw new Error('this file holds values the tools show as [redacted]; writing [redacted] back would replace the real value. Edit only the other lines, or change that value in an editor');
  }
}
// A handler that throws skips redactResult: the SDK builds the error result from the message, so the message is redacted and the same error rethrown.
export function redactError(error) {
  if (error && typeof error.message === 'string') error.message = redactText(error.message);
  return error;
}

// Write variant for a single file/dir whose immediate parent already exists.
export async function resolveRealWritable(target) {
  const real = await resolveRealUnderRoot(target);
  await refuseTrustedZone(real);
  return real;
}

// mkdir -p: any number of parents may be missing (resolveRealUnderRoot tolerates one); missing segments cannot be symlinks, so realpath of the nearest existing ancestor is the check.
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

// Non-throwing resolveUnderRoot for CLI-arm handlers: { ok, dir } or { ok: false, error }.
export function resolveOrFail(target) {
  try {
    return { ok: true, dir: resolveUnderRoot(target) };
  } catch (e) {
    return { ok: false, error: e };
  }
}
