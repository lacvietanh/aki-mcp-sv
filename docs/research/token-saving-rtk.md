# How rtk saves tokens, and what `run_cmd` takes from it

Status: amended 2026-10-20

## Start time
2026-09-29, aki-mcp-sv 2.1.0 plus uncommitted work, macOS. rtk 0.47.0 installed; its repository read at HEAD `6d4b77e` (after v0.50.0).

## Initial purpose
`run_cmd` returned raw stdout up to 1 MB to a remote model, and the owner asked to learn from `rtk` (a CLI proxy that filters command output before it reaches an LLM, installed on this machine through a Claude Code hook) instead of inventing a truncation. Constraints at the time: a remote model reads only what an MCP tool returns and has no shell on the user's machine; the server must work on macOS, Linux and Windows and cannot require rtk; `docs/feat/security.md` § Design stance (convenience first) rules out complexity that annoys. First-principles goal: the model reads the fewest tokens that still carry what it needs, and anything left out can be recovered verbatim.

## Strategy
A read-only subagent studied rtk (help output, `gh api` on the repository, `rtk config`, measurements on this repo); the findings below were then spot-checked here before any design depended on them. Design was derived from the principles, not from rtk's command list.

## Checklist
- [x] Locate rtk's source of truth and pinned version
- [x] List every token-saving mechanism, with what each drops and how the full text is recovered
- [x] Measure raw against filtered output on this repo (git status/diff/log, ls, find, npm test, file read, grep)
- [x] Extract design principles, failure modes and MCP-specific constraints
- [x] Re-check here: rtk's false failure, the repository, the current `run_cmd` failure path, the roots that make a saved file readable
- [x] Implement and test the chosen subset; run it end to end through the MCP server

## Result

### R1 — What rtk is
A per-command dispatcher of lossy, command-aware filters, not one generic trick (repo: https://github.com/rtk-ai/rtk, `src/core/README.md`, `runner.rs`, `tee.rs`, `retriever.rs`, `cmds/git/git_cmd.rs`). A `rtk init` hook rewrites `git status` to `rtk git status`. Token counts everywhere are bytes/4, so its "82.4% saved" is an estimate.

### R2 — Mechanisms
| # | Mechanism | Drops | Recovery |
|---|---|---|---|
| M1 | Filter pipeline: strip ANSI, regex replace, short-circuit on a match unless an error pattern is present, line and head/tail caps, on-empty message | ANSI, boilerplate | via M9 |
| M2 | Per-command filters (git, ls, tree, find, grep, log, diff, test, err, npm, …) | command-specific fields | a flag such as `--no-compact` |
| M3 | Group by file or directory; cap matches (`grep_max_results=200`, `grep_max_per_file=25`) | repeated path prefixes, overflow | overflow is saved |
| M4 | Hide noise directories (`.git`, `node_modules`, `target`, `__pycache__`, `.venv`, `vendor`) | those entries | a printed hint |
| M5 | Field reduction: `ls -la` to mode, name, size; `git log` to hash, subject, relative date, author, body cut at 120 chars; `git status` to one line per file | owner, group, date, body | rerun raw |
| M6 | Diff compaction (`max_hunk_lines=100`, `max_lines=500`) | headers, context, hunks past the cap | `--no-compact` |
| M7 | A successful test run becomes a summary; only failures and the last 5 lines show | passing output | hint, only after a failure |
| M8 | `rtk read` defaults to full content; comment stripping is opt-in | nothing by default | n/a |
| M9 | Raw output kept (SQLite, or a file under the rtk data dir), by default only for failed commands of at least 500 bytes, max 1 MB and 20 files; a hint line points at it | nothing | the path or `rtk recall <hash>` |
| M10 | "Never worse than raw": if filtered text plus hint is longer, print raw | nothing | n/a |
| M11 | Exit code preserved | n/a | n/a |

### R3 — Measurements (rtk, this repo; chars, tokens ≈ chars/4)
| Command | Raw | rtk | Saved | Lost |
|---|---|---|---|---|
| `git status` (24 modified, 8 untracked) | 1648 | 1024 | 38% | hint prose |
| `git diff HEAD~15` (80 files) | 328801 | 85280 | 74% | whole hunks: 188 to 31 |
| `git log -n 30` | 18593 | 8228 | 56% | email, date, body past 120 chars |
| `ls -la` | 1288 | 367 | 72% | owner, group, date |
| `find . -type f` | 6634 | 1397 | 79% | repeated prefixes (names kept) |
| `npm test` | 4388 | 1318 | 70% | 6 PASS lines, banner |
| `grep -rn require scripts/` | 7983 | 7983 | 0% | nothing (guard printed raw) |
| `cat CHANGELOG.md` via `rtk read` | 98691 | 98691 | 0% | nothing |

The diff is the only large win in tokens (about 61k of the saving). Unmeasured: grep on large result sets, `rtk err`, `rtk summary`, the built-in TOML filters.

### R4 — Failure modes
1. `rtk test npm test` printed `[FAIL] FAILURES:` for a run that exited 0: it matched the word FAILED in log lines that passing tests print on purpose. A keyword filter can invent a failure. Reproduced here.
2. Diff compaction drops whole files, and its notice sits at the end of a long output.
3. `ls` silently drops dates and owners; its noise-directory filter was not applied uniformly.
4. The recovery hint is a local path or a local command; a remote model has no shell to use it.

### R5 — What this codebase had (verified here)
- `run_cmd` returned raw stdout up to 1 MB. Past 1 MB Node killed the process and the whole result was lost.
- On any non-zero exit it returned only stderr: `console.log("OUT-LINE"); console.error("ERR"); exit 3` came back as `ERR`. A failing `npm test` loses exactly the part that says what failed.
- `~/.aki` is always among the file tools' roots (`scripts/roots.js`), and `read_text_file` supports `head`/`tail`; `search_content` reaches the middle.

## Verification
- R1–R4 come from the subagent's reading and runs, dated 2026-09-29. Re-checked here: the repository exists, the false failure in R4.1 reproduces (exit 0, `[FAIL]` printed), R5 by running the code.
- **Not verified here:** rtk's numbers in R3 (taken from the subagent's runs), rtk's behavior at v0.50.0, grep savings on large result sets.
- The implemented subset was measured on this repo: `cat CHANGELOG.md` through `run_cmd` went from 98,266 to 19,901 chars (about 80%), with the raw text recovered through both `read_text_file` `tail` and `search_content`. Unit tests: `test/output-shape.test.js`, `test/shell-mcp.test.js`, `test/git-mcp.test.js`.

