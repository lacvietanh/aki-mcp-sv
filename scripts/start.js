#!/usr/bin/env node
// Orchestrates mcp-hub + gatekeeper behind 1 `npm start`; foreground by design, manual stop/start only
import { spawn } from 'node:child_process';
import { funnelStatus, enableFunnel, bringUp } from './tailscale.js';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import { openBrowser } from './open-browser.js';
import { loadOrCreateClient, loadOrCreatePassphrase } from './oauth.js';
import { startGatekeeper } from './gatekeeper.js';
import { startPanel } from './panel.js';
import { checkForUpdate, writeStatusFile } from './update-check.js';
import { HUB_CONFIG_PATH, USER_DIR } from './userdata.js';

const dataDir = process.env.MCP_DATA_DIR || os.homedir();
const hubPort = process.env.MCP_HUB_PORT || '19999';
const gatePort = process.env.GATEKEEPER_PORT || '9999';
const panelPort = process.env.PANEL_PORT || '9998';
const panelToken = randomBytes(16).toString('hex');
const home = process.env.HOME || os.homedir();
// HOME must be explicit: Windows does not set it, and the hub config's `${HOME}` placeholders resolve from the child env.
const env = { ...process.env, HOME: home, USERPROFILE: process.env.USERPROFILE || home, MCP_DATA_DIR: dataDir };

const spawnNode = (args, opts) => spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, ...opts });

console.log(`[start] config & keys: ${USER_DIR}`);

const client = loadOrCreateClient();
const passphrase = loadOrCreatePassphrase();

const frpOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
let tailscale;
let origin;
let ingressMode = 'tailscale';

if (frpOrigin) {
  // FRP / custom reverse proxy: skip Tailscale entirely, use the provided origin as-is
  origin = frpOrigin;
  ingressMode = 'frp';
  tailscale = { installed: false, running: false, host: null, funnel: false, frp: true };
  console.log(`[start] PUBLIC_ORIGIN is set — using FRP / custom ingress: ${origin}`);
} else {
  tailscale = await funnelStatus(gatePort);
  if (!tailscale.installed) {
    console.error('[start] could not run `tailscale` — check it is installed and logged in: https://tailscale.com/download');
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
}

if (origin) {
  console.log(`[start] Remote MCP server URL: ${origin}/mcp`);
  console.log(`[start] OAuth Client ID: ${client.clientId}`);
  console.log(`[start] OAuth Client Secret: ${client.clientSecret}`);
  console.log('[start] paste all 3 values above into Add custom connector (URL + Advanced settings)');
  console.log(`[start] Passphrase (enter it when the browser opens the confirmation page): ${passphrase}`);
} else {
  console.error('[start] could not get the MagicDNS name — run `tailscale status` to look up the URL yourself');
}

// One check per `npm start`; own version stays on top, then the rule corpus. Never blocks boot.
const updateInfo = await checkForUpdate();
writeStatusFile(updateInfo);
const bar = (s) => console.log(`\x1b[43m\x1b[30m ${s} \x1b[0m`);
if (updateInfo.mcp.updateAvailable) bar(`[update] aki-mcp-sv ${updateInfo.mcp.current} → ${updateInfo.mcp.latest} — open the panel to pull & restart`);
if (updateInfo.rule.updateAvailable) bar(`[update] akidevrule ${updateInfo.rule.current} → ${updateInfo.rule.latest} — update in panel, then RE-PASTE the instruction into each account (claude/grok/chatgpt/gemini)`);

let hub;
let panel;
let shuttingDown = false;

function spawnHub() {
  // Resolved and run through `node` directly so Windows never has to locate `npx.cmd`.
  const cli = createRequire(import.meta.url).resolve('mcp-hub/dist/cli.js');
  const child = spawnNode([cli, '--port', hubPort, '--config', HUB_CONFIG_PATH], { env });
  // Only an unexpected death tears the stack down; a restart detaches the old child first.
  child.on('exit', () => child === hub && shutdown());
  child.on('error', (e) => console.error(`[start] mcp-hub failed to start: ${e.message}`));
  hub = child;
}

function restartHub() {
  const old = hub;
  hub = null;
  old.once('exit', spawnHub);
  old.kill();
}

spawnHub();
// Gatekeeper runs in-process (docs/plan/consolidate-mcp-tool-processes.md, Part B); a fatal listen error tears the whole stack down via shutdown, so the hub is never left orphaned.
const tls = process.env.MCP_TLS_CERT && process.env.MCP_TLS_KEY
  ? { cert: process.env.MCP_TLS_CERT, key: process.env.MCP_TLS_KEY }
  : null;
let gateServer;
try {
  gateServer = startGatekeeper(origin, shutdown, tls);
} catch (e) {
  console.error(`[start] gatekeeper failed to start: ${e.message}`);
  shutdown();
}

panel = startPanel({ port: Number(panelPort), token: panelToken, origin, client, passphrase, dataDir, restartHub, updateInfo, ingressMode });
const panelUrl = `http://127.0.0.1:${panelPort}/?t=${panelToken}`;
try {
  await openBrowser(panelUrl);
} catch (e) {
  console.error(`[start] could not auto-open the panel (open manually: ${panelUrl}): ${e.message}`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  hub?.kill();
  gateServer?.close();
  panel?.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => hub?.kill()); // safety net: never leave the hub child orphaned if this process exits abruptly
