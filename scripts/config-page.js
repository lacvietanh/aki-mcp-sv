// Renders the control panel page. Served only by panel.js on loopback; credentials never travel over the Funnel.
import os from 'node:os';
import path from 'node:path';
import { esc } from './html.js';
import { aioboxInstalled, AIOBOX_PANEL } from './aiobox-guide.js';
import { IDENTITY, MCP_NAME, MCP_SERVER_KEY, LEGACY_MCP_SERVER_KEY } from './mcp-name.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const AKI_DIR = path.join(os.homedir(), '.aki');
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
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule';
const MCP_REPO_URL = 'https://github.com/lacvietanh/aki-mcp-sv';
const RULES_INSTALL_CMD = 'npx @akinet/akidevrule@latest';
const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TAILSCALE_FUNNEL_URL = 'https://tailscale.com/docs/features/tailscale-funnel';
// Static on purpose: tool details live in tool descriptions and aki__akidevrule_context; only the two musts stay here, as a client-side instruction is the one place that can insist.
const WEB_PROMPT = [
  `Always use the ${IDENTITY.key} tools (${IDENTITY.prefix}*) for local files, shell and browser.`,
  'You MUST follow /akirule in every chat, in full, from your first action on. Never skip it, even for a small task.',
].join('\n');

// Footer = akitao.com AppFooter.vue `products`/`socialLinks` (UNIDOC Web §2.4b): same order, names, URLs; icons hotlinked from akitao.com, a name beside each so it reads offline.
const SITE = 'https://akitao.com';
// [name, url, icon key, ecosystem]: every row gets the UTM; ecosystem true = Aki-owned domain, which keeps its referrer, false = third party (noopener noreferrer).
const ECOSYSTEM = [
  ['AkiTao.com', SITE, 'akitao.com', true],
  ['aiobox.app', 'https://aiobox.app', 'aiobox.app', true],
  ['TáchNhạc V1', 'https://tool.akivn.net', 'tachnhacv1', true],
  ['TáchNhạc', 'https://tachnhac.com', 'tachnhac.com', true],
  ['Kinh Dịch AkiNet', 'https://kinhdich.app', 'kinhdich.akinet.me', true],
  ['Tử Vi AkiNet', 'https://tuvi.akinet.me', 'tuvi.akinet.me', true],
  ['Aki Dev', 'https://dev.akitao.com', 'dev.akitao.com', true],
  ['AkiDev.org', 'https://akidev.org', 'akidev.org', true],
  ['AkiDevRule', RULES_REPO_URL, 'akidevrule', false],
  ['Aki Dev Sync', 'https://github.com/lacvietanh/aki-dev-sync', 'aki-dev-sync', false],
  ['aki-mcp-sv', MCP_REPO_URL, 'aki-mcp-sv', false],
  ['AkiVN', 'https://akivn.net', 'akivn.net', true],
  ['Aki Cloud', 'https://cloud.akivn.net', 'cloud.akivn.net', true],
  ['AkiApp', 'https://app.akinet.me', 'app.akinet.me', false],
  ['VSTShop.com', 'https://vstshop.com', 'vstshop.com', false],
  ['AkiNet.me', 'https://akinet.me', 'akinet.me', true],
  ['Aki Workflow', 'https://akiworkflow.com', 'akiworkflow.com', false],
  ['LamNhac.net', 'https://lamnhac.net', 'lamnhac.net', false],
  ['XKproduction.com', 'https://xkproduction.com', 'xkproduction.com', false],
  ['Oscar Entertainment', 'https://oscarfamily.vn', 'oscarfamily.vn', false],
  ['RegMail.me', 'https://regmail.me', 'regmail.me', false],
  ['Oscar Music Group', 'https://oscarlabel.com', 'oscarlabel.com', false],
  ['Oscar Studio', 'https://studio.oscarfamily.vn', 'studio.oscarfamily.vn', false],
  ['DiSanHonViet.com', 'https://disanhonviet.com', 'disanhonviet.com', false],
  ['DisanBudang.com', 'https://disanbudang.com', 'disanbudang.com', false],
];

