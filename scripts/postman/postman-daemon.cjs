/**
 * Postman Automation Daemon & UI Injector
 * 100% Non-Invasive - Controlled via Chrome DevTools Protocol (CDP)
 * Native Gateway Integration (bifrost-premium-https-v4.gw.postman.com)
 */
const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { fetchAllUsage } = require('./postman-usage.cjs');
const { PostmanSession } = require('./postman-session.cjs');
const { eligibleTargets, deterministicOwnerTargetId, waitForEligibleTargets, openOwnedWindow, normalizeOwnershipStatus } = require('./postman-ownership.cjs');
const { loadInstruction, renderInstruction, copyDefaultIfMissing } = require('./postman-instruction-store.cjs');
const daemonPid = require('./postman-daemon-pid.cjs');
const {
  localSnapshot,
  refreshLocalVersions,
  refreshFromNetwork,
  getLocalVersions,
  RULES_DIR,
} = require('./postman-rule-update-check.cjs');

const { AKI_DATA_DIR, DATA_JSON_PATH, OWNERSHIP_STATUS_PATH, NEW_WINDOW_FLAG_PATH } = require('./postman-data-paths.cjs');
const PROMPTS_DIR = path.join(AKI_DATA_DIR, 'prompts');
const ASSETS_PROMPTS_DIR = path.join(__dirname, 'prompts');
const PROVIDER = 'postman';
const SUM_PROMPT_NAME = 'aki-prompt-sum-to-new-chat.md';
// postman.md is sent verbatim as the Postman AI's first message, so its wording is load-bearing twice: it must keep the two behaviors of commit 40008be (read via aki__run_cmd or the subagent shell, never the folder picker; escalate write steps to the subagent shell instead of reporting "no permission"), and it must stay short and free of directive/persona framing, which Postman's safety check flags (research: akiprx docs/research/postman-safety-flag-rate.md R21, R45).
const DEFAULT_PROMPT_PATH = path.join(ASSETS_PROMPTS_DIR, `${PROVIDER}.md`);
const SHARED_PROMPT_USER_PATH = path.join(PROMPTS_DIR, SUM_PROMPT_NAME);
const SHARED_PROMPT_DEFAULT_PATH = path.join(ASSETS_PROMPTS_DIR, SUM_PROMPT_NAME);

const RULES_SOURCE_FILE = path.join(RULES_DIR, '.source-repo');
const RULES_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';

const clients = new Map();
const attachedTargetIds = new Set();
let controlSession = null;
let ownerTargetId = null;
let ownershipMode = null;
let cachedUsageData = null;
// Startup/attach usage-refresh dedupe: collapse the concurrent per-page refreshes at boot into one
// network call, and skip re-fetching when the account token has not changed (the manual refresh bypasses this).
let usageRefreshInFlight = null;
let lastUsageToken;
let cachedUpdateInfo = localSnapshot();
let akiConfig = null;
let loggedMissingRule = false;
const CHAT_URL_RE = /gateway\.postman\.com\/chat/i;

async function refreshUsageData(customToken = null) {
  cachedUsageData = await fetchAllUsage(customToken);
  return cachedUsageData;
}

// Idempotent usage fetch for the boot/attach fan-out: one shared in-flight promise dedupes the
// concurrent per-page calls, and a completed fetch for the same account token is not repeated.
function ensureUsageData(token = null) {
  const key = token || akiConfig?.access_token || null;
  if (usageRefreshInFlight) return usageRefreshInFlight;
  if (cachedUsageData !== null && key === lastUsageToken) return Promise.resolve(cachedUsageData);
  usageRefreshInFlight = refreshUsageData(token)
    .then((data) => { lastUsageToken = key; return data; })
    .finally(() => { usageRefreshInFlight = null; });
  return usageRefreshInFlight;
}

function pushUsageToPage(client) {
  client.Runtime.evaluate({
    expression: `
      window.__pmUsageData = ${JSON.stringify(cachedUsageData)};
      if (typeof window.__pmRenderUsageBox === 'function') window.__pmRenderUsageBox();
    `
  }).catch(() => {});
}

