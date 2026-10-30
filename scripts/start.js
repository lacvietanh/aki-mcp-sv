#!/usr/bin/env node
// Orchestrates gatekeeper + panel + the in-process tools server behind one `npm start` / `akimcp`; foreground, manual stop/start, single Node process (docs/plan/done/2.0.0-improve.md #7).

import './cli-flags.js';
import { readFileSync, existsSync } from 'node:fs';
import { VERSION } from './version.js';

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };

// process.loadEnvFile throws ENOENT when the file is missing — swallow it so a .env is optional.
try { process.loadEnvFile?.(); } catch {}
if (existsSync('.env')) console.log('[start] loaded environment from .env');

if (process.argv.includes('--no-browser')) {
  process.env.MCP_SKIP_BROWSER_OPEN = '1';
}

import { spawn } from 'node:child_process';
import { funnelStatus, enableFunnel, bringUp } from './tailscale.js';
import { randomBytes } from 'node:crypto';
import { openBrowser } from './open-browser.js';
import { loadOrCreateClient, loadOrCreatePassphrase } from './oauth.js';
import { startGatekeeper } from './gatekeeper.js';
import { useIngress } from './rate-limit.js';
import { startPanel } from './panel.js';
import { warmToolsServer } from './streamable-bridge.js';
import { announceIdentity } from './mcp-name.js';
import { checkForUpdate, writeStatusFile, cmpSemver } from './update-check.js';
import { USER_DIR, IS_DEV, readIngressConfig } from './userdata.js';
import { killPostmanDaemon } from './postman/postman-mcp.js';
import { readLock, isPidAlive, writeLock, clearLock, killAndWait } from './instance-lock.js';

const isDev = IS_DEV;
const version = VERSION;
const customGatePort = argOf('--port');
const customPanelPort = argOf('--panel-port');

// Never fight a running instance for its ports (that produced the token-403 bug): reuse it if same version or newer, replace it if older.
const existingLock = readLock();
if (existingLock && existingLock.pid !== process.pid && isPidAlive(existingLock.pid)) {
  const runningIsOlder = !existingLock.version || cmpSemver(existingLock.version, version) < 0;
  if (!runningIsOlder) {
    const url = `http://127.0.0.1:${existingLock.panelPort}/?t=${existingLock.token}`;
    const since = existingLock.startedAt ? ` since ${new Date(existingLock.startedAt).toLocaleString()}` : '';
    console.log(existingLock.version === version
      ? `[start] akimcp v${version} is already running${since} (pid ${existingLock.pid}) — opening its panel. This copy did not start: code changed after that time is not loaded. To load it, stop the running one (Ctrl+C in its terminal, or quit the app that started it), then start again`
      : `[start] a newer akimcp v${existingLock.version} is already running${since} (pid ${existingLock.pid}) — opening its panel; to run v${version}, stop that one first`);
    if (process.argv.includes('--no-browser')) {
      console.log(`[start] panel: ${url}`);
    } else {
      try { await openBrowser(url); } catch (e) { console.error(`[start] could not open the browser (open manually: ${url}): ${e.message}`); }
    }
    process.exit(0);
  } else {
    console.log(`[start] stopping older akimcp v${existingLock.version} (pid ${existingLock.pid}) to start v${version}`);
    await killAndWait(existingLock.pid);
    clearLock();
  }
}

// AIObox spawns `akimcp --no-browser --port <n>`: --port winning is frozen in docs/plan/IMPORTANT-akimcp-aiobox-contract.md.
const gatePort = customGatePort || process.env.GATEKEEPER_PORT || (isDev ? '9997' : '9999');
const panelPort = customPanelPort || process.env.PANEL_PORT || (isDev ? '9996' : '9998');

process.env.GATEKEEPER_PORT = gatePort;
process.env.PANEL_PORT = panelPort;
const panelToken = randomBytes(16).toString('hex');

if (isDev) {
  console.log(`[start] MODE: development (ports: gate :${gatePort}, panel :${panelPort})`);
  console.log(`[start] data directory: ${USER_DIR}`);
} else {
  console.log(`[start] config & keys: ${USER_DIR}`);
}
announceIdentity();

