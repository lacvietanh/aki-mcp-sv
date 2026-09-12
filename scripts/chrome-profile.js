// Multi-profile Chromium automation core: discovers installed browsers (Chrome, Brave, Edge),
// clones profiles via atomic allowlist swap (.incoming), preserves Keychain/DPAPI cookie decryption,
// and spawns stealth Chromium instances with --remote-debugging-port=0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { USER_DIR } from './userdata.js';

export const CHROME_CLONES_DIR = path.join(USER_DIR, 'chrome-clones');
export const SESSION_FILE = path.join(USER_DIR, 'chrome-session.json');

const EXCLUDE_NAMES = [/^Singleton/, /lock/i, /^LOCK$/, /^Cache$/, /^Code Cache$/, /^GPUCache$/, /^Crashpad$/];

const PLAIN_FILE_ALLOWLIST = [
  'Preferences',
  'Secure Preferences',
  path.join('Network', 'Network Persistent State'),
  path.join('Network', 'TransportSecurity'),
];

const SQLITE_FILE_ALLOWLIST = [
  'Cookies',
  path.join('Network', 'Cookies'),
  'Web Data',
];

const DIR_ALLOWLIST = [
  path.join('Local Storage', 'leveldb'),
  'IndexedDB',
  'Extensions',
  'Extension State',
  'Local Extension Settings',
  'Extension Rules',
];

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
    const progFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files';
    if (b.includes('brave')) {
      return {
        name: 'Brave Browser',
        binary: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        userDataDir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      };
    }
    if (b.includes('edge')) {
      return {
        name: 'Microsoft Edge',
        binary: path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      };
    }
    return {
      name: 'Google Chrome',
      binary: path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
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

function shouldExclude(fileName) {
  return EXCLUDE_NAMES.some((re) => re.test(fileName));
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (shouldExclude(entry)) continue;
    const srcPath = path.join(src, entry);
    const dstPath = path.join(dst, entry);
    const st = fs.statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (st.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function removeStrayLockFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        removeStrayLockFiles(full);
      } else if (shouldExclude(entry)) {
        fs.rmSync(full, { force: true });
      }
    } catch {}
  }
}

// Prunes Local State to retain only the target profile while preserving os_crypt (DPAPI/Keychain)
function pruneAndCopyLocalState(srcLocalState, dstLocalState, profileFolder) {
  if (!fs.existsSync(srcLocalState)) return;
  try {
    const root = JSON.parse(fs.readFileSync(srcLocalState, 'utf8'));
    if (root.profile) {
      const cache = root.profile.info_cache || {};
      const targetEntry = cache[profileFolder] || { name: profileFolder, is_using_default_name: false };
      root.profile.info_cache = { [profileFolder]: targetEntry };
      root.profile.profiles_order = [profileFolder];
      root.profile.last_used = profileFolder;
    }
    fs.mkdirSync(path.dirname(dstLocalState), { recursive: true });
    fs.writeFileSync(dstLocalState, JSON.stringify(root, null, 2), 'utf8');
  } catch (e) {
    fs.copyFileSync(srcLocalState, dstLocalState);
  }
}