function pushInstallRuleResultToPage(client, result) {
  client.Runtime.evaluate({
    expression: `
      window.__pmInstallRuleResult = ${JSON.stringify(result)};
      if (typeof window.__pmRenderInstallRuleResult === 'function') window.__pmRenderInstallRuleResult();
    `
  }).catch(() => {});
}

function pushUpdateInfoToPage(client) {
  client.Runtime.evaluate({
    expression: `
      window.__pmUpdateInfo = ${JSON.stringify(cachedUpdateInfo)};
      if (typeof window.__pmRenderRuleStatus === 'function') window.__pmRenderRuleStatus();
    `
  }).catch(() => {});
}

function pushUpdateInfoToAll() {
  for (const client of clients.values()) pushUpdateInfoToPage(client);
}

function logRuleUpdate(info) {
  const r = info && info.rule;
  if (!r) return;
  if (r.state === 'missing') {
    if (loggedMissingRule) return;
    loggedMissingRule = true;
    console.log('[akidevrule] not installed - press Install in the Aki Control Panel');
    return;
  }
  if (r.state === 'update') {
    console.log(`\x1b[43m\x1b[30m [update] akidevrule ${r.current} → ${r.latest} - update in the Aki Control Panel \x1b[0m`);
  }
}

// Mỗi lượt chat trả về SSE có event `usage` (docs/research/session-context-capture.md). Bắt thẳng tại
// Network.loadingFinished của CDP thay vì polling định kỳ hay patch window.fetch trong trang.
function hookChatUsageCapture(client) {
  const pending = new Map();

  client.Network.requestWillBeSent(async (params) => {
    const req = params.request || {};
    if (req.method !== 'POST' || !CHAT_URL_RE.test(req.url || '')) return;
    const referer = (req.headers && (req.headers.Referer || req.headers.referer)) || '';
    let teamId = null;
    try { teamId = new URL(referer).searchParams.get('teamId'); } catch (e) {}

    pending.set(params.requestId, { teamId });
  });

  client.Network.loadingFinished(async (params) => {
    if (!pending.has(params.requestId)) return;
    const ctx = pending.get(params.requestId);
    pending.delete(params.requestId);
    try {
      const { body, base64Encoded } = await client.Network.getResponseBody({ requestId: params.requestId });
      applyChatUsageFromSSE(client, base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body, ctx);
    } catch (e) {}
  });

  client.Network.loadingFailed((params) => pending.delete(params.requestId));
}

function applyChatUsageFromSSE(client, sseText, ctx) {
  const teamId = ctx && ctx.teamId;

  let latest = null;
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.eventType === 'usage' && evt.data && typeof evt.data.limit === 'number') latest = evt.data;
    } catch (e) {}
  }
  if (!latest) return;

  if (!cachedUsageData || !Array.isArray(cachedUsageData.teams) || !cachedUsageData.teams.length) return;
  const team = cachedUsageData.teams.find((t) => String(t.team_id) === String(teamId)) || cachedUsageData.teams[0];
  team.quota = {
    used: Math.ceil((latest.usage || 0) / 1000),
    limit: Math.floor((latest.limit || 0) / 1000),
    percent: latest.limit > 0 ? Math.round(((latest.usage || 0) / latest.limit) * 100) : 0,
    resetAt: (latest.usageCycle && latest.usageCycle.end) || null
  };
  cachedUsageData.updatedAt = new Date().toLocaleTimeString();
  pushUsageToPage(client);
}

// Panel → daemon IPC for the "New window" panel button (scripts/panel.js's
// POST /api/postman-new-window, via postman-mcp.js's requestNewWindow): a flag file next to
// data.json is the smallest transport that works — the panel is the only writer, this is the
// only reader/deleter, and it rides discover()'s existing 1s tick instead of a new interval.
async function consumePendingNewWindow() {
  if (!fs.existsSync(NEW_WINDOW_FLAG_PATH)) return;
  try { fs.unlinkSync(NEW_WINDOW_FLAG_PATH); } catch (e) {}
  const ownerClient = ownerTargetId && clients.get(ownerTargetId);
  if (!ownerClient || !controlSession) return;
  const target = await openOwnedWindow({
    ownerClient,
    listTargets: () => CDP.List({ port: controlSession.port }),
    isEligible: isKnownPostmanSurface,
  });
  if (!target) return;
  attachedTargetIds.add(target.id);
  await setupCDP(target, controlSession.port);
  writeOwnershipStatus();
}

