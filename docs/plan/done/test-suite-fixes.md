# Plan · Test suite fixes

Status: done 2026-10-07 on the dev box, before the 3.0.0 gate (F1–F4; two F4 items kept by decision, below). Findings: [research/test-suite-audit-oct07.md](../../research/test-suite-audit-oct07.md).
Goal: `npm test` gives a verdict that depends only on the code — never on the machine, never touching the owner's data — and costs no more time than the behavior it checks.

## F1 — isolation by shape (done)

`test/setup.js` is preloaded by `npm test` (`node --test --import`). Every test process and every child it spawns gets its own HOME, USERPROFILE, TMPDIR/TMP/TEMP, removed on exit even after a failure or `process.exit`. This replaces per-file discipline for: the 7 unisolated `userdata.js` importers, the `--stdio` child, `~/.gitconfig`, the real `~/.aki/akidevrule` read, the real browser profile dirs, and the 20 temp dirs cleaned outside `finally`. Verified: suite run with real HOME leaves `~/.aki` and `/tmp` unchanged except `registry-listing`'s hardcoded `/tmp` (F2). One file by hand: `node --import ./test/setup.js test/<name>.test.js`.

## F2 — correctness, dead and redundant (CERTAIN items)

| File | Change |
|---|---|
| `task-mcp` | run under the fake HOME's roots; assert the exact log line and `completed`; poll task status instead of fixed sleeps; stop the `tail -f` task in `finally` |
| `registry-listing` | drop the hardcoded `/tmp` dir and the `MCP_DATA_DIR` override (F1 isolates the child) |
| `roots` | `homeInRoots` asserted, both blocks unconditional |
| `port-mcp` | clear `GATEKEEPER_PORT`/`PANEL_PORT`; bind a loopback port 0 and assert it is listed with `process.pid` |
| `sqlite-mcp` | call `sqlite_schema`/`sqlite_query` through an MCP client; assert write refusal and root containment |
| `tool-calls-report` | fixture version from `package.json` |
| `surface-no-aiobox` | no conditional assertion (`chrome_launch` block covered by `chrome-mcp`) |
| `chrome-profile`, `chrome-mcp` | profile listing asserted against a fixture, not `Array.isArray` |
| tautologies, dead code | `streamable-bridge:65`, `cdp-extensions:16-17,22`, `aiobox-mcp:160,202`, `rule-context:84`, `system-mcp:10-12,29` |
| redundant | `cli-and-dev-mode` → `bin-wrapper` (the `bin/akimcp.js` wrapper's `--version` and `-h` only); passphrase format in `passphrase-roll` only; one `launchChrome('Profile 99')`; `postman-daemon-copy:135` |
| weak | `tool-call-log` prune/cap, `rule-context` fenced import, `rate-limit:66`, `filesystem-mcp` write read back, `postman-daemon-copy` ok printed last |

## F3 — time and leftovers

| File | Change |
|---|---|
| `aiobox-mcp.js` + test | one test seam `setTimings({ callBudgetMs, requestPickupMs, refreshWaitMs })` replaces `setCallBudgetMs`; the two 5 s waits run at 300 ms in the test |
| `chrome-profile` | shorter `timeoutMs`, a bound that still separates detection from timeout; fake Chrome killed in `finally` |
| `streamable-bridge` | cancelled child shortened, elapsed bound below the child's life |
| `cdp-extensions` | 50 ms bounds |
| `fetch-mcp`, `shell-mcp` | fixtures sized to the cap they cross |

Exit: `npm test` green twice in a row with real HOME; `~/.aki`, `/tmp` and the repo tree identical before and after; total time and the slowest files recorded here.

Result 2026-10-07 (Node 22.17.0): 51/51 twice, 22.3 s each (was 37.2 s); `/tmp`, `~/.aki`, HOME and `git status` identical before and after; no child process left. Slowest: `aiobox-mcp` 10.5 s (was 19.7; the rest is its 600–900 ms budget cases), `chrome-profile` 2.1 s (was 5.7), `streamable-bridge` 1.2 s, `gatekeeper` 1.0 s. `chrome-profile` and `chrome-mcp` also set their own HOME because they write a browser `Local State` fixture: a bare `node test/<file>` run must never write into a real browser profile.

## F4 — open items, done 2026-10-07

| Item | Change |
|---|---|
| `aki__run_cmd` cancel (production) | `shell-mcp.js` passes the request's abort signal to `execFile`; `streamable-bridge` test proves the child is gone after the owner's cancel and alive after another client's, and fails with the signal removed |
| `process.exit(0)` | removed from 10 files; none leaked a handle, each exits on its own in 0.04–1.2 s |
| `_registeredTools` | 6 files list tools through `client.listTools()` |
| ports, sleeps | `rate-limit` binds port 0; `gatekeeper` waits on the server socket `close`; `task-mcp` polls status with a deadline |
| `tool-surface` budget | every provider stubbed as installed, so the budget covers the full 38-tool surface on any machine; headroom 1421 chars, so the next larger tool needs a deliberate `RAISES` entry |

Kept by decision:
- Postman source-text pins (`postman-daemon-copy`, `postman-panel-ownership`): labeled as an interim guard on line 2 of each file, kept until a `vm` harness runs `panel-client.js` functions; each removed-feature `doesNotMatch` has an unknown reason (`subtract.B3`).
- One-linear-script files (41 of 42): not split into `test()` cases; a rewrite of every file for failure reporting only, with no verdict changed.
- No action: AIObox op names as fixture strings in `tool-call-log`/`tool-calls-report` tests (`op` is a free string there).

Result 2026-10-07: `npm test` 51/51, 21.6 s; no child process or temp dir left.
