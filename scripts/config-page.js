// Renders the control panel page. Served only by panel.js on loopback; credentials never travel over the Funnel.
import os from 'node:os';
import path from 'node:path';
import { esc } from './html.js';

// SSoT for the AGY server identity: the mcpServers key AND the mcp(<key>/*) pre-allow name; set directly, not left to AGY's hyphen-dropping normalization (docs/ref/fact-agy-mcp-config.md § CLI-5).
export const AGY_SERVER_KEY = 'akimcp';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const AKI_DIR = path.join(os.homedir(), '.aki');
// AIObox's connect macro finds its connector by this exact name (docs/plan/IMPORTANT-akimcp-aiobox-contract.md § Id và tên).
const MCP_NAME = 'AkiMCP';
const SETTINGS_URL = 'https://claude.ai/new#settings/general';
const GROK_SETTINGS_URL = 'https://grok.com/?_s=personality';
const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/#settings/Personalization';
const CHATGPT_DEVMODE_URL = 'https://chatgpt.com/#settings/Security';
const GEMINI_SETTINGS_URL = 'https://gemini.google.com/saved-info';
const POSTMAN_SETTINGS_URL = 'https://go.postman.co/settings/me/connected-accounts';
const CONNECTOR_URL = 'https://claude.ai/new?modal=add-custom-connector#settings/customize-connectors';
const CHATGPT_CONNECTOR_URL = 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins';
const GEMINI_CONNECTOR_URL = 'https://support.google.com/g/answer/17106276';
const GROK_CONNECTOR_URL = 'https://grok.com/connectors';
const NOTION_CONNECTIONS_URL = 'https://www.notion.so/my-connections';
const TOKENIZER_URL = 'https://chromewebstore.google.com/detail/claude-token-counter/bioobpobpbeohjoefndgkiaakboimpch';
const GROK_USAGE_URL = 'https://chromewebstore.google.com/detail/grok-usage-watch-%E2%80%93-rate-l/bmpboaihdkpkjehbceegdmndkonlpdge';
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule';
const MCP_REPO_URL = 'https://github.com/lacvietanh/aki-mcp-sv';
const RULES_INSTALL_CMD = 'npx @akinet/akidevrule@latest';
const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TAILSCALE_FUNNEL_URL = 'https://tailscale.com/docs/features/tailscale-funnel';
const WIDEN_SNIPPET = "document.querySelectorAll('.max-w-3xl').forEach(el => el.classList.replace('max-w-3xl', 'max-w-7xl'));";
// The paste-in instruction is static on purpose: tool details live in each tool's description and the /akirule how-to in aki__akidevrule_context, so only the two musts stay here (a client-side instruction is the one place that can insist).
const WEB_PROMPT = [
  'Always use the akimcp tools (aki__*) for local files, shell and browser.',
  'You MUST follow /akirule in every chat, in full, from your first action on. Never skip it, even for a small task.',
].join('\n');

// Footer mirrors akitao.com's own (same products, order, and 20px icons hotlinked from that site) but recolored in this panel's tokens so it follows the light/dark theme.
const SITE = 'https://akitao.com';
const ECOSYSTEM = [
  ['Aki MCP SV', MCP_REPO_URL, '/pj/icon-aki-mcp-sv-96.png'],
  ['AkiTao', 'https://akitao.com', '/pj/icon-akitao.com-96.png'],
  ['AkiDev', 'https://dev.akitao.com', '/pj/icon-dev.akitao.com-96.png'],
  ['AkiDev Rule', RULES_REPO_URL, 'pj/icon-aki-mcp-sv-96.png'],
  ['AkiDev Sync', 'https://github.com/lacvietanh/aki-dev-sync', '/pj/icon-aki-dev-sync-96.png'],
  ['Aki Kinh Dịch', 'https://kinhdich.akinet.me', '/pj/icon-kinhdich.akinet.me-96.png'],
  ['Aki Tử Vi', 'https://tuvi.akinet.me', '/pj/icon-tuvi.akinet.me-96.png'],
  ['AkiApp', 'https://app.akinet.me', '/pj/icon-app.akinet.me-96.png'],
  ['AkiNet', 'https://akinet.me', '/pj/icon-akinet.me-96.png'],
  ['TachNhac v1', 'https://tool.akivn.net', '/pj/icon-tachnhacv1-96.png'],
  ['TachNhac.com', 'https://tachnhac.com', '/pj/icon-tachnhac.com-96.png'],
  ['AkiVN', 'https://akivn.net', '/pj/icon-akivn.net-96.png'],
  ['AkiCloud', 'https://cloud.akivn.net', '/pj/icon-cloud.akivn.net-96.png'],
  ['VSTShop.com', 'https://vstshop.com', '/pj/icon-vstshop.com-96.png'],
  ['AkiWorkflow.com', 'https://akiworkflow.com', '/pj/icon-akiworkflow.com-96.png'],
  ['LamNhac.net', 'https://lamnhac.net', '/pj/icon-lamnhac.net-96.png'],
  ['XKproduction.com', 'https://xkproduction.com', '/pj/icon-xkproduction.com-96.png'],
  ['Oscar Entertainment', 'https://oscarfamily.vn', '/pj/icon-oscarfamily.vn-96.png'],
  ['Oscar Music Group', 'https://oscarlabel.com', '/pj/icon-oscarlabel.com-96.png'],
  ['Oscar Studio', 'https://studio.oscarfamily.vn', '/pj/icon-studio.oscarfamily.vn-96.png'],
];

