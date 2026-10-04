#!/usr/bin/env node
// Minimal OAuth 2.1 authorization server.
// Claude: pre-registered confidential client (paste Client ID/Secret), or DCR if it self-registers.
// ChatGPT: RFC 7591 DCR + public client (token_endpoint_auth_method: none) + chatgpt.com redirect URIs.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import {
  CLIENT_PATH as CLIENT_FILE,
  DCR_CLIENTS_PATH as DCR_FILE,
  PASSPHRASE_PATH as PASSPHRASE_FILE,
  TOKENS_PATH as TOKENS_FILE,
} from './userdata.js';
import { log } from './log.js';
import { logSecurity } from './security-log.js';
import { readBody, json as httpJson } from './http.js';
import { esc } from './html.js';
import { readLimits, clientKey } from './rate-limit.js';

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT_LEGACY_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_CALLBACK_PREFIX = 'https://chatgpt.com/connector/oauth/';
// Gemini custom connected apps redirect through Google's OAuth proxy, not a gemini.google.com path — observed live 2026-08-09: redirect_uri=https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<numeric>-<host-with-underscores>
const GEMINI_CALLBACK_PREFIX = 'https://oauth-redirect.googleusercontent.com/r/';
// Grok self-registers (DCR) with this callback — observed live 2026-08-09 from the register-REJECTED log: redirect_uris=["https://grok.com/connectors-oauth-exchange-code/"]. Note: NOT a /connector/oauth/ path.
const GROK_CALLBACK_PREFIX = 'https://grok.com/connectors-oauth-exchange-code/';
// Notion custom MCP self-registers (DCR) as a confidential client on one of these hosts, matched on the parsed hostname so lookalikes fail (verified against a real workspace 2026-09-22; Notion already moved one host to app.notion.com).
const NOTION_CALLBACK_HOSTS = new Set(['notion.so', 'www.notion.so', 'app.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com', 'mcp.notion.com']);
const CLIENT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];
const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_CLIENT_TTL_MS = 3600_000;
const IDLE_CLIENT_TTL_MS = 30 * 24 * 3600_000;
const STATIC_CLIENT_NAME = 'Claude (pre-registered)';
// OAuth bodies are a few hundred bytes; the cap keeps an unauthenticated caller from making the server buffer an arbitrary upload.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOGGED_TEXT = 64;
// Caller-supplied text (client_name, grant labels) reaches the log and the panel: control characters go, so a newline cannot forge a log line.
const cut = (text) => String(text ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, MAX_LOGGED_TEXT);
const ACCESS_TTL_S = 365 * 24 * 3600;
// no 0/o/1/l/i — avoid visual ambiguity when typing; 31 symbols, drawn with randomInt so none is favoured
const PASSPHRASE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSPHRASE_LENGTH = 10; // 31^10 ≈ 2^49.5 — brute-force still infeasible over network
// Display-only, to avoid leaking the OS username on a page reachable pre-passphrase; the file read below still uses PASSPHRASE_FILE.
const PASSPHRASE_DISPLAY_PATH = PASSPHRASE_FILE.replace(os.homedir(), '~');

const authCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();

function isAllowedRedirect(uri) {
  if (typeof uri !== 'string' || !uri) return false;
  if (uri === CLAUDE_CALLBACK || uri === CHATGPT_LEGACY_CALLBACK) return true;
  return uri.startsWith(CHATGPT_CALLBACK_PREFIX)
    || uri.startsWith(GROK_CALLBACK_PREFIX)
    || uri.startsWith(GEMINI_CALLBACK_PREFIX)
    || isNotionCallback(uri);
}

