// Command output → the text a remote model reads (docs/feat/tools.md § Output shaping, docs/research/token-saving-rtk.md).
// Nothing the model may need is destroyed: cleaning is lossless, and an oversized output is cut only after its raw text is saved for read_text_file / search_content.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { USER_DIR } from './userdata.js';
import { redactText } from './roots.js';

export const SHOWN_HEAD = 14_000;
export const SHOWN_TAIL = 6_000;
export const MAX_SHOWN = SHOWN_HEAD + SHOWN_TAIL;
const KEEP_SPILLS = 20;
const SPILL_MAX_BYTES = 8 * 1024 * 1024;
const MIN_RUN = 3;

export const spillDir = () => path.join(USER_DIR, 'out');

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// A progress bar redraws one line with \r; only the last redraw is what the terminal ended up showing.
const finalRedraw = (line) => line.slice(line.lastIndexOf('\r') + 1);

function collapseRuns(lines) {
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    out.push(lines[i]);
    if (j - i >= MIN_RUN) out.push(`[previous line repeated ${j - i} times in total]`);
    else for (let k = i + 1; k < j; k++) out.push(lines[i]);
    i = j;
  }
  return out;
}

export const cleanOutput = (text) => collapseRuns(text.replace(ANSI, '').replace(/\r\n/g, '\n').split('\n').map(finalRedraw)).join('\n');

// Cut at a line boundary when one exists in the window, else at a code point (never inside a surrogate pair, coding.C5).
function cutHead(text, max) {
  const window = text.slice(0, max);
  const nl = window.lastIndexOf('\n');
  if (nl > max / 2) return window.slice(0, nl);
  return /[\uD800-\uDBFF]$/.test(window) ? window.slice(0, -1) : window;
}

function cutTail(text, max) {
  const window = text.slice(-max);
  const nl = window.indexOf('\n');
  if (nl !== -1 && nl < max / 2) return window.slice(nl + 1);
  return /^[\uDC00-\uDFFF]/.test(window) ? window.slice(1) : window;
}

function saveRaw(raw) {
  try {
    const dir = spillDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.txt`);
    fs.writeFileSync(file, raw.length > SPILL_MAX_BYTES ? raw.slice(0, SPILL_MAX_BYTES) : raw, { mode: 0o600 });
    const old = fs.readdirSync(dir).filter((name) => name.endsWith('.txt')).sort().slice(0, -KEEP_SPILLS);
    for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
    return { file, stored: Math.min(raw.length, SPILL_MAX_BYTES) };
  } catch {
    return null;
  }
}

export function shapeForModel(raw) {
  const cleaned = redactText(cleanOutput(raw)); // before the cut, which could split a secret (roots.js redactText)
  if (cleaned.length <= MAX_SHOWN) return cleaned;
  const head = cutHead(cleaned, SHOWN_HEAD);
  const tail = cutTail(cleaned, SHOWN_TAIL);
  const omittedLines = cleaned.slice(head.length, cleaned.length - tail.length).split('\n').length;
  const saved = saveRaw(raw);
  const where = saved
    ? `Raw output${saved.stored < raw.length ? ` (first ${saved.stored} of ${raw.length} chars)` : ''} saved to ${saved.file} — read_text_file with head/tail, or search_content on it.`
    : 'Raw output could not be saved.';
  return `[output cut: ${cleaned.length} chars, showing the first ${head.length} and last ${tail.length}. ${where}]\n${head}\n[... ${omittedLines} lines omitted ...]\n${tail}`;
}
