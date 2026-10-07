// Chromium profile core: discovers installed browsers (Chrome, Brave, Edge) and opens the shared CDP clones that AIObox provisions,
// attaching when another process already owns a profile and spawning Chrome with --remote-debugging-port=0 only when none does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { USER_DIR } from './userdata.js';

const SESSION_FILE = path.join(USER_DIR, 'chrome-session.json');

// Resolves standard Chromium install paths across macOS, Windows, and Linux.
export function getBrowserInfo(browser = 'chrome') {
  const home = os.homedir();
  const b = browser.toLowerCase();

  if (process.platform === 'darwin') {
    if (b.includes('brave')) {
      return {
        name: 'Brave Browser',
        binary: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        userDataDir: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser'),
      };
    }
    if (b.includes('edge')) {
      return {
        name: 'Microsoft Edge',
        binary: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        userDataDir: path.join(home, 'Library/Application Support/Microsoft Edge'),
      };
    }
    return {
      name: 'Google Chrome',
      binary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: path.join(home, 'Library/Application Support/Google/Chrome'),
    };
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    // 64-bit Chrome/Edge install under ProgramFiles, 32-bit under ProgramFiles(x86), per-user under LocalAppData.
    const firstExisting = (roots, rel) => {
      const candidates = roots.map((r) => path.join(r, ...rel));
      return candidates.find((p) => fs.existsSync(p)) || candidates[0];
    };
    if (b.includes('brave')) {
      return {
        name: 'Brave Browser',
        binary: firstExisting([localAppData, pf, pf86], ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']),
        userDataDir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      };
    }
    if (b.includes('edge')) {
      return {
        name: 'Microsoft Edge',
        binary: firstExisting([pf, pf86], ['Microsoft', 'Edge', 'Application', 'msedge.exe']),
        userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      };
    }
    return {
      name: 'Google Chrome',
      binary: firstExisting([pf, pf86, localAppData], ['Google', 'Chrome', 'Application', 'chrome.exe']),
      userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
    };
  }

  // Linux
  if (b.includes('brave')) {
    return {
      name: 'Brave Browser',
      binary: 'brave-browser',
      userDataDir: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
    };
  }
  if (b.includes('edge')) {
    return {
      name: 'Microsoft Edge',
      binary: 'microsoft-edge',
      userDataDir: path.join(home, '.config', 'microsoft-edge'),
    };
  }
  return {
    name: 'Google Chrome',
    binary: 'google-chrome',
    userDataDir: path.join(home, '.config', 'google-chrome'),
  };
}

// Lists installed Chromium browsers detected on this machine.
export function listInstalledBrowsers() {
  const candidates = ['chrome', 'brave', 'edge'];
  const available = [];
  for (const c of candidates) {
    const info = getBrowserInfo(c);
    if (fs.existsSync(info.userDataDir) || fs.existsSync(info.binary)) {
      available.push({ id: c, ...info });
    }
  }
  return available;
}

// Lists profiles in a browser's User Data Directory via SSoT Level 1: Local State
export function listProfiles(browser = 'chrome') {
  const { name, userDataDir } = getBrowserInfo(browser);
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(localStatePath, 'utf8');
    const data = JSON.parse(raw);
    const infoCache = data?.profile?.info_cache || {};
    const profiles = [];

    for (const [folder, info] of Object.entries(infoCache)) {
      profiles.push({
        id: folder,
        name: info.name || folder,
        userName: info.user_name || '',
        gaiaName: info.gaia_name || '',
        browser: name,
        isDefault: folder === 'Default',
        path: path.join(userDataDir, folder),
      });
    }
    return profiles;
  } catch {
    return [];
  }
}

const BROWSER_IDS = ['chrome', 'brave', 'edge'];
// Files Chrome leaves behind after a crash; only these are cleared, and only once the lock owner is proven gone.
const STALE_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

// Shared with AIObox (docs/plan/IMPORTANT-shared-cdp-profiles.md): AIObox provisions clones here, AkiMCP only opens or attaches.
export function profilesRoot() {
  return process.env.AKI_CDP_PROFILES_DIR || path.join(os.homedir(), '.aki', 'cdp', 'profiles');
}

// Same rule as AIObox profile_id, so "Profile 14" and its folder name agree across tools.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const browserKey = (b) => BROWSER_IDS.find((id) => String(b).toLowerCase().includes(id));