function loadAkiData() {
  let data = null;
  if (fs.existsSync(DATA_JSON_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8'));
    } catch (e) {}
  }
  if (!data) data = {};

  if (data.__v !== 2) {
    data.__v = 2;
    saveAkiData(data);
  }

  akiConfig = data;
  return data;
}

let identity = null;

// mcp-name.js is an ES module and this daemon is CommonJS, so the identity arrives through one dynamic import before main() runs.
async function loadIdentity() {
  ({ IDENTITY: identity } = await import('../mcp-name.js'));
}

function loadInstructionFile() {
  // Served natively read-only from the bundled repo asset — intentionally no user/home/legacy override.
  return loadInstruction([DEFAULT_PROMPT_PATH]);
}

function loadSummarizePromptFile() {
  return loadInstruction([SHARED_PROMPT_USER_PATH, SHARED_PROMPT_DEFAULT_PATH]);
}

// Seeds only the user-editable summarize prompt. The Postman instruction is served natively read-only from the repo asset, so it is intentionally NOT copied to a writable home file.
function init() {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
  copyDefaultIfMissing(SHARED_PROMPT_USER_PATH, SHARED_PROMPT_DEFAULT_PATH);
}

function saveAkiData(data) {
  try {
    fs.mkdirSync(AKI_DATA_DIR, { recursive: true });
    let existing = {};
    if (fs.existsSync(DATA_JSON_PATH)) {
      try {
        existing = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8')) || {};
      } catch (e) {}
    }
    const incoming = data || {};
    const merged = { ...existing, ...incoming };
    delete merged.showUsage;
    delete merged.thinking;
    delete merged.autorun;
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Lỗi ghi file data.json:', e.message);
  }
}

function runCmd(command, args, cwd) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, msg: (stderr || err.message || '').trim().slice(-400) });
      else resolve({ ok: true, msg: (stdout || stderr || '(no output)').trim() });
    });
  });
}

// Bắt chước aki-mcp-sv panel.js installRules: .source-repo hoặc clone/pull akidevrule, rồi bash install.sh (unattended — install.sh/install.ps1 giờ là thin launcher → node install.mjs).
async function installAkiRule() {
  const recorded = fs.existsSync(RULES_SOURCE_FILE) ? fs.readFileSync(RULES_SOURCE_FILE, 'utf8').trim() : null;
  let repo = recorded && fs.existsSync(path.join(recorded, 'install.sh')) ? recorded : null;
  if (!repo) {
    if (fs.existsSync(path.join(RULES_CLONE_DIR, '.git'))) {
      const pull = await runCmd('git', ['-C', RULES_CLONE_DIR, 'pull', '--ff-only']);
      if (!pull.ok) return pull;
    } else {
      fs.mkdirSync(path.dirname(RULES_CLONE_DIR), { recursive: true });
      const clone = await runCmd('git', ['clone', '--depth', '1', RULES_REPO_URL, RULES_CLONE_DIR]);
      if (!clone.ok) return clone;
    }
    repo = RULES_CLONE_DIR;
  }
  // akidevrule ships install.ps1 for Windows on purpose: a bare `bash.exe` there resolves to the WSL
  // launcher (System32\bash.exe) and dies with "execvpe(/bin/bash) failed" when no WSL distro is installed. Choose a
  // real interpreter by platform (PowerShell on Windows, bash otherwise); never fall through to WSL bash.
  let cmd, args;
  if (process.platform === 'win32') {
    if (fs.existsSync(path.join(repo, 'install.ps1'))) {
      cmd = 'powershell';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'install.ps1')];
    } else {
      return { ok: false, msg: 'this akidevrule clone has no install.ps1 for Windows — pull the latest akidevrule and retry' };
    }
  } else {
    cmd = 'bash';
    args = [path.join(repo, 'install.sh')];
  }
  const install = await runCmd(cmd, args, repo);
  if (!install.ok && process.platform === 'win32' && /ENOENT|not found|execvpe|\/bin\/bash|WSL/i.test(install.msg)) {
    return { ok: false, msg: 'Windows install failed — install.ps1 could not run (do not use WSL bash): ' + install.msg };
  }
  const last = (install.msg || '').split('\n').filter(Boolean).pop() || install.msg;
  return { ok: install.ok, msg: `${last} (source: ${repo})`, version: getLocalVersions().current };
}

