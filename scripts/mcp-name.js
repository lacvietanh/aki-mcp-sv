// Naming SSoT for the MCP server identity: docs/plan/v4-custom-name.md § The identity (no hyphen in the key: docs/ref/fact-agy-mcp-config.md § CLI-5).
import { readSettings } from './allowlist.js';
import { SETTINGS_PATH } from './userdata.js';

export const DEFAULT_NAME = 'AkiMCP';
export const DEFAULT_KEY = 'akimcp';
export const DEFAULT_PREFIX = 'aki__';
export const DEFAULT_APPLIED_KEYS = ['aki-mcp', DEFAULT_KEY];

// 64: OpenAI's cap, which Codex's mcp__<Server ID>__<tool> must fit (docs/ref/fact-client-tool-names.md N3, N4).
export const CEILING = 64;
export const NAME_BUDGET = 28;
export const TOOL_BUDGET = CEILING - 'mcp____'.length - NAME_BUDGET;

const NAME_RULE = /^(?!.*\p{Default_Ignorable_Code_Point})[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd} ._-]{0,39}$/u;
const KEY_RULE = /^[a-z][a-z0-9]*$/;
const PREFIX_RULE = /^[a-z][a-z0-9]*__$/;
const LETTERS_NFKD_KEEPS = { đ: 'd', ø: 'o', ß: 'ss', ı: 'i', æ: 'ae', œ: 'oe', ł: 'l', þ: 'th', ð: 'd', ħ: 'h', ŧ: 't', ŋ: 'n' };

const WHOLE_LETTER = new RegExp(`[${Object.keys(LETTERS_NFKD_KEEPS).join('')}]`, 'g');

const slug = (name) => name
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(WHOLE_LETTER, (c) => LETTERS_NFKD_KEEPS[c])
  .replace(/[^a-z0-9]/g, '')
  .replace(/^\d+/, '');

const stem = (x) => {
  if (x.startsWith(DEFAULT_KEY) && /^[a-z]/.test(x.slice(DEFAULT_KEY.length))) return x.slice(DEFAULT_KEY.length);
  return x.endsWith('mcp') && x.length > 'mcp'.length ? x.slice(0, -'mcp'.length) : x;
};

const candidateOf = (name, handKey, handPrefix) => {
  const derivedKey = slug(name);
  return { derivedKey, key: handKey ?? derivedKey, prefix: handPrefix ?? (derivedKey === '' ? null : `${stem(derivedKey)}__`) };
};

// What a draft would make before any rule refuses it, so the panel can show the values beside the reason.
export const candidateIdentity = ({ name, key, prefix }) => candidateOf(name.normalize('NFC'), key, prefix);

// AIObox finds its connector by this test (plan D12), never slug(): slug would drop the hyphen of Aki-MCP.
export const aioboxFindsName = (name) => name.normalize('NFC').toLowerCase().replace(/\s/g, '').includes(DEFAULT_KEY);

const refuse = (field, value, reason) => ({
  identity: { name: DEFAULT_NAME, key: DEFAULT_KEY, prefix: DEFAULT_PREFIX },
  problem: { field, value, reason },
});

