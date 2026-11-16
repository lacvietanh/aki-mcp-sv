// Where an OAuth code may go: the built-in callbacks plus the owner's own entries in setting.json `oauth.callbacks`, one shape for both (docs/plan/custom-oauth-callbacks.md D1–D4, D8).
import { isPlainObject, readSettingsChecked, writeSettings } from './allowlist.js';
import { logSecurity } from './security-log.js';

const hosts = (name, list, extra = {}) => list.map((value) => ({ name, match: 'host', value, ...extra }));

const BUILTIN_CALLBACKS = [
  { name: 'Claude', match: 'exact', value: 'https://claude.ai/api/mcp/auth_callback' },
  { name: 'ChatGPT', match: 'exact', value: 'https://chatgpt.com/connector_platform_oauth_redirect' },
  { name: 'ChatGPT', match: 'prefix', value: 'https://chatgpt.com/connector/oauth/' },
  // Grok self-registers (DCR) with this callback, not a /connector/oauth/ path (observed live 2026-08-09).
  { name: 'Grok', match: 'prefix', value: 'https://grok.com/connectors-oauth-exchange-code/' },
  // ClickUp DCR registers this exact callback, the one its MCP Server form names (observed live 2026-10-21).
  { name: 'ClickUp', match: 'exact', value: 'https://search.clickup-prod.com/connect/mcp' },
  // Notion DCR self-registers as a confidential client on one of these hosts (verified live 2026-09-22).
  ...hosts('Notion', ['notion.so', 'www.notion.so', 'app.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com', 'mcp.notion.com']),
  // Gemini DCR registers Google's OAuth proxy hosts with no path, not gemini.google.com.
  // Google's relay serves other Google OAuth clients too, so the consent label must not read as Gemini's own address.
  ...hosts('Gemini', ['oauth-redirect.googleusercontent.com', 'oauth-redirect-sandbox.googleusercontent.com', 'oauth-redirect-test.googleusercontent.com'], { via: "through Google's shared sign-in relay" }),
];

// /authorize redirects to the parsed URL, so every match compares what the browser is sent: a dot segment after a prefix is resolved before the prefix is checked.
const MATCHES = {
  exact: (url, value) => url.href === value,
  prefix: (url, value) => {
    const base = new URL(value);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname);
  },
  host: (url, value) => url.hostname === value,
};

