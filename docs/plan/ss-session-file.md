# ss: one session file per chat, its path minted by the server

Superseded in part 2026-10-25 by [`v2-ss-session-file.md`](v2-ss-session-file.md): D6 (shape), the handoff sentence of D7/D8 and the seat clause of D14 are replaced there; every other decision here stands.

Status: P1-P5 and P7 done 2026-10-24; P6 (live check) passed 2026-10-24. Ships in 3.1.0, not 3.2.0: 3.1.0 was never tagged, pushed or published, and `release.A5` forbids opening a second unshipped version on top of it, so the work joins the open one (owner 2026-10-24: "phải làm hết… trong 1 lượt yêu cầu này", shipped later by Claude Code). Decided 2026-10-23. Every point below is decided; nothing is left as an owner question (owner 2026-10-23: "file plan này là bản chốt cải thiện vụ bớt phải nhắc ghi phiên, và refactor cách ghi phiên. tất cả đều quyết, không có cái nào bỏ lại." · "sẽ để dành cho phiên bản sau"). Record of how it was decided: 2-seat council room `/Users/aki/.aki/agent-council/aki-mcp-sv/2026.10.23-2123-akimcp-ss-session-file/` (`chat.md` holds the owner's message verbatim and three turns, `lead.md` the analysis with sources, `challenger.md` the AkiMCP Worker's attack, `checklist.md` the requirement ledger), then a self-run deep-think pass per aspect (2 to 6 rounds each) that closed the room's two owner questions and the points below marked "new". Working file of that session: `/Users/aki/.aki/mcpsv/task/akimcp-ss-session-file/working.md`.

## Goal

Owner 2026-10-23 21:16, verbatim: "tôi vẫn cứ hay phải nhắc lại chuyện "nhớ ghi vào working.md và trả về full path"". The reminder has two halves, and each needs its own mechanism:

| Half | Mechanism that removes it | Decision |
|---|---|---|
| "trả về full path" | the server hands the chat an absolute path at its first call; the model copies it, never builds it | D5 |
| "nhớ ghi" | a fixed report line the owner can see missing, plus a server line on every acting call when the file is behind the chat's work | D7, D10 |

Ultimate goal: any later agent (a successor, another client, the same chat after a compaction) resumes a chat from one file whose path the owner can paste, without the owner asking for it.

## Facts this rests on