function isNotionCallback(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !uri.includes('#') && !url.username && !url.password && NOTION_CALLBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// Tokens survive restarts: the connector is a long-lived file-access grant, and losing it on every
// `npm start` forces a full re-authorize (passphrase) instead of the silent refresh the flow supports.
function loadTokens() {
  if (!existsSync(TOKENS_FILE)) return;
  try {
    const saved = JSON.parse(readFileSync(TOKENS_FILE, 'utf8'));
    for (const [token, entry] of Object.entries(saved.access ?? {})) accessTokens.set(token, entry);
    for (const [token, entry] of Object.entries(saved.refresh ?? {})) refreshTokens.set(token, entry);
  } catch (e) {
    console.error(`[oauth] skipping unreadable ${TOKENS_FILE} (${e.message}) — will need to authorize again`);
    return;
  }
  if (dropRefreshTokens((entry) => !resolveClient(entry.clientId))) saveTokens();
  // Older versions minted a fresh access token per grant and never removed the old ones; keep the first valid one (the one the panel showed, so pasted snippets survive).
  const loaded = accessTokens.size;
  const kept = [...accessTokens].find(([, entry]) => entry.expires >= Date.now());
  accessTokens.clear();
  if (kept) accessTokens.set(...kept);
  if (accessTokens.size !== loaded) {
    saveTokens();
    log(`[oauth] collapsed ${loaded} access tokens into ${accessTokens.size}`);
  }
}

function dropRefreshTokens(shouldDrop) {
  let dropped = 0;
  for (const [token, entry] of refreshTokens) {
    if (!shouldDrop(entry)) continue;
    refreshTokens.delete(token);
    dropped++;
  }
  return dropped;
}

// AIObox's Notion macro reads the first unexpired access token here until it moves to the passphrase flow (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
function saveTokens() {
  const body = { access: Object.fromEntries(accessTokens), refresh: Object.fromEntries(refreshTokens) };
  writeFileSync(TOKENS_FILE, JSON.stringify(body), { mode: 0o600 });
}

loadTokens();

// A crash between the temp write and the rename leaves the old file intact, so the Claude secret cannot be lost mid-write.
function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
}

export function loadOrCreateClient() {
  if (existsSync(CLIENT_FILE)) return JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
  const creds = { clientId: randomBytes(16).toString('hex'), clientSecret: randomBytes(32).toString('hex') };
  writeFileAtomic(CLIENT_FILE, JSON.stringify(creds));
  return creds;
}

function loadDcrClients() {
  if (!existsSync(DCR_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DCR_FILE, 'utf8'));
  } catch (e) {
    console.error(`[oauth] ignoring malformed ${DCR_FILE}: ${e.message}`);
    return {};
  }
}

function saveDcrClients(map) {
  writeFileAtomic(DCR_FILE, JSON.stringify(map, null, 2));
}

function clientDisplayName(client) {
  return cut(client.isStatic ? STATIC_CLIENT_NAME : client.clientName);
}

function callerFields(req) {
  return { lastAddress: clientKey(req), lastAgent: String(req.headers['user-agent'] || '').slice(0, MAX_LOGGED_TEXT) };
}

// Writes activity back to the file the client came from; the static record also gets firstSeenAt the first time it is touched.
function updateClientRecord(client, fields) {
  if (client.isStatic) {
    const stored = loadOrCreateClient();
    writeFileAtomic(CLIENT_FILE, JSON.stringify({ ...stored, firstSeenAt: stored.firstSeenAt ?? Date.now(), ...fields }));
    return;
  }
  const map = loadDcrClients();
  if (!map[client.clientId]) return;
  Object.assign(map[client.clientId], fields);
  saveDcrClients(map);
}

function redirectHostOf(uris) {
  try {
    return new URL(uris?.[0]).host;
  } catch {
    return null;
  }
}

// AIObox reads redirectHost, signedIn and tokenAt through GET /api/security (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
function activityView(record, kind, signedInIds) {
  const isClaude = kind === 'claude';
  return {
    clientId: record.clientId,
    name: isClaude ? STATIC_CLIENT_NAME : record.clientName ?? null,
    kind,
    redirectHost: isClaude ? new URL(CLAUDE_CALLBACK).host : redirectHostOf(record.redirectUris),
    firstSeenAt: record.firstSeenAt ?? null,
    approvedAt: record.approvedAt ?? null,
    tokenAt: record.tokenAt ?? null,
    lastAddress: record.lastAddress ?? null,
    lastAgent: record.lastAgent ?? null,
    pending: kind === 'dcr' && !!record.firstSeenAt && !record.approvedAt,
    signedIn: signedInIds.has(record.clientId),
  };
}

const lastActivityAt = (record) => Math.max(record.tokenAt ?? 0, record.approvedAt ?? 0, record.firstSeenAt ?? 0);
const signedInClientIds = () => new Set([...refreshTokens.values()].map((entry) => entry.clientId));

