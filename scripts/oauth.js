#!/usr/bin/env node
// Minimal OAuth 2.1 authorization server.
// Claude: pre-registered confidential client (paste Client ID/Secret), or DCR if it self-registers.
// ChatGPT: RFC 7591 DCR + public client (token_endpoint_auth_method: none) + chatgpt.com redirect URIs.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import {
  CLIENT_PATH as CLIENT_FILE,
  DCR_CLIENTS_PATH as DCR_FILE,
  PASSPHRASE_PATH as PASSPHRASE_FILE,
  TOKENS_PATH as TOKENS_FILE,
} from './userdata.js';
import { log } from './log.js';
import { readBody, json as httpJson } from './http.js';
import { esc } from './html.js';

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT_LEGACY_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_CALLBACK_PREFIX = 'https://chatgpt.com/connector/oauth/';
// Gemini custom connected apps redirect through Google's OAuth proxy, not a gemini.google.com path — observed live 2026-08-09:
// redirect_uri=https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<numeric>-<host-with-underscores>
const GEMINI_CALLBACK_PREFIX = 'https://oauth-redirect.googleusercontent.com/r/';
// Grok self-registers (DCR) with this callback — observed live 2026-08-09 from the register-REJECTED log:
// redirect_uris=["https://grok.com/connectors-oauth-exchange-code/"]. Note: NOT a /connector/oauth/ path.
const GROK_CALLBACK_PREFIX = 'https://grok.com/connectors-oauth-exchange-code/';
const NOTION_CALLBACK_HOSTS = ['notion.so', 'www.notion.so', 'app.notion.so',
  'notion.com', 'www.notion.com', 'app.notion.com', 'mcp.notion.com'];
const CLIENT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 365 * 24 * 3600;
// no 0/o/1/l/i — avoid visual ambiguity when typing; 32 chars = power of 2, unbiased byte%32
const PASSPHRASE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSPHRASE_LENGTH = 10; // 32^10 = 2^50 — brute-force still infeasible over network
// Display-only, to avoid leaking the OS username on a page reachable pre-passphrase; the file read below still uses PASSPHRASE_FILE.
const PASSPHRASE_DISPLAY_PATH = PASSPHRASE_FILE.replace(os.homedir(), '~');

const authCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();

function isAllowedRedirect(uri) {
  if (typeof uri !== 'string' || !uri) return false;
  if (uri === CLAUDE_CALLBACK || uri === CHATGPT_LEGACY_CALLBACK) return true;
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:' && !uri.includes('#') && !url.username && !url.password
      && NOTION_CALLBACK_HOSTS.includes(url.hostname)) return true;
  } catch {
    return false;
  }
  return uri.startsWith(CHATGPT_CALLBACK_PREFIX)
    || uri.startsWith(GROK_CALLBACK_PREFIX)
    || uri.startsWith(GEMINI_CALLBACK_PREFIX);
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
  }
}

function saveTokens() {
  const now = Date.now();
  for (const [token, entry] of accessTokens) if (entry.expires < now) accessTokens.delete(token);
  const body = { access: Object.fromEntries(accessTokens), refresh: Object.fromEntries(refreshTokens) };
  writeFileSync(TOKENS_FILE, JSON.stringify(body), { mode: 0o600 });
}

loadTokens();

export function loadOrCreateClient() {
  if (existsSync(CLIENT_FILE)) return JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
  const creds = { clientId: randomBytes(16).toString('hex'), clientSecret: randomBytes(32).toString('hex') };
  writeFileSync(CLIENT_FILE, JSON.stringify(creds), { mode: 0o600 });
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
  writeFileSync(DCR_FILE, JSON.stringify(map, null, 2), { mode: 0o600 });
}

/** Static Claude client + any clients ChatGPT (or Claude) registered via /register. */
function resolveClient(clientId) {
  if (!clientId) return null;
  const staticClient = loadOrCreateClient();
  if (clientId === staticClient.clientId) {
    // The confidential client's ID/secret are deliberately pasted into more than one provider (Claude,
    // and Gemini which reuses the same paste flow). Each provider sends its own redirect_uri, so this
    // client accepts any allowlisted callback (isStatic below), not just CLAUDE_CALLBACK — the allowlist
    // (isAllowedRedirect) is the security boundary, the same one /register enforces for public clients.
    return {
      clientId: staticClient.clientId,
      clientSecret: staticClient.clientSecret,
      redirectUris: [CLAUDE_CALLBACK],
      isStatic: true,
      tokenEndpointAuthMethod: 'client_secret_post',
    };
  }
  const registry = loadDcrClients();
  return Object.hasOwn(registry, clientId) ? registry[clientId] : null;
}

