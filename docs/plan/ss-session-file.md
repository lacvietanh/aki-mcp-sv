# ss: one session file per chat — a server-minted path (v1), one shape and one writer (v2)

Status: shipped in 3.1.0 (released 2026-10-26, `CHANGELOG.md` [3.1.0]); v1 P1–P7 and v2 P1–P8 done; open: v2 P9, the close, on or after 2026-11-09 (14 days after the 3.1.0 release), which also carries v1 P8 and D12's legacy `task/*/working.md` match (`LEGACY_WORKING_FILE` in `scripts/session-file.js`). Current behavior lives in `docs/feat/session-file.md`; this file is the decision record. Both rounds shipped inside 3.1.0, not a version on top of it (`release.A5`; owner 2026-10-24: "phải làm hết… trong 1 lượt yêu cầu này"; owner 2026-10-25: "làm cái này trong đợt 3.1 luôn … gom vào 3.1 luôn cho nó đáng"). Merged 2026-10-28 from `v2-ss-session-file.md`, which older records cite.

IDs: v1's keep bare names (D1–D15, F1–F16, P1–P8); v2's carry `v2` (v2 D1–D10, v2 F1–F10, v2 P1–P9), as code comments cite them. Inside § v2 a bare ID is v2's and `v1` marks v1's.

## Goal

v1, owner 2026-10-23 21:16, verbatim: "tôi vẫn cứ hay phải nhắc lại chuyện "nhớ ghi vào working.md và trả về full path"". The reminder has two halves, and each needs its own mechanism:

| Half | Mechanism that removes it | Decision |
|---|---|---|
| "trả về full path" | the server hands the chat an absolute path at its first call; the model copies it, never builds it | D5 |
| "nhớ ghi" | a fixed report line the owner can see missing, plus a server line on every acting call when the file is behind the chat's work | D7, D10 |

v2, owner 2026-10-25 02:16, verbatim: "cấu trúc ghi file phiên quá mức lộn xộn, cẩu thả, kém khoa học … học hỏi cách mà claude, agy tạo phiên và giữ phiên, làm việc với đống file phiên,.. cho chuẩn, đúc kết mọi tinh túy, gom thành docs/plan mới, chuẩn ss-v2 (bản đầu đang không ổn, chưa ổn)" · same message, of the m6 chat's ss: "nó nói quá dài dòng".

Ultimate goal: any later agent (a successor, another client, the same chat after a compaction) resumes a chat from one file whose path the owner can paste, without the owner asking for it. Goal chain: every ss has the same small shape → the owner (who often reads only the last message) and any successor agent re-orient from the top 10 lines → no chat's work is lost or found stale across compaction, handoff, council or a move to another client, and nobody has to remind or hunt.

## v1 — decided 2026-10-23

Every point below is decided; nothing is left as an owner question (owner 2026-10-23: "file plan này là bản chốt cải thiện vụ bớt phải nhắc ghi phiên, và refactor cách ghi phiên. tất cả đều quyết, không có cái nào bỏ lại." · "sẽ để dành cho phiên bản sau"). Record of how it was decided: 2-seat council room `/Users/aki/.aki/agent-council/aki-mcp-sv/2026.10.23-2123-akimcp-ss-session-file/` (`chat.md` holds the owner's message verbatim and three turns, `lead.md` the analysis with sources, `challenger.md` the AkiMCP Worker's attack, `checklist.md` the requirement ledger), then a self-run deep-think pass per aspect (2 to 6 rounds each) that closed the room's two owner questions and the points below marked "new". Working file of that session: `/Users/aki/.aki/mcpsv/task/akimcp-ss-session-file/working.md`.

### Facts this rests on

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

### Decisions

**D1 · The term is `ss`.** Two plain letters: Telex leaves them alone, no chat app links them, and they replace both "working.md" and "task" in speech and in paths. In Vietnamese chat "ss" also means "so sánh" and in English "screenshot"; the word alone is never an order, the owner asking for the session file is (`agent.A3`), so the collision needs no code.

**D2 · Location: `<data dir>/ss/<project>/<YYYY.MM.DD-HHMM>-<label>.md`.** `<data dir>` is `USER_DIR` (`scripts/userdata.js`: `AKI_MCP_DATA_DIR`, else `~/.aki/mcpsv`, `mcpsv-dev` in dev), joined with `path.join` so Windows and Linux get their own separators. Example on this machine: `/Users/aki/.aki/mcpsv/ss/aki-mcp-sv/2026.10.23-2123-p37w8.md`. One flat file per chat, named by itself, so every editor tab reads differently. The task's title is the file's H1, not part of the name. Drafts and probes go to `/tmp` or the harness scratchpad, files that must persist into the project's `scripts/` (`agent.C5`); there is no sibling folder per session (superseded: v2 D5 adds a side folder `<ss-stem>/` for files other chats read; drafts still go to the scratchpad).