const client = loadOrCreateClient();
const passphrase = loadOrCreatePassphrase();

// Ingress precedence: --tunnel (spawn cloudflared) > PUBLIC_ORIGIN (bring your own edge) > saved panel ingress config (picked in section 0) > Tailscale Funnel (default).
// Everything downstream keys off the single `origin`, so each mode only has to resolve that value.
const tunnelCred = argOf('--tunnel');
const tunnelOrigin = argOf('--origin')?.replace(/\/+$/, '') || null;
const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '') || null;
const savedIngress = !tunnelCred && !publicOrigin ? readIngressConfig() : null;
const cloudflaredCredPath = tunnelCred || savedIngress?.credPath;

let origin;
let ingressMode;
if (tunnelCred) {
  if (!tunnelOrigin) {
    console.error('[start] --tunnel <cred.json> needs --origin https://your-host — the credentials file carries no hostname');
    process.exit(1);
  }
  origin = tunnelOrigin;
  ingressMode = 'cloudflared';
  console.log(`[start] Cloudflare tunnel mode — cloudflared will serve ${origin}`);
} else if (publicOrigin) {
  origin = publicOrigin;
  ingressMode = 'public-origin';
  console.log(`[start] PUBLIC_ORIGIN set — skipping Tailscale, serving at ${origin}`);
} else if (savedIngress?.mode === 'cloudflared' && savedIngress.credPath && savedIngress.origin) {
  origin = savedIngress.origin;
  ingressMode = 'cloudflared';
  console.log(`[start] using ingress picked in the panel (section 0) — cloudflared will serve ${origin}`);
} else {
  ingressMode = 'funnel';
  let tailscale = await funnelStatus(gatePort);
  if (!tailscale.installed) {
    console.warn('[start] `tailscale` CLI not found — configure ingress in the web panel below');
  } else if (isDev) {
    if (!tailscale.funnel) console.warn('[start] dev mode leaves Tailscale Funnel to the main instance (it serves another port or none); for a public dev URL use --tunnel <cred.json> --origin <url> or PUBLIC_ORIGIN');
  } else {
    if (!tailscale.running) {
      const { ok, out } = await bringUp();
      console[ok ? 'log' : 'error'](`[start] tailscale was stopped, starting it: ${ok ? 'done' : out.trim()}`);
      tailscale = await funnelStatus(gatePort);
    }
    if (tailscale.running && !tailscale.funnel) {
      const { ok, out } = await enableFunnel(gatePort);
      console[ok ? 'log' : 'error'](`[start] enabling funnel ${gatePort}: ${ok ? 'done' : out.trim()}`);
    }
  }
  origin = tailscale.host && (!isDev || tailscale.funnel) ? `https://${tailscale.host}` : null;
  if (!origin && !isDev) console.warn('[start] Tailscale Funnel host not available — configure ingress in the web panel below');
}

if (origin) {
  console.log(`[start] Remote MCP server URL: ${origin}/mcp`);
  console.log(`[start] OAuth Client ID: ${client.clientId}`);
  console.log(`[start] OAuth Client Secret: ${client.clientSecret}`);
  console.log('[start] Client ID/Secret above are for a client that wants a static pair; web AIs that sign in with OAuth (the panel connector tabs say which) need only the URL and the passphrase');
  console.log(`[start] Passphrase (enter it when the browser opens the confirmation page): ${passphrase}`);
}

// One check per `npm start`; own version stays on top, then the rule corpus. Never blocks boot.
const updateInfo = await checkForUpdate();
writeStatusFile(updateInfo);
const bar = (s) => console.log(`\x1b[43m\x1b[30m ${s} \x1b[0m`);
if (updateInfo.mcp.updateAvailable) bar(`[update] @akinet/akimcp ${updateInfo.mcp.current} → ${updateInfo.mcp.latest} — run \`npm i -g @akinet/akimcp\` or pull & restart`);
if (updateInfo.rule.updateAvailable) bar(`[update] akidevrule ${updateInfo.rule.current} → ${updateInfo.rule.latest} — update in panel`);