export function loadOrCreatePassphrase() {
  if (existsSync(PASSPHRASE_FILE)) return readFileSync(PASSPHRASE_FILE, 'utf8').trim();
  const bytes = randomBytes(PASSPHRASE_LENGTH);
  const p = Array.from(bytes, (b) => PASSPHRASE_ALPHABET[b % PASSPHRASE_ALPHABET.length]).join('');
  writeFileSync(PASSPHRASE_FILE, p, { mode: 0o600 });
  return p;
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
        revocation_endpoint: `${origin}/revoke`,
        registration_endpoint: `${origin}/register`,
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
    body = JSON.parse(await readBody(req) || '{}');
  } catch {
    return json(res, 400, { error: 'invalid_client_metadata' });
  }
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every(isAllowedRedirect)) {
    // Keep the unknown callback's origin discoverable without logging userinfo, paths, or query credentials.
    const origins = Array.isArray(redirectUris) ? redirectUris.map((uri) => {
      try { return new URL(uri).origin; } catch { return '(invalid URL)'; }
    }) : [];
    log(`[oauth] register REJECTED (redirect_uri not allowlisted): ${JSON.stringify(origins)}`);
    return json(res, 400, { error: 'invalid_redirect_uri' });
  }
  const authMethod = body.token_endpoint_auth_method === undefined ? 'none' : body.token_endpoint_auth_method;
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
    clientName: typeof body.client_name === 'string' ? body.client_name : 'MCP client',
  };
  const map = loadDcrClients();
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
  const q = req.method === 'GET' ? url.searchParams : new URLSearchParams(await readBody(req));
  const redirectUri = q.get('redirect_uri');
  const clientId = q.get('client_id');
  const codeChallenge = q.get('code_challenge');
  const codeChallengeMethod = q.get('code_challenge_method');
  const state = q.get('state') || '';
  const scope = (q.get('scope') || '').trim();
  const client = resolveClient(clientId);
  // DCR clients are pinned to the exact redirect_uri they registered; the shared confidential client (isStatic)
  // accepts any allowlisted callback, since it is pasted into several providers each with its own redirect.
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
    log('[oauth] authorize POST: WRONG passphrase');
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Wrong passphrase', "That passphrase didn't match."));
    return;
  }
  const code = randomBytes(24).toString('hex');
  authCodes.set(code, { clientId, redirectUri, codeChallenge, scope, expires: Date.now() + CODE_TTL_MS });
  log(`[oauth] authorize approved -> code issued (state=${state ? 'yes' : 'no'}), redirecting to ${new URL(redirectUri).host}`);
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('iss', origin);
  if (state) redirect.searchParams.set('state', state);
  res.writeHead(302, { Location: redirect.toString() });
  res.end();
}

