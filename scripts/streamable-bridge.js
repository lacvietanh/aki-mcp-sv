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

// The single internal session; null until the first external `initialize` boots it. Nothing in the
// new in-process transport can independently die the way an upstream SSE socket could, so this only
// ever resets via close()/onclose below — kept as defensive insurance, not an expected runtime path.
let shared = null;
let sharedBoot = null; // in-flight boot promise — collapses concurrent first-initializes onto one session
let nextUpstreamId = 1; // globally-unique id per forwarded request; the remap that lets clients share one session
const externalIds = new Set(); // minted external session ids, for protocol-correct 404-on-stale (re-init is now cheap)

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
    externalIds.add(extId);
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

  // The client's own `notifications/initialized` is redundant — the shared session was initialized once at boot.
  if (method === 'notifications/initialized') {
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
  const started = Date.now();
  try {
    const response = await requestUpstream(shared.session, { ...message, id: nextUpstreamId++ });
    response.id = origId;
    if (method === 'tools/call') {
      // The SDK reports invalid arguments either as a JSON-RPC error or as an isError result whose text starts with the code, depending on its version.
      if (response.error?.code === -32602 && typeof response.error.message === 'string') response.error.message += STALE_SCHEMA_HINT;
      const first = response.result?.isError ? response.result.content?.[0] : null;
      if (first?.type === 'text' && first.text.includes('-32602')) first.text += STALE_SCHEMA_HINT;
      if (isLoggedTool(message.params?.name)) logToolCall({ sessionId: externalSessionId, agent: req.headers['user-agent'], params: message.params, response, ms: Date.now() - started });
    }
    return jsonResponse(res, 200, response);
  } catch (e) {
    return jsonResponse(res, 504, { jsonrpc: '2.0', error: { code: -32000, message: e.message }, id: origId });
  }
}

export function terminateSession(externalSessionId) {
  // One client leaving never tears down the shared session — the others still multiplex onto it.
  externalIds.delete(externalSessionId);
}
