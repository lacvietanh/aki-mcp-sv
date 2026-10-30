// Naming SSoT for the MCP server identity: docs/plan/v4-custom-name.md § The identity (no hyphen in the key: docs/ref/fact-agy-mcp-config.md § CLI-5).
import { readSettings } from './allowlist.js';
import { SETTINGS_PATH } from './userdata.js';

export const DEFAULT_NAME = 'AkiMCP';
export const DEFAULT_KEY = 'akimcp';
export const DEFAULT_PREFIX = 'aki__';
export const MCP_NAME = DEFAULT_NAME;
export const MCP_SERVER_KEY = DEFAULT_KEY;
export const LEGACY_MCP_SERVER_KEY = 'aki-mcp';

// ASSUMPTION until P0 sources client limits: 64 characters for mcp__<Server ID>__<tool>.
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

const refuse = (field, value, reason) => ({
  identity: { name: DEFAULT_NAME, key: DEFAULT_KEY, prefix: DEFAULT_PREFIX },
  problem: { field, value, reason },
});

// The one place the rule lives. A bad value never throws: the defaults are served and `problem` says which field and why.
export function resolveIdentity(stored) {
  if (stored != null && (typeof stored !== 'object' || Array.isArray(stored))) return refuse('identity', stored, 'must be an object with name, key and prefix');
  const { name: rawName, key: handKey, prefix: handPrefix } = stored ?? {};
  const notText = [['Display name', rawName], ['Server ID', handKey], ['Tool prefix', handPrefix]].find(([, value]) => value != null && typeof value !== 'string');
  if (notText) return refuse(notText[0], notText[1], 'must be text');
  const name = (rawName ?? DEFAULT_NAME).normalize('NFC');
  if (!NAME_RULE.test(name)) return refuse('Display name', rawName, 'use letters, digits, spaces and . _ - only, starting with a letter or digit, 1 to 40 characters, nothing invisible');
  const derivedKey = slug(name);
  const key = handKey ?? derivedKey;
  if (!KEY_RULE.test(key)) return refuse('Server ID', key, derivedKey === '' && handKey == null ? 'no letter a to z or digit can be made from the Display name, set it by hand' : 'use lowercase letters a to z and digits, starting with a letter');
  const prefix = handPrefix ?? (derivedKey === '' ? null : `${stem(derivedKey)}__`);
  if (prefix === null) return refuse('Tool prefix', '', 'no prefix can be made from the Display name, set it by hand');
  if (prefix !== '' && !PREFIX_RULE.test(prefix)) return refuse('Tool prefix', prefix, 'leave it empty, or use lowercase letters and digits ending in two underscores');
  if (key.length + prefix.length > NAME_BUDGET) return refuse('Server ID and Tool prefix', `${key}${prefix}`, `together they are ${key.length + prefix.length} characters, ${NAME_BUDGET} at most`);
  return { identity: { name, key, prefix }, problem: null };
}

// stdout carries the JSON-RPC channel on stdio.js and the line reaches a terminal: JSON.stringify writes C0, the rest of \p{Cc} (DEL, C1) is written out here.
export function problemLine({ field, value, reason }, settingPath) {
  const quoted = JSON.stringify(value).replace(/\p{Cc}/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `${field} ${quoted} in ${settingPath} is not valid: ${reason}. Serving the default names until it is fixed in panel section 1.`;
}

const resolved = resolveIdentity(readSettings().identity);
export const IDENTITY = resolved.identity;
export const IDENTITY_PROBLEM = resolved.problem;
export const served = (bare) => `${IDENTITY.prefix}${bare}`;

// console.error only: stdout is the JSON-RPC channel on stdio.js.
export function announceIdentity() {
  if (IDENTITY_PROBLEM) console.error(problemLine(IDENTITY_PROBLEM, SETTINGS_PATH));
  console.error(`Serving as ${IDENTITY.name} · Server ID ${IDENTITY.key} · tools ${IDENTITY.prefix}*`);
}