// akitao renders these as a Font Awesome webfont; inlining the marks keeps the panel self-contained.
const SVG = {
  github: 'M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3',
  linkedin: 'M20.4 20.5h-3.6V15c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.6H9.4V9h3.4v1.6h.04c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3zM5.3 7.4a2.1 2.1 0 110-4.1 2.1 2.1 0 010 4.1zm1.8 13.1H3.6V9h3.5v11.5zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6C0 23.2.8 24 1.8 24h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0z',
  youtube: 'M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z',
  messenger: 'M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.5 3.6 7.2V22l3.3-1.8c1 .3 2 .4 3.1.4 5.5 0 10-4.1 10-9.4S17.5 2 12 2zm1 12.4l-2.5-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.5 5.8z',
  mail: 'M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm.6 2L12 12.6 20.4 7H3.6z',
};
// [label, url, icon]: an icon is an inline SVG path, or an image URL (Zalo has no free mark to inline). Socials carry no UTM.
const SOCIAL = [
  ['LinkedIn', 'https://www.linkedin.com/in/lacvietanh', SVG.linkedin],
  ['YouTube AkiTao', 'https://www.youtube.com/@akitao-com', SVG.youtube],
  ['Messenger AkiNet', 'https://m.me/akinet?t=fromakimcp', SVG.messenger],
  ['GitHub', 'https://github.com/lacvietanh', SVG.github],
  ['Zalo', 'https://zalo.me/0869297957', `${SITE}/img/icon-zalo.png`],
  ['admin@akitao.com', 'mailto:admin@akitao.com', SVG.mail],
];

// Query goes before any #, since a query after the fragment is never sent to the server.
const withUtm = (url) => {
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}utm_source=akimcp-panel&utm_medium=footer${hashAt === -1 ? '' : url.slice(hashAt)}`;
};

const ecoLink = ([name, url, iconKey, ecosystem]) =>
  `<li><a class="eco-link" href="${esc(withUtm(url))}" target="_blank" rel="${ecosystem ? 'noopener' : 'noopener noreferrer'}"><img class="eco-icon" src="${SITE}/pj/icon-${esc(iconKey)}-96.png" alt="" width="20" height="20" loading="lazy"><span>${esc(name)}</span></a></li>`;

const socialLink = ([label, url, icon]) =>
  `<a class="social" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" title="${esc(label)}">${icon.startsWith('https://') ? `<img src="${icon}" alt="" width="15" height="15" loading="lazy">` : `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${icon}"/></svg>`}</a>`;

const SECRET_MASK = '•'.repeat(12);

// The one place a secret is hidden: the text shows each non-empty secret as SECRET_MASK, and the eye button swaps it with the real value (data-v), which click-to-copy also reads.
function copyEl(value, hl = false, id, secrets = []) {
  const shown = secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join(SECRET_MASK), value);
  const swap = shown === value ? '' : ` data-v="${esc(value)}" data-mask="${esc(shown)}"`;
  return `<code class="copy${hl ? ' hl' : ''}"${id ? ` id="${esc(id)}"` : ''} title="click to copy"><span class="txt"${swap}>${esc(shown)}</span></code>`;
}

const eyeButton = (label) => `<button type="button" class="eye" data-eye data-label="${esc(label)}" aria-label="Show ${esc(label)}" title="Show ${esc(label)}"><i class="fa-solid fa-eye"></i></button>`;

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
  return `<div class="row"><label>${esc(label)}${eyeButton(label)}</label>${copyEl(value, false, undefined, [value])}</div>`;
}

// A snippet that inlines secrets: its structure stays readable, only the secrets are masked.
function secretSnippet(label, value, secrets, id) {
  return `<div class="snip">${copyEl(value, true, id, secrets)}${eyeButton(label)}</div>`;
}