## Decision
**Principles kept:** lose nothing that cannot be recovered verbatim; announce a cut on the first line; never worse than raw; no keyword heuristics for pass/fail.

**Action** — landed in `scripts/output-shape.js` and its callers (`scripts/shell-mcp.js`, `scripts/git-mcp.js`); current behavior in [`feat/tools.md` § Output shaping](../feat/tools.md):
- Lossless cleaning of every `run_cmd` output: ANSI codes removed, carriage-return progress keeps its last redraw, runs of 3 or more identical lines collapse to one plus a count.
- Above about 20k characters the model gets the first 14k and last 6k at line boundaries, with the notice as line 1; the raw text is saved under `~/.aki/mcpsv/out/` (newest 20 kept, owner-only) and read back with the existing `read_text_file` and `search_content`. No new tool: a tool costs its schema on every turn.
- A failing command returns stdout, stderr and the reason (exit code, timeout, capture limit); capture limit raised to 32 MB so a large output is cut, not lost.
- `aki__git op=diff` shows whole files in order and names the omitted ones, with their size, at the top, to be re-requested with `file=`.

**No action, deliberately:**
- Field-dropping filters for `ls` and `git log`: they discard information, and `find_path` and the `git` tool already give compact reads.
- Noise-directory hiding and directory grouping: hiding what the model asked for is a silent loss; the saving was measured only for `find`, which `find_path` replaces.
- Test-runner summary: rtk's own heuristic misreports (R4.1); a correct one needs per-runner parsing, out of proportion to the gain.
- Comment stripping on file reads: rtk itself defaults it off, and the model may need the comments.

**Cross-references:** [`feat/security.md` § Design stance](../feat/security.md) (why complexity that annoys loses), [`feat/tools.md`](../feat/tools.md).
**Reopen if:** a measured session shows most tokens still come from command families this leaves untouched, or the chars-per-token estimate is contradicted by real usage.

## Amendments
- 2026-10-20 · § Decision, "Lossless cleaning": keeping only the last carriage-return redraw was not lossless — a lone `\r` inside a line (files with CR line endings, CR inside a field) dropped every record before it, unmarked (`id,name\r1,alice\r2,bob\n` came back as `2,bob\n`). Removed; lone `\r` is now kept. The principle "nothing destroyed that cannot be recovered verbatim" stands, measured against AkiDevRule's rtk research (`docs/research/rtk-output-loss-oct19.md` in that repo): the cut marker now reads `[output truncated: …]`, stderr is returned on success as well, and `search_content`/`find_path`/`git op=log` announce what they leave out. Current behavior: [`feat/tools.md` § Output shaping](../feat/tools.md).