/** Display fields only — never secrets. Most recently active first; never-tracked entries last. */
export function listClients() {
  const signedInIds = signedInClientIds();
  const views = [activityView(loadOrCreateClient(), 'claude', signedInIds)];
  for (const record of Object.values(loadDcrClients())) views.push(activityView(record, 'dcr', signedInIds));
  return views.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

// Pending clients go after an hour. Any other client stays while it holds a refresh token, and otherwise for a month past its last activity, so reconnecting after a hard roll still finds it.
function isDeadClient(record, signedInIds, now) {
  const idle = now - lastActivityAt(record);
  if (record.firstSeenAt && !record.approvedAt) return idle > PENDING_CLIENT_TTL_MS;
  return !signedInIds.has(record.clientId) && idle > IDLE_CLIENT_TTL_MS;
}

function pruneClients(map) {
  const signedInIds = signedInClientIds();
  const dead = new Set(Object.keys(map).filter((id) => isDeadClient(map[id], signedInIds, Date.now())));
  for (const id of dead) delete map[id];
  if (dead.size && dropRefreshTokens((entry) => dead.has(entry.clientId))) saveTokens();
  return dead.size;
}

function pruneStoredClients() {
  const map = loadDcrClients();
  const removed = pruneClients(map);
  if (!removed) return;
  saveDcrClients(map);
  log(`[oauth] removed ${removed} unused clients`);
}

pruneStoredClients();

/** Drops the client's refresh tokens, and forgets a registered connector. The shared access token it already holds keeps working until rolled. */
export function removeClient(clientId) {
  const client = resolveClient(clientId);
  if (!client) throw new Error('unknown client — refresh the list');
  if (dropRefreshTokens((entry) => entry.clientId === clientId)) saveTokens();
  if (!client.isStatic) {
    const map = loadDcrClients();
    delete map[clientId];
    saveDcrClients(map);
  }
  const outcome = client.isStatic ? 'signed out' : 'removed';
  logSecurity(`client ${outcome} from the panel: ${clientDisplayName(client)}`);
  return outcome;
}

/** Static Claude client + any clients ChatGPT (or Claude) registered via /register. */
function resolveClient(clientId) {
  if (!clientId) return null;
  const staticClient = loadOrCreateClient();
  if (clientId === staticClient.clientId) {
    // The confidential client's ID/secret are deliberately pasted into more than one provider (Claude, and Gemini which reuses the same paste flow). Each provider sends its own redirect_uri, so this client accepts any allowlisted callback (isStatic below), not just CLAUDE_CALLBACK — the allowlist (isAllowedRedirect) is the security boundary, the same one /register enforces for public clients.
    return {
      clientId: staticClient.clientId,
      clientSecret: staticClient.clientSecret,
      redirectUris: [CLAUDE_CALLBACK],
      isStatic: true,
      tokenEndpointAuthMethod: 'client_secret_post',
    };
  }
  // Own property only: client_id=constructor or __proto__ must not resolve an Object.prototype member and crash the process.
  const dcr = loadDcrClients();
  return Object.hasOwn(dcr, clientId) ? dcr[clientId] : null;
}

export function loadOrCreatePassphrase() {
  if (existsSync(PASSPHRASE_FILE)) return readFileSync(PASSPHRASE_FILE, 'utf8').trim();
  const p = Array.from({ length: PASSPHRASE_LENGTH }, () => PASSPHRASE_ALPHABET[randomInt(PASSPHRASE_ALPHABET.length)]).join('');
  // AIObox reads this one-line file to fill the authorize page (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
  writeFileSync(PASSPHRASE_FILE, p, { mode: 0o600 });
  return p;
}

// The passphrase file is read per authorize request, so a roll takes effect immediately; existing tokens stay valid.
export function rotatePassphrase() {
  rmSync(PASSPHRASE_FILE, { force: true });
  logSecurity('passphrase rolled');
  return loadOrCreatePassphrase();
}

function safeEqual(a, b) {
  const ab = Buffer.from(a ?? '');
  const bb = Buffer.from(b ?? '');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const json = (res, status, body) => httpJson(res, status, body, { 'Cache-Control': 'no-store' });

export function metadataHandlers(origin) {
  return {
    protectedResource(req, res) {
      json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    },
    authorizationServer(req, res) {
      json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
        revocation_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        authorization_response_iss_parameter_supported: true,
      });
    },
  };
}

