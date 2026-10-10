# Server availability — PR #17 (spawn crash) + the 2026-10-10 bridge wedge

## Goal

One plan for the two distinct ways this server stopped serving its clients, kept together because they share one symptom (every connected client loses its tools at once) and nothing else: land the substance of **PR #17**, and close the recovery gap exposed by the **2026-10-10 wedge**. Also states, with evidence, which part of that incident is *not* an AkiMCP change.

## Situation — measured, not assumed

| | Incident 1 — failed spawn | Incident 2 — bridge wedge |
|---|---|---|
| Source | PR #17 `drawliu2025-eng`, open since 2026-10-09, +23 −1 in 2 files | Observed live, 2026-10-10 12:18–12:48 UTC |
| Trigger | `aki__task_start` whose spawn fails (ENOENT / EACCES) | Unknown |
| Process | **Exits.** Unhandled `'error'` event | **Stays alive.** Still authenticating new callers at 12:20:35 |
| Client sees | Connection dropped | Auth OK, `tools/list` never answers → "MCP tool discovery failed" |
| Recovery | LaunchAgent `KeepAlive` restarts it | None. 30 min until a human restarted it |
| Reproduced | Yes, isolated 3.0.0, both ENOENT and EACCES (PR author) | No |

The two are independent. PR #17's path cannot explain incident 2: it exits the process, and ours was answering HTTP eleven minutes after it stopped serving tools. Fixing one does not fix the other, and neither was the cause of the *other* failure wave that day (Notion chat windows dying with "Something went wrong" — AIObox's problem, see § Out of scope).

## Incident 1 — accept PR #17's substance

**Verified against the current tree, not taken from the PR body:** `scripts/task-mcp.js` throws `Failed to spawn background task process` at **L153**, while `child.on('error', …)` is only registered at **L172** — 19 lines down the success path. Node emits the child's `error` event on the next tick, so between the throw and the handler the event is unowned and the process exits. The PR's description of 2.2.0 and 3.0.0 matches what is on disk.

The fix is right and minimal: in the `!pid` branch, await the `error` event (1 s fallback) before throwing, and carry its code in the message (`Failed to spawn background task process: ENOENT`). The call still rejects, the caller learns why, the success path is untouched. Test `test/task-mcp.test.js` case 4b (reject with `…: ENOENT`, process still alive afterwards) is the right shape and is kept.

### Merge mechanics

- **Merge, do not cherry-pick** — same reasoning as `done/merge-pr1-windows-chatgpt.md`: the PR head must become an ancestor of master so GitHub marks #17 **Merged** and the contributor keeps the credit.
- **Strip the model-credit trailer.** The PR body ends with `🤖 Generated with Claude Code` and a `claude.ai/code/session_…` URL. Neither may reach the merge commit message, per `RULE-agent-behavior.md` B4 (absolute). The contributor's own commits keep their authorship untouched; only our merge commit message is ours to write.
- **`CHANGELOG.md` entry is ours to word** — the contributor deliberately left it alone. One line under `[Unreleased]`.
- No release is gated on this; it rides the next one.

## Incident 2 — the wedge, and the recovery gap it exposed

### Evidence (UTC, 2026-10-10)

| Time | Fact | Source |
|---|---|---|
| 12:17:04 | Last request that got through (`ai-close-window`) | `~/.aki/aiobox/logs/aiobox.log:1547` |
| 12:18:45 | Last sign of akimcp PID 67391 talking to AIObox | same log, `windows.json refresh` #31 |
| ~12:19 | Every tool call starts failing: "MCP tool discovery failed" | two independent clients |
| 12:20:35–12:20:58 | Six Notion-MCP-Client IPs authenticate successfully | `~/.aki/mcpsv/security.log` |
| 12:20:58 → 12:48:43 | Process writes nothing, anywhere | all logs |
| 12:48:35 | Manual restart; new PID; `[bridge] shared tools-server session opened` | `~/.aki/aiobox/akimcp.log` |
| throughout | AIObox (Rust) logs normally at 12:20, 12:21, 12:24, 12:25, 12:33, 12:38 | `aiobox.log:1557–1568` |

