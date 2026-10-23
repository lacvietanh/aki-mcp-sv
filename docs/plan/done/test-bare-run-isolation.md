# Plan · Every way of starting a test is isolated, not only `npm test`

Status: done 2026-10-23. Phase 1 and phase 2 applied; phase 2 was unblocked by the owner's order of 2026-10-23 14:49 to close every pending item (council room `2026.10.23-1455-akimcp-3-1-0-wrapup`). Working file: /Users/aki/.aki/mcpsv/task/akimcp-rule-gate-test-real-home/working.md. Rule-side follow-up: AkiDevRule `docs/plan/test-isolation-every-entry.md`.

## Why

- 2026-10-22 22:51: `node test/rule-gate.test.js`, run by hand without the preload, wrote stub rule files into the real `~/.aki/akidevrule` and deleted its `route-map.json`; every agent session on the machine loaded empty `coding`/`pattern`/`docs` rules until a reinstall at 22:58.
- Root cause 1: `test/setup.js` isolates HOME and the temp dir only when preloaded by `npm test`. The single-file command people and agents actually type skips it (the session that caused the incident ran five files that way).
- Root cause 2: `scripts/userdata.js` exports `AKI_MCP_DATA_DIR`/`AKI_DATA_DIR` (the real data dir) into the running server's env, so every shell AkiMCP starts (`run_cmd`, `task_start`) passes it on. The preload did not clear it, so even `npm test` from such a shell read the real `setting.json`, and `task-mcp.test.js` would have written the live `tasks.json`. Measured 2026-10-23 02:25: 4 of 60 failed on the real roots (`roots`, `sqlite-mcp`, `task-mcp`, plus the unrelated `chrome-profile`).
- Red before the fix: a plain bare run of `test/task-mcp.test.js` passed and left `.aki/mcpsv/tasks.json` and `task-logs/` in HOME; `roots.test.js` left `.aki/mcpsv/`.

## Decision

Every test file's first import is `test/setup.js`, so a bare run is the same as `npm test` (Node evaluates the module once whether it is preloaded, imported, or both; checked on Node 25.2.1 for `import` and for `require` from `.cjs`). The preload also drops inherited `AKI_*`/`MCP_*` variables and points `APPDATA`/`LOCALAPPDATA` into the temp home.

Rejected: own-HOME lines only in files that write HOME (judgment; the incident's author relied on the preload); a refusal guard per file (also per-file, and it blocks instead of isolating); blocking bare `node test/…` in AkiMCP's shell tool (Claude Code and other native shells bypass it, and AkiMCP's core does not grow for this). Reopen if a Node release stops sharing the `--import` module instance with the entry graph.

## Phase 1 — applied 2026-10-23

- `test/setup.js`: header, `AKI_*`/`MCP_*` removed from the env, `APPDATA`/`LOCALAPPDATA` under the temp home.
- First import added to the 30 test files no other session had uncommitted: `test/` bin-wrapper, callers, cdp-extensions, chrome-mcp, chrome-profile, cli-flags, credential-redaction, fetch-mcp, filesystem-mcp, font-awesome-static, gatekeeper, notion-oauth, oauth-single-token, output-shape, port-mcp, roots, shell-mcp, sqlite-mcp, streamable-bridge, system-mcp, task-mcp, tool-calls-report, trusted-zone, aiobox-mcp; `scripts/postman/test/` autoclick-target-match, daemon-copy, mcp, ownership (`.cjs`, `require`), panel-ownership, status.
- Verified: plain bare runs of `task-mcp`, `roots`, `sqlite-mcp`, `postman-ownership.test.cjs` exit 0 and leave nothing in HOME; the same `task-mcp` run from an AkiMCP shell passes and leaves the real `tasks.json` untouched; `npm run test` from an AkiMCP shell 59/60 (only `chrome-profile`, which failed the same way before); the real `~/.aki/akidevrule` files hash the same before and after.

## Phase 2 — applied 2026-10-23

1. Added the same first import to the 13 files that held other sessions' uncommitted work: `aiobox-contract`, `git-mcp`, `oauth-activity`, `oauth`, `passphrase-roll`, `rate-limit`, `registry-listing`, `rule-context`, `rule-gate` (has its own HOME since 2026-10-23 02:20), `search-mcp`, `surface-no-aiobox`, `tool-call-log`, `tool-surface`.
   `rule-gate.test.js` lost its own HOME block: the preload now gives a bare run the same fresh HOME, so the second mechanism protected nothing.
2. The preload refuses an unbound file: when `process.argv[1]` is an existing `*.test.js`/`*.test.cjs` file whose first `import`/`require` line does not name `setup.js`, it throws `<file>: its first import must be test/setup.js, so running it alone is isolated too`. The existence check is there because the `node --test` parent process can carry the unexpanded glob as `argv[1]`.
3. One CHANGELOG line under `[Unreleased]` › Changed; committed in the 3.1.0 batch.

Closes when: no test file lacks the import, `npm run test` fails on a file that drops it, and a bare run of every file from a plain terminal and from an AkiMCP shell leaves the real `~/.aki` unchanged.

## Not in this plan

- `test/chrome-profile.test.js:49` EEXIST on the `SingletonLock` symlink, inside the temp dir, before and after phase 1: a flaky lock test, not an isolation leak.
- `docs/index.md` entry: that file has another session's uncommitted edits; add the line when it is committed.
