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
const { fetchAllUsage } = require('./scripts/cdp-usage');
const { PostmanSession } = require('./scripts/postman-session');
const { eligibleTargets, attachmentTargets, deterministicOwnerTargetId, waitForEligibleTargets, openOwnedWindow } = require('./scripts/postman-ownership');
const { loadInstruction, copyDefaultIfMissing } = require('./scripts/instruction-store');
const daemonPid = require('./scripts/daemon-pid');
const {
  checkForUpdate,
  localSnapshot,
  refreshLocalVersions,
  getLocalVersions,
  RULES_DIR,
} = require('./scripts/update-check');

// Writable runtime/user data, shared SSoT with the main server's scripts/userdata.js (USER_DIR = ~/.aki/mcpsv); redefined here since this CommonJS daemon can't import that ESM module.
const AKI_DATA_DIR = process.env.AKI_DATA_DIR || path.join(os.homedir(), '.aki', 'mcpsv');
const PROMPTS_DIR = path.join(AKI_DATA_DIR, 'prompts');
const ASSETS_PROMPTS_DIR = path.join(__dirname, 'assets', 'prompts');
const PROVIDER = 'postman';
const SUM_PROMPT_NAME = 'aki-prompt-sum-to-new-chat.md';
const DEFAULT_PROMPT_PATH = path.join(ASSETS_PROMPTS_DIR, `${PROVIDER}.md`);
const SHARED_PROMPT_USER_PATH = path.join(PROMPTS_DIR, SUM_PROMPT_NAME);
const SHARED_PROMPT_DEFAULT_PATH = path.join(ASSETS_PROMPTS_DIR, SUM_PROMPT_NAME);

// Writable runtime dir for daemon state (data.json/ownership-status/usage-turns). The Postman instruction is now served natively read-only from the bundled repo asset — no user-editable copy, no legacy fallback.
const LEGACY_CDP_DIR = path.join(os.homedir(), '.aki', 'cdp-postman');
const DATA_JSON_PATH = path.join(LEGACY_CDP_DIR, 'data.json');
const OWNERSHIP_STATUS_PATH = path.join(LEGACY_CDP_DIR, 'ownership-status.json');
const RULES_SOURCE_FILE = path.join(RULES_DIR, '.source-repo');
const RULES_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULES_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';

const clients = new Map();
const attachedTargetIds = new Set();
let controlSession = null;
let ownerTargetId = null;
let ownershipMode = null;
let cachedUsageData = null;
let cachedUpdateInfo = localSnapshot();
let akiConfig = null;
let loggedMissingRule = false;
const CHAT_URL_RE = /gateway\.postman\.com\/chat/i;

// Per-turn usage instrumentation: the chat SSE only carries the weekly team-pool `usage` (millicredits), never a per-chat token count, so this logs one JSONL row per turn (keyed by conversationId+model, next to data.json) to test whether the delta tracks a single conversation's context growth. Best-effort; analyzed offline after a live run.
const TURN_LOG_PATH = path.join(LEGACY_CDP_DIR, 'usage-turns.jsonl');
const convoState = new Map(); // conversationId -> { turns, startUsage, lastUsage }
let lastGlobalUsageMilli = null;

async function refreshUsageData(customToken = null) {
  cachedUsageData = await fetchAllUsage(customToken);
  return cachedUsageData;
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

    // conversationId + model come straight from the request body: authoritative for follow-up turns (turn 1 sends conversationId=null, so the response `conversation` event fills it in).
    let reqConvoId = null;
    let reqModel = null;
    try {
      let post = req.postData;
      if (!post && req.hasPostData) {
        const r = await client.Network.getRequestPostData({ requestId: params.requestId }).catch(() => null);
        post = r && r.postData;
      }
      if (post) {
        const body = JSON.parse(post);
        reqConvoId = (body.input && body.input.conversationId) || null;
        reqModel = (body.devModeOptions && body.devModeOptions.selectedModel) || null;
      }
    } catch (e) {}

    pending.set(params.requestId, { teamId, reqConvoId, reqModel });
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
  let convo = null;
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.eventType === 'usage' && evt.data && typeof evt.data.limit === 'number') latest = evt.data;
      else if (evt.eventType === 'conversation' && evt.data && evt.data.id) convo = evt.data;
    } catch (e) {}
  }
  if (!latest) return;

  // Log the turn even before the REST usage snapshot has loaded — validation must not miss turns.
  logUsageTurn(ctx, latest, convo);

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

