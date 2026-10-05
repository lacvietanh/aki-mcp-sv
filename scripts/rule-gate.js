// Every tool that acts refuses a call without the receipt of the rules in force (docs/plan/rule-receipt-gate.md): an AI that skipped aki__akidevrule_context cannot write until it loads the rules. A receipt proves the rules were issued, not that they are still in the AI's context: after a compaction it still passes, so the refusal text tells the AI to reload without knownReceipt.
// A gated call that touches a project whose rule files the receipt does not cover is not run: the result carries those rules and a new receipt (D23 in docs/plan/akimcp-tool-refactor.md).
// A receipt counts only when this server issued it (aki__akidevrule_context records it here, in memory) and the same call made now still returns it: a changed rule file changes the receipt, so the old one is refused.
import { z } from 'zod';
import { assembleRuleContext } from './rule-context.js';
import { pathsOf, rulesFor, rulesBlock } from './project-rules.js';

export const RECEIPT_ARG = 'receipt';
const RECEIPT_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_ISSUED = 200;
export const receiptSchema = z.string().optional().describe('required: the sha256:… receipt from aki__akidevrule_context');

let assemble = assembleRuleContext;
const issued = new Map(); // receipt → { mode, workingPath, extraFiles }, oldest first

// Tests swap the assembler; the issued list starts empty again.
export function setAssembler(fn) {
  assemble = fn || assembleRuleContext;
  issued.clear();
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

// The project rule files this call touches that the receipt does not cover yet: a new receipt covering them and the text to show, or null to run the call.
async function uncovered(own, entry, current) {
  const known = new Set((current.sources || []).map((s) => s.path));
  const missing = (await rulesFor(pathsOf(own))).filter((f) => !known.has(f));
  if (!missing.length) return null;
  const extraFiles = [...new Set([...entry.extraFiles, ...missing])].sort();
  let next;
  try { next = await assemble({ mode: entry.mode, workingPath: entry.workingPath, extraFiles }); } catch { return null; }
  const paths = (next?.sources || []).map((s) => s.path);
  if (!next?.receipt || !missing.every((f) => paths.includes(f))) return null; // could not load them (size limit, unreadable): run rather than loop
  recordIssued(next.receipt, { mode: entry.mode, workingPath: entry.workingPath, extraFiles });
  return { receipt: next.receipt, files: paths.filter((p) => !known.has(p)) };
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
      return { content: [
        { type: 'text', text: await rulesBlock(pending.files) },
        { type: 'text', text: `Not run yet: rules for this path are above. Call again with receipt=${pending.receipt}.` },
      ] };
    }
    return hadSchema ? handler(own, ...rest) : handler(...rest);
  };
}