let panel;
let cloudflared = null;
let shuttingDown = false;

function spawnCloudflared(credPath) {
  let tunnelId;
  try {
    tunnelId = JSON.parse(readFileSync(credPath, 'utf8')).TunnelID;
  } catch (e) {
    console.error(`[start] cannot read tunnel credentials at ${credPath}: ${e.message}`);
    return shutdown(1);
  }
  if (!tunnelId) {
    console.error(`[start] ${credPath} has no TunnelID — not a cloudflared credentials file`);
    return shutdown(1);
  }
  // Single-service run without a config file: --url stands in for the yml `ingress` rule, port fixed to the gatekeeper.
  const child = spawn('cloudflared', ['tunnel', 'run', '--cred-file', credPath, '--url', `http://127.0.0.1:${gatePort}`, tunnelId], { stdio: 'inherit', windowsHide: true });
  child.on('error', (e) => {
    console.error(e.code === 'ENOENT'
      ? '[start] `cloudflared` not found — install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
      : `[start] cloudflared failed to start: ${e.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => { if (!shuttingDown) { console.error(`[start] cloudflared exited (code ${code}) — tunnel down`); shutdown(1); } });
  return child;
}

// Build the tools server at boot so a registration-time crash (bad tool schema, kiro-cli missing from PATH) fails loud at startup, not on the first tool call.
warmToolsServer();
if (ingressMode === 'cloudflared') cloudflared = spawnCloudflared(cloudflaredCredPath);
// In-process gatekeeper (docs/plan/done/consolidate-mcp-tool-processes.md, Part B); a fatal listen error tears the whole stack down via shutdown, leaving no orphan.
// Always binds 127.0.0.1:<port> so local tools connect with or without a public ingress; a resolved `origin` makes OAuth discovery live from boot.
let gateServer = null;
useIngress(ingressMode);
try {
  gateServer = startGatekeeper(origin, () => shutdown(1));
} catch (e) {
  console.error(`[start] gatekeeper failed to start on 127.0.0.1:${gatePort}: ${e.message}`);
  shutdown(1);
}
if (origin) {
  console.log(`[start] Ingress attached — remote MCP URL: ${origin}/mcp`);
} else {
  console.log(`[start] Mode: Pure Local-First (http://127.0.0.1:${gatePort}/mcp) — no internet exposure`);
}

panel = startPanel({ port: Number(panelPort), token: panelToken, origin, ingress: ingressMode, client, passphrase, updateInfo, isDev, onFatal: () => shutdown(1) });
// Listen errors arrive asynchronously; opening the browser before both servers bind would land this run's token on whatever instance already owns the port (403 "wrong token").
const bound = (server) => new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
await Promise.all([gateServer, panel].filter(Boolean).map(bound));
// The panel falls back to the next free port when something else already holds the configured one
// (panel.js); the gatekeeper port stays fixed since Tailscale/cloudflared ingress is mapped to it.
const actualPanelPort = panel.actualPort ?? Number(panelPort);
const panelUrl = `http://127.0.0.1:${actualPanelPort}/?t=${panelToken}`;
writeLock({ pid: process.pid, panelPort: actualPanelPort, gatePort: Number(gatePort), token: panelToken, version, origin, ingress: origin ? ingressMode : null });
// Escape hatch for automated runs (bootstrap smoke tests) that must not pop a browser window — off by default, normal `npm start` is unaffected.
if (process.env.MCP_SKIP_BROWSER_OPEN) {
  console.log(`[start] MCP_SKIP_BROWSER_OPEN set — not opening a browser (panel: ${panelUrl})`);
} else {
  try {
    await openBrowser(panelUrl);
  } catch (e) {
    console.error(`[start] could not auto-open the panel (open manually: ${panelUrl}): ${e.message}`);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearLock();
  cloudflared?.kill();
  killPostmanDaemon();
  gateServer?.close();
  panel?.close();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => { cloudflared?.kill(); killPostmanDaemon(); }); // safety net: never leave a child orphaned if this process exits abruptly