// The local client configs, built once here for both the rendered snippets and panel.js's Apply writers, so the two cannot drift.
// Local clients connect straight to loopback (no WAN, no tunnel); only remote web connectors need the public `url`.
export const localMcpUrl = () => `http://127.0.0.1:${process.env.GATEKEEPER_PORT || 9999}/mcp`;
export const httpBearerEntry = (url, token) => ({ url, headers: { Authorization: `Bearer ${token}` } });
// Remove-then-add: `claude mcp add` refuses an existing entry and keeps its old token (docs/plan/done/audit-tool-drift-oct25.md F9); `-s user` reaches every project.
export const claudeCodeLines = (url, token) => `claude mcp remove ${MCP_SERVER_KEY} -s user\nclaude mcp add --transport http -s user ${MCP_SERVER_KEY} ${url} --header "Authorization: Bearer ${token}"`;
const noOriginNotice = (reason) => `<p class="helptext">Set up a public address in <a href="#s0">section 0</a> first, ${reason}.</p>`;
// The same snippet pointed at the public address, for a second computer: Apply would write to this computer's own files, so it is copy-only.
function fromAnotherComputer({ origin, accessToken, label, id, snippetFor }) {
  const remote = origin ? `${secretSnippet(label, snippetFor(`${origin}/mcp`, accessToken), [accessToken], id)}
  <p class="helptext">The <span class="mono">${IDENTITY.prefix}</span> tools run on the machine running AkiMCP, not on the computer you paste this on. The token is stored in plain text on that computer. After <strong>Roll token</strong> it stops working there until the new snippet is pasted.</p>` : noOriginNotice('so another computer can reach this one');
  return `<details class="adv"><summary>From another computer (via the section 0 address)</summary>
  ${remote}
  </details>`;
}
// Shown under every snippet a person pastes by hand: Apply removes the retired key itself, a paste cannot.
const legacyNameHint = () => `<p class="helptext legacy-hint">Older AkiMCP versions used the name <span class="mono">${LEGACY_MCP_SERVER_KEY}</span> (Postman: <span class="mono">${LEGACY_MCP_SERVER_KEY}-sv</span>); delete that entry if your config still has it.</p>`;
// The guide's public address lives here once; the four labels are the ones its section 0 reads (docs/plan/done/web-chat-client.md).
export const GUIDE_URL = 'https://akimcp.top/guide/mcp-http/v1.md';
export const tempTokenKickoff = ({ mcpUrl, token, expires }) => [
  'I own this AkiMCP server. Connect to MCP_URL using TOKEN by following the protocol spec at GUIDE, then wait for my task. When I say the work is done, revoke the token as section 4 of the spec describes: send DELETE to MCP_URL with the same Bearer.',
  `GUIDE: ${GUIDE_URL}`,
  `MCP_URL: ${mcpUrl}`,
  `TOKEN: ${token}`,
  `EXPIRES: ${new Date(expires).toISOString()}`,
].join('\n');
// The Postman and Cursor config files take the same HTTP+Bearer entry.
export const httpBearerJson = (url, token) => JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: httpBearerEntry(url, token) } });
export const CODEX_TABLE = `[mcp_servers.${MCP_SERVER_KEY}]`;
// Codex CLI (~/.codex/config.toml): `http_headers` carries a static bearer so the snippet is copy-paste-ready with no env var to export.
export const codexBlock = (url, token) => `${CODEX_TABLE}\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`;

export function renderPanel({ origin, ingress = 'funnel', client, passphrase, token, accessToken, repoRoot, rulesDir, userDir, updateInfo = {}, savedIngress = null, isDev = false }) {
  const url = origin ? `${origin}/mcp` : 'not available yet, see section 0';
  const localUrl = localMcpUrl();
  const localBearerJson = httpBearerJson(localUrl, accessToken);
  // stdio, because our /mcp is Bearer-gated and agy's SSE transport has no headers; CLI and IDE read the same file, so one entry serves both — docs/ref/fact-agy-mcp-config.md § CLI-1, CLI-2, IDE-1.
  const stdioPath = path.join(repoRoot, 'scripts', 'stdio.js');
  const agyJson = JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { command: 'node', args: [stdioPath] } } });
  const claudeCodeCmd = claudeCodeLines(localUrl, accessToken);
  // The Claude app's config file takes only stdio entries (docs/plan/done/connector-setup-ux.md F11), so it spawns the same entry as AGY.
  const claudeAppJson = JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { command: 'node', args: [stdioPath] } } });
  const codexToml = codexBlock(localUrl, accessToken);
  const ecoHalf = Math.ceil(ECOSYSTEM.length / 2);
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
    <p class="sub">Secure access to local files and shell for web AIs and local tools, through one OAuth-gated endpoint.</p>
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
  <li class="step opt"><a href="#s7"><span class="step-n">7</span> Security</a></li>
</ol>
</section>

<section id="s0" class="collapsible-card${origin ? ' is-complete' : ''}"><details class="collapsible"${origin ? '' : ' open'}>
<summary><span class="collapse-heading">0 · Remote ingress (Web &amp; Mobile AI) — optional</span>${origin ? '<span class="done-tag">ingress active</span>' : '<span class="done-tag" style="color:var(--muted);border-color:var(--line)">optional · local is live</span>'}<span class="collapse-icon" aria-hidden="true"></span></summary>
<div class="collapse-body">
<p class="helptext">${origin ? `AKIMCP is live at ${copyEl(origin)} through <strong>${esc(ingressLabel)}</strong>. Expand this card only when you need to change ingress.` : `Local clients already work with no setup: the engine is live on <span class="mono">127.0.0.1</span>. Configure ingress here <em>only</em> so web AIs, in a browser or on a phone, can reach this computer over the internet. Restart after switching ingress.`}</p>
${ingress === 'cloudflared' ? '' : `<p class="helptext"><strong>Cloudflare Tunnel is the recommended ingress</strong> (the "Owned public origin" tab): it holds a steadier connection, carries more bandwidth and answers from a far larger global network than Tailscale Funnel. Funnel needs no domain and <span class="mono">npm start</span> sets it up by itself, so it is what runs until you choose otherwise.</p>`}

