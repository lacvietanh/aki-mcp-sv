# Rule context delivery architecture

> updated 2026-10-31 · v4.0.0

## Decision

Adopt a **Rule Context Handshake** owned by the MCP server: compact static initialize instructions direct the client to call one indexed `aki__akidevrule_context` tool before substantive work, and that tool deterministically assembles the effective global and project context that Claude Code would load.

Tool names here use the default prefix `aki__`. A server with another Tool prefix serves the same tools under that prefix; panel section 1 shows yours.

The Postman control prompt becomes a temporary one-line compatibility trigger only; it must never ask the model to discover paths, traverse imports, search skills, or read bootstrap files individually.

An optional MCP resource may expose assembled context for inspection, but it is not the startup mechanism; no MCP prompt is added in v1.

## Non-negotiable invariant

**Postman acquires Claude Code-equivalent effective default context across Windows, macOS, and Linux in one model-visible tool call, with context discovery and assembly performed by the MCP server rather than by the model.**

## Goal and parity boundary

Immediate goal → remove repeated bootstrap prompts and multi-step file reads → make context loading deterministic, fast, observable, and cross-platform → give Postman the same practical working context Claude Code receives by default.

**Exact Claude Code parity** would require the client to guarantee the same pre-model injection timing, import semantics, precedence, and applicable ancestor-file behavior as the Claude Code harness; an MCP server alone cannot guarantee this because the client owns what enters model context before the first decision.

**Practical effective parity** is the deliverable: before substantive work, Postman receives the same load-bearing global guidance and applicable project guidance in deterministic order, with provenance and a receipt, through one indexed tool call and no model-orchestrated bootstrap reads.

## Current failure shape

The current prompt delegates a deterministic filesystem procedure to a probabilistic model: identify files, choose tools, resolve paths, follow imports, index skills, recover from failures, and report completion.

This creates repeated round trips, incorrect tool selection, subagent delegation to workers that do not inherit user MCP tools, retries through unrelated capabilities, shell quoting failures, and platform-specific path assumptions.

Prompt refinement cannot fully solve this ownership error because the prompt still asks the model to implement the loader on every new chat.

## Ten-pass findings

1. **Flow:** context assembly belongs before reasoning and must be one native operation, not a workflow reconstructed by the model.
2. **Claude baseline:** Claude Code mechanically loads global guidance and imports; Postman needs the same effective content, not merely a reminder that the files exist.
3. **Prompt:** the recurring bootstrap prompt is compensating machinery whose procedural detail increases failure modes.
4. **Indexed tool:** a dedicated tool name, title, schema, and description are discoverable through `tools/list` and provide the strongest portable action surface.
5. **Initialize instructions:** static server instructions are suitable for a compact call trigger but not for dynamic project context or the entire corpus.
6. **Resources and prompts:** resources are useful for inspection, while selectable MCP prompts do not improve automatic startup and are excluded from v1.
7. **Freshness:** assembled context must come from live files with dependency-aware in-memory caching, never from a second persisted corpus.
8. **Cross-platform paths:** context assembly must use Node path and filesystem APIs, not shell commands, tilde literals, Unix utilities, or slash-based parsing.
9. **Trust:** fixed global configuration zones and configured project roots require distinct containment rules, provenance, cycle guards, and no execution semantics.
10. **Reliability:** one local MCP call replaces many model-visible reads; a receipt makes missing context observable without claiming exact harness parity.

## Architecture overview

The architecture has four layers; two are live (1, 2), one was replaced by the receipt gate (3) and one is not built (4):

1. **Static handshake instruction:** the MCP initialize response says to call `aki__akidevrule_context` once before the first substantive action and pass an absolute working path when known.
2. **Dedicated context tool:** the server resolves sources, imports, ordering, project applicability, hashes, warnings, and assembled Markdown.
3. **Postman fallback (replaced):** PM control was to inject one short line naming the tool until initialize instructions were proven to reach Agent Mode. That trigger was never needed: Gate 1 was dropped on 2026-10-22 because every tool that acts refuses a call without the receipt (`plan/done/rule-receipt-gate.md`), so a client calls the context tool whether or not its model sees the instructions. The bundled Postman instruction (`scripts/postman/prompts/postman.md`) is a tool-preference line that names no tool.
4. **Optional inspection resource (not built):** `akidevrule://effective-context` would expose global effective context for clients supporting resources, through the same assembler, never as a bootstrap dependency. No resource is registered today.

All surfaces share one pure context-assembler module so path resolution, import parsing, precedence, hashing, and failure policy have one source of truth.

