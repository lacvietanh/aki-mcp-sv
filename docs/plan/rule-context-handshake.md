# Plan — rule context handshake

Status: active; Gate 0 (assembler + `aki__akidevrule_context` tool) implemented and tested; Gate 1 (Agent Mode runtime canary) not run — moves to `done/` only once Gate 1 evidence exists, per this doc's own completion criteria

## Outcome and boundary

Implement the architecture in `docs/arch/rule-context-delivery.md` as two separately proven gates, never one inferred success:

- **Gate 0 — protocol delivery:** the local MCP server emits compact `initialize.instructions`, and the streamable bridge returns that field unchanged on every external `initialize` while retaining one shared internal session.
- **Gate 1 — Agent Mode consumption:** a fresh Postman Agent Mode chat demonstrably places those instructions in model-visible context early enough to cause one `local__akidevrule_context` call before substantive work. A valid Gate 0 wire result does **not** prove Gate 1; only the bounded canary below may do so.

The shipped outcome is practical effective context parity: one read-only indexed call returns deterministic global + applicable project guidance with provenance and a receipt. Exact Claude Code pre-model injection parity remains outside an MCP server's control and must not be claimed.

This document is the only Track B write in the planning pass. Code/runtime inspection remains read-only; no service lifecycle, Postman/CDP interaction, prompt injection, implementation, release/index edit, or must-preserve-file edit belongs to this pass.

## Current finding — verified from source

| Layer | Current fact | Consequence |
|---|---|---|
| `scripts/tools-server.js` | `createToolsServer()` constructs `new McpServer({ name, version, title })`; it sets no `instructions`. The installed SDK supports `instructions` in server options and copies it into the initialize result. | Gate 0 currently has no handshake payload to deliver. SDK capability is present; server configuration is missing. |
| `scripts/streamable-bridge.js` | First initialize stores `response.result` as `shared.initResult`; every external initialize returns `{ result: s.initResult }` without field projection or reconstruction. | The bridge already preserves the complete initialize result, including future `instructions`; this must be locked by regression test rather than rewritten. |
| `test/streamable-bridge.test.js` | Proves repeated initialize uses one internal session and that `tools/list` works; it does not assert initialize instructions or exact tool metadata. | Extend this test for Gate 0 without weakening the shared-session invariant. |
| Tool registry | Domain modules register through the `local__` prefix proxy; no `local__akidevrule_context` implementation exists. | Add one unprefixed `akidevrule_context` registration module so the existing proxy produces the public name exactly once. |
| PM fallback | The bundled `scripts/aki-pmcontrol/assets/prompts/postman.md` delegates multi-step bootstrap reads to the model; existing user prompt files are copied only when missing and must survive upgrades. | Replace only the bundled default during implementation; never overwrite user-edited prompt files. Keep a compact compatibility trigger until Gate 1 is proven for supported Postman versions. |

## Delivery sequence

### 0. Freeze claims and fixtures

- Preserve the single shared in-process MCP session, external ID remapping, protocol negotiation, tool prefixing, dynamic root reads, and user prompt preservation.
- Build tests from temporary directories and injected home/root inputs; tests must not read or mutate the operator's real rule corpus.
- Use Node filesystem/path APIs only. No shell discovery, network, command execution, folder picker, persisted assembled corpus, or scan of `ref-ECC`.

### 1. Gate 0 — protocol handshake

Add one exported compact constant and pass it as the `McpServer` constructor's `instructions` option. Required semantics: call `local__akidevrule_context` once before the first substantive action; pass an absolute `workingPath` when known; do not discover/read bootstrap files individually; a returned receipt is the only success signal.

Protocol tests must prove:

1. first initialize result contains the exact non-empty instruction;
2. repeated initializes with distinct JSON-RPC IDs return byte-identical `result.instructions` and distinct external session IDs;
3. only one internal session opens;
4. other initialize fields remain present, so no bridge field whitelist is introduced;
5. `tools/list` exposes the exact public context-tool name, title, description, and input schema.

Gate 0 completion means wire preservation only. Documentation, logs, or a tool call caused by the compatibility prompt cannot be cited as proof that Agent Mode injected initialize instructions into model context.

### 2. Pure assembler

Create a dependency-injected module with no MCP, Postman, CDP, shell, or network dependency:

```text
assembleRuleContext({ workingPath, mode, knownReceipt }, deps)
  -> { status, parity, receipt, rulesVersion, workingRoot, sources, warnings, context }
```

`deps` supplies home directory, configured roots, filesystem operations, platform/path behavior, limits, clock/logger hooks, and an in-memory cache. Production defaults use `os.homedir()`, `fs/promises`, `path`, and `getRoots()`; tests supply isolated fixtures.

Pipeline, in fixed order:

1. normalize the optional absolute file/directory input; reject relative paths;
2. realpath and authorize project access against configured roots, failing closed on outside-root or symlink escape;
3. derive fixed global sources from the current home configuration zone;
4. parse Markdown `@` imports outside fenced and inline code; resolve home/absolute/declaring-file-relative forms; reject URLs, environment/command expansion, and disallowed targets;
5. expand imports depth-first at declaration position with realpath dedupe, cycle warning, max depth 32, per-file 1 MiB, assembled 4 MiB;
6. discover only the applicable ancestor chain for `CLAUDE.md`, `CLAUDE.local.md`, and `AGENTS.md`, broadest first and most specific last; treat a file input as its containing directory;
7. normalize BOM/newlines for assembly, retain source byte counts and content hashes, and compute a SHA-256 receipt over canonical ordered content + provenance + effective options;
8. cache in memory by normalized working path and complete dependency fingerprints; invalidate on any dependency change.

Global configuration zones and configured project roots are separate trust classes. No arbitrary source list is accepted. Missing optional project/local files are normal; missing required global core is `degraded` with available context and explicit warnings, never silent fallback or false parity. `exact-audit` adds candidates, precedence trace, import graph, byte counts, and warnings but still reports `exact-audit-not-guaranteed`.

### 3. `local__akidevrule_context` contract

Register internal name `akidevrule_context` through the existing prefix proxy.

- **Title:** `Load Effective Aki/Claude Context`
- **Description:** `Call once before the first substantive action in every chat to load the effective default guidance. The server resolves global imports and applicable project CLAUDE.local/AGENTS context itself; do not search for or individually read bootstrap files. Pass an absolute workingPath when known. Read-only.`
- **Input:** `{ workingPath?: string, mode?: "effective" | "exact-audit", knownReceipt?: string }`; default mode `effective`; reject unknown keys, relative paths, URLs, globs, commands, expressions, and arbitrary file lists.
- **Structured output:** `status: ok|unchanged|degraded|error`, `parity`, `receipt`, `rulesVersion`, `workingRoot`, ordered `sources[{path,kind,sha256,bytes}]`, `warnings[]`, and `context`.
- **Text fallback:** begins `[RULES] practical-effective · <receipt> · <n> sources` and includes assembled context when applicable.
- `knownReceipt` may return `unchanged` without context only where the caller explicitly demonstrates retained prior context; default/fresh-chat behavior returns the full body.
- Errors are typed and non-leaking. Logs include status, parity, receipt prefix, count, bytes, cache state, elapsed time, platform class, and warning codes; never source bodies, secrets, or full paths by default.

The first version ships the tool, not an MCP prompt. An optional `akidevrule://effective-context` inspection resource is a later additive step after contract stability and must delegate to the same assembler; it is never a bootstrap dependency.

### 4. Gate 1 — safe future Agent Mode canary

Run only after code review, unit/integration green, explicit owner approval, and a separately scheduled runtime session. It is forbidden in this planning pass.

Canary design:

1. use a dedicated disposable Postman Agent Mode chat and a canary build/config, never an existing work chat;
2. set initialize instructions to a nonce-bearing, harmless directive that names `local__akidevrule_context` and asks it to pass a fixed benign canary value supported only by test instrumentation; do not include rule content, secrets, filesystem paths, or instructions to write/execute;
3. disable PM-control auto-injection and manual prompt delivery for that chat, and verify no user/developer message contains the canary nonce;
4. capture Gate 0 separately at the MCP boundary: initialize response includes the nonce and complete result;
5. begin a fresh chat with a neutral request that does not name the tool or nonce;
6. pass only if the first substantive model action is the context tool with the nonce and the receipt appears before any bootstrap filesystem/search/shell/subagent action;
7. repeat across fresh chat, reconnect, and app restart; record Postman version/platform and distinguish each result as Gate 0 pass/fail and Gate 1 pass/fail;
8. remove canary instructions/test instrumentation immediately after measurement.

A model echo, UI text, server log showing initialize, compatibility-prompt-triggered call, manual tool call, or call after substantive work is not Gate 1 proof. Ambiguous/negative results retain fallback; they do not justify stronger injection claims.

### 5. Fallback, rollout, rollback

- Ship with the compact PM-control trigger enabled by default until Gate 1 passes the supported-version/platform matrix. The trigger names one tool only; it contains no procedural discovery/import/skill workflow and no duplicated corpus.
- Preserve existing user-edited `$AKI_DATA_DIR/prompts/postman.md` and legacy prompt files. Upgrade changes only the bundled default and fresh-install copy behavior.
- Add an explicit compatibility toggle before making fallback default-off. Default-off is allowed only after recorded Gate 1 evidence; unsupported/unknown versions remain fallback-on.
- If assembler/tool rollout fails, remove its registration and constructor instruction, restore the prior bundled default, and leave the bridge untouched. No data migration or persisted cache exists.
- If Gate 0 passes but Gate 1 fails, keep server instructions as harmless discoverability metadata and retain the compact fallback.
- If context is degraded, return available content + warnings and do not claim parity. If the tool is not called or no receipt is visible, context is not loaded.