<nav class="tabs" role="tablist">
  <button class="tab${activeIngressTab === 'tailscale' ? ' active' : ''}" data-tab="tailscale">Tailscale + Funnel</button>
  <button class="tab${activeIngressTab === 'owned' ? ' active' : ''}" data-tab="owned">Owned public origin · recommended</button>
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
<p class="helptext">Funnel works with no domain, but a Cloudflare tunnel is steadier and faster: when you have a domain (or someone gave you a tunnel file), switch in the "Owned public origin" tab.</p>
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
<p class="helptext">One AKIMCP endpoint, two paths: pick one with the switch below. Each <strong>Local</strong> tab says how that tool connects and carries a ready-to-paste config. <strong>Web AIs</strong> use the MCP URL below and ${origin ? 'are reachable now.' : 'need a public ingress — set it up in <a href="#s0">Section 0</a> first (the MCP URL fills in once ingress is active).'}</p>
${field('MCP Name', MCP_NAME)}
${field('MCP URL', url, true)}
${secretField('Passphrase', passphrase)}
${secretField('Access token', accessToken)}
<div class="acts"><button data-act="rollToken">Roll token</button><button data-act="rollTokenHard">Roll &amp; sign out all clients</button><button data-act="rollPassphrase">Roll passphrase</button><span class="msg" id="msgRoll"></span></div>
<p class="helptext">One access token serves every client. <strong>Roll token</strong> replaces it: AIs connected with the passphrase refresh on their own (ClickUp may need one reconnect), but a token pasted as a fixed bearer (a local snippet below) stops working until it is pasted again. Connect Notion with the passphrase like the other web AIs, never with a pasted token. <strong>Roll &amp; sign out all clients</strong> also revokes refresh, so every AI must reconnect with the passphrase; use it if the token may have leaked. <strong>Roll passphrase</strong> issues a new one: the old passphrase stops authorizing new connections, while already-connected AIs keep working; use it if the passphrase may have leaked. Temporary tokens (Web → Any HTTP chat) expire on their own or are revoked one by one; <strong>Roll &amp; sign out all clients</strong> revokes them too.</p>

<div class="tier-switch" role="group" aria-label="Connector tier">
  <button type="button" class="tier-btn active" data-tier="local" aria-pressed="true" aria-controls="tabs-local"><span class="tier-title">Local · direct</span><span class="tier-sub">On this computer · 127.0.0.1 or stdio · no tunnel</span></button>
  <button type="button" class="tier-btn" data-tier="web" aria-pressed="false" aria-controls="tabs-web"><span class="tier-title">Web · needs ingress</span><span class="tier-sub">Cloud &amp; browser AIs · reaches the MCP URL via Section 0</span></button>
</div>

<nav class="tabs active" id="tabs-local" data-tier-tabs="local" aria-label="Local connectors">
  <button class="tab active" data-tab="postman"><img src="/img/providers/postman.png" class="provider-icon" alt="">Postman</button>
  <button class="tab" data-tab="cursor">Cursor</button>
  <button class="tab" data-tab="claudelocal"><img src="/img/providers/claude.png" class="provider-icon" alt="">Claude Code &amp; app</button>
  <button class="tab" data-tab="agy">AGY</button>
  <button class="tab" data-tab="codex">Codex</button>
</nav>

<nav class="tabs" id="tabs-web" data-tier-tabs="web" aria-label="Web connectors">
  <button class="tab" data-tab="claude"><img src="/img/providers/claude.png" class="provider-icon" alt="">Claude</button>
  <button class="tab" data-tab="grok"><img src="/img/providers/grok.png" class="provider-icon" alt="">Grok</button>
  <button class="tab" data-tab="chatgpt"><img src="/img/providers/gpt.png" class="provider-icon" alt="">ChatGPT</button>
  <button class="tab" data-tab="gemini"><img src="/img/providers/gemini.png" class="provider-icon" alt="">Gemini</button>
  <button class="tab" data-tab="notion"><img src="/img/providers/notion.png" class="provider-icon" alt="">Notion</button>
  <button class="tab" data-tab="buda">Buda</button>
  <button class="tab" data-tab="clickup">ClickUp</button>
  <button class="tab" data-tab="httpchat">Any HTTP chat</button>
</nav>

