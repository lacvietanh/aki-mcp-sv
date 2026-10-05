#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-chrome-profile-'));
const root = path.join(tmp, 'profiles');
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
  fs.rmSync(path.join(dir, 'SingletonLock'), { force: true });
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

async function runTests() {
  // Browser and source-profile discovery
  assert.ok(getBrowserInfo('chrome').name.includes('Chrome'));
  assert.ok(getBrowserInfo('brave').name.includes('Brave'));
  assert.ok(getBrowserInfo('edge').name.includes('Edge'));
  assert.ok(Array.isArray(listInstalledBrowsers()));
  assert.ok(Array.isArray(listProfiles('chrome')));

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

  // Missing clone: pointed at AIObox, nothing created.
  await assert.rejects(launchChrome('Profile 99'), /not found .*Create it in AIObox/);
  // The miss names a code and a next step that works without AIObox: the clones on disk, then attach by port (REQ-15 H1, no pitch).
  await assert.rejects(launchChrome('Profile 99'), (e) => /\(no_profile; next: open one of chrome-profile-14, or attach .*aki__port_status.*\)$/.test(e.message)
    && !/aki__aiobox|aiobox\.app|https?:/i.test(e.message));
  assert.equal(exists(path.join(root, 'chrome-profile-99')), false);

  // The rest drives Chrome's POSIX lock (a SingletonLock symlink) and a shebang script as the browser; Windows has neither, so its run ends here.
  if (process.platform === 'win32') return console.log('chrome-profile.test.js: ok (lock and launch scenarios are POSIX-only, skipped on Windows)');

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

  // Stopping an owned session terminates it.
  const stopOwned = stopChrome();
  assert.deepEqual(stopOwned, { stopped: true, owned: true, pid: launched.pid });
  for (let i = 0; i < 50 && isAlive(launched.pid); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(isAlive(launched.pid), false);
  // A url that Chrome would read as a flag is refused before anything is spawned.
  await assert.rejects(launchChrome('Profile 14', { binary: fake, url: '--gpu-launcher=touch pwned' }), /url must be a web address/);

  // A browser binary that cannot start fails at once with its path, not after the port wait.
  const startedAt = Date.now();
  await assert.rejects(launchChrome('Profile 14', { binary: path.join(tmp, 'no-such-browser'), timeoutMs: 5000 }), /Could not start .*no-such-browser/);
  assert.ok(Date.now() - startedAt < 3000, 'no port wait when the spawn itself failed');

  assert.deepEqual(stopChrome(), { stopped: false, pid: null, detail: 'no active session' });

  console.log('chrome-profile.test.js: ok');
}

try {
  await runTests();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