| # | Fact | Source |
|---|---|---|
| F1 | The file exists only if the model forecasts at turn 1 that the task will outlive the chat; the owner cannot predict that forecast, so he reminds in advance | `WORKING_FILE_STEP`, `scripts/rule-context-mcp.js:16` |
| F2 | The path is built by the model from the template `$HOME/.aki/mcpsv/task/<slug>/working.md` with a slug it invents | same line |
| F3 | Nothing mechanical covers "update": the write-time line fires only after a write | `scripts/filesystem-mcp.js:151-153` |
| F4 | Name friction: Telex turns the `w` of "working" into `ư`; chat apps auto-link `working.md` as a web domain (the council anchor carries `[working.md](http://working.md)`); 64 folders under `task/` hold a file with the same name, slugs carry no project and no date | `lead.md` § 1 R5 |
| F5 | Measured effect of the 3.1.0 rule: AIObox archive before it, 145 chats, 2463 owner messages, 17 reminders; after it, 1 chat, 8 messages, 0. Open chats are not archived, so this is no data, not an improvement | `lead.md` § 1, challenger #20 finding 6 |
| F6 | The write-time line "Tell the user in this reply what changed in …" is an order inside tool output, the shape host firewalls flag as prompt injection (3.1.0 removed the same shape from `scripts/project-rules.js` after a ClickUp Brain agent halted) | `scripts/filesystem-mcp.js:153`, `CHANGELOG.md` [3.1.0] Fixed |
| F7 | `write_file` needs the parent folder to exist | `resolveRealWritable` → `resolveRealUnderRoot`, `scripts/roots.js` |
| F8 | The data dir is writable by the file tools only when it lies under the allowed folders: the default roots include `~/.aki`, a custom `folders` list in `setting.json` may not | `envDefaultRoots`, `scripts/roots.js` |
| F9 | The receipt hashes `mode, workingRoot, sources, context` only; header lines are outside it | `scripts/rule-context.js:206` |
| F10 | Claude Code passed `structuredContent` to the model instead of `content` when both were present (one session observed) | `docs/plan/per-client-tool-surface.md` V6 |
| F11 | `workingRoot` is the longest allowed root containing `workingPath`, not a git root (`/Volumes/DEV` yields `DEV`) | `scripts/rule-context.js:66-81` |
| F12 | This repo moved from `/Volumes/DEV/Nodejs/aki-mcp-sv` to `/Volumes/DEV/pj/aki-mcp-sv`; Claude Code's path-encoded key split its history in two, a basename key keeps one. The Aki Dev Sync registry holds 29 projects with 0 duplicate basenames | `challenger.md` finding 5, `lead.md` Amendments |
| F13 | The server holds one shared session and cannot tell chats apart; no per-chat id reaches it | `CLAUDE.md` § Session lifecycle, `docs/research/rule-presence-check-review.md` R3 |
| F14 | Every acting tool gets `receipt` from one place, `withReceipt`, and one wrapper, `gate`, strips and checks it | `scripts/rule-gate.js` |
| F15 | Text naming the old file outside this repo: AkiDevRule 0, akimcp.top 0, akitao.com app 0. AIObox live docs: `CLAUDE.md:11`, `docs/agents/lead.md` (lines 7, 15, 21, 115, 160, 211, 212, 223), `docs/plan/remaining-0.11.1.md`, `docs/plan/ai-guide.md`, `docs/plan/aio-control-gaps.md`, `docs/plan/IMPORTANT-shared-cdp-profiles.md`, `docs/index.md`; the rest are `done/` and `research/` records (frozen) and a test string (`desktop/src-tauri/src/automation/quota.rs:2402`) | grep 2026-10-23 |
| F16 | AIObox's lead keeps a role file, `~/.aki/mcpsv/task/aiobox-lead/working.md` § Team, that outlives every chat and handoff | aiobox `CLAUDE.md:11`, `docs/agents/lead.md:15,21` |

## Decisions

**D1 · The term is `ss`.** Two plain letters: Telex leaves them alone, no chat app links them, and they replace both "working.md" and "task" in speech and in paths. In Vietnamese chat "ss" also means "so sánh" and in English "screenshot"; the word alone is never an order, the owner asking for the session file is (`agent.A3`), so the collision needs no code.

**D2 · Location: `<data dir>/ss/<project>/<YYYY.MM.DD-HHMM>-<label>.md`.** `<data dir>` is `USER_DIR` (`scripts/userdata.js`: `AKI_MCP_DATA_DIR`, else `~/.aki/mcpsv`, `mcpsv-dev` in dev), joined with `path.join` so Windows and Linux get their own separators. Example on this machine: `/Users/aki/.aki/mcpsv/ss/aki-mcp-sv/2026.10.23-2123-p37w8.md`. One flat file per chat, named by itself, so every editor tab reads differently. The task's title is the file's H1, not part of the name. Drafts and probes go to `/tmp` or the harness scratchpad, files that must persist into the project's `scripts/` (`agent.C5`); there is no sibling folder per session.

**D3 · `<project>` = basename of the nearest folder holding `.git` (a folder or a file, so worktrees and submodules count), walking up from `workingPath` and stopping at `workingRoot`; no git folder or no `workingPath` → `_`.** Characters outside `[A-Za-z0-9._-]` become `-`. Survives a repo move (F12). A same-basename pair is told apart by the absolute repo path in the file's header (D6), never by encoding the path into the name.

**D4 · `<label>` = the optional `label` input, sanitized: Unicode folded to ASCII (`đ` → `d`), lowercased, spaces and underscores become `-`, every other symbol drops, at most 16 characters (`P37·W8` → `p37w8`, `Sửa lỗi` → `sua-loi`); empty or absent → 2 random base36 characters.** The label is the owner's name for the chat when the chat knows it (a window handle in the page title, a ClickUp task word); AkiMCP's description says only that, generically, and names no AIObox handle (`CLAUDE.md` § Stable core): AIObox's own guide tells its windows to pass the handle (D14). Time = the AkiMCP machine's local clock, the clock the owner reads, in the council-room format. If the minted name already exists (same minute, same label), 2 random base36 characters are appended. A label passed only on a later call does not rename a kept ss; the header carries the name instead.

