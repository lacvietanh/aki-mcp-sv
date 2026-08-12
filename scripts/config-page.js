// Renders the control panel page. Served only by panel.js on loopback; credentials never travel over the Funnel.
import os from 'node:os';
import path from 'node:path';
import { esc } from './html.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const AKI_DIR = path.join(os.homedir(), '.aki');
const MCP_NAME = 'Aki MCP Server from local Shell & FileSystem';
const SETTINGS_URL = 'https://claude.ai/new#settings/general';
const GROK_SETTINGS_URL = 'https://grok.com/?_s=personality';
const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/#settings/Personalization';
const GEMINI_SETTINGS_URL = 'https://gemini.google.com/saved-info';
const CONNECTOR_URL = 'https://claude.ai/new?modal=add-custom-connector#settings/customize-connectors';
const CHATGPT_DEVMODE_URL = 'https://chatgpt.com/plugins#settings/Security?section=developer-mode';
const CHATGPT_CONNECTOR_URL = 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins';
const GEMINI_CONNECTOR_URL = 'https://support.google.com/g/answer/17106276';
const GROK_CONNECTOR_URL = 'https://grok.com/connectors';
const TOKENIZER_URL = 'https://chromewebstore.google.com/detail/claude-token-counter/bioobpobpbeohjoefndgkiaakboimpch';
const GROK_USAGE_URL = 'https://chromewebstore.google.com/detail/grok-usage-watch-%E2%80%93-rate-l/bmpboaihdkpkjehbceegdmndkonlpdge';
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule';
const MCP_REPO_URL = 'https://github.com/lacvietanh/aki-mcp-sv';
const RULES_INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/lacvietanh/akidevrule/master/install.sh | bash';
const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TAILSCALE_FUNNEL_URL = 'https://tailscale.com/docs/features/tailscale-funnel';
const WIDEN_SNIPPET = "document.querySelectorAll('.max-w-3xl').forEach(el => el.classList.replace('max-w-3xl', 'max-w-7xl'));";
const DEFAULT_RULES = ['index.md', 'RULE-agent-behavior.md', 'RULE-coding.md', 'RULE-pattern-core.md'];

// Footer mirrors akitao.com's own (same products, order, and 20px icons hotlinked from that site) but recolored in this panel's tokens so it follows the light/dark theme.
const SITE = 'https://akitao.com';
const ECOSYSTEM = [
  ['AkiTao.com', 'https://akitao.com', '/pj/icon-akitao.com-96.png'],
  ['TachNhac v1', 'https://tool.akivn.net', '/pj/icon-tachnhacv1-96.png'],
  ['TachNhac.com', 'https://tachnhac.com', '/pj/icon-tachnhac.com-96.png'],
  ['Aki Kinh Dịch', 'https://kinhdich.akinet.me', '/pj/icon-kinhdich.akinet.me-96.png'],
  ['Tử Vi AkiNet', 'https://tuvi.akinet.me', '/pj/icon-tuvi.akinet.me-96.png'],
  ['Aki Dev', 'https://dev.akitao.com', '/pj/icon-dev.akitao.com-96.png'],
  ['AkiDevRule', RULES_REPO_URL, '/aki-dev-rule-icon.png'],
  ['Aki Dev Sync', 'https://github.com/lacvietanh/aki-dev-sync', '/pj/icon-aki-dev-sync-96.png'],
  ['AkiVN', 'https://akivn.net', '/pj/icon-akivn.net-96.png'],
  ['Aki Cloud', 'https://cloud.akivn.net', '/pj/icon-cloud.akivn.net-96.png'],
  ['AkiApp', 'https://app.akinet.me', '/pj/icon-app.akinet.me-96.png'],
  ['VSTShop.com', 'https://vstshop.com', '/pj/icon-vstshop.com-96.png'],
  ['AkiNet.me', 'https://akinet.me', '/pj/icon-akinet.me-96.png'],
  ['Aki Workflow', 'https://akiworkflow.com', '/pj/icon-akiworkflow.com-96.png'],
  ['LamNhac.net', 'https://lamnhac.net', '/pj/icon-lamnhac.net-96.png'],
  ['XKproduction.com', 'https://xkproduction.com', '/pj/icon-xkproduction.com-96.png'],
  ['Oscar Entertainment', 'https://oscarfamily.vn', '/pj/icon-oscarfamily.vn-96.png'],
  ['Oscar Music Group', 'https://oscarlabel.com', '/pj/icon-oscarlabel.com-96.png'],
  ['Oscar Studio', 'https://studio.oscarfamily.vn', '/pj/icon-studio.oscarfamily.vn-96.png'],
  ['DiSanHonViet.com', 'https://disanhonviet.com', '/pj/icon-disanhonviet.com-96.png'],
  ['DisanBudang.com', 'https://disanbudang.com', '/pj/icon-disanbudang.com-96.png'],
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
  ['Messenger', 'https://m.me/akinet?t=frommcpsv', SVG.messenger],
  ['Email', 'mailto:admin@akitao.com', SVG.mail],
];

const ecoLink =([name, url, icon]) =>
  `<li><a class="eco-link" href="${esc(url)}" target="_blank" rel="noopener"><img class="eco-icon" src="${SITE}${icon}" alt="" width="20" height="20" loading="lazy"><span>${esc(name)}</span></a></li>`;

const socialLink = ([label, url, path]) =>
  `<a class="social" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg></a>`;

// The one copyable-code primitive (ui.A1 Tier-2 pattern class): every command/value/inline code renders as `.copy` and click-copies. `.mono` is plain monospace text, never a copy chip — the two roles stay visually distinct so nothing masquerades as copyable.
const copyEl = (value, hl = false) => `<code class="copy${hl ? ' hl' : ''}" title="click to copy"><span class="txt">${esc(value)}</span></code>`;

function field(label, value, hl = false) {
  return `<div class="row"><label>${esc(label)}</label>${copyEl(value, hl)}</div>`;
}

