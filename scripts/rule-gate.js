// Every tool that acts refuses a call without the receipt of the rules in force (docs/plan/rule-receipt-gate.md): an AI that skipped aki__akidevrule_context cannot write until it loads the rules. A receipt proves the rules were issued, not that they are still in the AI's context: after a compaction it still passes, so the refusal text tells the AI to reload without knownReceipt.
// A gated call that touches a project whose rule files the receipt does not cover is not run: the result carries those rules and a new receipt (D23 in docs/plan/akimcp-tool-refactor.md). Read tools always run and append one line naming the rule files.
// A receipt counts only when this server issued it (aki__akidevrule_context records it here, in memory) and the same call made now still returns it: a changed rule file changes the receipt, so the old one is refused.
import { z } from 'zod';
import { assembleRuleContext } from './rule-context.js';
import { pathsOf, rulesFor, rulesBlock, rulesLine, contentSha } from './project-rules.js';

export const RECEIPT_ARG = 'receipt';
const RECEIPT_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_ISSUED = 200;
export const receiptSchema = z.string().optional().describe('required: the sha256:… receipt from aki__akidevrule_context');

let assemble = assembleRuleContext;
const issued = new Map(); // receipt → { mode, workingPath, extraFiles }, oldest first
// S9: calls made together with the same receipt into a project it does not cover each held the whole rule file; the first result carries it, the others for SHOWN_MS only point at it.
const shown = new Map(); // `${receipt}|${rule file sha256}` → ms its text went out in a result, oldest first
const SHOWN_MS = 10_000;
let now = () => Date.now();

// Tests swap the assembler; the issued list starts empty again.
export function setAssembler(fn) {
  assemble = fn || assembleRuleContext;
  issued.clear();
  shown.clear();
}

// Tests move the clock the shown window is measured on.
export function setNow(fn) {
  now = fn || (() => Date.now());
}

// Called by aki__akidevrule_context with the receipt it returned and the input that produced it, so a check can make the same call again.
export function recordIssued(receipt, input = {}) {
  if (typeof receipt !== 'string' || !RECEIPT_RE.test(receipt)) return;
  issued.delete(receipt);
  const extraFiles = [...new Set(Array.isArray(input.extraFiles) ? input.extraFiles : [])].sort();
  issued.set(receipt, { mode: input.mode || 'effective', workingPath: input.workingPath ?? null, extraFiles });
  while (issued.size > MAX_ISSUED) issued.delete(issued.keys().next().value);
}

const AGAIN = 'call aki__akidevrule_context (without knownReceipt if the rules are no longer in your context), then call this tool again with receipt=<the sha256:… it returns> (a schema of this tool without receipt is stale: reconnect AkiMCP first)';

// { refused: { code, message } } or { entry, current } with the rules the receipt stands for now.
async function verify(receipt) {
  if (receipt === undefined || receipt === null || receipt === '') return { refused: { code: 'RULE_RECEIPT_MISSING', message: `no rule receipt: ${AGAIN}` } };
  if (typeof receipt !== 'string' || !RECEIPT_RE.test(receipt)) return { refused: { code: 'RULE_RECEIPT_INVALID', message: `receipt must be sha256:<64 hex>: ${AGAIN}` } };
  const entry = issued.get(receipt);
  if (!entry) return { refused: { code: 'RULE_RECEIPT_UNKNOWN', message: `this AkiMCP never issued that receipt, or restarted since: ${AGAIN}` } };
  let current;
  try {
    current = await assemble({ mode: entry.mode, workingPath: entry.workingPath, extraFiles: entry.extraFiles });
  } catch (error) {
    return { refused: { code: 'RULE_RECEIPT_UNCHECKED', message: `the rules could not be read to check the receipt (${error.message}): ${AGAIN}` } };
  }
  if (current?.receipt !== receipt) return { refused: { code: 'RULE_RECEIPT_STALE', message: `the rules changed since that receipt: ${AGAIN}` } };
  return { entry, current };
}

// null = the receipt is current; otherwise { code, message } for the refusal.
export async function checkReceipt(receipt) {
  return (await verify(receipt)).refused || null;
}

