// aki__postman_status (read-only) plus launchPostmanDaemon, the single spawn path for the
// Postman control daemon (scripts/aki-pmcontrol/). Launch is a panel action (POST /api/postman-launch,
// scripts/panel.js) triggered from the panel's Postman tab — never an env flag, never a boot-time
// default. `npm start` never calls launchPostmanDaemon. No CDP, no ensureRunning here either: that
// stays inside the daemon child, never this module.
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Default import, not `{ spawn }`: node:test's mock.method only intercepts the shared exports
// object a default import resolves to, not a named-import binding — postman-mcp.test.js relies on
// mocking this without spawning a real process.
import cp from 'node:child_process';
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import daemonPid from './aki-pmcontrol/scripts/daemon-pid.js';
import cdp from './cdp-engine.js';

const DATA_JSON_PATH = path.join(os.homedir(), '.aki', 'cdp-postman', 'data.json');
const NEW_WINDOW_FLAG_PATH = path.join(path.dirname(DATA_JSON_PATH), 'new-window.flag');
const OWNERSHIP_STATUS_PATH = path.join(path.dirname(DATA_JSON_PATH), 'ownership-status.json');
const DAEMON_SCRIPT_PATH = fileURLToPath(new URL('./aki-pmcontrol/index.js', import.meta.url));

let daemonProcess = null;

function readDataFile() {
  if (!existsSync(DATA_JSON_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(DATA_JSON_PATH, 'utf8'));
    return { updatedAt: statSync(DATA_JSON_PATH).mtime.toISOString(), everAttached: !!data.access_token };
  } catch {
    return null;
  }
}

function childRunning() {
  return !!daemonProcess && daemonProcess.exitCode === null && !daemonProcess.killed;
}

function filePidLive() {
  const pid = daemonPid.read();
  return pid && daemonPid.live(pid) ? pid : null;
}

function readOwnershipStatus(livePid) {
  if (!livePid || !existsSync(OWNERSHIP_STATUS_PATH)) return null;
  try {
    const status = JSON.parse(readFileSync(OWNERSHIP_STATUS_PATH, 'utf8'));
    return status.daemonPid === livePid ? status : null;
  } catch {
    return null;
  }
}

export function getDaemonStatus() {
  const daemonPidValue = childRunning() ? daemonProcess.pid : filePidLive();
  const ownership = readOwnershipStatus(daemonPidValue);
  return {
    running: !!daemonPidValue,
    daemonPid: daemonPidValue || null,
    pid: daemonPidValue || null,
    attached: !!ownership?.attached,
    endpoint: ownership?.endpoint || null,
    ownerTargetId: ownership?.ownerTargetId || null,
    attachedWindowCount: ownership?.attachedWindowCount || 0,
    mode: ownership?.mode || null,
    launchProcessPid: ownership?.launchProcessPid || null,
    dataFile: readDataFile(),
  };
}

function whenChildSpawned(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (settled) return;
      if (!child.pid || child.exitCode !== null || child.killed) {
        fail(new Error('daemon spawn produced no live pid'));
        return;
      }
      settled = true;
      detach();
      resolve();
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      detach();
      if (daemonProcess === child) daemonProcess = null;
      reject(err);
    };
    const onError = (e) => fail(new Error(`daemon failed to start: ${e.message}`));
    const onExit = (code) => fail(new Error(`daemon exited before it was running (code ${code})`));
    const detach = () => {
      child.off?.('error', onError);
      child.off?.('exit', onExit);
      child.off?.('spawn', succeed);
    };
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('spawn', succeed);
    if (child.pid) queueMicrotask(succeed);
  });
}