**D3 · `<project>` = basename of the nearest folder holding `.git` (a folder or a file, so worktrees and submodules count), walking up from `workingPath` and stopping at `workingRoot`; no git folder or no `workingPath` → `_` (superseded by `14bcb49`: no git folder → the working path with other characters as `-`, `_` only without a `workingPath`).** Characters outside `[A-Za-z0-9._-]` become `-`. Survives a repo move (F12). A same-basename pair is told apart by the absolute repo path in the file's header (D6), never by encoding the path into the name.

**D4 · `<label>` = the optional `label` input, sanitized: Unicode folded to ASCII (`đ` → `d`), lowercased, spaces and underscores become `-`, every other symbol drops, at most 16 characters (`P37·W8` → `p37w8`, `Sửa lỗi` → `sua-loi`); empty or absent → 2 random base36 characters.** The label is the owner's name for the chat when the chat knows it (a window handle in the page title, a ClickUp task word); AkiMCP's description says only that, generically, and names no AIObox handle (`CLAUDE.md` § Stable core): AIObox's own guide tells its windows to pass the handle (D14). Time = the AkiMCP machine's local clock, the clock the owner reads, in the council-room format. If the minted name already exists (same minute, same label), 2 random base36 characters are appended. A label passed only on a later call does not rename a kept ss; the header carries the name instead. (v2 D7 raises the cut to 24 characters at a word boundary.)

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

**D6 · Format: Markdown state, not a RAW transcript.** The reader is the next agent, which needs state, not history (one Claude Code transcript here is 41.5 MB). For web chats no RAW writer exists inside AkiMCP (F13), and an open chat's text exists only in its host. The fixed shape v1 set here (H1, one header line with project, chat, start and transcript, then `## Goal`/`## State`/`## Next`/`## Decisions`/`## Open`/`## Files`) is replaced by v2 D1 and D2.

**D7 · One rule constant, `SS_STEP`, replaces `WORKING_FILE_STEP` in the description, the initialize instructions and `SHARED_WORK` (same three places, one constant, `pattern.A1`).** The trigger is an observable act, not a forecast (F1); the update is every acting turn, not "when a step finishes"; the report is a fixed token the owner can search for and see missing. The shipped text is `SS_STEP` in `scripts/rule-context-mcp.js`, settled against the tool-surface budget; v2 D9 adds the shape pointer, and v2 D3 replaces its handoff clause ("a handoff successor keeps the ss its letter names").

**D8 · `SHARED_WORK` lines follow the rename.** `scripts/rule-context-mcp.js:21` ("Drafts and notes go in that folder or /tmp") becomes the `SS_STEP` line alone, with no drafts clause: `/tmp` is outside AkiMCP's default folders and absent on Windows, so a chat told to use it could not write there, and `agent.C5` already says where drafts go (2026-10-24, after a ClickUp chat left its probe folder in its task folder). `:22` lists `CHANGELOG.md` and "an ss another session also writes" as the files everyone touches. `:24` reads: the successor reads the letter, the ss and the old chat, keeps writing that ss and takes over its Files list (superseded by v2 D3: the successor mints its own ss with `parent`). `test/rule-context.test.js:94` swaps the literal `$HOME/.aki/mcpsv/task/<slug>/working.md` for `ss=<path>` and `SS_STEP`'s report line.

**D9 · The write-time line becomes a fact, not an order (new, F6).** A `write_file` or `edit_file` of an ss path, or of a legacy `task/<slug>/working.md` (D12), ends with `ss file written: <absolute path>`; `SS_STEP` already says what the reply owes. Both path patterns live once, in a new `scripts/session-file.js` that `filesystem-mcp.js`, `rule-context-mcp.js` and `rule-gate.js` import (`pattern.A1`). (v2 D6 adds the shape check to the line.)

**D10 · Stale-file line on acting calls (council Q1, decided: build).** `withReceipt` adds an optional `ss` beside `receipt` on every acting tool (F14: one place), with no per-parameter description, because `SS_STEP` explains it and each description costs tool-surface budget on ~20 tools. `gate` strips `ss` with `receipt`; after the tool ran, when `ss` is a valid ss path and the call did not itself write that file, it appends one line: `ss: <absolute path> · not created yet` when the file is missing, `ss: <absolute path> · last written N min ago` when its mtime is 15 minutes or more behind (`SS_STALE_MS`). An invalid `ss` gets `ss: not an ss path, ignored`. A client with a cached schema sends no `ss` and nothing changes for it.
- Not per-client session tracking (`CLAUDE.md` § Session lifecycle): the server stores nothing; the chat carries its path like it carries its receipt, and the server reads one mtime from disk.
- The bet: models copy an argument they pass on every call (the receipt gate shows it holds), while a prose duty fades in a long chat. D11 measures whether the bet holds.
- Every line is a fact about a file, never an order (F6).

**D11 · The call log records the instrument (new).** Each gated call's log line in `tool-calls.jsonl` gains `ss` (`true` when a valid ss was passed) and `ssAge` (minutes since its last write, `-1` when missing), set in `scripts/tool-call-log.js`; no path is logged. `aki__akidevrule_context` lines gain `ssState` (`new`, `kept`, `ignored`, `unavailable`). This is the measurement the council's two-week gate lacked: the share of acting calls that carry an ss, and how stale those files run.