// RFC 7591 — ChatGPT calls this once per connector instance. Only Claude/ChatGPT redirect URIs are accepted.
export async function handleRegister(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY_BYTES) || '{}');
  } catch {
    return json(res, 400, { error: 'invalid_client_metadata' });
  }
  // null, [] and scalars are valid JSON too; reading metadata off them would crash on an unauthenticated request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_client_metadata' });
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every(isAllowedRedirect)) {
    // Log only the origin, enough to allowlist an unknown client's real callback without logging its path or query.
    const origins = Array.isArray(redirectUris) ? redirectUris.map((uri) => { try { return new URL(uri).origin; } catch { return '(invalid URL)'; } }) : [];
    log(`[oauth] register REJECTED (redirect_uri not allowlisted): ${JSON.stringify(origins)}`);
    return json(res, 400, { error: 'invalid_redirect_uri' });
  }
  const authMethod = body.token_endpoint_auth_method || 'none';
  if (!CLIENT_AUTH_METHODS.includes(authMethod)) {
    return json(res, 400, { error: 'invalid_client_metadata' });
  }

  const clientId = randomBytes(16).toString('hex');
  const clientSecret = authMethod === 'none' ? null : randomBytes(32).toString('hex');
  const entry = {
    clientId,
    clientSecret,
    redirectUris,
    tokenEndpointAuthMethod: authMethod,
    clientName: typeof body.client_name === 'string' && body.client_name.trim() ? cut(body.client_name) : 'MCP client',
    firstSeenAt: Date.now(),
  };
  const map = loadDcrClients();
  const pruned = pruneClients(map);
  if (Object.keys(map).length >= readLimits().maxClients) {
    if (pruned) saveDcrClients(map);
    return json(res, 429, { error: 'too_many_clients' });
  }
  map[clientId] = entry;
  saveDcrClients(map);

  const resp = {
    client_id: clientId,
    client_name: entry.clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
  if (clientSecret) resp.client_secret = clientSecret;
  return json(res, 201, resp);
}

// Shared by the confirm page (.card is the <form>) and both error pages (.card is a <div>) — one style block, one look.
const PAGE_STYLE = `
:root { color-scheme: light dark; --bg:#faf9f7; --card:#fff; --line:#e5e2dc; --fg:#1a1a1a; --muted:#6b6b6b; --accent:#ff4800; }
@media (prefers-color-scheme: dark) { :root { --bg:#1a1817; --card:#232120; --line:#38352f; --fg:#ececec; --muted:#9a948c; } }
* { box-sizing: border-box; }
body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; width: 100%; max-width: 360px; }
h1 { font-size: 16px; margin: 0 0 4px; }
p { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
input { width: 100%; padding: 9px 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; color: var(--fg); font-size: 14px; }
input:focus { outline: none; border-color: var(--accent); }
button { width: 100%; margin-top: 10px; padding: 9px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: #fff; font-size: 14px; cursor: pointer; }
button[disabled] { opacity: .6; cursor: progress; }
`;

function errorPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="/favicon/favicon.ico" sizes="any"><meta name="theme-color" content="#ff4800">
<style>${PAGE_STYLE}</style></head><body>
<div class="card">
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
<p>Go back and try again, or re-open the connector in your AI client.</p>
</div>
</body></html>`;
}

export async function handleAuthorize(req, res, passphrase, origin) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://internal');
  const q = req.method === 'GET' ? url.searchParams : new URLSearchParams(await readBody(req, MAX_BODY_BYTES));
  const redirectUri = q.get('redirect_uri');
  const clientId = q.get('client_id');
  const codeChallenge = q.get('code_challenge');
  const codeChallengeMethod = q.get('code_challenge_method');
  const state = q.get('state') || '';
  const scope = (q.get('scope') || '').trim();
  const client = resolveClient(clientId);
  // DCR clients are pinned to the exact redirect_uri they registered; the shared confidential client (isStatic) accepts any allowlisted callback, since it is pasted into several providers each with its own redirect.
  const redirectOk = !!client && (client.redirectUris.includes(redirectUri) || (client.isStatic && isAllowedRedirect(redirectUri)));

  if (!redirectOk || codeChallengeMethod !== 'S256' || !codeChallenge) {
    log(`[oauth] authorize REJECTED (${req.method}): client_ok=${!!client} redirect_ok=${redirectOk} method=${codeChallengeMethod === 'S256' ? 'S256' : 'unsupported'} hasChallenge=${!!codeChallenge}`);
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Connection request invalid', 'This connection request is invalid or has expired.'));
    return;
  }

  if (req.method === 'GET') {
    const clientLabel = client.clientName ? `An app called "${esc(client.clientName)}"` : 'An MCP client';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm MCP connection</title><link rel="icon" href="/favicon/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/favicon/icon-192.png"><link rel="apple-touch-icon" href="/favicon/apple-touch-icon.png"><link rel="manifest" href="/favicon/manifest.json"><meta name="theme-color" content="#ff4800">
<style>${PAGE_STYLE}</style></head><body>
<form class="card" method="POST" onsubmit="this.btn.disabled=true;this.btn.textContent='Confirming…'">
<h1>Confirm MCP connection</h1>
<p>${clientLabel} wants to connect.</p>
<p>Enter the passphrase shown in the control panel (section 1 · Connectors) to grant access — or read it from <code>${PASSPHRASE_DISPLAY_PATH}</code>.</p>
<input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
<input type="hidden" name="client_id" value="${esc(clientId)}">
<input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${esc(codeChallengeMethod)}">
<input type="hidden" name="state" value="${esc(state)}">
<input type="hidden" name="scope" value="${esc(scope)}">
<input type="password" name="passphrase" placeholder="Passphrase" autofocus autocomplete="current-password">
<button type="submit" name="btn">Approve</button>
</form>
</body></html>`);
    return;
  }

  if (!safeEqual(q.get('passphrase'), passphrase)) {
    logSecurity(`wrong passphrase from ${clientKey(req)}`);
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Wrong passphrase', "That passphrase didn't match."));
    return;
  }
  const code = randomBytes(24).toString('hex');
  addAuthCode(code, { clientId, redirectUri, codeChallenge, scope, expires: Date.now() + CODE_TTL_MS });
  const redirect = new URL(redirectUri);
  const firstApproval = client.isStatic ? !loadOrCreateClient().approvedAt : !client.approvedAt;
  updateClientRecord(client, { approvedAt: Date.now(), ...callerFields(req) });
  logSecurity(`client approved: ${clientDisplayName(client)} (${redirect.host})${firstApproval ? ' — first approval' : ''}`);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('iss', origin);
  if (state) redirect.searchParams.set('state', state);
  res.writeHead(302, { Location: redirect.toString() });
  res.end();
}

