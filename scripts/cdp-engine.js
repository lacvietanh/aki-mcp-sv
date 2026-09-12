// Generic Chrome DevTools Protocol engine — the app-agnostic core behind the devtools_* MCP tools.
// Works against ANY Chromium/Electron target that exposes a --remote-debugging-port (Chrome,
// Postman, VS Code, Slack, …). It knows NOTHING about Postman: app-specific selectors and named
// actions live in the caller (see postman-mcp.js). Every call opens one short-lived connection and
// closes it — it never adopts or holds ownership, so it coexists with the aki-pmcontrol daemon's
// long-lived owned session on the same endpoint (CDP permits multiple concurrent clients).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import CDP from 'chrome-remote-interface';

const DEFAULT_HOST = '127.0.0.1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where each known app writes its live DevToolsActivePort file (first line = the actual port a
// running instance bound to — authoritative, unlike a guessed 9222). A caller that already knows
// the port passes it directly and skips this. Unknown app => treat the arg as the support-dir name.
export function devToolsPortFile(app = 'postman') {
  const home = os.homedir();
  const NAMES = { postman: 'Postman', code: 'Code', slack: 'Slack' };
  const dirName = NAMES[app] || app;
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', dirName, 'DevToolsActivePort');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), dirName, 'DevToolsActivePort');
  return path.join(home, '.config', dirName, 'DevToolsActivePort');
}