/** Maps a profile folder ("Profile 14") or canonical id ("chrome-profile-14") to its shared clone directory. */
export function resolveSharedProfile(profile = 'Default', browser) {
  const asked = browser === undefined ? undefined : browserKey(browser);
  if (browser !== undefined && !asked) throw new Error(`Unsupported browser "${browser}": use chrome, brave or edge.`);
  const raw = String(profile);
  const prefix = BROWSER_IDS.find((id) => raw.startsWith(`${id}-`));
  const canonical = prefix && raw === slug(raw);
  if (canonical && asked && asked !== prefix) {
    throw new Error(`Profile id "${raw}" belongs to ${prefix}, but browser "${browser}" was requested.`);
  }
  const key = canonical ? prefix : (asked || 'chrome');
  const id = canonical ? raw : `${key}-${slug(raw)}`;
  const dir = path.join(profilesRoot(), id);
  if (!fs.existsSync(path.join(dir, 'Local State'))) {
    // States the fact and the next step that works on any machine; names no AIObox (REQ-15 H1).
    const shared = listSharedProfiles();
    const open = shared.length ? `open one of ${shared.join(', ')}, or ` : '';
    throw new Error(`Profile "${id}" not found in ${profilesRoot()}. AkiMCP opens existing shared profiles and does not create them. (no_profile; next: ${open}${ATTACH_PATH})`);
  }
  return { id, dir, browser: key };
}

/** Ids of the shared clones present on disk. */
export function listSharedProfiles() {
  try {
    return fs.readdirSync(profilesRoot()).filter((d) => fs.existsSync(path.join(profilesRoot(), d, 'Local State'))).sort();
  } catch {
    return [];
  }
}

// The clone keeps the real folder name ("Profile 14") under its user-data-dir; renaming it to Default breaks the account mapping.
function profileSubdir(dir) {
  const hasPrefs = (name) => fs.existsSync(path.join(dir, name, 'Preferences'));
  try {
    const last = JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8'))?.profile?.last_used;
    if (last && hasPrefs(last)) return last;
  } catch {}
  const found = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && hasPrefs(e.name)).map((e) => e.name);
  if (found.length === 1) return found[0];
  throw new Error(`Cannot tell which profile folder to open in ${dir} (${found.length ? found.join(', ') : 'none has Preferences'}).`);
}

/** Chrome's own lock is the ownership record: none | dead | alive | unknown. */
export function readOwner(dir) {
  if (process.platform === 'win32') {
    const lock = path.join(dir, 'lockfile');
    if (!fs.existsSync(lock)) return { state: 'none' };
    try {
      fs.rmSync(lock);
      return { state: 'dead' };
    } catch (e) {
      return e.code === 'EBUSY' || e.code === 'EPERM' ? { state: 'alive', pid: null } : { state: 'unknown', detail: e.code };
    }
  }
  let target;
  try {
    target = fs.readlinkSync(path.join(dir, 'SingletonLock'));
  } catch (e) {
    return e.code === 'ENOENT' ? { state: 'none' } : { state: 'unknown', detail: `SingletonLock unreadable (${e.code})` };
  }
  const m = /^(.+)-(\d+)$/.exec(target);
  if (!m) return { state: 'unknown', detail: `SingletonLock -> ${target}` };
  const [, host, pidStr] = m;
  const pid = Number(pidStr);
  if (host !== os.hostname()) return { state: 'unknown', pid, detail: `lock host ${host} is not this machine (${os.hostname()})` };
  try {
    process.kill(pid, 0);
    return { state: 'alive', pid };
  } catch (e) {
    return e.code === 'EPERM' ? { state: 'alive', pid } : { state: 'dead', pid };
  }
}