function addAuthCode(code, entry) {
  const now = Date.now();
  for (const [key, held] of authCodes) if (held.expires < now) authCodes.delete(key);
  authCodes.set(code, entry);
}

// RFC 6749 2.3.1: credentials come from a Basic header when one is sent (each half form-decoded), else from the body. A malformed header never falls back to the body.
function credentialsFrom(req, body) {
  const header = req.headers.authorization;
  if (header === undefined) return { clientId: body.get('client_id'), clientSecret: body.get('client_secret') };
  const match = typeof header === 'string' && header.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== match[1].replace(/=+$/, '')) return null;
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    const decode = (value) => decodeURIComponent(value.replace(/\+/g, ' '));
    return { clientId: decode(decoded.slice(0, colon)), clientSecret: decode(decoded.slice(colon + 1)) };
  } catch {
    return null;
  }
}

function authenticateClient(req, res, body) {
  const credentials = credentialsFrom(req, body);
  const client = credentials && resolveClient(credentials.clientId);
  if (client && (client.tokenEndpointAuthMethod === 'none' || (client.clientSecret && safeEqual(credentials.clientSecret, client.clientSecret)))) return client;
  if (/^Basic(?:\s|$)/i.test(req.headers.authorization || '')) res.setHeader('WWW-Authenticate', 'Basic realm="aki-mcp-sv"');
  return null;
}

