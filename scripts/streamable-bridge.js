#!/usr/bin/env node
// Streamable HTTP shim: bridges POST /mcp directly to the in-process tools McpServer over the SDK's
// InMemoryTransport — no more separate mcp-hub process or SSE handshake (docs/plan/done/2.0.0-improve.md
// #7, Stage 2 phase 2). One shared internal session for the whole process, same as before the
// collapse: rationale in docs/plan/done/bridge-session-churn.md (Option B) and CLAUDE.md § Session
// lifecycle — claude.ai re-sends `initialize` with no session id roughly every ~10s per conversation,
// so every external "session" multiplexes onto one real MCP session, answered from a local cache.
import { randomBytes } from 'node:crypto';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { log } from './log.js';
import { readBody, json as jsonResponse } from './http.js';
import { createToolsServer } from './tools-server.js';
import { isLoggedTool, logToolCall } from './tool-call-log.js';
import { VERSION } from './version.js';

// A client that cached an older tools/list sends ops or fields this server no longer (or not yet) has; the SDK's -32602 then reads like the caller's typo. Name the likely cause once, here, for every tool.
const STALE_SCHEMA_HINT = ` (akimcp ${VERSION}: if the tool description lists what you sent, your client's tool schema is stale; reconnect AkiMCP or start a new chat)`;
// Only an argument this server's schema takes can point at a stale client schema (a value or op it lacks); an argument it does not take is the caller's own wrong name, so the hint names the arguments instead.
async function invalidArgsHint(session, params) {
  let properties = null;
  try {
    const list = await requestUpstream(session, { jsonrpc: '2.0', id: nextUpstreamId++, method: 'tools/list', params: {} });
    properties = list.result?.tools?.find((t) => t.name === params?.name)?.inputSchema?.properties ?? null;
  } catch {}
  if (!properties) return STALE_SCHEMA_HINT;
  const unknown = Object.keys(params?.arguments ?? {}).filter((k) => !Object.hasOwn(properties, k));
  return unknown.length ? ` (akimcp ${VERSION}: ${params.name} takes no ${unknown.join(', ')}; its arguments are ${Object.keys(properties).join(', ')})` : STALE_SCHEMA_HINT;
}

// The single internal session; null until the first external `initialize` boots it. Nothing in the
// new in-process transport can independently die the way an upstream SSE socket could, so this only
// ever resets via close()/onclose below — kept as defensive insurance, not an expected runtime path.
let shared = null;
let sharedBoot = null; // in-flight boot promise — collapses concurrent first-initializes onto one session
let nextUpstreamId = 1; // globally-unique id per forwarded request; the remap that lets clients share one session
// Minted external session ids, for protocol-correct 404-on-stale. claude.ai mints a new one every ~10 s per conversation and never returns the old ones, so the set keeps the most recently used and drops the rest; a dropped id gets a 404 and its client re-initializes, which is cheap.
const externalIds = new Set();
const MAX_EXTERNAL_IDS = 2000;
// A client's request id → the upstream id it was remapped to, while the request is in flight: what a client's cancel notice has to name.
const inFlight = new Map();
const inFlightKey = (externalSessionId, id) => `${externalSessionId}:${JSON.stringify(id)}`;

function rememberExternalId(id) {
  externalIds.delete(id);
  externalIds.add(id);
  if (externalIds.size > MAX_EXTERNAL_IDS) externalIds.delete(externalIds.values().next().value);
}

function routeResponse(session, message) {
  const pending = session.pending.get(message.id);
  if (pending) {
    clearTimeout(pending.timer);
    session.pending.delete(message.id);
    pending.resolve(message);
  }
}

function closeSession(session, reason = 'unspecified') {
  for (const { reject, timer } of session.pending.values()) {
    clearTimeout(timer);
    reject(new Error('tools server session closed'));
  }
  session.pending.clear();
  if (shared?.session === session) {
    shared = null;
    externalIds.clear();
  }
  log(`[bridge] shared tools-server session closed (${reason})`);
}

async function openInternalSession() {
  const server = createToolsServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const session = { transport: clientTransport, pending: new Map() };
  clientTransport.onmessage = (message) => routeResponse(session, message);
  clientTransport.onclose = () => closeSession(session, 'transport closed');
  await server.connect(serverTransport);
  await clientTransport.start();
  return session;
}

function postMessage(session, message) {
  return session.transport.send(message);
}

// Forward one request over `session` and await its matching response by id. `message.id` must already be a unique upstream id. Resolves with the full JSON-RPC response object.
function requestUpstream(session, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(message.id);
      log(`[bridge] request timeout (method=${message.method ?? '?'}, id=${message.id})`);
      reject(new Error('tools server response timeout'));
    }, Number(process.env.MCP_REQUEST_TIMEOUT_MS || 10 * 60 * 1000));
    session.pending.set(message.id, { resolve, reject, timer });
    postMessage(session, message).catch((e) => {
      clearTimeout(timer);
      session.pending.delete(message.id);
      reject(e);
    });
  });
}