## Verification matrix

| Layer | Required tests |
|---|---|
| Assembler | import position/order, nested imports, realpath dedupe, cycles, missing optional/required files, project ancestor precedence, file-vs-directory input, BOM/CRLF/LF, stable receipt, changed-dependency invalidation, cold/cache results, limits, exact-audit trace |
| Cross-platform | table fixtures for POSIX/macOS volumes, Windows drive/case/separators, UNC, spaces, Unicode, `~` and `%USERPROFILE%` normalization where accepted |
| Security | relative/outside-root inputs, symlink escape, hostile/URL/command-like imports, oversized/deep imports, fixed global-zone boundary, no writes/network/exec, explicit `ref-ECC` exclusion |
| MCP tool | exact metadata/schema, effective and exact-audit output, text fallback, typed errors, no double `local__` prefix, receipt/provenance, fresh-chat full-context behavior |
| Initialize/bridge | exact instruction present and stable across repeated initialize, full result preserved, one shared session, distinct external sessions, existing ID remap and tools/list behavior retained |
| PM fallback | fresh install gets compact trigger; existing non-empty user and legacy prompts survive; compatibility toggle behavior; trigger at most once per genuine new chat; receipt visible |
| Future runtime | Gate 0 capture and Gate 1 canary recorded independently for fresh chat/reconnect/restart and supported OS/Postman versions; changed rules and missing working path included after baseline |

Unit/integration tests may create temporary files and loopback test servers already used by the test harness; they must not start the product service or interact with Postman/CDP. Runtime canary evidence is owner-approved follow-up work, not a CI substitute.

## Exact expected implementation change set

No file below changes in this planning pass. Expected later implementation files are closed as follows; any expansion requires plan amendment before code:

| File | Later change |
|---|---|
| `scripts/rule-context.js` | New pure assembler, parser, provenance/receipt, limits, and in-memory cache. |
| `scripts/rule-context-mcp.js` | New tool schema, registration, output mapping, and safe observability. |
| `scripts/tools-server.js` | Add compact constructor `instructions`; register the new module through the existing prefix proxy. |
| `test/rule-context.test.js` | New assembler, cross-platform, cache, failure, and security fixture tests. |
| `test/rule-context-mcp.test.js` | New exact tool contract and output/error tests. |
| `test/streamable-bridge.test.js` | Extend initialize preservation/identity and exact `tools/list` assertions while retaining shared-session checks. |
| `scripts/aki-pmcontrol/assets/prompts/postman.md` | Replace bundled procedural bootstrap with compact compatibility trigger. |
| `scripts/aki-pmcontrol/scripts/cdp-autoclicker.js` | Add/use explicit compatibility-toggle behavior and once-per-new-chat fallback semantics without canary code in production. |
| `scripts/aki-pmcontrol/index.js` | Carry the fallback setting/instruction state only if required by the existing config injection path; preserve user prompt files. |
| `test/aki-pmcontrol-copy.test.js` | Prove compact bundled default, user-file preservation, toggle, and trigger invariants. |
| `docs/arch/rule-context-delivery.md` | Sync only facts that differ after implementation/runtime evidence; preserve Gate 0 vs Gate 1 wording. |
| `docs/feat/tools.md` | Document the shipped indexed tool and read-only boundary. |
| `README.md` | Update user-facing bootstrap/fallback behavior after shipment. |
| `CHANGELOG.md` | Record shipped behavior under `[Unreleased]`. |
| `docs/index.md` | Add discoverability only in the later implementation/docs sync, never in this Track B planning pass. |
| `docs/plan/rule-context-handshake.md` → `docs/plan/done/rule-context-handshake.md` | Mark checklist/evidence complete and move only when all completion criteria pass. |

No change is expected in `scripts/streamable-bridge.js`: current full-result caching/return is the desired path. Touch it only if a failing preservation test proves otherwise, then amend this plan first.

## Completion criteria

- [x] Gate 0 exact-wire tests pass and preserve the one-shared-session architecture.
- [x] Pure assembler passes deterministic, cross-platform, cache, degradation, and security matrices without operator-corpus dependency.
- [x] `tools/list` and tool calls match the exact public contract; one call returns ordered context, provenance, receipt, and honest parity state.
- [x] No bootstrap path needs model-orchestrated filesystem/search/shell/subagent reads.
- [x] Compact fallback ships without overwriting user-edited prompts and remains enabled until Gate 1 evidence permits otherwise.
- [ ] Gate 1 canary is run only in the approved disposable setup; results are recorded separately from Gate 0. If not proven, fallback remains on and docs say unproven.
- [ ] Rollback removes the feature without bridge/session changes or data migration.
- [x] Full tests and `git diff --check` pass; implementation docs, README, CHANGELOG, and index are synchronized in the implementation change, not before it.
- [ ] Plan moves to `docs/plan/done/` only after code, tests, documentation, and required runtime evidence are complete; otherwise it stays active with unchecked items.