## `aki__akidevrule_context` contract

### Indexed definition

**Name:** `aki__akidevrule_context`

**Title:** `Load Effective Aki/Claude Context`

**Description:** `Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only.` followed by four steps, the same four that end the initialize instructions (`scripts/rule-context-mcp.js`, one constant each): receipt (every tool that acts takes `receipt=<sha256:…>` and refuses without the current one); follow `/akirule` (the `SKILL.md` routing table is already in the output; Read only the routed RULE/METHOD files; open with `[RULES] agent (core) + <topics> (router)` naming the files actually Read; a receipt without `(router)` is a violation); conduct (attempt before calling a thing impossible, report failures exactly, state impact before a destructive step); session file (`SS_STEP`; the `ss:` line of this tool's result is the chat's file, a path the server made, kept across re-calls — the file's shape, the one-writer handoff chain and every line AkiMCP reports about it live in [`feat/session-file.md`](../feat/session-file.md)). The write-time fact line and the acting-call stale line are both facts, never orders. Where `aki__aiobox` is served, the initialize instructions (not this description, which is the same on every machine) end with one more line, the L0 bootstrap: `A page title starting with a handle like P2·W1 · means you are inside an AIObox window: call aki__aiobox op=state first.` The description is the one tool allowed past the 700-character cap of `test/tool-surface.test.js`.

### Input

```json
{
  "workingPath": "optional absolute file or directory path",
  "mode": "effective | exact-audit",
  "knownReceipt": "optional sha256 receipt",
  "ss": "optional ss path an earlier call returned",
  "label": "optional short name for the chat, used in a new ss name"
}
```

`ss` and `label` stay outside the rule input, so they never change the receipt. Without a valid `ss` the tool mints `<data dir>/ss/<project>/<YYYY.MM.DD-HHMM>-<label>.md` (`<project>` = basename of the nearest git folder, else the working folder's real path with every character outside `[A-Za-z0-9._-]` as `-`, Claude Code's key; `_` only without a `workingPath`); a valid one is returned as it is. It creates no file and no folder (`scripts/session-file.js`).

`effective` is the normal mode and returns the context required for work.

`exact-audit` adds skipped candidates, precedence trace, import graph, byte counts, and diagnostic warnings; it does not claim exact Claude Code injection parity.

The API accepts no arbitrary file list, glob, command, shell expression, or URL.

### Output

```json
{
  "status": "ok | unchanged | degraded | error",
  "parity": "practical-effective | exact-audit-not-guaranteed",
  "receipt": "sha256:<digest>",
  "rulesVersion": "string or null",
  "workingRoot": "absolute path or null",
  "sources": [{ "path": "absolute", "kind": "global | import | project | local", "sha256": "...", "bytes": 123 }],
  "warnings": [],
  "ss": { "path": "absolute or null", "state": "new | kept | ignored | unavailable" },
  "context": "ordered assembled Markdown"
}
```

The text fallback begins with the line `NO YAPPING AT ALL` (owner 2026-10-04; also first in an error), then one short BLOCKING paragraph (`MANDATORY_BLOCK`, ≤ 400 chars, owner 2026-10-04): no rule Read, no action — Read the matching route files first (code → coding + pattern, `.md` → docs, decision → think); every reply opens with `[RULES] agent (core) + <topics> (router)` naming only files actually Read; nothing is done without read-back evidence (agent.B2). A web chat has no aki-route-guard hook, and while the output opened with a `[RULES] practical-effective · sha256:…` line, models copied that as their receipt and skipped the routed Reads. The receipt follows as `context loaded: practical-effective · <receipt> · <source-count> sources`, so no output line starts with `[RULES]`; a failure reads `context NOT loaded · <code>: …`. After the receipt line comes one `ss:` line: `ss: <path> · new · folder ready|missing`, `ss: <path> · kept` (`· not created yet` when the file does not exist), `ss: <path> · new (the ss given was ignored: not an ss path)`, or `ss: unavailable · <data dir> is outside the allowed folders; add it under Folders in the panel`. While `~/.aki/aiobox/` is missing, the header ends with one pitch sentence saying what AIObox adds and linking its web guide (checked on every call); once AIObox is installed the header carries no pitch and `aki__aiobox op=state` returns the guide. After the header comes `SHARED_WORK`, AkiMCP's convention for sessions sharing one checkout (owner 2026-10-04, aiobox `docs/research/audit-content-context-2026-10-04.md` G2–G4, moved out of the AIObox guide): `git status` first and never touch another session's dirty file, the session-file rule (the same `SS_STEP` text as the description's last step), own lines only in shared files, `git commit -- <paths>`, work in the shared checkout in turns with no new worktree, build folder, clone or `node_modules` unless unavoidable, handoff letters in `~/.aki/handoff/` that only point at an ss, the successor minting its own with `parent:`/`successor:` (`feat/session-file.md` § One writer, chained handoffs). Commit and push rules stay in AkiDevRule.

The assembled `context` ships once, in the text `content`; `structuredContent` carries every other field but not `context`, so the ~90 KB corpus is not serialized twice (`docs/plan/done/rule-context-payload-dedup.md`).

`knownReceipt` may return `unchanged` without the body only when the same chat demonstrably retains the prior tool result; a fresh chat always receives the full context.

## Deterministic source ordering and imports

The assembler derives global locations from the current user's home directory and loads canonical global Claude guidance first.

Valid local `@` imports are expanded depth-first at their declaration position, using real paths for duplicate and cycle detection.

Machine-local guidance is included through the same import semantics rather than treated as a separately guessed path.

When `workingPath` is provided, the assembler identifies the applicable project chain using fixed candidate names and orders broader ancestor guidance before deeper project guidance so the most specific context is last.

Supported project candidates, in load order within one folder, are `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `GEMINI.md` (`PROJECT_FILES` in `scripts/rule-context.js`: the files Claude Code, Codex and Gemini CLI read); additions require evidence of a real client convention.

Missing optional project files are normal; missing required global core files produce degraded status.

Imports never execute commands, expand environment expressions, fetch URLs, or scan unrelated directories.

The `ref-ECC` corpus is excluded unless a future explicit API mode is separately designed and authorized.

## Startup and runtime flow

1. Server startup registers static initialize instructions, the dedicated tool, the optional resource, and existing tools on the shared MCP server.
2. Client initialization receives the compact handshake instruction when supported.
3. PM control sends the one-line compatibility trigger only while initialize-instruction delivery remains unproven or unavailable.
4. The model calls `aki__akidevrule_context` once with the known absolute working path or without it for global-only context.
5. The assembler resolves trusted global sources, imports, applicable project files, precedence, hashes, and warnings.
6. The tool returns assembled context and a receipt before substantive work continues.
7. Later calls reuse an in-memory cache only when the complete dependency fingerprint and working path still match.
8. Contextual rule routing continues from the loaded router; bootstrap does not individually invoke filesystem or shell tools.

## Cross-platform requirements

Use `os.homedir()`, `path.resolve()`, `path.normalize()`, `path.dirname()`, `path.parse()`, and realpath-based containment throughout.

Internally normalize `~`, `~/...`, `%USERPROFILE%`, and home-relative forms where accepted; never require the model or user to expand them.

Support POSIX roots, macOS volume paths, Windows drive roots, case-insensitive Windows comparisons, UNC paths, spaces, UTF-8 names, CRLF, LF, and UTF-8 BOM.

Treat an input file path as its containing directory before project-chain discovery.

Never depend on `grep`, `find`, `bash`, shell pipes, quoting rules, or platform-specific executable availability.

## Trust and security boundaries

Fixed global sources under derived user configuration directories are trusted read-only configuration zones and are not arbitrary tool inputs.

Project context is readable only through absolute real paths contained by configured MCP roots; symlink escapes fail closed.

Loaded Markdown is user-controlled instruction text subordinate to system and developer policy; provenance is returned so its origin remains visible.

The tool performs no writes, execution, command substitution, network access, secret interpolation, or broad home-directory scan.

Import recursion is bounded by realpath cycle detection, maximum depth 32, maximum file size 1 MiB, and maximum assembled size 4 MiB.

Logs contain receipt prefixes, source counts, cache status, elapsed time, and warnings, never full context or secrets.

## Caching and performance

The cold path reads only deterministic candidates and discovered imports; independent files may be read concurrently after ordering candidates are known.

The cache key includes normalized working path and dependency fingerprints based on real path, size, modification time, and content hash when needed.

Any dependency change invalidates the assembled result on the next call; no persisted cache is authoritative.

The target is one model-visible round trip instead of search plus multiple reads, with no duplicate full corpus in the compatibility prompt or initialize instructions.

Full effective context may remain token-heavy because parity requires load-bearing content; optimization removes orchestration overhead and duplication, not required rules.

## Failure and degraded modes

No `workingPath` returns global practical context with a warning that project context was not loaded; the server does not search the machine or request a folder picker.

An outside-root path or symlink escape returns an exact structured error and does not leak partial project content.

Missing optional local or project files do not fail the call.

Missing or corrupt global core files return `degraded`, include every available source, and state that parity was not achieved; any bundled emergency minimum is explicitly labeled and never authoritative.

Import cycles stop at the repeated real path, emit one warning, and continue independent sources.

Depth or size limits fail the offending import visibly; required core context is never silently truncated.

If initialize instructions are ignored, the compact PM-control trigger remains the compatibility path.

If the tool is not called, no component may claim effective context was loaded; the missing receipt is the diagnostic signal.

## Compatibility and migration

1. Extract a pure context-assembler module with no MCP or Postman dependency.
2. Register `aki__akidevrule_context` with the indexed contract above.
3. Add compact static initialize instructions naming the tool and prohibiting model-driven bootstrap reads.
4. Replace bundled and generated procedural bootstrap text with a one-line compatibility trigger while preserving existing user-edited prompt files.
5. Add the optional resource only after the tool contract is stable.
6. Probe Postman behavior for new chat, reconnect, server restart, context edits, and working-path presence across supported platforms.
7. When initialize instructions are proven reliable for supported Postman versions, make PM-control fallback injection default-off while retaining an explicit compatibility toggle.
8. Update dependent feature, setup, index, and release documentation only with implementation.

## Regression tests

### Assembler

Test recursive imports, declaration-position expansion, duplicate realpaths, cycles, precedence, missing optional and required files, BOM, CRLF, size limits, depth limits, hash stability, and cache invalidation.

### Cross-platform

Use table-driven fixtures for Linux home paths, macOS volumes, Windows drive and case variants, UNC paths, separators, spaces, Unicode, `%USERPROFILE%`, `~`, file inputs, and directory inputs.

### Security

Test outside-root inputs, symlink escapes, fixed global-zone access, hostile imports, URL imports, command-like text, oversized sources, and `ref-ECC` exclusion.

### MCP

Verify initialize responses contain the compact instruction, `tools/list` exposes the exact name/title/description/schema, tool calls return receipt and provenance, and optional resource reads delegate to the same assembler.

### Bridge

Verify repeated initialize calls preserve identical static instructions and one shared internal session, with no per-project context cached in initialize state.

### PM control

Verify a fresh install receives the compact trigger, existing user prompts are not overwritten, auto-injection fires once per genuinely new chat, and the expected receipt is visible.

### Integration

Run real Postman Agent Mode smoke tests on Windows, macOS, and Linux for new chat, reconnect, restart, changed rules, known project path, missing project path, degraded core, and initialize-instruction fallback.

## Observability

Record one structured event per context call with status, parity class, receipt prefix, source count, total bytes, cache hit or miss, elapsed time, normalized platform class, and warning codes.

Do not log source bodies, user content, secrets, or full absolute paths unless debug logging is explicitly enabled locally.

Track model-visible bootstrap calls; success is exactly one dedicated context call and zero filesystem, search, shell, or subagent calls for bootstrap.

## Rejected alternatives

**Prompt-only:** still delegates execution to the model, repeats procedural text, drifts, and multiplies round trips.

**Full corpus in initialize instructions:** static process-level state cannot safely represent live per-project context and may not be injected by every client.

**Tool without a trigger:** discoverability helps but does not reliably establish first-action timing.

**Resource-only:** resources are pull-based and automatic attachment is not guaranteed.

**MCP prompt:** adds a selectable surface without reducing startup steps in v1.

**Persisted compiled corpus:** creates a second source of truth and stale-context risk.

**Subagent loader:** workers may not inherit user MCP capabilities or workspace state and add orchestration cost.

**Shell loader:** quoting, tilde, utility availability, and platform differences make it structurally unsuitable.

**Full CDP injection:** duplicates large context, couples architecture to Postman DOM behavior, and bypasses the MCP ownership boundary.

## Reopen triggers

Revisit the architecture if Postman guarantees automatic pre-model injection of initialize instructions or resources with documented persistence and ordering semantics equivalent to Claude Code.

Revisit source ordering if Claude Code changes its documented project-context precedence or introduces another default candidate file.

Revisit the one-call contract only if measured context size exceeds client limits that cannot be solved by removing duplication while preserving required rules.

Revisit the optional resource or MCP prompt only when a supported client demonstrates a concrete workflow that reduces steps without weakening determinism.

## Related research

- `docs/research/instruction-prompt-first-principles.md` — prior prompt-first analysis; retained as historical reasoning, while this document is the canonical target architecture.