**D5 · `aki__akidevrule_context` mints the path and keeps it (new optional inputs `ss` and `label`).**
- No `ss` input → mint per D2-D4.
- `ss` input that resolves directly inside any `<data dir>/ss/<project>/` folder and matches the name pattern → returned verbatim, whether or not the file exists (any project, so a chat that moves to another repo keeps its one file) ("keep the first ss": a re-call after a rule change, a compaction or a `RULE_PUSH` re-issue never starts a second file). Anything else → ignored, a fresh mint, and the line says `ignored`.
- The tool creates nothing: it stays `readOnlyHint: true`. It reports the folder's state instead, so the model's first write succeeds in one call.
- One header line after the receipt line, in `content`, and the same values in `structuredContent.ss` (`{ path, state }`), because Claude Code may show the model only `structuredContent` (F10). Outside the receipt hash (F9), so minting never changes a receipt.

| State | Line |
|---|---|
| minted, folder exists | `ss: <absolute path> · new · folder ready` |
| minted, folder missing | `ss: <absolute path> · new · folder missing` |
| kept, file exists | `ss: <absolute path> · kept` |
| kept, not written yet | `ss: <absolute path> · kept · not created yet` |
| input was not an ss path | `ss: <absolute path> · new (the ss given was ignored: not an ss path)` |
| `<data dir>/ss` outside the allowed folders (F8) | `ss: unavailable · <data dir> is outside the allowed folders; add it under Folders in the panel` |

**D6 · Format: Markdown state, not a RAW transcript.** The reader is the next agent, which needs state, not history (one Claude Code transcript here is 41.5 MB). For web chats no RAW writer exists inside AkiMCP (F13), and an open chat's text exists only in its host. Fixed shape, so any agent can resume it:

````markdown
# <task title>

project /abs/repo/path · chat <label or client name> · started 2026-10-23 21:23 · transcript <absolute path, when the harness writes one>

## Goal
<the owner's words, verbatim>

## State
## Next
## Decisions
## Open
## Files
<absolute paths this chat edits>
````

**D7 · One rule constant, `SS_STEP`, replaces `WORKING_FILE_STEP` in the description, the initialize instructions and `SHARED_WORK` (same three places, one constant, `pattern.A1`).** The trigger is an observable act, not a forecast (F1); the update is every acting turn, not "when a step finishes"; the report is a fixed token the owner can search for and see missing. Text to ship, final wording settled against the tool-surface budget:

````text
Session file (ss): the `ss:` line of this output is this chat's file, an absolute path made for you; never build one yourself. Create it with the first act that changes something (a file edit, a commit, a writing command) or when the owner asks for it; skip it for Q&A and lookups. Keep one per chat: pass it back as ss=<path> on every later aki__akidevrule_context call and beside receipt on every acting call; a handoff successor keeps the ss its letter names. In every turn that acted, write it before replying (goal in the owner's words, state, next step, decisions, open items, the files you edit as absolute paths), and end that reply with one line `ss: <absolute path> · <what changed>`; no write, no line. A result line `ss: <path> · last written N min ago` or `· not created yet` means the file is behind this chat's work. `folder missing`: create the folder first.
````

**D8 · `SHARED_WORK` lines follow the rename.** `scripts/rule-context-mcp.js:21` ("Drafts and notes go in that folder or /tmp") becomes the `SS_STEP` line alone, with no drafts clause: `/tmp` is outside AkiMCP's default folders and absent on Windows, so a chat told to use it could not write there, and `agent.C5` already says where drafts go (2026-10-24, after a ClickUp chat left its probe folder in its task folder). `:22` lists `CHANGELOG.md` and "an ss another session also writes" as the files everyone touches. `:24` reads: the successor reads the letter, the ss and the old chat, keeps writing that ss and takes over its Files list. `test/rule-context.test.js:94` swaps the literal `$HOME/.aki/mcpsv/task/<slug>/working.md` for `ss=<path>` and `SS_STEP`'s report line.