// stdout carries the JSON-RPC channel on stdio.js and the line reaches a terminal: JSON.stringify writes C0, the rest of \p{Cc} (DEL, C1) is written out here.
export const quoteValue = (value) => JSON.stringify(value).replace(/\p{Cc}/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// The one place the rule lives. A bad value never throws: the defaults are served and `problem` says which field and why.
export function resolveIdentity(stored) {
  if (stored != null && (typeof stored !== 'object' || Array.isArray(stored))) return refuse('identity', stored, 'must be an object with name, key and prefix');
  const unread = Object.keys(stored ?? {}).filter((k) => !['name', 'key', 'prefix'].includes(k));
  if (unread.length) return refuse('identity', stored, `has ${unread.map(quoteValue).join(', ')}, which AkiMCP does not read: keep only name, key and prefix`);
  const { name: rawName, key: handKey, prefix: handPrefix } = stored ?? {};
  const notText = [['Display name', rawName], ['Server ID', handKey], ['Tool prefix', handPrefix]].find(([, value]) => value != null && typeof value !== 'string');
  if (notText) return refuse(notText[0], notText[1], 'must be text');
  const name = (rawName ?? DEFAULT_NAME).normalize('NFC');
  if (!NAME_RULE.test(name)) return refuse('Display name', rawName, 'use letters, digits, spaces and . _ - only, starting with a letter or digit, 1 to 40 characters, nothing invisible');
  const { derivedKey, key, prefix } = candidateOf(name, handKey, handPrefix);
  if (!KEY_RULE.test(key)) return refuse('Server ID', key, derivedKey === '' && handKey == null ? 'no letter a to z or digit can be made from the Display name, set it by hand' : 'use lowercase letters a to z and digits, starting with a letter');
  if (prefix === null) return refuse('Tool prefix', '', 'no prefix can be made from the Display name, set it by hand');
  if (prefix !== '' && !PREFIX_RULE.test(prefix)) return refuse('Tool prefix', prefix, 'leave it empty, or use lowercase letters and digits ending in two underscores');
  if (key.length + prefix.length > NAME_BUDGET) return refuse('Server ID and Tool prefix', `${key}${prefix}`, `together they are ${key.length + prefix.length} characters, ${NAME_BUDGET} at most`);
  return { identity: { name, key, prefix }, problem: null };
}

const NAME_ALLOWED = /^[\p{L}\p{M}\p{Nd} ._-]$/u;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
const CHAR_NAMES = { '\n': 'line break', '\r': 'line break', '\t': 'tab', '\u00a0': 'no-break space', '\u200b': 'zero-width space', '\u200c': 'zero-width non-joiner', '\u200d': 'zero-width joiner', '\u202e': 'right-to-left override', '\ufeff': 'zero-width no-break space' };
const codePoint = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const describeChar = (c) => {
  if (/[\n\r\t]/.test(c)) return CHAR_NAMES[c];
  if (CHAR_NAMES[c]) return `${CHAR_NAMES[c]} (${codePoint(c)})`;
  return INVISIBLE.test(c) || /\p{Cc}/u.test(c) ? `invisible character (${codePoint(c)})` : `"${c}"`;
};
const describeChars = (chars) => [...new Set(chars)].map(describeChar).join(', ');

function nameProblemText(raw) {
  const name = raw.normalize('NFC');
  if (name === '') return 'Display name is empty. Type a name, for example AkiMCP.';
  const bad = [...name].filter((c) => !NAME_ALLOWED.test(c) || INVISIBLE.test(c));
  if (bad.length) return `Display name can use only letters, digits, spaces and . _ -. Remove ${describeChars(bad)}.`;
  if (!/^[\p{L}\p{Nd}]/u.test(name)) return `Display name must start with a letter or digit. Remove "${[...name][0]}" at the start.`;
  return `Display name is ${[...name].length} characters, 40 at most. Shorten it.`;
}

function keyProblemText(value, derivedKey) {
  if (value === '') return `Server ID is empty. Type one, for example ${derivedKey || 'work'}.`;
  const lowered = value.toLowerCase();
  if (value !== lowered && KEY_RULE.test(lowered)) return `Server ID must be lowercase. Use ${lowered}.`;
  if (!/^[a-z]/.test(lowered)) return `Server ID must start with a letter. Remove "${[...value][0] ?? ''}" at the start.`;
  return `Server ID can use only letters a to z and digits. Remove ${describeChars([...lowered].filter((c) => !/[a-z0-9]/.test(c)))}.`;
}

// A refused draft in the panel's words, with the field it belongs under: `slot` is name, key or prefix.
export function describeProblem({ field, value }, draft) {
  const name = draft.name.normalize('NFC');
  if (field === 'Display name') return { slot: 'name', text: nameProblemText(draft.name) };
  if (field === 'Server ID and Tool prefix') return { slot: 'name', text: `Server ID and Tool prefix together are ${value.length} characters, ${NAME_BUDGET} at most. Shorten the Display name, or set Tool prefix by hand in Customize fields.` };
  const { derivedKey } = candidateOf(name, draft.key, draft.prefix);
  if (field === 'Server ID') {
    return { slot: 'key', text: derivedKey === '' && draft.key == null ? `No Server ID can be made from "${name}": a Server ID uses only a to z and 0 to 9, and this name has no letter a to z. Set Server ID in Customize fields.` : keyProblemText(value, derivedKey) };
  }
  if (draft.prefix == null) return { slot: 'prefix', text: `No Tool prefix can be made from "${name}". Set Tool prefix in Customize fields.` };
  const typed = value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^\d+/, '');
  return { slot: 'prefix', text: `Tool prefix must be empty or end with two underscores, for example ${typed || stem(derivedKey) || 'work'}__.` };
}

export function problemLine({ field, value, reason }, settingPath) {
  return `${field} ${quoteValue(value)} in ${settingPath} is not valid: ${reason}. Serving the default names until it is fixed in panel section 1.`;
}

const resolved = resolveIdentity(readSettings().identity);
export const IDENTITY = resolved.identity;
export const IDENTITY_PROBLEM = resolved.problem;
export const served = (bare) => `${IDENTITY.prefix}${bare}`;

// Written by Apply only: every Server ID it ever wrote, so a later Apply can remove the ones that are ours.
export const appliedKeys = (settings = readSettings()) => (Array.isArray(settings.applied?.keys) ? settings.applied.keys.filter((k) => typeof k === 'string') : [...DEFAULT_APPLIED_KEYS]);

// console.error only: stdout is the JSON-RPC channel on stdio.js.
export function announceIdentity() {
  if (IDENTITY_PROBLEM) console.error(problemLine(IDENTITY_PROBLEM, SETTINGS_PATH));
  console.error(`Serving as ${IDENTITY.name} · Server ID ${IDENTITY.key} · tools ${IDENTITY.prefix}*`);
}