**D12 · Old `task/` folders stay where they are; the legacy match has a removal trigger.** Plans cite them by absolute path (`docs/plan/done/test-bare-run-isolation.md:3`), so moving them breaks every citation; no migration. The write-time line keeps matching `task/<slug>/working.md` while old threads still write there, and is deleted in the first release after which no `task/*/working.md` was modified for 30 days (`find <data dir>/task -name working.md -mtime -30` empty). `task-logs/` and `tasks.json` belong to `aki__task_start` and are untouched; moving session files to `ss/` ends the double meaning of "task".

**D13 · Harness sessions: Claude Code, agy, Codex (council N1, decided).** A harness that calls `aki__akidevrule_context` gets the same ss and the same rule, and puts its own transcript path on the header line (D6; v2: the `transcript` key), so a web chat and a Claude Code session hand over through one format. A native session that never calls AkiMCP is out of AkiMCP's reach; it has its own transcript and resume, and the reminders come from web chats (F5), so AkiDevRule gets no ss rule (no action).

**D14 · AIObox side (council Q2, decided), done in the aiobox repo in its own turn, zero AkiMCP code (`CLAUDE.md` § Stable core).**
- AIObox writes each window's transcript to its own data dir after every turn, not only when the window closes, and names that path for the window; the window puts it on its ss header line. It is the only place a live RAW of a web chat can come from, and AkiMCP never reads it.
- AIObox's guide (`op=state`) tells a window to pass its handle as `label` on its first `aki__akidevrule_context` call.
- The team roster (F16) is AIObox state, not a session: it moves from `~/.aki/mcpsv/task/aiobox-lead/working.md` § Team to a file in AIObox's own data dir, and each seat keeps its chat state in its own ss (superseded by v2 D4: a council seat's state is its room file).
- The live docs of F15 change in the same turn; frozen records stay.
- Handed over by a letter in `~/.aki/handoff/` for the AIObox lead when this plan's P1-P5 are merged.

**D15 · Limits, stated to the owner as they are.** "trả về full path" goes away by construction. "nhớ ghi" becomes visible (a missing `ss:` line in a reply, a stale line in tool results) and is measured (D11), but on a web chat the model stays the only writer; a chat whose host compacts away both the rule and the path starts a new ss on its next context call. The live AIObox transcript (D14) is the fallback for that case.

### Rejected

| Option | Why not |
|---|---|
| RAW jsonl instead of a state file | no writer inside AkiMCP for web chats (F13); an open chat's text exists only in its host; the next agent needs state, not 40 MB of history. Harness transcripts are linked from the header instead |
| A tool-call slice jsonl beside the ss | neither the RAW the owner described nor state; a third format with no reader |
| Claude Code's path encoding (`-Volumes-DEV-pj-aki-mcp-sv`) as the project key | splits history when a repo moves (F12), lossy (`.` and `/` both become `-`), leading `-` reads as an option to `ls`/`rm`, three times longer (still rejected for git repos; `14bcb49` adopted it for a folder without git) |
| A folder per session (`ss/<x>/ss.md`) or a sibling drafts folder | every tab reads `ss.md`; no run needed the folder (the sibling folder was reversed by v2 D5) |
| A model-chosen slug inside the name | the model builds the path again (F2) |
| The ss tool creating the file or folder | breaks `readOnlyHint` on the rule loader and makes empty files for Q&A chats; the header reports the folder state instead (D5) |
| A call counter per chat for the stale line | per-chat state in the server, against `CLAUDE.md` § Session lifecycle; file age needs none |
| Moving the 64 `task/` folders into `ss/` | breaks every absolute citation in plans (D12) |
| A ss rule in AkiDevRule for native sessions | they have their own transcript; the reminders come from web chats (D13) |
| Naming AIObox handles in AkiMCP's `label` description | `CLAUDE.md` § Stable core; AIObox's guide says it (D14) |

### Steps