// Appends one JSONL row per turn for offline validation (docs/research/session-context-capture.md); delta = usageMilli minus the previous same-conversation reading (falls back to the last global reading), so a positive monotonic delta signals context growth — noisy when isTeamPooled (shared pool).
function logUsageTurn(ctx, latest, convo) {
  try {
    const usageMilli = latest.usage || 0;
    const convoId = (convo && convo.id) || (ctx && ctx.reqConvoId) || null;
    const model = (ctx && ctx.reqModel) || (convo && convo.modelKey) || null;

    let st = convoId ? convoState.get(convoId) : null;
    let prevUsage;
    if (convoId) {
      if (!st) { st = { turns: 0, startUsage: usageMilli, lastUsage: usageMilli }; convoState.set(convoId, st); }
      prevUsage = st.lastUsage;
    } else {
      prevUsage = (lastGlobalUsageMilli == null) ? usageMilli : lastGlobalUsageMilli;
    }
    const deltaMilli = usageMilli - prevUsage;
    if (st) { st.turns += 1; st.lastUsage = usageMilli; }
    lastGlobalUsageMilli = usageMilli;

    const rec = {
      ts: new Date().toISOString(),
      teamId: (ctx && ctx.teamId) || null,
      conversationId: convoId,
      model,
      turn: st ? st.turns : null,
      usageMilli,
      limitMilli: latest.limit || 0,
      deltaMilli,
      cumulativeMilli: st ? (usageMilli - st.startUsage) : null,
      isTeamPooled: !!latest.isTeamPooled
    };
    fs.appendFileSync(TURN_LOG_PATH, JSON.stringify(rec) + '\n', 'utf8');
    const turnStr = rec.turn == null ? '?' : rec.turn;
    const cumStr = rec.cumulativeMilli == null ? 'n/a' : (rec.cumulativeMilli / 1000).toFixed(2) + 'cr';
    console.log(`[usage] turn=${turnStr} convo=${convoId ? convoId.slice(0, 8) : 'n/a'} model=${model || '?'} Δ=${(deltaMilli / 1000).toFixed(2)}cr cum=${cumStr}`);
  } catch (e) {}
}

// Panel → daemon IPC for the "New window" panel button (scripts/panel.js's
// POST /api/postman-new-window, via postman-mcp.js's requestNewWindow): a flag file next to
// data.json is the smallest transport that works — the panel is the only writer, this is the
// only reader/deleter, and it rides discover()'s existing 1s tick instead of a new interval.
const NEW_WINDOW_FLAG_PATH = path.join(LEGACY_CDP_DIR, 'new-window.flag');

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
    if (!fs.existsSync(LEGACY_CDP_DIR)) {
      fs.mkdirSync(LEGACY_CDP_DIR, { recursive: true });
    }
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

// Bắt chước aki-mcp-sv panel.js installRules: .source-repo hoặc clone/pull akidevrule, rồi bash install.sh (unattended — install.py chỉ prompt khi stdin là TTY).
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
  // akidevrule ships install.ps1 / install.py for Windows on purpose: a bare `bash.exe` there resolves to the WSL
  // launcher (System32\bash.exe) and dies with "execvpe(/bin/bash) failed" when no WSL distro is installed. Choose a
  // real interpreter by platform + whichever installer this clone actually ships; never fall through to WSL bash.
  let cmd, args;
  if (process.platform === 'win32') {
    if (fs.existsSync(path.join(repo, 'install.ps1'))) {
      cmd = 'powershell';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'install.ps1')];
    } else if (fs.existsSync(path.join(repo, 'install.py'))) {
      cmd = 'py';
      args = ['-3', path.join(repo, 'install.py')];
    } else {
      return { ok: false, msg: 'this akidevrule clone has no install.ps1 / install.py for Windows — pull the latest akidevrule and retry' };
    }
  } else {
    cmd = 'bash';
    args = [path.join(repo, 'install.sh')];
  }
  const install = await runCmd(cmd, args, repo);
  if (!install.ok && process.platform === 'win32' && /ENOENT|not found|execvpe|\/bin\/bash|WSL/i.test(install.msg)) {
    return { ok: false, msg: 'Windows install failed — install.ps1/install.py could not run (do not use WSL bash): ' + install.msg };
  }
  const last = (install.msg || '').split('\n').filter(Boolean).pop() || install.msg;
  return { ok: install.ok, msg: `${last} (source: ${repo})`, version: getLocalVersions().current };
}

