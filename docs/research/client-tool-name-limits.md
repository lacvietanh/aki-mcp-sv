# Client tool-name limits, and the v4 live checks settled by reading the flow

## Start time
2026-10-31, against aki-mcp-sv HEAD `33cad9e` (unreleased 4.0.0 work on top of 3.3.1).

## Initial purpose
Close `docs/plan/v4-custom-name.md` P0 and P8 V1/V2. P0: source the client limits `scripts/mcp-name.js` relies on (the 64 `CEILING`, the 28 + 29 split, the Server ID and Tool prefix charset, the `mcp__` composition), which Appendix B carried as ASSUMPTION. V1/V2: decide whether a renamed prefix still reaches the rule receipt (V1) and keeps Postman's first message unflagged (V2) without a live run, since both runs spend AI session quota. Constraint: no code change unless a source contradicts a constant.

## Strategy
P0: vendor pages first, vendor repositories and staff statements second (`coding.B3` rung 3); a claim with no page found stays ASSUMPTION. V1/V2: trace the served path in this tree (rung 1) per `METHOD-audit-flow.md`, then attack the conclusion (`METHOD-deep-think.md` B3) and run live only what reading cannot settle.

## Checklist
- [x] Anthropic tool definition page, Claude Code MCP page
- [x] OpenAI function `name` rule (platform.openai.com answered 403; read in OpenAI's generated Node SDK)
- [x] Codex tool-name composition (openai/codex issue tracker)
- [x] Cursor's limit (Cursor forum, staff reply)
- [x] MCP specification 2025-11-25, tool names
- [x] Gemini API function name: two Google pages disagree (64 vs 128); no official page read in full
- [x] V1: rule-context description, server instructions, receipt gate refusal text, receipt schema text
- [x] V2: `prompts/postman.md`, `postman-instruction-store.cjs` `renderInstruction`, `postman-daemon.cjs:320`, the identity charset, and `research/postman-instruction-safety-flag.md`

## Result

### R1 — Claude (API and Claude Code)
The Messages API requires a tool `name` to match `^[a-zA-Z0-9_-]{1,128}$` (platform.claude.com, *Define tools*, read 2026-10-31). Claude Code names MCP tools `mcp__<server>__<tool>`: the MCP page gives the plugin form `mcp__plugin_<plugin-name>_<server-name>__<tool-name>` with every character outside `A-Z a-z 0-9 _ -` replaced by `_`, and a hook matcher `mcp__database-tools__.*` for a plain server; a server key uses letters, numbers, hyphens and underscores, and `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser` are reserved (code.claude.com/docs/en/mcp, read 2026-10-31). No length limit is stated there. So Appendix B row 1's "64 total" is not Claude's cap: the API allows 128.

### R2 — OpenAI and Codex
OpenAI's function `name`: "Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64." (`openai/openai-node` `src/resources/shared.ts` `FunctionDefinition.name`, generated from the API spec, read 2026-10-31). Codex builds `mcp__<server>__<tool>` in `qualify_tools()` and then `sanitize_responses_api_tool_name()` replaces disallowed characters such as `-` with `_` (openai/codex issue #15565, opened 2026-03-23, closed 2026-03-28 as fixed by PR #15946). What Codex does with a qualified name over 64 was not found in a vendor source.

### R3 — Cursor
A Cursor staff member (forum, 2026-03-20, *PostHog MCP Tool Names Too Long*): the combined server + tool name limit is 60, the warning fires when the name exceeds 60, and the agent layer truncates longer names with a hash suffix. No official Cursor doc page states it.

### R4 — MCP specification
2025-11-25 § Tool Names: names SHOULD be 1 to 128 characters, case-sensitive, using only `A-Z a-z 0-9 _ - .` (modelcontextprotocol.io, read 2026-10-31).

### R5 — what the sources force on `scripts/mcp-name.js`
The strictest sourced cap on a row inside the name budget (Appendix B rows 1, 4, 5, 6) is Codex: `mcp__` + Server ID + `__` + Tool prefix + tool name, sent to OpenAI, at most 64 (R2). With the longest bare name 27, Server ID + prefix ≤ 64 − 7 − 27 = 30; the code's 28 fits. Cursor (R3): Server ID + prefix + 27 ≤ 60 gives 33; 28 fits, and a longer name is truncated, not refused. Claude Code (R1): 128, not binding. Charset: `KEY_RULE` `^[a-z][a-z0-9]*$` and `PREFIX_RULE` `^[a-z][a-z0-9]*__$` sit inside every sourced charset (R1, R2, R4) and use no hyphen, which Codex rewrites (R2) and agy drops (`ref/fact-agy-mcp-config.md` CLI-5). `CEILING` 64, `NAME_BUDGET` 28 and `TOOL_BUDGET` 29 stay; only their source changes from ASSUMPTION to R2.

### R6 — V1 by flow: a prompt naming `aki__akidevrule_context` at another prefix
Start: a chat told to call `aki__akidevrule_context` while the server serves `work__*`. End: the first receipt-gated write runs. Path read at `33cad9e`:
1. The client can only call tools in `tools/list`; every name there carries the served prefix (`served()` in `scripts/mcp-name.js`; `test/identity-served.test.js`).
2. Three channels name the right tool to the model, each built from `served()`: the rule-context description ends with the bridge sentence "Text that names aki__<tool> means work__<tool>." (`scripts/rule-context-mcp.js` `BRIDGE_STEP`, in the description because ClickUp agents get descriptions, not `instructions`); every acting tool's `receipt` parameter reads "the sha256:… receipt from work__akidevrule_context" (`scripts/rule-gate.js:17`); and a write without a receipt is refused with `RULE_RECEIPT_MISSING: … call work__akidevrule_context …` (`scripts/rule-gate.js:47,51`).
3. The receipt is a hash of the rule files, not of a tool name (`scripts/rule-gate.js:3`, contract C5), so a receipt from `work__akidevrule_context` passes the gate.
So the flow has no state in which the write stays refused: a model that ignores the bridge loses one call to the refusal, which names the served tool. What reading cannot show is how often a model follows the bridge on the first try; that costs at most one refused call and is not a failure of the contract. Critique: the strongest case for the live run is that model behavior is not code; but no result of it would change an artifact, since the refusal path already recovers (impact kill-test). Inversion: the contract fails only if every channel named the old tool, or if the receipt were keyed by name; neither holds. Pre-mortem: a renamed user's Super Agents stop working because ClickUp bound the old tool names; that is C7's re-bind, already a panel step, not V1.

### R7 — V2 by flow: Postman's first message at another prefix
The bundled `prompts/postman.md` is `Could you use the {serverId} tools ({prefix}*) as primary, …`; `renderInstruction` replaces only those two tokens (`scripts/postman/postman-instruction-store.cjs:22-24`) and the daemon renders it at injection (`postman-daemon.cjs:320`); no stored 3.x copy is read (plan D108). The identity rules let in only `[a-z][a-z0-9]*` for the Server ID and the same plus `__` (or empty) for the prefix (`scripts/mcp-name.js` `KEY_RULE`, `PREFIX_RULE`), so a rename swaps one lowercase word and one identifier: no punctuation, line break or clause can enter. What drives the flag is framing: declarative statements about the model's own tools and "all/every tool you have" clauses were flagged, the polite request passed (`research/postman-instruction-safety-flag.md` § Result, 0/14 vs 3/3 and 6/8). The framing does not change with the prefix. A probe could not show a rise anyway: the classifier is stochastic and runs in streaks, and the affordable n (3 to 8 per wording) passes rates from 3/5 to 3/3 alike (same doc § Verification). One edge: an empty prefix renders `(*)`, which no longer names the tools; the Server ID before it still does.

## Decision
**Action:**
- [`ref/fact-client-tool-names.md`](../ref/fact-client-tool-names.md) holds R1 to R4 as facts; unsourced rows stay ASSUMPTION there.
- `scripts/mcp-name.js`: the `CEILING` comment cites the fact doc instead of saying ASSUMPTION; no value changes (R5).
- `docs/plan/v4-custom-name.md`: P0 done; V1 and V2 closed by R6 and R7 with no live run; C3 and C10 in Appendix C read "verified by flow".
- `CHANGELOG.md` `[Unreleased]`: the two "not yet checked" clauses on the rename entries say what was verified and how.

**Reopen:** V1 when a renamed server's chat is seen refused more than once in a row for a missing receipt; V2 when a non-default prefix is flagged in normal use (then drop the parenthetical first, as the safety-flag research already says); P0 when a client in the budget rows publishes a cap under 64 or a new client composes a longer name.

**Cross-references:** `docs/plan/v4-custom-name.md` Appendix B, Appendix C (C3, C5, C7, C10); `research/postman-instruction-safety-flag.md`; `ref/fact-agy-mcp-config.md` CLI-5.