<div class="tabpane" id="tab-claude">
  <p class="lnk"><a href="${CONNECTOR_URL}" target="_blank" rel="noopener">↗ Open Add custom connector</a></p>
  <ol class="steps">
    <li>Enter <strong>Name</strong> = MCP Name above.</li>
    <li>Enter <strong>URL</strong> = MCP URL above, then connect.</li>
    <li>Enter the <strong>Passphrase</strong> when AKIMCP opens the confirmation page.</li>
  </ol>
  <p class="helptext">Claude now discovers OAuth automatically. No Client ID or Client Secret is needed.</p>
  <p class="helptext">A connector added here belongs to your Claude account: claude.ai, the Claude app and the mobile app all reach it from Anthropic's cloud, so it needs the ingress even on this computer. On the computer running AKIMCP, the <strong>Claude Code &amp; app</strong> tab under <strong>Local</strong> connects without one.</p>
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
    <li>Pick an <strong>Icon</strong> (optional). <a class="btnlink" href="/favicon/icon-48.png" download="akimcp-icon.png">Download icon</a> or use any image.</li>
    <li>Enter a <strong>Name</strong> and <strong>Description</strong> (your choice).</li>
    <li>Set <strong>Connection</strong> → <strong>Server URL</strong> = MCP URL above.</li>
    <li>Tick <strong>I understand and want to continue</strong>, then <strong>Create</strong>.</li>
    <li>On connect, enter the <strong>Passphrase</strong>.</li>
  </ol>
  <p class="helptext">ChatGPT self-registers via DCR (PKCE, no secret). Nothing to paste. Write tools may be limited depending on OpenAI's current policy.</p>
</div>

<div class="tabpane" id="tab-gemini">
  <p class="helptext">Paid tiers only. Tested 2026-08-09: the connection is healthy, but Gemini web doesn't reliably discover or invoke the MCP tools, use Claude or Grok instead. Not recommended.</p>
  <ol class="steps">
    <li>Open <a href="${esc(GEMINI_CONNECTOR_URL)}" target="_blank" rel="noopener">custom connected apps</a> (Gemini → paid subscriptions → Custom apps) and add a custom connected app.</li>
    <li>Paste the <strong>MCP Server URL</strong> = MCP URL above.</li>
    <li>Click <strong>Next</strong>. Gemini links the account by itself.</li>
    <li>Enter the <strong>Passphrase</strong> when AKIMCP opens the authorization page.</li>
    <li>Click <strong>Approve</strong>.</li>
  </ol>
  <p class="helptext">Gemini registers itself, nothing to paste. The static Client ID / Secret that <span class="mono">akimcp</span> prints at start is an optional fallback for clients that want a fixed pair.</p>
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

<div class="tabpane" id="tab-buda">
  <ol class="steps">
    <li>In Buda, open <strong>Agent Settings</strong> → your Agent → <strong>Integrations</strong>, then click <strong>Add MCP server</strong>.</li>
    <li>Set <strong>Name</strong> = MCP Name above.</li>
    <li>Set <strong>Connection type</strong> = <strong>Remote HTTP</strong>.</li>
    <li>Set <strong>HTTPS endpoint</strong> = ${copyEl(url)}</li>
    <li>Under <strong>Authentication headers</strong>, click <strong>+ Add header</strong>, then set the header name = ${copyEl('Authorization')}</li>
    <li>Set the header value:</li>
  </ol>
  ${secretField('Header value', `Bearer ${accessToken}`)}
  <ol class="steps" start="7">
    <li>Click <strong>Save</strong>, then start a new chat to load the tools.</li>
  </ol>
  <p class="helptext">Buda sends the shared access token as a Bearer header. No passphrase or client registration. After <strong>Roll token</strong>, paste the new header value again.</p>
</div>

<div class="tabpane" id="tab-clickup">
  <ol class="steps">
    <li>In ClickUp, open <strong>Settings</strong> → <strong>App Center</strong> → <strong>MCP Servers</strong> → <strong>Connect an MCP Server</strong>.</li>
    <li>Set <strong>Name</strong> = MCP Name above, <strong>URL</strong> = MCP URL.</li>
    <li>Set <strong>Authentication Method</strong> = <strong>OAuth</strong>. Leave <strong>Advanced configuration</strong> closed, then click <strong>Next</strong>.</li>
    <li>In the tab ClickUp opens, enter the <strong>Passphrase</strong> and approve. ClickUp continues on its own.</li>
  </ol>
  <p class="helptext">ClickUp registers itself, so there is no Client ID, Secret or token to paste. After <strong>Roll token</strong>, reconnect it once in ClickUp if it stops answering. ClickUp Brain then uses AKIMCP's tools when a request needs them, without a mention.</p>
</div>

