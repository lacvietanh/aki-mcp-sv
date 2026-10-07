# Test suite audit — 2026-10-07

Status: event record, read-only audit of `npm test` before the 3.0.0 gate. Fixes are scheduled in [plan/done/test-suite-fixes.md](../plan/done/test-suite-fixes.md).
Method: `METHOD-audit-subtraction.md` over `METHOD-audit-zero-trust.md`, with `flow` (timing) and `proportion` (sizing). Two read-only reviewers (Read/Grep/Glob only), router-loaded, split the 42 test files (9 changed in the B1 working tree + 33 others); the lead re-checked every CERTAIN item quoted below against the file.
Owner, 2026-10-07: "mấy cái test liệu có viết đúng viết hiệu quả không, có làm rác không, có thừa không, đừng khiến việc test trở thành sai hoặc tạo ra rác hoặc tác động sai lên data hoặc code hoặc đánh giá sai vấn đề nhé".

## Measured runs (Node 22.17.0, base 19c033f + working tree)

| Run | HOME | Result | Left behind |
|---|---|---|---|
| 1 | empty temp dir | 50/51, `task-mcp` fails: "path is outside the allowed roots" | empty `~/.aki/mcpsv` in the temp HOME, `/tmp/akimcp-stdio-*` |
| 2 | real | 51/51 green, 37.2 s | `tasks.json` + `task-logs/` written into the real `~/.aki/mcpsv`; `/tmp/akimcp-stdio-*` |

Run 2 is the finding that matters: on the owner's Mac the same `npm test` (run by `scripts/verify-boundary-b1.sh`) rewrites the live task registry. Green proved nothing about safety.

## CERTAIN — writes or reads real machine state

| Site | Defect |
|---|---|
| `test/task-mcp.test.js` | `task-mcp.js` resolves `USER_DIR` (`~/.aki/mcpsv`) at import; the test writes `tasks.json`, `task-logs/`; reads the real allowlist; passes only when the repo sits under `$HOME`; a failure between start and stop leaves the detached `tail -f` running |
| `test/registry-listing.test.js:22` | `mkdtempSync('/tmp/akimcp-stdio-')` never removed, `/tmp` hardcoded; sets `MCP_DATA_DIR`, which `userdata.js` does not read, so the `--stdio` child runs on the real data dir |
| `test/roots.test.js:13,32` | both `if (homeInRoots)` blocks depend on the real `setting.json` and skip silently; when taken, create `~/.aki-mkdirp-test-*` in the real HOME |
| 7 static importers of `userdata.js` with no override | `sqlite-mcp`, `roots`, `task-mcp`, `cdp-extensions`, `tool-call-log`, `tool-calls-report`, `rule-context`: `mkdirSync(~/.aki/mcpsv)` at import |
| `test/chrome-profile.test.js:79-80`, `test/chrome-mcp.test.js:30-35` | read the real Chrome/Brave/Edge profile dirs (Local State holds profile names and emails) and assert only `Array.isArray` |
| `test/git-mcp.test.js:55`, `test/rule-gate.test.js` | inherit the real `~/.gitconfig` / read the real `~/.aki/akidevrule` |
| 20 files | temp dir removed outside `finally`: a failing run leaves it |

## CERTAIN — passes while the behavior is broken

| Site | Defect |
|---|---|
| `test/sqlite-mcp.test.js:24-46` | never calls `sqlite_schema`/`sqlite_query`; re-runs a copy of the implementation's SQL on `node:sqlite`. Write refusal, the 100-row cap, params, root containment unchecked |
| `test/tool-calls-report.test.js:57` | `C5_olderVersion === 0` only because fixtures say `'3.0.0'` = `package.json`; the first bump turns it red with nothing broken |
| `test/port-mcp.test.js:10-15` | real `lsof`, an empty list passes; `isProtectedPort` reads ambient `GATEKEEPER_PORT`/`PANEL_PORT` |
| `test/surface-no-aiobox.test.js:50-53,64` | `if (bare.includes('aki__chrome_launch'))` — skipped on any box without a browser binary |
| `scripts/postman/test/postman-panel-ownership.test.js:5-12` | 7 regexes over `panel-client.js` text, no function runs |
| `scripts/postman/test/postman-daemon-copy.test.js:131-135` | prints ok before its last assertions |
| tautologies | `streamable-bridge.test.js:65` (`VERSION` vs the same `package.json`), `cdp-extensions.test.js:22` (`assert.ok(server)`), `aiobox-mcp.test.js:160` (`refused()` already asserts the code), `rule-context.test.js:84` (tool name vs its own constant) |
| dead | `aiobox-mcp.test.js:202,205` `evaluated` never read; `system-mcp.test.js:10-12` `typeof` on named imports, `:29` `data` never read; `cdp-extensions.test.js:16-17` |

