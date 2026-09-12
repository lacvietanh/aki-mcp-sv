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
  a.title = (sec.querySelector('h2')?.textContent || sec.id).replace(/\s+(done|optional)$/i, '').trim();
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
  const lines = ['[akimcp ' + MCP_VERSION + '] Short, dense, on-point. Zero yapping. Claim=evidence.'];
  const rulesOn = document.getElementById('loadRules').checked;
  if (rulesOn) {
    lines.push('Before first substantive action, call aki__akidevrule_context() once with workingPath; follow loaded receipt rules.');
  }
  lines.push('Tools: find_path/search_content (files), run_cmd (shell allowlist), chrome_launch/chrome_interact (browser), local_fetch (localhost/LAN API).');
  lines.push('Task (mutate/multi-step): confirm scope; plan $HOME/.aki/mcpsv/task/<id>/plan.md. Skip pure Q&A.');
  const value = lines.join('\n');
  document.getElementById('prompt').value = value;
  const over = value.length > 1500;
  const count = document.getElementById('promptCount');
  count.textContent = value.length + ' chars' + (over ? ', over ChatGPT\'s 1500 cap' : '');
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
    add(row.dataset.bin, subs ? subs.split(/\s+/) : null);
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
    checks.innerHTML = '<span class="empty">akidevrule isn\'t installed yet; install it in section 2 above, or skip and use the prompt without rules.</span>';
    return;
  }
  // index.md is the rule map — always first, and locked so it can't be unchecked.
  const sorted = [...files].sort((a, b) => (a === 'index.md' ? -1 : b === 'index.md' ? 1 : 0));
  for (const f of sorted) {
    const label = document.createElement('label');
    const locked = f === 'index.md';
    const checked = locked || DEFAULT_RULES.includes(f);
    label.innerHTML = '<input type="checkbox" value="' + f + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + '>';
    label.append(document.createTextNode(f.replace(/^(RULE|METHOD)-/, '').replace(/\.md$/, '') + (locked ? ' 🔒' : '')));
    checks.append(label);
  }
}

// Built via DOM nodes, not innerHTML, so the user-typed origin can never be interpreted as markup.
function renderSavedIngress(saved) {
  const box = document.getElementById('savedIngressBox');
  box.innerHTML = '';
  if (!saved || saved.mode !== 'cloudflared') return;
  const p = document.createElement('p');
  p.className = 'helptext';
  const code = document.createElement('span');
  code.className = 'mono';
  code.textContent = saved.origin;
  const btn = document.createElement('button');
  btn.textContent = 'Use Tailscale Funnel instead';
  btn.onclick = () => ACTIONS.clearTunnel(btn);
  p.append('Saved: cloudflared tunnel → ', code, ' (takes effect after restart). ', btn);
  box.append(p);
}

