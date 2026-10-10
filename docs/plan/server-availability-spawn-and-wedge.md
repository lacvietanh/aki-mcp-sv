# Server availability — PR #17 (spawn crash) and the 2026-10-10 outage

## Goal

One plan for the two times this server stopped serving its clients: land the substance of **PR #17**, and record what the 2026-10-10 outage really was so no guard is built for a state that was never observed. Also states, with evidence, which part is *not* an AkiMCP change.

## Situation — measured, not assumed

| | Incident 1 — failed spawn | Incident 2 — outage 12:20–12:48 UTC, 2026-10-10 |
|---|---|---|
| Source | PR #17 `drawliu2025-eng`, open since 2026-10-09, +23 −1 in 2 files | Observed live; reconstructed from the durable logs below |
| Trigger | `aki__task_start` whose spawn fails (ENOENT / EACCES) | The same trigger, twice in 31 s |
| Process | **Exits.** Unhandled `'error'` event | **Exited twice.** Restarted once by AIObox, then left stopped |
| Client sees | Connection dropped | "MCP tool discovery failed" for 27.5 min |
| Recovery | AIObox restarts it, at most once per 10 min | The second exit fell inside that gap; a human restarted it at 12:48:35 |
| Reproduced | Yes, isolated 3.0.0, both ENOENT and EACCES (PR author) | By logs only; the process-exit line was lost with `akimcp.log` |

An earlier version of this plan read incident 2 as a *wedge* (process alive, shared session silent) because `akimcp.log` was gone. Two durable files settle it: `~/.aki/mcpsv/tool-calls.jsonl` (every logged tool call, `ts`/`ok`/`ms`) and `~/.aki/mcpsv/security.log`.

## Incident 1 — accept PR #17's substance

**Verified against the current tree, not taken from the PR body:** `scripts/task-mcp.js` threw `Failed to spawn background task process` at **L153**, while `child.on('error', …)` is registered only at **L172** — 19 lines down the success path. Node emits the child's `error` event on the next tick, so between the throw and the handler the event is unowned and the process exits.

The fix is right and minimal: in the `!pid` branch, await the `error` event (1 s fallback) before throwing, and carry its code in the message (`Failed to spawn background task process: ENOENT`). The call still rejects, the caller learns why, the success path is untouched. Test `test/task-mcp.test.js` case 4b (reject with `…: ENOENT`, process still alive afterwards) is kept.

The same shape existed in `scripts/postman/postman-session.cjs` (Postman launch, daemon process only): fixed the same way, `Failed to launch Postman: <code>`. Every other `spawn` in `scripts/` already has an `error` listener, so no process-level `uncaughtException` net is added (it would hide real faults, `pattern.A8`).

### Merge mechanics

- **Merge, do not cherry-pick** — same reasoning as `done/merge-pr1-windows-chatgpt.md`: the PR head must become an ancestor of main so GitHub marks #17 **Merged** and the contributor keeps the credit.
- **Strip the model-credit trailer.** The PR body ends with `🤖 Generated with Claude Code` and a `claude.ai/code/session_…` URL. Neither may reach the merge commit message, per `RULE-agent-behavior.md` B4 (absolute).
- **`CHANGELOG.md` entry is ours to word** — the contributor deliberately left it alone.
- No release is gated on this; it rides the next one.

## Incident 2 — what the durable logs show

| Time (UTC) | Fact | Source |
|---|---|---|
| to 12:21:03 | About one logged tool call every 3 s from one Notion window | `tool-calls.jsonl` |
| 12:20:32 | `aki__task_start` fails after 25 ms (the pre-fix throw) | `tool-calls.jsonl` |
| 12:20:35–58 | Six "token used by new caller" lines; the tracker (`scripts/callers.js`) lives in memory, so it fires only after a process start | `security.log` |
| 12:20:40–55 | Four `run_cmd` refusals of 1–3 ms, then four `akidevrule_context` re-fetches: the receipt was unknown after a restart | `tool-calls.jsonl` |
| 12:21:03.761 | `aki__task_start` fails again after 24 ms; the last entry for 27.5 min | `tool-calls.jsonl` |
| 12:48:35 | Manual restart; first calls resume at 12:49:06 | `tool-calls.jsonl`, `akimcp.log` of the new run |

AIObox restarts an AkiMCP that ends by surprise **at most once per 10 minutes** and then leaves it stopped, deliberately "so one that keeps failing stays stopped with its log" (`aiobox/desktop/src-tauri/src/akimcp/process.rs` `RESTART_GAP_MS`, `finish()`; there is no later retry). A second exit 31 s after the first is exactly the case that policy leaves down.

Verdict: SUGGESTED, high confidence. The exit lines themselves are gone, so it is not CERTAIN. What would overturn it: any tool call answered between 12:21 and 12:48.

### Decision — R1 closed, no action

R1 (null the shared bridge session when a forwarded request times out) guarded a state no log has ever shown across ~12,400 logged calls in 5 days. It would also fire on any legitimate long tool call (`MCP_REQUEST_TIMEOUT_MS`, 10 min), tearing down the one session every client shares. `pattern.A8`, `proportion.B4`. One shared session stays (`CLAUDE.md` § Session lifecycle; `done/bridge-session-churn.md`); per-client sessions and an `MCP_MAX_SESSIONS` cap stay forbidden.

Reopen if a client reports that `tools/list` hangs while the panel answers 200 and `tool-calls.jsonl` shows no entries. The first step then is a durable one-line record of the timeout (detect), not a teardown.

## Out of scope for this repo

**What happens after a second exit is AIObox's.** The restart gap is a deliberate AIObox policy; changing it, or telling the owner when AkiMCP stopped by surprise and was not restarted (`stopped_unexpectedly_at_ms` exists in `process.rs`; no frontend use found), belongs in an AIObox plan.

**The lost log is AIObox's too.** `~/.aki/aiobox/akimcp.log` is written by AIObox (`process.rs` `open_log`), documented in `aiobox/docs/feat/akimcp-connect.md:96` as "emptied at each Start and once past 1 MB", so the restart that recovered the server erased its last lines.

The same applies to the Notion-window failure wave of that morning (seven accounts rested with `cause=interrupted` between ~08:32 and 11:53, none near their quota). That investigation lives in AIObox.

## Checklist

- [x] Merge PR #17 as a merge commit; trailer stripped; `CHANGELOG.md` entry worded here (local only: not pushed, PR #17 stays Open until the owner pushes)
- [x] Keep `test/task-mcp.test.js` case 4b; confirm it fails on the pre-fix tree (red on 9e99fdc, green on 627a755)
- [x] Same fix for the Postman launch spawn (`postman-session.cjs`)
- [ ] Filed in AIObox, not here: the restart gap leaving AkiMCP stopped without telling the owner; append-mode/rotated `akimcp.log`; the interrupted-account wave
