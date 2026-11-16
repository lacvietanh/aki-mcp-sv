# ss project folder: the real project, from any path inside it

Status: done 2026-11-15. P1–P3 done 2026-11-04, D2 revised 2026-11-06 (P2b), P4 closed 2026-11-15 by reading the flow, not run live; released in 4.2.0 (`CHANGELOG.md` [4.2.0] § Changed). Written on v4.1.0. Spec it changed: [`feat/session-file.md`](../feat/session-file.md) § Path and name, § Mint and keep. Code: `scripts/session-file.js` (`projectKey`, `gitWorkingTree`, `sessionFor`).

Related, not a pair: aiobox `docs/plan/projects.md` is a separate future feature (Projects in AIObox), kept as context only. Nothing here waits on it. The reason for this plan is the ss of every client, not AIObox (`CLAUDE.md` § Stable core).

> Decided (2026-11-06, chat P54·W8, default from coordinator P14·W102 after the owner's "tự quyết"): `aki__aiobox op=whoami` is how AIObox joins a window's ss to a project (projects.md step 4 adds `project` and `ss`; not built), the ss folder name is not a contract; the Sessions page keeps listing `ss/<project>/*.md` under its tolerant contract row; recorded in `feat/session-file.md` § Path and name; aiobox told as low-priority backlog · because the folder rule changed in 3.1.0 and again here (D1, D2), and projects.md plans to join the folder to Aki Dev Sync's `local_path` by basename · rejected: the folder name as a contract (freezes this plan's rule for every client, Stable core), AIObox resolving projects from ss paths itself · reopen if: AIObox needs project grouping before `whoami` carries it.

## Why: the ss folders on this machine, 2026-11-04

`~/.aki/mcpsv/ss` holds 34 project folders: 11 named after a repo (`aiobox`, `aki-mcp-sv`, `AkiDevRule`, …), 22 a working path in Claude Code's key, 1 `_`.

| What went wrong | Folders | Cause |
|---|---|---|
| One project folder without git split by subfolder | `-Volumes-DEV-labs-aki-media-motion-pj-akidevrule` and `…-akidevrule-v3.9`; `-Volumes-DEV-labs-aki-media-motion` and `…-motion-pj` | no `.git` on the walk, so the working folder itself keyed it |
| Home or a data folder as the working path | `-Users-aki`, `-Users-aki-.aki`, `-Users-aki-.aki-aiobox`, `-Users-aki-.aki-aiobox-providers-notion-macros`, `-Users-aki-.aki-mcpsv-ss-_`, `-Users-aki-.aki-mcpsv-ss-Aki-Dev-Sync` | the chat passed where it stood, and the key took it as a project |
| A council room as a project | 4 `-Users-aki-.aki-agent-council-…` | fixed in 4.1.0: no ss minted inside a room |
| No working path | `_` | the first call came before the chat knew its path; the next call with the path and the same `ss` kept `_` while the file did not exist yet (aiobox chat P32·W64, 2026-11-04) |

Read in the code: a linked worktree (`.claude/worktrees/<name>`) holds a `.git` file, so the old `projectKey` named `<name>`, not its repo.

## Goal

`<project>` names the project folder the working path is in, the same from any path inside it; a path in no project keeps its working folder's key. A chat whose first call had no path gets its ss under that folder as soon as it passes one. Never a name the chat types.

## Constraints

- Stable core: the reason is the ss of every client (rows above); AIObox tools untouched; no new tool, no new input.
- AkiMCP names and reports, it creates no file or folder; existing names are never renamed; `repo:` stays the truth for the project.
- This plan writes no marker; it reads them.

## Decisions

1. **Project folder** = the nearest folder at or above `workingPath`, up to the allowed root, that is a git working tree or holds Aki Dev Sync's `.akidevsync/project.json`. A linked worktree (`.git` file → `<repo>/.git/worktrees/<n>`, whose `commondir` is a `.git` folder) names its main working tree; a submodule names itself. Name: the folder's basename, sanitized as before.
2. **No project folder on the walk → the working folder in Claude Code's key, as since 3.1.0; no `workingPath` → `_`.** Revised 2026-11-06 from `_` with a reason line (2026-11-04, never committed): the pinned note task-1792873763582 (owner 2026-10-25, "phải học hỏi cách claude code và agy tạo phiên"; title: the ss folder follows the cwd like Claude Code and agy, even without git) rejects `_` for a chat that has a path, and the owner's 2026-11-04 words reject the path key for a project, not for a folder that is none. Measured 2026-11-06: 7 path-key folders are `/Volumes/DEV/labs/aki-media-motion/…` (no git, no `.akidevsync`), plus `labs-CVE` and `labs-docs`; `_` would merge them with home and every other loose chat.
3. **Re-mint an ss not created yet.** A kept ss under the ss folder that does not exist yet and sits in another folder than the project of the call's `workingPath` (when that is not `_`) becomes the same minute and label under that project (a taken name gets its 2 characters). State `moved`, line `ss: <new path> · moved from <old project>, not created yet · folder ready`. A file that exists, or a seat file, is kept: the chat already wrote it.
4. [-] Dropped: the project in the line tail and in `structuredContent.ss`. Nothing reads it; the folder name and `repo:` already say it.

