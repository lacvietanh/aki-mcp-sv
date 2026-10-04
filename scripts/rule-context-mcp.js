import { z } from 'zod';
import { assembleRuleContext, RuleContextError } from './rule-context.js';
import { aioboxInstalled, AIOBOX_PITCH } from './aiobox-guide.js';
import { recordIssued } from './rule-gate.js';

export const RULE_CONTEXT_TOOL = 'akidevrule_context';
export const RULE_CONTEXT_TITLE = 'Load Effective Aki/Claude Context';
// Both strings end with the /akirule step: SKILL.md is embedded every session via CLAUDE.md and echoed in this tool's output, so the step points the model at the already-present routing table; only the routed RULE/METHOD files still need a Read.
const AKIRULE_STEP = 'Then follow /akirule: the SKILL.md routing table is already included in this output (and in every session) — do not re-read SKILL.md; from its routes, Read only the RULE/METHOD files the task needs, since those are not preloaded. Open your first reply with `[RULES] agent (core) + <topics> (router)` naming the route files you actually Read; a receipt without (router), or the sha256 line copied, is a violation.';
// Printed first in every successful output (owner 2026-10-04): a web chat has no aki-route-guard hook, and with the sha256 line first it copied that as its receipt and skipped hop 2 (Read the routed RULE/METHOD files).
// Owner 2026-10-04: first line of every output, success or error.
export const NO_YAPPING = 'NO YAPPING AT ALL';
export const MANDATORY_BLOCK = 'BLOCKING — no rule Read, no action: before anything else, Read the route files the task matches in the SKILL.md table below (code → coding + pattern, .md → docs, decision → think). Every reply opens `[RULES] agent (core) + <topics> (router)` naming only files actually Read; no (router) = violation. Nothing is "done" without read-back evidence (agent.B2).';
const CONDUCT_STEP = 'Attempt an operation before calling it impossible, never claim a missing capability, and on failure report the exact command, absolute path, exit status and stderr; state the action and its impact before a destructive or external step.';
// Self-classifying, not server-detected: the shared MCP session (CLAUDE.md § Session lifecycle) never tracks per-client identity, so the model must judge this from its own nature, not be told which client it is.
const RESUME_STEP = 'If you are a stateless web chat with no session memory of your own (e.g. a browser AI chat) and the task spans multiple steps, keep a live working file at $HOME/.aki/mcpsv/task/<slug>/working.md (record the goal, progress so far, and the next step) — check for an existing one first and update it as you go — so a later session can resume; skip this if you already have your own persistent session/task tracking (local CLI or app) or the task is a single step.';
// How sessions share one checkout, the working file and handoff letters (owner 2026-10-04, aiobox audit-content-context G2–G4): AkiMCP's multi-session convention, so it ships here, not in AkiDevRule or the AIObox guide. Commit and push rules live in AkiDevRule.
export const SHARED_WORK = [
  'Working beside other sessions (AkiMCP convention):',
  "- Every session edits the same checkout. Before editing: `git status`. A file already dirty that you did not change is someone else's: do not edit, stash, check out or commit it; ask the coordinator whose it is.",
  "- Your task's working file: `$HOME/.aki/mcpsv/task/<slug>/working.md` (goal, progress, next step, the files you edit). Drafts and notes go there or in /tmp, never in `~/.aki/` itself or `~/.aki/aiobox/`.",
  '- Files everyone touches (`CHANGELOG.md`, `desktop/CHANGELOG.md`, `working.md`): edit only your own lines, right before committing. Commit with `git commit -m "…" -- <your paths>`, never `git add -A` or `.`.',
  '- Long or risky work on paths others touch too: `git worktree add <repo>/.claude/worktrees/<role> -b wt-<role>`, merged into main locally when done.',
  "- Handing work over: a letter in `~/.aki/handoff/` named for the successor's role. The successor reads it, the working.md and the old chat, takes over the working.md file list and tells the related sessions.",
].join('\n');
// The gate (scripts/rule-gate.js): every tool that acts refuses a call without the current receipt.
const RECEIPT_STEP = 'Every tool that acts (not read-only) takes receipt=<the sha256:… receipt this returns> and refuses without it, with an unknown one, or once the rules change; then call this again and pass the new receipt.';
const AIOBOX_STEP = 'If you are named by a handle like P2·W1 (AIObox puts it at the start of your page title), you run in an AIObox window: aki__aiobox op=whoami finds your own window, then op=state lists every window and returns the rules for acting in AIObox.';
export const RULE_CONTEXT_DESCRIPTION = `Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only. ${RECEIPT_STEP} ${AKIRULE_STEP} ${CONDUCT_STEP} ${RESUME_STEP} ${AIOBOX_STEP}`;
export const RULE_CONTEXT_INSTRUCTIONS = `Before the first substantive action, call aki__akidevrule_context once; pass an absolute workingPath when known. Do not discover or read bootstrap files individually. A returned receipt is the only success signal. ${RECEIPT_STEP} ${AKIRULE_STEP} ${CONDUCT_STEP} ${RESUME_STEP} ${AIOBOX_STEP}`;

// Required: the aiobox prompt and WEB_PROMPT call aki__akidevrule_context by name.
export const provider = { id: 'rule', title: 'Rule context', required: true, register };

export function register(server, options = {}) {
  const assemble = options.assemble || assembleRuleContext;
  const installed = options.aioboxInstalled || aioboxInstalled;
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
      recordIssued(result.receipt, input);
      // Without AIObox one line says what it would add (D7); once installed the line is gone and op=state carries the guide.
      // The receipt line is labelled context, not [RULES], so it cannot be mistaken for the reply's own [RULES] line.
      const header = `${NO_YAPPING}\n${MANDATORY_BLOCK}\n\ncontext loaded: ${result.parity} · ${result.receipt} · ${result.sources.length} sources\nEvery tool that acts needs receipt=${result.receipt}${installed() ? '' : `\n${AIOBOX_PITCH}`}`;
      // The assembled corpus ships once, in `content`. Keep it out of `structuredContent` so the ~90KB blob is not serialized twice on the wire (docs/plan/done/rule-context-payload-dedup.md).
      const { context, ...meta } = result;
      const text = `${header}\n\n${SHARED_WORK}`;
      return { content: [{ type: 'text', text: context ? `${text}\n\n${context}` : text }], structuredContent: meta };
    } catch (error) {
      const code = error instanceof RuleContextError ? error.code : 'RULE_CONTEXT_ERROR';
      const result = { status: 'error', parity: 'practical-effective', receipt: null, rulesVersion: null, workingRoot: null, sources: [], warnings: [{ code, message: error.message }] };
      return { content: [{ type: 'text', text: `${NO_YAPPING}\ncontext NOT loaded · ${code}: ${error.message}; no [RULES] line can be claimed until a call succeeds` }], structuredContent: result, isError: true };
    }
  });
}