function parseCallback(uri) {
  if (typeof uri !== 'string' || uri.includes('#')) return null;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** `{ entry, builtIn }` for the first built-in, then user entry, that allows this callback; null otherwise. Pass `userEntries` to check several callbacks against one read. */
export function matchCallback(uri, userEntries) {
  const url = parseCallback(uri);
  if (!url) return null;
  const builtIn = BUILTIN_CALLBACKS.find((entry) => MATCHES[entry.match](url, entry.value));
  if (builtIn) return { entry: builtIn, builtIn: true };
  const own = (userEntries ?? readUserCallbacks().entries).find((entry) => MATCHES[entry.match](url, entry.value));
  return own ? { entry: own, builtIn: false } : null;
}

const MAX_VALUE_LENGTH = 2048;
const IP_LITERAL = /^[\d.]+$|[[:]/;

/** `{ entry }` in stored form, or `{ reason }` the panel shows as is. A user entry has no name: whoever registered could choose it, and the consent page would show it as a trust label. */
function checkUserCallback(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'an entry needs a match and an address' };
  if (raw.match !== 'exact' && raw.match !== 'prefix') return { reason: 'match must be "exact" or "prefix"' };
  if (typeof raw.value !== 'string' || !raw.value) return { reason: 'the address is missing' };
  if (raw.value.length > MAX_VALUE_LENGTH) return { reason: 'the address is longer than 2,048 characters' };
  if (raw.value.includes('#')) return { reason: 'the address must not contain #' };
  let url;
  try {
    url = new URL(raw.value);
  } catch {
    return { reason: 'the address is not a full URL, like https://example.com/callback' };
  }
  if (url.protocol !== 'https:') return { reason: 'the address must start with https://' };
  if (url.username || url.password) return { reason: 'the address must not contain a user name or password' };
  if (IP_LITERAL.test(url.hostname)) return { reason: 'the address must use a domain name, not an IP address' };
  if (url.hostname.endsWith('.')) return { reason: 'the domain name must not end with a dot' };
  if (!url.hostname.includes('.')) return { reason: 'the domain name needs a dot, like example.com' };
  if (raw.match === 'exact') return { entry: { match: 'exact', value: url.href } };
  if (url.pathname.length < 2 || !url.pathname.endsWith('/')) return { reason: 'a prefix needs a path that ends with /, like https://example.com/oauth/' };
  return { entry: { match: 'prefix', value: url.origin + url.pathname } };
}

/** Null when this callback could be added as an exact entry; otherwise the reason it cannot. */
export const whyNotAddable = (uri) => checkUserCallback({ match: 'exact', value: uri }).reason ?? null;

const sameEntry = (a, b) => !!a && !!b && a.match === b.match && a.value === b.value;
const withHost = (entry) => ({ ...entry, host: new URL(entry.value).host });

// `shape` names a value that is present but not one a write could keep, so the reader reports it and the writers refuse.
function locateCallbacks(settings) {
  const { oauth } = settings;
  if (oauth === undefined) return { oauth: {}, callbacks: [] };
  if (!isPlainObject(oauth)) return { shape: 'oauth must be an object in { }', found: oauth };
  if (oauth.callbacks === undefined) return { oauth, callbacks: [] };
  if (!Array.isArray(oauth.callbacks)) return { shape: 'oauth.callbacks must be a list in [ ]', found: oauth.callbacks };
  return { oauth, callbacks: oauth.callbacks };
}

/** Read fresh on every call, so a panel or hand edit applies to the next /register and /authorize with no restart. An invalid entry is skipped on its own; built-ins apply whatever the file holds. */
export function readUserCallbacks() {
  const { settings, error } = readSettingsChecked();
  const { callbacks, shape, found } = locateCallbacks(settings);
  const entries = [];
  const skipped = shape ? [{ entry: JSON.stringify(found), reason: `${shape}, so it is ignored` }] : [];
  for (const raw of callbacks ?? []) {
    const { entry, reason } = checkUserCallback(raw);
    if (reason) skipped.push({ entry: JSON.stringify(raw), reason });
    else if (!entries.some((kept) => sameEntry(kept, entry))) entries.push(entry);
  }
  return { entries: entries.map(withHost), skipped, readError: error };
}

// Writing over a file that could not be read would replace every other setting with this one key.
function readStoredCallbacks() {
  const { settings, error } = readSettingsChecked();
  if (error) throw new Error(`setting.json cannot be read (${error}): fix or remove it, then try again`);
  const { oauth, callbacks, shape } = locateCallbacks(settings);
  if (shape) throw new Error(`setting.json: ${shape}, so AkiMCP will not overwrite it. Fix or remove it, then try again.`);
  return { settings, oauth, callbacks };
}

function saveCallbacks({ settings, oauth }, callbacks) {
  settings.oauth = { ...oauth, callbacks };
  writeSettings(settings);
}

/** Returns the stored entry with its host and whether it was new; throws the D3 reason for an invalid one. */
export function addUserCallback(raw) {
  const { entry, reason } = checkUserCallback(raw);
  if (reason) throw new Error(reason);
  const stored = readStoredCallbacks();
  const added = !stored.callbacks.some((kept) => sameEntry(checkUserCallback(kept).entry, entry));
  if (added) {
    saveCallbacks(stored, [...stored.callbacks, entry]);
    logSecurity(`oauth callback added: ${entry.match} ${entry.value}`);
  }
  return { ...withHost(entry), added };
}

/** Drops every stored form of this entry; entries the reader skips stay in the file untouched. */
export function removeUserCallback(raw) {
  const { entry } = checkUserCallback(raw);
  const stored = readStoredCallbacks();
  const kept = stored.callbacks.filter((own) => !sameEntry(checkUserCallback(own).entry, entry));
  if (kept.length === stored.callbacks.length) throw new Error('that address is not in your list: press Refresh');
  saveCallbacks(stored, kept);
  logSecurity(`oauth callback removed: ${entry.match} ${entry.value}`);
  return withHost(entry);
}

// Memory only, newest first: a refused row holds caller-chosen text, which never reaches the disk (D8).
const REFUSED_LIMIT = 20;
const refused = [];

function refusedCallback(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  const folder = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  const reason = whyNotAddable(uri);
  return { href: url.href, shown: `${url.protocol}//${url.host}${url.pathname}`, host: url.host, prefix: !reason && folder.length > 1 ? url.origin + folder : null, reason };
}

/** One row per distinct set of refused callbacks; a repeat moves the row to the top and counts it. */
export function noteRefused(uris, clientName = null) {
  const callbacks = [...new Map(uris.map(refusedCallback).filter(Boolean).map((c) => [c.href, c])).values()];
  if (!callbacks.length) return;
  const key = callbacks.map((c) => c.href).sort().join(' ');
  const now = Date.now();
  const at = refused.findIndex((row) => row.key === key);
  const row = at < 0 ? { key, callbacks, clientName: null, firstAt: now, count: 0 } : refused.splice(at, 1)[0];
  Object.assign(row, { clientName: clientName ?? row.clientName, lastAt: now, count: row.count + 1 });
  refused.unshift(row);
  refused.length = Math.min(refused.length, REFUSED_LIMIT);
}

/** Rows with a callback still refused; a row whose callbacks all match an entry now is left out. */
export function listRefused() {
  const { entries } = readUserCallbacks();
  return refused.filter((row) => !row.callbacks.every((c) => matchCallback(c.href, entries))).map(({ key, ...row }) => row);
}