export async function handleToken(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = new URLSearchParams(await readBody(req, MAX_BODY_BYTES));
  const grantType = body.get('grant_type');
  const loggedGrantType = grantType === 'authorization_code' || grantType === 'refresh_token' ? grantType : 'unsupported';
  log(`[oauth] token request: grant_type=${loggedGrantType}`);

  const client = authenticateClient(req, res, body);
  if (!client) {
    log('[oauth] token FAILED: invalid_client (unknown client_id or secret mismatch)');
    return json(res, 401, { error: 'invalid_client' });
  }

  if (grantType === 'authorization_code') {
    const code = body.get('code');
    const entry = authCodes.get(code);
    if (!entry || entry.expires < Date.now()) {
      log(`[oauth] token FAILED: invalid_grant (code ${entry ? 'expired' : 'unknown'})`);
      return json(res, 400, { error: 'invalid_grant' });
    }
    authCodes.delete(code);
    if (entry.clientId !== client.clientId) {
      log('[oauth] token FAILED: invalid_grant (code was issued to a different client)');
      return json(res, 400, { error: 'invalid_grant' });
    }
    if (entry.redirectUri !== body.get('redirect_uri')) {
      log('[oauth] token FAILED: invalid_grant (redirect_uri mismatch)');
      return json(res, 400, { error: 'invalid_grant' });
    }
    const computed = createHash('sha256').update(body.get('code_verifier') || '').digest('base64url');
    if (computed !== entry.codeChallenge) {
      log('[oauth] token FAILED: invalid_grant (PKCE code_verifier mismatch)');
      return json(res, 400, { error: 'invalid_grant' });
    }
    return issueTokens(req, res, client, undefined, 'authorization_code', entry.scope);
  }

  if (grantType === 'refresh_token') {
    const entry = refreshTokens.get(body.get('refresh_token'));
    if (!entry || entry.clientId !== client.clientId) {
      log(`[oauth] token FAILED: invalid_grant (${entry ? 'refresh_token belongs to another client' : 'unknown refresh_token — stale after tokens file reset?'})`);
      return json(res, 400, { error: 'invalid_grant' });
    }
    // Scope never widens: a refresh may only ask for parts the grant already holds.
    const stored = entry.scope || '';
    const asked = body.has('scope') ? body.get('scope').trim() : stored;
    const held = new Set(stored.split(' ').filter(Boolean));
    if (asked.split(' ').some((part) => part && !held.has(part))) return json(res, 400, { error: 'invalid_scope' });
    return issueTokens(req, res, client, body.get('refresh_token'), 'refresh_token', asked);
  }

  log(`[oauth] token FAILED: unsupported_grant_type (${loggedGrantType})`);
  return json(res, 400, { error: 'unsupported_grant_type' });
}

// RFC 7009. Every client shares one access token, so revoking it here would sign every other client out:
// a revoke only ends the calling client's own refresh grant, and the shared token keeps working until the panel rolls it.
export async function handleRevoke(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = new URLSearchParams(await readBody(req, MAX_BODY_BYTES));
  const client = authenticateClient(req, res, body);
  if (!client) {
    log('[oauth] revoke FAILED: invalid_client (unknown client_id or secret mismatch)');
    return json(res, 401, { error: 'invalid_client' });
  }
  const token = body.get('token');
  if (!token) return json(res, 400, { error: 'invalid_request' });
  const refresh = refreshTokens.get(token);
  const signsOut = refresh ? refresh.clientId === client.clientId : accessTokens.has(token);
  if (signsOut && dropRefreshTokens((entry) => entry.clientId === client.clientId && (!refresh || entry === refresh))) {
    saveTokens();
    logSecurity(`client signed out by its own revoke: ${clientDisplayName(client)}`);
  }
  // Same answer for every token, owned or not, so a revoke never tells a caller whether a token exists.
  return json(res, 200, {});
}

// The one place an access token is created: every grant and the panel share it, so `accessTokens` never holds more than one entry.
export function getOrIssueAccessToken(via = 'panel') {
  for (const [token, entry] of accessTokens) {
    if (entry.expires >= Date.now()) return token;
  }
  accessTokens.clear();
  const token = randomBytes(32).toString('hex');
  accessTokens.set(token, { expires: Date.now() + ACCESS_TTL_S * 1000 });
  saveTokens();
  log(`[oauth] access token ISSUED via ${via}`);
  return token;
}

// Soft roll leaves refresh tokens alone, so it does not evict a holder of a leaked one; `revokeRefresh` signs every client out.
export function rotateAccessToken({ revokeRefresh = false } = {}) {
  accessTokens.clear();
  if (revokeRefresh) refreshTokens.clear();
  return getOrIssueAccessToken(revokeRefresh ? 'hard roll' : 'roll');
}

function issueTokens(req, res, client, existingRefresh, via, scope = '') {
  const accessToken = getOrIssueAccessToken(via);
  const refreshToken = existingRefresh || randomBytes(32).toString('hex');
  const record = refreshTokens.get(refreshToken);
  if (!existingRefresh || (record.scope || '') !== scope) {
    refreshTokens.set(refreshToken, scope ? { clientId: client.clientId, scope } : { clientId: client.clientId });
    saveTokens();
  }
  updateClientRecord(client, { tokenAt: Date.now(), ...callerFields(req) });
  logSecurity(`token granted (${cut(via)}) to ${clientDisplayName(client)}`);
  const expiresIn = Math.floor((accessTokens.get(accessToken).expires - Date.now()) / 1000);
  json(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refreshToken, ...(scope ? { scope } : {}) });
}

export function verifyBearer(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const entry = accessTokens.get(authHeader.slice(7));
  return !!entry && entry.expires >= Date.now();
}
