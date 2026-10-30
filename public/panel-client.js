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
    const txt = eye.closest('.row, .snip').querySelector('.txt');
    const reveal = txt.dataset.shown !== '1';
    txt.textContent = reveal ? txt.dataset.v : txt.dataset.mask;
    txt.dataset.shown = reveal ? '1' : '0';
    eye.firstElementChild.className = 'fa-solid fa-' + (reveal ? 'eye-slash' : 'eye');
    eye.title = `${reveal ? 'Hide' : 'Show'} ${eye.dataset.label}`;
    eye.setAttribute('aria-label', eye.title);
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

// Hide, never remove: collectAllowlist() reads every chip, so saving while filtered keeps the hidden ones. Kept above the chips, apart from the add box below, so the two never look alike.
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

// Snippets and the token field are server-rendered, so a reload is what refreshes them all at once; the open tab and the roll reply cross it in a one-shot key that only a roll writes.
const RESTORE_KEY = 'akiRestore';
function reloadKeepingTab(message, resultId = 'msgRoll') {
  sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ tab: document.querySelector('#s1 .tab.active').dataset.tab, message, resultId }));
  setTimeout(() => location.reload(), 800);
}
function rollToken(btn, hard) {
  const warning = hard
    ? 'Roll the access token AND sign out every connected AI? Each must reconnect with the passphrase.'
    : 'Roll the access token? Tokens pasted into local snippets stop working until re-pasted.';
  if (!confirm(warning)) return;
  return act(btn, 'msgRoll', async () => {
    const { message } = await api('POST', '/api/roll-token', { hard });
    reloadKeepingTab(message);
    return message + ' — reloading';
  });
}

const untilText = (ms) => {
  const minutes = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
function revokeTempButton({ id }) {
  const btn = document.createElement('button');
  btn.textContent = 'Revoke';
  btn.onclick = () => act(btn, 'msgTemp', async () => {
    const { message } = await api('POST', '/api/temp-token/revoke', { id });
    await loadTempTokens();
    return message;
  });
  return btn;
}
async function loadTempTokens() {
  const { tokens } = await api('GET', '/api/temp-tokens');
  renderTable('tempList', [
    ['Created', (t) => timeCell(t.created), { sortValue: (t) => t.created }],
    ['Expires in', (t) => untilText(t.expires), { sortValue: (t) => t.expires }],
    ['', revokeTempButton, NOT_SORTABLE],
  ], tokens, 'No active temporary tokens. Mint one above when you start a web chat.');
  document.getElementById('revokeAllTemp').hidden = tokens.length < 2;
  if (!tokens.length) for (const id of ['tempKickoff', 'tempKickoffNote']) document.getElementById(id).hidden = true;
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
const tableSort = {};
const SORT_CYCLE = { asc: 'desc', desc: null };
const SORT_ICON = { asc: 'sort-up', desc: 'sort-down' };
const NOT_SORTABLE = { sortable: false };
// A cell is [label, cellFn, { sortable, sortValue }?]; sortValue returns the raw value (epoch ms, count), so timestamps sort as numbers while the cell shows "3 h ago".
function sortValueOf([, cell, options]) {
  if (options?.sortValue) return options.sortValue;
  return (row) => { const content = cell(row); return content instanceof Node ? content.textContent : content; };
}
function sortHeader(label, direction, onSort) {
  const th = document.createElement('th');
  th.scope = 'col';
  th.append(label);
  if (!onSort) return th;
  th.dataset.sort = direction || 'none';
  th.setAttribute('aria-sort', { asc: 'ascending', desc: 'descending' }[direction] || 'none');
  th.tabIndex = 0;
  th.append(icon(direction ? SORT_ICON[direction] : 'sort'));
  th.onclick = onSort;
  th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); } };
  return th;
}
function renderTable(containerId, columns, rows, emptyText, rowClass) {
  const container = document.getElementById(containerId);
  if (!rows.length) { const p = document.createElement('p'); p.className = 'helptext'; p.textContent = emptyText; return container.replaceChildren(p); }
  const { index, dir } = tableSort[containerId] || {};
  const sortedBy = columns[index];
  const valueOf = sortedBy && sortValueOf(sortedBy);
  const shown = sortedBy ? [...rows].sort((a, b) => compareTableValues(valueOf(a), valueOf(b), dir)) : rows;
  const cycle = (i) => {
    const next = index === i ? SORT_CYCLE[dir] : 'asc';
    if (next) tableSort[containerId] = { index: i, dir: next }; else delete tableSort[containerId];
    renderTable(containerId, columns, rows, emptyText, rowClass);
  };
  const table = document.createElement('table');
  table.className = 'datatable';
  table.createTHead().insertRow().append(...columns.map(([label, , options], i) => sortHeader(label, index === i ? dir : null, options?.sortable === false ? null : () => cycle(i))));
  const body = table.createTBody();
  for (const row of shown) {
    const tr = body.insertRow();
    if (rowClass?.(row)) tr.className = rowClass(row);
    for (const [, cell] of columns) tr.insertCell().append(cell(row));
  }
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  wrap.append(table);
  container.replaceChildren(wrap);
}