// Returns the port an app is actually listening on, or null. Never silently falls back to 9222:
// a null result is an honest "unknown", which the caller can surface instead of targeting the
// wrong process (the "silent 9222" trap in postman-session.getDevToolsPort()).
export function readDevToolsPort(app = 'postman') {
  try {
    const first = fs.readFileSync(devToolsPortFile(app), 'utf8').trim().split('\n')[0];
    const port = parseInt(first, 10);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

export async function listTargets({ host = DEFAULT_HOST, port } = {}) {
  return CDP.List({ host, port });
}

// Pick a page target. `filter` may be a RegExp/substring tested against "<url> <title>", or a predicate function; default = the first page target.
function selectTarget(targets, filter) {
  const pages = targets.filter((t) => t.type === 'page');
  if (!filter) return pages[0] || null;
  const test = filter instanceof RegExp
    ? (t) => filter.test(`${t.url} ${t.title}`)
    : typeof filter === 'function'
      ? filter
      : (t) => `${t.url} ${t.title}`.includes(String(filter));
  return pages.find(test) || null;
}

// Evaluate JS in a target and return the serialized result — or throw with the page-side message
// on a thrown exception. `target` may be a target object (from listTargets/waitForTarget), a target
// id string, or omitted with a `filter` to locate one.
export async function evaluate({
  host = DEFAULT_HOST, port, target, filter, expression,
  awaitPromise = true, returnByValue = true, userGesture = true,
} = {}) {
  if (!expression) throw new Error('evaluate requires an expression');
  let resolved = target && typeof target === 'object' ? target : null;
  if (!resolved) {
    const targets = await CDP.List({ host, port });
    resolved = typeof target === 'string' ? targets.find((t) => t.id === target) : selectTarget(targets, filter);
  }
  if (!resolved) throw new Error(`no matching CDP target on ${host}:${port}`);
  const client = await CDP({ host, port, target: resolved.webSocketDebuggerUrl || resolved.id });
  try {
    await client.Runtime.enable().catch(() => {});
    const { result, exceptionDetails } = await client.Runtime.evaluate({ expression, awaitPromise, returnByValue, userGesture, includeCommandLineAPI: true });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'page evaluation error');
    }
    return {
      value: returnByValue ? result.value : undefined,
      type: result.type,
      target: { id: resolved.id, url: resolved.url, title: resolved.title },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

// Poll until a target matching `filter` exists AND (optional) `readyExpression` returns truthy
// INSIDE it. This is the real fix for "endpoint-up ≠ renderer-ready": CDP.List() answering only
// proves the CDP server is up, not that the SPA has mounted its DOM. Gate one-shot actions on real
// DOM, e.g. readyExpression: "!!document.querySelector('[data-testid=\"ai-chat-container\"]')".
export async function waitForTarget({
  host = DEFAULT_HOST, port, filter, readyExpression,
  timeoutMs = 15000, pollMs = 150,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      // Scan ALL matching page targets, not just the first: an Electron app (Postman) opens several
      // windows and only one hosts the DOM the caller wants. Return the first where readyExpression
      // holds, so the right window is chosen instead of whichever sorted first.
      const pages = (await CDP.List({ host, port })).filter((t) => t.type === 'page');
      const test = !filter ? () => true
        : filter instanceof RegExp ? (t) => filter.test(`${t.url} ${t.title}`)
        : typeof filter === 'function' ? filter
        : (t) => `${t.url} ${t.title}`.includes(String(filter));
      const candidates = pages.filter(test);
      for (const target of candidates) {
        if (!readyExpression) return target;
        const probe = await evaluate({ host, port, target, expression: `!!(${readyExpression})` })
          .catch((e) => { lastError = e; return { value: false }; });
        if (probe.value) return target;
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(pollMs);
  } while (Date.now() < deadline);
  throw new Error(`waitForTarget timed out on ${host}:${port}${lastError ? ` (${lastError.message})` : ''}`);
}

// Launch any Electron/Chromium app with remote debugging enabled, then wait until its CDP endpoint
// answers. `execPath` = the app binary; `args` are appended after the debug flags. Non-invasive:
// detached + unref so the app outlives this process. Returns the endpoint it came up on.
export async function launch({ execPath, args = [], port = 9222, host = DEFAULT_HOST, timeoutMs = 20000 } = {}) {
  if (!execPath) throw new Error('launch requires execPath');
  const flags = [`--remote-debugging-port=${port}`, '--disable-blink-features=AutomationControlled', ...args];
  const child = spawn(execPath, flags, { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      await CDP.List({ host, port });
      return { host, port, pid: child.pid || null, launched: true };
    } catch (e) {
      lastError = e;
      await sleep(200);
    }
  } while (Date.now() < deadline);
  throw new Error(`launched ${execPath} but its CDP endpoint never came up on ${host}:${port}${lastError ? ` (${lastError.message})` : ''}`);
}

// Find the first page target whose in-page probe returns truthy. Robust for multi-window apps
// (Postman opens several renderers) where the right window is identified by its DOM/mediator, not
// its url. Polls until timeout so it also waits for the SPA to mount (fixes false-ready).
export async function findTarget({ host = DEFAULT_HOST, port, probeExpression, timeoutMs = 15000, pollMs = 200 } = {}) {
  if (!probeExpression) throw new Error('findTarget requires a probeExpression');
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    let pages = [];
    try {
      pages = (await CDP.List({ host, port })).filter((t) => t.type === 'page');
    } catch (e) {
      lastError = e;
    }
    for (const target of pages) {
      const probe = await evaluate({ host, port, target, expression: `!!(${probeExpression})` })
        .catch((e) => { lastError = e; return { value: false }; });
      if (probe.value) return target;
    }
    await sleep(pollMs);
  } while (Date.now() < deadline);
  throw new Error(`findTarget: no target matched the probe on ${host}:${port}${lastError ? ` (${lastError.message})` : ''}`);
}

export async function screenshot({
  host = DEFAULT_HOST, port, target, filter,
  format = 'png', quality = 80, clip,
} = {}) {
  let resolved = target && typeof target === 'object' ? target : null;
  if (!resolved) {
    const targets = await CDP.List({ host, port });
    resolved = typeof target === 'string' ? targets.find((t) => t.id === target) : selectTarget(targets, filter);
  }
  if (!resolved) throw new Error(`no matching CDP target on ${host}:${port}`);
  const client = await CDP({ host, port, target: resolved.webSocketDebuggerUrl || resolved.id });
  try {
    await client.Page.enable().catch(() => {});
    const params = { format };
    if (format === 'jpeg') params.quality = quality;
    if (clip) params.clip = clip;
    const { data } = await client.Page.captureScreenshot(params);
    return {
      data,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      target: { id: resolved.id, url: resolved.url, title: resolved.title },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function click({
  host = DEFAULT_HOST, port, target, filter, selector,
} = {}) {
  if (!selector) throw new Error('click requires selector');
  const expression = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found for selector: " + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      el.click();
      return {
        clicked: true,
        tagName: el.tagName,
        text: (el.innerText || el.textContent || '').trim().slice(0, 100),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    })()
  `;
  return evaluate({ host, port, target, filter, expression });
}

export async function type({
  host = DEFAULT_HOST, port, target, filter, selector, text, clear = false, enter = false,
} = {}) {
  if (!selector) throw new Error('type requires selector');
  const expression = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found for selector: " + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();
      if (${clear ? 'true' : 'false'}) {
        el.value = '';
      }
      const val = ${JSON.stringify(text || '')};
      el.value = (${clear ? 'true' : 'false'} ? '' : (el.value || '')) + val;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      if (${enter ? 'true' : 'false'}) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        if (el.form && typeof el.form.requestSubmit === 'function') {
          try { el.form.requestSubmit(); } catch {}
        }
      }
      return {
        typed: true,
        tagName: el.tagName,
        valueLength: (el.value || '').length,
        selector: ${JSON.stringify(selector)}
      };
    })()
  `;
  return evaluate({ host, port, target, filter, expression });
}

export async function openTab({ host = DEFAULT_HOST, port, url = 'about:blank' } = {}) {
  if (!port) throw new Error('openTab requires port');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      path: `/json/new?${encodeURIComponent(url)}`,
      method: 'PUT',
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export async function closeTab({ host = DEFAULT_HOST, port, targetId } = {}) {
  if (!port || !targetId) throw new Error('closeTab requires port and targetId');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      path: `/json/close/${targetId}`,
      method: 'PUT',
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => resolve({ closed: true, targetId, response: raw.trim() }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function activateTab({ host = DEFAULT_HOST, port, targetId } = {}) {
  if (!port || !targetId) throw new Error('activateTab requires port and targetId');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      path: `/json/activate/${targetId}`,
      method: 'PUT',
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => resolve({ activated: true, targetId, response: raw.trim() }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function probeAi({ host = DEFAULT_HOST, port, target, filter } = {}) {
  const expression = `
    (async () => {
      const href = location.href;
      if (href.includes('claude.ai')) {
        try {
          const orgs = await fetch('/api/organizations', { credentials: 'include' }).then(r => r.json());
          const org = Array.isArray(orgs) ? orgs[0] : null;
          if (!org) return { provider: 'claude', loggedIn: false };
          let usage = null;
          try {
            usage = await fetch('/api/organizations/' + org.id + '/usage', { credentials: 'include' }).then(r => r.json());
          } catch {}
          return {
            provider: 'claude',
            loggedIn: true,
            orgName: org.name,
            plan: org.plan || 'free',
            usage: usage || null,
          };
        } catch (e) {
          return { provider: 'claude', loggedIn: false, error: e.message };
        }
      }
      if (href.includes('chatgpt.com')) {
        try {
          const session = await fetch('/api/auth/session', { credentials: 'include' }).then(r => r.json());
          if (!session || !session.user) return { provider: 'chatgpt', loggedIn: false };
          let usage = null;
          if (session.accessToken) {
            try {
              usage = await fetch('/backend-api/wham/usage', {
                headers: { Authorization: 'Bearer ' + session.accessToken },
                credentials: 'include'
              }).then(r => r.json());
            } catch {}
          }
          return {
            provider: 'chatgpt',
            loggedIn: true,
            email: session.user.email,
            name: session.user.name,
            plan: session.accountPlan || 'free',
            usage: usage || null,
          };
        } catch (e) {
          return { provider: 'chatgpt', loggedIn: false, error: e.message };
        }
      }
      if (href.includes('grok.com')) {
        try {
          const res = await fetch('/rest/rate-limits', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requestKind: 'DEFAULT', modelName: 'grok-3' }),
            credentials: 'include'
          }).then(r => r.json());
          return {
            provider: 'grok',
            loggedIn: !res.error,
            rateLimits: res,
          };
        } catch (e) {
          return { provider: 'grok', loggedIn: false, error: e.message };
        }
      }
      return { provider: 'unknown', url: href, title: document.title };
    })()
  `;
  return evaluate({ host, port, target, filter, expression });
}

export default {
  devToolsPortFile,
  readDevToolsPort,
  listTargets,
  evaluate,
  waitForTarget,
  findTarget,
  launch,
  screenshot,
  click,
  type,
  openTab,
  closeTab,
  activateTab,
  probeAi,
};
