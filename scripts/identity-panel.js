// The panel's name field: the browser asks here on every keystroke, so resolveIdentity, slug() and the budget stay in mcp-name.js only (docs/plan/v4-custom-name.md § P6).
import { readSettings, writeSettings } from './allowlist.js';
import { esc } from './html.js';
import { IDENTITY, IDENTITY_PROBLEM, DEFAULT_NAME, DEFAULT_KEY, DEFAULT_PREFIX, resolveIdentity, candidateIdentity, aioboxFindsName, describeProblem, quoteValue } from './mcp-name.js';

const RESTART = 'restart AkiMCP (press Ctrl+C in the terminal where it runs, then start it again the way you started it, for example npm start)';
const SAME_TIME = 'the Claude app, AGY and Postman get it the next time they start';
const withTools = (prefix) => (prefix ? `${prefix}*` : 'no prefix');
const namesLine = ({ name, key, prefix }) => `${name} · ${key} · ${withTools(prefix)}`;
const isDefault = ({ name, key, prefix }) => name === DEFAULT_NAME && key === DEFAULT_KEY && prefix === DEFAULT_PREFIX;

export function readDraft(body) {
  const text = (value, label) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new Error(`${label} must be text`);
    return value;
  };
  if (typeof body?.name !== 'string') throw new Error('Display name must be text');
  return { name: body.name, key: text(body.key, 'Server ID'), prefix: text(body.prefix, 'Tool prefix') };
}

// The form setting.json keeps: absent when the draft is the default, and a Server ID or Tool prefix only when it was set by hand.
function storedForm({ name, key, prefix }) {
  const hand = { ...(key !== undefined && { key }), ...(prefix !== undefined && { prefix }) };
  const nfc = name.normalize('NFC');
  return nfc === DEFAULT_NAME && !Object.keys(hand).length ? null : { name: nfc, ...hand };
}

const canon = (stored) => JSON.stringify(stored, ['name', 'key', 'prefix']);

export function savedDraft() {
  const raw = readSettings().identity;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { name: DEFAULT_NAME };
  const text = (value) => (typeof value === 'string' ? value : undefined);
  return { name: text(raw.name) ?? DEFAULT_NAME, key: text(raw.key), prefix: text(raw.prefix) };
}

const savedIdentity = () => resolveIdentity(readSettings().identity);
const servesSaved = () => {
  const saved = savedIdentity().identity;
  return IDENTITY.name === saved.name && IDENTITY.key === saved.key && IDENTITY.prefix === saved.prefix;
};

export function previewIdentity(draft) {
  const serving = IDENTITY;
  const stored = storedForm(draft);
  const { problem } = resolveIdentity(stored ?? undefined);
  const name = draft.name.normalize('NFC');
  const described = problem ? describeProblem(problem, draft) : null;
  const derived = candidateIdentity({ name });
  const candidate = candidateIdentity(draft);
  const shown = described?.slot === 'name' ? { key: null, prefix: null } : { key: candidate.key, prefix: candidate.prefix };
  const hand = { key: draft.key !== undefined, prefix: draft.prefix !== undefined };
  const saved = savedIdentity();
  const dirty = saved.problem !== null || canon(stored) !== canon(storedForm(savedDraft()));
  const valid = problem === null;
  return {
    valid,
    problem: described,
    name,
    shown,
    derived: { key: derived.key, prefix: derived.prefix },
    hand,
    example: valid ? `${shown.prefix}run_cmd` : null,
    canSave: valid && dirty,
    aiobox: described?.slot !== 'name' && !aioboxFindsName(name),
    ids: valid ? { changed: shown.key !== serving.key || shown.prefix !== serving.prefix, nameChanged: name !== serving.name } : { changed: false, nameChanged: false },
    keepOffer: valid && name !== serving.name && !hand.key && !hand.prefix && (derived.key !== serving.key || derived.prefix !== serving.prefix),
    serving,
  };
}