// Filter state lives here, not in the re-rendered table, so loadSecurity()'s redraw keeps what was typed; the inputs themselves are static page HTML.
const tableFilters = { clientsList: { text: '', status: 'all' }, callersList: { text: '' } };
const loadedRows = { clientsList: [], callersList: [] };
const CLIENT_STATUS = {
  all: () => true,
  signedin: (c) => c.signedIn,
  pending: (c) => c.pending,
  signedout: (c) => !c.signedIn && !c.pending,
};
const matchesText = (fields, text) => fields.filter(Boolean).join(' ').toLowerCase().includes(text.trim().toLowerCase());
const COUNT_NOUN = { clientsList: 'clients', callersList: 'callers' };
function filterRows(containerId, rows, matches) {
  const kept = rows.filter(matches);
  const filtering = Object.values(tableFilters[containerId]).some((value) => value && value !== 'all');
  document.querySelector('[data-count="' + containerId + '"]').textContent = filtering ? kept.length + ' of ' + rows.length : rows.length + ' ' + COUNT_NOUN[containerId];
  return kept;
}
const CLIENT_KIND_LABEL = { static: 'pre-issued', dcr: 'connector' };
function clientNameCell({ name, pending }) {
  const box = document.createElement('div');
  box.append(name || '—', mutedNote('self-declared'));
  if (pending) box.append(mutedNote('pending approval — removed after 1 h'));
  return box;
}
function clientActionButton({ text, confirmText, clientId, roll, note = '' }) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.onclick = () => {
    if (!confirm(confirmText)) return;
    act(btn, 'msgClients', async () => {
      const { message } = await api('POST', '/api/clients/remove', { clientId, roll });
      if (roll) { reloadKeepingTab(message, 'msgClients'); return message + ' — reloading'; }
      await loadSecurity();
      return message + note;
    });
  };
  return btn;
}
const ROLL_COLLATERAL = 'Every other client is affected too: signed-in connectors renew on their next request (ClickUp may need one reconnect); Bearer clients (Buda, local Claude Code, Codex, Cursor) need the new token — click Apply again or re-paste.';
function removeClientButton({ clientId, kind, name, signedIn, tokenAt }) {
  const signOutOnly = kind === 'static';
  if (signOutOnly && !signedIn) return '';
  const who = name || 'this client';
  if (tokenAt == null && !signedIn) return clientActionButton({ text: 'Delete', confirmText: 'Delete ' + who + '?', clientId, roll: false });
  const verb = signOutOnly ? 'Sign out' : 'Remove';
  const keepsAccess = signOutOnly ? ' Its Client ID and secret stay valid, so it can connect again with the passphrase.' : ' It must connect again with the passphrase.';
  const box = document.createDocumentFragment();
  box.append(
    clientActionButton({ text: 'Revoke & roll', confirmText: verb + ' ' + who + ' and roll the access token?\n\nIt loses access now. ' + ROLL_COLLATERAL, clientId, roll: true }),
    clientActionButton({ text: signOutOnly ? 'Sign out only' : 'Remove only', confirmText: verb + ' ' + who + '?' + keepsAccess + '\n\nIts current access token keeps working until you press Roll token in section 1.', clientId, roll: false, note: ' — its current access token works until you press Roll token in section 1' }),
  );
  return box;
}
function renderClients(clients) {
  loadedRows.clientsList = clients;
  const { text, status } = tableFilters.clientsList;
  const shown = filterRows('clientsList', clients, (c) => CLIENT_STATUS[status](c) && matchesText([c.name, c.kind, CLIENT_KIND_LABEL[c.kind], c.redirectHost, c.lastAddress, c.lastAgent], text));
  renderTable('clientsList', [
    ['Name', clientNameCell, { sortValue: (c) => c.name }],
    ['Kind', (c) => CLIENT_KIND_LABEL[c.kind] || c.kind || '—', { sortValue: (c) => CLIENT_KIND_LABEL[c.kind] || c.kind }],
    ['Redirect', (c) => c.redirectHost || (c.kind === 'static' ? 'any allowed callback' : '—'), { sortValue: (c) => c.redirectHost }],
    ['Signed in', (c) => c.signedIn ? 'yes' : 'no', { sortValue: (c) => Number(c.signedIn) }],
    ['First seen', (c) => timeCell(c.firstSeenAt, 'before tracking'), { sortValue: (c) => c.firstSeenAt }],
    ['Last approved', (c) => timeCell(c.approvedAt), { sortValue: (c) => c.approvedAt }],
    ['Last token', (c) => timeCell(c.tokenAt), { sortValue: (c) => c.tokenAt }],
    ['Last from', (c) => [c.lastAddress, c.lastAgent].filter(Boolean).join(' · ') || '—', { sortValue: (c) => c.lastAddress }],
    ['', removeClientButton, NOT_SORTABLE],
  ], shown, clients.length ? 'No client matches the filter.' : 'No clients registered yet.', (c) => c.pending ? 'pending' : '');
}
function renderSecurityLog({ path, lines }) {
  document.getElementById('securityLogPath').textContent = path;
  document.getElementById('securityLog').textContent = lines.length ? lines.join('\n') : 'Nothing logged yet.';
}
function renderCallers(callers) {
  loadedRows.callersList = callers;
  const shown = filterRows('callersList', callers, (c) => matchesText([c.key, c.agent], tableFilters.callersList.text));
  renderTable('callersList', [
    ['Caller', (c) => c.key, { sortValue: (c) => c.key }],
    ['Agent', (c) => c.agent || '—', { sortValue: (c) => c.agent }],
    ['First seen', (c) => timeCell(c.firstSeen), { sortValue: (c) => c.firstSeen }],
    ['Last seen', (c) => timeCell(c.lastSeen), { sortValue: (c) => c.lastSeen }],
    ['Requests', (c) => String(c.requests), { sortValue: (c) => c.requests }],
  ], shown, callers.length ? 'No caller matches the filter.' : 'No one has used the token since the last restart.');
}
const REDRAW_FILTERED = { clientsList: () => renderClients(loadedRows.clientsList), callersList: () => renderCallers(loadedRows.callersList) };
for (const input of document.querySelectorAll('[data-filter]')) {
  const [table, key] = input.dataset.filter.split(':');
  tableFilters[table][key] = input.value;
  input.addEventListener('input', () => { tableFilters[table][key] = input.value; REDRAW_FILTERED[table](); });
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
    ['Installed', providerInstalledCell, { sortValue: (p) => Number(p.available) }],
    ['Tools', (p) => p.tools.map((n) => (n.startsWith(TOOL_PREFIX) ? n.slice(TOOL_PREFIX.length) : n)).join(', ')],
    ['Switch', providerSwitch, NOT_SORTABLE],
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

// The name field is a draft: the server says what it means (POST /api/identity-preview, nothing written) and Save is the one commit. A Server ID or Tool prefix input follows the Display name until it is typed in.
const idEl = (id) => document.getElementById(id);
const ID_HAND_INPUTS = [['key', 'idKey'], ['prefix', 'idPrefix']];
function identityDraft() {
  const draft = { name: idEl('idName').value };
  for (const [field, id] of ID_HAND_INPUTS) if (idEl(id).dataset.hand === '1') draft[field] = idEl(id).value;
  return draft;
}
let identityTicket = 0;
let identityCanSave = !idEl('idSave').disabled;
function showIdentity(reply) {
  identityCanSave = reply.canSave;
  idEl('idSave').disabled = !reply.canSave;
  idEl('idReset').hidden = !reply.showReset;
  idEl('idStatus').textContent = reply.status;
  idEl('idNameErr').innerHTML = reply.html.name;
  idEl('idRows').innerHTML = reply.html.rows;
  idEl('idNotes').innerHTML = reply.html.notes;
  for (const [field, id] of ID_HAND_INPUTS) if (idEl(id).dataset.hand !== '1') idEl(id).value = reply.shown[field] ?? '';
}
async function previewIdentity() {
  const ticket = ++identityTicket;
  try {
    const reply = await api('POST', '/api/identity-preview', identityDraft());
    if (ticket === identityTicket) showIdentity(reply);
  } catch (e) {
    say('msgIdentity', e.message, false);
  }
}
function setHand(id, on) {
  idEl(id).dataset.hand = on ? '1' : '0';
}
idEl('idName').oninput = previewIdentity;
for (const [, id] of ID_HAND_INPUTS) idEl(id).oninput = () => { setHand(id, true); previewIdentity(); };
const IDENTITY_CLICKS = {
  useDerived: (btn) => setHand(btn.dataset.field === 'key' ? 'idKey' : 'idPrefix', false),
  keep: (btn) => {
    idEl('idKey').value = btn.dataset.key; idEl('idPrefix').value = btn.dataset.prefix;
    setHand('idKey', true); setHand('idPrefix', true);
  },
};
for (const id of ['idRows', 'idNotes']) {
  idEl(id).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-idact]');
    if (!btn) return;
    IDENTITY_CLICKS[btn.dataset.idact](btn);
    previewIdentity();
  });
}

