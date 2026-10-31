# Fact: how clients name and limit MCP tool names

> updated 2026-10-31 · v3.3.1

Claims about the outside world that `scripts/mcp-name.js` (`CEILING`, `NAME_BUDGET`, `TOOL_BUDGET`, `KEY_RULE`, `PREFIX_RULE`) relies on. Current state only; every change lands through a research event ([`research/client-tool-name-limits.md`](../research/client-tool-name-limits.md)). agy's own facts live in [`fact-agy-mcp-config.md`](fact-agy-mcp-config.md).

## Sourced

| ID | Fact | Source | Read | Research |
|---|---|---|---|---|
| N1 | Claude Messages API: a tool `name` matches `^[a-zA-Z0-9_-]{1,128}$`. | platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | 2026-10-31 | § R1 |
| N2 | Claude Code names an MCP tool `mcp__<server>__<tool>` (plugin servers: `mcp__plugin_<plugin>_<server>__<tool>`, characters outside `A-Z a-z 0-9 _ -` become `_`); a server key uses letters, digits, `-` and `_`; `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser` are reserved. No length limit stated. | code.claude.com/docs/en/mcp | 2026-10-31 | § R1 |
| N3 | OpenAI function `name`: `a-z A-Z 0-9 _ -`, at most 64 characters. | `openai/openai-node` `src/resources/shared.ts` `FunctionDefinition.name` (generated from the API spec; platform.openai.com answered 403) | 2026-10-31 | § R2 |
| N4 | Codex sends MCP tools as `mcp__<server>__<tool>` and replaces disallowed characters (such as `-`) with `_`. | github.com/openai/codex/issues/15565 (closed 2026-03-28, PR #15946) | 2026-10-31 | § R2 |
| N5 | Cursor: server key + tool name over 60 characters raises a warning and is truncated with a hash suffix, not refused (staff reply, no official doc page). | forum.cursor.com/t/posthog-mcp-tool-names-too-long/155408, post of 2026-03-20 | 2026-10-31 | § R3 |
| N6 | MCP spec 2025-11-25: tool names SHOULD be 1 to 128 characters, case-sensitive, only `A-Z a-z 0-9 _ - .`. | modelcontextprotocol.io/specification/2025-11-25/server/tools § Tool Names | 2026-10-31 | § R4 |

What the code takes from them: the binding cap is N3 through N4, `mcp__` + Server ID + `__` + Tool prefix + tool ≤ 64, so `CEILING` = 64; Cursor (N5) and Claude Code (N1, N2) are looser. The Server ID and prefix charset `[a-z0-9]` (plus the prefix's `__`) is inside N1 to N4 and N6 and carries no `-` for Codex to rewrite (research § R5).

## Unsourced

| Client | Claim | Tag |
|---|---|---|
| Codex | what happens to a qualified name over 64 | ASSUMPTION |
| claude.ai web connector | shown name and its cap | ASSUMPTION |
| ChatGPT connector | shown name composition | ASSUMPTION |
| Gemini web connector, Gemini API | name form and cap (Google pages disagree: 64 vs 128) | ASSUMPTION |
| Grok, Notion, Buda, Postman | shown name and cap | ASSUMPTION |
| ClickUp Super Agent | cap on `<connector name>__<tool>` | ASSUMPTION |
