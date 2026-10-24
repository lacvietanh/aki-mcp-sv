import { z } from 'zod';
import { assembleRuleContext, RuleContextError } from './rule-context.js';
import { aioboxInstalled, AIOBOX_PITCH } from './aiobox-guide.js';
import { recordIssued } from './rule-gate.js';
import { sessionFor } from './session-file.js';

const RULE_CONTEXT_TOOL = 'akidevrule_context';
export const RULE_CONTEXT_TITLE = 'Load Effective Aki/Claude Context';
// Both strings end with the /akirule step: SKILL.md is already embedded every session, so the step points at its routing table; only the routed RULE/METHOD files need a Read.
const AKIRULE_STEP = 'Then follow /akirule: the SKILL.md routing table is already included in this output (and in every session) — do not re-read SKILL.md; from its routes, Read only the RULE/METHOD files the task needs, since those are not preloaded. Open your first reply with `[RULES] agent (core) + <topics> (router)` naming the route files you actually Read; a receipt without (router), or the sha256 line copied, is a violation.';
// Printed first (owner 2026-10-04): a web chat has no aki-route-guard hook, and with the sha256 line first it copied that as its receipt, skipping hop 2 (Read the routed files).
// Owner 2026-10-04: first line of every output, success or error.
const NO_YAPPING = 'NO YAPPING AT ALL';
export const MANDATORY_BLOCK = 'BLOCKING — no rule Read, no action: before anything else, Read the route files the task matches in the SKILL.md table below (code → coding + pattern, .md → docs, decision → think). Every reply opens `[RULES] agent (core) + <topics> (router)` naming only files actually Read; no (router) = violation. Nothing is "done" without read-back evidence (agent.B2).';
const CONDUCT_STEP = 'Attempt an operation before calling it impossible, never claim a missing capability, and on failure report the exact command, absolute path, exit status and stderr; state the action and its impact before a destructive or external step.';
// The one session-file rule (docs/plan/ss-session-file.md D7): the description, the instructions and SHARED_WORK all carry this constant, so they cannot disagree on when to write the ss.
const SS_STEP = 'Session file (ss): the `ss:` line of the aki__akidevrule_context result is this chat\'s file, an absolute path made for you; never build one yourself. Create it with the first act that changes something (a file edit, a commit, a writing command) or when the owner asks for it; skip it for Q&A and lookups. Keep one per chat: pass it back as ss=<path> on every later aki__akidevrule_context call and beside receipt on every acting call; a handoff successor keeps the ss its letter names. In every turn that acted, write it before replying (goal in the owner\'s words, state, next step, decisions, open items, the files you edit as absolute paths), and end that reply with one line `ss: <absolute path> · <what changed>`; no write, no line. A result line `ss: <path> · last written N min ago` or `· not created yet` means the file is behind this chat\'s work. `folder missing`: create the folder first.';
// How sessions share one checkout, session files and handoff letters (owner 2026-10-04): AkiMCP's own convention, not AkiDevRule's or the AIObox guide's. Commit/push rules stay in AkiDevRule.
export const SHARED_WORK = [
  'Working beside other sessions (AkiMCP convention):',
  "- Every session edits the same checkout. Before editing: `git status`. A file already dirty that you did not change is someone else's: do not edit, stash, check out or commit it; ask the coordinator whose it is.",
  `- ${SS_STEP}`,
  '- Files everyone touches (`CHANGELOG.md`, an ss another session also writes): edit only your own lines, right before committing. Commit with `git commit -m "…" -- <your paths>`, never `git add -A` or `.`.',
  '- Work in the shared checkout in turns, committing `-- <your paths>`. Create no worktree, build folder, clone or `node_modules` unless the work cannot be done without it (ask the coordinator first); whoever merges removes what was created in that same turn.',
  "- Handing work over: a letter in `~/.aki/handoff/` named for the successor's role. The successor reads the letter, the ss and the old chat, keeps writing that ss, takes over its Files list and tells the related sessions.",
].join('\n');
// The gate (scripts/rule-gate.js): every tool that acts refuses a call without the current receipt.
const RECEIPT_STEP = 'Every tool that acts (not read-only) takes receipt=<the sha256:… receipt this returns> and refuses without it, with an unknown one, or once the rules change; then call this again and pass the new receipt.';
// Names aki__aiobox, so it ships only where AIObox is installed: in the instructions of a server that serves aki__aiobox (tools-server.js).
// The tool description stays the same on every machine, so installing AIObox changes no existing tool definition.
export const AIOBOX_STEP = 'A page title starting with a handle like P2·W1 · means you are inside an AIObox window: call aki__aiobox op=state first.';
export const RULE_CONTEXT_DESCRIPTION = `Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only. ${RECEIPT_STEP} ${AKIRULE_STEP} ${CONDUCT_STEP} ${SS_STEP}`;
const BASE_INSTRUCTIONS = `Before the first substantive action, call aki__akidevrule_context once; pass an absolute workingPath when known. Do not discover or read bootstrap files individually. A returned receipt is the only success signal. ${RECEIPT_STEP} ${AKIRULE_STEP} ${CONDUCT_STEP} ${SS_STEP}`;
// Read once per server (per client session): an install after boot reaches a client at its next connect.
export const ruleContextInstructions = (aioboxServed) => (aioboxServed ? `${BASE_INSTRUCTIONS} ${AIOBOX_STEP}` : BASE_INSTRUCTIONS);

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
      ss: z.string().optional().describe('The ss path this tool returned earlier in this chat, kept instead of a new one'),
      label: z.string().optional().describe('A short name for this chat, used in a new ss file name'),
    },
  }, async (input) => {
    try {
      // The ss stays outside the rule input, so minting or keeping it never changes a receipt (D5, F9).
      const { ss, label, ...ruleInput } = input;
      const result = await assemble(ruleInput);
      recordIssued(result.receipt, ruleInput);
      const session = sessionFor({ ss, label, workingPath: ruleInput.workingPath, workingRoot: result.workingRoot });
      // Without AIObox one line says what it would add (D7); once installed the line is gone and op=state carries the guide.
      // The receipt line is labelled context, not [RULES], so it cannot be mistaken for the reply's own [RULES] line.
      const header = `${NO_YAPPING}\n${MANDATORY_BLOCK}\n\ncontext loaded: ${result.parity} · ${result.receipt} · ${result.sources.length} sources\nEvery tool that acts needs receipt=${result.receipt}\n${session.line}${installed() ? '' : `\n${AIOBOX_PITCH}`}`;
      // The assembled corpus ships once, in `content`. Keep it out of `structuredContent` so the ~90KB blob is not serialized twice on the wire (docs/plan/done/rule-context-payload-dedup.md).
      const { context, ...meta } = result;
      const text = `${header}\n\n${SHARED_WORK}`;
      // Claude Code may show the model only structuredContent (per-client-tool-surface V6), so the ss is there too.
      return { content: [{ type: 'text', text: context ? `${text}\n\n${context}` : text }], structuredContent: { ...meta, ss: { path: session.path, state: session.state } } };
    } catch (error) {
      const code = error instanceof RuleContextError ? error.code : 'RULE_CONTEXT_ERROR';
      const result = { status: 'error', parity: 'practical-effective', receipt: null, rulesVersion: null, workingRoot: null, sources: [], warnings: [{ code, message: error.message }] };
      return { content: [{ type: 'text', text: `${NO_YAPPING}\ncontext NOT loaded · ${code}: ${error.message}; no [RULES] line can be claimed until a call succeeds` }], structuredContent: result, isError: true };
    }
  });
}