// Clones a profile with atomic-swap (.incoming) and allowlist pruning.
export function cloneProfile(profileId = 'Default', { browser = 'chrome', refresh = false } = {}) {
  const { name: browserName, userDataDir } = getBrowserInfo(browser);
  const srcProfileDir = path.join(userDataDir, profileId);
  if (!fs.existsSync(srcProfileDir)) {
    throw new Error(`Profile "${profileId}" not found at ${srcProfileDir}`);
  }

  const cleanBrowser = browser.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanProfile = profileId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const targetDir = path.join(CHROME_CLONES_DIR, `${cleanBrowser}-${cleanProfile}`);

  const sidecarFile = path.join(targetDir, '.aki-clone.json');
  if (fs.existsSync(targetDir) && fs.existsSync(sidecarFile) && !refresh) {
    return { targetDir, isNew: false, profileId, browser: browserName };
  }

  const incomingDir = `${targetDir}.incoming`;
  fs.rmSync(incomingDir, { recursive: true, force: true });
  fs.mkdirSync(incomingDir, { recursive: true });

  // 1. Prune and copy Local State
  const srcLocalState = path.join(userDataDir, 'Local State');
  const dstLocalState = path.join(incomingDir, 'Local State');
  pruneAndCopyLocalState(srcLocalState, dstLocalState, profileId);

  const dstProfileDir = path.join(incomingDir, profileId);
  fs.mkdirSync(dstProfileDir, { recursive: true });

  // 2. Copy Plain Files
  for (const rel of PLAIN_FILE_ALLOWLIST) {
    const src = path.join(srcProfileDir, rel);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      const dst = path.join(dstProfileDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  // 3. Copy SQLite Files
  for (const rel of SQLITE_FILE_ALLOWLIST) {
    const src = path.join(srcProfileDir, rel);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      const dst = path.join(dstProfileDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  // 4. Copy Allowlisted Directories
  for (const rel of DIR_ALLOWLIST) {
    const src = path.join(srcProfileDir, rel);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      const dst = path.join(dstProfileDir, rel);
      copyDirRecursive(src, dst);
    }
  }

  // 5. Purge any lock files in incomingDir
  removeStrayLockFiles(incomingDir);

  // 6. Write Sidecar Provenance
  const sidecar = {
    schema: 1,
    sourceBrowser: browserName,
    sourceUserDataDir: userDataDir,
    profileId,
    clonedAt: new Date().toISOString(),
    os: process.platform,
  };
  fs.writeFileSync(path.join(incomingDir, '.aki-clone.json'), JSON.stringify(sidecar, null, 2), 'utf8');

  // 7. Atomic Swap
  if (fs.existsSync(targetDir)) {
    const backupDir = `${targetDir}.old`;
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.renameSync(targetDir, backupDir);
    fs.renameSync(incomingDir, targetDir);
    fs.rmSync(backupDir, { recursive: true, force: true });
  } else {
    fs.renameSync(incomingDir, targetDir);
  }

  return { targetDir, isNew: true, profileId, browser: browserName };
}

// Polls for DevToolsActivePort up to timeoutMs
export async function waitForDevToolsActivePort(targetDir, timeoutMs = 15000) {
  const filePath = path.join(targetDir, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8').split('\n');
        const portStr = content[0]?.trim();
        const wsPath = content[1]?.trim();
        const port = parseInt(portStr, 10);
        if (Number.isInteger(port) && port > 0) {
          return { port, wsPath };
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for DevToolsActivePort in ${targetDir}`);
}

let activeSession = null;

// Returns current active Chrome CDP port, checking in-memory or persisted session file.
export function getActivePort() {
  if (activeSession?.port) return activeSession.port;
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (saved?.port) return saved.port;
    } catch {}
  }
  return null;
}

export function getActiveSession() {
  return activeSession;
}

// Launches a cloned Chromium instance with stealth flags and dynamic port 0.
export async function launchChrome(profileId = 'Default', {
  browser = 'chrome',
  url,
  refresh = false,
  headless = false,
  timeoutMs = 15000,
} = {}) {
  const { binary, name: browserName } = getBrowserInfo(browser);
  const { targetDir } = cloneProfile(profileId, { browser, refresh });

  // Always delete stale DevToolsActivePort from previous runs
  const activePortFile = path.join(targetDir, 'DevToolsActivePort');
  if (fs.existsSync(activePortFile)) {
    fs.rmSync(activePortFile, { force: true });
  }

  const args = [
    `--user-data-dir=${targetDir}`,
    `--profile-directory=${profileId}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--test-type',
    '--disable-blink-features=AutomationControlled',
    '--silent-debugger-extension-api',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  if (url) {
    args.push(url);
  }

  const child = spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const { port, wsPath } = await waitForDevToolsActivePort(targetDir, timeoutMs);

  activeSession = {
    port,
    wsPath,
    pid: child.pid,
    profileId,
    browser: browserName,
    targetDir,
    launchedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(activeSession, null, 2), 'utf8');
  } catch {}

  return {
    status: 'ready',
    port,
    wsPath,
    pid: child.pid,
    profileId,
    browser: browserName,
    url: url || 'about:blank',
  };
}

// Stops active or specified Chrome session
export function stopChrome({ pid, profileId } = {}) {
  let targetPid = pid || activeSession?.pid;
  if (!targetPid && fs.existsSync(SESSION_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      targetPid = saved?.pid;
    } catch {}
  }

  if (targetPid) {
    try {
      process.kill(targetPid, 'SIGTERM');
    } catch (e) {
      // Process may already be dead
    }
  }

  activeSession = null;
  if (fs.existsSync(SESSION_FILE)) {
    try {
      fs.rmSync(SESSION_FILE, { force: true });
    } catch {}
  }

  return { stopped: true, pid: targetPid || null };
}

export default {
  getBrowserInfo,
  listInstalledBrowsers,
  listProfiles,
  cloneProfile,
  waitForDevToolsActivePort,
  launchChrome,
  stopChrome,
  getActivePort,
  getActiveSession,
};