export function renderPanel({ origin, client, passphrase, token, repoRoot, rulesDir, userDir, updateInfo = {}, hasGit = false, ingressMode = 'tailscale' }) {
  const url = origin ? `${origin}/mcp` : 'not available yet, see section 0';
  const regUrl = origin ? `${origin}/register` : 'not available yet, see section 0';
  const mcpUpd = updateInfo.mcp || {};
  const ruleUpd = updateInfo.rule || {};
  const mcpVer = mcpUpd.current || '?';
  const ruleVer = ruleUpd.current || '?';
  // "Own update on top, rule update below" per the request; the rule row carries the re-paste warning because updating the corpus makes every pasted instruction stale.
  const updateBanner = (mcpUpd.updateAvailable || ruleUpd.updateAvailable) ? `<div class="updbar">
  ${mcpUpd.updateAvailable ? `<div class="updrow"><strong>aki-mcp-sv</strong> <span class="mono">${esc(String(mcpUpd.current))} → ${esc(String(mcpUpd.latest))}</span> ${hasGit ? '<button class="primary" data-act="pullUpdate">Pull &amp; restart</button>' : `<a class="btnlink" href="${MCP_REPO_URL}" target="_blank" rel="noopener">Download ↗</a>`}<span class="msg" id="msgUpd"></span></div>` : ''}
  ${ruleUpd.updateAvailable ? `<div class="updrow updrule"><strong>akidevrule</strong> <span class="mono">${esc(String(ruleUpd.current))} → ${esc(String(ruleUpd.latest))}</span> <button class="primary" data-act="updateRules">Install / update</button><span class="msg" id="msgUpdRule"></span><div class="updwarn">⚠ After updating, RE-PASTE the section-3 instruction into EACH account: claude / grok / chatgpt / gemini.</div></div>` : ''}
</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(MCP_NAME)} · panel</title>
<link rel="icon" href="/favicon/favicon.ico" sizes="any"><meta name="theme-color" content="#ff4800">
<style>
:root { color-scheme: light dark; --bg:#faf9f7; --card:#fff; --line:#e5e2dc; --fg:#1a1a1a; --muted:#6b6b6b; --accent:#ff4800; --ok:#2e7d32; --err:#c62828; }
@media (prefers-color-scheme: dark) { :root { --bg:#1a1817; --card:#232120; --line:#38352f; --fg:#ececec; --muted:#9a948c; --ok:#7bc47f; --err:#ef9a9a; } }
* { box-sizing: border-box; }
body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 24px 16px 8px; font-size: 14px; }
main { max-width: 880px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
p.sub { color: var(--muted); margin: 0 0 20px; font-size: 13px; line-height: 1.6; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 12px; }
h3.subh { font-size: 13px; margin: 16px 0 8px; color: var(--fg); font-weight: 600; }
h3.subh:first-of-type { margin-top: 4px; }
.hint { color: var(--muted); font-size: 12.5px; line-height: 1.7; margin: 0 0 10px; }
.fine { color: var(--muted); font-size: 11px; font-style: italic; opacity: .8; margin: 4px 0 8px; }
.row { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; align-items: center; margin-bottom: 8px; }
.row label { color: var(--muted); font-size: 13px; }
.mono, textarea, input[type=text] { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.copy { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; vertical-align: middle; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; cursor: pointer; font: 12px ui-monospace, Menlo, monospace; }
.copy .txt { overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
.copy .txt::-webkit-scrollbar { display: none; }
.copy::after { content: '⧉'; flex-shrink: 0; color: var(--muted); }
.copy:hover { border-color: var(--accent); }
.copy:hover::after { color: var(--accent); }
.copy.hl { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.copy.copied { border-color: var(--ok); }
.copy.copied::after { content: '✓'; color: var(--ok); }
button { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
button:hover { border-color: var(--accent); color: var(--accent); }
button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
button[disabled] { opacity: .55; cursor: progress; }
textarea, input[type=text] { width: 100%; padding: 6px 9px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; color: var(--fg); }
textarea { min-height: 90px; resize: vertical; line-height: 1.5; }
.lnk { font-size: 12px; margin: 0 0 10px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 18px 0 0; flex-wrap: wrap; }
.tab { border: 1px solid var(--line); border-bottom: none; background: var(--bg); color: var(--muted); border-radius: 8px 8px 0 0; padding: 7px 15px; cursor: pointer; font-size: 12.5px; }
.tab:hover { color: var(--accent); }
.tab.active { color: var(--accent); border-color: var(--accent); background: var(--card); font-weight: 600; margin-bottom: -1px; padding-bottom: 8px; }
.tabpane { display: none; padding-top: 14px; }
.tabpane.active { display: block; }
.stepper h2 { margin-bottom: 10px; }
.steps-nav { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; }
.steps-nav li { flex: 1 1 auto; }
.steps-nav a { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--muted); border: 1px solid var(--line); border-radius: 9px; padding: 8px 12px; font-size: 12.5px; background: var(--bg); white-space: nowrap; }
.steps-nav a:hover { border-color: var(--accent); color: var(--accent); }
.step-n { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid currentColor; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.step.done a { color: var(--ok); border-color: var(--ok); }
.step.done .step-n { border-color: var(--ok); background: var(--ok); color: #fff; }
.step.opt em { font-style: normal; opacity: .65; font-size: 10.5px; }
.done-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--ok); border: 1px solid var(--ok); border-radius: 5px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
.acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.to-top { position: fixed; right: 20px; bottom: 20px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--fg); font-size: 18px; line-height: 1; display: none; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.18); z-index: 50; }
.to-top:hover { border-color: var(--accent); color: var(--accent); }
.to-top.show { display: inline-flex; }
.spy { position: fixed; top: 50%; right: 16px; transform: translateY(-50%); display: none; flex-direction: column; gap: 7px; z-index: 40; }
.spy a { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--muted); font: 700 11px system-ui; text-decoration: none; }
.spy a:hover { border-color: var(--accent); color: var(--accent); }
.spy a.active { border-color: var(--accent); background: var(--accent); color: #fff; }
@media (min-width: 1040px) { .spy { display: flex; } }
.updbar { border: 1px solid var(--accent); border-left: 4px solid var(--accent); background: var(--card); border-radius: 10px; padding: 12px 16px; margin: 0 0 14px; }
.updrow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.updrow + .updrow { margin-top: 10px; }
.updwarn { flex-basis: 100%; color: var(--err); font-size: 12px; font-weight: 600; margin: 2px 0 0; }
.checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 4px 12px; margin-bottom: 12px; }
.checks label { display: flex; gap: 6px; align-items: center; font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
.flist { display: flex; flex-direction: column; margin-bottom: 8px; }
.flist > * { display: flex; align-items: center; margin-bottom: 3px; }
.flist input[type=text] { margin-right: 4px; }
.acts input[type=text] { flex: 0 1 220px; width: auto; }
.chips { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
.chip { display: inline-flex; align-items: center; margin: 0 4px 4px 0; padding: 2px 3px 2px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; font: 11.5px ui-monospace, Menlo, monospace; }
.chip span { cursor: pointer; }
.chip button { border: 0; background: none; padding: 0 3px; color: var(--muted); font-size: 13px; cursor: pointer; }
.chip.risk-hi { border-color: var(--err); color: var(--err); }
.chip.risk-md { border-color: var(--accent); color: var(--accent); }
.cmdrow .cmd-bin { width: 96px; flex-shrink: 0; font-weight: 600; font: 12px ui-monospace, Menlo, monospace; }
.cmdrow .cmd-subs { flex: 1; }
.cmdrow.risk-hi .cmd-subs { border-color: var(--err); }
.cmdrow button { border: 0; background: none; padding: 0 4px; color: var(--muted); font-size: 12px; cursor: pointer; }
.cmdrow button:hover { color: var(--accent); }
details.adv { margin-top: 12px; }
details.adv summary { cursor: pointer; color: var(--muted); font-size: 12px; }
details.adv summary:hover { color: var(--accent); }
.msg { font-size: 12px; margin-left: 4px; }
.msg.ok { color: var(--ok); } .msg.err { color: var(--err); }
a { color: var(--accent); }
.btnlink { border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 12px; text-decoration: none; }
.btnlink:hover { border-color: var(--accent); }
.steps { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.9; }
.steps li { margin-bottom: 2px; }
.dot { display: inline-block; width: 15px; font-weight: 700; }
.dot.ok { color: var(--ok); } .dot.err { color: var(--err); }
.empty { color: var(--muted); font-size: 12.5px; font-family: inherit; }
figure { margin: 10px 0 0; }
figure img { width: 100%; max-width: 560px; border: 1px solid var(--line); border-radius: 10px; display: block; }
footer { border-top: 1px solid var(--line); margin-top: 24px; padding: 24px 0 28px; color: var(--muted); }
.foot-grid { display: grid; grid-template-columns: 1.1fr 2fr; gap: 28px; }
.foot-brand { display: flex; flex-direction: column; gap: 10px; }
.foot-logo { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; width: fit-content; font-size: 17px; font-weight: 800; color: var(--fg); }
.foot-logo img { border-radius: 7px; }
.foot-logo b { color: var(--accent); font-weight: 800; }
.foot-desc { font-size: 12.5px; line-height: 1.6; margin: 0; }
.donate { margin-top: 6px; }
.donate .qr { width: 118px; height: 118px; border: 1px solid var(--line); border-radius: 8px; display: block; margin-top: 6px; background: #fff; }
.foot-social { display: flex; flex-wrap: wrap; gap: 6px; }
.social { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); transition: color .15s, border-color .15s; }
.social:hover { color: var(--accent); border-color: var(--accent); }
.social img { border-radius: 3px; opacity: .75; }
.social:hover img { opacity: 1; }
.foot-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; margin: 0 0 10px; }
.eco-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 4px; }
.eco-grid ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.eco-link { display: flex; align-items: center; gap: 7px; text-decoration: none; padding: 4px 6px; border-radius: 7px; color: var(--muted); font-size: 12.5px; }
.eco-link:hover { background: var(--bg); color: var(--fg); }
.eco-icon { border-radius: 4px; object-fit: cover; flex-shrink: 0; background: #fff; padding: 1px; }
.foot-bottom { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 14px; text-align: center; font-size: 11.5px; opacity: .7; }
@media (max-width: 700px) { .foot-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .row { grid-template-columns: minmax(0, 1fr); } .eco-grid { grid-template-columns: 1fr; } }
</style></head><body><main>
<h1>${esc(MCP_NAME)}</h1>
<p class="sub">Local panel (127.0.0.1); never goes through Funnel, never reaches the internet.<br>Running repo: <span class="mono">${esc(repoRoot)}</span> · Your config &amp; keys: <span class="mono">${esc(userDir)}</span></p>
${updateBanner}
<section class="stepper"><h2>Setup steps</h2>
<ol class="steps-nav">
  <li class="step done"><a href="#s0"><span class="step-n">✓</span> Setup</a></li>
  <li class="step"><a href="#s1"><span class="step-n">1</span> Connectors</a></li>
  <li class="step"><a href="#s2"><span class="step-n">2</span> Install rules</a></li>
  <li class="step"><a href="#s3"><span class="step-n">3</span> Instructions</a></li>
  <li class="step opt"><a href="#s4"><span class="step-n">4</span> Extension <em>optional</em></a></li>
</ol>
</section>

<section id="s0"><h2>0 · Setup <span class="done-tag">done</span></h2>
${ingressMode === 'frp' ? `
<p class="hint">FRP / custom reverse proxy is configured. The server listens on localhost:${esc(process.env.GATEKEEPER_PORT || '9999')}; your FRP routes external traffic to this port.</p>
<ol class="steps">
  <li><span class="dot ok">✓</span> FRP / custom ingress: ${copyEl(origin, true)}</li>
  <li><span class="dot ok">✓</span> Clone / download the <span class="mono">aki-mcp-sv</span> repo.</li>
  <li><span class="dot ok">✓</span> ${copyEl('npm install')}.</li>
  <li><span class="dot ok">✓</span> ${copyEl('PUBLIC_ORIGIN="' + esc(origin) + '" npm start')} — running now.</li>
</ol>
${field('FRP config', 'Set PUBLIC_ORIGIN=' + esc(origin) + ' in your environment. Your FRP must forward :443 → localhost:' + esc(process.env.GATEKEEPER_PORT || '9999') + ' via TCP (no TLS termination on the proxy). TLS is handled by the gatekeeper itself — set MCP_TLS_CERT and MCP_TLS_KEY to your cert/key paths.')}
` : `
<p class="hint">One-time prerequisites. You're reading this panel, so the last three already ran; the two Tailscale checks below are live.</p>
<ol class="steps">
  <li><span class="dot" id="tsInstalled">...</span> <a href="${TAILSCALE_DOWNLOAD_URL}" target="_blank" rel="noopener">Install Tailscale</a> and sign in.</li>
  <li><span class="dot" id="tsFunnel">...</span> Enable <a href="${TAILSCALE_FUNNEL_URL}" target="_blank" rel="noopener">Funnel</a> for your tailnet, free on every plan. ${copyEl('npm start')} enables it automatically; it only prints a link for you to approve once, when the tailnet hasn't allowed it yet.</li>
  <li><span class="dot ok">✓</span> Clone / download the <span class="mono">aki-mcp-sv</span> repo.</li>
  <li><span class="dot ok">✓</span> ${copyEl('npm install')}.</li>
  <li><span class="dot ok">✓</span> ${copyEl('npm start')} — running now.</li>
</ol>
<div class="acts"><button data-act="tailscale">Recheck</button><span class="msg" id="msgTs"></span></div>
<p class="hint">Connector keeps dropping with <em>"hostname doesn't resolve / isn't reachable"</em>? The Funnel edge desynced — a Tailscale-side issue, not this server. Re-sync it in a terminal (needs ${copyEl('sudo')}, so it can't be a button here), then reconnect the connector. Why: <span class="mono">docs/research/claude-ai-oauth-connector.md</span> round 9.</p>
${field('Re-sync command', 'tailscale funnel --https=443 off && tailscale serve reset && tailscale funnel --bg 9999')}
`}
</section>

<section id="s1"><h2>1 · Connectors: Claude, Grok, ChatGPT, Gemini</h2>
<p class="hint">Same ${ingressMode === 'frp' ? 'public' : 'Funnel'} URL for every client. Folders / shell allowlist apply to whoever connects. Fill the three common values below, then open your client's tab.</p>
${field('MCP Name', MCP_NAME)}
${field('MCP URL', url, true)}
${field('Passphrase', passphrase)}

<nav class="tabs" role="tablist">
  <button class="tab active" data-tab="claude">Claude</button>
  <button class="tab" data-tab="grok">Grok</button>
  <button class="tab" data-tab="chatgpt">ChatGPT</button>
  <button class="tab" data-tab="gemini">Gemini</button>
</nav>

<div class="tabpane active" id="tab-claude">
  <p class="lnk"><a href="${CONNECTOR_URL}" target="_blank" rel="noopener">↗ Open Add custom connector</a></p>
  <p class="hint">Paste the three common values above, plus these two Claude-only credentials, into the connector dialog.</p>
  ${field('OAuth Client ID', client.clientId)}
  ${field('OAuth Client Secret', client.clientSecret)}
</div>

<div class="tabpane" id="tab-grok">
  <ol class="steps">
    <li><a href="${esc(GROK_CONNECTOR_URL)}" target="_blank" rel="noopener">Open Connectors</a> → New Connector → Custom.</li>
    <li>Set <strong>Name</strong> = the MCP Name above (it must match exactly; the paste-in instruction keys off this name), and <strong>Server URL</strong> = MCP URL. Grok self-registers (PKCE); nothing else to paste.</li>
    <li>On connect, enter the <strong>Passphrase</strong>.</li>
  </ol>
</div>

<div class="tabpane" id="tab-chatgpt">
  <p class="hint">Developer mode required.</p>
  <ol class="steps">
    <li>Turn on <a href="${esc(CHATGPT_DEVMODE_URL)}" target="_blank" rel="noopener">Developer mode</a> (Settings → Connectors → Advanced).</li>
    <li><a href="${esc(CHATGPT_CONNECTOR_URL)}" target="_blank" rel="noopener">Create a connector</a>.</li>
    <li><strong>Connection</strong>: <strong>Server URL</strong> = MCP URL.</li>
    <li><strong>Authentication = OAuth</strong>, then open <strong>Advanced OAuth settings</strong>.</li>
    <li>Under <strong>OAuth endpoints</strong>, set <strong>Registration URL</strong> = the value below. This lets ChatGPT register itself; <strong>the other endpoints auto-fill from discovery</strong>.</li>
    <li><strong>Registration method = DCR</strong> and <strong>Token endpoint auth method = none</strong>. <span class="fine">Do not paste Claude's Client ID or Secret here.</span></li>
    <li>Tick <strong>I understand and want to continue</strong>, then <strong>Create</strong>.</li>
    <li>On connect, the browser opens the confirm page; enter the same <strong>Passphrase</strong>.</li>
  </ol>
  ${field('Registration URL', regUrl)}
  <p class="hint">ChatGPT registers its own client (PKCE, no secret). Write tools may be limited on ChatGPT depending on OpenAI’s current policy.</p>
</div>

<div class="tabpane" id="tab-gemini">
  <p class="hint">Paid tiers only. Tested 2026-08-09: the connection is healthy, but Gemini web doesn't reliably discover or invoke the MCP tools — use Claude or Grok instead. Not recommended.</p>
  <ol class="steps">
    <li>Open <a href="${esc(GEMINI_CONNECTOR_URL)}" target="_blank" rel="noopener">custom connected apps</a> (Gemini → paid subscriptions → Custom apps).</li>
    <li>Set the <strong>custom app link / Server URL</strong> = MCP URL.</li>
    <li>Open <strong>Advanced Settings</strong> and paste the <strong>Client ID</strong> and <strong>Client secret</strong> from the Claude tab (same confidential client).</li>
    <li>Ignore Gemini's <strong>Copy redirect URI</strong> button; the redirect is already allowlisted server-side.</li>
    <li>On <strong>Continue</strong>, enter the <strong>Passphrase</strong>.</li>
  </ol>
</div>
</section>

<section id="s2"><h2>2 · Install AkiDevRule (optional)</h2>
<p class="hint">Pins how the AI writes, self-corrects, and names things into rule files loaded only when needed, so it stops re-guessing every session. Choose which files load in section 3 below.</p>
${field('Install command', RULES_INSTALL_CMD)}
<p class="fine">install.sh is for mac &amp; linux. On Windows, ask your AI/agent to read install.sh and replicate the steps. No sudo; writes only to ~/.aki and ~/.claude, removable with rm -rf.</p>
<div class="acts">
  <button class="primary" data-act="installRules">Install / update</button>
  <a class="btnlink" href="${RULES_REPO_URL}" target="_blank" rel="noopener">View repo ↗</a>
  <span class="msg" id="msgRules"></span>
</div>
</section>

<section id="s3"><h2>3 · Instructions: choose rules &amp; copy the prompt</h2>
<p class="hint">Choose which rule files load, then copy the prompt into your client's custom-instructions / personalization field. It teaches the AI to use this server's tools and to load the rules you installed in section 2.</p>
<div class="acts">
  <a class="btnlink" href="${SETTINGS_URL}" target="_blank" rel="noopener">Claude ↗</a>
  <a class="btnlink" href="${esc(GROK_SETTINGS_URL)}" target="_blank" rel="noopener">Grok ↗</a>
  <a class="btnlink" href="${esc(CHATGPT_SETTINGS_URL)}" target="_blank" rel="noopener">ChatGPT ↗</a>
  <a class="btnlink" href="${esc(GEMINI_SETTINGS_URL)}" target="_blank" rel="noopener">Gemini ↗</a>
</div>
<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin:12px 0 10px">
  <input type="checkbox" id="loadRules" checked> Require reading rules at the start of every session
</label>
${ruleUpd.updateAvailable ? `<div class="updwarn" id="s3warn" style="margin:0 0 10px">⚠ akidevrule ${esc(String(ruleUpd.current))} → ${esc(String(ruleUpd.latest))} available — update in section 2, then re-paste this prompt into each account (claude / grok / chatgpt / gemini).</div>` : ''}
<div class="checks" id="ruleChecks"></div>
<textarea id="prompt" readonly style="min-height:130px"></textarea>
<div class="acts"><button class="primary" onclick="copyText(document.getElementById('prompt').value, this)">copy prompt</button><span class="msg" id="promptCount"></span></div>
</section>

<section id="s4"><h2>4 · Browser utilities <span class="done-tag" style="color:var(--muted);border-color:var(--line)">optional</span></h2>
<p class="hint"><strong>Claude Token Counter</strong>: a Chrome extension that shows your hourly and weekly usage bar right under claude.ai's input box, <strong>including on the Free plan</strong>. claude.ai doesn't surface that number anywhere itself.</p>
<div class="acts"><a class="btnlink" href="${esc(TOKENIZER_URL)}" target="_blank" rel="noopener">Install from Chrome Web Store ↗</a></div>
<figure><img src="/extension-claude-usage.png" alt="Token usage bar shown under claude.ai's input box" loading="lazy"></figure>
<p class="hint" style="margin:14px 0 0"><strong>Grok Usage Watch</strong>: the same idea for grok.com — a rate-limit / usage bar for your Grok quota, which the site doesn't show on its own.</p>
<div class="acts"><a class="btnlink" href="${esc(GROK_USAGE_URL)}" target="_blank" rel="noopener">Install from Chrome Web Store ↗</a></div>
<figure><img src="/extension-grok-usage.png" alt="Usage / rate-limit bar shown on grok.com" loading="lazy"></figure>
<p class="hint" style="margin:14px 0 0">Widen the claude.ai chat pane; paste the snippet below into the browser tab's Console (${copyEl('Cmd/Ctrl ⌥ J')}).</p>
${field('Widen command', WIDEN_SNIPPET)}
</section>

<section id="s5"><h2>5 · Folders the connector may reach</h2>
<p class="hint">These folders scope file tools and the shell's working directory. Allowed shell commands run with your user permissions and may access files outside this list.</p>
<div class="flist" id="paths"></div>
<div class="acts">
  <button class="primary" data-act="addFolder">+ Add folder…</button>
  <button data-act="savePaths">Save &amp; restart hub</button>
  <button data-act="restart">Restart hub</button>
  <span class="msg" id="msgPaths"></span>
</div>
</section>

<section id="s6"><h2>6 · Allowed shell commands</h2>
<p class="hint">Commands run as your user, so they can read what you can. Chips allow any subcommand; click a chip to restrict it to specific subcommands. Adding write commands (${copyEl('rm')}, ${copyEl('git commit')}…) widens access.</p>
<div class="chips" id="cmdChips"></div>
<div class="flist" id="cmdRows"></div>
<div class="acts">
  <input type="text" id="newCmd" placeholder="add a command, e.g. docker">
  <button data-act="addCmd">+ Add</button>
  <button class="primary" data-act="saveAllowlist">Save allowlist</button>
  <span class="msg" id="msgAllow"></span>
</div>

<h3 class="subh">Trusted script directories</h3>
<p class="hint">Scripts under these folders run without a command row above, for Aki-authored skills and scripts. A folder that overlaps a writable folder from section 5 is disabled (write + run = code execution).</p>
<div class="flist" id="trustedDirs"></div>
<div class="acts">
  <button class="primary" data-act="addTrusted">+ Add directory…</button>
  <button data-act="saveTrusted">Save</button>
  <span class="msg" id="msgTrusted"></span>
</div>
</section>

<footer>
  <div class="foot-grid">
    <div class="foot-brand">
      <a class="foot-logo" href="${SITE}" target="_blank" rel="noopener"><img src="${SITE}/favicon/icon-192.png" alt="" width="32" height="32">Aki<b>Tao</b></a>
      <p class="foot-desc">Technology moves; the brand's identity doesn't.</p>
      <div class="foot-social">${SOCIAL.map(socialLink).join('')}<a class="social" href="https://zalo.me/0869297957" target="_blank" rel="noopener" aria-label="Zalo" title="Zalo"><img src="${SITE}/img/icon-zalo.png" alt="" width="15" height="15" loading="lazy"></a></div>
      <div class="donate">
        <p class="foot-title">Buy me a coffee</p>
        <img class="qr" src="/QR-Aki.MOMO.jpg" alt="MoMo donate QR" width="118" height="118" loading="lazy">
        <span class="fine">MoMo</span>
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
<button class="to-top" id="toTop" aria-label="Scroll to top" title="Scroll to top">↑</button>
<script>
const TOKEN = ${JSON.stringify(token)};
const RULES_DIR = ${JSON.stringify(rulesDir)};
const CLAUDE_DIR = ${JSON.stringify(CLAUDE_DIR)};
const AKI_DIR = ${JSON.stringify(AKI_DIR)};
const REPO_ROOT = ${JSON.stringify(repoRoot)};
const MCP_NAME = ${JSON.stringify(MCP_NAME)};
const DEFAULT_RULES = ${JSON.stringify(DEFAULT_RULES)};
const MCP_VERSION = ${JSON.stringify(mcpVer)};
const RULE_VERSION = ${JSON.stringify(ruleVer)};

document.getElementById('year').textContent = new Date().getFullYear();

const toTop = document.getElementById('toTop');
toTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
addEventListener('scroll', () => toTop.classList.toggle('show', window.scrollY > 400), { passive: true });

// Spy-TOC rail: built from the sections themselves (SSoT), so numbers/labels never drift from the page.
const spy = document.getElementById('spy');
const spySecs = [...document.querySelectorAll('main section[id]')];
const spyLinks = {};
spySecs.forEach((sec) => {
  const a = document.createElement('a');
  a.href = '#' + sec.id;
  a.textContent = sec.id.replace('s', '');
  a.title = (sec.querySelector('h2')?.textContent || sec.id).replace(/\\s+(done|optional)$/i, '').trim();
  spy.append(a);
  spyLinks[sec.id] = a;
});
const spyObs = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    for (const a of Object.values(spyLinks)) a.classList.remove('active');
    spyLinks[e.target.id]?.classList.add('active');
  });
}, { rootMargin: '-45% 0px -50% 0px' });
spySecs.forEach((s) => spyObs.observe(s));

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-panel-token': TOKEN },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A dead panel process is the single most likely failure here, and the browser's own wording for it says nothing a user can act on.
    throw new Error('could not reach the panel; check whether "npm start" is still running');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'unknown error');
  return data;
}

function say(id, text, ok = true) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

async function act(btn, id, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'running…';
  try { say(id, await fn(), true); } catch (e) { say(id, e.message, false); }
  btn.disabled = false; btn.textContent = old;
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent; btn.textContent = 'copied'; setTimeout(() => (btn.textContent = old), 1200);
  });
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('.copy');
  if (!el) return;
  navigator.clipboard.writeText((el.querySelector('.txt') || el).textContent).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1000);
  });
});

function buildPrompt() {
  const lines = ['[akimcp ' + MCP_VERSION + ' · akidevrule ' + RULE_VERSION + '] ALWAYS short dense on-point. DON\\'T YAPPING. Claim=evidence; search=citation.'];
  const picked = document.getElementById('loadRules').checked
    ? [...document.querySelectorAll('#ruleChecks input:checked')].map((i) => i.value)
    : [];
  if (picked.length) {
    lines.push('Session start MCP "' + MCP_NAME + '": read ' + CLAUDE_DIR + '/CLAUDE.md + these under ' + RULES_DIR + ': ' + picked.join(', ') + '; follow all session. Router: ' + CLAUDE_DIR + '/skills/akirule/SKILL.md.');
  }
  const rulesOn = document.getElementById('loadRules').checked;
  const hasIndex = [...document.querySelectorAll('#ruleChecks input')].some((i) => i.value === 'index.md');
  if (rulesOn && !hasIndex) {
    lines.push('Rules not installed: ask the user to press Install/update in the Aki panel (section 2) before starting.');
  }
  lines.push('Task (mutate/multi-step): confirm scope; plan $HOME/.aki/mcpsv/task/<id>/plan.md (live); reply path on create. Skip pure Q&A. <id>=short slug.');
  lines.push('Files: always find_path (1 call, whole tree ~0.2s), never list_directory nor search_files. Text: search_content. git/ls/grep: run_cmd cwd=absolute under an allowed root, never cd/-C.');
  lines.push('Repo: ' + REPO_ROOT + '. local paths=Aki MCP FS only; sandbox throwaway; after write read-back MCP.');
  lines.push('Also read ' + AKI_DIR + '/aki-mcp-status.json; if its mcp.current/rule.current differ from the [akimcp·akidevrule] header above or any updateAvailable is true, tell me to update in the Aki panel and re-paste this into each account (claude/grok/chatgpt/gemini).');
  const value = lines.join('\\n');
  document.getElementById('prompt').value = value;
  const over = value.length > 1500;
  const count = document.getElementById('promptCount');
  count.textContent = value.length + ' chars' + (over ? ', over ChatGPT\\'s 1500 cap' : '');
  count.className = 'msg ' + (over ? 'err' : 'ok');
}

// Nothing about a folder row says whether it is live or merely typed, so the Save button carries the mark instead.
function markDirty() {
  document.querySelector('[data-act="savePaths"]').classList.add('primary');
  say('msgPaths', 'unsaved changes', false);
}

// Deleting a rule-zone row would silently cut the AI off from its rules, so those rows are locked, not deletable.
const isProtectedPath = (p) => p === RULES_DIR || p === CLAUDE_DIR || p === AKI_DIR;

function addPath(value, dirty) {
  const wrap = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'text'; input.value = value;
  if (isProtectedPath(value)) {
    input.readOnly = true;
    const lock = document.createElement('span');
    lock.textContent = '🔒';
    lock.title = 'Rule-file access, locked so it cannot be revoked by accident.';
    wrap.append(input, lock);
  } else {
    input.oninput = markDirty;
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => { wrap.remove(); markDirty(); };
    wrap.append(input, del);
  }
  document.getElementById('paths').append(wrap);
  if (dirty) markDirty();
}

// Feedback at the point of risk (plan §Decisions): a destructive binary is flagged whenever present; a safe-only-when-restricted one is flagged only while it allows any subcommand.
const ALWAYS_RISK = { rm: 'deletes files', rmdir: 'deletes dirs', mv: 'moves/overwrites', cp: 'can overwrite', dd: 'raw disk write', shred: 'destroys files', chmod: 'changes permissions', chown: 'changes ownership', ln: 'creates links', tee: 'writes files', truncate: 'truncates files', kill: 'kills processes', pkill: 'kills processes', killall: 'kills processes', curl: 'network write / exfil', wget: 'downloads', sh: 'runs a shell', bash: 'runs a shell', zsh: 'runs a shell', eval: 'runs code', find: '-exec/-delete escapes read-only', sort: '-o overwrites files', fd: '-x runs commands' };
const RISK_IF_ANY = { git: 'push/commit/reset with any subcommand', npm: 'install/publish with any subcommand', pip: 'install with any subcommand', node: '-e runs arbitrary code', python: '-c runs arbitrary code', python3: '-c runs arbitrary code' };

function markAllowDirty() {
  document.querySelector('[data-act="saveAllowlist"]').classList.add('primary');
  say('msgAllow', 'unsaved changes', false);
}

const riskOf = (bin, anySub) =>
  ALWAYS_RISK[bin] ? { cls: 'risk-hi', text: '⚠ ' + ALWAYS_RISK[bin] }
  : anySub && RISK_IF_ANY[bin] ? { cls: 'risk-md', text: RISK_IF_ANY[bin] + '; click to restrict and narrow it' }
  : null;

const listed = (bin) => [...document.querySelectorAll('#cmdChips .chip, #cmdRows .cmdrow')].some((el) => el.dataset.bin === bin);

// Any-subcommand command: one compact chip. Clicking the name promotes it to a restricted row.
function addChip(bin) {
  const chip = document.createElement('span');
  chip.className = 'chip'; chip.dataset.bin = bin;
  const r = riskOf(bin, true);
  if (r) { chip.classList.add(r.cls); chip.title = r.text; }
  const label = document.createElement('span');
  label.textContent = bin; label.title = 'click to restrict to specific subcommands';
  label.onclick = () => { chip.remove(); addRow(bin, []); markAllowDirty(); document.querySelector('#cmdRows .cmdrow:last-child .cmd-subs')?.focus(); };
  const x = document.createElement('button');
  x.textContent = '×'; x.onclick = () => { chip.remove(); markAllowDirty(); };
  chip.append(label, x);
  document.getElementById('cmdChips').append(chip);
}

// Restricted command: a row with its subcommand list, plus an "any" button that broadens it back to a chip.
function addRow(bin, subs) {
  const row = document.createElement('div');
  row.className = 'cmdrow'; row.dataset.bin = bin;
  if (ALWAYS_RISK[bin]) { row.classList.add('risk-hi'); row.title = '⚠ ' + ALWAYS_RISK[bin]; }
  const name = document.createElement('span');
  name.className = 'cmd-bin'; name.textContent = bin;
  const subI = document.createElement('input');
  subI.type = 'text'; subI.className = 'cmd-subs'; subI.value = subs.join(' '); subI.placeholder = 'subcommands (empty = any)';
  subI.oninput = markAllowDirty;
  const any = document.createElement('button');
  any.textContent = 'any'; any.title = 'collapse to a chip (allow any subcommand)';
  any.onclick = () => { row.remove(); addChip(bin); markAllowDirty(); };
  const x = document.createElement('button');
  x.textContent = '×'; x.title = 'remove'; x.onclick = () => { row.remove(); markAllowDirty(); };
  row.append(name, subI, any, x);
  document.getElementById('cmdRows').append(row);
}

// A non-empty subcommand list is a row; everything else is a chip. The level is inferred from the data, never stored as a null.
function renderAllowlist(map) {
  document.getElementById('cmdChips').innerHTML = '';
  document.getElementById('cmdRows').innerHTML = '';
  for (const bin of Object.keys(map).sort()) {
    if (Array.isArray(map[bin]) && map[bin].length) addRow(bin, map[bin]);
    else addChip(bin);
  }
}

// Chips + rows are the source of truth on save; a row with an empty list collapses to null (any), matching validateAllowlist server-side.
function collectAllowlist() {
  const map = {};
  const add = (bin, subs) => {
    if (!bin) return;
    if (bin in map) throw new Error('duplicate command "' + bin + '"');
    map[bin] = subs;
  };
  for (const chip of document.querySelectorAll('#cmdChips .chip')) add(chip.dataset.bin, null);
  for (const row of document.querySelectorAll('#cmdRows .cmdrow')) {
    const subs = row.querySelector('.cmd-subs').value.trim();
    add(row.dataset.bin, subs ? subs.split(/\\s+/) : null);
  }
  return map;
}

// Editable trust zones. A zone overlapping a writable root is disabled server-side (write+exec = RCE); the panel shows it with a ✕ and names the offending folder, but still lets the user fix or remove it.
function markTrustedDirty() {
  document.querySelector('[data-act="saveTrusted"]').classList.add('primary');
  say('msgTrusted', 'unsaved changes', false);
}

function addTrustedDir(value, conflict, dirty) {
  const wrap = document.createElement('div');
  const mark = document.createElement('span');
  if (conflict) { mark.className = 'dot err'; mark.textContent = '✕'; mark.title = 'disabled: overlaps writable folder ' + conflict + ' (write + run = code execution)'; }
  else if (value) { mark.className = 'dot ok'; mark.textContent = '✓'; mark.title = 'active'; }
  else { mark.className = 'dot'; }
  const input = document.createElement('input');
  input.type = 'text'; input.value = value; input.oninput = markTrustedDirty;
  const del = document.createElement('button');
  del.textContent = '×'; del.onclick = () => { wrap.remove(); markTrustedDirty(); };
  wrap.append(mark, input, del);
  document.getElementById('trustedDirs').append(wrap);
  if (dirty) markTrustedDirty();
}

function renderTrustedDirs(dirs) {
  document.getElementById('trustedDirs').innerHTML = '';
  for (const d of dirs) addTrustedDir(d.dir, d.conflict, false);
}

function renderRuleChecks(files) {
  const checks = document.getElementById('ruleChecks');
  checks.innerHTML = '';
  if (!files.length) {
    checks.innerHTML = '<span class="empty">akidevrule isn\\'t installed yet; install it in section 2 above, or skip and use the prompt without rules.</span>';
    return;
  }
  // index.md is the rule map — always first, and locked so it can't be unchecked.
  const sorted = [...files].sort((a, b) => (a === 'index.md' ? -1 : b === 'index.md' ? 1 : 0));
  for (const f of sorted) {
    const label = document.createElement('label');
    const locked = f === 'index.md';
    const checked = locked || DEFAULT_RULES.includes(f);
    label.innerHTML = '<input type="checkbox" value="' + f + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + '>';
    label.append(document.createTextNode(f.replace(/^(RULE|METHOD)-/, '').replace(/\\.md$/, '') + (locked ? ' 🔒' : '')));
    checks.append(label);
  }
}

async function loadState() {
  const s = await api('GET', '/api/state');
  renderAllowlist(s.allowlist);
  renderTrustedDirs(s.trustedDirs || []);
  s.paths.forEach((p) => addPath(p));
  renderRuleChecks(s.ruleFiles);
  document.getElementById('ruleChecks').onchange = buildPrompt;
  document.getElementById('loadRules').onchange = buildPrompt;
  document.getElementById('newCmd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.addCmd(); } };
  buildPrompt();
}

async function loadTailscale() {
  const s = await api('GET', '/api/tailscale');
  if (s.frp) return 'FRP / custom ingress: ' + (s.origin || 'not configured');
  const mark = (id, ok) => {
    const el = document.getElementById(id);
    el.textContent = ok ? '✓' : '✕';
    el.className = 'dot ' + (ok ? 'ok' : 'err');
  };
  mark('tsInstalled', s.installed);
  mark('tsFunnel', s.funnel);
  if (!s.installed) return 'tailscale command not found on this machine';
  if (!s.funnel) return 'Tailscale is installed, Funnel for port 9999 is still missing';
  return 'ready: ' + (s.host || 'domain not available yet');
}

const ACTIONS = {
  tailscale: (btn) => act(btn, 'msgTs', loadTailscale),
  addFolder: (btn) => { addPath('', true); document.querySelector('#paths input:last-of-type')?.focus(); },
  savePaths: (btn) => act(btn, 'msgPaths', async () => {
    const paths = [...document.querySelectorAll('#paths input')].map((i) => i.value.trim()).filter(Boolean);
    if (!paths.length) throw new Error('an empty list cuts off all of Claude\\'s file access; add at least one folder');
    const { message } = await api('POST', '/api/paths', { paths });
    btn.classList.remove('primary');
    return message;
  }),
  restart: (btn) => act(btn, 'msgPaths', async () => (await api('POST', '/api/restart')).message),
  addTrusted: () => { addTrustedDir('', null, true); document.querySelector('#trustedDirs input:last-of-type')?.focus(); },
  saveTrusted: (btn) => act(btn, 'msgTrusted', async () => {
    const dirs = [...document.querySelectorAll('#trustedDirs input')].map((i) => i.value.trim()).filter(Boolean);
    const { message } = await api('POST', '/api/trusted-dirs', { dirs });
    btn.classList.remove('primary');
    renderTrustedDirs((await api('GET', '/api/state')).trustedDirs || []);
    return message;
  }),
  addCmd: () => {
    const input = document.getElementById('newCmd');
    const bin = input.value.trim();
    if (!bin) return;
    if (listed(bin)) { say('msgAllow', '"' + bin + '" is already listed', false); return; }
    addChip(bin); input.value = ''; markAllowDirty(); input.focus();
  },
  saveAllowlist: (btn) => act(btn, 'msgAllow', async () => {
    const allowlist = collectAllowlist();
    const { message } = await api('POST', '/api/allowlist', { allowlist });
    btn.classList.remove('primary');
    return message;
  }),
  installRules: (btn) => act(btn, 'msgRules', async () => {
    const { message } = await api('POST', '/api/install-rules');
    renderRuleChecks((await api('GET', '/api/state')).ruleFiles);
    buildPrompt();
    return message;
  }),
  pullUpdate: (btn) => act(btn, 'msgUpd', async () => (await api('POST', '/api/pull-update')).message),
  updateRules: (btn) => act(btn, 'msgUpdRule', async () => {
    const { message } = await api('POST', '/api/install-rules');
    renderRuleChecks((await api('GET', '/api/state')).ruleFiles);
    buildPrompt();
    // The banner and section-3 warning both claimed a stale corpus; the update just cleared it.
    document.querySelector('.updrule')?.remove();
    document.getElementById('s3warn')?.remove();
    return message;
  }),
};

document.querySelectorAll('[data-act]').forEach((btn) => (btn.onclick = () => ACTIONS[btn.dataset.act](btn)));

document.querySelectorAll('.tab').forEach((tab) => (tab.onclick = () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
}));

// One failed /api/state leaves three sections blank, so the failure is reported next to each of them.
loadState().catch((e) => ['msgPaths', 'msgAllow', 'msgTrusted', 'msgRules'].forEach((id) => say(id, e.message, false)));
loadTailscale().then((m) => say('msgTs', m, m.startsWith('ready'))).catch((e) => say('msgTs', e.message, false));
</script>
</body></html>`;
}