## CERTAIN — slow or left running

| Site | Cost |
|---|---|
| `test/aiobox-mcp.test.js:422,435` | two real 5 s waits (`REQUEST_PICKUP_MS`, `REFRESH_WAIT_MS`, not injectable); the file is 19.7 s of 37.2 s |
| `test/chrome-profile.test.js:187` | losing `waitForDevToolsActivePort(dir, 5000)` keeps polling after the race; 5.7 s for <1 s of work; the fake Chrome is not killed on failure |
| `test/streamable-bridge.test.js:137` | the cancelled `node -e "setTimeout(…, 8000)"` outlives the test by ~7.6 s (`execFile` has no abort signal) |
| `test/cdp-extensions.test.js:38-56` | four 300 ms bounds where 50 ms exercises the same path |

## CERTAIN — redundant

- `test/cli-and-dev-mode.test.js` repeats `cli-flags.test.js:21-28` (`--version`, `-v`, `--help`); unique value: the `bin/akimcp.js` wrapper and `-h`. Nothing tests dev mode.
- Passphrase format in `gatekeeper.test.js:56-57` and, weaker, `passphrase-roll.test.js:15`.
- `chrome-profile.test.js:98,100` calls `launchChrome('Profile 99')` twice; `postman-daemon-copy.test.js:135` repeats `postman-ownership.test.cjs`.

## SUGGESTED — offered for a decision

- Source-text pins in `postman-daemon-copy.test.js` (~60 regexes, ~30 `doesNotMatch` on removed features): the only guard on Postman page scripts today; reason for each negative unknown.
- `process.exit(0)` at the end of 9 files may hide leaked handles; whether removing it hangs the suite is unverified.
- `_registeredTools` (private SDK field) in 6 files; `client.listTools()` is the public path.
- `tool-surface.test.js:31` budget leaves 9–14 k chars headroom and the served set changes with the machine (25 vs 30 tools).
- Fixed-range random ports in `gatekeeper.test.js:11`, `rate-limit.test.js:11,75` (collision ~1 in 450 per run, estimated); fixed sleeps in `gatekeeper.test.js:28,30` and `task-mcp.test.js:85,116`, where waiting on the observable signal (socket close, task status) replaces them (`flow.B8`).
- `task-mcp.test.js:90,97`: accepts `completed` or `exited` for an exit-0 command; `logOutput.includes(cwd) || length > 0` passes on any output.
- Weak bounds: `rate-limit.test.js:66` (`> 800` for 900 s), `filesystem-mcp.test.js:41` (write never read back), `tool-call-log.test.js:108,116` (prune keeps nothing checked; `maxMB: 0` always rolls), `rule-context.test.js:21` (fenced import never asserted), `aiobox-mcp.test.js:333,337` (400 ms slack).
- Oversized fixtures: `fetch-mcp.test.js:69` 2 MiB for a 512 KB cap, `shell-mcp.test.js` flood 20000 lines.
- Naming: 41 of 42 files are one linear script with no `test()`, so the first failing assertion hides the rest; names such as `cli-and-dev-mode`, `filesystem-mcp`, `postman-daemon-copy` claim more than they check; change-history comments ("Fix 1", `S6`).
- AIObox op names (`compose`, `eval`) as fixture strings in `tool-call-log`/`tool-calls-report` tests.

## Load-bearing — looks removable, must stay

`callers` LRU cap · `rate-limit` 404-never-counted and lockout safety · `gatekeeper` aborted-POST loop · `notion-oauth` exact hosts and `__proto__`/`constructor` ids · `oauth-single-token`/`oauth-activity` invariants · `trusted-zone` smuggled flags and credential refusal (also the isolation template) · `credential-redaction` half-token cut · `fetch-mcp` SSRF forms and `localhost` allowed · `shell-mcp` win32 rules driven by the `platform` argument · `port-mcp` `isProtectedPort` (self-kill guard) · `streamable-bridge` cross-client cancel · `registry-listing` publish gate and stdout-only-JSON-RPC · `aiobox-mcp` handle parser examples, path traversal, 4 MiB edge, exact tool description · `aiobox-contract` frozen read surface · `oauth` absence/security guards · `chrome-profile` fail-closed locks and `--gpu-launcher=` guard · `tool-calls-report` `C1_evalShare` absent · `postman-*` injected sleep and never-overwrite-user-file.

## Coverage

42 files locked by glob, all read whole; one sweep round, so `subtract.A2`'s two dry rounds are not met and minimality is not claimed. Not checked: what `scripts/stdio.js` writes, whether `oauth.js` holds timers, behavior against a live `~/.aki/aiobox`. No linter or typecheck exists in this repo.
