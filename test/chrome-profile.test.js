#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-chrome-profile-'));
const root = path.join(tmp, 'profiles');
const home = path.join(tmp, 'home');
Object.assign(process.env, { HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
process.env.AKI_CDP_PROFILES_DIR = root;
process.env.AKI_MCP_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.AKI_MCP_DATA_DIR, { recursive: true });
const sessionFile = path.join(process.env.AKI_MCP_DATA_DIR, 'chrome-session.json');

const {
  getBrowserInfo,
  listInstalledBrowsers,
  listProfiles,
  waitForDevToolsActivePort,
  profilesRoot,
  resolveSharedProfile,
  listSharedProfiles,
  readOwner,
  getActivePort,
  resolvePort,
  launchChrome,
  stopChrome,
  NO_CDP_PORT_MESSAGE,
} = await import('../scripts/chrome-profile.js');

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// A shared clone as AIObox lays it out: Local State + the real profile folder.
function makeProfile(id, folder = 'Profile 14') {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, 'Preferences'), '{}');
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ profile: { last_used: folder } }));
  return dir;
}

function lock(dir, target) {
  // A SingletonLock pointing at another host is a dangling link, which rmSync({ force }) leaves in place on Node 25.
  if (fs.lstatSync(path.join(dir, 'SingletonLock'), { throwIfNoEntry: false })) fs.unlinkSync(path.join(dir, 'SingletonLock'));
  fs.symlinkSync(target, path.join(dir, 'SingletonLock'));
}

// Minimal CDP HTTP endpoint: /json/version answers, PUT /json/new records the URL.
async function fakeCdp() {
  const opened = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'Fake/1' }));
    if (req.method === 'PUT' && req.url.startsWith('/json/new?')) {
      const url = decodeURIComponent(req.url.slice('/json/new?'.length));
      opened.push(url);
      return res.end(JSON.stringify({ id: 'T1', url }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, opened };
}

async function closedPort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

let fakeChromePid;
const sleepers = [];

// `extra` lands in the child's argv after `--`, which is where ps shows it, as it would show Chrome's own flags.
function sleeper(...extra) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', ...extra], { stdio: 'ignore' });
  sleepers.push(child);
  return child;
}

const endsWithin = (child, ms = 5000) => once(child, 'exit', { signal: AbortSignal.timeout(ms) });