// Pure visibility toggle: hides non-matching chips/rows, never touches collectAllowlist()'s data. Position matters (above #cmdChips, below the add-input at the bottom): a filter box and an add box that looked identical would collide in the user's mental model.
function filterCommands(q) {
  const needle = q.trim().toLowerCase();
  for (const el of document.querySelectorAll('#cmdChips .chip, #cmdRows .cmdrow')) {
    el.style.display = el.dataset.bin.toLowerCase().includes(needle) ? '' : 'none';
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
  document.getElementById('cmdFilter').oninput = (e) => filterCommands(e.target.value);
  buildPrompt();
}

async function loadTailscale() {
  const mark = (id, ok) => {
    const el = document.getElementById(id);
    el.textContent = ok ? '✓' : '✕';
    el.className = 'dot ' + (ok ? 'ok' : 'err');
  };
  const s = await api('GET', '/api/tailscale');
  mark('tsInstalled', s.installed);
  mark('tsFunnel', s.funnel);
  if (!s.installed) return 'tailscale command not found on this machine';
  if (!s.funnel) return 'Tailscale is installed, Funnel for port 9999 is still missing';
  return 'ready: ' + (s.host || 'domain not available yet');
}

function renderPostmanState(status) {
  const dot = document.getElementById('pmDaemonDot');
  dot.textContent = status.attached ? '✓' : '✕';
  dot.className = 'dot ' + (status.attached ? 'ok' : 'err');
  document.getElementById('pmBtnLaunch').hidden = status.running;
  document.getElementById('pmBtnQuit').hidden = !status.running;
  const newWindow = document.getElementById('pmBtnNewWindow');
  newWindow.hidden = !status.running;
  newWindow.disabled = !status.attached || !status.ownerTargetId;
}

function postmanStatusMessage(status) {
  if (!status.running) return 'not running — click Launch above';
  const endpoint = status.endpoint;
  const cdp = endpoint && endpoint.port ? ' · CDP ' + (endpoint.host || '127.0.0.1') + ':' + endpoint.port : '';
  const runtime = 'daemon PID ' + status.daemonPid + cdp;
  if (!status.attached) return 'waiting for a Postman window · ' + runtime;
  const count = status.attachedWindowCount || 0;
  return status.mode + ' · attached to ' + count + ' Postman window' + (count === 1 ? '' : 's') + ' · ' + runtime;
}

async function loadPostmanDaemon() {
  const s = await api('GET', '/api/postman-status');
  renderPostmanState(s);
  say('msgPmDaemon', postmanStatusMessage(s), s.attached);
}

const ACTIONS = {
  tailscale: (btn) => act(btn, 'msgTs', loadTailscale),
  // Buttons flip only from the handler's real running/pid — never before spawn/kill returns.
  launchPostman: (btn) => act(btn, 'msgPmDaemon', async () => {
    const s = await api('POST', '/api/postman-launch');
    renderPostmanState(s);
    return s.message;
  }),
  quitPostman: (btn) => act(btn, 'msgPmDaemon', async () => {
    const s = await api('POST', '/api/postman-quit');
    renderPostmanState(s);
    return s.message;
  }),
  newWindowPostman: (btn) => act(btn, 'msgPmDaemon', async () => (await api('POST', '/api/postman-new-window')).message),
  addFolder: (btn) => { addPath('', true); document.querySelector('#paths input:last-of-type')?.focus(); },
  savePaths: (btn) => act(btn, 'msgPaths', async () => {
    const paths = [...document.querySelectorAll('#paths input')].map((i) => i.value.trim()).filter(Boolean);
    if (!paths.length) throw new Error('an empty list cuts off all of Claude\'s file access; add at least one folder');
    // Case-insensitive by full path, matching section 6's already-sorted chips — one sort rule shared by both list editors. Locked rows sort in place with the rest.
    paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const { message } = await api('POST', '/api/paths', { paths });
    btn.classList.remove('primary');
    return message;
  }),
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
  saveTunnel: (btn) => act(btn, 'msgTunnel', async () => {
    const fileInput = document.getElementById('tunnelCredFile');
    const file = fileInput.files[0];
    if (!file) throw new Error('choose a cloudflared credentials JSON file first');
    const credContent = await file.text();
    const origin = document.getElementById('tunnelOriginInput').value;
    const { message, saved } = await api('POST', '/api/ingress/cloudflared', { credContent, origin });
    renderSavedIngress(saved);
    fileInput.value = '';
    return message;
  }),
  clearTunnel: (btn) => act(btn, 'msgTunnel', async () => {
    const { message } = await api('POST', '/api/ingress/clear');
    renderSavedIngress(null);
    return message;
  }),
  updateRules: (btn) => act(btn, 'msgUpdRule', async () => {
    const { message } = await api('POST', '/api/install-rules');
    renderRuleChecks((await api('GET', '/api/state')).ruleFiles);
    buildPrompt();
    // The banner and section-3 warning both claimed a stale corpus; the update just cleared it.
    document.querySelector('.updrule')?.remove();
    document.getElementById('s3warn')?.remove();
    if (!document.querySelector('.updbar .updrow')) document.querySelector('.updbar')?.remove();
    return message;
  }),
  registerDomain: (btn) => act(btn, 'msgDomain', async () => {
    const subdomain = document.getElementById('subdomainInput').value.trim();
    if (!subdomain) throw new Error('enter a subdomain name first');
    const select = document.getElementById('tldSelect');
    const tld = select.value;
    const price = select.selectedOptions[0].dataset.price;
    const domain = subdomain + '.' + tld;
    const text = 'Tôi cần mua subdomain ' + domain + ' (~$' + price + '/năm).';
    window.open('https://m.me/akitaoglobal?text=' + encodeURIComponent(text), '_blank');
    return 'opened Messenger to request ' + domain;
  }),
};

document.querySelectorAll('[data-act]').forEach((btn) => (btn.onclick = () => ACTIONS[btn.dataset.act](btn)));

// Scoped per section: 2 independent .tabs groups now share the page, so a global toggle would deactivate one group whenever the other's tab was clicked.
document.querySelectorAll('.tabs').forEach((nav) => {
  const scope = nav.closest('section');
  nav.querySelectorAll('.tab').forEach((tab) => (tab.onclick = () => {
    scope.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
  }));
});

function updateDomainPrice() {
  const opt = document.getElementById('tldSelect').selectedOptions[0];
  const note = opt.dataset.note ? ' — ' + opt.dataset.note : '';
  document.getElementById('domainPrice').textContent = '$' + opt.dataset.price + '/yr' + note;
}
document.getElementById('tldSelect').onchange = updateDomainPrice;
updateDomainPrice();

const DONATE_QR = {
  momo: { src: '/QR-MOMO-LACVIETANH.jpg', alt: 'MoMo donate QR' },
  paypal: { src: '/QR-AkiTao-PayPal.png', alt: 'PayPal donate QR' },
};
document.querySelectorAll('.qr-tab').forEach((btn) => (btn.onclick = () => {
  const q = DONATE_QR[btn.dataset.qr];
  const img = document.getElementById('donateQr');
  img.src = q.src; img.alt = q.alt;
  document.querySelectorAll('.qr-tab').forEach((b) => b.classList.toggle('active', b === btn));
}));

renderSavedIngress(SAVED_INGRESS);

// One failed /api/state leaves three sections blank, so the failure is reported next to each of them.
loadState().catch((e) => ['msgPaths', 'msgAllow', 'msgTrusted', 'msgRules'].forEach((id) => say(id, e.message, false)));
loadTailscale().then((m) => say('msgTs', m, m.startsWith('ready'))).catch((e) => say('msgTs', e.message, false));
loadPostmanDaemon().catch((e) => { document.getElementById('msgPmDaemon').textContent = e.message; });