So: not a crash, not the tunnel, not AIObox, not PR #17's path. The gatekeeper front was healthy while the one shared tools-server session behind it was not.

### The gap, read from source

`scripts/streamable-bridge.js` handles a **closed** shared session correctly and self-heals: the close path nulls `shared` (L64–68, with a logged reason), after which any non-`initialize` request is rejected as stale (L162), the client re-initializes, and `ensureShared()` (L104–116) boots a fresh session. One shared session is the right model and is not in question here (`CLAUDE.md` § Session lifecycle; `done/bridge-session-churn.md`).

There is **no equivalent path for a session that is alive but not answering.** `shared` stays non-null, requests are forwarded onto it, and nothing resolves until `MCP_REQUEST_TIMEOUT_MS` (default 10 min) — long past any client's own patience. Nothing nulls `shared` on that timeout, so the next `initialize` reuses the wedged session instead of rebooting it, and the state is permanent until the process is restarted. That matches the 30-minute observation exactly: this is the only mode in which the server can be up, authenticating, and toolless indefinitely.

**This is a core-need change, not an AIObox-driven one** (`CLAUDE.md` § Stable core): every external client is affected, and the trigger is internal to the bridge.

### Counter-evidence on record

A second seat (Notion, P6·W66) made 4+ AkiMCP calls during roughly 12:38–12:52 UTC, including one mid-turn, and every one returned a clean tool error while its chat kept answering normally; one `op=send` was lost and re-sent. So a wedged bridge surfaces on a Notion seat as a *tool error*, not as a dead chat. That does not settle whether a call that **hangs** (rather than errors) can kill a chat turn — nobody was mid-call at the instant the bridge dropped, and exact seconds were not recorded. Treat "a hanging AkiMCP call can wedge a Notion chat turn" as **open**, not disproven.

### Proposal — R1

When a forwarded request times out, treat the shared session as dead: log it with a reason, null `shared`, and let the existing stale-rejection path (L162) rebuild it on the next `initialize`. The recovery machinery already exists and is proven; only the trigger is missing. Explicitly **not** proposed: per-client sessions, an `MCP_MAX_SESSIONS` cap, or any return to the pre-3.0 model — all forbidden by `CLAUDE.md` and already settled in `done/bridge-session-churn.md`.

Open before implementing: whether one timed-out request is enough evidence to tear down a session shared by every client, or whether it should take two in a row. Decide with a reproduction, not by argument — and the reproduction needs the log that § Out of scope is about.

## Out of scope for this repo

**The lost log is AIObox's, not ours.** `~/.aki/aiobox/akimcp.log` is written by AIObox, not by this server: `aiobox/desktop/src-tauri/src/akimcp/process.rs` (`open_log`, L98/L135), documented in `aiobox/docs/feat/akimcp-connect.md:96` as "emptied at each Start and once past 1 MB". That is a deliberate, owner-approved design from 2026-10-08, and it is why the wedge's own log was destroyed by the restart that recovered from it — the evidence is erased exactly when it is needed. Changing it belongs in an AIObox plan; nothing in this repo should be edited for it.

The same applies to the Notion-window failure wave of that morning (seven accounts rested with `cause=interrupted` between ~08:32 and 11:53, both windows of an account dying in the same minute, none of them near their quota). That investigation lives in AIObox.

## Checklist

- [x] Merge PR #17 as a merge commit; trailer stripped; `CHANGELOG.md` entry worded here (local only: not pushed, PR #17 stays Open until the owner pushes)
- [x] Keep `test/task-mcp.test.js` case 4b; confirm it fails on the pre-fix tree (red on 9e99fdc, green on 627a755)
- [ ] R1: reproduce a wedged shared session, then decide the 1-vs-2 timeout threshold
- [ ] R1: implement teardown-on-timeout; no new session model
- [ ] Filed in AIObox, not here: append-mode/rotated `akimcp.log`; the interrupted-account wave