const ACTIONS = {
  saveIdentity: async (btn) => {
    await act(btn, 'msgIdentity', async () => {
      const reply = await api('POST', '/api/identity', identityDraft());
      showIdentity(reply);
      return reply.message;
    });
    btn.disabled = !identityCanSave;
  },
  resetIdentityFields: () => {
    idEl('idName').value = 'AkiMCP';
    setHand('idKey', false); setHand('idPrefix', false);
    previewIdentity();
  },
  resetIdentityNow: (btn) => act(btn, 'msgIdentityReset', async () => {
    const { message } = await api('POST', '/api/identity-reset');
    setTimeout(() => location.reload(), 800);
    return message + ' (reloading)';
  }),
  redetectProviders: (btn) => act(btn, 'msgProviders', async () => {
    renderProviders(await api('POST', '/api/providers', { redetect: true }));
    return 'detected again';
  }),
  saveLimits: (btn) => act(btn, 'msgLimits', async () => (await api('POST', '/api/rate-limit', { limits: readLimitInputs() })).message),
  saveLog: (btn) => act(btn, 'msgLogSettings', async () => (await api('POST', '/api/log', { log: readLogInputs() })).message),
  resetLog: () => { fillLog(logDefaults); say('msgLogSettings', 'defaults filled in — press Save to apply', true); },
  resetLimits: () => { fillLimits(limitDefaults); say('msgLimits', 'defaults filled in — press Save to apply', true); },
  refreshClients: (btn) => act(btn, 'msgClients', async () => { await loadSecurity(); return 'refreshed'; }),
  refreshCallers: (btn) => act(btn, 'msgCallers', async () => { await loadSecurity(); return 'refreshed'; }),
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
  mintTemp: (btn) => act(btn, 'msgTemp', async () => {
    const { kickoff, expires } = await api('POST', '/api/temp-token');
    const box = document.getElementById('tempKickoff');
    box.value = kickoff;
    box.hidden = false;
    document.getElementById('tempKickoffNote').hidden = false;
    const copied = await navigator.clipboard.writeText(kickoff).then(() => true, () => false);
    await loadTempTokens();
    return `${copied ? 'copied: paste it into your chat' : 'select the block and copy it'}, valid until ${new Date(expires).toLocaleTimeString()}`;
  }),
  revokeAllTemp: (btn) => act(btn, 'msgTemp', async () => {
    const { message } = await api('POST', '/api/temp-token/revoke', { all: true });
    await loadTempTokens();
    return message;
  }),
  rollPassphrase: (btn) => {
    if (!confirm('Roll the passphrase? The old one stops working for new connections; connected AIs are not signed out.')) return;
    return act(btn, 'msgRoll', async () => {
      const { message } = await api('POST', '/api/roll-passphrase');
      reloadKeepingTab(message);
      return message + ' — reloading';
    });
  },
  agyApply: (btn) => act(btn, 'msgAgy', async () => (await api('POST', '/api/agy-apply-mcp')).message),
  claudeCodeApply: (btn) => act(btn, 'msgClaudeCode', async () => (await api('POST', '/api/claude-code-apply')).message),
  codexApply: (btn) => act(btn, 'msgCodex', async () => (await api('POST', '/api/codex-apply')).message),
  cursorApply: (btn) => act(btn, 'msgCursor', async () => (await api('POST', '/api/cursor-apply')).message),
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

// Scoped to its section: a page-wide toggle would deactivate the other tab group. lastTab lets a tier switch return to the tab the user left.
document.querySelectorAll('.tabs').forEach((nav) => {
  const scope = nav.closest('section');
  nav.querySelectorAll('.tab').forEach((tab) => (tab.onclick = () => {
    nav.dataset.lastTab = tab.dataset.tab;
    scope.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.ariaCurrent = t === tab ? 'true' : null;
    });
    scope.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
  }));
});
document.querySelectorAll('.tab.active').forEach((tab) => (tab.ariaCurrent = 'true'));

