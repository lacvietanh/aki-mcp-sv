// The shell allowlist, in one place: the MCP server enforces it and the panel shows it as the starting point a user edits. Two copies would let the panel display a set the server does not actually apply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_PATH } from './userdata.js';

// Entry form: a bare string allows any subcommand; [bin, ...subs] restricts to those. Structure carries the level — no hand-written null.
// find/sort/fd excluded on purpose: their flags escape read-only (find -exec/-delete, sort -o, fd -x) and the args[0] gate can't restrain a flag; aki__find_path/aki__search_content cover read-only lookup.
// Unix tools work as-is on macOS/Linux, and on Windows once Git for Windows is installed (find-on-path.js adds its usr\bin to PATH).
const UNIX_DEFAULT = [
  'ls', 'cat', 'pwd', 'grep', 'head', 'tail', 'wc', 'file', 'stat', 'tree', 'ps', 'df', 'du',
  'whoami', 'uname', 'uniq', 'cut', 'diff', 'jq',
  'basename', 'dirname', 'realpath', 'which', 'date', 'strings', 'uptime', 'pgrep',
  ['lsof', '-i'],
  ['npm', 'list', 'ls', 'outdated', 'test', 'run'], ['npx', 'vitest'], ['pip', 'freeze', 'list'], ['node', '-v'],
  // fetch excluded — writes local refs, not read-only; ls-remote kept but shell-mcp.js requires zero extra args (its ext:: transport can smuggle code execution via a repository/URL argument).
  ['git', 'status', 'log', 'diff', 'show', 'branch', 'remote', 'blame', 'check-ignore', 'ls-files', 'rev-parse', 'tag', 'ls-remote', 'describe', 'shortlog', 'merge-base'],
];

// Per-OS extras, selected as data by process.platform (never a business-logic branch). open/sips/ffmpeg are macOS media helpers — not read-only, unlike the rest of the set.
const MAC_EXTRA = ['vm_stat', ['sysctl', '-n'], ['top', '-l'], ['diskutil', 'list', 'info'], 'ifconfig', ['netstat', '-an'], 'sw_vers', 'system_profiler', 'sips', 'open', 'ffmpeg'];
const LINUX_EXTRA = ['free', ['top', '-b'], 'nproc', 'lsblk', ['ip', 'addr'], ['ss', '-tuln']];
// Executables only: run_cmd starts a binary without a shell, so a PowerShell cmdlet (Get-Process) cannot run and has no place here.
const WIN_EXTRA = ['where', 'findstr', 'tasklist', 'hostname', 'systeminfo'];

const PLATFORM_EXTRA =
  process.platform === 'win32' ? WIN_EXTRA : process.platform === 'darwin' ? MAC_EXTRA : LINUX_EXTRA;

// One entry list → the { bin: null|array } map the rest of the subsystem reads. The null (any subcommand) is produced here once, never hand-authored.
const toMap = (entries) => Object.fromEntries(entries.map((e) => (Array.isArray(e) ? [e[0], e.slice(1)] : [e, null])));
export const DEFAULT_ALLOWLIST = toMap([...UNIX_DEFAULT, ...PLATFORM_EXTRA]);

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Settings are read on every request, so one broken file would otherwise print the same warning each time.
const warnedErrors = new Set();
function settingsError(message) {
  if (!warnedErrors.has(message)) {
    warnedErrors.add(message);
    process.stderr.write(`[allowlist] ignoring malformed ${SETTINGS_PATH}: ${message}\n`);
  }
  return { settings: {}, error: message };
}

// A missing file is a fresh install, not an error; anything else unreadable is reported so a caller can refuse to overwrite it.
export function readSettingsChecked() {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? { settings: {}, error: null } : settingsError(e.message);
  }
  return isPlainObject(settings) ? { settings, error: null } : settingsError('setting.json is not a JSON object');
}

export function readSettings() {
  return readSettingsChecked().settings;
}

// Atomic (temp file + rename) so a reader never sees a half-written setting.json, which readSettings would treat as empty.
export function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  const tmp = `${SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmp, SETTINGS_PATH);
}

// Normalizes three stored shapes to { overrides, revoked }: v3 { added:[entries], revoked }, v2 { overrides:{bin:null|array}, revoked }, v1 flat map. `revoked` records a removed default that an absent key cannot (the P0 bug). Format detail: docs/plan/done/shell-allowlist.md.
function normalizeStored(stored) {
  if (Array.isArray(stored.added)) {
    return { overrides: toMap(stored.added), revoked: Array.isArray(stored.revoked) ? stored.revoked : [] };
  }
  if (isPlainObject(stored.overrides) || Array.isArray(stored.revoked)) {
    return { overrides: isPlainObject(stored.overrides) ? stored.overrides : {}, revoked: Array.isArray(stored.revoked) ? stored.revoked : [] };
  }
  return { overrides: stored, revoked: [] };
}

export function loadAllowlist() {
  const stored = readSettings().shell?.allowlist;
  if (!stored || typeof stored !== 'object') return DEFAULT_ALLOWLIST;
  const { overrides, revoked } = normalizeStored(stored);
  const merged = { ...DEFAULT_ALLOWLIST, ...overrides };
  for (const bin of revoked) delete merged[bin];
  return merged;
}

// The folder SSoT twin of loadAllowlist(): setting.json is authoritative, read fresh on every call (roots.js:getRoots()) so a folder add/remove is live on the next tool call, the same way an allowlist edit already is.
// An empty return (no `folders` key yet, e.g. a fresh install) is not "no restriction" — it signals the caller to fall back to its own safe default; roots.js owns that fallback, not this function.
export function loadFolders() {
  const stored = readSettings().folders;
  if (!Array.isArray(stored)) return [];
  const resolved = stored.filter((p) => typeof p === 'string' && p.trim()).map((p) => path.resolve(p));
  return [...new Set(resolved)];
}

// Second, directory-scoped trust mechanism alongside the name allowlist: any executable/script under these zones runs without a per-file entry, so installed Aki skills work on every machine with no settings edit. Zones are installer-owned (rule corpus + skills), and the file tools refuse to write into them (roots.js:resolveRealWritable), so write + run can never chain into code execution.
const DEFAULT_ALLOWLIST_DIRS = ['~/.claude/skills', '~/.aki/akidevrule'];
const expandTilde = (p) => (p === '~' ? os.homedir() : /^~[/\\]/.test(p) ? path.join(os.homedir(), p.slice(2)) : p);

export function loadAllowlistDirs() {
  const dirs = readSettings().shell?.allowlistDirs;
  const list = Array.isArray(dirs) ? dirs : DEFAULT_ALLOWLIST_DIRS;
  return list.filter((d) => typeof d === 'string' && d.trim()).map((d) => path.resolve(expandTilde(d.trim())));
}