// The app's own version (repo-root package.json) — shown as the version subline under the panel title. Cached and best-effort so a standalone checkout without that package.json still boots.
let cachedAppVersion;
function getAppVersion() {
  if (cachedAppVersion !== undefined) return cachedAppVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    cachedAppVersion = (pkg && pkg.version) || null;
  } catch (e) {
    cachedAppVersion = null;
  }
  return cachedAppVersion;
}

// Injected in this order into one shared scope; postman-panel.js is the entry and must stay last.
const PAGE_FILES = ['postman-autoclick-target-match.cjs', 'postman-dom-util.js', 'postman-autoclick.js', 'postman-page-loop.js', 'postman-panel.js'];

function getScriptBundle() {
  const scriptContent = '(function () {\n' + PAGE_FILES.map((f) => fs.readFileSync(path.join(__dirname, 'page', f), 'utf8')).join('\n') + '\n})();';

  const initialConfig = loadAkiData();
  const configInjection = `
    window.__pmInitialConfig = ${JSON.stringify(initialConfig)};
    window.__pmUsageData = ${JSON.stringify(cachedUsageData)};
    window.__pmUpdateInfo = ${JSON.stringify(cachedUpdateInfo)};
    window.__pmAppVersion = ${JSON.stringify(getAppVersion())};
    window.__pmInitialInstruction = ${JSON.stringify(renderInstruction(loadInstructionFile(), identity))};
    window.__pmRuntime = ${JSON.stringify({ cdpPort: controlSession ? controlSession.port : null, daemonPid: process.pid })};
  `;

  return configInjection + '\n' + scriptContent;
}