// The app's own version (repo-root package.json) — shown as the version subline under the panel title. Cached and best-effort so a standalone/lab checkout without that package.json still boots.
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

function getScriptBundle() {
  const scriptsDir = path.join(__dirname, 'scripts');
  const autoclickerPath = path.join(scriptsDir, 'cdp-autoclicker.js');
  const matcherPath = path.join(scriptsDir, 'autoclick-target-match.js');
  let scriptContent = '';
  if (fs.existsSync(autoclickerPath)) {
    const matcherContent = fs.existsSync(matcherPath) ? fs.readFileSync(matcherPath, 'utf8') : '';
    scriptContent = matcherContent + '\n' + fs.readFileSync(autoclickerPath, 'utf8');
  }

  const initialConfig = loadAkiData();
  const configInjection = `
    window.__pmInitialConfig = ${JSON.stringify(initialConfig)};
    window.__pmUsageData = ${JSON.stringify(cachedUsageData)};
    window.__pmUpdateInfo = ${JSON.stringify(cachedUpdateInfo)};
    window.__pmAppVersion = ${JSON.stringify(getAppVersion())};
    window.__pmInitialInstruction = ${JSON.stringify(loadInstructionFile())};
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
        saveAkiData({ access_token: token });
        refreshUsageData(token).then(() => pushUsageToPage(client));
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
  const status = {
    daemonPid: process.pid,
    attached: !!ownerTargetId && clients.has(ownerTargetId),
    endpoint: { host: '127.0.0.1', port: controlSession.port, browserIdentity: controlSession.browserIdentity },
    ownerTargetId,
    attachedWindowCount: attachedTargetIds.size,
    mode: ownershipMode,
    launchProcessPid: controlSession.launchProcessPid,
  };
  try {
    fs.mkdirSync(LEGACY_CDP_DIR, { recursive: true });
    const temporary = `${OWNERSHIP_STATUS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(status, null, 2));
    fs.renameSync(temporary, OWNERSHIP_STATUS_PATH);
  } catch {}
}

async function discover() {
  await consumePendingNewWindow();
  if (!controlSession) return;
  try {
    const targets = await CDP.List({ port: controlSession.port });
    const currentIds = new Set(targets.map((target) => target.id));
    for (const targetId of [...attachedTargetIds]) {
      if (currentIds.has(targetId)) continue;
      attachedTargetIds.delete(targetId);
      const client = clients.get(targetId);
      if (client) try { client.close(); } catch {}
      clients.delete(targetId);
    }
    const validTargets = attachmentTargets(targets, isKnownPostmanSurface);
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

// Undoes what setupCDP's Runtime.evaluate injected (cdp-autoclicker.js): without this, the
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
  daemonPid.claim();
  console.log('⚡ Postman CDP Daemon — non-invasive, native gateway');

  init();
  loadAkiData();
  logRuleUpdate(cachedUpdateInfo);
  checkForUpdate().then((info) => {
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
  const targets = attachmentTargets(controlSession.targets, isKnownPostmanSurface);
  for (const target of targets) attachedTargetIds.add(target.id);
  ownerTargetId = deterministicOwnerTargetId(targets, isKnownPostmanSurface);
  for (const target of targets) await setupCDP(target, controlSession.port);
  writeOwnershipStatus();
  await refreshUsageData();

  setInterval(discover, 1000);
  discover();
}

main();
