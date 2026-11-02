# AkiMCP v4 first improve

Tool names use the default prefix `aki__`; a custom prefix may differ.

Status: **done 2026-11-03, shipped in 4.1.0** (approved by lead P3·W184 2026-11-02, owner: "Before you ask anything, settle it yourself … bạn là lead"; released on the owner's /akiship order 2026-11-03). Base: 4.0.0 (2026-10-31). Session file: `~/.aki/mcpsv/ss/aki-mcp-sv/2026.11.02-2255-review-ssh-config-itb-v4.md` (parent `…/2026.11.01-1743-ssh-config-itb-v4-first.md`).

Conclusion: one release, **4.1.0**, carrying N7 + B1 + B2 + I2 + I1; N5's AkiMCP part shipped (p2), its AIObox part moved to AIObox. BR-6: all definition changes ship bundled in 4.1.0 (D1).

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

- D1 · B1 and B2 ship together (REQ-4). N7 (`da9f736`) changes the tool definition and triggers BR-6, so 4.1.0 needs one reconnect anyway; the audit's description cuts (p2, p10) ship in the same release, one re-ask instead of two (lead 2026-11-03, S6 #2; rejected: split them to a later release, which moves the same re-ask there and needs unpicking committed code).
- D2 · old Q2 b (guide once per chat) and c (smaller `op=windows`) are **moved to AIObox** · because CLAUDE.md § Stable core and S-1: the guide and `op` results are AIObox output (`desktop/panel/akimcp-ops.json`, now `desktop/commands.json` since aiobox 2a0524b1, `akipanel`); `knownVersion`/`op=guide` stays rejected (aiobox `docs/research/akimcp-aiobox-output-split.md` R5) · reopen if a seat breaks because of `op=state`.
- D3 · The historical eviction cause is a hypothesis; p3 adds a diagnostic and p4 LRU without asserting past causes (N2).
- D4 · One `providerServed` helper answers whether AIObox is served; `aiobox-guide.js` imports the registry at call time to avoid the cycle.
- D5 (old Q1) · I1 records the rejection of a reduced-rules mode · because it was the agent's own earlier proposal and the owner said "rule context là bắt buộc" (REQ-2) · reopen if the owner asks for a lighter mode (a corpus cut in AkiDevRule).
- D6 (old Q2) · I2: p3 adds eviction diagnosis; p4 makes successful receipt use refresh LRU order.
- D7 (old Q3) · B1 uses the owner’s `op=whoami first` wording in the result header only; server instructions omit the line (S6 #1/#7). AIObox tool descriptions retain `op=state first` (see closed-without-change below).
- D8 (old Q4) · B2 has no force · because the owner wrote "không có force"; CDP work on an AIObox window keeps `devtools_*` with the port from `op=windows` · reopen if the owner names a blocked workflow.
- D9 · B2 supersedes LEAD P27·W67's 2026-10-12 drop of O2 · because refusal was the owner's call (`ai-control-audit.md:41`) and the owner made it via P51·W4 on 2026-11-02 (W115 archive `~/.aki/aiobox/archive/40b7853135d78075a1f700a99aef416a.json`).
- D10 · B2 refusal has one `next`: `aki__aiobox_write op=open_url url=<link> profileId=<id>`; `open_url` can adopt or launch a stopped profile. Other paths stay in the AIObox guide.
- D11 · “AIObox runs” has one definition, `aioboxRunning`: `windows.json` `appPid` passes `process.kill(pid, 0)` (EPERM counts as alive); `aiobox-mcp.js` uses the same helper (p5). A reused PID can read as running; reopen on a false refusal.
- D12 · Platform: "Open profile + CDP attach" is `V` on macOS and on W-arm64 (Parallels VM, 2026-10-04) and `I` (code present, not run) on the W-x64 real machine (aiobox `docs/arch/platform-unify.md:44`); Linux is not built. That cell is AIObox's matrix and reaches `V` only with a real run (its U11), so the W-x64 run moved to the AIObox lead (2026-11-03, S6 #5) · reopen B2 with a Windows exception if that run shows `open_url` cannot open a stopped profile.

## Items

Each item names its S-1 gain (aiobox `docs/arch/akimcp-boundary.md` § 0a: AkiMCP is edited only for a core need, security, or a clear gain the AIObox side cannot give at comparable cost).

### I1 · `docs/arch/rule-context-delivery.md`: the goal names every web chat, not Postman (old Q1)

- **Change:** Decision, Non-negotiable invariant and Goal say "every web chat (a client with no harness hook: Notion, ChatGPT, Claude.ai, Postman, …)" instead of "Postman"; the Postman-only step 3 (fallback, replaced) stays as history in one line. Add one sentence under Caching and performance stating why a reduced-rules mode is rejected: the corpus is load-bearing, only duplication and orchestration may be cut (already the rule there: "optimization removes orchestration overhead and duplication, not required rules"). Stamp rewritten (docs.A4).
- **S-1:** not an AIObox item; core doc. Gain: the design lock matches the clients that actually use it (Notion 121 k calls vs Postman 23), so no later plan optimizes for the wrong client.
- **Check:** `grep -n "Postman" docs/arch/rule-context-delivery.md` shows Postman only in the client list, the replaced layer 3 and text about Postman's own mechanism (PM control, its smoke tests, rejected CDP injection, its reopen trigger); stamp rewritten.
- **Done:** 2026-11-03 (Decision, invariant, goal, finding 2, Caching sentence).
- **Decided:** D5.

### I2 · Receipts lost without a restart: fix `scripts/rule-gate.js` (old Q2 a)

- [x] p3 adds bounded eviction tracking and `RULE_RECEIPT_EVICTED`; p4 makes verified receipts least-recently-used. These changes do not establish the cause of historical UNKNOWNs (N2).

- **Original hypothesis (before p3/p4):** `issued` keeps 200 receipts (`rule-gate.js:16`) and drops the oldest **issued**, not the oldest **used** (`recordIssued` `:39-45`); a passing `verify` (`:53`) never moves an entry. Each `akidevrule_context` call and each RULE_PUSH (`uncovered` `:89`) issues one. At ~300 RULE_PUSH lines a day a long chat's receipt can drop out within hours and come back as `RULE_RECEIPT_UNKNOWN` ("never issued that receipt, or restarted since", `:54`).
- **V1 (read-only falsifier, no code):** for each of the 42 UNKNOWN clusters, count issuing events in `tool-calls*.jsonl` since the last restart signal (ok `akidevrule_context` lines + `rule: RULE_PUSH` lines). It is an upper bound (a repeated receipt moves its entry instead of adding one), so a cluster with < 200 **cannot** be an eviction and disproves the hypothesis for that cluster. Output: count per cluster, appended to result.md; script in the side folder, run by `aki__task_start`. **Run 2026-11-03** (`v1-falsifier.py` in this plan's ss side folder; call log 2026-10-04..11-02, 254 k lines; anchor = the last version change): 24 of 42 clusters had 0–159 issuing lines, so they were not evictions; 18 had 309–1252, so eviction stays possible for them and the old log cannot say more (N2).
- **V2:** p3 records a bounded set of evicted receipts and returns `RULE_RECEIPT_EVICTED`; the log already records the code.
- **Fix:** p4 moves a receipt to the most-recently-used position on a passing verify. `test/rule-gate.test.js` covers eviction and reuse; the cap remains 200.
- **S-1:** core (the receipt gate serves every client). Gain: fewer mid-task refusals, each costing one `akidevrule_context` round trip plus a retry.
- **Rejected:** persisting `issued` to disk (`docs/plan/done/rule-receipt-gate.md` D4) · reopen if the owner changes D4.

### B1 · AIObox bootstrap line in the `akidevrule_context` result

- **Problem (P51·W4 analysis, as reported, not re-measured here):** a Notion Auto/GPT agent spent 44 tool calls to join two Notion spaces, ~25 caused by design, and opened `chrome_launch` on `chrome-profile-14` (support@akitao.com) instead of its own p51 window. Before B1, `AIOBOX_STEP` reached a client only through server instructions (`:39`, `tools-server.js:14-17`), which Notion's agent does not receive. The `akidevrule_context` result is the one channel every web chat reads, because every acting tool refuses without its receipt.
- **Change:** while provider `aiobox` is served (available and enabled), the result header says `Inside an AIObox window: aki__aiobox op=whoami first; act via aki__aiobox_write; never aki__chrome_launch an AIObox profile.` Names use `served()` for custom prefixes. Server instructions do not carry this line; receipts are unchanged. `aiobox-guide.js` imports `provider-registry.js` at call time to avoid an import cycle (D4).
- **S-1:** the result reaches web chats that do not receive server instructions; the step is conditional on the provider being served. B1 itself changes no tool definition (D1).
- **Check:** `test/rule-context.test.js` checks the header, served condition and custom prefix; `test/surface-no-aiobox.test.js` checks instructions never contain the step. Live: a stdio run of the packed 4.1.0 on 2026-11-03 with AIObox running shows the line in the header (release gate S7). Whether a chat then calls `op=whoami` first is model behavior, not a check of this code · reopen if the call log shows window chats calling `chrome_launch` before `whoami`.

### B2 · `chrome_launch` refuses an AIObox clone while AIObox runs

- **Problem:** `aioboxWarning` (`scripts/chrome-mcp.js:21-24`) only warns, and **after** `launchChrome` (`:80-86`) has already opened or attached — the agent is already acting from the wrong account. "AIObox runs" is guessed from `windows.json` existing, which outlives the app. Recorded debt in BR-1 (aiobox `docs/arch/akimcp-boundary.md:57`, "until AIObox opening a stopped profile is live everywhere").
- **Change:** before launching, refuse when AIObox runs (D11) and the provider is served. All profiles resolve to shared clones under `profilesRoot()`; no per-profile test or force flag. Refusal `next`: `aki__aiobox_write op=open_url url=<link> profileId=<id>` (D10), names through `served()`. AIObox not running or not served → unchanged. The separate p2 profile description changes the tool definition (N5).
- **Platform gate:** the W-x64 real-machine run of `open_url` on a stopped profile moved to AIObox (D12).
- **S-1:** security / core: acting from another person's account (support@akitao.com) is an identity error with outside effects; only AkiMCP can stop it, because the agent called an AkiMCP tool — the AIObox side cannot intercept `chrome_launch`.
- **Check:** unit: clone + live `appPid` → refused with `next`, nothing launched; dead `appPid` → launches as today. `surface-no-aiobox.test.js`: no AIObox → `chrome_launch` neither refuses for this reason nor names `aki__aiobox` (F7, HF-4). `test/tool-surface.test.js`: B2 leaves the definitions hash unchanged.
- **Cross-repo (same session as the code, BR-7):** aiobox `docs/arch/akimcp-boundary.md` BR-1 debt line names the refusal (BR-3 `AIOBOX_STEP` cites done in aiobox `2831e31f`); IMPORTANT twins' row "aiobox mở profile đang do akimcp giữ" says the case shrinks to AkiMCP launching before AIObox starts. The W-x64 run moved to AIObox (D12).

## Open

All closed 2026-11-03 at the 4.1.0 release.

- [-] N1 · `tool-calls.jsonl` has no result size, so web-chat cost stays unmeasured · the owner rejected a log change for AIObox measuring (2026-10-10) · reopen if the owner asks for result sizes.
- [x] N2 · V1 run 2026-11-03 (§ I2): 24 of 42 historical UNKNOWN clusters were not evictions; for the other 18 the old log cannot tell. From 4.1.0 an eviction is logged as `RULE_RECEIPT_EVICTED` (p3) and a receipt in use no longer drops out (p4).
- [-] N3 · the rule-presence-check Stage B rerun (research R9, on or after 2026-11-22) is not a 4.1.0 item; it is tracked in `plan/done/rule-presence-check.md` Status and `docs/index.md` § Wishlist.
- [x] N4 · Claude Code shows the model the result's `structuredContent` (`scripts/rule-context-mcp.js:70`): metadata and ss, ~1.2–1.3 k chars. The corpus ships only in `content` (`:67`, `plan/done/rule-context-payload-dedup.md`), and Claude Code loads the same rule files itself from `~/.claude/CLAUDE.md`. Checked 2026-11-03 on 34 transcript results (`n4-probe.py`, ss side folder): each is that JSON.
- [x] N5 · F-L1-1: p2 corrects `chrome_launch` profile description. F-L1-2: Option A′, AIObox writes `~/.aki/aiobox/AGENTS.md`.
- [-] N5 Option B · subtract: A′ supplies discovery from AIObox without adding discovery keywords to the AkiMCP tool definition.
- [-] N5 verification · moved to AIObox: A′ is AIObox code; on 2026-11-03 `~/.aki/aiobox/AGENTS.md` does not exist and the aiobox tree has no writer for it; handed to the AIObox lead, who verifies it when it ships.
- [x] S6 #2 · BR-6: decided one bundled re-ask in 4.1.0 (D1).
- [-] S6 #5 · W-x64 `open_url` on a stopped profile: moved to AIObox (D12).
- [-] S3 #8 · `chrome_tabs` / `chrome_interact` take an AIObox CDP port · kept: they act on a window that is already open, as `devtools_*` does with a port from `op=windows` (D8); B2 guards opening a profile by name, where the wrong account gets picked, and the refusal no longer names AIObox ports (p14) · reopen if a seat opens a tab in another seat's window.

## Audit decisions

- [x] B1 and refusal wording: p14 (S6 #1/#6/#7).
- [x] D11: one `aioboxRunning` definition (p5, S6 #3).
- [x] Trusted script directories: p12 rejects a zone equal to or above the data directory and names panel section 6.
- [-] S4b #15–20 · internal or OS variables, not confirmed public options; document public options only.
- [-] S7 PID 999999 and start-scratch ports · low-probability PID reuse; fixed ports occur only in a manual fixture, not `npm test`.
- [-] win-andy tooltip and `pathApi` · lock already means non-removable, not read-only; Windows path matching was not shown faulty, so no test-only API change.
- [-] S6 `isServed` vs `providerServed` · existing distinct semantics; rename is outside the 4.1.0 fix.
- [-] AIObox tool descriptions `op=state first` · keep general-client guidance; the new `whoami` line is conditional on being inside AIObox and a definition change needs AIObox lead review.

## Order after approval

0. N7 — done, `da9f736`.
1. I2: p3 eviction diagnostic + p4 LRU; V1 on the historical UNKNOWNs (N2).
2. D4 helper → B1 (p14) → B2 (D10/D11) → AIObox cross-repo lines; the W-x64 run moved to AIObox (D12).
3. I1 (done 2026-11-03).
4. `npm test`, CHANGELOG, release 4.1.0 on the owner's /akiship order (`RULE-release.md`); release note: reconnect and "Always allow" again (D1).

## DEFERRED (AIObox repo)

- Guide once per chat (`op=state` repeats, 9 of 25) and smaller `op=windows` (median 22 k) — owner: AIObox (D2).