async function setupCDP(target, port) {
  if (clients.has(target.id)) return;

  try {
    const client = await CDP({ target: target.id, port });
    clients.set(target.id, client);

    await client.Page.enable();
    await client.Runtime.enable();
    await client.Network.enable();

    // 0. Usage theo từng lượt chat — bắt tại Network.loadingFinished (SSE event "usage"), không patch window.fetch.
    hookChatUsageCapture(client);

    // 1. Tự động trích xuất access_token trực tiếp từ Postman Desktop (100% Native)
    try {
      const tokenEval = await client.Runtime.evaluate({
        expression: 'localStorage.getItem("access_token")'
      });
      const token = tokenEval && tokenEval.result && tokenEval.result.value;
      if (token) {
        if (!akiConfig || akiConfig.access_token !== token) {
          saveAkiData({ access_token: token });
          akiConfig = { ...akiConfig, access_token: token };
        }
        ensureUsageData(token).then(() => pushUsageToPage(client));
      }
    } catch (e) {}

    // 2. Binding lưu cấu hình từ UI
    try {
      await client.Runtime.addBinding({ name: '__cdpSaveAkiConfig' });
    } catch (e) {}

    // 3. Binding refresh usage
    try {
      await client.Runtime.addBinding({ name: '__cdpRefreshUsage' });
    } catch (e) {}

    // 3b. Binding install/update aki dev rule (chạy git + bash install.sh phía daemon)
    try {
      await client.Runtime.addBinding({ name: '__cdpInstallAkiRule' });
    } catch (e) {}

    // 3c. Binding "Summarize for handoff" — daemon reads the summarize prompt file and delivers it to the page
    try {
      await client.Runtime.addBinding({ name: '__cdpRequestSummarize' });
    } catch (e) {}

    client.Runtime.bindingCalled(async (event) => {
      if (event.name === '__cdpSaveAkiConfig') {
        try {
          const newConfig = JSON.parse(event.payload);
          saveAkiData(newConfig);
          akiConfig = { ...akiConfig, ...newConfig };
        } catch (err) {}
      } else if (event.name === '__cdpInstallAkiRule') {
        const result = await installAkiRule();
        if (result.ok) {
          cachedUpdateInfo = refreshLocalVersions(cachedUpdateInfo);
          pushUpdateInfoToPage(client);
        }
        pushInstallRuleResultToPage(client, result);
      } else if (event.name === '__cdpRefreshUsage') {
        let tokenToUse = null;
        if (event.payload && event.payload !== 'refresh') {
          tokenToUse = event.payload;
        }
        if (!tokenToUse) {
          const tokenEval = await client.Runtime.evaluate({
            expression: 'localStorage.getItem("access_token")'
          }).catch(() => null);
          tokenToUse = tokenEval && tokenEval.result && tokenEval.result.value;
        }
        await refreshUsageData(tokenToUse);
        pushUsageToPage(client);
      } else if (event.name === '__cdpRequestSummarize') {
        const summarizePrompt = loadSummarizePromptFile();
        client.Runtime.evaluate({
          expression: `if (typeof window.__pmDeliverSummarizePrompt === 'function') window.__pmDeliverSummarizePrompt(${JSON.stringify(summarizePrompt)});`
        }).catch(() => {});
      }
    });

    // 4. Chuyển tiếp Console Logs
    client.Runtime.consoleAPICalled((entry) => {
      const msg = entry.args.map((a) => a.value || '').join(' ');
      if (msg.includes('[⚡ AutoRun]')) {
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
      }
    });

    await client.Runtime.evaluate({ expression: getScriptBundle() });

    client.Page.loadEventFired(async () => {
      await client.Runtime.evaluate({ expression: getScriptBundle() }).catch(() => {});
    });

    client.on('disconnect', () => {
      clients.delete(target.id);
    });

    console.log(`✅ [CDP] Đã kết nối & nạp sẵn Aki Controller: "${target.title || target.url}"`);
  } catch (e) {
    if (clients.has(target.id)) {
      try {
        const c = clients.get(target.id);
        await c.close();
      } catch (_) {}
      clients.delete(target.id);
    }
  }
}

// Hosts confirmed (from live daemon logs) to be genuine Postman app/product surfaces —
// the main desktop shell and the billing views this daemon's own "View on team" button opens.
// Anything else (marketing/promo popups like "Welcome to the Postman API Network", external
// OAuth pages, ...) is left alone: no panel injected, no clutter.
const KNOWN_POSTMAN_HOSTS = ['desktop.postman.com', 'app.getpostman.com', 'postman.co'];