<div class="tabpane" id="tab-httpchat">
  <p class="helptext">For web chats with no custom MCP connector that can still send HTTPS requests (WorkBuddy, CodeBuddy, Postman Agent, a chat with a code sandbox). Mint a temporary token that lasts 4 hours and paste the kickoff block into the chat. When the task is done, tell the AI to revoke its token, or click Revoke below. Your shared token and every connected AI are untouched. Restarting AKIMCP also revokes every temporary token.</p>
  <div class="acts"><button class="primary" data-act="mintTemp"${origin ? '' : ' disabled'}>Mint temp token &amp; copy kickoff</button><span class="msg" id="msgTemp"></span></div>
  ${origin ? '' : noOriginNotice('so the web chat can reach this computer')}
  <textarea id="tempKickoff" class="mono" rows="6" readonly hidden style="width:100%"></textarea>
  <p class="helptext" id="tempKickoffNote" hidden>Shown once: copy it now. After a reload only the row below remains, not the token.</p>
  <div id="tempList"></div>
  <div class="acts"><button data-act="revokeAllTemp" id="revokeAllTemp" hidden>Revoke all temporary tokens</button></div>
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
  <p class="helptext">Postman runs on this machine, so it connects straight to the local engine on <span class="mono">127.0.0.1</span>, with no tunnel. Click the JSON to copy, then paste it in Postman Connected Accounts.</p>
  <p class="lnk"><a href="${esc(POSTMAN_SETTINGS_URL)}" target="_blank" rel="noopener">↗ Open Connected Accounts</a></p>
  ${secretSnippet('Postman JSON', localBearerJson, [accessToken], 'postmanJson')}
  ${legacyNameHint()}
  <p class="helptext" style="margin-top:12px">Setup screenshot:</p>
  <figure><img src="/img/aki-mcp-instruct-postman.png" alt="Postman MCP setup walkthrough" loading="lazy" style="max-width:100%;border-radius:6px"></figure>
</div>

<div class="tabpane" id="tab-cursor">
  <h3 class="subh">Connect Cursor — local</h3>
  <p class="helptext"><strong>Apply</strong> merges ${MCP_SERVER_KEY} into <span class="mono">~/.cursor/mcp.json</span> with the current token (other servers untouched), then reload Cursor. After <strong>Roll token</strong>, click Apply again. Or paste the JSON by hand (Cursor → Settings → MCP Servers). Connects over <span class="mono">127.0.0.1</span>, with no tunnel.</p>
  <div class="acts"><button class="primary" data-act="cursorApply">Apply to Cursor (mcp.json)</button><span class="msg" id="msgCursor"></span></div>
  ${secretSnippet('Cursor JSON', localBearerJson, [accessToken], 'cursorJson')}
  ${legacyNameHint()}
  ${fromAnotherComputer({ origin, accessToken, label: 'Cursor JSON', id: 'cursorJsonRemote', snippetFor: httpBearerJson })}
</div>

<div class="tabpane" id="tab-claudelocal">
  <p class="helptext">Claude Code and the Claude app are set up separately: connecting one does not connect the other. Both run on the computer running AKIMCP, with no ingress: Claude Code connects over <span class="mono">127.0.0.1</span>, and the Claude app starts the tools itself over <span class="mono">stdio</span>. For claude.ai, the mobile app or the Claude app on another computer, use the <strong>Claude</strong> tab under <strong>Web</strong>; for the <span class="mono">claude</span> command on another computer, use <em>From another computer</em> below.</p>
  <h3 class="subh">Claude Code (terminal) — local</h3>
  <p class="helptext"><strong>Apply</strong> registers ${MCP_SERVER_KEY} in <span class="mono">user</span> scope with the current token, replacing any old entry so it works from every project. It also removes the entry an older setup left under its old name, including inside a single project, which would otherwise keep the old token there. After <strong>Roll token</strong>, click Apply again. Or run the two lines below by hand (the <span class="mono">remove</span> first lets a re-paste replace the old token — a bare <span class="mono">add</span> refuses when the entry already exists); </p>
  <p class="helptext legacy-hint">If one project still gets 401 from an entry an older setup left there, run <span class="mono">claude mcp remove ${LEGACY_MCP_SERVER_KEY} -s local</span> inside that project.</p>
  <div class="acts"><button class="primary" data-act="claudeCodeApply">Apply to Claude Code (user scope)</button><span class="msg" id="msgClaudeCode"></span></div>
  ${secretSnippet('Claude Code commands', claudeCodeCmd, [accessToken], 'claudeCodeCmd')}
  ${legacyNameHint()}
  ${fromAnotherComputer({ origin, accessToken, label: 'Claude Code commands', id: 'claudeCodeCmdRemote', snippetFor: claudeCodeLines })}
  <h3 class="subh">Claude app (desktop) — local</h3>
  <ol class="steps">
    <li>In the Claude app, open <strong>Settings</strong> → <strong>Developer</strong> → <strong>Edit Config</strong>. It opens <span class="mono">claude_desktop_config.json</span>.</li>
    <li>Merge the entry below under <span class="mono">mcpServers</span>, keeping any entries already there, and save.</li>
    <li>Quit the Claude app completely, then open it again.</li>
  </ol>
  ${copyEl(claudeAppJson, true, 'claudeAppJson')}
  ${legacyNameHint()}
  <p class="helptext">The app starts AKIMCP's tools itself over stdio (<span class="mono">scripts/stdio.js</span>) with no token, so <strong>Roll token</strong> changes nothing here. If the app reports the server failed to start, replace <span class="mono">node</span> with the full path printed by <span class="mono">which node</span> (Windows: <span class="mono">where node</span>).</p>
