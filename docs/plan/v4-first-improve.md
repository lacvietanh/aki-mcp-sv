# AkiMCP v4 first improve

Status: **approved by lead P3·W184, 2026-11-02** (owner: "Before you ask anything, settle it yourself … bạn là lead"); release, tag and publish stay the owner's. Base: 4.0.0 (2026-10-31). Session file: `~/.aki/mcpsv/ss/aki-mcp-sv/2026.11.02-2255-review-ssh-config-itb-v4.md` (parent `…/2026.11.01-1743-ssh-config-itb-v4-first.md`).

Conclusion: one release, target **4.1.0**, carrying N7 (done, `da9f736`) + B1 + B2 (+ I2 if its verification confirms the cause); it is a tool-definition release (D1); I1 is docs-only and can land in it; Q2 b/c move to AIObox; N1–N5 stay open with what closes each.

## Goal and requests

| REQ | Owner words (verbatim) | Answered by |
|---|---|---|
| REQ-1 | "phân tích sâu hơn vụ này đi, cụ thể hơn đi" (2026-11-01 14:45) | measurements in side folder `…/2026.11.01-1425-ssh-config-itb/jsonl-measure/result.md` (P8·W115), § Evidence |
| REQ-2 | "rule context là bắt buộc ... design lock ở đó ghi rõ mục tiêu" (15:00) | I1 |
| REQ-3 | via P51·W4: "tạo ngay file plan docs/plan/ cho \"v4 first improve\" … Plan chưa code tới khi owner duyệt" | this file |
| REQ-4 | via P51·W4: B1 bootstrap line in the `akidevrule_context` result; B2 `chrome_launch` refuses an AIObox clone while AIObox runs; "B1+B2 gói 1 bản phát hành" | B1, B2 |

## Evidence (result.md, P8·W115, 2026-11-01)

- AkiMCP = **0.9%** of all tool-result chars in Claude Code (1.60 M of 172 M; 711 transcripts, 15 sessions using AkiMCP, ~1 week); median 5.2% inside those sessions.
- Largest: `aiobox op=state` 528 k chars / 25 calls (median 18.8 k), `aiobox op=windows` 432 k / 22 (median 22.4 k); 9 of 25 `op=state` repeat a guide version the session already had.
- Call log 2026-10-04..11-01 (230 k lines): `RULE_RECEIPT_UNKNOWN` 121 refusals in 42 clusters; only 9 clusters sit near a restart signal (4 on a version change, 5 on a ≥10 min gap).
- Clients: Notion 121 k of 230 k calls; Postman 23.
- Not measured: result sizes for any web chat (the call log has no size field, N1).

## Decisions

