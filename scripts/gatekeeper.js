// Public entry: OAuth AS (Claude pre-registered + ChatGPT DCR) + Streamable HTTP /mcp via streamable-bridge.
// Runs in-process inside start.js (docs/plan/done/consolidate-mcp-tool-processes.md, Part B): startGatekeeper() returns the http.Server so the orchestrator can close it on shutdown.
import http from 'node:http';
import { loadOrCreatePassphrase, metadataHandlers, handleAuthorize, handleToken, handleRegister, handleRevoke, verifyBearer } from './oauth.js';
import { handleStreamableMcp, terminateSession } from './streamable-bridge.js';
import { log, logErr } from './log.js';
import { serveStatic } from './http.js';

const STATIC_ALIASES = { '/favicon.ico': '/favicon/favicon.ico' };

// origin: the public https origin (Tailscale MagicDNS / Cloudflare) or null. Local-First: the /mcp engine binds
// 127.0.0.1 and serves local clients with or without a public ingress; OAuth discovery metadata only exists once
// an ingress is attached. onFatal: called if the listen socket errors, so the orchestrator tears the whole stack
// down instead of leaking an orphaned hub.
export function startGatekeeper(origin = null, onFatal) {
  const port = Number(process.env.GATEKEEPER_PORT || 9999);
  const passphrase = loadOrCreatePassphrase();
  // Public OAuth routes answer 503 without ingress; metadata handlers are closures behind the same guard.
  // A runtime attach-after-boot path is intentionally not built yet — ingress is resolved at boot in start.js,
  // so a newly-saved ingress applies on restart.
  const meta = metadataHandlers(origin);
  const authorize = (req, res) => handleAuthorize(req, res, passphrase, origin);
  const oauthRoutes = new Map([
    ['GET /.well-known/oauth-protected-resource', meta.protectedResource],
    ['GET /.well-known/oauth-protected-resource/mcp', meta.protectedResource],
    ['GET /.well-known/oauth-authorization-server', meta.authorizationServer],
    ['GET /.well-known/oauth-authorization-server/mcp', meta.authorizationServer],
    ['GET /.well-known/openid-configuration', meta.authorizationServer],
    ['GET /.well-known/openid-configuration/mcp', meta.authorizationServer],
    ['POST /register', handleRegister],
    ['GET /authorize', authorize],
    ['POST /authorize', authorize],
    ['POST /token', handleToken],
    ['POST /revoke', handleRevoke],
  ]);

  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    const t0 = Date.now();
    res.on('finish', () => log(`[gatekeeper] ${req.method} ${path} -> ${res.statusCode} ${Date.now() - t0}ms`));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // OAuth discovery + authorize are only meaningful with a public ingress (web clients). Local clients send the
    // Bearer token straight to /mcp and never touch these, so return 503 (not 404) when ingress is off.
    const h = oauthRoutes.get(`${req.method} ${path}`);
    if (h) {
      if (!origin) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Remote ingress not configured — local MCP is active at /mcp'); }
      return h(req, res);
    }

    if (path === '/mcp') {
      if (!verifyBearer(req.headers.authorization)) {
        // Advertise the OAuth resource metadata only when an ingress is attached; on pure loopback emit a bare
        // Bearer challenge instead of a bogus "null/.well-known/..." URL.
        res.writeHead(401, {
          'Content-Type': 'text/plain',
          'WWW-Authenticate': origin ? `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` : 'Bearer',
        });
        res.end('unauthorized');
        return;
      }
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