// akitao renders these as a Font Awesome webfont; inlining the four marks keeps the panel self-contained.
const SVG = {
  github: 'M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3',
  linkedin: 'M20.4 20.5h-3.6V15c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.6H9.4V9h3.4v1.6h.04c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3zM5.3 7.4a2.1 2.1 0 110-4.1 2.1 2.1 0 010 4.1zm1.8 13.1H3.6V9h3.5v11.5zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6C0 23.2.8 24 1.8 24h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0z',
  messenger: 'M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.5 3.6 7.2V22l3.3-1.8c1 .3 2 .4 3.1.4 5.5 0 10-4.1 10-9.4S17.5 2 12 2zm1 12.4l-2.5-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.5 5.8z',
  mail: 'M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm.6 2L12 12.6 20.4 7H3.6z',
};
const SOCIAL = [
  ['GitHub', 'https://github.com/lacvietanh', SVG.github],
  ['LinkedIn', 'https://www.linkedin.com/in/lacvietanh', SVG.linkedin],
  ['Messenger', 'https://m.me/lacvietanh', SVG.messenger],
  ['Email', 'mailto:admin@akitao.com', SVG.mail],
];

const withUtm = (url) => url.includes('?') ? `${url}&utm_source=aki-mcp-sv-footer` : `${url}?utm_source=aki-mcp-sv-footer`;

const ecoLink =([name, url, icon]) =>
  `<li><a class="eco-link" href="${esc(withUtm(url))}" target="_blank" rel="noopener"><img class="eco-icon" src="${SITE}${icon}" alt="" width="20" height="20" loading="lazy"><span>${esc(name)}</span></a></li>`;

const socialLink = ([label, url, path]) =>
  `<a class="social" href="${esc(url.startsWith('mailto:') ? url : withUtm(url))}" target="_blank" rel="noopener" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg></a>`;

const copyEl = (value, hl = false, id) => `<code class="copy${hl ? ' hl' : ''}"${id ? ` id="${esc(id)}"` : ''} title="click to copy"><span class="txt">${esc(value)}</span></code>`;