- [x] **P1 · `scripts/session-file.js`** (done 2026-10-24; `sessionFor` also lives here, the D5 header line and the `unavailable` check) (one responsibility: name, check and age an ss path): `projectKey(workingPath, workingRoot)`, `sanitizeLabel(label)`, `mintSessionPath({ project, label, now })` with the collision suffix, `acceptSessionPath(p)`, `SS_FILE` and `LEGACY_WORKING_FILE` patterns, `ssAge(p, now)`. Tests in a new `test/session-file.test.js` (first import `./setup.js`): git folder found, `.git` as a file, no git → `_`, non-ASCII label, 16-character cut, collision suffix, a path outside `ss/` or with `..` refused, Windows-style separators accepted.
- [x] **P2 · mint and keep in `aki__akidevrule_context`** (done 2026-10-24) (`scripts/rule-context-mcp.js`): `ss` and `label` inputs, the D5 header line and `structuredContent.ss`; the receipt unchanged by either input. Tests in `test/rule-context.test.js`: mint, keep on re-call, ignored input, folder missing, data dir outside the roots, receipt identical with and without `ss`.
- [x] **P3 · the rule** (done 2026-10-24) (`scripts/rule-context-mcp.js`): `SS_STEP` replaces `WORKING_FILE_STEP` in its three places; `SHARED_WORK` lines 21, 22, 24 per D8; `test/rule-context.test.js:94` literals; the description stays the one tool allowed past the 700-character cap (`test/tool-surface.test.js`).
- [x] **P4 · write-time line and stale line** (done 2026-10-24; measured `RAISES` entry 1054 chars, 35374 → 36428): `scripts/filesystem-mcp.js` uses `session-file.js` and prints the D9 fact line for ss and legacy paths (tests in `test/filesystem-mcp.test.js`, which has none for this line today); `scripts/rule-gate.js` `withReceipt` adds `ss` and refuses a tool that already has an input named `ss`, `gate` strips it and appends the D10 line (tests in `test/rule-gate.test.js`: missing file, fresh file, stale file, the call that writes the ss itself gets no line, invalid `ss`); `scripts/tool-call-log.js` fields per D11 (`test/tool-call-log.test.js`); one measured `RAISES` entry in `test/tool-surface.test.js` for the `ss` parameter.
- [x] **P5 · docs and record** (done 2026-10-24; the entries went into the open `[3.1.0]` block, see Status): `docs/arch/rule-context-delivery.md` (the description's last step, the header line, `SHARED_WORK`; stamp rewritten), `docs/feat/tools.md:11` (the write-time line; stamp rewritten), `CHANGELOG.md` `[Unreleased]` (`Added`: the minted ss and the stale line; `Changed`: the rule, the neutral write-time line), `docs/index.md`. Run `npm test` in full, `release_lint.py --latest .`, and the `CLAUDE.md` § Release process drift check.
- [x] **P6 · live check**: restart AkiMCP; from one web chat (ClickUp Brain) and one AIObox window, one multi-step task each: the first context call shows `· new`, a re-call with `ss=` shows `· kept`, the first write lands in one call, every acting reply ends with the `ss:` line, an acting call 15 minutes after the last write shows `last written N min ago`, and `tool-calls.jsonl` carries `ss`, `ssAge`, `ssState`. Progress 2026-10-24: over `scripts/stdio.js` (the 3.1.0 code in-process, an MCP SDK client) every step passed: `· new · folder ready`, `· kept · not created yet`, an acting call `· not created yet`, the write in one call with `ss file written`, `last written 16 min ago` with the file's time set back. AkiMCP restarted on 3.1.0 at 12:45Z (AIObox respawned it in 4 s, Cloudflare tunnel up): the first live context call returned `ss … state new`, and `tool-calls.jsonl` carries `ssState` for a claude.ai chat and a `node` web client. Left: `· kept` and the acting-call lines from a client whose tool list was loaded after the restart (a claude.ai chat opened before it keeps the old schema, without `ss` or `label`). Seen live by 14:20Z: 21 context calls (20 `node` web clients, 1 claude.ai), every one `ssState: new`, none `kept`, no ss file written yet; a ClickUp Brain chat (AIObox P36·W52) ends its acting replies with the `ss:` line, naming the old `working.md` its owner told it to keep. After the 14:35Z restart, by 15:05Z: `ssState: kept` on 3 re-calls (a `node` web client, WorkBuddy), ss files written by the chats themselves under `ss/aiobox/`, `ss/Aki-Dev-Sync/`, `ss/_/`, 54 acting calls carrying `ss` (`ssAge` up to 22 min, so the `last written N min ago` line was served), and the council's ClickUp seats end acting replies with the `ss:` line. Passed.
- [x] **P7 · AIObox turn** (D14): handoff letter to the AIObox lead (written 2026-10-24: `/Users/aki/.aki/handoff/aiobox-lead-from-akimcp-ss-2026-10-24.md`); AIObox ships the live transcript, the `label` guide line, the roster move and the F15 doc edits in its own release. Recorded 2026-10-26 as handed over to AIObox; no AkiMCP work remains in P7.
- [x] folded into v2 P9 on 2026-10-28 · **P8 · close**: the plan moves to `docs/plan/done/` when P1-P6 shipped in a release; P7 is AIObox's and is recorded here as handed over; D12's legacy match is removed in the first release after its 30-day trigger.

## v2 — decided 2026-10-25

Keeps every v1 decision except those it marks: v1 D6 (shape) → D1, D2; the handoff clause of v1 D7/D8 → D3; the seat clause of v1 D14 → D4; v1 D2's "no sibling folder per session" → D5. v1 D3's non-git `_` is superseded by `14bcb49` (P2): "named after the working path with other characters as `-` (`/Volumes/DEV/labs` becomes `-Volumes-DEV-labs`) … a chat with no working path still uses `_`" (`CHANGELOG.md` [3.1.0], `docs/feat/session-file.md`). P1–P7 shipped in 3.1.0: `14bcb49` whole-word labels and the no-git key, `99047e1` the shape line and `ssShape`, `docs/feat/session-file.md`, `docs/feat/tools.md` § Open sessions. How it was decided: the whole rule corpus read (`/akirule full`), then a self-run deep-think of 2 to 4 rounds per aspect below (`think.B1`–`B5`), against the 30 ss files written in the first 24 hours of v1 and the session stores of Claude Code and Antigravity CLI on this machine.

### Facts (measured 2026-10-25 02:30 on this machine)

| # | Fact | Source |
|---|---|---|
| F1 | 30 ss files in 24 h (this chat's excluded). 3 carry all six v1 headings (10%); 17 carry none (57%) and write `Goal: … State: …` inline or free prose | `grep -c '^## (Goal\|State\|Next\|Decisions\|Open\|Files)' -r ~/.aki/mcpsv/ss` |
| F2 | 8 of 30 (27%) sit in `ss/_/` (no `workingPath` at mint), among them a whole tachnhac.com council: the project folder says nothing for a quarter of the files | `ls ~/.aki/mcpsv/ss/_` |
| F3 | The 16-character label cut lands mid-word in at least 7 names: `council-secretar`, `hands-council-cl`, `maker-aiobox-cou`, `aiobox-012-finis`, `council-aiobox-s`, `council-aiobox-0`, `p7-w360-t37-clic` | `scripts/session-file.js:39` `.slice(0, 16)` |
| F4 | About 18 of 30 are council seats, while each seat also keeps `<room>/<seat>.md`: one seat, two state files, and seat posts ending in `ss:` lines | pinned task `task-1792867992000` in `.akidevsync/notes.json`; aiobox `labs/providers/clickup.com/docs/research/agent-council-prompt-audit.md` § Amendments |
| F5 | Files grow as logs: 3 files stack two or three `## State (<time>)` sections; the largest is 11.6 KB, and its Goal section alone quotes the owner 7 times | `grep -c '^## State'`; `ss/aiobox/2026.10.25-0002-clickup-council.md` |
| F6 | Finished or abandoned chats read as open: `ss/aki-mcp-sv/2026.10.24-1812-brain.md` § Next 1–5 still say "NOT DONE" though commits `288dfce`, `e1af498`, `7a0cbf1` and tag `3.1.0` exist (Claude Code did them and never wrote that file); `ss/akimcp.top/2026.10.25-0125-m6.md` step 4 waits on a council room that was cancelled at 02:03 | `git log`, `ss/akimcp.top/2026.10.24-2253-akimcp-top-31.md` § Run 3 |
| F7 | One effort spreads over four stores with no link back: akimcp.top 3.1.0 lives in `task/akimcp-top-3-1-0-web/working.md` (the brief), two ss files, `~/.aki/handoff/akimcp-top-31-run3.md` and a council room; the successor wrote into the predecessor's ss and the m6 ss was left behind | the four files |
| F8 | The legacy `task/` folder is still used for new durable artifacts (openers, briefs, probe scripts), 70 folders, because v1 gave a chat no place for files other chats must read | `ls ~/.aki/mcpsv/task`; `task/aiobox-council-clickup/opener-012-ship-cont-v4.1.md` |
| F9 | `~/.aki/handoff/` holds 319 files, AIObox chat-id letters and agent-to-agent letters mixed, none of them linked from an ss header | `ls ~/.aki/handoff` |
| F10 | The v1 rule asks for "goal in the owner's words", and chats paste whole messages; the owner reads only the last reply ("tôi chỉ có thời gian đọc tin nhắn cuối cùng", clickup-council ss § Goal) | `scripts/rule-context-mcp.js` `SS_STEP` |

### What the two harnesses do (read on disk 2026-10-25)

| Harness | Store | What v2 takes from it |
|---|---|---|
| Claude Code 2.1.310 | `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`: append-only events, each with `uuid`/`parentUuid`, `cwd`, `gitBranch`, `version` and a human slug (`tender-roaming-candle`); bulky tool output offloaded to `<uuid>/tool-results/*.txt`; at compaction a `compact_boundary` event plus one summary message that is **written fresh**, with fixed parts (the user's requests verbatim and numbered, constraints to keep, rules loaded, state, what the final report must include) and the path of the full transcript; plan mode writes `plans/<slug>.md` | state is rewritten, history is appended, and the two never share a section; numbered requests, not pasted messages; an obligations part; a pointer to the raw record; a same-named folder beside the file for bulk |
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/<uuid>/`: named artifacts (`plan-agy-panel-ux.md`) each with a `.metadata.json` sidecar `{summary, updatedAt, userFacing}`, `scratch/`, `.system_generated/logs/transcript.jsonl` in 100 KB chunks and `steps/<n>/output.txt`; one index `conversation_summaries.db` with `title`, `status`, `step_count`, `workspace_uris`, `parent_conversation_id`, `nesting_depth`, `last_user_input_time` | machine-readable status and parent per conversation, kept apart from prose; an index that answers "what is open" without reading every file; artifacts in the conversation's own folder |

Neither lets the model choose the path, and neither appends state: both keep one rewritten summary and one append-only log.

### Decisions

**D1 · Frontmatter carries the machine fields, the body carries the prose.** First lines of every ss, one key per line (`docs.C3`: never merged):

````markdown
---
status: active
repo: /Volumes/DEV/pj/aki-mcp-sv
chat: P37·W24 · ClickUp Brain mcp01 · <chat URL or id>
started: 2026-10-25 01:25
parent: none
successor: none
room: none
plan: none
transcript: none
---
````

`status` is one of `active` · `waiting` (on the owner or another seat; `## Now` says on what) · `handed-off` (`successor` names the next ss) · `done` · `abandoned`. `repo` is the truth for the project; the folder under `ss/` is only where the mint put the file (F2), so a file in `_` that later gets a `repo` is grouped by that. `parent`, `successor`, `room`, `plan` and `transcript` are absolute paths or `none`. Because: F6, F7; agy's index fields. Rejected: a sidecar `.json` per ss (two files to keep in step, agy pays that because its artifacts are many); a server-written database (AkiMCP keeps no per-chat state, `CLAUDE.md` § Session lifecycle).

**D2 · A fixed body: state rewritten, history appended.**

````markdown
# <task title, at most 80 characters>

## Now
<at most 5 lines, rewritten every acting turn: where it stands, what waits on whom, the one next step>

## Asked
1. 01:22 <the owner's decisive words, one line, quoted> (<what it means if not obvious>)

## Next
- [ ] <step>

## Decisions
- Decided: X · because Y · rejected Z · reopen if W

## Open
- N1 <item, its weight, what closes it>

## Files
- <absolute path> (<commit hash when committed>)

## Log
- 01:55 <what this turn changed, one line>
````

`## Now`, `## Next`, `## Open` are rewritten in place each acting turn; a finished step leaves `## Next` the turn it is reported and survives only as its `## Log` line; `## Log` is the only section that grows, one line per acting turn. `## Asked` numbers each order with its time and keeps only the decisive words (F10); the whole message stays in the chat or transcript, which `transcript` points to. `## Open` uses `agent.A4` codes. Budget: everything above `## Log` fits about 4 KB; past that the chat moves detail into the plan doc or the artifact folder (D5) and links it. Because: Claude Code's split (state rewritten, transcript appended), F1, F5, F10. Rejected: keeping v1's free shape and asking harder in the rule text (F1 shows the rule alone holds in 10% of files); several `## State (<time>)` sections (the reader cannot tell which one is true).

**D3 · One writer per ss; a handoff is a chain, not a shared file.** A chat writes only its own ss. A successor mints its own, with `parent: <old ss>`; the old chat (or the successor, once, if the old chat cannot) sets the old file's `status: handed-off` and `successor: <new ss>`. A letter in `~/.aki/handoff/` is optional and only points at the ss; it never restates it (F9). This reverses v1's "a handoff successor keeps the ss its letter names". Because: F6 and F7 (two writers on one file left both stale), Claude Code's one log per session id. Rejected: one ss per effort shared by every chat (no attribution, races, and the reader cannot tell which chat wrote a stale line).

**D4 · Council seats keep state in the room, not in ss.** Inside an `/akiflow` council room the seat file `<room>/<seat>.md` is that chat's session file; the seat mints no ss and its thread posts carry no `ss:` line; the room's lead (or the owner's chat that opened it) puts the room path in its own ss `room:` field. The work is the pinned task `task-1792867992000` (its steps a and b now, c only if its E9 measurement fails); v2 adopts it and does not restate it. Because: F4; the room format belongs to AkiDevRule's akiflow, not to AkiMCP (`CLAUDE.md` § Stable core is about AIObox and does not block this; the reason is a cross-client AkiDevRule mechanism).

**D5 · A chat may keep a folder beside its ss for files other chats read.** `<data dir>/ss/<project>/<ss name without .md>/` holds briefs, openers, letters, transcripts copied in, anything a later chat must read; drafts and probes still go to the harness scratchpad or the system temp folder (`agent.C5`). The folder is created by the chat when first needed, never by AkiMCP; `acceptSessionPath` and the index ignore it. Because: F8 (v1's "no run needed the folder", D2 of v1, was disproved within a day), Claude Code's `<uuid>/` beside `<uuid>.jsonl`, agy's per-conversation folder. This gives `task/` no new writers, so v1's D12 removal trigger can fire.

**D6 · AkiMCP checks the shape when an ss is written, and says what is missing as a fact.** The write-time line becomes `ss file written: <path> · shape ok` or `· shape: missing status, ## Now` (frontmatter keys from D1, headings from D2, nothing else), produced by one parser in `scripts/session-file.js`; never a refusal, never an imperative (v1 F6). `tool-calls.jsonl` gains `ssShape` (`ok` or the count missing) on ss writes. Because: the rule text alone failed (F1); a fact on the write the model just made is the cheapest place it is read; the log makes D9 measurable. Rejected: a new `aki__ss_write` tool with fields (tool-surface cost on every client, one more call to forget, harder for the owner to read); refusing malformed writes (loses the chat's state to enforce a format).

**D7 · Labels keep whole words.** `sanitizeLabel` allows 24 characters and cuts at the last `-` within them (`council-secretary-tachnhac` → `council-secretary`); unchanged otherwise. Because: F3. Existing names are not renamed (v1 D12 logic: paths are cited).

**D8 · The open-session view is a search, not a new tool.** `docs/feat/tools.md` gains one guide line (rung 2 of `CLAUDE.md` § Native command, then guide, then tool): open sessions are `aki__search_content` with query `^status: (active|waiting)` and path `<data dir>/ss`; a file `active` whose last write is older than 24 h is reported as stale by the reader, never changed by anyone but its chat or the owner (`agent.B5`: no auto-classification). AkiDevRule's `/akiopen` gains the same surface in its own repo and turn (its source is `/Volumes/DEV/AkiDevRule/skills/`), listing a project's open ss by `repo:`. Because: agy's index answers "what is open" (the owner's own question today), and frontmatter makes a grep that index.

**D9 · `SS_STEP` grows by the shape pointer only.** The rule text adds, within the tool-surface budget (`test/tool-surface.test.js` `RAISES`): start the file with the frontmatter and headings of `docs/feat/session-file.md`, rewrite `## Now` each acting turn, append one `## Log` line; set `status` when the chat ends or hands off. The full template lives once, in the new `docs/feat/session-file.md` (current state, stamped, `docs.A4`), which also absorbs v1 D2–D6 and D9–D11 as current behavior; the handoff sentence of `SHARED_WORK` follows D3.

**D10 · Language.** Keys and headings stay English (they are parsed); prose is the chat's reply language, the owner's quotes stay verbatim.

### Rejected (beyond the per-decision lines)

| Option | Why not |
|---|---|
| Wait for v1's 14-day measurement before any change | the owner's complaint and F1–F7 are the signal already; every v2 change is a two-way door (old files stay valid, the parser only reports) |
| RAW transcript inside the ss | v1's reasoning holds: the reader needs state; `transcript:` links a harness's own log, AIObox's live transcript (v1 D14) fills it for web chats |
| Moving or rewriting the 30 v1 files to the new shape | their paths are cited in plans, letters and replies; a chat that keeps one rewrites it in the new shape on its next write, the parser reports the rest |
| AkiMCP setting `status` itself (on idle time, on handoff) | the server cannot tell chats apart (v1 F13) and must not guess whether work is finished |

### Steps

- [x] file exists, linked from `docs/arch/rule-context-delivery.md` and `docs/index.md` · **P1 · `docs/feat/session-file.md`** (stamp `updated <date> · <last released version>`): path, mint and keep (v1 D2–D5), frontmatter and body (D1, D2, D10), one writer and chains (D3), council seats (D4), the side folder (D5), the write-time and stale lines (v1 D9–D10, D6), the call-log fields (v1 D11, D6), the open-session search (D8). `docs/index.md` entry; `docs/arch/rule-context-delivery.md` links it instead of restating the shape.
- [x] **P2 · `scripts/session-file.js`**: one `LABEL_MAX = 24` builds the word cut (`sanitizeLabel`, D7) and `SS_NAME`, so a kept 24-character name is accepted back; no `.git` on the walk keys the folder by the working path as Claude Code does (`/Volumes/DEV/labs` → `-Volumes-DEV-labs`), `_` only without a `workingPath` (B3). Tests in `test/session-file.test.js`: whole-word cut, a word ending at 24, one long word cut at 24, a 24-character name accepted, the no-`.git` key.
- [x] **P3 · write-time line and log** (`scripts/session-file.js` `shapeOf(text)` returning the missing frontmatter keys and headings, with tests: shape ok, each missing key or heading named, a v1 file reported, not refused; `scripts/filesystem-mcp.js`, `scripts/tool-call-log.js`): D6 fact line on ss writes (legacy `task/*/working.md` writes keep the v1 line), `ssShape` field. Tests in the existing `test/filesystem-mcp.test.js` and `test/tool-call-log.test.js`.
- [x] literals in `test/rule-context.test.js` (3.1.0 gate room) · **P4 · rule text** (`scripts/rule-context-mcp.js`): `SS_STEP` per D9, `SHARED_WORK` handoff line per D3; literals in `test/rule-context.test.js`; one measured `RAISES` entry if the surface grows.
- [x] `task-1792867992000` a, b done; `task-1792873763582` done; c waits on E9 · **P5 · council seat** (D4): run pinned task `task-1792867992000` a and b; c only on its own trigger.
- [x] **P6 · guide line** (D8) in `docs/feat/tools.md` (stamp rewritten); a letter for the AkiDevRule session naming the `/akiopen` surface, in `~/.aki/handoff/`. Done 2026-10-26: the guide line is `docs/feat/tools.md` § Open sessions (stamp `updated 2026-10-25 · v3.1.0`); the letter is `~/.aki/handoff/akidevrule-from-akimcp-akiopen-open-sessions-2026-10-26.md`.
- [x] **P7 · record**: `CHANGELOG.md` `[Unreleased]` (`Changed`: the shape line on writes, whole-word labels, the one-writer handoff; `Added`: `ssShape`), the `CLAUDE.md` § Release process drift check, `npm test` once with its log kept (`coding.B3`). Done 2026-10-26: `CHANGELOG.md` `[Unreleased]` holds the shape line, whole-word labels and the one-writer handoff under `Changed` and `ssShape` under `Added`; `CLAUDE.md` § Release process carries the drift-check bullet; `npm run test` 78/78 exit 0 on `490d193` (room hands #3, existing node_modules, not CI).
- [x] closed 2026-10-28 by live clients, no owner run (`coding.B3` rung 1): web chats (agent `node` behind Cloudflare, `~/.aki/mcpsv/tool-calls-2026-10-26.jsonl:1508,4160`) and Claude Code (`tool-calls.jsonl`, 3.2.0) write ss with `ssShape: "ok"`; handoff chains carry both ends (`ss/akimcp.top/2026.10.26-0436-ship-1160-solo.md` `handed-off` → `0453-ship-1160-postpush.md` with `parent`, and 5 more repos by 2026-10-28); the D8 search matches `^status: (active|waiting)`, so a `handed-off` file is never listed (`docs/feat/tools.md` § Open sessions) · **P8 · live check**: restart AkiMCP; one web chat and one Claude Code session each write an ss through two acting turns and a handoff to a successor: `shape ok` on both files, the old file `handed-off` with `successor`, the new one with `parent`, the D8 search lists only the successor. Also ticks `done/audit-tool-drift-oct25.md:161`.
- [ ] **P9 · close**, on or after 2026-11-09 (14 days after the 3.1.0 publish day): read `ssShape` across ss writes and count ss files of council seats (D4: E9 = 0); measure v1's Done when (the share of acting calls from web chats carrying `ss`, their `ssAge` spread, whether the owner still reminds); read v1 D12's trigger (`find <data dir>/task -name working.md -mtime -30` empty) — fired: `LEGACY_WORKING_FILE` and its tests go in the same close; not fired: this plan stays active until it fires. Then this file moves to `docs/plan/done/`. Seen 2026-10-28, for P9 to weigh: WorkBuddy writes with 4 keys missing (`ssShape: 4`, `tool-calls-2026-10-26.jsonl:4065,4088`); a successor path built by hand, `/Users/aki/.mcpsv/ss/…` (`ss/-Users-aki-.aki-agent-council-kinhdich-2026.10.27-2200-kinhdich-4-video/2026.10.28-0001-secretary.md:7`); a folder keyed by the ss folder itself, `ss/-Users-aki-.aki-mcpsv-ss-Aki-Dev-Sync/` (a `workingPath` pointed into the ss dir).

## Done when

- A chat that never hears the words "working.md", "ss" or "full path" from the owner ends every acting reply with an `ss:` line naming one absolute path, the same path across re-calls.
- A new ss written by any client starts with v2 D1's frontmatter, has v2 D2's headings, and its top 10 lines say where the work stands without reading further.
- The v2 D8 search lists every open chat and no finished one, and a handed-off chain is walkable both ways.
- Council seats mint no ss (pinned task E9 = 0).
- 14 days after the release, the owner reports whether he still reminds, and `tool-calls.jsonl` gives the share of acting calls carrying `ss` and their `ssAge` spread. Reopen D10's shape (threshold, wording) if under half of acting calls from web chats carry `ss`, or the owner still reminds.

## Risks and how they would show

| Risk (pre-mortem) | Weight | Shows as | Answer |
|---|---|---|---|
| Models skip `ss=` on acting calls, so the stale line never fires | medium | D11 share low | reopen D10: put the ss in the receipt refusal text, or tighten `SS_STEP` |
| Models skip the frontmatter like they skipped v1's headings | medium | `ssShape` not `ok` on most writes | the write-time line names the gap on the write itself; reopen with the shape in the context tool's output if under 70% after 14 days |
| Chats never set `done`, so the search fills with old `active` files | medium | many stale `active` files | the stale-by-age reading in v2 D8; `/akiopen` lists them as stale for the owner to close, nothing auto-closes |
| A host compacts away both the rule and the path, a second ss starts | low | two files one chat apart in `ss/<project>/` | the owner pastes the first path; D14's live transcript helps AIObox windows |
| The stale line reads as an order to a host firewall | low | a host halts on an AkiMCP result | the line is a fact by construction (D9, D10); reword, never add an imperative |
| The `ss` parameter or `SS_STEP` growth pushes `tools/list` over budget | low | `test/tool-surface.test.js` red | the parameter has no description and the template lives in the feat doc, the rule text only points; a measured `RAISES` entry |
| A user whose allowed folders exclude the data dir cannot write the ss | low | `ss: unavailable` line | the line names the fix (add the folder in the panel) |
| Two chats both write the same old file during a handoff | low | `## Log` lines from two chats | v2 D3: only the `status`/`successor` keys of the old file are touched by the successor, once |
