# ss v2: one shape, one writer, a status, and a chain the owner can follow

Status: decided 2026-10-25, P1–P5 done (P2 `14bcb49`, P3 `99047e1`, P4 literals and P5 notes sync in the 3.1.0 gate room); open: P6 letter, P7, P8 live check (owner's hands), P9. Builds on [`ss-session-file.md`](ss-session-file.md) (v1, shipped in 3.1.0, tagged locally, not yet pushed or published); v2 replaces v1's D6 (shape), the handoff line of D7/D8 and the seat clause of D14, and keeps every other v1 decision. Ships inside the 3.1.0 release itself, not a version after it (owner 2026-10-25: "làm cái này trong đợt 3.1 luôn … gom vào 3.1 luôn cho nó đáng"): 3.1.0 is tagged locally but not yet pushed or published, so `release.A5` puts v2 into the open 3.1.0 rather than a version on top of it — its entries go into the `[Unreleased]` block that becomes 3.1.0 at `/akiship`, and must be done before shipping. How it was decided: the whole rule corpus read (`/akirule full`), then a self-run deep-think of 2 to 4 rounds per aspect below (`think.B1`–`B5`), against the 30 ss files written in the first 24 hours of v1 and the session stores of Claude Code and Antigravity CLI on this machine.

## Goal

Owner 2026-10-25 02:16, verbatim: "cấu trúc ghi file phiên quá mức lộn xộn, cẩu thả, kém khoa học … học hỏi cách mà claude, agy tạo phiên và giữ phiên, làm việc với đống file phiên,.. cho chuẩn, đúc kết mọi tinh túy, gom thành docs/plan mới, chuẩn ss-v2 (bản đầu đang không ổn, chưa ổn)" · same message, of the m6 chat's ss: "nó nói quá dài dòng".

Goal chain: every ss has the same small shape → the owner (who often reads only the last message) and any successor agent re-orient from the top 10 lines → no chat's work is lost or found stale across compaction, handoff, council or a move to another client, and nobody has to remind or hunt.

## Facts (measured 2026-10-25 02:30 on this machine)

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

## What the two harnesses do (read on disk 2026-10-25)

| Harness | Store | What v2 takes from it |
|---|---|---|
| Claude Code 2.1.310 | `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`: append-only events, each with `uuid`/`parentUuid`, `cwd`, `gitBranch`, `version` and a human slug (`tender-roaming-candle`); bulky tool output offloaded to `<uuid>/tool-results/*.txt`; at compaction a `compact_boundary` event plus one summary message that is **written fresh**, with fixed parts (the user's requests verbatim and numbered, constraints to keep, rules loaded, state, what the final report must include) and the path of the full transcript; plan mode writes `plans/<slug>.md` | state is rewritten, history is appended, and the two never share a section; numbered requests, not pasted messages; an obligations part; a pointer to the raw record; a same-named folder beside the file for bulk |
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/<uuid>/`: named artifacts (`plan-agy-panel-ux.md`) each with a `.metadata.json` sidecar `{summary, updatedAt, userFacing}`, `scratch/`, `.system_generated/logs/transcript.jsonl` in 100 KB chunks and `steps/<n>/output.txt`; one index `conversation_summaries.db` with `title`, `status`, `step_count`, `workspace_uris`, `parent_conversation_id`, `nesting_depth`, `last_user_input_time` | machine-readable status and parent per conversation, kept apart from prose; an index that answers "what is open" without reading every file; artifacts in the conversation's own folder |

Neither lets the model choose the path, and neither appends state: both keep one rewritten summary and one append-only log.

## Decisions

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

## Rejected (beyond the per-decision lines)

| Option | Why not |
|---|---|
| Wait for v1's 14-day measurement before any change | the owner's complaint and F1–F7 are the signal already; every v2 change is a two-way door (old files stay valid, the parser only reports) |
| RAW transcript inside the ss | v1's reasoning holds: the reader needs state; `transcript:` links a harness's own log, AIObox's live transcript (v1 D14) fills it for web chats |
| Moving or rewriting the 30 v1 files to the new shape | their paths are cited in plans, letters and replies; a chat that keeps one rewrites it in the new shape on its next write, the parser reports the rest |
| AkiMCP setting `status` itself (on idle time, on handoff) | the server cannot tell chats apart (v1 F13) and must not guess whether work is finished |

## Steps

- [x] file exists, linked from `docs/arch/rule-context-delivery.md` and `docs/index.md` · **P1 · `docs/feat/session-file.md`** (stamp `updated <date> · <last released version>`): path, mint and keep (v1 D2–D5), frontmatter and body (D1, D2, D10), one writer and chains (D3), council seats (D4), the side folder (D5), the write-time and stale lines (v1 D9–D10, D6), the call-log fields (v1 D11, D6), the open-session search (D8). `docs/index.md` entry; `docs/arch/rule-context-delivery.md` links it instead of restating the shape.
- [x] **P2 · `scripts/session-file.js`**: one `LABEL_MAX = 24` builds the word cut (`sanitizeLabel`, D7) and `SS_NAME`, so a kept 24-character name is accepted back; no `.git` on the walk keys the folder by the working path as Claude Code does (`/Volumes/DEV/labs` → `-Volumes-DEV-labs`), `_` only without a `workingPath` (B3). Tests in `test/session-file.test.js`: whole-word cut, a word ending at 24, one long word cut at 24, a 24-character name accepted, the no-`.git` key.
- [x] **P3 · write-time line and log** (`scripts/session-file.js` `shapeOf(text)` returning the missing frontmatter keys and headings, with tests: shape ok, each missing key or heading named, a v1 file reported, not refused; `scripts/filesystem-mcp.js`, `scripts/tool-call-log.js`): D6 fact line on ss writes (legacy `task/*/working.md` writes keep the v1 line), `ssShape` field. Tests in the existing `test/filesystem-mcp.test.js` and `test/tool-call-log.test.js`.
- [x] literals in `test/rule-context.test.js` (3.1.0 gate room) · **P4 · rule text** (`scripts/rule-context-mcp.js`): `SS_STEP` per D9, `SHARED_WORK` handoff line per D3; literals in `test/rule-context.test.js`; one measured `RAISES` entry if the surface grows.
- [x] `task-1792867992000` a, b done; `task-1792873763582` done; c waits on E9 · **P5 · council seat** (D4): run pinned task `task-1792867992000` a and b; c only on its own trigger.
- [ ] **P6 · guide line** (D8) in `docs/feat/tools.md` (stamp rewritten); a letter for the AkiDevRule session naming the `/akiopen` surface, in `~/.aki/handoff/`.
- [ ] **P7 · record**: `CHANGELOG.md` `[Unreleased]` (`Changed`: the shape line on writes, whole-word labels, the one-writer handoff; `Added`: `ssShape`), the `CLAUDE.md` § Release process drift check, `npm test` once with its log kept (`coding.B3`).
- [ ] **P8 · live check**: restart AkiMCP; one web chat and one Claude Code session each write an ss through two acting turns and a handoff to a successor: `shape ok` on both files, the old file `handed-off` with `successor`, the new one with `parent`, the D8 search lists only the successor.
- [ ] **P9 · close**: 14 days after release, read `ssShape` across ss writes and count ss files of council seats; this plan and v1 move to `docs/plan/done/` together.

## Done when

- A new ss written by any client starts with D1's frontmatter, has D2's headings, and its top 10 lines say where the work stands without reading further.
- The D8 search lists every open chat and no finished one, and a handed-off chain is walkable both ways.
- Council seats mint no ss (pinned task E9 = 0).

## Risks

| Risk (pre-mortem) | Weight | Shows as | Answer |
|---|---|---|---|
| Models skip the frontmatter like they skipped v1's headings | medium | `ssShape` not `ok` on most writes | the write-time line names the gap on the write itself; reopen with the shape in the context tool's output if under 70% after 14 days |
| Chats never set `done`, so the search fills with old `active` files | medium | many stale `active` files | the stale-by-age reading in D8; `/akiopen` lists them as stale for the owner to close, nothing auto-closes |
| `SS_STEP` growth pushes `tools/list` over budget | low | `test/tool-surface.test.js` red | the template lives in the feat doc; the rule text only points |
| Two chats both write the same old file during a handoff | low | `## Log` lines from two chats | D3: only the `status`/`successor` keys of the old file are touched by the successor, once |
