import { z } from 'zod';
import { assembleRuleContext, RuleContextError } from './rule-context.js';

export const RULE_CONTEXT_TOOL = 'akidevrule_context';
export const RULE_CONTEXT_TITLE = 'Load Effective Aki/Claude Context';
export const RULE_CONTEXT_DESCRIPTION = 'Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only.';
export const RULE_CONTEXT_INSTRUCTIONS = 'Before the first substantive action, call aki__akidevrule_context once; pass an absolute workingPath when known. Do not discover or read bootstrap files individually. A returned receipt is the only success signal.';

export function register(server, options = {}) {
  const assemble = options.assemble || assembleRuleContext;
  server.registerTool(RULE_CONTEXT_TOOL, {
    title: RULE_CONTEXT_TITLE,
    description: RULE_CONTEXT_DESCRIPTION,
    inputSchema: {
      workingPath: z.string().optional().describe('Absolute local file or directory path for applicable project context'),
      mode: z.enum(['effective', 'exact-audit']).optional().describe('Defaults to effective'),
      knownReceipt: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    },
  }, async (input) => {
    try {
      const result = await assemble(input);
      const header = `[RULES] ${result.parity} · ${result.receipt} · ${result.sources.length} sources`;
      return { content: [{ type: 'text', text: result.context ? `${header}\n\n${result.context}` : header }], structuredContent: result };
    } catch (error) {
      const code = error instanceof RuleContextError ? error.code : 'RULE_CONTEXT_ERROR';
      const result = { status: 'error', parity: 'practical-effective', receipt: null, rulesVersion: null, workingRoot: null, sources: [], warnings: [{ code, message: error.message }], context: '' };
      return { content: [{ type: 'text', text: `[RULES] error · ${code}: ${error.message}` }], structuredContent: result, isError: true };
    }
  });
}
