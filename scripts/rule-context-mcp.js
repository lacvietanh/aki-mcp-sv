import { z } from 'zod';
import { assembleRuleContext, RuleContextError } from './rule-context.js';

export const RULE_CONTEXT_TOOL = 'akidevrule_context';
export const RULE_CONTEXT_TITLE = 'Load Effective Aki/Claude Context';
// Both strings end with the /akirule step: SKILL.md is embedded every session via CLAUDE.md and echoed in this tool's output, so the step points the model at the already-present routing table; only the routed RULE/METHOD files still need a Read.
const AKIRULE_STEP = 'Then follow /akirule: the SKILL.md routing table is already included in this output (and in every session) — do not re-read SKILL.md; from its routes, Read only the RULE/METHOD files the task needs, since those are not preloaded. Open your first reply with its [RULES] line.';
const CONDUCT_STEP = 'Attempt an operation before calling it impossible, never claim a missing capability, and on failure report the exact command, absolute path, exit status and stderr; state the action and its impact before a destructive or external step.';
// Self-classifying, not server-detected: the shared MCP session (CLAUDE.md § Session lifecycle) never tracks per-client identity, so the model must judge this from its own nature, not be told which client it is.
const RESUME_STEP = 'If you are a stateless web chat with no session memory of your own (e.g. a browser AI chat) and the task spans multiple steps, keep a live working file at $HOME/.aki/mcpsv/task/<slug>/working.md (record the goal, progress so far, and the next step) — check for an existing one first and update it as you go — so a later session can resume; skip this if you already have your own persistent session/task tracking (local CLI or app) or the task is a single step.';
const AIOBOX_STEP = 'If you are named by a handle like P2·W1 (AIObox puts it at the start of your page title), you run in an AIObox window: aki__aiobox op=whoami finds your own window, then op=state lists every window and returns the rules for acting in AIObox.';
export const RULE_CONTEXT_DESCRIPTION = `Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only. ${AKIRULE_STEP} ${CONDUCT_STEP} ${RESUME_STEP} ${AIOBOX_STEP}`;
export const RULE_CONTEXT_INSTRUCTIONS = `Before the first substantive action, call aki__akidevrule_context once; pass an absolute workingPath when known. Do not discover or read bootstrap files individually. A returned receipt is the only success signal. ${AKIRULE_STEP} ${CONDUCT_STEP} ${RESUME_STEP} ${AIOBOX_STEP}`;

// Required: the aiobox prompt and WEB_PROMPT call aki__akidevrule_context by name.
export const provider = { id: 'rule', title: 'Rule context', required: true, register };

export function register(server, options = {}) {
  const assemble = options.assemble || assembleRuleContext;
  server.registerTool(RULE_CONTEXT_TOOL, {
    title: RULE_CONTEXT_TITLE,
    annotations: { readOnlyHint: true, openWorldHint: false },
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
      // The assembled corpus ships once, in `content`. Keep it out of `structuredContent` so the ~90KB blob is not serialized twice on the wire (docs/plan/done/rule-context-payload-dedup.md).
      const { context, ...meta } = result;
      return { content: [{ type: 'text', text: context ? `${header}\n\n${context}` : header }], structuredContent: meta };
    } catch (error) {
      const code = error instanceof RuleContextError ? error.code : 'RULE_CONTEXT_ERROR';
      const result = { status: 'error', parity: 'practical-effective', receipt: null, rulesVersion: null, workingRoot: null, sources: [], warnings: [{ code, message: error.message }] };
      return { content: [{ type: 'text', text: `[RULES] error · ${code}: ${error.message}` }], structuredContent: result, isError: true };
    }
  });
}
