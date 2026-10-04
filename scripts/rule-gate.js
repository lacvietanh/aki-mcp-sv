// Every tool that acts refuses a call without the receipt of the rules in force (docs/plan/rule-receipt-gate.md): an AI that skipped aki__akidevrule_context, or lost its output to a compaction, cannot write until it loads the rules again.
// A receipt counts only when this server issued it (aki__akidevrule_context records it here, in memory) and the same call made now still returns it: a changed rule file changes the receipt, so the old one is refused.
import { z } from 'zod';
import { assembleRuleContext } from './rule-context.js';

export const RECEIPT_ARG = 'receipt';
const RECEIPT_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_ISSUED = 200;
export const receiptSchema = z.string().optional().describe('required: the sha256:… receipt from aki__akidevrule_context');

let assemble = assembleRuleContext;
const issued = new Map(); // receipt → { mode, workingPath }, oldest first

// Tests swap the assembler; the issued list starts empty again.
export function setAssembler(fn) {
  assemble = fn || assembleRuleContext;
  issued.clear();
}

// Called by aki__akidevrule_context with the receipt it returned and the input that produced it, so a check can make the same call again.
export function recordIssued(receipt, input = {}) {
  if (typeof receipt !== 'string' || !RECEIPT_RE.test(receipt)) return;
  issued.delete(receipt);
  issued.set(receipt, { mode: input.mode || 'effective', workingPath: input.workingPath ?? null });
  while (issued.size > MAX_ISSUED) issued.delete(issued.keys().next().value);
}

const AGAIN = 'call aki__akidevrule_context, then call this tool again with receipt=<the sha256:… it returns> (a schema of this tool without receipt is stale: reconnect AkiMCP first)';

// null = the receipt is current; otherwise { code, message } for the refusal.
export async function checkReceipt(receipt) {
  if (receipt === undefined || receipt === null || receipt === '') return { code: 'RULE_RECEIPT_MISSING', message: `no rule receipt: ${AGAIN}` };
  if (typeof receipt !== 'string' || !RECEIPT_RE.test(receipt)) return { code: 'RULE_RECEIPT_INVALID', message: `receipt must be sha256:<64 hex>: ${AGAIN}` };
  const entry = issued.get(receipt);
  if (!entry) return { code: 'RULE_RECEIPT_UNKNOWN', message: `this AkiMCP never issued that receipt, or restarted since: ${AGAIN}` };
  let current;
  try {
    current = await assemble({ mode: entry.mode, workingPath: entry.workingPath });
  } catch (error) {
    return { code: 'RULE_RECEIPT_UNCHECKED', message: `the rules could not be read to check the receipt (${error.message}): ${AGAIN}` };
  }
  if (current?.receipt !== receipt) return { code: 'RULE_RECEIPT_STALE', message: `the rules changed since that receipt: ${AGAIN}` };
  return null;
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
    const refused = await checkReceipt(receipt);
    if (refused) return { content: [{ type: 'text', text: `${refused.code}: ${refused.message}` }], isError: true };
    return hadSchema ? handler(own, ...rest) : handler(...rest);
  };
}