export function statusText() {
  const serving = IDENTITY;
  const saved = savedIdentity().identity;
  const now = `Serving now: ${serving.name}`;
  if (servesSaved()) return `${now} · Server ID ${serving.key} · tools ${serving.prefix ? `${serving.prefix}*` : 'with no prefix'}`;
  return `${now} · ${serving.key} · ${withTools(serving.prefix)}. Saved: ${namesLine(saved)}. Web AIs and Local clients that connect by URL get the saved name after you restart AkiMCP. The Claude app, AGY and Postman start their own copy, so they get it the next time they start, even before the restart.`;
}

const showReset = () => storedForm(savedDraft()) !== null || !isDefault(IDENTITY);

const errLine = (text) => (text ? `<p class="helptext"><span class="msg err">${esc(text)}</span></p>` : '');
const shownOrNone = (value) => (value === null ? 'none' : value === '' ? 'empty' : value);

function rowHtml(label, field, p) {
  const value = p.shown[field];
  const undo = p.hand[field] && p.derived[field] !== value
    ? ` <button type="button" data-idact="useDerived" data-field="${field}">Use the one made from the Display name (${esc(shownOrNone(p.derived[field]))})</button>`
    : '';
  const own = p.problem?.slot === field ? errLine(p.problem.text) : '';
  return `<div class="row"><label>${label}</label><span><span class="mono">${esc(shownOrNone(value))}</span>${undo}</span></div>${own}`;
}

function rowsHtml(p) {
  const example = `<div class="row"><label>Example tool</label><span class="mono">${esc(shownOrNone(p.example))}</span></div>`;
  return `${rowHtml('Server ID', 'key', p)}${rowHtml('Tool prefix', 'prefix', p)}${example}`;
}

function previewRowsHtml(p) {
  if (!p.valid) return '';
  const shownTool = `mcp__${p.shown.key}__${p.example}`;
  return `<p class="helptext"><strong>What each AI shows</strong></p>
<div class="row"><label>Claude Code</label><span class="mono">${esc(shownTool)}</span></div>
<div class="row"><label>Codex</label><span class="mono">${esc(shownTool)}</span></div>
<p class="helptext">Web AIs put the connector name you typed in front of each tool, for example <span class="mono">${esc(p.name)}__${esc(p.shown.prefix)}run_cmd</span> in ClickUp. Type ${esc(p.name)} as the connector name.</p>`;
}

function noticesHtml(p) {
  const { serving } = p;
  const lines = [];
  if (p.keepOffer) {
    const label = `Keep ${serving.key} and ${serving.prefix || 'no prefix'}`;
    lines.push(`<p class="helptext">Changing the Display name also changes the Server ID and Tool prefix made from it. <button type="button" data-idact="keep" data-key="${esc(serving.key)}" data-prefix="${esc(serving.prefix)}">${esc(label)}</button></p>`);
  }
  if (p.ids.changed) {
    lines.push(`<p class="helptext">After Save, ${RESTART}, then press Apply in each Local tab, add the connector again in each web AI and paste the section 3 instruction again.</p>`);
    lines.push(`<p class="helptext">Claude and AGY ask you to allow every tool again, and ClickUp Super Agents and saved prompts that name ${serving.prefix ? `${esc(serving.prefix)} tools` : 'the current tool names'} need the new names.</p>`);
  } else if (p.ids.nameChanged) {
    lines.push(`<p class="helptext">After Save, ${RESTART}. The Server ID and tool names stay the same, so no client needs to reconnect; rename the connector in a web AI only if you want it to show the new name.</p>`);
  }
  if (p.aiobox) lines.push('<p class="helptext">AIObox connects claude.ai by itself only when the Display name contains AkiMCP; capitals and spaces don\'t matter, so Aki MCP works and Aki-MCP does not. Otherwise, add the connector yourself with the steps in the Claude tab above.</p>');
  return lines.join('\n');
}