function readPortFile(dir) {
  try {
    const [portStr, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n');
    const port = parseInt(portStr, 10);
    return Number.isInteger(port) && port > 0 ? { port, wsPath: wsPath?.trim() } : null;
  } catch {
    return null;
  }
}

/** True when a CDP endpoint answers /json/version on the port; a leftover DevToolsActivePort alone proves nothing. */
export function probeCdp(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && Boolean(JSON.parse(body)));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

// Polls for DevToolsActivePort up to timeoutMs
export async function waitForDevToolsActivePort(targetDir, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = readPortFile(targetDir);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for DevToolsActivePort in ${targetDir}`);
}

let activeSession = null;

function readSavedSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function setSession(session) {
  activeSession = session;
  try {
    if (session) fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
    else fs.rmSync(SESSION_FILE, { force: true });
  } catch {}
}

/** Port of the active session once its endpoint answers; a dead one clears the session. */
export async function getActivePort() {
  const session = activeSession || readSavedSession();
  if (!session?.port) return null;
  if (await probeCdp(session.port)) {
    activeSession = session;
    return session.port;
  }
  setSession(null);
  return null;
}

export async function resolvePort(explicitPort) {
  const p = explicitPort || (await getActivePort());
  if (!p) throw new Error(NO_CDP_PORT_MESSAGE);
  return p;
}

// The path that needs no shared profile: also the next step when chrome_launch finds none.
const ATTACH_PATH = 'attach to a window already running with a remote-debugging port: find the port with aki__port_status (a Chrome process listening on 127.0.0.1), run aki__devtools_targets on it, match the tab by title or url, then pass that port and targetId explicitly.';
export const NO_CDP_PORT_MESSAGE =
  `No CDP port specified and no active Chrome session. Open a shared profile with aki__chrome_launch, or ${ATTACH_PATH}`;

async function openUrl(port, url) {
  if (!url) return null;
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'PUT', path: `/json/new?${encodeURIComponent(url)}`, timeout: 5000 }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => resolve({ status: r.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
  if (res.status !== 200) throw new Error(`Attached, but opening ${url} failed: HTTP ${res.status} ${res.body.slice(0, 200)}`);
  return JSON.parse(res.body);
}

/** Opens a shared profile: attaches when another process already runs it, spawns Chrome only when no live owner holds the lock. */
export async function launchChrome(profile = 'Default', {
  browser,
  url,
  headless = false,
  timeoutMs = 15000,
  binary: binaryOverride,
} = {}) {
  const { id, dir, browser: key } = resolveSharedProfile(profile, browser);
  const { binary, name: browserName } = getBrowserInfo(key);
  // The url becomes a Chrome argument on a new launch; one starting with a dash would be read as a flag (--gpu-launcher=<command> runs a program).
  if (url && String(url).trim().startsWith('-')) throw new Error(`url must be a web address, got "${String(url).slice(0, 80)}"`);
  const profileDir = profileSubdir(dir);
  const owner = readOwner(dir);

  if (owner.state === 'unknown') {
    throw new Error(`Profile "${id}" is locked but its owner cannot be verified (${owner.detail}); nothing was removed or launched.`);
  }

  if (owner.state === 'alive') {
    const found = readPortFile(dir);
    if (!found || !(await probeCdp(found.port))) {
      throw new Error(`Profile "${id}" is in use by pid ${owner.pid ?? 'unknown'} but not attachable: ${found ? `port ${found.port} does not answer CDP` : 'no DevToolsActivePort'}. Nothing was removed or launched.`);
    }
    const tab = await openUrl(found.port, url);
    setSession({ port: found.port, wsPath: found.wsPath, pid: owner.pid, owned: false, profileId: id, browser: browserName, targetDir: dir, attachedAt: new Date().toISOString() });
    return { status: 'attached', owned: false, port: found.port, wsPath: found.wsPath, pid: owner.pid, profileId: id, browser: browserName, ...(tab ? { tab: { id: tab.id, url: tab.url } } : {}) };
  }

  for (const name of STALE_FILES) fs.rmSync(path.join(dir, name), { force: true });

  const args = [
    `--user-data-dir=${dir}`,
    `--profile-directory=${profileDir}`,
    '--remote-debugging-port=0',
    // Marker so AIObox engine::adopt can tell this Chrome apart and leave it alone (IMPORTANT-shared-cdp-profiles.md).
    '--aki-launcher=akimcp',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--test-type',
    '--disable-blink-features=AutomationControlled',
    '--silent-debugger-extension-api',
  ];
  if (headless) args.push('--headless=new');
  if (url) args.push(url);

  const child = spawn(binaryOverride || binary, args, { detached: true, stdio: 'ignore' });
  const spawnFailed = new Promise((_, reject) => {
    child.on('error', (e) => reject(new Error(`Could not start ${browserName} at ${binaryOverride || binary}: ${e.message}`)));
  });
  child.unref();

  const { port, wsPath } = await Promise.race([waitForDevToolsActivePort(dir, timeoutMs), spawnFailed]);
  setSession({ port, wsPath, pid: child.pid, owned: true, profileId: id, browser: browserName, targetDir: dir, launchedAt: new Date().toISOString() });
  return { status: 'ready', owned: true, port, wsPath, pid: child.pid, profileId: id, browser: browserName, url: url || 'about:blank' };
}

/** Default stop ends only a Chrome this server spawned; an attached session is just forgotten. An explicit pid is killed as asked. */
export function stopChrome({ pid } = {}) {
  const session = activeSession || readSavedSession();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
    if (!session || session.pid === pid) setSession(null);
    return { stopped: true, pid };
  }
  setSession(null);
  if (!session) return { stopped: false, pid: null, detail: 'no active session' };
  if (session.owned !== true) {
    return { stopped: false, owned: false, pid: session.pid ?? null, detail: `attached session to ${session.profileId} cleared; its owner process keeps running` };
  }
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {}
  return { stopped: true, owned: true, pid: session.pid };
}