</div>

<div class="tabpane" id="tab-agy">
  <h3 class="subh">Connect Antigravity (AGY) — local</h3>
  <p class="helptext"><strong>CLI (<span class="mono">agy</span>) and IDE:</strong> both read this file: merge the entry below under the existing <span class="mono">mcpServers</span> key in <span class="mono">~/.gemini/config/mcp_config.json</span>, but don't overwrite the file. It registers a <span class="mono">stdio</span> command that spawns <span class="mono">scripts/stdio.js</span> (the local <span class="mono">/mcp</span> is Bearer-gated, so stdio is the transport that works without a token). The pre-allow below writes <span class="mono">antigravity-cli/settings.json</span> and covers the CLI only; the IDE asks for its own approval on the first tool call.</p>
  ${copyEl(agyJson, true, 'agyJson')}
  <div class="acts">
    <button class="primary" data-act="agyApply">Apply to AGY CLI (mcp_config.json)</button>
    <span class="msg" id="msgAgy"></span>
  </div>
</div>

<div class="tabpane" id="tab-codex">
  <h3 class="subh">Connect Codex CLI — local</h3>
  <p class="helptext"><strong>Apply</strong> writes the <span class="mono">${CODEX_TABLE}</span> table into <span class="mono">~/.codex/config.toml</span> with the current token, replacing it in place and dropping the table an older setup left under its old name (other tables untouched), then restart Codex. After <strong>Roll token</strong>, click Apply again. Codex reaches the local engine over <span class="mono">127.0.0.1</span> via streamable HTTP; the bearer token is inlined, no env var to export. No tunnel needed. To paste by hand, replace any existing <span class="mono">${CODEX_TABLE}</span> table — do not add a second one.</p>
  <div class="acts"><button class="primary" data-act="codexApply">Apply to Codex (config.toml)</button><span class="msg" id="msgCodex"></span></div>
  ${secretSnippet('Codex config', codexToml, [accessToken], 'codexToml')}
  ${legacyNameHint()}
  ${fromAnotherComputer({ origin, accessToken, label: 'Codex config', id: 'codexTomlRemote', snippetFor: codexBlock })}
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

<section id="s4"><h2>4 · Tool providers</h2>
<p class="helptext">Each provider is a group of tools the AI sees. One that is not installed on this machine (Chrome, Postman, agy, kiro-cli) is hidden automatically; switch off one you do not use to keep the AI's tool list short. The agy and Kiro CLI tools start off, because each hands a whole task to another paid agent: switch them on here when you want them. Rule context, files, search and shell are always on.</p>
<p class="helptext">A switch applies on this server at once. An AI client sees it the next time it lists tools, which for most clients means a new chat or reconnecting the connector. After installing or removing an app, press Detect again.</p>
<div id="providersList"></div>
<div class="acts">
  <button data-act="redetectProviders">Detect again</button>
  <span class="msg" id="msgProviders"></span>
</div>
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
<p class="helptext">Every AI app that asked to connect. <strong>Signed in</strong> means it can keep renewing access on its own. A connection that was never approved is cleared after 1 hour; one that is no longer signed in is cleared after 30 days without activity. A client that never got a token has only <strong>Delete</strong>. For the others, <strong>Revoke &amp; roll</strong> removes the client and rolls the shared access token, so it loses access at once; every other client is affected too: signed-in connectors renew on their next request (ClickUp may need one reconnect), while Buda and the local Claude Code, Codex and Cursor snippets need the new token (click Apply again or re-paste). <strong>Remove only</strong> (<strong>Sign out only</strong> for the pre-issued client) keeps the shared token, so that app keeps working until you press Roll token in <a href="#s1">section 1</a>.</p>
<div class="table-toolbar">
  <input type="text" data-filter="clientsList:text" placeholder="filter by name, kind, address, agent…" aria-label="Filter clients">
  <select data-filter="clientsList:status" aria-label="Filter clients by status"><option value="all">All</option><option value="signedin">Signed in</option><option value="pending">Pending</option><option value="signedout">Signed out</option></select>
  <span class="helptext" data-count="clientsList"></span>
  <button type="button" data-act="refreshClients">Refresh</button>
