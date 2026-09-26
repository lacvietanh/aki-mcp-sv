# Tools — the local capability suite (anchored)

> updated 2026-09-25 · v2.1.0

The product's single purpose: give a remote web AI (claude.ai / ChatGPT / Grok / Gemini / Postman) a set of **local capabilities** on the owner's machine — a pair of hands reaching from the browser into the local filesystem, shell, and local agents. Every tool below exists to serve that anchor. This doc records **why each one is here** so a later subtraction audit does not mistake an anchored capability for redundant code and propose removing it.

## The suite

| Tool (MCP `name`) | Tools exposed | What it does | Who drives it |
|---|---|---|---|
| `filesystem` (native, `scripts/filesystem-mcp.js`) | `read_text_file`, `write_file`, `edit_file`, `create_directory`, `move_file`, `get_file_info`, `list_allowed_directories` | Read/write/edit files under the allowed roots, symlink-safe | The remote model, directly |
| `search` | `find_path`, `search_content` | Fast index-backed path + content lookup (no per-call `find`/`grep` spawn) | The remote model, directly |
> The third-party `@modelcontextprotocol/server-filesystem` package this replaced also exposed `list_directory`/`directory_tree`/`search_files`/`read_multiple_files`/`read_media_file` — dropped outright rather than prompt-banned, since `find_path`/`search_content` already supersede the listing/search family in practice and the rest had no evidence of real use (`docs/plan/done/2.0.0-improve.md` §7). Cheap to re-add if a real need shows up.
| `shell` | `run_cmd` | Run an allowlisted command as the user; read-only by default, write commands opt-in (`docs/plan/done/shell-allowlist.md`) | The remote model, directly |
| `agy_run` | `agy_run` | Delegate a whole task to an **Antigravity CLI agent** — local by default, or a named loopback worker running under a separate OS login/account context; default mode `plan`, default model `gemini-3.7-flash-medium` | The remote model delegates; a local agent reasons |
| `kiro` | `kiro_read` | Delegate a whole read-only task to a **local Kiro CLI agent**, hard-locked to `claude-sonnet-4.5`, `--trust-tools=fs_read` | The remote model delegates; a local agent reasons |
| `postman` (`scripts/postman-mcp.js`) | `postman_status` | Reports whether the `scripts/aki-pmcontrol/` daemon is running (own child or lab-started pid at `~/.aki/cdp-postman/daemon.pid`) and its `data.json`. Origin is a private internal lab; this tree holds the finished copy (except `package.json`, a `{"type":"commonjs"}` shim). Launch is a panel action (`POST /api/postman-launch`), not this tool and not boot. | The remote model, directly — read-only, no CDP in the tool |

## Two classes — and why the second is not redundant

**Direct primitives** (`filesystem`, `search`, `shell`) — the remote model calls them and does the reasoning itself.

**Agent arms / "hands"** (`agy`, `kiro`) — the remote model hands off a *whole task* to a **local agent** that reasons and uses its own tools locally, then returns a conclusion.

An audit that only pattern-matches capabilities will call `kiro_read` "redundant — the model already has `find_path`/`search_content`/`run_cmd`." **That is a misclassification and the arms must not be removed on that basis.** An arm is not a file-reader; it is agent delegation, and it buys three things a direct primitive cannot:

- **Offload multi-step local work** — a local model runs the investigate/read/synthesize loop against local files and returns a conclusion, instead of the remote model paying round-trips and context for every intermediate read.
- **Local trust scoping by mechanism** — `kiro` is locked to `fs_read`; `agy` defaults to `plan`, with broader modes requiring the main allowlist and, for routed workers, the worker's own startup allowlist. A prompt cannot widen either boundary.
- **Model/tier choice per task** — `agy` reaches a wide-context discovery tier; `kiro` is pinned to a specific Sonnet id for cost/behavior determinism.
- **Independent AGY account contexts when needed** — `agy_run(worker=...)` routes to a token-authenticated loopback worker. The AKIMCP panel manages fixed role identities, one-UAC identity provisioning, per-role Login/Logout and Start/Stop, Start All/Stop All, and live identity/worker health. Login opens one visible AGY CLI window under the selected role for sign-in and any authorization-code entry; the user closes it before Start. Automatic helpers and daily workers run hidden. Each cross-user worker reuses the main installed `agy.exe` while Windows Credential Manager remains isolated by user SID; AKIMCP never copies AGY OAuth material (`docs/ref/agy-multi-account.md`).

## Search ladder — how the model should compose a hunt

`search_content` is case-insensitive extended regex by default (`grep -iE`), so multi-alias search is one call, not N. The order below is load-bearing (`docs/plan/done/smart-search-strategy.md`):

1. **Orient + expand signals** — turn the ask into 2–3 signals (literal keyword, EN+VI synonym/variant, likely path/filename). Run `find_path` with the tightest one; prefer `path=` when the tree is known.
2. **Content, simple** — `search_content` with one precise query + optional `glob` + scoped `path`. Prefer this over shell.
3. **Content, multi-alias / OR** — one `search_content` with all aliases in the query joined by `|` (`"funnel|ingress|thay.*funnel"`). Fall back to `run_cmd grep -rliE` only when the scope/exclude still does not fit one query.
4. **Follow the thread** — a hit is a new signal, not an endpoint: pull the next term it names (a called function, a referenced constant, an imported path) and repeat from step 2, scoped tighter. `concept → symbol → file → dependency` on grep-only tools.
5. **Progressive narrow** — if a step returns too much, tighten `path`/`glob` and re-call; return the conclusion, not full bodies.
6. **Verify closure** — before a conclusion that will be *acted on* (not a quick lookup), run one more search confirming no other reference remains and say so. Severity-gated; skip for simple lookups.
7. **Batch independent lookups** in one turn.

## Anchor — load-bearing, do not remove

`agy` and `kiro` are anchored owner requirements ("hands, bắt buộc phải có"). They are **load-bearing** in the subtraction-audit sense: they carry real behavior (agent delegation) that no other tool provides. Any future audit finding proposing their removal is **rejected by this doc** unless the owner re-decides the anchor. The model lock on `kiro` (`claude-sonnet-4.5`) is a hard requirement — the model is not a tool parameter, so no prompt can escalate the tier (`scripts/kiro-mcp.js`).

## History

- `kiro_write` was removed 2026-08-10 — it duplicated the `filesystem` arm's `write_file`/`edit_file` (a genuine primitive-vs-primitive duplication, unlike `kiro_read`). `docs/plan/done/remove-kiro-write.md`.
- Arm CLI facts (flags, model ids, effort enums) by evidence tier: `docs/ref/harness-fact.md`.
- Integration: `docs/plan/done/integrate-kiro-cli.md`, `docs/plan/done/integrate-gemini-grok.md`.