// The project rule files this call touches that the receipt does not cover yet: a new receipt covering them and the text to show, or null to run the call. A file with the same bytes as one the receipt covers is covered (S6: a worktree's copy of its repo's CLAUDE.md).
async function uncovered(own, entry, current) {
  const known = new Set((current.sources || []).map((s) => s.path));
  const knownSha = new Set((current.sources || []).map((s) => s.sha256).filter(Boolean));
  const missing = [];
  const shaOf = new Map();
  for (const f of await rulesFor(pathsOf(own))) {
    if (known.has(f)) continue;
    const sha = await contentSha(f);
    if (knownSha.has(sha)) continue;
    missing.push(f);
    if (sha) shaOf.set(f, sha);
  }
  if (!missing.length) return null;
  const extraFiles = [...new Set([...entry.extraFiles, ...missing])].sort();
  let next;
  try { next = await assemble({ mode: entry.mode, workingPath: entry.workingPath, extraFiles }); } catch { return null; }
  const paths = (next?.sources || []).map((s) => s.path);
  if (!next?.receipt || !missing.every((f) => paths.includes(f))) return null; // could not load them (size limit, unreadable): run rather than loop
  recordIssued(next.receipt, { mode: entry.mode, workingPath: entry.workingPath, extraFiles });
  return { receipt: next.receipt, files: paths.filter((p) => !known.has(p)), shaOf };
}

// Splits the files to show into those no result showed with this receipt in the last SHOWN_MS (marked shown now) and those one just did. Synchronous, so of calls made together the first to get here shows them.
function claimShown(receipt, files, shaOf) {
  const t = now();
  const fresh = [];
  const recent = [];
  for (const f of files) {
    const key = shaOf.has(f) ? `${receipt}|${shaOf.get(f)}` : null;
    if (key && t - (shown.get(key) ?? -Infinity) < SHOWN_MS) { recent.push(f); continue; }
    fresh.push(f);
    if (key) { shown.delete(key); shown.set(key, t); }
  }
  while (shown.size > MAX_ISSUED) shown.delete(shown.keys().next().value);
  return { fresh, recent };
}

// A tool is gated unless it declares it cannot write (readOnlyHint true, the same flag clients use to skip confirmation).
export const isGated = (config) => config?.annotations?.readOnlyHint !== true;

// The tool's input schema with receipt added: a raw shape, a zod object, or none at all.
export function withReceipt(inputSchema) {
  if (inputSchema === undefined) return { [RECEIPT_ARG]: receiptSchema };
  if (typeof inputSchema?.extend === 'function') {
    if (inputSchema.shape?.[RECEIPT_ARG]) throw new Error(`a gated tool already has an input named ${RECEIPT_ARG}`);
    return inputSchema.extend({ [RECEIPT_ARG]: receiptSchema });
  }
  if (inputSchema[RECEIPT_ARG]) throw new Error(`a gated tool already has an input named ${RECEIPT_ARG}`);
  return { ...inputSchema, [RECEIPT_ARG]: receiptSchema };
}

// Wraps a gated tool's handler: checks and strips receipt, then calls the tool as it was registered (a tool registered without an input schema gets only `extra`).
export function gate(handler, hadSchema) {
  return async (input, ...rest) => {
    const { [RECEIPT_ARG]: receipt, ...own } = input || {};
    const { refused, entry, current } = await verify(receipt);
    if (refused) return { content: [{ type: 'text', text: `${refused.code}: ${refused.message}` }], isError: true };
    const pending = hadSchema ? await uncovered(own, entry, current) : null;
    if (pending) {
      const { fresh, recent } = claimShown(receipt, pending.files, pending.shaOf);
      const again = `Call again with receipt=${pending.receipt}.`;
      const elsewhere = recent.length ? `${recent.map((f) => `${f} (sha256 ${pending.shaOf.get(f).slice(0, 12)})`).join(', ')} went with another call a moment ago; if no result in this turn shows ${recent.length > 1 ? 'them' : 'it'}, read ${recent.length > 1 ? 'them' : 'it'} with aki__read_text_file first. ` : '';
      if (!fresh.length) return { content: [{ type: 'text', text: `Not run yet: the rules for this path, ${elsewhere}${again}` }] };
      return { content: [
        { type: 'text', text: await rulesBlock(fresh) },
        { type: 'text', text: `Not run yet: rules for this path are above. ${elsewhere}${again}` },
      ] };
    }
    return hadSchema ? handler(own, ...rest) : handler(...rest);
  };
}

// Wraps a read tool's handler: it always runs; when it touched a project with rule files, one line naming them is appended (structuredContent stays as the tool made it).
export function withRules(handler, hadSchema) {
  return async (...args) => {
    const result = await handler(...args);
    if (!hadSchema || !Array.isArray(result?.content) || result.isError) return result;
    try {
      const line = await rulesLine(await rulesFor(pathsOf(args[0])));
      return line ? { ...result, content: [...result.content, { type: 'text', text: line }] } : result;
    } catch {
      return result; // a rule lookup never breaks a read
    }
  };
}