> Decided: 1–3 · because the folder a project lives in is the only thing that is the same from every path inside it, a folder in no project is only itself, and an ss not created yet is not a session yet · rejected: below · reopen if: a client keeps calling with home as its path, the owner wants loose folders under `_`, or Aki Dev Sync's `name` as the folder name.

D1 marker: owner 2026-11-04, projects build on Aki Dev Sync's project config first (one ecosystem; a user coming from Aki Dev Sync feels at home). 28/28 projects in `~/.aki/devsync/projects.json` hold `.akidevsync/project.json`. D2 first decided in chat P32·W64 (owner 2026-11-04: "tự quyết"), revised in chat P54·W8 (owner 2026-11-06: decide, do not ask), D3 widened from `_` only to any other folder: same test, one rule.

Rejected:
- A `project` input, looked up by name: owner 2026-11-04, "truyền aiobox ra thẳng ss aiobox thì không hợp lý … cần nó detect được đúng thư mục dự án thực sự". A typed name is not a folder.
- The working folder's name as the fallback: two loose folders with one name would share a folder.
- `_` for every path in no project, with a reason line (this plan's D2 of 2026-11-04): it brings back the 2026-10-25 case and merges unrelated loose work in one folder. A loose folder still splits by subfolder (row 1: `aki-media-motion` holds neither git nor `.akidevsync`); git or an Aki Dev Sync project there joins it.
- `.akiproject`, a marker of our own: Aki Dev Sync's file already marks every registered project; a second marker is a second thing to keep.
- Aki Dev Sync's `name` as the folder name: it differs from the basename in 4 of 28 (`AkiDevRule` → `akidevrule`, `oscar-studio` → `oscar.studio`, …), so the ss already there and akiflow's council folders (`council_open.py`: `git rev-parse --show-toplevel` basename) would split from new ones.
- Reading `~/.aki/devsync/projects.json` in AkiMCP: the marker in the folder answers the question; the registry is for a project list (aiobox Projects, later).
- A tool description line "call again with workingPath and without ss": with D3 the call the description already asks for is right, and a line costs every client's tool list.
- A project id (uuid, root commit) in AkiMCP: nothing in the ss needs one.
- Moving an ss that exists: AkiMCP writes no file.

## Phases

- [x] P1 Tests first, in `test/session-file.test.js`, seen failing on the old code (`p32w64-ss-red`: worktree named `wt`, not `my-repo`; no `_` reason line): a linked worktree names its main repo; a submodule names itself; a subfolder of an Aki Dev Sync folder names it; no marker gives `_` and the line; an ss not created yet moves under a later `workingPath`'s project; a created one stays `kept`.
- [x] P2 Code: `projectKey` returns `_` without a project folder; `gitWorkingTree` maps a linked worktree to its main tree; `sessionFor` gains `moved` and the `_` reason. 3 mutations (no `commondir` mapping, no marker, no `_` guard) each turned a test red; `p32w64-ss-final`: session-file, rule-context and tool-call-log tests 25/25. Probed on this disk: aiobox and its subfolders → `aiobox`, `AkiDevRule/skills` → `AkiDevRule`, `Aki-Dev-Sync/src-tauri/src` → `Aki-Dev-Sync`, `/Volumes/DEV/labs`, `~/.aki/aiobox/…`, home → `_`.
- [x] P2b D2 revised 2026-11-06: `projectKey` falls back to the working folder's key again and the `_` reason line goes; the no-project assertions in `test/session-file.test.js` and `test/rule-context.test.js` are back to their 4.1.0 lines, seen failing on the 2026-11-04 code; session-file, rule-context, tool-call-log, rule-gate and filesystem-mcp tests 28/28.
- [x] P3 Docs: `feat/session-file.md` § Path and name, § Mint and keep (`moved` row), call-log states; `arch/rule-context-delivery.md`; `CHANGELOG.md` [Unreleased] § Changed; `docs/index.md`.
- [-] P4 Live, once the release that ships it is installed and AkiMCP restarted, from a web chat: a first call with no path, then path plus `ss` → `moved`; a subfolder of a repo → the repo; a worktree → its repo. Not run, closed 2026-11-15 by reading the flow (`coding.B3` rung 1): `aki__akidevrule_context` hands the call's `ss` and `workingPath` straight to `sessionFor` (`scripts/rule-context-mcp.js:63`), whose three cases are tested on real folders in `test/session-file.test.js` (worktree → its repo, subfolder → the repo, a path after a call with none → `moved`), and the tool's `ss:` line is tested in `test/rule-context.test.js`. The 2026-11-04 probe (no path → `_`, `/Volumes/DEV/labs` → `-Volumes-DEV-labs`) showed only that the running server was the installed 4.1.0; installing the release changes that, not the code.

Done when P4 is closed and `CHANGELOG.md` names the change (rewritten 2026-11-15 when the live run was dropped; it read: ticked, and named by the release that ships it).

## Open

- N1 closed 2026-11-15 with P4 (read the flow, not run).
- akiflow's council rooms `~/.aki/agent-council/<project>/`: `council_open.py` names `<project>` by the git toplevel basename, the same names as D1. A linked worktree there still names itself; mapping it to the main tree is akiflow's change, not this plan's.
