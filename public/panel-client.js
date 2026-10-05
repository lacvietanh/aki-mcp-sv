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
function icon(name) {
  const i = document.createElement('i');
  i.className = 'fa-solid fa-' + name;
  return i;
}

function setDot(el, ok) {
  el.replaceChildren(icon(ok ? 'check' : 'xmark'));
  el.className = 'dot ' + (ok ? 'ok' : 'err');
}

document.addEventListener('click', (e) => {
  const eye = e.target.closest('[data-eye]');
  if (eye) {
    const txt = eye.closest('.row').querySelector('.txt');
    const masked = txt.dataset.shown !== '1';
    txt.textContent = masked ? txt.dataset.v : '•'.repeat(12);
    txt.dataset.shown = masked ? '1' : '0';
    eye.firstElementChild.className = 'fa-solid fa-' + (masked ? 'eye-slash' : 'eye');
    return;
  }
  const el = e.target.closest('.copy');
  if (!el) return;
  const txt = el.querySelector('.txt') || el;
  navigator.clipboard.writeText(txt.dataset.v ?? txt.textContent).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1000);
  });
});

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
    lock.append(icon('lock'));
    lock.title = 'Rule-file access, locked so it cannot be revoked by accident.';
    wrap.append(input, lock);
  } else {
    input.oninput = markDirty;
    const del = document.createElement('button');
    del.append(icon('xmark'));
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
  x.append(icon('xmark')); x.onclick = () => { chip.remove(); markAllowDirty(); };
  chip.append(label, x);
  document.getElementById('cmdChips').append(chip);
}

