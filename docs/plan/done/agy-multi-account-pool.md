# AGY multi-account worker pool + one-window manager

Goal: one Aki MCP instance, one visible control surface, four concurrently usable AGY Pro accounts assigned to advisor / executor / experiment / reviewer.

## Implemented in the working tree
- [x] Existing `agy_run` remains local/backward-compatible when `worker` is omitted.
- [x] Named loopback worker routing for advisor / executor / experiment / reviewer.
- [x] One-window AKIMCP panel section: Initialize, Create role identities, per-role Login/Logout, Start All, Stop All, Recheck, per-role Start/Stop.
- [x] Worker health: role, PID, startedAt, root, busy, allowed modes, fixed-identity existence, shared-AGY readiness.
- [x] Advisor/Reviewer plan-only; Executor/Experiment may use accept-edits.
- [x] Worker-side cwd root, body size, process timeout, output buffer, single-job gate, abort-on-stop.
- [x] Safety follow-up: default all four worker roots to dedicated `USER_DIR/agy-workspaces`, create it before provisioning, and reject owner-home as a provisioning root; preserve explicit custom roots. Provisioning grants ACLs on one shared root, so distinct custom roots need separately verified Windows ACLs.
- [x] Generated local bearer secrets outside the repo.
- [x] Same-user worker secrets passed through child environment, not argv.
- [x] Cross-user worker secrets staged in short-lived ACL-restricted Public token directories, read once by worker, then deleted/cleaned.
- [x] Cross-user provisioning/Logout/worker helpers remain hidden behind a DPAPI-protected internal role password. Clicking **Login** is the single intentional visible exception: it opens one interactive AGY CLI window under that role identity so Google/AGY sign-in happens directly in the CLI. Worker launch is acknowledged only after its loopback port is listening, so token handoff cleanup cannot race startup.
- [x] Role password storage uses PowerShell `PSCredential` CLIXML instead of a raw encrypted-string blob; legacy `.dpapi` storage is discarded during reprovision. Readiness accepts Windows PowerShell 5.1 UTF-16LE CLIXML and normalized UTF-8 CLIXML. Provisioning is validated against Windows PowerShell 5.1 LocalAccounts parameter types (`Set-LocalUser -PasswordNeverExpires $true`). Panel reports missing/invalid role credential as repairable provisioning state, shared-AGY readiness, and concise AGY login/eligibility failures. Failed readiness probes auto-stop the affected worker so Login is immediately available for recovery.
- [x] Docs, README, tools reference, changelog, package/bin metadata synchronized.

## Verification
- [x] `test/agy-mcp.test.js` PASS.
- [x] `test/agy-pool-config.test.js` PASS.
- [x] `test/agy-pool-manager.test.js` PASS.
- [x] `test/agy-pool-panel.test.js` PASS.
- [x] `test/agy-provision-script.test.js` PASS (PowerShell parser, no mutation).
- [x] `test/panel-prompt.test.js` PASS.
- [x] JS syntax checks PASS for AGY runner/worker/pool manager/MCP/panel client.
- [x] `git diff --check HEAD` PASS.
- [x] `postman-status.test.js` is hermetic against a live Postman daemon and PASS.
- [x] Full `npm test` PASS on Windows after adding Git for Windows `usr/bin` to `PATH` for the test process. Without that prerequisite, `task-mcp.test.js` cannot spawn `tail.exe` (`ENOENT`); `README.md` now names the exact prerequisite.

## Live rollout
- [x] Restart/install this working tree so the updated panel/backend is the running AKIMCP instance. Panel API on port 9998 returned HTTP 200; latest pool status is 4/4 running and ready.
- [x] Initialize the pool from panel (or `aki-agy-pool-init`); live panel status reports `initialized: true`.
- [x] Click **Create role identities** once; AKIMCP provisions the three fixed standard Windows users through one UAC flow and grants the default workspace access needed by their workers.
- [x] Complete AGY sign-in for Executor/Experiment/Reviewer through their directly opened AGY CLI windows, then Start the workers.
- [x] All automatic CMD/PowerShell helpers remain hidden; only the AGY CLI opened by the user's explicit Login click is visible.
- [x] Verify panel reaches 4/4 ready. Live ports 7411–7414 bind to `127.0.0.1`, each owned by its expected Windows role identity.
- [x] Run a real named-worker dispatch for every role: all four read `D:\LacViet\aki-mcp-sv\package.json` in `plan` mode and returned exactly `@akinet/akimcp|2.1.0|node ./scripts/start.js`. The Codex connector's displayed `agy_run` schema lacked `worker`, so the check used the repository's `executeAgy(worker=...)` route. Each worker temporarily used the repo as its root and was then restored to the default root, with 4/4 ready afterward.
## Future per-project setup

- For persistent dispatch outside `USER_DIR/agy-workspaces`, configure the four worker roots for the intended project, allow it in panel section 5, and confirm its Windows ACL scope. The temporary verification above did not change the saved roots.
- Create separate executor/experiment worktrees when a real project enables concurrent write mode.

The four-account pool is implemented and verified on Windows: 4/4 ready, real named-worker dispatch, and full local tests pass. Persistent custom project roots and concurrent write worktrees remain optional per-project setup choices.