export function fragments(p) {
  return { name: p.problem?.slot === 'name' ? errLine(p.problem.text) : '', rows: rowsHtml(p), notes: `${previewRowsHtml(p)}${noticesHtml(p)}` };
}

const reply = (draft) => {
  const p = previewIdentity(draft);
  return { canSave: p.canSave, shown: p.shown, derived: p.derived, html: fragments(p), status: statusText(), showReset: showReset() };
};

export const previewReply = (body) => reply(readDraft(body));

export function saveIdentity(body) {
  const draft = readDraft(body);
  const p = previewIdentity(draft);
  if (!p.valid) throw new Error(p.problem.text);
  const settings = readSettings();
  const stored = storedForm(draft);
  if (stored === null) delete settings.identity;
  else settings.identity = stored;
  writeSettings(settings);
  const message = servesSaved() ? `Saved. ${p.name} is already serving.` : `Saved. To serve ${p.name} to web AIs, ${RESTART}; ${SAME_TIME}.`;
  return { ok: true, message, ...reply(savedDraft()) };
}

// Never touches applied.keys: those are what a later Apply removes from the clients.
export function resetIdentity() {
  const settings = readSettings();
  delete settings.identity;
  writeSettings(settings);
  const serving = servesSaved() ? 'AkiMCP names are saved and already serving.' : `AkiMCP names are saved. To serve them to web AIs, ${RESTART}; ${SAME_TIME}.`;
  return { ok: true, message: `Reset. ${serving}`, ...reply(savedDraft()) };
}

export function redRowText() {
  if (!IDENTITY_PROBLEM) return '';
  const { field, value, reason } = IDENTITY_PROBLEM;
  return `${field} ${quoteValue(value)} in setting.json is not valid: ${reason}. AkiMCP is serving the default names until you fix it.`;
}

export function renderIdentityField() {
  const draft = savedDraft();
  const p = previewIdentity(draft);
  const parts = fragments(p);
  const field = (id, label, value, handSet, help) => `<div class="row"><label for="${id}">${label}</label><input type="text" id="${id}" value="${esc(value)}" data-hand="${handSet ? 1 : 0}" autocomplete="off" spellcheck="false"></div>${help}`;
  const red = IDENTITY_PROBLEM
    ? `<div class="acts"><span class="msg err">${esc(redRowText())}</span><button type="button" data-act="resetIdentityNow">Reset to AkiMCP</button><span class="msg" id="msgIdentityReset"></span></div>`
    : '';
  return `${red}
${field('idName', 'Display name', draft.name, false, '')}
<p class="helptext">The name AI clients list this server as. The Server ID and Tool prefix below are made from it as you type; to set either one yourself, open Customize fields.</p>
<div id="idNameErr">${parts.name}</div>
<div id="idRows">${parts.rows}</div>
<div id="idNotes">${parts.notes}</div>
<div class="acts"><button class="primary" id="idSave" data-act="saveIdentity"${p.canSave ? '' : ' disabled'}>Save name</button><button id="idReset" data-act="resetIdentityFields"${showReset() ? '' : ' hidden'}>Reset to AkiMCP</button><span class="msg" id="msgIdentity"></span></div>
<p class="helptext" id="idStatus">${esc(statusText())}</p>
<details class="adv" id="idCustom"><summary>Customize fields</summary>
${field('idKey', 'Server ID', draft.key ?? p.shown.key ?? '', draft.key !== undefined, '<p class="helptext">The name client configs store this server under. Lowercase letters and digits, starting with a letter.</p>')}
${field('idPrefix', 'Tool prefix', draft.prefix ?? p.shown.prefix ?? '', draft.prefix !== undefined, '<p class="helptext">Text in front of every tool name. Leave it empty to use bare names, for example run_cmd; an AI that also has another server with a tool of the same name may then call the wrong one.</p>')}
</details>`;
}
