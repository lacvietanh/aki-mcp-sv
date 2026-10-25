# Session file (ss)

> updated 2026-10-25 · v3.1.0

One Markdown file per chat that holds where its work stands, so a successor, another client or the same chat after a compaction resumes without the owner re-explaining. AkiMCP names the file and reports on it; only the chat writes it. Decided in `plan/ss-session-file.md` (v1) and `plan/v2-ss-session-file.md` (v2).

## Path and name

- `<data dir>/ss/<project>/<YYYY.MM.DD-HHMM>-<label>.md`. `<data dir>` is `AKI_MCP_DATA_DIR`, else `~/.aki/mcpsv` (`mcpsv-dev` in dev), joined per OS (`scripts/userdata.js`). Time is the AkiMCP machine's local clock.
- `<project>`: basename of the nearest folder holding `.git` (folder or file, so worktrees and submodules count), walking up from `workingPath` and stopping at the allowed root, so the folder survives a repo move. With no `.git` on that walk, the working folder's real path with every character outside `[A-Za-z0-9._-]` turned into `-`, the key Claude Code uses (`/Volumes/DEV/labs` → `-Volumes-DEV-labs`, `C:\Users\x` → `C--Users-x`). No `workingPath` gives `_`. The frontmatter `repo:` is the truth for the project, the folder is only where the file was minted.
- `<label>`: the optional `label` input folded to ASCII, lowercased, spaces and underscores to `-`, other symbols dropped, at most 24 characters cut at the last `-` inside them (`council-secretary-tachnhac` → `council-secretary`), a label with no `-` cut at 24; empty gives 2 random base36 characters. A taken name gets 2 more.
- Existing names are never renamed: their paths are cited.

## Mint and keep

`aki__akidevrule_context` hands out the path and creates nothing (`scripts/session-file.js`). No `ss` input mints one; an `ss` input that is an ss path is kept, whether or not the file exists, so a re-call after a compaction or a rule change never starts a second file. The line follows the receipt line, outside the receipt hash, and the same values sit in `structuredContent.ss`:

| State | Line |
|---|---|
| minted | `ss: <path> · new · folder ready` or `· folder missing` (create the folder first) |
| kept | `ss: <path> · kept`, plus `· not created yet` when the file does not exist |
| input not an ss path | `ss: <path> · new (the ss given was ignored: not an ss path)` |
| data dir outside the allowed folders | `ss: unavailable · <data dir> is outside the allowed folders; add it under Folders in the panel` |

## Shape

Frontmatter first, one key per line, all keys always present:

```markdown
---
status: active
repo: /abs/path/of/the/repo
chat: <window handle or client> · <chat URL or id>
started: 2026-10-25 01:25
parent: none
successor: none
room: none
plan: none
transcript: none
---
```

- `status`: `active` · `waiting` (`## Now` says on whom) · `handed-off` (`successor` names the next ss) · `done` · `abandoned`.
- `parent`, `successor`, `room`, `plan`, `transcript`: absolute paths or `none`. `transcript` points at the harness's own log; the ss never holds a raw transcript.

Then a fixed body:

```markdown
# <task title, at most 80 characters>

## Now
<at most 5 lines: where it stands, what waits on whom, the one next step>

## Asked
1. 01:22 <the owner's decisive words, one line, quoted>

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
```

- `## Now`, `## Next` and `## Open` are rewritten each acting turn; a finished step leaves `## Next` and survives as its `## Log` line. `## Log` is the only section that grows, one line per acting turn.
- `## Asked` numbers each order with its time and keeps only the decisive words; the full message stays in the chat or its transcript.
- `## Open` uses the `N`/`Q`/`T` codes of `agent.A4`.
- Everything above `## Log` fits about 4 KB; beyond that, detail moves to the plan doc or the side folder and is linked.
- Keys and headings stay English (they are parsed); prose is the chat's reply language, owner quotes verbatim.

## One writer, chained handoffs

- A chat writes only its own ss.
- A successor mints its own ss with `parent: <old ss>`. The old chat sets its own `status: handed-off` and `successor: <new ss>`; when it cannot, the successor sets those two keys once and touches nothing else.
- A letter in `~/.aki/handoff/` is optional and only points at the ss.

## Council seats

Inside an `/akiflow` council room the seat file `<room>/<seat>.md` is the seat's session file: a seat mints no ss and its posts carry no `ss:` line. The chat that opened the room puts the room path in its own ss `room:` key.

## Side folder

`<data dir>/ss/<project>/<ss name without .md>/` holds files other chats must read: briefs, openers, letters, copied transcripts. The chat creates it when first needed; AkiMCP never does and ignores it when matching ss paths. Drafts and probes go to the harness scratchpad (`agent.C5`).

## What AkiMCP reports

All of these are facts about a file, never orders.

- **On a write**: a `write_file` or `edit_file` of an ss ends with `ss file written: <path> · shape ok`, or `· shape: missing <keys and headings>` naming each missing frontmatter key and heading. The write always succeeds. A legacy `task/<slug>/working.md` write keeps `ss file written: <path>` (`scripts/filesystem-mcp.js`).
- **On an acting call**: acting tools take an optional `ss` beside `receipt`. When the call did not write that file itself, the result ends with `ss: <path> · not created yet` (file missing) or `ss: <path> · last written N min ago` (15 minutes or more behind); an invalid `ss` gets `ss: not an ss path, ignored` (`scripts/rule-gate.js`).
- **In the call log** (`tool-calls.jsonl`, `scripts/tool-call-log.js`): gated calls carry `ss` (a valid ss was passed) and `ssAge` (minutes since its last write, `-1` when missing, `null` on any other read error); context calls carry `ssState` (`new`, `kept`, `ignored`, `unavailable`); ss writes carry `ssShape` (`ok` or the count missing). No path is logged.

## Finding open sessions

No tool: `aki__search_content` with query `^status: (active|waiting)` and path `<data dir>/ss` lists the open chats (guide line in `tools.md`). A file still `active` whose last write is more than 24 hours old is reported as stale by whoever reads it; only its chat or the owner changes it.

## Legacy

`<data dir>/task/<slug>/working.md` files stay where they are, since plans cite them. The write-time match for them is removed in the first release after which none was modified for 30 days. `task-logs/` and `tasks.json` belong to `aki__task_start`.

## Limits

On a web chat the model is the only writer: AkiMCP cannot tell chats apart (`CLAUDE.md` § Session lifecycle) and never sets `status` itself. A chat whose host compacts away both the rule and the path starts a new ss on its next context call.