// Boot the one shared session using the first client's initialize params (so the negotiated protocol version is whatever that real client asked for), then cache the result for every later client.
function ensureShared(initParams) {
  if (shared) return Promise.resolve(shared);
  if (sharedBoot) return sharedBoot;
  sharedBoot = (async () => {
    const session = await openInternalSession();
    const response = await requestUpstream(session, { jsonrpc: '2.0', id: nextUpstreamId++, method: 'initialize', params: initParams });
    await postMessage(session, { jsonrpc: '2.0', method: 'notifications/initialized' });
    shared = { session, initResult: response.result };
    log('[bridge] shared tools-server session opened — all external clients multiplex onto it');
    return shared;
  })();
  return sharedBoot.finally(() => {
    sharedBoot = null;
  });
}

// Called once at start.js boot: constructs a throwaway tools server so a registration-time crash
// (a bad tool schema, a broken import) surfaces immediately in the startup console, before any real
// client ever connects — the same "fail loud at boot" role mcp-hub's spawnHub() used to play.
export function warmToolsServer() {
  createToolsServer();
}

export async function handleStreamableMcp(req, res) {
  let message;
  try {
    message = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return jsonResponse(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: expected one JSON-RPC object' }, id: null });

  const method = message.method;
  const hasId = message.id !== undefined && message.id !== null;

  // initialize → answered locally; the first one boots the shared session, the rest reuse its cached result.
  if (method === 'initialize') {
    let s;
    try {
      s = await ensureShared(message.params);
    } catch (e) {
      log(`[bridge] failed to boot shared tools-server session: ${e.message}`);
      return jsonResponse(res, 502, { jsonrpc: '2.0', error: { code: -32000, message: `tools server unreachable: ${e.message}` }, id: message.id ?? null });
    }
    const extId = randomBytes(16).toString('hex');
    rememberExternalId(extId);
    return jsonResponse(
      res,
      200,
      { jsonrpc: '2.0', id: message.id, result: s.initResult },
      { 'MCP-Session-Id': extId },
    );
  }

  // Every other request must carry a session id we minted, and the shared session must still be alive.
  // Node normalizes incoming header names to lowercase, so this accepts every wire casing while rejecting duplicate/ambiguous values before they reach the shared in-process transport.
  const rawExternalSessionId = req.headers['mcp-session-id'];
  const externalSessionId = typeof rawExternalSessionId === 'string' ? rawExternalSessionId : null;
  if (!externalSessionId || !externalIds.has(externalSessionId) || !shared) {
    externalIds.delete(externalSessionId);
    log(`[bridge] 404 session not found (${(externalSessionId ?? 'none').slice(0, 8)}…, method=${method ?? '?'}) — client must re-initialize`);
    return jsonResponse(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
  }

  rememberExternalId(externalSessionId);

  // The client's own `notifications/initialized` is redundant — the shared session was initialized once at boot.
  if (method === 'notifications/initialized') {
    res.writeHead(202);
    return res.end();
  }

  // A cancel names the client's own request id, which means nothing upstream (ids are remapped) or, worse, names another client's request. Translate it, end the waiting request here, and drop a cancel that matches nothing of this client's.
  if (method === 'notifications/cancelled') {
    const upstreamId = inFlight.get(inFlightKey(externalSessionId, message.params?.requestId));
    if (upstreamId !== undefined) {
      postMessage(shared.session, { ...message, params: { ...message.params, requestId: upstreamId } }).catch((e) => log(`[bridge] cancel forward failed: ${e.message}`));
      const pending = shared.session.pending.get(upstreamId);
      if (pending) {
        clearTimeout(pending.timer);
        shared.session.pending.delete(upstreamId);
        pending.reject(new Error('request cancelled by the client'));
      }
    }
    res.writeHead(202);
    return res.end();
  }

  // Notifications (no id) are fire-and-forget over the shared session.
  if (!hasId) {
    postMessage(shared.session, message).catch((e) => log(`[bridge] notification forward failed (${method}): ${e.message}`));
    res.writeHead(202);
    return res.end();
  }

  // Real request: remap id so concurrent clients never collide on one session, forward, restore the original id.
  const origId = message.id;
  const upstreamId = nextUpstreamId++;
  const flightKey = inFlightKey(externalSessionId, origId);
  inFlight.set(flightKey, upstreamId);
  const started = Date.now();
  try {
    const response = await requestUpstream(shared.session, { ...message, id: upstreamId });
    response.id = origId;
    if (method === 'tools/call') {
      // The SDK reports invalid arguments either as a JSON-RPC error or as an isError result whose text starts with the code, depending on its version.
      const first = response.result?.isError ? response.result.content?.[0] : null;
      const asError = response.error?.code === -32602 && typeof response.error.message === 'string';
      const asResult = first?.type === 'text' && first.text.includes('-32602');
      if (asError || asResult) {
        const hint = await invalidArgsHint(shared.session, message.params);
        if (asError) response.error.message += hint;
        else first.text += hint;
      }
      if (isLoggedTool(message.params?.name)) logToolCall({ sessionId: externalSessionId, agent: req.headers['user-agent'], headerNames: Object.keys(req.headers), params: message.params, response, ms: Date.now() - started });
    }
    return jsonResponse(res, 200, response);
  } catch (e) {
    return jsonResponse(res, 504, { jsonrpc: '2.0', error: { code: -32000, message: e.message }, id: origId });
  } finally {
    if (inFlight.get(flightKey) === upstreamId) inFlight.delete(flightKey);
  }
}

export function terminateSession(externalSessionId) {
  // One client leaving never tears down the shared session — the others still multiplex onto it.
  externalIds.delete(externalSessionId);
}