**D9 · The write-time line becomes a fact, not an order (new, F6).** A `write_file` or `edit_file` of an ss path, or of a legacy `task/<slug>/working.md` (D12), ends with `ss file written: <absolute path>`; `SS_STEP` already says what the reply owes. Both path patterns live once, in a new `scripts/session-file.js` that `filesystem-mcp.js`, `rule-context-mcp.js` and `rule-gate.js` import (`pattern.A1`).

**D10 · Stale-file line on acting calls (council Q1, decided: build).** `withReceipt` adds an optional `ss` beside `receipt` on every acting tool (F14: one place), with no per-parameter description, because `SS_STEP` explains it and each description costs tool-surface budget on ~20 tools. `gate` strips `ss` with `receipt`; after the tool ran, when `ss` is a valid ss path and the call did not itself write that file, it appends one line: `ss: <absolute path> · not created yet` when the file is missing, `ss: <absolute path> · last written N min ago` when its mtime is 15 minutes or more behind (`SS_STALE_MS`). An invalid `ss` gets `ss: not an ss path, ignored`. A client with a cached schema sends no `ss` and nothing changes for it.
- Not per-client session tracking (`CLAUDE.md` § Session lifecycle): the server stores nothing; the chat carries its path like it carries its receipt, and the server reads one mtime from disk.
- The bet: models copy an argument they pass on every call (the receipt gate shows it holds), while a prose duty fades in a long chat. D11 measures whether the bet holds.
- Every line is a fact about a file, never an order (F6).

**D11 · The call log records the instrument (new).** Each gated call's log line in `tool-calls.jsonl` gains `ss` (`true` when a valid ss was passed) and `ssAge` (minutes since its last write, `-1` when missing), set in `scripts/tool-call-log.js`; no path is logged. `aki__akidevrule_context` lines gain `ssState` (`new`, `kept`, `ignored`, `unavailable`). This is the measurement the council's two-week gate lacked: the share of acting calls that carry an ss, and how stale those files run.

**D12 · Old `task/` folders stay where they are; the legacy match has a removal trigger.** Plans cite them by absolute path (`docs/plan/done/test-bare-run-isolation.md:3`), so moving them breaks every citation; no migration. The write-time line keeps matching `task/<slug>/working.md` while old threads still write there, and is deleted in the first release after which no `task/*/working.md` was modified for 30 days (`find <data dir>/task -name working.md -mtime -30` empty). `task-logs/` and `tasks.json` belong to `aki__task_start` and are untouched; moving session files to `ss/` ends the double meaning of "task".

**D13 · Harness sessions: Claude Code, agy, Codex (council N1, decided).** A harness that calls `aki__akidevrule_context` gets the same ss and the same rule, and puts its own transcript path on the header line (D6), so a web chat and a Claude Code session hand over through one format. A native session that never calls AkiMCP is out of AkiMCP's reach; it has its own transcript and resume, and the reminders come from web chats (F5), so AkiDevRule gets no ss rule (no action).

**D14 · AIObox side (council Q2, decided), done in the aiobox repo in its own turn, zero AkiMCP code (`CLAUDE.md` § Stable core).**
- AIObox writes each window's transcript to its own data dir after every turn, not only when the window closes, and names that path for the window; the window puts it on its ss header line. It is the only place a live RAW of a web chat can come from, and AkiMCP never reads it.
- AIObox's guide (`op=state`) tells a window to pass its handle as `label` on its first `aki__akidevrule_context` call.
- The team roster (F16) is AIObox state, not a session: it moves from `~/.aki/mcpsv/task/aiobox-lead/working.md` § Team to a file in AIObox's own data dir, and each seat keeps its chat state in its own ss.
- The live docs of F15 change in the same turn; frozen records stay.
- Handed over by a letter in `~/.aki/handoff/` for the AIObox lead when this plan's P1-P5 are merged.

