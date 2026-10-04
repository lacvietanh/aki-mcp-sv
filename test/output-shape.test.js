#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import: spilled files land in a temp dir, never in the owner's ~/.aki.
process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'output-shape-test-'));
const { cleanOutput, shapeForModel, spillDir, MAX_SHOWN, SHOWN_HEAD, SHOWN_TAIL } = await import('../scripts/output-shape.js');

// Cleaning is lossless: it removes only what a terminal would not have shown as text.
assert.equal(cleanOutput('\x1b[31mred\x1b[0m and \x1b[1;32mgreen\x1b[0m'), 'red and green', 'ANSI colour codes');
assert.equal(cleanOutput('\x1b]0;title\x07body'), 'body', 'OSC title sequence');
assert.equal(cleanOutput('10%\r50%\r100%\ndone'), '100%\ndone', 'a progress bar keeps only its last redraw');
assert.equal(cleanOutput('a\r\nb\r\n'), 'a\nb\n', 'CRLF is normalized, not treated as a redraw');
assert.equal(cleanOutput('x\nx\nkeep'), 'x\nx\nkeep', 'a run of 2 is left as it was');
assert.equal(cleanOutput('x\nx\nx\nkeep'), 'x\n[previous line repeated 3 times in total]\nkeep', 'a run of 3 collapses, first occurrence verbatim');
assert.equal(cleanOutput('a\nb\nb\nb\nb\na'), 'a\nb\n[previous line repeated 4 times in total]\na', 'only consecutive lines collapse');
assert.equal(cleanOutput(''), '');

// Under the cap nothing is cut and no file is written.
const small = 'line\n'.repeat(10);
assert.equal(shapeForModel(small), cleanOutput(small));
assert.equal(fs.existsSync(spillDir()), false, 'no spill below the cap');

// Over the cap: marker first, head and tail kept at line boundaries, raw saved byte for byte.
const lines = Array.from({ length: 5000 }, (_, i) => `row ${i} ${'x'.repeat(20)}`);
const raw = lines.join('\n');
assert.ok(raw.length > MAX_SHOWN);
const shaped = shapeForModel(raw);
const [marker, ...rest] = shaped.split('\n');
assert.match(marker, /^\[output cut: \d+ chars, showing the first \d+ and last \d+\. Raw output saved to /, 'the cut is announced on the first line');
assert.ok(rest[0] === 'row 0 ' + 'x'.repeat(20), 'head starts at the beginning');
assert.equal(rest.at(-1), lines.at(-1), 'tail ends at the end');
assert.ok(shaped.length < SHOWN_HEAD + SHOWN_TAIL + 400, 'shown text stays within the budget plus the notices');
assert.match(shaped, /\[\.\.\. \d+ lines omitted \.\.\.\]/);
assert.ok(rest.every((l) => l.startsWith('row ') || l.startsWith('[...')), 'no line is cut in half');
const saved = /saved to (.+?) — read_text_file/.exec(marker)[1];
assert.equal(fs.readFileSync(saved, 'utf8'), raw, 'the saved file is the raw output, unmodified');
// Windows has no POSIX mode bits: stat reports 0o666 whatever was asked.
if (process.platform !== 'win32') assert.equal(fs.statSync(saved).mode & 0o777, 0o600, 'the saved file is owner-only');

// Cleaning happens before the cut, but the saved file is the RAW text (colour codes included).
const coloured = Array.from({ length: 3000 }, (_, i) => `\x1b[32mok ${i}\x1b[0m ${'y'.repeat(20)}`).join('\n');
const colouredShaped = shapeForModel(coloured);
assert.ok(!colouredShaped.includes('\x1b'), 'the model never sees ANSI');
assert.ok(fs.readFileSync(/saved to (.+?) — /.exec(colouredShaped)[1], 'utf8').includes('\x1b[32m'), 'raw keeps what was printed');

// One enormous line (minified bundle): cut by code points, never inside a surrogate pair.
const emoji = '😀'.repeat(MAX_SHOWN);
const emojiShaped = shapeForModel(emoji).split('\n');
for (const part of [emojiShaped[1], emojiShaped.at(-1)]) assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(part), 'no lone surrogate at a cut');

// The spill directory keeps only the newest 20 files.
for (let i = 0; i < 25; i++) shapeForModel(raw + i);
assert.equal(fs.readdirSync(spillDir()).length, 20);

console.log('output-shape.test.js: ok');