function isKnownPostmanSurface(url) {
  if (!url) return false; // mid-navigation targets: skip this tick, re-checked on the next
  try {
    const host = new URL(url).hostname;
    return KNOWN_POSTMAN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch (e) {
    return false;
  }
}

function writeOwnershipStatus() {
  if (!controlSession) return;
  const status = normalizeOwnershipStatus({
    daemonPid: process.pid,
    attached: !!ownerTargetId && clients.has(ownerTargetId),
    endpoint: { host: '127.0.0.1', port: controlSession.port, browserIdentity: controlSession.browserIdentity },
    ownerTargetId,
    attachedPageCount: attachedTargetIds.size,
    mode: ownershipMode,
    launchProcessPid: controlSession.launchProcessPid,
  });
  try {
    fs.mkdirSync(AKI_DATA_DIR, { recursive: true });
    const temporary = `${OWNERSHIP_STATUS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(status, null, 2));
    fs.renameSync(temporary, OWNERSHIP_STATUS_PATH);
  } catch {}
}

// Drops every attachment so the status file stops reporting a Postman that is gone. No await in here:
// close() never rejects and a sync throw is caught per client, so the status write after it always runs.
function detachAll() {
  for (const client of clients.values()) try { client.close(); } catch {}
  clients.clear();
  attachedTargetIds.clear();
  ownerTargetId = null;
}

async function discover() {
  await consumePendingNewWindow();
  if (!controlSession) return;
  let targets;
  try {
    targets = await CDP.List({ port: controlSession.port });
  } catch {
    // Postman may have quit and reopened on a new DevTools port; re-resolve the port and retry once.
    controlSession.port = PostmanSession.getDevToolsPort(controlSession.port);
    try {
      targets = await CDP.List({ port: controlSession.port });
    } catch {
      // Neither port lists targets: Postman is gone. Write that (attached: false) instead of freezing the last good tick.
      detachAll();
      writeOwnershipStatus();
      return;
    }
  }
  try {
    const currentIds = new Set(targets.map((target) => target.id));
    for (const targetId of [...attachedTargetIds]) {
      if (currentIds.has(targetId)) continue;
      attachedTargetIds.delete(targetId);
      const client = clients.get(targetId);
      if (client) try { client.close(); } catch {}
      clients.delete(targetId);
    }
    const validTargets = eligibleTargets(targets, isKnownPostmanSurface);
    for (const target of validTargets) {
      attachedTargetIds.add(target.id);
      await setupCDP(target, controlSession.port);
    }
    if (!ownerTargetId || !attachedTargetIds.has(ownerTargetId)) {
      ownerTargetId = deterministicOwnerTargetId(validTargets, isKnownPostmanSurface);
    }
    writeOwnershipStatus();
  } catch (e) {}
}

// Undoes what setupCDP's Runtime.evaluate injected (postman-panel.js): without this, the
// auto-click loop and the floating panel keep running live inside Postman's own renderer after
// the daemon exits, because they no longer depend on the CDP connection once evaluated.
const TEARDOWN_SCRIPT = `
  if (window.__pmMasterInterval) clearInterval(window.__pmMasterInterval);
  document.getElementById('aki-control-panel')?.remove();
  document.getElementById('aki-vertical-trigger')?.remove();
  document.getElementById('aki-status-bar-slot')?.remove();
  document.getElementById('aki-injected-styles')?.remove();
`;

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const teardowns = [...clients.values()].map((client) =>
    Promise.race([
      client.Runtime.evaluate({ expression: TEARDOWN_SCRIPT }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => {})
  );
  await Promise.all(teardowns);
  for (const client of clients.values()) {
    try { client.close(); } catch { /* already gone */ }
  }
  clients.clear();
  try { fs.unlinkSync(OWNERSHIP_STATUS_PATH); } catch {}
  daemonPid.release();
  process.exit(0);
}
process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
process.on('exit', () => {
  try { fs.unlinkSync(OWNERSHIP_STATUS_PATH); } catch {}
  daemonPid.release();
});

async function main() {
  await loadIdentity();
  daemonPid.claim();
  console.log('⚡ Postman CDP Daemon — non-invasive, native gateway');

  init();
  loadAkiData();
  logRuleUpdate(cachedUpdateInfo);
  refreshFromNetwork().then((info) => {
    cachedUpdateInfo = info;
    logRuleUpdate(info);
    pushUpdateInfoToAll();
  }).catch(() => {});

  controlSession = await PostmanSession.ensureRunning();
  ownershipMode = controlSession.launched ? 'launched' : 'adopted';
  if (controlSession.launched) {
    const initialTargets = await waitForEligibleTargets({
      listTargets: () => CDP.List({ port: controlSession.port }),
      isEligible: isKnownPostmanSurface,
      timeoutMs: 15000,
    });
    if (initialTargets) controlSession.targets = initialTargets;
  }
  const targets = eligibleTargets(controlSession.targets, isKnownPostmanSurface);
  for (const target of targets) attachedTargetIds.add(target.id);
  ownerTargetId = deterministicOwnerTargetId(targets, isKnownPostmanSurface);
  for (const target of targets) await setupCDP(target, controlSession.port);
  writeOwnershipStatus();
  await ensureUsageData();

  setInterval(discover, 1000);
  discover();
}

main();