- D1 · B1 and B2 ship in one release · because the owner said so (REQ-4). Neither changes a tool definition, but N7 (`da9f736`: the ss rule in `akidevrule_context`'s description links its doc by URL and names the successor exception) did, so 4.1.0 is a BR-6 release: every window asks "Always allow" again and clients reconnect; the CHANGELOG line says so.
- D2 · old Q2 b (guide once per chat) and c (smaller `op=windows`) are **moved to AIObox** · because CLAUDE.md § Stable core and S-1: the guide and `op` results are AIObox output (`desktop/panel/akimcp-ops.json`, `akipanel`); `knownVersion`/`op=guide` stays rejected (aiobox `docs/research/akimcp-aiobox-output-split.md` R5) · reopen if a seat breaks because of `op=state`.
- D3 · I2 is verified before any code · because the eviction cause is a hypothesis and the log carries no receipt to prove it directly.
- D4 · the "is AIObox served" check becomes one shared helper · because B1 would make it the third copy (`tools-server.js:14-17`, `chrome-mcp.js:27-31`); pattern.A2 extracts at the third.
- D5 (old Q1) · I1 records the rejection of a reduced-rules mode · because it was the agent's own earlier proposal and the owner said "rule context là bắt buộc" (REQ-2) · reopen if the owner asks for a lighter mode (a corpus cut in AkiDevRule).
- D6 (old Q2) · I2 V1 runs now, through worker P3·W186 · because it is read-only and reversible.
- D7 (old Q3) · B1 keeps `op=state first` and the handle cue, adds "act via aki__aiobox_write" and "never aki__chrome_launch an AIObox profile" · because `aki__aiobox`'s description says `op=state` first and `op=state` returns the guide whose Start here step 1 is `whoami` · rejected: `op=whoami` first (skips the guide, contradicts the tool description) · reopen if AIObox changes its tool description.
- D8 (old Q4) · B2 has no force · because the owner wrote "không có force"; CDP work on an AIObox window keeps `devtools_*` with the port from `op=windows` · reopen if the owner names a blocked workflow.
- D9 · B2 supersedes LEAD P27·W67's 2026-10-12 drop of O2 · because refusal was the owner's call (`ai-control-audit.md:41`) and the owner made it via P51·W4 on 2026-11-02 (W115 archive `~/.aki/aiobox/archive/40b7853135d78075a1f700a99aef416a.json`).
- D10 · B2's refusal has one `next`: `aki__aiobox_write op=open_url profileId=<id>` · because `open_url` with a profile adopts or launches a stopped one (aiobox `request.rs:1630-1649` → `cdp/engine.rs:235-238`), while `new_window` needs a `provider` and opens a chat page (`request.rs:457`); `from` only when the profile is the caller's own (P3·W186 `b2-facts.md` § 3) · rejected: the old split "new_window when stopped / open_url when it has a window".
- D11 · "AIObox runs" = `windows.json` `appPid` passes `process.kill(pid, 0)` · because the file is deleted on quit (aiobox `lib.rs:282`) but stays after a crash until the next start (`lib.rs:97`), and today AkiMCP checks only that it exists (`chrome-mcp.js:22`, `aiobox-mcp.js:142`) · accepted residual risk: a reused pid reads as running · reopen if a false refusal is reported.
- D12 · B2's platform gate is met without a per-platform row · because macOS has 110 real `new_window` runs on stopped profiles (101 ok, last run 43354, 2026-11-02T08:41:59Z) through the same launch path `open_url` takes (`engine.rs:235-238`), which counts as rung 5; Windows runs the same functions (matrix "Open profile + CDP attach": W-arm64 `V`, W-x64 `I`, aiobox `platform-unify.md:44`); Linux is not built (`:34`), so it has no `windows.json` and never refuses · reopen if AIObox ships Linux or a Windows run fails.

## Items

Each item names its S-1 gain (aiobox `docs/arch/akimcp-boundary.md` § 0a: AkiMCP is edited only for a core need, security, or a clear gain the AIObox side cannot give at comparable cost).

### I1 · `docs/arch/rule-context-delivery.md`: the goal names every web chat, not Postman (old Q1)

- **Change:** Decision, Non-negotiable invariant and Goal say "every web chat (a client with no harness hook: Notion, ChatGPT, Claude.ai, Postman, …)" instead of "Postman"; the Postman-only step 3 (fallback, replaced) stays as history in one line. Add one sentence under Caching and performance stating why a reduced-rules mode is rejected: the corpus is load-bearing, only duplication and orchestration may be cut (already the rule there: "optimization removes orchestration overhead and duplication, not required rules"). Stamp rewritten (docs.A4).
- **S-1:** not an AIObox item; core doc. Gain: the design lock matches the clients that actually use it (Notion 121 k calls vs Postman 23), so no later plan optimizes for the wrong client.
- **Check:** `grep -n "Postman" docs/arch/rule-context-delivery.md` shows Postman only in the client list, the replaced layer 3 and text about Postman's own mechanism (PM control, its smoke tests, rejected CDP injection, its reopen trigger); stamp rewritten.
- **Done:** 2026-11-03 (Decision, invariant, goal, finding 2, Caching sentence).
- **Decided:** D5.

### I2 · Receipts lost without a restart: verify, then fix `scripts/rule-gate.js` (old Q2 a)

- **Hypothesis:** `issued` keeps 200 receipts (`rule-gate.js:16`) and drops the oldest **issued**, not the oldest **used** (`recordIssued` `:39-45`); a passing `verify` (`:53`) never moves an entry. Each `akidevrule_context` call and each RULE_PUSH (`uncovered` `:89`) issues one. At ~300 RULE_PUSH lines a day a long chat's receipt can drop out within hours and come back as `RULE_RECEIPT_UNKNOWN` ("never issued that receipt, or restarted since", `:54`).
- **V1 (read-only falsifier, no code):** for each of the 42 UNKNOWN clusters, count issuing events in `tool-calls*.jsonl` since the last restart signal (ok `akidevrule_context` lines + `rule: RULE_PUSH` lines). It is an upper bound (a repeated receipt moves its entry instead of adding one), so a cluster with < 200 **cannot** be an eviction and disproves the hypothesis for that cluster. Output: count per cluster, appended to result.md; script in the side folder, run by `aki__task_start`.
- **V2 (only if V1 leaves clusters ≥ 200 unexplained):** a bounded in-memory set of evicted receipts, refused with a new code `RULE_RECEIPT_EVICTED`. The log's `rule` field already captures the code (`tool-call-log.js:98`), so no log format change (owner 2026-10-10 "no log change for AIObox measuring" untouched); it is also a permanent diagnostic.
- **Fix (after V1/V2 confirm):** least-recently-used: on a passing `verify`, `issued.delete(receipt); issued.set(receipt, entry)`. Raise `MAX_ISSUED` only if V1 shows > 200 live chats (an entry is a few hundred bytes). Refusal text at `:54` names eviction once it can happen. Tests: `test/rule-gate*.test.js` — 201 issues with the first used in between still passes; an unused one is refused with the eviction code.
- **S-1:** core (the receipt gate serves every client). Gain: fewer mid-task refusals, each costing one `akidevrule_context` round trip plus a retry.
- **Rejected:** persisting `issued` to disk (`docs/plan/done/rule-receipt-gate.md` D4) · reopen if the owner changes D4.

### B1 · AIObox bootstrap line in the `akidevrule_context` result

- **Problem (P51·W4 analysis, as reported, not re-measured here):** a Notion Auto/GPT agent spent 44 tool calls to join two Notion spaces, ~25 caused by design, and opened `chrome_launch` on `chrome-profile-14` (support@akitao.com) instead of its own p51 window. `AIOBOX_STEP` (`scripts/rule-context-mcp.js:33`) reaches a client only through server instructions (`:39`, `tools-server.js:14-17`), which Notion's agent does not receive. The `akidevrule_context` result is the one channel every web chat reads, because every acting tool refuses without its receipt.
- **Change:** one line in the result header (`rule-context-mcp.js:67`), only while provider `aiobox` is served (available and enabled): `A page title starting with a handle like P2·W1 · means you are inside an AIObox window: call aki__aiobox op=state first, act via aki__aiobox_write, never aki__chrome_launch an AIObox profile.` (D7) (tool names through `served()`, so a custom prefix follows, 4.0.0). `AIOBOX_STEP` becomes this one constant used by both the instructions and the result, so the two cannot disagree (pattern.A1). Outside the receipt hash: receipts do not change. The served check moves into one helper (D4) read by `tools-server.js`, `chrome-mcp.js` and `rule-context-mcp.js`; it imports `provider-registry.js` at call time as `chrome-mcp.js:26` does, to avoid the import cycle.
- **S-1:** gain the AIObox side cannot give — AIObox's guide is reached only through `op=state`, which this agent never called, so no AIObox-side line reaches it. Cost: one line (~150 chars) per context call, only on machines serving `aiobox`. B1 changes no tool definition (D1); BR-3 (machine-dependent text goes in the result) satisfied; BR-1 file set unchanged (`rule-context-mcp.js`, `tools-server.js`, `chrome-mcp.js` already listed).
- **Check:** `test/rule-context.test.js`: `aioboxServed: true` → exactly one line in the header, false → none; `test/surface-no-aiobox.test.js` (F7, HF-4): no `~/.aki/aiobox` → the result does not name `aki__aiobox`; custom Tool prefix → the line uses it. Live: one fresh Notion chat in an AIObox window calls `aki__aiobox op=state` before any `chrome_launch` (owner-run, spends quota).

### B2 · `chrome_launch` refuses an AIObox clone while AIObox runs

- **Problem:** `aioboxWarning` (`scripts/chrome-mcp.js:21-24`) only warns, and **after** `launchChrome` (`:80-86`) has already opened or attached — the agent is already acting from the wrong account. "AIObox runs" is guessed from `windows.json` existing, which outlives the app. Recorded debt in BR-1 (aiobox `docs/arch/akimcp-boundary.md:57`, "until AIObox opening a stopped profile is live everywhere").
- **Change:** before launching, refuse when AIObox runs (D11) and the provider is served. Every profile `chrome_launch` takes resolves to a shared clone under `profilesRoot()` (`chrome-profile.js:141-142`; AIObox provisions them), so no per-profile test is needed. No force flag (D8). Refusal `next`: `aki__aiobox_write op=open_url profileId=<id>` (D10), names through `served()`. AIObox not running or not served → unchanged, nothing points at AIObox (F7). The `chrome_launch` description names no AIObox (since `f97c11a`) and stays as is, so B2 changes no definition. The BR-1 debt line is rewritten in aiobox to name the refusal.
- **Platform gate:** a refusal is right only where its `next` works: met on every built OS (D12).
- **S-1:** security / core: acting from another person's account (support@akitao.com) is an identity error with outside effects; only AkiMCP can stop it, because the agent called an AkiMCP tool — the AIObox side cannot intercept `chrome_launch`.
- **Check:** unit: clone + live `appPid` → refused with `next`, nothing launched; dead `appPid` → launches as today. `surface-no-aiobox.test.js`: no AIObox → `chrome_launch` neither refuses for this reason nor names `aki__aiobox` (F7, HF-4). `test/tool-surface.test.js`: B2 leaves the definitions hash unchanged.
- **Cross-repo (same session as the code, BR-7):** aiobox `docs/arch/akimcp-boundary.md` BR-1 debt line names the refusal (BR-3 `AIOBOX_STEP` cites done in aiobox `2831e31f`); IMPORTANT twins' row "aiobox mở profile đang do akimcp giữ" says the case shrinks to AkiMCP launching before AIObox starts. A `platform-unify.md` row is AIObox's call (D12 needs none).

## Open

- N1 · `tool-calls.jsonl` has no result size → web-chat cost unmeasured; owner rejected a log change for AIObox measuring (2026-10-10) · closes only if the owner asks for it as a core need; else stays unmeasured.
- N2 · UNKNOWN cause unknown · closes with I2 V1/V2.
- N3 · rule-presence-check Stage B: rerun research R9 on or after 2026-11-22 (`docs/research/rule-presence-check-review.md`).
- N4 · `akidevrule_context` results in Claude Code transcripts are always ≤ 1.3 k chars though the tool has no short branch → Claude Code sizes may read low · closes by finding where the body goes (hook, attachment, or `structuredContent`-only per the per-client-tool-surface V6 comment in `rule-context-mcp.js`); not blocking.
- N5 · 4.1.0 already re-asks "Always allow" (D1), so the other definition changes waiting for a release can ride in it: the `chrome_launch` `profile` example "Profile 14 or shared id chrome-profile-14" (F-L1-1), discovery keywords in the `aki__aiobox` description (F-L1-2), `chrome_launch` description accuracy after B2 · closes by a lead decision after B2 lands; a change not taken waits for the next definition release.

## Order after approval

0. N7 — done, `da9f736`.
1. I2 V1 (read-only) → decide V2 / fix.
2. D4 helper (`0a79f0d`) → B1 (`7057600`) → B2 (`c32522a`, platform gate D12) → aiobox cross-repo lines (aiobox `2831e31f` for B1, `ae52b002` for B2).
3. I1 (done 2026-11-03).
4. `npm test` once, CHANGELOG `[Unreleased]`, then stop: the owner releases (`RULE-release.md`); release note: reconnect and "Always allow" again (D1).

## DEFERRED (AIObox repo)

- Guide once per chat (`op=state` repeats, 9 of 25) and smaller `op=windows` (median 22 k) — owner: AIObox (D2).