async function runTests(t) {
  // Browser and source-profile discovery
  assert.ok(getBrowserInfo('chrome').name.includes('Chrome'));
  assert.ok(getBrowserInfo('brave').name.includes('Brave'));
  assert.ok(getBrowserInfo('edge').name.includes('Edge'));
  const chrome = getBrowserInfo('chrome');
  assert.ok(chrome.userDataDir.startsWith(home), 'the browser user-data dir comes from the fake HOME');
  assert.deepEqual(listProfiles('chrome'), []);
  fs.mkdirSync(chrome.userDataDir, { recursive: true });
  fs.writeFileSync(path.join(chrome.userDataDir, 'Local State'), JSON.stringify({ profile: { info_cache: {
    Default: { name: 'Person 1', user_name: 'a@example.com', gaia_name: 'A' },
    'Profile 2': { name: 'Work' },
  } } }));
  assert.deepEqual(listProfiles('chrome'), [
    { id: 'Default', name: 'Person 1', userName: 'a@example.com', gaiaName: 'A', browser: chrome.name, isDefault: true, path: path.join(chrome.userDataDir, 'Default') },
    { id: 'Profile 2', name: 'Work', userName: '', gaiaName: '', browser: chrome.name, isDefault: false, path: path.join(chrome.userDataDir, 'Profile 2') },
  ]);
  assert.deepEqual(listInstalledBrowsers().filter((b) => fs.existsSync(b.userDataDir)), [{ id: 'chrome', ...chrome }]);

  // DevToolsActivePort parsing
  const portDir = fs.mkdtempSync(path.join(tmp, 'port-'));
  const portPromise = waitForDevToolsActivePort(portDir, 3000);
  fs.writeFileSync(path.join(portDir, 'DevToolsActivePort'), '59123\n/devtools/browser/abc-123\n');
  assert.deepEqual(await portPromise, { port: 59123, wsPath: '/devtools/browser/abc-123' });

  // Canonical path: folder name and shared id resolve to the same clone; no USER_DIR involved.
  assert.equal(profilesRoot(), root);
  const dir = makeProfile('chrome-profile-14');
  assert.deepEqual(resolveSharedProfile('Profile 14'), { id: 'chrome-profile-14', dir, browser: 'chrome' });
  assert.equal(resolveSharedProfile('chrome-profile-14', 'chrome').dir, dir);
  assert.deepEqual(listSharedProfiles(), ['chrome-profile-14']);
  assert.throws(() => resolveSharedProfile('chrome-profile-14', 'brave'), /belongs to chrome/);
  assert.throws(() => resolveSharedProfile('Profile 14', 'firefox'), /Unsupported browser/);

  // Missing clone: stated as a fact, nothing created.
  // The miss names a code and a next step that works without AIObox: the clones on disk, then attach by port (REQ-15 H1, no pitch).
  await assert.rejects(launchChrome('Profile 99'), (e) => {
    assert.match(e.message, /not found in .*does not create them/);
    assert.match(e.message, /\(no_profile; next: open one of chrome-profile-14, or attach .*aki__port_status.*\)$/);
    assert.doesNotMatch(e.message, /aiobox|https?:/i);
    return true;
  });
  assert.equal(exists(path.join(root, 'chrome-profile-99')), false);

  // Every id the shared list returns opens as itself, whatever its prefix.
  const provisioned = makeProfile('aio-1700000000000');
  assert.deepEqual(resolveSharedProfile('aio-1700000000000'), { id: 'aio-1700000000000', dir: provisioned, browser: 'chrome' });

  // The rest drives Chrome's POSIX lock (a SingletonLock symlink) and a shebang script as the browser; Windows has neither, so its run ends here.
  if (process.platform === 'win32') { t.skip('lock and launch scenarios are POSIX-only'); return; }

  // Unknown owner (lock from another host): fail closed, lock untouched.
  lock(dir, `other-host.invalid-${process.pid}`);
  assert.equal(readOwner(dir).state, 'unknown');
  await assert.rejects(launchChrome('Profile 14'), /owner cannot be verified/);
  assert.ok(exists(path.join(dir, 'SingletonLock')));

  // Owner alive but endpoint dead: not attachable, lock and port file kept.
  lock(dir, `${os.hostname()}-${process.pid}`);
  const dead = await closedPort();
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `${dead}\n/devtools/browser/x\n`);
  await assert.rejects(launchChrome('Profile 14'), /in use by pid \d+ but not attachable/);
  assert.ok(exists(path.join(dir, 'SingletonLock')));
  assert.ok(exists(path.join(dir, 'DevToolsActivePort')));

  // Owner alive and endpoint answers: attach, open url as a tab, session not owned.
  const cdp = await fakeCdp();
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `${cdp.port}\n/devtools/browser/live\n`);
  const attached = await launchChrome('chrome-profile-14', { url: 'https://example.com/a' });
  assert.equal(attached.status, 'attached');
  assert.equal(attached.owned, false);
  assert.equal(attached.port, cdp.port);
  assert.equal(attached.pid, process.pid);
  assert.deepEqual(cdp.opened, ['https://example.com/a']);
  assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).owned, false);
  assert.equal(await getActivePort(), cdp.port);

  // Stopping an attached session never signals the owner (this test process is the "owner").
  const stopAttached = stopChrome();
  assert.equal(stopAttached.stopped, false);
  assert.equal(stopAttached.owned, false);
  assert.ok(isAlive(process.pid));
  assert.equal(exists(sessionFile), false);
  assert.ok(exists(path.join(dir, 'SingletonLock')));

  // Stale port: a saved session whose endpoint is gone is cleared, not returned.
  fs.writeFileSync(sessionFile, JSON.stringify({ port: dead, pid: 1, owned: true }));
  assert.equal(await getActivePort(), null);
  assert.equal(exists(sessionFile), false);
  await assert.rejects(resolvePort(), (e) => e.message === NO_CDP_PORT_MESSAGE);
  assert.equal(await resolvePort(1234), 1234);
  cdp.server.close();

  // Dead owner: stale lock files are cleared, a new owned process launches with the real profile folder.
  const gone = spawnSync(process.execPath, ['-e', 'process.pid'], { encoding: 'utf8' }).pid;
  lock(dir, `${os.hostname()}-${gone}`);
  fs.writeFileSync(path.join(dir, 'SingletonCookie'), 'x');
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `${dead}\n/stale\n`);
  assert.equal(readOwner(dir).state, 'dead');
  // pid 0 names no process (kill(0, 0) signals this process group): a lock naming it is dead too.
  lock(dir, `${os.hostname()}-0`);
  assert.deepEqual(readOwner(dir), { state: 'dead', pid: 0 });
  lock(dir, `${os.hostname()}-${gone}`);
  const fake = path.join(tmp, 'fake-chrome.mjs');
  fs.writeFileSync(fake, `#!${process.execPath}
import fs from 'node:fs';
import http from 'node:http';
const dir = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice(16);
fs.writeFileSync(dir + '/args.json', JSON.stringify(process.argv.slice(2)));
const s = http.createServer((q, r) => r.end('{"Browser":"Fake/2"}'));
s.listen(0, '127.0.0.1', () => fs.writeFileSync(dir + '/DevToolsActivePort', s.address().port + '\\n/devtools/browser/fake\\n'));
`);
  fs.chmodSync(fake, 0o755);
  const launched = await launchChrome('Profile 14', { binary: fake, headless: true, url: 'https://example.com/b', timeoutMs: 5000 });
  fakeChromePid = launched.pid;
  assert.equal(launched.status, 'ready');
  assert.equal(launched.owned, true);
  assert.equal(exists(path.join(dir, 'SingletonLock')), false);
  assert.equal(exists(path.join(dir, 'SingletonCookie')), false);
  const args = JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'));
  assert.ok(args.includes('--profile-directory=Profile 14'));
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--aki-launcher=akimcp'));
  assert.ok(args.includes('https://example.com/b'));
  assert.equal(await getActivePort(), launched.port);

  // Stopping an owned session terminates it while the profile lock still names its pid.
  lock(dir, `${os.hostname()}-${launched.pid}`);
  const stopOwned = stopChrome();
  assert.deepEqual(stopOwned, { stopped: true, owned: true, pid: launched.pid, detail: 'signal sent' });
  for (let i = 0; i < 50 && isAlive(launched.pid); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(isAlive(launched.pid), false);
  // A url that Chrome would read as a flag is refused before anything is spawned.
  await assert.rejects(launchChrome('Profile 14', { binary: fake, url: '--gpu-launcher=touch pwned' }), /url must be a web address/);

  // A browser binary that cannot start fails at once with its path, not after the port wait.
  const startedAt = Date.now();
  await assert.rejects(launchChrome('Profile 14', { binary: path.join(tmp, 'no-such-browser'), timeoutMs: 1500 }), /Could not start .*no-such-browser/);
  assert.ok(Date.now() - startedAt < 1000, 'no port wait when the spawn itself failed');

  assert.deepEqual(stopChrome(), { stopped: false, pid: null, detail: 'no active session' });

  // A saved owned session names a pid that may have been reused: the default stop signals it only while the profile lock names it.
  const stopDir = makeProfile('chrome-profile-stop');
  const saveOwned = (child, extra = {}) => fs.writeFileSync(sessionFile, JSON.stringify({ port: dead, pid: child.pid, owned: true, profileId: 'chrome-profile-stop', targetDir: stopDir, ...extra }));

  await t.test('a saved owned session whose profile lock is gone signals nothing and is cleared', () => {
    const stranger = sleeper();
    saveOwned(stranger);
    assert.deepEqual(stopChrome(), { stopped: false, owned: true, pid: stranger.pid, detail: 'its Chrome is already gone' });
    assert.ok(isAlive(stranger.pid), 'an unrelated process that took the pid is untouched');
    assert.equal(exists(sessionFile), false);
  });

  await t.test('a lock that names another pid signals nothing and clears the session', () => {
    const stranger = sleeper();
    saveOwned(stranger);
    lock(stopDir, `${os.hostname()}-${process.pid}`);
    assert.deepEqual(stopChrome(), { stopped: false, owned: true, pid: stranger.pid, detail: 'its Chrome is already gone' });
    assert.ok(isAlive(stranger.pid));
    assert.equal(exists(sessionFile), false);
  });

  await t.test('a lock whose host cannot be verified signals nothing and keeps the session', () => {
    const keeper = sleeper();
    saveOwned(keeper);
    lock(stopDir, `other-host.invalid-${keeper.pid}`);
    const answer = stopChrome();
    assert.equal(answer.stopped, false);
    assert.equal(answer.pid, keeper.pid);
    assert.match(answer.detail, /other-host\.invalid is not this machine \(.+\); nothing was signalled and the session is kept/);
    assert.ok(isAlive(keeper.pid));
    assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).pid, keeper.pid);
  });

  await t.test('a session saved without its profile folder signals nothing and names the explicit stop', () => {
    const legacy = sleeper();
    saveOwned(legacy, { targetDir: undefined });
    const answer = stopChrome();
    assert.equal(answer.stopped, false);
    assert.match(answer.detail, new RegExp(`chrome_stop pid=${legacy.pid}`));
    assert.ok(isAlive(legacy.pid));
  });

  await t.test('a lock that names the session pid, whose argv carries the exact profile flag, ends that process and says only that the signal was sent', async () => {
    const owned = sleeper(`--user-data-dir=${stopDir}`, '--remote-debugging-port=0');
    saveOwned(owned);
    lock(stopDir, `${os.hostname()}-${owned.pid}`);
    assert.deepEqual(stopChrome(), { stopped: true, owned: true, pid: owned.pid, detail: 'signal sent' });
    await endsWithin(owned);
    assert.equal(exists(sessionFile), false);
  });

  await t.test('a live process the lock names but whose argv has no profile flag is not signalled: the pid was reused', () => {
    const reused = sleeper('--remote-debugging-port=0');
    saveOwned(reused);
    lock(stopDir, `${os.hostname()}-${reused.pid}`);
    assert.deepEqual(stopChrome(), { stopped: false, owned: true, pid: reused.pid, detail: 'its Chrome is already gone' });
    assert.ok(isAlive(reused.pid));
    assert.equal(exists(sessionFile), false);
  });

  await t.test('a profile folder that only starts like another one (chrome-profile-1 against chrome-profile-14) is not taken for it', () => {
    const shortDir = makeProfile('chrome-profile-1');
    const longDir = makeProfile('chrome-profile-14');
    assert.ok(longDir.startsWith(shortDir));
    const ofTheLonger = sleeper(`--user-data-dir=${longDir}`);
    saveOwned(ofTheLonger, { targetDir: shortDir });
    lock(shortDir, `${os.hostname()}-${ofTheLonger.pid}`);
    assert.deepEqual(stopChrome(), { stopped: false, owned: true, pid: ofTheLonger.pid, detail: 'its Chrome is already gone' });
    assert.ok(isAlive(ofTheLonger.pid));
    assert.equal(exists(sessionFile), false);
  });

  await t.test('a ps that cannot run proves nothing: nothing is signalled, the answer says it could not check, and the session is kept', () => {
    const owned = sleeper(`--user-data-dir=${stopDir}`);
    saveOwned(owned);
    lock(stopDir, `${os.hostname()}-${owned.pid}`);
    const realPath = process.env.PATH;
    process.env.PATH = fs.mkdtempSync(path.join(tmp, 'no-ps-'));
    try {
      assert.deepEqual(stopChrome(), { stopped: false, owned: true, pid: owned.pid, detail: 'could not check whether its Chrome is still running; nothing was signalled and the session is kept' });
    } finally {
      process.env.PATH = realPath;
    }
    assert.ok(isAlive(owned.pid));
    assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).pid, owned.pid);
  });

  await t.test('an explicit pid is killed as asked, and a pid that does not exist is reported as not stopped', async () => {
    const target = sleeper();
    assert.deepEqual(stopChrome({ pid: target.pid }), { stopped: true, pid: target.pid, detail: 'signal sent' });
    await endsWithin(target);
    assert.deepEqual(stopChrome({ pid: 2147483646 }), { stopped: false, pid: 2147483646, detail: 'no such process' });
  });

  console.log('chrome-profile.test.js: ok');
}

test('chrome profile discovery and POSIX lock/launch', async (t) => {
  try {
    await runTests(t);
  } finally {
    for (const child of sleepers) child.kill('SIGKILL');
    if (fakeChromePid) {
      try { process.kill(fakeChromePid, 'SIGKILL'); } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