// One bar shows at a time, so the active tab always sits on the bar that touches its pane.
document.querySelectorAll('.tier-switch').forEach((bar) => {
  const scope = bar.closest('section');
  bar.querySelectorAll('.tier-btn').forEach((btn) => (btn.onclick = () => {
    bar.querySelectorAll('.tier-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    });
    const target = scope.querySelector('.tabs[data-tier-tabs="' + btn.dataset.tier + '"]');
    scope.querySelectorAll('.tabs[data-tier-tabs]').forEach((n) => n.classList.toggle('active', n === target));
    (target.querySelector('.tab[data-tab="' + target.dataset.lastTab + '"]') || target.querySelector('.tab')).click();
  }));
});

const restore = JSON.parse(sessionStorage.getItem(RESTORE_KEY) || 'null');
sessionStorage.removeItem(RESTORE_KEY);
if (restore) {
  const bar = document.querySelector('#s1 .tab[data-tab="' + restore.tab + '"]').closest('.tabs');
  bar.dataset.lastTab = restore.tab;
  document.querySelector('.tier-btn[data-tier="' + bar.dataset.tierTabs + '"]').click();
  say(restore.resultId || 'msgRoll', restore.message, true);
}

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
loadTempTokens().catch((e) => say('msgTemp', e.message, false));
setInterval(() => loadTempTokens().catch(() => {}), 30_000);
loadPostmanDaemon().catch((e) => { document.getElementById('msgPmDaemon').textContent = e.message; });