</div>
<div id="clientsList"></div>
<div class="acts"><span class="msg" id="msgClients"></span></div>
<h3 class="subh">Active now (since last restart)</h3>
<div class="table-toolbar">
  <input type="text" data-filter="callersList:text" placeholder="filter by address or agent…" aria-label="Filter callers">
  <span class="helptext" data-count="callersList"></span>
  <button type="button" data-act="refreshCallers">Refresh</button>
  <span class="msg" id="msgCallers"></span>
</div>
<div id="callersList"></div>
<p class="helptext">Don't recognize a client or a caller? Roll the passphrase and use Roll &amp; sign out all clients in <a href="#s1">section 1</a>.</p>
</section>

<section id="s8"><h2>8 · AIObox</h2>
${aioboxInstalled() ? `<p class="helptext">${esc(AIOBOX_PANEL.installed)}</p>` : `<div class="updbar">
<h3 class="subh">${esc(AIOBOX_PANEL.headline)}</h3>
<p>${esc(AIOBOX_PANEL.story)}</p>
<ul>${AIOBOX_PANEL.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
<p class="helptext">${esc(AIOBOX_PANEL.beta)}</p>
<div class="acts"><a class="btnlink primary" href="${esc(AIOBOX_PANEL.url)}" target="_blank" rel="noopener noreferrer">${esc(AIOBOX_PANEL.cta)} ↗</a></div>
</div>`}
</section>

<section id="s9"><h2>9 · Logs</h2>
<h3 class="subh">Call log</h3>
<p class="helptext">Every tool call that reaches AkiMCP through its <span class="mono">/mcp</span> URL is written to <span class="mono">${esc(path.join(userDir, 'tool-calls.jsonl'))}</span> as one JSON line: when, which tool and op, ok or not, how long, which client. Calls through the local <span class="mono">stdio</span> command (<span class="mono">scripts/stdio.js</span>) are not written. No prompt, expression or argument text is ever written.</p>
<p class="helptext"><strong>Basic</strong> (the default) keeps a short error code; <strong>Detail</strong> adds the full error text, the chat it acted on (from) and a hash of eval expressions. Keep days is how long past day-files stay before being deleted; the MB cap rolls the current file over to a dated one when it grows.</p>
<label class="chk"><input type="checkbox" data-log="enabled"> Logging on</label>
<div class="limits">
  <label>Detail level<select data-log="level"><option value="basic">basic — enough</option><option value="detail">detail</option></select></label>
  <label>Keep logs for (days)<input type="number" min="1" data-log="days"></label>
  <label>Current file cap (MB)<input type="number" min="1" data-log="maxMB"></label>
</div>
<div class="acts">
  <button class="primary" data-act="saveLog">Save log settings</button>
  <button data-act="resetLog">Reset to defaults</button>
  <span class="msg" id="msgLogSettings"></span>
</div>
<h3 class="subh">Security log</h3>
<p class="helptext">Wrong passphrases, rejected tokens, blocks, approvals and new callers — newest first, the last 200 lines. Saved to <span class="mono" id="securityLogPath"></span>; at 1 MB it moves to <span class="mono">security.log.1</span>, so it never grows past about 2 MB.</p>
<pre class="logbox" id="securityLog"></pre>
<div class="acts">
  <button data-act="refreshLog">Refresh</button>
  <span class="msg" id="msgLog"></span>
</div>
</section>

<footer>
  <div class="foot-grid">
    <div class="foot-brand">
      <a class="foot-logo" href="${withUtm(SITE)}" target="_blank" rel="noopener"><img src="${SITE}/favicon/icon-192.png" alt="" width="32" height="32">Aki<b>Tao</b></a>
      <p class="foot-desc">Technology moves; the brand's identity doesn't.</p>
      <div class="foot-social">${SOCIAL.map(socialLink).join('')}</div>
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
        <ul>${ECOSYSTEM.slice(0, ecoHalf).map(ecoLink).join('')}</ul>
        <ul>${ECOSYSTEM.slice(ecoHalf).map(ecoLink).join('')}</ul>
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
<script src="/table-sort.js"></script>
<script src="/panel-client.js"></script>
</body></html>`;
}
