#!/usr/bin/env node
// Orchestrates gatekeeper + panel + the in-process tools server behind 1 `npm start` / `akimcp`; foreground by design, manual stop/start only. Single Node process (docs/plan/done/2.0.0-improve.md #7, Stage 2).

import { readFileSync, existsSync } from 'node:fs';

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };

if (process.argv.includes('-v') || process.argv.includes('--version')) {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
  } catch {
    console.log('2.0.0');
  }
  process.exit(0);
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`@akinet/akimcp - Self-hosted remote MCP server for local filesystem & shell

Usage:
  akimcp [options]

Options:
  -v, --version            Show version number
  -h, --help               Show help
  --dev                    Run in development mode (isolated data dir & dev ports)
  --port <port>            Gatekeeper port (default: 9999, dev: 9997)
  --panel-port <port>      Control panel port (default: 9998, dev: 9996)
  --tunnel <cred.json>     Path to Cloudflare Tunnel credentials JSON
  --origin <url>           Public origin URL (required with --tunnel, e.g. https://mcp.yourdomain.com)
  --no-browser             Do not automatically open the web panel in browser
`);
  process.exit(0);
}

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
import { startPanel } from './panel.js';
import { warmToolsServer } from './streamable-bridge.js';
import { checkForUpdate, writeStatusFile } from './update-check.js';
import { USER_DIR, IS_DEV, readIngressConfig } from './userdata.js';
import { killPostmanDaemon } from './postman-mcp.js';

const isDev = IS_DEV;
const customGatePort = argOf('--port');
const customPanelPort = argOf('--panel-port');

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
  origin = tailscale.host ? `https://${tailscale.host}` : null;
  if (!origin) console.warn('[start] Tailscale Funnel host not available — configure ingress in the web panel below');
}

if (origin) {
  console.log(`[start] Remote MCP server URL: ${origin}/mcp`);
  console.log(`[start] OAuth Client ID: ${client.clientId}`);
  console.log(`[start] OAuth Client Secret: ${client.clientSecret}`);
  console.log('[start] paste all 3 values above into Add custom connector (URL + Advanced settings)');
  console.log(`[start] Passphrase (enter it when the browser opens the confirmation page): ${passphrase}`);
}

// One check per `npm start`; own version stays on top, then the rule corpus. Never blocks boot.
const updateInfo = await checkForUpdate();
writeStatusFile(updateInfo);
const bar = (s) => console.log(`\x1b[43m\x1b[30m ${s} \x1b[0m`);
if (updateInfo.mcp.updateAvailable) bar(`[update] @akinet/akimcp ${updateInfo.mcp.current} → ${updateInfo.mcp.latest} — run \`npm i -g @akinet/akimcp\` or pull & restart`);
if (updateInfo.rule.updateAvailable) bar(`[update] akidevrule ${updateInfo.rule.current} → ${updateInfo.rule.latest} — update in panel, then re-paste the Instructions (panel section 3) into the custom-instructions setting of each AI`);

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

// Boot-time construction of the tools server: surfaces a registration-time crash (bad tool schema,
// kiro-cli missing from PATH) loudly at startup instead of silently on the first tool call —
// replaces the old spawnHub()'s "fail loud at boot" role now that it's in-process.
warmToolsServer();
if (ingressMode === 'cloudflared') cloudflared = spawnCloudflared(cloudflaredCredPath);
// Gatekeeper runs in-process (docs/plan/done/consolidate-mcp-tool-processes.md, Part B); a fatal listen error tears the whole stack down via shutdown, so no child is ever left orphaned.
let gateServer = null;
if (origin) {
  try {
    gateServer = startGatekeeper(origin, () => shutdown(1));
  } catch (e) {
    console.error(`[start] gatekeeper failed to start: ${e.message}`);
    shutdown(1);
  }
} else {
  console.log('[start] Gatekeeper paused (waiting for ingress setup in the web panel)');
}

panel = startPanel({ port: Number(panelPort), token: panelToken, origin, ingress: ingressMode, client, passphrase, updateInfo, isDev });
const panelUrl = `http://127.0.0.1:${panelPort}/?t=${panelToken}`;
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
  cloudflared?.kill();
  killPostmanDaemon();
  gateServer?.close();
  panel?.close();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => { cloudflared?.kill(); killPostmanDaemon(); }); // safety net: never leave a child orphaned if this process exits abruptly