**D15 · Limits, stated to the owner as they are.** "trả về full path" goes away by construction. "nhớ ghi" becomes visible (a missing `ss:` line in a reply, a stale line in tool results) and is measured (D11), but on a web chat the model stays the only writer; a chat whose host compacts away both the rule and the path starts a new ss on its next context call. The live AIObox transcript (D14) is the fallback for that case.

## Rejected

| Option | Why not |
|---|---|
| RAW jsonl instead of a state file | no writer inside AkiMCP for web chats (F13); an open chat's text exists only in its host; the next agent needs state, not 40 MB of history. Harness transcripts are linked from the header instead |
| A tool-call slice jsonl beside the ss | neither the RAW the owner described nor state; a third format with no reader |
| Claude Code's path encoding (`-Volumes-DEV-pj-aki-mcp-sv`) as the project key | splits history when a repo moves (F12), lossy (`.` and `/` both become `-`), leading `-` reads as an option to `ls`/`rm`, three times longer |
| A folder per session (`ss/<x>/ss.md`) or a sibling drafts folder | every tab reads `ss.md`; no run needed the folder |
| A model-chosen slug inside the name | the model builds the path again (F2) |
| The ss tool creating the file or folder | breaks `readOnlyHint` on the rule loader and makes empty files for Q&A chats; the header reports the folder state instead (D5) |
| A call counter per chat for the stale line | per-chat state in the server, against `CLAUDE.md` § Session lifecycle; file age needs none |
| Moving the 64 `task/` folders into `ss/` | breaks every absolute citation in plans (D12) |
| A ss rule in AkiDevRule for native sessions | they have their own transcript; the reminders come from web chats (D13) |
| Naming AIObox handles in AkiMCP's `label` description | `CLAUDE.md` § Stable core; AIObox's guide says it (D14) |

## Steps

