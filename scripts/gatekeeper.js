// Public entry: OAuth AS (Claude pre-registered + ChatGPT DCR) + Streamable HTTP /mcp via streamable-bridge.
// Runs in-process inside start.js (docs/plan/done/consolidate-mcp-tool-processes.md, Part B): startGatekeeper() returns the http.Server so the orchestrator can close it on shutdown.
import http from 'node:http';
import { loadOrCreatePassphrase, metadataHandlers, handleAuthorize, handleToken, handleRegister, handleRevoke, verifyBearer } from './oauth.js';
import { handleStreamableMcp, terminateSession } from './streamable-bridge.js';
import { log, logErr } from './log.js';
import { serveStatic } from './http.js';
import { recordCaller } from './callers.js';
import { logSecurity } from './security-log.js';
import { failures, registrations, clientKey } from './rate-limit.js';

const STATIC_ALIASES = { '/favicon.ico': '/favicon/favicon.ico' };
// Only a rejected credential counts: protocol errors and unknown paths happen during normal connects and must never lock the owner out.
const FAILURE_STATUS = 401;
const OAUTH_PATHS = /^(\/\.well-known\/|\/authorize$|\/token$|\/revoke$)/;

function refuse(res, retryAfterSeconds) {
  res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': String(retryAfterSeconds) });
  res.end('too many failed attempts, try again later');
}

// origin: the public https origin (Tailscale MagicDNS / Cloudflare) or null. Local-First: the /mcp engine binds
// 127.0.0.1 and serves local clients with or without a public ingress; OAuth discovery metadata only exists once
// an ingress is attached. onFatal: called if the listen socket errors, so the orchestrator tears the whole stack
// down instead of leaking an orphaned hub.
export function startGatekeeper(origin = null, onFatal) {
  const port = Number(process.env.GATEKEEPER_PORT || 9999);
  loadOrCreatePassphrase();
  // Public OAuth discovery metadata only exists when an ingress is attached; on pure loopback it stays null and the
  // .well-known / authorize / register / token routes answer 503. A runtime attach-after-boot path (updating this)
  // is intentionally not built yet — ingress is resolved at boot in start.js, so a newly-saved ingress applies on restart.
  const meta = origin ? metadataHandlers(origin) : null;
  const recordFailure = (key) => {
    if (failures.record(key)) logSecurity(`caller ${key} blocked after repeated failed attempts`);
  };

  const route = async (req, res) => {
    const path = (req.url || '').split('?')[0];
    const t0 = Date.now();
    const isSecurityAccess = () => OAUTH_PATHS.test(path) || res.statusCode >= 500;
    res.on('finish', () => { if (isSecurityAccess()) log(`[gatekeeper] ${req.method} ${path} -> ${res.statusCode} ${Date.now() - t0}ms`); });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const key = clientKey(req);
    if (path !== '/mcp') {
      const wait = failures.retryAfterSeconds(key);
      if (wait) return refuse(res, wait);
      res.on('finish', () => { if (res.statusCode === FAILURE_STATUS) recordFailure(key); });
    }

    // OAuth discovery + authorize are only meaningful with a public ingress (web clients). Local clients send the
    // Bearer token straight to /mcp and never touch these, so return 503 (not 404) when ingress is off.
    if ((path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') && req.method === 'GET') {
      if (!meta) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return meta.protectedResource(req, res);
    }
    if ((path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp' || path === '/.well-known/openid-configuration' || path === '/.well-known/openid-configuration/mcp') && req.method === 'GET') {
      if (!meta) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return meta.authorizationServer(req, res);
    }
    if (path === '/register' && req.method === 'POST') {
      if (!origin) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      const wait = registrations.retryAfterSeconds(key);
      if (wait) return refuse(res, wait);
      registrations.record(key);
      return handleRegister(req, res);
    }
    if (path === '/authorize' && (req.method === 'GET' || req.method === 'POST')) {
      if (!origin) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return handleAuthorize(req, res, loadOrCreatePassphrase(), origin);
    }
    if (path === '/token' && req.method === 'POST') {
      if (!origin) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return handleToken(req, res);
    }
    if (path === '/revoke' && req.method === 'POST') {
      if (!origin) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return handleRevoke(req, res);
    }

    if (path === '/mcp') {
      if (!verifyBearer(req.headers.authorization)) {
        const wait = failures.retryAfterSeconds(key);
        if (wait) return refuse(res, wait);
        logSecurity(`/mcp rejected bearer from ${key}`);
        recordFailure(key);
        // Advertise the OAuth resource metadata only when an ingress is attached; on pure loopback emit a bare
        // Bearer challenge instead of a bogus "null/.well-known/..." URL.
        res.writeHead(401, {
          'Content-Type': 'text/plain',
          'WWW-Authenticate': origin ? `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` : 'Bearer',
        });
        res.end('unauthorized');
        return;
      }
      const agent = req.headers['user-agent'] || 'no user-agent';
      if (recordCaller(key, agent)) logSecurity(`token used by new caller ${key} (${agent.slice(0, 64)})`);
      if (req.method === 'POST') return handleStreamableMcp(req, res);
      if (req.method === 'DELETE') {
        const sid = req.headers['mcp-session-id'];
        if (sid) terminateSession(sid);
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'POST, DELETE' });
      return res.end('server push not supported');
    }

    if (req.method === 'GET' && await serveStatic(res, path, STATIC_ALIASES)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };

  // A request that fails (body aborted mid-upload, body over the cap, a handler bug) ends that request only: an unhandled rejection here would end the process for every connected client.
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e.statusCode || 500;
      if (status === 500) logErr(`[gatekeeper] ${req.method} ${(req.url || '').split('?')[0]} failed: ${e.message}`);
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end(status === 500 ? 'internal error' : e.message);
    });
  });

  server.on('error', (e) => {
    logErr(`[gatekeeper] failed to listen on :${port}: ${e.message}${e.code === 'EADDRINUSE' ? ' — another akimcp instance is probably still running; stop it first' : ''}`);
    onFatal?.();
  });
  server.listen(port, '127.0.0.1', () => {
    log(`[gatekeeper] listening on 127.0.0.1:${port} (Local-First MCP engine active)`);
    if (origin) log(`[gatekeeper] public ingress attached: ${origin}`);
  });

  return server;
}