function credentialsFrom(req, body) {
  const header = req.headers.authorization;
  if (header === undefined) {
    return { clientId: body.get('client_id'), clientSecret: body.get('client_secret') };
  }
  const match = typeof header === 'string' && header.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  try {
    const encoded = match[1];
    if (encoded.includes('=') && encoded.length % 4 !== 0) return null;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;
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
  if (client && (client.tokenEndpointAuthMethod === 'none'
    || (client.clientSecret && safeEqual(credentials.clientSecret, client.clientSecret)))) return client;
  if (/^Basic(?:\s|$)/i.test(req.headers.authorization || '')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="aki-mcp-sv"');
  }
  json(res, 401, { error: 'invalid_client' });
  return null;
}

export async function handleToken(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = new URLSearchParams(await readBody(req));
  const grantType = body.get('grant_type');
  const loggedGrantType = grantType === 'authorization_code' || grantType === 'refresh_token' ? grantType : 'unsupported';
  log(`[oauth] token request: grant_type=${loggedGrantType}`);

  const client = authenticateClient(req, res, body);
  if (!client) {
    log('[oauth] token FAILED: invalid_client (unknown client_id or secret mismatch)');
    return;
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
    return issueTokens(res, entry.clientId, undefined, 'authorization_code', entry.scope);
  }

  if (grantType === 'refresh_token') {
    const entry = refreshTokens.get(body.get('refresh_token'));
    if (!entry || entry.clientId !== client.clientId) {
      log(`[oauth] token FAILED: invalid_grant (${entry ? 'refresh_token belongs to another client' : 'unknown refresh_token — stale after tokens file reset?'})`);
      return json(res, 400, { error: 'invalid_grant' });
    }
    // A grant issued before scope existed carries no `scope` property, which is not the same as one that
    // was explicitly narrowed to nothing. Narrowing cannot apply to a grant that was never scoped, and
    // reading its absent scope as empty would turn every refresh that still sends `scope` into
    // invalid_scope on upgrade. Such a grant stays unscoped until the client first asks for a scope.
    const unscopedGrant = !Object.hasOwn(entry, 'scope');
    const scope = body.has('scope') ? body.get('scope').trim() : entry.scope || '';
    const storedScope = new Set((entry.scope || '').split(' ').filter(Boolean));
    if (!unscopedGrant && scope.split(' ').some((part) => part && !storedScope.has(part))) {
      return json(res, 400, { error: 'invalid_scope' });
    }
    const recorded = unscopedGrant && !body.has('scope') ? undefined : scope;
    return issueTokens(res, entry.clientId, body.get('refresh_token'), 'refresh_token', recorded);
  }

  log(`[oauth] token FAILED: unsupported_grant_type (${loggedGrantType})`);
  return json(res, 400, { error: 'unsupported_grant_type' });
}

export async function handleRevoke(req, res) {
  const body = new URLSearchParams(await readBody(req));
  const client = authenticateClient(req, res, body);
  if (!client) return;
  const token = body.get('token');
  if (!token) return json(res, 400, { error: 'invalid_request' });
  const refresh = refreshTokens.get(token);
  if (refresh) {
    if (!Object.hasOwn(refresh, 'clientId') || refresh.clientId === client.clientId) {
      refreshTokens.delete(token);
      for (const [accessToken, entry] of accessTokens) {
        if (entry.refreshToken === token && entry.clientId === client.clientId) accessTokens.delete(accessToken);
      }
    }
  } else {
    const access = accessTokens.get(token);
    if (access && (!Object.hasOwn(access, 'clientId') || access.clientId === client.clientId)) accessTokens.delete(token);
  }
  saveTokens();
  return json(res, 200, {});
}

// `scope === undefined` means the grant has never carried a scope, and the record keeps no `scope` key
// so a later refresh can still be told apart from one deliberately narrowed to nothing.
function mintTokens(clientId, existingRefresh, via, scope = '', local = false) {
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = existingRefresh || randomBytes(32).toString('hex');
  accessTokens.set(accessToken, { clientId, refreshToken, expires: Date.now() + ACCESS_TTL_S * 1000, ...(local ? { local: true } : {}) });
  refreshTokens.set(refreshToken, scope === undefined ? { clientId } : { clientId, scope });
  saveTokens();
  log(`[oauth] tokens ISSUED via ${via} (access + refresh) — client is now authorized`);
  return { accessToken, refreshToken };
}

function issueTokens(res, clientId, existingRefresh, via, scope = '') {
  const { accessToken, refreshToken } = mintTokens(clientId, existingRefresh, via, scope);
  const body = { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refreshToken };
  if (scope) body.scope = scope;
  json(res, 200, body);
}

// The panel prints this token into local client configurations (Postman, Cursor, Claude Code...).
// Reusing whichever access token happened to be unexpired meant a remote connector's token could end up
// pasted locally, and that connector revoking its grant would silently break every local config. Panel
// tokens are therefore minted and reused on their own marker, never shared with a connector's grant.
export function getOrIssueAccessToken() {
  const now = Date.now();
  for (const [token, entry] of accessTokens) {
    if (entry.local && entry.expires >= now) return token;
  }
  return mintTokens(loadOrCreateClient().clientId, undefined, 'panel', '', true).accessToken;
}

export function verifyBearer(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) {
    log('[oauth] bearer check FAILED: no/invalid Authorization header');
    return false;
  }
  const entry = accessTokens.get(authHeader.slice(7));
  if (!entry) {
    log('[oauth] bearer check FAILED: token not recognized (stale after tokens file reset / restart?)');
    return false;
  }
  if (entry.expires < Date.now()) {
    log('[oauth] bearer check FAILED: token expired');
    return false;
  }
  return true;
}