function whenChildExits(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('daemon did not exit after kill')), 8000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function whenPidDies(pid) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (!daemonPid.live(pid)) return resolve();
      if (Date.now() - started > 8000) return reject(new Error('daemon did not exit after kill'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

// The one spawn path (pattern.A1): recognizes an already-alive child instead of starting a second,
// so N clicks on the panel button behave like one. Check + spawn + assign stay synchronous; only
// the confirmation waits, so two overlapping HTTP requests cannot both pass the liveness check.
export async function launchPostmanDaemon() {
  const before = getDaemonStatus();
  if (before.running) return { ...before, message: `already running (pid ${before.pid})` };

  const child = cp.spawn(process.execPath, [DAEMON_SCRIPT_PATH], { stdio: 'inherit', windowsHide: true });
  child.on('error', (e) => console.error(`[postman] daemon failed to start: ${e.message}`));
  child.on('exit', (code) => {
    if (daemonProcess === child) daemonProcess = null;
    console.log(`[postman] daemon exited (code ${code}) — Postman control unavailable`);
  });
  daemonProcess = child;
  await whenChildSpawned(child);
  const status = getDaemonStatus();
  if (!status.running || !status.pid) throw new Error('daemon did not stay running after spawn');
  return { ...status, message: `started (pid ${status.pid}) — attaching to Postman` };
}

export async function killPostmanDaemon() {
  const child = daemonProcess;
  if (child && child.exitCode === null && !child.killed) {
    if (!child.kill() && !child.killed) throw new Error('failed to signal daemon');
    await whenChildExits(child);
    if (daemonProcess === child) daemonProcess = null;
  } else {
    daemonProcess = null;
    const pid = filePidLive();
    if (!pid) return { ...getDaemonStatus(), message: 'not running' };
    process.kill(pid, 'SIGTERM');
    await whenPidDies(pid);
  }
  const status = getDaemonStatus();
  if (status.running) throw new Error('daemon still running after kill');
  return { ...status, message: 'stopped' };
}

// Panel → daemon IPC for the "New window" panel button: drops a flag file next to data.json
// that the daemon's own 1s discover() loop already checks (scripts/aki-pmcontrol/index.js),
// so no new transport is needed for a request that only needs to happen, not carry data.
// This is the only writer of that file; the daemon is the only reader/deleter.
export function requestNewWindow() {
  const status = getDaemonStatus();
  if (!status.running) throw new Error('Postman daemon not running — launch it first');
  if (!status.attached || !status.ownerTargetId) throw new Error('Postman daemon has no attached owner target');
  mkdirSync(path.dirname(NEW_WINDOW_FLAG_PATH), { recursive: true });
  writeFileSync(NEW_WINDOW_FLAG_PATH, '');
  return { ok: true, message: 'requested a new Postman window' };
}

// ── Postman CDP action tools (built on the app-agnostic engine in cdp-engine.js) ──────────────
// Each opens its own short-lived CDP connection to Postman's endpoint and never adopts/owns it, so
// it coexists with the control daemon's long-lived owned session (CDP allows multiple clients).
// Endpoint discovery is authoritative: the daemon's ownership-status.json (the port a running
// instance actually bound to) first, then Postman's DevToolsActivePort — never a guessed 9222.
function resolvePostmanEndpoint() {
  const status = getDaemonStatus();
  if (status.endpoint?.port) return { host: status.endpoint.host || '127.0.0.1', port: status.endpoint.port };
  const port = cdp.readDevToolsPort('postman');
  if (port) return { host: '127.0.0.1', port };
  return null;
}

// The main Postman renderer is identified by its DOM/mediator, not its url (Postman opens several renderer targets). Polling this also waits for the SPA to mount — the real fix for false-ready.
const POSTMAN_MAIN_PROBE = "window.pm || document.querySelector('#global-contextbar-overlay-container') || document.querySelector('[data-testid=\"ai-chat-container\"]')";

async function postmanEval(expression, { awaitPromise = true } = {}) {
  const endpoint = resolvePostmanEndpoint();
  if (!endpoint) throw new Error('Postman remote-debugging endpoint not found — launch Postman from the Aki panel (it adds --remote-debugging-port) first');
  const target = await cdp.findTarget({ ...endpoint, probeExpression: POSTMAN_MAIN_PROBE });
  return cdp.evaluate({ ...endpoint, target, expression, awaitPromise });
}

// Rename via Postman's own inline edit so the change persists in app state (a raw textContent write is
// reverted on the next render). Anchor ONLY to the app-owned semantic classes (.ai-chat-conversation-name*)
// — never the styled-components sc-* hashes, which regenerate on every build. Two things the naive version
// got wrong: (1) a lone synthetic dblclick does not flip the component into edit mode, so we replay the
// full native mouse sequence (two press/release/click pairs + a detail:2 dblclick); (2) on entering edit
// mode the view <h4> is detached, so nameEl.parentElement is null — the input actually lives inside
// .ai-chat-conversation-name-editor, which is where we look (with a focused-field fallback).
const RENAME_JS = (name) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NAME = ${JSON.stringify(name)};
  const VIEW_SEL = '.ai-chat-conversation-name-editable, .ai-chat-conversation-name';
  const EDITOR_SEL = '.ai-chat-conversation-name-editor';
  const readName = () => { const el = document.querySelector(VIEW_SEL); return el ? (el.textContent || '').trim() : null; };
  const findInput = () => {
    const editor = document.querySelector(EDITOR_SEL);
    const scoped = editor && editor.querySelector('input, textarea');
    if (scoped) return scoped;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.closest('.ai-chat-container, .ai-chat-header')) return active;
    return null;
  };
  const nameEl = document.querySelector(VIEW_SEL);
  if (!nameEl) return { ok: false, step: 'find', reason: 'conversation-name element not found' };
  const before = (nameEl.textContent || '').trim();
  nameEl.scrollIntoView({ block: 'center' });
  // The component enters edit mode off the native click sequence, not a bare dblclick — replay both.
  const r = nameEl.getBoundingClientRect();
  const mouse = (type, detail) => nameEl.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: 0, detail,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }));
  mouse('mousedown', 1); mouse('mouseup', 1); mouse('click', 1);
  mouse('mousedown', 2); mouse('mouseup', 2); mouse('click', 2);
  mouse('dblclick', 2);
  let input = null;
  for (let i = 0; i < 20 && !input; i++) { await sleep(50); input = findInput(); }
  if (!input) return { ok: false, step: 'edit', reason: 'edit field did not appear after dblclick', before };
  const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  input.focus();
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, NAME);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (const type of ['keydown', 'keypress', 'keyup']) {
    input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  if (input.blur) input.blur();
  // Confirm the commit: wait for edit mode to close and the view element to reflect the new name.
  let after = null;
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    if (!document.querySelector(EDITOR_SEL)) { after = readName(); if (after === NAME) break; }
  }
  if (after === null) after = readName();
  return { ok: after === NAME, before, requested: NAME, after };
})()`;

// Full-width the right context panel by overriding #global-contextbar-overlay-container's width via an injected <style> (survives re-renders, unlike an inline style React would reset).
const FULLWIDTH_JS = (enable) => `(() => {
  const ID = 'aki-fullwidth-style';
  const existing = document.getElementById(ID);
  if (!${enable}) { if (existing) existing.remove(); return { ok: true, enabled: false }; }
  const el = existing || document.createElement('style');
  el.id = ID;
  el.textContent = '#global-contextbar-overlay-container{width:100vw !important;max-width:100vw !important;left:0 !important;right:0 !important;}';
  if (!existing) document.head.appendChild(el);
  return { ok: true, enabled: true, targetFound: !!document.getElementById('global-contextbar-overlay-container') };
})()`;

export function register(server) {
  server.registerTool(
    'postman_status',
    {
      title: 'Postman Control Status',
      description:
        "Report whether the Postman control daemon is running and its live CDP ownership state. Does not launch Postman or open a connection.",
      inputSchema: {},
    },
    async () => ok(JSON.stringify(getDaemonStatus(), null, 2)),
  );

  server.registerTool(
    'postman_eval',
    {
      title: 'Postman: evaluate JS in the app',
      description:
        "Evaluate a JavaScript expression inside the running Postman desktop renderer over CDP and return the serialized result. Auto-discovers Postman's remote-debugging endpoint (launch Postman from the Aki panel first) and its main renderer target. Use it to inspect or drive Postman's own UI.",
      inputSchema: { expression: z.string().describe('JS evaluated in the Postman renderer; the last expression is returned') },
    },
    async ({ expression }) => {
      try { return ok(JSON.stringify(await postmanEval(expression), null, 2)); }
      catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'postman_rename_conversation',
    {
      title: 'Postman: rename current chat',
      description:
        "Rename the currently open Agent Mode conversation by driving Postman's own inline edit (double-click → type → Enter) so the change persists in app state.",
      inputSchema: { name: z.string().min(1).describe('the new conversation title') },
    },
    async ({ name }) => {
      try { return ok(JSON.stringify(await postmanEval(RENAME_JS(name)), null, 2)); }
      catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'postman_panel_fullwidth',
    {
      title: 'Postman: toggle right panel full width',
      description:
        "Override the width of Postman's right context panel (#global-contextbar-overlay-container) to fill the window via an injected style tag that survives re-renders. Pass enable=false to restore.",
      inputSchema: { enable: z.boolean().optional().describe('true (default) = full width; false = restore') },
    },
    async ({ enable }) => {
      try { return ok(JSON.stringify(await postmanEval(FULLWIDTH_JS(enable !== false)), null, 2)); }
      catch (e) { return fail(e); }
    },
  );
}