// Restricted command: a row with its subcommand list, plus an "any" button that broadens it back to a chip.
function addRow(bin, subs) {
  const row = document.createElement('div');
  row.className = 'cmdrow'; row.dataset.bin = bin;
  if (ALWAYS_RISK[bin]) { row.classList.add('risk-hi'); row.title = '⚠ ' + ALWAYS_RISK[bin]; }
  if (bin === 'git') row.title = 'branch, tag and remote allow their read forms only; press "any" to allow every git command';
  const name = document.createElement('span');
  name.className = 'cmd-bin'; name.textContent = bin;
  const subI = document.createElement('input');
  subI.type = 'text'; subI.className = 'cmd-subs'; subI.value = subs.join(' '); subI.placeholder = 'subcommands (empty = any)';
  subI.oninput = markAllowDirty;
  const any = document.createElement('button');
  any.textContent = 'any'; any.title = 'collapse to a chip (allow any subcommand)';
  any.onclick = () => { row.remove(); addChip(bin); markAllowDirty(); };
  const x = document.createElement('button');
  x.append(icon('xmark')); x.title = 'remove'; x.onclick = () => { row.remove(); markAllowDirty(); };
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

// Editable trust zones: scripts under them run without a command row, and the file tools cannot write into them.
function markTrustedDirty() {
  document.querySelector('[data-act="saveTrusted"]').classList.add('primary');
  say('msgTrusted', 'unsaved changes', false);
}

function addTrustedDir(value, dirty) {
  const wrap = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'text'; input.value = value; input.oninput = markTrustedDirty;
  const del = document.createElement('button');
  del.append(icon('xmark')); del.onclick = () => { wrap.remove(); markTrustedDirty(); };
  wrap.append(input, del);
  document.getElementById('trustedDirs').append(wrap);
  if (dirty) markTrustedDirty();
}

function renderTrustedDirs(dirs) {
  document.getElementById('trustedDirs').innerHTML = '';
  for (const dir of dirs) addTrustedDir(dir, false);
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
  document.getElementById('newCmd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.addCmd(); } };
  document.getElementById('cmdFilter').oninput = (e) => filterCommands(e.target.value);
}

async function loadTailscale() {
  const mark = (id, ok) => {
    const el = document.getElementById(id);
    setDot(el, ok);
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
  setDot(dot, status.attached);
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
  const count = status.attachedPageCount || 0;
  return status.mode + ' · attached to ' + count + ' Postman window' + (count === 1 ? '' : 's') + ' · ' + runtime;
}

async function loadPostmanDaemon() {
  const s = await api('GET', '/api/postman-status');
  renderPostmanState(s);
  say('msgPmDaemon', postmanStatusMessage(s), s.attached);
}

// Snippets and the token field are server-rendered, so a reload is what refreshes them all at once.
function rollToken(btn, hard) {
  const warning = hard
    ? 'Roll the access token AND sign out every connected AI? Each must reconnect with the passphrase.'
    : 'Roll the access token? Tokens pasted into local snippets stop working until re-pasted.';
  if (!confirm(warning)) return;
  return act(btn, 'msgRoll', async () => {
    const { message } = await api('POST', '/api/roll-token', { hard });
    setTimeout(() => location.reload(), 800);
    return message + ' — reloading';
  });
}

let limitDefaults = {};
const limitInputs = () => [...document.querySelectorAll('[data-limit]')];
function fillLimits(limits) {
  for (const el of limitInputs()) {
    const v = limits[el.dataset.limit];
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
}
function readLimitInputs() {
  const limits = {};
  for (const el of limitInputs()) limits[el.dataset.limit] = el.type === 'checkbox' ? el.checked : Number(el.value);
  return limits;
}
function renderBlocked(blocked) {
  const list = document.getElementById('blockedList');
  if (!blocked.length) { const p = document.createElement('p'); p.className = 'helptext'; p.textContent = 'Nobody is blocked.'; return list.replaceChildren(p); }
  list.replaceChildren(...blocked.map(({ key, retryAfterSeconds }) => {
    const row = document.createElement('div');
    row.className = 'acts';
    const label = document.createElement('span');
    label.className = 'mono';
    label.textContent = `${key} — ${Math.ceil(retryAfterSeconds / 60)} min left`;
    const btn = document.createElement('button');
    btn.textContent = 'Release';
    btn.onclick = () => act(btn, 'msgBlocked', async () => { await api('POST', '/api/rate-limit/release', { key }); await loadSecurity(); return 'released'; });
    row.append(label, btn);
    return row;
  }));
}
const RELATIVE_UNITS = [['d', 86400], ['h', 3600], ['min', 60]];
function timeCell(ms, missingText = '—') {
  if (!ms) return missingText;
  const span = document.createElement('span');
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  const [unit, size] = RELATIVE_UNITS.find(([, s]) => seconds >= s) || [];
  span.textContent = unit ? `${Math.floor(seconds / size)} ${unit} ago` : 'just now';
  span.title = new Date(ms).toLocaleString();
  return span;
}
function mutedNote(text) {
  const note = document.createElement('div');
  note.className = 'helptext';
  note.textContent = text;
  return note;
}
function renderTable(containerId, columns, rows, emptyText, rowClass) {
  const container = document.getElementById(containerId);
  if (!rows.length) { const p = document.createElement('p'); p.className = 'helptext'; p.textContent = emptyText; return container.replaceChildren(p); }
  const table = document.createElement('table');
  table.className = 'datatable';
  const headRow = table.createTHead().insertRow();
  for (const [label] of columns) headRow.insertCell().textContent = label;
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    if (rowClass?.(row)) tr.className = rowClass(row);
    for (const [, cell] of columns) tr.insertCell().append(cell(row));
  }
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  wrap.append(table);
  container.replaceChildren(wrap);
}
const CLIENT_KIND_LABEL = { claude: 'Claude pre-registered', dcr: 'connector' };
function clientNameCell({ name, pending }) {
  const box = document.createElement('div');
  box.append(name || '—', mutedNote('self-declared'));
  if (pending) box.append(mutedNote('pending approval — removed after 1 h'));
  return box;
}
function removeClientButton({ clientId, kind, name, signedIn }) {
  const signOutOnly = kind === 'claude';
  if (signOutOnly && !signedIn) return '';
  const btn = document.createElement('button');
  btn.textContent = signOutOnly ? 'Sign out' : 'Remove';
  btn.onclick = () => {
    const what = signOutOnly ? `Sign out ${name}? Its Client ID and secret stay valid, so it can connect again with the passphrase.` : `Remove ${name || 'this client'}? It must connect again with the passphrase.`;
    if (!confirm(`${what}\n\nIt keeps the current access token until you press Roll token in section 1.`)) return;
    act(btn, 'msgClients', async () => {
      const { message } = await api('POST', '/api/clients/remove', { clientId });
      await loadSecurity();
      return `${message} — press Roll token in section 1 to cut its access now`;
    });
  };
  return btn;
}
function renderClients(clients) {
  renderTable('clientsList', [
    ['Name', clientNameCell],
    ['Kind', (c) => CLIENT_KIND_LABEL[c.kind] || c.kind || '—'],
    ['Redirect', (c) => c.redirectHost || '—'],
    ['Signed in', (c) => c.signedIn ? 'yes' : 'no'],
    ['First seen', (c) => timeCell(c.firstSeenAt, 'before tracking')],
    ['Last approved', (c) => timeCell(c.approvedAt)],
    ['Last token', (c) => timeCell(c.tokenAt)],
    ['Last from', (c) => [c.lastAddress, c.lastAgent].filter(Boolean).join(' · ') || '—'],
    ['', removeClientButton],
  ], clients, 'No clients registered yet.', (c) => c.pending ? 'pending' : '');
}
function renderSecurityLog({ path, lines }) {
  document.getElementById('securityLogPath').textContent = path;
  document.getElementById('securityLog').textContent = lines.length ? lines.join('\n') : 'Nothing logged yet.';
}
function renderCallers(callers) {
  renderTable('callersList', [
    ['Caller', (c) => c.key],
    ['Agent', (c) => c.agent || '—'],
    ['First seen', (c) => timeCell(c.firstSeen)],
    ['Last seen', (c) => timeCell(c.lastSeen)],
    ['Requests', (c) => String(c.requests)],
  ], callers, 'No one has used the token since the last restart.');
}
async function loadSecurity() {
  const { limits, defaults, blocked, clients, callers, log } = await api('GET', '/api/security');
  limitDefaults = defaults;
  fillLimits(limits);
  renderBlocked(blocked);
  renderClients(clients);
  renderCallers(callers);
  renderSecurityLog(log);
}

function providerSwitch(p) {
  if (p.required) return 'always on';
  const label = document.createElement('label');
  label.className = 'chk';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = p.enabled;
  box.onchange = () => act(box, 'msgProviders', async () => {
    renderProviders(await api('POST', '/api/providers', { id: p.id, enabled: box.checked }));
    return `${p.title} switched ${box.checked ? 'on' : 'off'}; AI clients see it on their next tool list`;
  });
  label.append(box, p.enabled ? 'on' : 'off');
  return label;
}
function providerInstalledCell(p) {
  const box = document.createElement('div');
  box.append(p.available ? 'yes' : 'no');
  if (!p.available) box.append(mutedNote(p.reason));
  return box;
}
function renderProviders(list) {
  renderTable('providersList', [
    ['Provider', (p) => p.title],
    ['Installed', providerInstalledCell],
    ['Tools', (p) => p.tools.map((n) => n.replace(/^aki__/, '')).join(', ')],
    ['Switch', providerSwitch],
  ], list, 'No providers.', (p) => (p.available && p.enabled ? '' : 'off'));
  document.querySelectorAll('#providersList td:nth-child(3)').forEach((td) => td.classList.add('wrap'));
}
async function loadProviders() {
  renderProviders(await api('GET', '/api/providers'));
}

let logDefaults = {};
const logInputs = () => [...document.querySelectorAll('[data-log]')];
function fillLog(s) {
  for (const el of logInputs()) {
    const v = s[el.dataset.log];
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
}
function readLogInputs() {
  const s = {};
  for (const el of logInputs()) s[el.dataset.log] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  return s;
}
async function loadLog() {
  const { settings, defaults } = await api('GET', '/api/log');
  logDefaults = defaults;
  fillLog(settings);
}

const ACTIONS = {
  redetectProviders: (btn) => act(btn, 'msgProviders', async () => {
    renderProviders(await api('POST', '/api/providers', { redetect: true }));
    return 'detected again';
  }),
  saveLimits: (btn) => act(btn, 'msgLimits', async () => (await api('POST', '/api/rate-limit', { limits: readLimitInputs() })).message),
  saveLog: (btn) => act(btn, 'msgLogSettings', async () => (await api('POST', '/api/log', { log: readLogInputs() })).message),
  resetLog: () => { fillLog(logDefaults); say('msgLogSettings', 'defaults filled in — press Save to apply', true); },
  resetLimits: () => { fillLimits(limitDefaults); say('msgLimits', 'defaults filled in — press Save to apply', true); },
  refreshBlocked: (btn) => act(btn, 'msgBlocked', async () => { await loadSecurity(); return 'refreshed'; }),
  refreshLog: (btn) => act(btn, 'msgLog', async () => { await loadSecurity(); return 'refreshed'; }),
  releaseAll: (btn) => act(btn, 'msgBlocked', async () => { await api('POST', '/api/rate-limit/release', {}); await loadSecurity(); return 'everyone released'; }),
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
  addTrusted: () => { addTrustedDir('', true); document.querySelector('#trustedDirs input:last-of-type')?.focus(); },
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
    setTimeout(() => location.reload(), 800);
    return message + ' — reloading';
  }),
  rollToken: (btn) => rollToken(btn, false),
  rollTokenHard: (btn) => rollToken(btn, true),
  rollPassphrase: (btn) => {
    if (!confirm('Roll the passphrase? The old one stops working for new connections; connected AIs are not signed out.')) return;
    return act(btn, 'msgRoll', async () => {
      const { message } = await api('POST', '/api/roll-passphrase');
      setTimeout(() => location.reload(), 800);
      return message + ' — reloading';
    });
  },
  agyApply: (btn) => act(btn, 'msgAgy', async () => (await api('POST', '/api/agy-apply-mcp')).message),
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
    // Reload so the server re-renders the section-2 badge, hero version pill and update-bar from fresh state.
    setTimeout(() => location.reload(), 800);
    return message + ' — reloading';
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
loadSecurity().catch((e) => say('msgLimits', e.message, false));
loadProviders().catch((e) => say('msgProviders', e.message, false));
loadLog().catch((e) => say('msgLogSettings', e.message, false));
loadPostmanDaemon().catch((e) => { document.getElementById('msgPmDaemon').textContent = e.message; });
