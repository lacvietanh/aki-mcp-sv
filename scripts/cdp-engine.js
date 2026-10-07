// Generic Chrome DevTools Protocol engine — the app-agnostic core behind the devtools_* MCP tools.
// Works against ANY Chromium/Electron target that exposes a --remote-debugging-port (Chrome,
// Postman, VS Code, Slack, …). It knows NOTHING about Postman: app-specific selectors and named
// actions live in the caller (see postman-mcp.js). Every call opens one short-lived connection and
// closes it — it never adopts or holds ownership, so it coexists with the Postman daemon's
// long-lived owned session on the same endpoint (CDP permits multiple concurrent clients).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import CDP from 'chrome-remote-interface';

const DEFAULT_HOST = '127.0.0.1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where each known app writes its live DevToolsActivePort file (first line = the actual port a
// running instance bound to — authoritative, unlike a guessed 9222). A caller that already knows
// the port passes it directly and skips this. Unknown app => treat the arg as the support-dir name.
function devToolsPortFile(app = 'postman') {
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

// A dropped CDP socket emits 'error'; with no listener Node treats that as an uncaught exception and kills the whole MCP server — log it and let the pending call reject on its own.
async function openClient(opts) {
  const client = await CDP(opts);
  client.on('error', (e) => console.error(`[cdp-engine] socket error: ${e?.message || e}`));
  client.on('disconnect', () => {});
  return client;
}

// S7, 2026-10-05: 24 logged calls ended at ~60s with nothing back. Every call here ends within CALL_BOUND_MS (lookup + connect included), refusing with code timeout and a safe next step.
export const CALL_BOUND_MS = 50_000;
function timeoutError(message, next) {
  const e = new Error(`${message}; code timeout; next: ${next}`);
  e.code = 'timeout';
  e.timedOut = true;
  return e;
}
// Runs work(adopt) against one bound: a client adopted after the bound is closed at once, the one adopted in time is closed when the call ends.
async function bounded(timeoutMs, onTimeout, work) {
  let timer;
  let client = null;
  let over = false;
  const adopt = async (c) => {
    if (over) {
      await c.close().catch(() => {});
      throw onTimeout();
    }
    client = c;
    return c;
  };
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { over = true; reject(onTimeout()); }, timeoutMs);
  });
  const running = work(adopt);
  running.catch(() => {}); // lost the race: its late failure has no one left to tell
  try {
    return await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
    if (client) await client.close().catch(() => {});
  }
}
const endpointTimeout = (host, port, timeoutMs) => () => timeoutError(`the CDP endpoint ${host}:${port} did not answer within ${timeoutMs / 1000}s`, 'check the app is running with aki__port_status, then try once more');

export async function listTargets({ host = DEFAULT_HOST, port, timeoutMs = CALL_BOUND_MS } = {}) {
  return bounded(timeoutMs, endpointTimeout(host, port, timeoutMs), () => CDP.List({ host, port }));
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

// Evaluate JS in a target and return the serialized result — or throw with the page-side message on a thrown exception. `target` may be a target object (from listTargets/findTarget), a target id string, or omitted with a `filter` to locate one.
export async function evaluate({
  host = DEFAULT_HOST, port, target, filter, expression,
  awaitPromise = true, returnByValue = true, userGesture = true, timeoutMs = CALL_BOUND_MS,
} = {}) {
  if (!expression) throw new Error('evaluate requires an expression');
  const onTimeout = () => timeoutError(`the page did not answer within ${timeoutMs / 1000}s (the tab is frozen, or the script is still running)`, 'the script may have run: check with a short read-only expression before running it again; still no answer: the tab is frozen, tell the owner');
  return bounded(timeoutMs, onTimeout, async (adopt) => {
    const resolved = await resolveTarget({ host, port, target, filter });
    const client = await adopt(await openClient({ host, port, target: resolved.webSocketDebuggerUrl || resolved.id }));
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
  });
}

// The target object as given, else the page target by id or filter (inside the caller's bound).
async function resolveTarget({ host, port, target, filter }) {
  let resolved = target && typeof target === 'object' ? target : null;
  if (!resolved) {
    const targets = await CDP.List({ host, port });
    resolved = typeof target === 'string' ? targets.find((t) => t.id === target) : selectTarget(targets, filter);
  }
  if (!resolved) throw new Error(`no matching CDP target on ${host}:${port}`);
  return resolved;
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
      const probe = await evaluate({ host, port, target, expression: `!!(${probeExpression})`, timeoutMs: Math.max(deadline - Date.now(), 1000) })
        .catch((e) => { lastError = e; return { value: false }; });
      if (probe.value) return target;
    }
    await sleep(pollMs);
  } while (Date.now() < deadline);
  throw new Error(`findTarget: no target matched the probe on ${host}:${port}${lastError ? ` (${lastError.message})` : ''}`);
}

export async function screenshot({
  host = DEFAULT_HOST, port, target, filter,
  format = 'png', quality = 80, clip, timeoutMs = CALL_BOUND_MS,
} = {}) {
  const onTimeout = () => timeoutError(`the page gave no screenshot within ${timeoutMs / 1000}s (the tab is frozen or hidden)`, 'try once more; still none: the tab is frozen, tell the owner');
  return bounded(timeoutMs, onTimeout, async (adopt) => {
    const resolved = await resolveTarget({ host, port, target, filter });
    const client = await adopt(await openClient({ host, port, target: resolved.webSocketDebuggerUrl || resolved.id }));
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
  });
}

// The /json/* HTTP calls (new, close, activate tab) end within the same bound.
function boundRequest(req, host, port, reject) {
  req.setTimeout(CALL_BOUND_MS, () => req.destroy(endpointTimeout(host, port, CALL_BOUND_MS)()));
  req.on('error', reject);
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
    boundRequest(req, host, port, reject);
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
    boundRequest(req, host, port, reject);
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
    boundRequest(req, host, port, reject);
    req.end();
  });
}

export default {
  CALL_BOUND_MS,
  readDevToolsPort,
  listTargets,
  evaluate,
  findTarget,
  screenshot,
  click,
  type,
  openTab,
  closeTab,
  activateTab,
};