// Local-time "YYYY-MM-DD HH:mm:ss", not toLocaleString() — that renders differently per OS/locale.
function formatDateTime(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function formatUptime(totalSec) {
  let sec = Math.floor(totalSec);
  const days = Math.floor(sec / 86400); sec %= 86400;
  const hours = Math.floor(sec / 3600); sec %= 3600;
  const mins = Math.floor(sec / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function field(label, value, hl = false) {
  return `<div class="row"><label>${esc(label)}</label>${copyEl(value, hl)}</div>`;
}

// Shown masked so a screenshot never carries it; the eye button reveals it, click-to-copy always copies the real value.
function secretField(label, value) {
  return `<div class="row"><label>${esc(label)}<button type="button" class="eye" data-eye aria-label="Show ${esc(label)}" title="Show / hide"><i class="fa-solid fa-eye"></i></button></label><code class="copy"><span class="txt" data-v="${esc(value)}">${'•'.repeat(12)}</span></code></div>`;
}

export function renderPanel({ origin, ingress = 'funnel', client, passphrase, token, accessToken, repoRoot, rulesDir, userDir, updateInfo = {}, savedIngress = null, isDev = false }) {
  const url = origin ? `${origin}/mcp` : 'not available yet, see section 0';
  // Local-First: local clients (Postman Desktop, Cursor, Claude Code, AGY, Codex) run on this machine, so they
  // connect straight to the loopback engine — zero WAN round-trip, works with no internet and no tunnel. Only the
  // remote web connectors (Claude.ai, ChatGPT, …) need the public `url` above.
  const localUrl = `http://127.0.0.1:${process.env.GATEKEEPER_PORT || 9999}/mcp`;
  const postmanJson = JSON.stringify({
    mcpServers: { 'aki-mcp-sv': { url: localUrl, headers: { Authorization: `Bearer ${accessToken}` } } },
  });
  const cursorJson = JSON.stringify({ mcpServers: { 'aki-mcp': { url: localUrl, headers: { Authorization: `Bearer ${accessToken}` } } } });
  // stdio, because our /mcp is Bearer-gated and agy's SSE transport has no headers; CLI and IDE read the same file, so one entry serves both — docs/ref/fact-agy-mcp-config.md § CLI-1, CLI-2, IDE-1.
  const agyStdioPath = path.join(repoRoot, 'scripts', 'stdio.js');
  const agyJson = JSON.stringify({ mcpServers: { [AGY_SERVER_KEY]: { command: 'node', args: [agyStdioPath] } } });
  const claudeCodeCmd = `claude mcp add --transport http aki-mcp ${localUrl} --header "Authorization: Bearer ${accessToken}"`;
  // Codex CLI (~/.codex/config.toml) speaks streamable HTTP via a `url` key; `http_headers` carries a static bearer so the snippet is copy-paste-ready with no shell env var to export first (matches how every other local tab embeds the token).
  const codexToml = `[mcp_servers.aki-mcp]\nurl = "${localUrl}"\nhttp_headers = { "Authorization" = "Bearer ${accessToken}" }`;
  const funnelMode = ingress === 'funnel';
  // Tab 3 (Hosted domain) never becomes the active ingress here — the service it needs is a separate, not-yet-built project.
  const activeIngressTab = funnelMode ? 'tailscale' : 'owned';
  const ingressLabel = funnelMode ? 'Tailscale Funnel' : ingress === 'cloudflared' ? 'Cloudflare tunnel' : 'PUBLIC_ORIGIN (your own edge)';
  const mcpUpd = updateInfo.mcp || {};
  const ruleUpd = updateInfo.rule || {};
  const mcpVer = mcpUpd.current || '?';
  // Process identity for the header — computed fresh per render from the running process, never cached.
  const pid = process.pid;
  const startedAt = new Date(Date.now() - process.uptime() * 1000);
  const startedLabel = `${formatDateTime(startedAt)} (up ${formatUptime(process.uptime())})`;
  // AkiDevRule install/version badge for section 2 — mirrors the Postman panel's rule-status widget.
  const ruleState = ruleUpd.state || (ruleUpd.current ? 'current' : 'missing');
  const ruleCur = ruleUpd.current ? `v${esc(String(ruleUpd.current))}` : '';
  const ruleLatest = ruleUpd.latest ? `v${esc(String(ruleUpd.latest))}` : '';
  const RULE_BADGE = {
    missing: `<span class="rulebadge err">Not installed</span>${ruleLatest ? `<span class="rulebadge-note">latest ${ruleLatest}</span>` : ''}`,
    update: `<span class="rulebadge warn">Update available: ${ruleCur} → ${ruleLatest}</span>`,
    ahead: `<span class="rulebadge ok">Installed ${ruleCur}</span><span class="rulebadge-note">ahead of release</span>`,
    unknown: `<span class="rulebadge ok">Installed ${ruleCur || '(version unknown)'}</span><span class="rulebadge-note">update check failed</span>`,
    current: `<span class="rulebadge ok">Installed ${ruleCur}</span>`,
  };
  const ruleBadge = RULE_BADGE[ruleState] || RULE_BADGE.unknown;
  const ruleBtnLabel = ruleState === 'missing' ? 'Install' : ruleState === 'update' ? 'Update' : 'Install / update';
  // "Own update on top, rule update below" per the request; the rule row carries the re-paste warning because updating the corpus makes every pasted instruction stale.
  const updateBanner = (mcpUpd.updateAvailable || ruleUpd.updateAvailable) ? `<div class="updbar">
  ${mcpUpd.updateAvailable ? `<div class="updrow"><strong>@akinet/akimcp</strong> <span class="mono">${esc(String(mcpUpd.current))} → ${esc(String(mcpUpd.latest))}</span> <button class="primary" data-act="pullUpdate">Pull &amp; restart</button><span class="msg" id="msgUpd"></span></div>` : ''}
  ${ruleUpd.updateAvailable ? `<div class="updrow updrule"><strong>akidevrule</strong> <span class="mono">${esc(String(ruleUpd.current))} → ${esc(String(ruleUpd.latest))}</span> <button class="primary" data-act="updateRules">Install / update</button><span class="msg" id="msgUpdRule"></span></div>` : ''}
</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AkiMCP v${esc(String(mcpVer))}${isDev ? ' (dev)' : ''}</title>
<link rel="icon" href="/favicon/favicon.ico" sizes="any"><meta name="theme-color" content="#ff4800">
<link rel="stylesheet" href="/vendor/fa/css/all.min.css"><link rel="stylesheet" href="/panel.css"></head><body><main>
<header class="panel-hero">
  <img class="panel-hero-art" src="/img/akimcp-v2.jpg" alt="" aria-hidden="true">
  <div class="panel-hero-body">
    <div class="panel-brand-row">
      <div>
        <div class="panel-eyebrow">Local AI control plane</div>
        <h1>AKIMCP${isDev ? ' <span class="dev-tag">dev</span>' : ''}</h1>
      </div>
      <span class="version-badge" aria-label="AKIMCP version ${esc(String(mcpVer))}">v${esc(String(mcpVer))}</span>
    </div>
    <p class="sub">Secure local files and shell access for Claude, ChatGPT, Grok, and Gemini through OAuth 2.1.</p>
    <p class="panel-meta"><span>Local panel</span><span>127.0.0.1</span><span>${esc(ingressLabel)}</span><span>PID ${pid}</span><span>Started ${esc(startedLabel)}</span></p>
  </div>
  <a class="gh-top" href="${MCP_REPO_URL}" target="_blank" rel="noopener" aria-label="View AKIMCP on GitHub" title="View on GitHub"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${SVG.github}"/></svg></a>
</header>
<p class="helptext panel-paths">Running repo: <span class="mono">${esc(repoRoot)}</span> · Config &amp; keys: <span class="mono">${esc(userDir)}</span></p>
${updateBanner}
<section class="stepper"><h2>Setup steps</h2>
<ol class="steps-nav">
  <li class="step${origin ? ' done' : ''}"><a href="#s0"><span class="step-n">${origin ? '<i class="fa-solid fa-check"></i>' : '0'}</span> Ingress</a></li>
  <li class="step"><a href="#s1"><span class="step-n">1</span> Connectors</a></li>
  <li class="step"><a href="#s2"><span class="step-n">2</span> Install rules</a></li>
  <li class="step"><a href="#s3"><span class="step-n">3</span> Instructions</a></li>
  <li class="step opt"><a href="#s4"><span class="step-n">4</span> Extension <em>optional</em></a></li>
  <li class="step opt"><a href="#s7"><span class="step-n">7</span> Security</a></li>
</ol>
</section>

<section id="s0" class="collapsible-card${origin ? ' is-complete' : ''}"><details class="collapsible"${origin ? '' : ' open'}>
<summary><span class="collapse-heading">0 · Remote ingress (Web &amp; Mobile AI) — optional</span>${origin ? '<span class="done-tag">ingress active</span>' : '<span class="done-tag" style="color:var(--muted);border-color:var(--line)">optional · local is live</span>'}<span class="collapse-icon" aria-hidden="true"></span></summary>
<div class="collapse-body">
<p class="helptext">${origin ? `AKIMCP is live at ${copyEl(origin)} through <strong>${esc(ingressLabel)}</strong>. Expand this card only when you need to change ingress.` : `Local clients already work with no setup — the engine is live on <span class="mono">127.0.0.1</span>. Configure ingress here <em>only</em> to also let remote/mobile web AI (Claude.ai, ChatGPT) reach this machine over the internet. Default path is Tailscale Funnel; restart after switching ingress.`}</p>

<nav class="tabs" role="tablist">
  <button class="tab${activeIngressTab === 'tailscale' ? ' active' : ''}" data-tab="tailscale">Tailscale + Funnel</button>
  <button class="tab${activeIngressTab === 'owned' ? ' active' : ''}" data-tab="owned">Owned public origin</button>
  <button class="tab${activeIngressTab === 'aiobox' ? ' active' : ''}" data-tab="aiobox">Hosted domain</button>
</nav>

<div class="tabpane${activeIngressTab === 'tailscale' ? ' active' : ''}" id="tab-tailscale">
<p>Complete these one-time prerequisites in order.</p>
<p class="helptext">You're viewing this panel, so the first three below are already done; the two Tailscale checks are live.</p>
<ol class="steps">
  <li><span class="dot ok"><i class="fa-solid fa-check"></i></span> Install <span class="mono">@akinet/akimcp</span> (or clone repo).</li>
  <li><span class="dot ok"><i class="fa-solid fa-check"></i></span> Started with ${copyEl('akimcp')} (or ${copyEl('npm start')}), running now.</li>
  <li><span class="dot" id="tsInstalled">…</span> <a href="${TAILSCALE_DOWNLOAD_URL}" target="_blank" rel="noopener">Install Tailscale</a> and sign in.</li>
  <li><span class="dot" id="tsFunnel">…</span> Enable <a href="${TAILSCALE_FUNNEL_URL}" target="_blank" rel="noopener">Funnel</a> for your tailnet, free on every plan. ${copyEl('npm start')} enables it automatically; it only prints a link for you to approve once, when the tailnet hasn't allowed it yet.</li>
</ol>
<div class="acts"><button data-act="tailscale">Recheck</button><span class="msg" id="msgTs"></span></div>
<p class="helptext">Connector keeps dropping with <em>"hostname doesn't resolve / isn't reachable"</em>? The Funnel edge desynced, a Tailscale-side issue, not this server. Re-sync in a terminal (needs ${copyEl('sudo')}, so it can't be a button here), then reconnect. Why: <span class="mono">docs/research/claude-ai-oauth-connector.md</span> round 9.</p>
${field('Re-sync command', 'tailscale funnel --https=443 off && tailscale serve reset && tailscale funnel --bg 9999')}
<p class="helptext">Funnel unreliable in your region even after re-syncing? See the "Owned public origin" tab for two ways to bypass it.</p>
</div>

<div class="tabpane${activeIngressTab === 'owned' ? ' active' : ''}" id="tab-owned">
<p class="helptext">Replaces Tailscale entirely; OAuth and the tool suite stay the same.</p>
<h3 class="subh">Have a Cloudflare tunnel credentials JSON?</h3>
<div class="row"><label>cred.json</label><input type="file" id="tunnelCredFile" accept="application/json,.json"></div>
<div class="row"><label>Origin</label><input type="text" id="tunnelOriginInput" placeholder="https://your-host"></div>
<div class="acts"><button class="primary" data-act="saveTunnel">Save ingress</button><span class="msg" id="msgTunnel"></span></div>
<div id="savedIngressBox"></div>
<p class="helptext">No tunnel yet? <a href="${MCP_REPO_URL}#exposing-to-the-internet" target="_blank" rel="noopener">README: Exposing to the internet</a>.</p>
<h3 class="subh">Or: any HTTPS edge you already run</h3>
<p class="helptext">Set <span class="mono">PUBLIC_ORIGIN</span> in <span class="mono">.env</span> (copy from <span class="mono">.env.example</span>), or prefix the start command: ${copyEl('PUBLIC_ORIGIN=https://your-host npm start')}</p>
</div>

<div class="tabpane${activeIngressTab === 'aiobox' ? ' active' : ''}" id="tab-aiobox">
<p>Pick a domain and subdomain, then request it via Messenger; setup is manual, not self-serve yet.</p>
<p class="helptext">Worth it over the free Tailscale + Funnel tab if you want a short, memorable URL instead of Tailscale's auto-generated *.ts.net hostname.</p>
<div class="row"><label>Subdomain</label><div class="domain-pick">
<input type="text" id="subdomainInput" placeholder="yourname" maxlength="20">
<select id="tldSelect">
<option value="akitao.com" data-price="24">akitao.com</option>
<option value="akinet.me" data-price="19">akinet.me</option>
<option value="aiobox.app" data-price="12">aiobox.app</option>
<option value="akimcp.top" data-price="2" selected>akimcp.top</option>
<option value="akimcp.cfd" data-price="1" data-note="EXPIRED AUG 13 2027">akimcp.cfd</option>
</select>
<span class="helptext" id="domainPrice" style="margin:0;flex:0 0 auto;white-space:nowrap"></span>
</div></div>
<div class="acts"><button class="primary" data-act="registerDomain">Request via Messenger ↗</button><span class="msg" id="msgDomain"></span></div>
</div>
</div>
</details>
</section>

<section id="s1"><h2>1 · Connectors: local IDEs + web AIs</h2>
<p class="helptext">One AKIMCP endpoint, two paths. <strong>Local tools</strong> (Postman, Cursor, Claude Code, AGY) connect directly over <span class="mono">127.0.0.1</span> — zero latency, no tunnel, works offline; each tab below carries a ready-to-paste local config. <strong>Web AIs</strong> (Claude, Grok, ChatGPT, Gemini) use the MCP URL below and ${origin ? 'are reachable now.' : 'need a public ingress — set it up in <a href="#s0">Section 0</a> first (the MCP URL fills in once ingress is active).'}</p>
${field('MCP Name', MCP_NAME)}
${field('MCP URL', url, true)}
${secretField('Passphrase', passphrase)}
${secretField('Access token', accessToken)}
<div class="acts"><button data-act="rollToken">Roll token</button><button data-act="rollTokenHard">Roll &amp; sign out all clients</button><button data-act="rollPassphrase">Roll passphrase</button><span class="msg" id="msgRoll"></span></div>
<p class="helptext">One access token serves every client. <strong>Roll token</strong> replaces it: AIs connected with the passphrase refresh on their own, but a token pasted as a fixed bearer (a local snippet below) stops working until it is pasted again. Connect Notion with the passphrase like the other web AIs, never with a pasted token. <strong>Roll &amp; sign out all clients</strong> also revokes refresh, so every AI must reconnect with the passphrase; use it if the token may have leaked. <strong>Roll passphrase</strong> issues a new one: the old passphrase stops authorizing new connections, while already-connected AIs keep working; use it if the passphrase may have leaked.</p>

<nav class="tabs" role="tablist">
  <span class="tab-group-label">Local · direct 0ms</span>
  <button class="tab active" data-tab="postman"><img src="/img/providers/postman.png" class="provider-icon" alt="">Postman</button>
  <button class="tab" data-tab="cursor">Cursor</button>
  <button class="tab" data-tab="claudecode">Claude Code</button>
  <button class="tab" data-tab="agy">AGY</button>
  <button class="tab" data-tab="codex">Codex</button>
  <span class="tab-group-sep" aria-hidden="true"></span>
  <span class="tab-group-label">Web · needs ingress</span>
  <button class="tab" data-tab="claude"><img src="/img/providers/claude.png" class="provider-icon" alt="">Claude</button>
  <button class="tab" data-tab="grok"><img src="/img/providers/grok.png" class="provider-icon" alt="">Grok</button>
  <button class="tab" data-tab="chatgpt"><img src="/img/providers/gpt.png" class="provider-icon" alt="">ChatGPT</button>
  <button class="tab" data-tab="gemini"><img src="/img/providers/gemini.png" class="provider-icon" alt="">Gemini</button>
  <button class="tab" data-tab="notion"><img src="/img/providers/notion.png" class="provider-icon" alt="">Notion</button>
</nav>

<div class="tabpane" id="tab-claude">
  <p class="lnk"><a href="${CONNECTOR_URL}" target="_blank" rel="noopener">↗ Open Add custom connector</a></p>
  <ol class="steps">
    <li>Enter <strong>Name</strong> = MCP Name above.</li>
    <li>Enter <strong>URL</strong> = MCP URL above, then connect.</li>
    <li>Enter the <strong>Passphrase</strong> when AKIMCP opens the confirmation page.</li>
  </ol>
  <p class="helptext">Claude now discovers OAuth automatically. No Client ID or Client Secret is needed.</p>
</div>

<div class="tabpane" id="tab-grok">
  <ol class="steps">
    <li><a href="${esc(GROK_CONNECTOR_URL)}" target="_blank" rel="noopener">Open Connectors</a> → New Connector → Custom.</li>
    <li>Set <strong>Name</strong> = MCP Name above, <strong>Server URL</strong> = MCP URL.</li>
    <li>On connect, enter the <strong>Passphrase</strong>.</li>
  </ol>
  <p class="helptext">Name must match exactly, the paste-in instruction keys off it. Grok self-registers via PKCE, nothing else to paste.</p>
</div>

<div class="tabpane" id="tab-chatgpt">
  <p class="lnk"><a href="${esc(CHATGPT_DEVMODE_URL)}" target="_blank" rel="noopener">↗ Enable Developer mode</a> · Settings → Security and login</p>
  <p class="lnk"><a href="${esc(CHATGPT_CONNECTOR_URL)}" target="_blank" rel="noopener">↗ Create a connector</a></p>
  <ol class="steps">
    <li>Turn on <strong>Developer mode</strong> first. OpenAI requires it to create custom MCP apps.</li>
    <li>Pick an <strong>Icon</strong> (optional). Use ${copyEl(`${repoRoot}/public/favicon/icon-48.png`)} or any image.</li>
    <li>Enter a <strong>Name</strong> and <strong>Description</strong> (your choice).</li>
    <li>Set <strong>Connection</strong> → <strong>Server URL</strong> = MCP URL above.</li>
    <li>Tick <strong>I understand and want to continue</strong>, then <strong>Create</strong>.</li>
    <li>On connect, enter the <strong>Passphrase</strong>.</li>
  </ol>
  <p class="helptext">ChatGPT self-registers via DCR (PKCE, no secret). Do not paste Claude's Client ID or Secret here. Write tools may be limited depending on OpenAI's current policy.</p>
</div>

<div class="tabpane" id="tab-gemini">
  <p class="helptext">Paid tiers only. Tested 2026-08-09: the connection is healthy, but Gemini web doesn't reliably discover or invoke the MCP tools, use Claude or Grok instead. Not recommended.</p>
  <ol class="steps">
    <li>Open <a href="${esc(GEMINI_CONNECTOR_URL)}" target="_blank" rel="noopener">custom connected apps</a> (Gemini → paid subscriptions → Custom apps).</li>
    <li>Set the <strong>custom app link / Server URL</strong> = MCP URL.</li>
    <li>Open <strong>Advanced Settings</strong> and paste the <strong>Client ID</strong> and <strong>Client secret</strong> from the Claude tab (same confidential client).</li>
    <li>Ignore Gemini's <strong>Copy redirect URI</strong> button; the redirect is already allowlisted server-side.</li>
    <li>On <strong>Continue</strong>, enter the <strong>Passphrase</strong>.</li>
  </ol>
</div>

<div class="tabpane" id="tab-notion">
  <p class="lnk"><a href="${esc(NOTION_CONNECTIONS_URL)}" target="_blank" rel="noopener">↗ Open Notion connections</a></p>
  <ol class="steps">
    <li>Enable <strong>custom MCP servers</strong> in the Notion workspace settings (a workspace admin may have to).</li>
    <li>Add a <strong>Custom MCP server</strong> with the <strong>MCP URL</strong> above.</li>
    <li>Enter the <strong>Passphrase</strong> when AKIMCP opens the confirmation page.</li>
    <li>Add the connection inside the <strong>agent</strong>, then <strong>republish the agent</strong>.</li>
  </ol>
  <p class="helptext">Notion self-registers, nothing to paste. Connected this way it refreshes on its own after Roll token.</p>
</div>

<div class="tabpane active" id="tab-postman">
  <h3 class="subh">Control the Postman app</h3>
  <p class="helptext">This launch attaches control that opening Postman from the Dock/Spotlight does not: it auto-clicks Approve / Continue / Run / Try again and toggles Thinking / Auto-run inside the Postman window. If Postman is already open, this attaches to it — it does not open a second instance.</p>
  <div class="acts">
    <button class="primary" data-act="launchPostman" id="pmBtnLaunch">Launch</button>
    <button data-act="quitPostman" id="pmBtnQuit" hidden>Quit</button>
    <button data-act="newWindowPostman" id="pmBtnNewWindow" hidden>New window</button>
    <span class="dot" id="pmDaemonDot">…</span><span class="msg" id="msgPmDaemon"></span>
  </div>

  <h3 class="subh" style="margin-top:16px">Connect Postman to this MCP</h3>
  <p class="helptext">Postman runs on this machine, so it connects straight to the local engine on <span class="mono">127.0.0.1</span> — zero latency, and it keeps working with no internet and no tunnel. Click the JSON to copy, then paste it in Postman Connected Accounts.</p>
  <p class="lnk"><a href="${esc(POSTMAN_SETTINGS_URL)}" target="_blank" rel="noopener">↗ Open Connected Accounts</a></p>
  ${copyEl(postmanJson, true, 'postmanJson')}
  <p class="helptext" style="margin-top:12px">Setup screenshot:</p>
  <figure><img src="/img/aki-mcp-instruct-postman.png" alt="Postman MCP setup walkthrough" loading="lazy" style="max-width:100%;border-radius:6px"></figure>
</div>

<div class="tabpane" id="tab-cursor">
  <h3 class="subh">Connect Cursor — local, 0ms</h3>
  <p class="helptext">Paste into <span class="mono">~/.cursor/mcp.json</span> (or Cursor → Settings → MCP Servers), then reload. Connects over <span class="mono">127.0.0.1</span> — no tunnel, works offline.</p>
  ${copyEl(cursorJson, true, 'cursorJson')}
</div>

<div class="tabpane" id="tab-claudecode">
  <h3 class="subh">Connect Claude Code CLI — local, 0ms</h3>
  <p class="helptext">Run this one-liner in a terminal:</p>
  ${copyEl(claudeCodeCmd, true, 'claudeCodeCmd')}
</div>

<div class="tabpane" id="tab-agy">
  <h3 class="subh">Connect Antigravity (AGY) — local, 0ms</h3>
  <p class="helptext"><strong>CLI (<span class="mono">agy</span>) and IDE:</strong> both read this file: merge the entry below under the existing <span class="mono">mcpServers</span> key in <span class="mono">~/.gemini/config/mcp_config.json</span>, but don't overwrite the file. It registers a <span class="mono">stdio</span> command that spawns <span class="mono">scripts/stdio.js</span> (the local <span class="mono">/mcp</span> is Bearer-gated, so stdio is the transport that works without a token). The pre-allow below writes <span class="mono">antigravity-cli/settings.json</span> and covers the CLI only; the IDE asks for its own approval on the first tool call.</p>
  ${copyEl(agyJson, true, 'agyJson')}
  <div class="acts">
    <button class="primary" data-act="agyApply">Apply to AGY CLI (mcp_config.json)</button>
    <span class="msg" id="msgAgy"></span>
  </div>
</div>

<div class="tabpane" id="tab-codex">
  <h3 class="subh">Connect Codex CLI — local, 0ms</h3>
  <p class="helptext">Add this block to <span class="mono">~/.codex/config.toml</span> (append it — don't overwrite the file). Codex reaches the local engine over <span class="mono">127.0.0.1</span> via streamable HTTP; the bearer token is inlined so there's no shell env var to export first. Works offline, no tunnel. Restart Codex after saving.</p>
  ${copyEl(codexToml, true, 'codexToml')}
</div>
</section>

<section id="s2"><h2>2 · Install AkiDevRule (optional)</h2>
<p class="helptext">Pins how the AI writes, self-corrects, and names things into rule files loaded only when needed, so it stops re-guessing every session.</p>
${field('Install command', RULES_INSTALL_CMD)}
<p class="helptext">Runs on Mac/Linux/Windows — only needs <span class="mono">Node.js 18+</span>. Re-run the command above to update, or add <span class="mono">--check</span> to print installed-vs-latest without changing anything. From a local clone: <span class="mono">node install.mjs</span> (or launchers <span class="mono">install.sh</span> / <span class="mono">install.ps1</span>). No sudo; installs into every detected <span class="mono">~/.claude*</span> profile plus <span class="mono">~/.aki</span>, removable with rm -rf.</p>
<div class="acts">
  <button class="primary" data-act="installRules">${ruleBtnLabel}</button>
  <a class="btnlink" href="${RULES_REPO_URL}" target="_blank" rel="noopener">View repo ↗</a>
  ${ruleBadge}
  <span class="msg" id="msgRules"></span>
</div>
</section>

<section id="s3"><h2>3 · Instructions: copy the prompt</h2>
<p class="helptext">Paste it once into the custom-instructions setting of each AI (links below). It is static: tool details and the rule context come from the server itself, so it never needs re-pasting.</p>
<div class="acts">
  <a class="btnlink" href="${SETTINGS_URL}" target="_blank" rel="noopener"><img src="/img/providers/claude.png" class="provider-icon" alt="">Claude ↗</a>
  <a class="btnlink" href="${esc(GROK_SETTINGS_URL)}" target="_blank" rel="noopener"><img src="/img/providers/grok.png" class="provider-icon" alt="">Grok ↗</a>
  <a class="btnlink" href="${esc(CHATGPT_SETTINGS_URL)}" target="_blank" rel="noopener"><img src="/img/providers/gpt.png" class="provider-icon" alt="">ChatGPT ↗</a>
  <a class="btnlink" href="${esc(GEMINI_SETTINGS_URL)}" target="_blank" rel="noopener"><img src="/img/providers/gemini.png" class="provider-icon" alt="">Gemini ↗</a>
</div>
<textarea id="prompt" readonly style="min-height:110px;margin-top:12px">${esc(WEB_PROMPT)}</textarea>
<div class="acts"><button class="primary" onclick="copyText(document.getElementById('prompt').value, this)">copy prompt</button></div>
</section>

<section id="s4"><h2>4 · Browser utilities <span class="done-tag" style="color:var(--muted);border-color:var(--line)">optional</span></h2>
<p class="helptext"><strong>Claude Token Counter</strong>: a Chrome extension that shows your hourly and weekly usage bar under claude.ai's input box, including on the Free plan, which claude.ai doesn't surface itself.</p>
<div class="acts"><a class="btnlink" href="${esc(TOKENIZER_URL)}" target="_blank" rel="noopener">Install from Chrome Web Store ↗</a></div>
<figure><img src="/extension-claude-usage.png" alt="Token usage bar shown under claude.ai's input box" loading="lazy"></figure>
<p class="helptext" style="margin:14px 0 0"><strong>Grok Usage Watch</strong>: the same idea for grok.com, a rate-limit/usage bar for your Grok quota that the site doesn't show on its own.</p>
<div class="acts"><a class="btnlink" href="${esc(GROK_USAGE_URL)}" target="_blank" rel="noopener">Install from Chrome Web Store ↗</a></div>
<figure><img src="/extension-grok-usage.png" alt="Usage / rate-limit bar shown on grok.com" loading="lazy"></figure>
<p class="helptext" style="margin:14px 0 0">Widen the claude.ai chat pane; paste the snippet below into the browser tab's Console (${copyEl('Cmd/Ctrl ⌥ J')}). Only tweaks CSS in your current tab, nothing account- or security-related, nothing leaves your machine.</p>
${field('Widen command', WIDEN_SNIPPET)}
</section>

<section id="s5"><h2>5 · Folders the connector may reach</h2>
<p class="helptext">These folders scope file tools and the shell's working directory. Allowed shell commands run with your user permissions and may access files outside this list.</p>
<p class="helptext">The default root is your whole home folder: Desktop, Documents, Downloads, Photos, everything under it, not just projects.</p>
<p class="helptext">Save takes effect immediately for every tool (shell, search, and file read/write/edit alike) — no restart needed.</p>
<div class="flist" id="paths"></div>
<div class="acts">
  <button class="primary" data-act="addFolder">+ Add folder…</button>
  <button data-act="savePaths">Save</button>
  <span class="msg" id="msgPaths"></span>
</div>
</section>

<section id="s6"><h2>6 · Allowed shell commands</h2>
<p class="helptext"><strong>This is a guardrail for weak or overeager models, not a lock against you.</strong> It lets them work without approval prompts while keeping them off destructive commands; convenience comes first, so widen it freely for your own needs. Commands run as your user, so they can read what you can. Chips allow any subcommand; click a chip to restrict it to specific subcommands. Adding write commands (${copyEl('rm')}, ${copyEl('git commit')}…) widens access. A restricted <code>git</code> row lets <code>branch</code>, <code>tag</code> and <code>remote</code> run in their read forms only; press <em>any</em> to allow every git command.</p>
<p class="helptext"><strong>What each limit covers:</strong> this list bounds the shell command tool only. Section 5 (folders) bounds the file, search and git tools and where shell commands may run. The AGY and Kiro tools run in a locked mode of their own. Details: <code>docs/feat/tools.md</code>.</p>
<input type="text" id="cmdFilter" placeholder="filter commands…">
<div class="chips" id="cmdChips"></div>
<div class="flist" id="cmdRows"></div>
<div class="acts">
  <input type="text" id="newCmd" placeholder="add a command, e.g. docker">
  <button data-act="addCmd">+ Add</button>
  <button class="primary" data-act="saveAllowlist">Save allowlist</button>
  <span class="msg" id="msgAllow"></span>
</div>

<h3 class="subh">Trusted script directories</h3>
<p class="helptext">Scripts under these folders run without a command row above, so installed Aki skills work out of the box. The file tools cannot write into them, so the AI can't plant a script and run it; keep them to folders only an installer writes.</p>
<div class="flist" id="trustedDirs"></div>
<div class="acts">
  <button class="primary" data-act="addTrusted">+ Add directory…</button>
  <button data-act="saveTrusted">Save</button>
  <span class="msg" id="msgTrusted"></span>
</div>
</section>

<section id="s7"><h2>7 · Security &amp; connection limits</h2>
<p class="helptext"><strong>What this protects:</strong> the public address is reachable by anyone who learns it, and the only thing between them and your machine is the passphrase. A caller that keeps presenting <em>wrong</em> credentials is blocked for a while; a caller with a valid token is never counted or blocked, and neither are mistyped URLs (404) or malformed requests (400). Connecting many providers in a row is safe — only wrong credentials count.</p>
<p class="helptext"><strong>When a block ends:</strong> automatically after the block time below (the counter restarts from zero), immediately when you press Release, or when this app restarts. Callers are told by their public address; if your tunnel does not forward it, all remote callers share one address named <code>loopback</code>, so one attacker could block remote access until you release it. Changes apply from the next request, no restart.</p>
<label class="chk"><input type="checkbox" data-limit="enabled"> Limits enabled</label>
<div class="limits">
  <label>Wrong credentials allowed<input type="number" min="1" data-limit="failMax"></label>
  <label>…within (seconds)<input type="number" min="1" data-limit="failWindowSeconds"></label>
  <label>Then blocked for (minutes)<input type="number" min="1" data-limit="blockMinutes"></label>
  <label>Client registrations allowed<input type="number" min="1" data-limit="registerMax"></label>
  <label>…within (minutes)<input type="number" min="1" data-limit="registerWindowMinutes"></label>
  <label>Registered clients stored (max)<input type="number" min="1" data-limit="maxClients"></label>
</div>
<div class="acts">
  <button class="primary" data-act="saveLimits">Save limits</button>
  <button data-act="resetLimits">Reset to defaults</button>
  <span class="msg" id="msgLimits"></span>
</div>
<h3 class="subh">Blocked right now</h3>
<div class="flist" id="blockedList"></div>
<div class="acts">
  <button data-act="refreshBlocked">Refresh</button>
  <button data-act="releaseAll">Release everyone</button>
  <span class="msg" id="msgBlocked"></span>
</div>
<h3 class="subh">Clients</h3>
<p class="helptext">Every AI app that asked to connect. <strong>Signed in</strong> means it can keep renewing access on its own. A connection that was never approved is cleared after 1 hour; one that is no longer signed in is cleared after 30 days without activity. Remove signs a client out, but all clients share one access token, so a removed app keeps working until you press Roll token in <a href="#s1">section 1</a> — the others renew on their own.</p>
<div id="clientsList"></div>
<div class="acts"><span class="msg" id="msgClients"></span></div>
<h3 class="subh">Active now (since last restart)</h3>
<div id="callersList"></div>
<p class="helptext">Don't recognize a client or a caller? Roll the passphrase and use Roll &amp; sign out all clients in <a href="#s1">section 1</a>.</p>
<h3 class="subh">Security log</h3>
<p class="helptext">Wrong passphrases, rejected tokens, blocks, approvals and new callers — newest first, the last 200 lines. Saved to <span class="mono" id="securityLogPath"></span>; at 1 MB it moves to <span class="mono">security.log.1</span>, so it never grows past about 2 MB.</p>
<pre class="logbox" id="securityLog"></pre>
<div class="acts">
  <button data-act="refreshLog">Refresh</button>
  <span class="msg" id="msgLog"></span>
</div>
</section>

<section id="s8"><h2>8 · Tool providers</h2>
<p class="helptext">Each provider is a group of tools the AI sees. One that is not installed on this machine (Chrome, Postman, agy, kiro-cli) is hidden automatically; switch off one you do not use to keep the AI's tool list short. Rule context, files, search and shell are always on.</p>
<p class="helptext">A switch applies on this server at once. An AI client sees it the next time it lists tools, which for most clients means a new chat or reconnecting the connector. After installing or removing an app, press Detect again.</p>
<div id="providersList"></div>
<div class="acts">
  <button data-act="redetectProviders">Detect again</button>
  <span class="msg" id="msgProviders"></span>
</div>
</section>

<footer>
  <div class="foot-grid">
    <div class="foot-brand">
      <a class="foot-logo" href="${withUtm(SITE)}" target="_blank" rel="noopener"><img src="${SITE}/favicon/icon-192.png" alt="" width="32" height="32">Aki<b>Tao</b></a>
      <p class="foot-desc">Technology moves; the brand's identity doesn't.</p>
      <p class="lnk"><a href="${withUtm('https://m.me/akitaoglobal')}" target="_blank" rel="noopener">Contact AkiTao ↗</a></p>
      <div class="foot-social">${SOCIAL.map(socialLink).join('')}<a class="social" href="https://zalo.me/0869297957" target="_blank" rel="noopener" aria-label="Zalo" title="Zalo"><img src="${SITE}/img/icon-zalo.png" alt="" width="15" height="15" loading="lazy"></a></div>
      <div class="donate">
        <p class="foot-title">Buy me a coffee</p>
        <img class="qr" id="donateQr" src="/QR-AkiTao-PayPal.png" alt="PayPal donate QR" width="250" height="250" loading="lazy">
        <div class="qr-toggle">
          <button type="button" class="qr-tab" data-qr="momo">MoMo</button>
          <button type="button" class="qr-tab active" data-qr="paypal">PayPal</button>
        </div>
      </div>
    </div>
    <div>
      <p class="foot-title">Ecosystem</p>
      <div class="eco-grid">
        <ul>${ECOSYSTEM.slice(0, 11).map(ecoLink).join('')}</ul>
        <ul>${ECOSYSTEM.slice(11).map(ecoLink).join('')}</ul>
      </div>
    </div>
  </div>
  <p class="foot-bottom">© 2020–<span id="year"></span> AkiTao. All rights reserved.</p>
</footer>
</main>
<nav class="spy" id="spy" aria-label="Sections"></nav>
<button class="to-top" id="toTop" aria-label="Scroll to top" title="Scroll to top"><i class="fa-solid fa-arrow-up"></i></button>
<script>
const TOKEN = ${JSON.stringify(token)};
const RULES_DIR = ${JSON.stringify(rulesDir)};
const CLAUDE_DIR = ${JSON.stringify(CLAUDE_DIR)};
const AKI_DIR = ${JSON.stringify(AKI_DIR)};
const USER_DIR = ${JSON.stringify(userDir)};
const REPO_ROOT = ${JSON.stringify(repoRoot)};
const MCP_NAME = ${JSON.stringify(MCP_NAME)};
const SAVED_INGRESS = ${JSON.stringify(savedIngress)};
</script>
<script src="/panel-client.js"></script>
</body></html>`;
}