- [x] **P1 · `scripts/session-file.js`** (done 2026-10-24; `sessionFor` also lives here, the D5 header line and the `unavailable` check) (one responsibility: name, check and age an ss path): `projectKey(workingPath, workingRoot)`, `sanitizeLabel(label)`, `mintSessionPath({ project, label, now })` with the collision suffix, `acceptSessionPath(p)`, `SS_FILE` and `LEGACY_WORKING_FILE` patterns, `ssAge(p, now)`. Tests in a new `test/session-file.test.js` (first import `./setup.js`): git folder found, `.git` as a file, no git → `_`, non-ASCII label, 16-character cut, collision suffix, a path outside `ss/` or with `..` refused, Windows-style separators accepted.
- [x] **P2 · mint and keep in `aki__akidevrule_context`** (done 2026-10-24) (`scripts/rule-context-mcp.js`): `ss` and `label` inputs, the D5 header line and `structuredContent.ss`; the receipt unchanged by either input. Tests in `test/rule-context.test.js`: mint, keep on re-call, ignored input, folder missing, data dir outside the roots, receipt identical with and without `ss`.
- [x] **P3 · the rule** (done 2026-10-24) (`scripts/rule-context-mcp.js`): `SS_STEP` replaces `WORKING_FILE_STEP` in its three places; `SHARED_WORK` lines 21, 22, 24 per D8; `test/rule-context.test.js:94` literals; the description stays the one tool allowed past the 700-character cap (`test/tool-surface.test.js`).
- [x] **P4 · write-time line and stale line** (done 2026-10-24; measured `RAISES` entry 1054 chars, 35374 → 36428): `scripts/filesystem-mcp.js` uses `session-file.js` and prints the D9 fact line for ss and legacy paths (tests in `test/filesystem-mcp.test.js`, which has none for this line today); `scripts/rule-gate.js` `withReceipt` adds `ss` and refuses a tool that already has an input named `ss`, `gate` strips it and appends the D10 line (tests in `test/rule-gate.test.js`: missing file, fresh file, stale file, the call that writes the ss itself gets no line, invalid `ss`); `scripts/tool-call-log.js` fields per D11 (`test/tool-call-log.test.js`); one measured `RAISES` entry in `test/tool-surface.test.js` for the `ss` parameter.
- [x] **P5 · docs and record** (done 2026-10-24; the entries went into the open `[3.1.0]` block, see Status): `docs/arch/rule-context-delivery.md` (the description's last step, the header line, `SHARED_WORK`; stamp rewritten), `docs/feat/tools.md:11` (the write-time line; stamp rewritten), `CHANGELOG.md` `[Unreleased]` (`Added`: the minted ss and the stale line; `Changed`: the rule, the neutral write-time line), `docs/index.md`. Run `npm test` in full, `release_lint.py --latest .`, and the `CLAUDE.md` § Release process drift check.
- [x] **P6 · live check**: restart AkiMCP; from one web chat (ClickUp Brain) and one AIObox window, one multi-step task each: the first context call shows `· new`, a re-call with `ss=` shows `· kept`, the first write lands in one call, every acting reply ends with the `ss:` line, an acting call 15 minutes after the last write shows `last written N min ago`, and `tool-calls.jsonl` carries `ss`, `ssAge`, `ssState`. Progress 2026-10-24: over `scripts/stdio.js` (the 3.1.0 code in-process, an MCP SDK client) every step passed: `· new · folder ready`, `· kept · not created yet`, an acting call `· not created yet`, the write in one call with `ss file written`, `last written 16 min ago` with the file's time set back. AkiMCP restarted on 3.1.0 at 12:45Z (AIObox respawned it in 4 s, Cloudflare tunnel up): the first live context call returned `ss … state new`, and `tool-calls.jsonl` carries `ssState` for a claude.ai chat and a `node` web client. Left: `· kept` and the acting-call lines from a client whose tool list was loaded after the restart (a claude.ai chat opened before it keeps the old schema, without `ss` or `label`). Seen live by 14:20Z: 21 context calls (20 `node` web clients, 1 claude.ai), every one `ssState: new`, none `kept`, no ss file written yet; a ClickUp Brain chat (AIObox P36·W52) ends its acting replies with the `ss:` line, naming the old `working.md` its owner told it to keep. After the 14:35Z restart, by 15:05Z: `ssState: kept` on 3 re-calls (a `node` web client, WorkBuddy), ss files written by the chats themselves under `ss/aiobox/`, `ss/Aki-Dev-Sync/`, `ss/_/`, 54 acting calls carrying `ss` (`ssAge` up to 22 min, so the `last written N min ago` line was served), and the council's ClickUp seats end acting replies with the `ss:` line. Passed.
- [ ] **P7 · AIObox turn** (D14): handoff letter to the AIObox lead (written 2026-10-24: `/Users/aki/.aki/handoff/aiobox-lead-from-akimcp-ss-2026-10-24.md`); AIObox ships the live transcript, the `label` guide line, the roster move and the F15 doc edits in its own release.
- [ ] **P8 · close**: the plan moves to `docs/plan/done/` when P1-P6 shipped in a release; P7 is AIObox's and is recorded here as handed over; D12's legacy match is removed in the first release after its 30-day trigger.

## Done when

- A chat that never hears the words "working.md", "ss" or "full path" from the owner ends every acting reply with an `ss:` line naming one absolute path, the same path across re-calls.
- 14 days after the release, the owner reports whether he still reminds, and `tool-calls.jsonl` gives the share of acting calls carrying `ss` and their `ssAge` spread. Reopen D10's shape (threshold, wording) if under half of acting calls from web chats carry `ss`, or the owner still reminds.

## Risks and how they would show

| Risk (pre-mortem) | Weight | Shows as | Answer |
|---|---|---|---|
| Models skip `ss=` on acting calls, so the stale line never fires | medium | D11 share low | reopen D10: put the ss in the receipt refusal text, or tighten `SS_STEP` |
| A host compacts away both the rule and the path, a second ss starts | low | two files one chat apart in `ss/<project>/` | the owner pastes the first path; D14's live transcript helps AIObox windows |
| The stale line reads as an order to a host firewall | low | a host halts on an AkiMCP result | the line is a fact by construction (D9, D10); reword, never add an imperative |
| The `ss` parameter pushes `tools/list` over budget | low | `test/tool-surface.test.js` red | parameter without description; a measured `RAISES` entry |
| A user whose allowed folders exclude the data dir cannot write the ss | low | `ss: unavailable` line | the line names the fix (add the folder in the panel) |
