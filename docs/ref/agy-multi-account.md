# AGY multi-account pool

One AKIMCP panel controls four concurrent AGY CLI workers: Advisor, Executor, Experiment, and Reviewer. Each worker can run under a different Windows login identity, so AGY sees four separate Windows Credential Manager vaults while the owner uses one panel instead of four permanent terminals or four browser/CDP sessions.

This four-account pool is currently Windows-only. On macOS and Linux, the local `agy_run` path without `worker` remains available; role provisioning and interactive role Login are not implemented there.

## Why the Windows identities still exist

Opening four terminals under the same Windows user does not create four AGY accounts. AGY authentication is tied to the Windows user's credential vault. Separate logon identities provide the isolation; the pool manager hides the day-to-day process handling.

## Roles

| Role | Default mode | Default Windows identity |
|---|---|---|
| Advisor | `plan` | current AKIMCP user |
| Executor | `plan,accept-edits` | `agy-executor` |
| Experiment | `plan,accept-edits` | `agy-experiment` |
| Reviewer | `plan` | `agy-reviewer` |

Executor and Experiment should use separate Git worktrees when both may edit the same project.

## Worker workspace roots

All four roles default to the dedicated `USER_DIR/agy-workspaces` folder (`~/.aki/mcpsv/agy-workspaces` in the standard profile). Initialize records this root in `setting.json`; Create role identities creates it and grants the role users access there. The default does not grant role users access to the owner's whole Windows profile. Existing `agy.workers.<role>.root` values are preserved, including values written by an earlier pool setup. If an older entry points at the owner's home directory, change it explicitly before provisioning; the owner-home guard rejects that root.

For the `D:\LacViet` dispatch examples below, edit the existing `~/.aki/mcpsv/setting.json` **after Initialize and before Create role identities**: set `agy.workers.<role>.root` to `D:\LacViet` for **all four roles**. The worktrees in the examples are subdirectories of that common root. Ensure the directory exists and add it to the panel's section 5 allowed folders so `agy_run(cwd=...)` can route those paths. Automatic one-UAC provisioning requires one common resolved root and grants Executor/Experiment Modify and Reviewer read/execute there; choose a narrower shared project folder when possible. Different per-role roots require separate Windows ACL setup after provisioning.

## First-time setup

1. Open the AKIMCP panel and go to **7 · AGY multi-account pool**.
2. Click **Initialize**. This creates/repairs the four worker entries in `~/.aki/mcpsv/setting.json` with the dedicated default workspace root and generates four random worker bearer secrets in `~/.aki/mcpsv/agy-pool-secrets.json`. Existing unrelated settings and custom worker roots are preserved; the four role identities are fixed.
3. Keep the fixed identities: Advisor uses the current Windows user; Executor/Experiment/Reviewer use `agy-executor`, `agy-experiment`, and `agy-reviewer`. Set any common custom root now, as described above.
4. When the panel shows **Create role identities**, click it even if the Windows users already exist: it also provisions the common workspace and its permissions. Windows may show one UAC consent dialog; automatic CMD/PowerShell helpers stay hidden. A random internal Windows password is DPAPI-protected under the current user. Provisioning grants the role users read/execute on the shared AGY install, Executor/Experiment Modify on the common workspace root, and Reviewer read/execute there.
5. Back in the panel, click **Login** for each role that needs an AGY account (including Advisor if it is not signed in). The click opens one visible AGY CLI window under that role's Windows identity, without a hidden cleanup process before launch. Complete Google/AGY sign-in there; if AGY asks for an authorization code, paste it into the CLI. Close the AGY CLI window when sign-in is complete. Automatic CMD/PowerShell helpers remain hidden.
6. Click **Start** for each role, or **Start all**, after closing its login window. Start checks AGY login and account eligibility before reporting the worker ready. Daily execution is headless `agy` CLI; no persistent browser/CDP process is required.
7. To change the Gemini/AGY account bound to a role, click **Logout** for that role. Logout runs in the background, clears only that role user's AGY Credential Manager entries, stops its worker, and keeps the fixed Windows role identity. Then click **Login** and choose the replacement account. If AGY says the selected account is not eligible for Antigravity, use Logout → Login and select another eligible personal Google account.

The optional CLI equivalent of step 2 is:

```bat
aki-agy-pool-init
```

From a source checkout:

```bat
node D:\LacViet\aki-mcp-sv\bin\aki-agy-pool-init.js
```

## Daily use

The panel is the control surface:

- **Start all** launches all four worker roles.
- **Stop all** asks each running worker to shut itself down.
- **Recheck** reads live `/health` state and forces a new quota read for each running role.
- Each role also has Login, Logout, Start, and Stop controls. Login intentionally opens one visible AGY CLI window for interactive sign-in; close it before Start.
- The role Windows identities are fixed; there is no editable user mapping.
- Status shows whether each role identity exists, plus worker PID and allowed modes. Provisioning is considered ready only when the configured common root has a successful-provision marker; creating the folder alone does not clear **Create role identities**.

No four-terminal or four-browser workflow is required after first-time account setup. Sign-in, including any code entry, happens in the AGY CLI window opened by **Login**. Daily execution is CLI-only.

## Usage limits

Each running role shows four quota bars: 5-hour and weekly limits for Gemini, and 5-hour and weekly limits for Claude/GPT. The bars show the percentage **remaining**, with the reset time in the browser's local timezone. The panel updates usage when opened, when Recheck is clicked, and every two minutes while the AGY tab is visible. Automatic reads reuse a worker's result for up to two minutes; Recheck forces a fresh read when the worker is idle.

Usage comes from that role's own hidden `agy -p /usage --output-format json` command. The same AGY run writes a temporary CLI log; the worker extracts the authenticated email's part before `@` and deletes the log after the command returns. If the process is killed before cleanup, the temporary log may remain in that Windows user's temp directory. The panel labels the role `AGY: <name>` when that identity is available, and `AGY: unknown` otherwise. If readiness fails, the worker also attempts a hidden identity read before it stops, so an ineligible account can still show its last observed label when AGY logged the email; the panel keeps the ineligible status beside that label until Login or Start is retried. A stopped or busy worker without a cached reading shows unavailable; if a prior reading exists, the panel marks it **Last known**. Login or Logout clears that role's prior reading and account label so a different account cannot inherit them. The browser receives no full email, AGY credentials, CLI log, or worker bearer secret. If AGY does not log an email, the label remains unknown.

## Dispatch

The existing MCP tool keeps its backward-compatible local path:

```text
agy_run(prompt="...", cwd="D:\LacViet\project")
```

Select a pool role with `worker`. The `D:\LacViet` examples require the common root and section 5 allowed folder described above; the new default workspace does not contain these paths:

```text
agy_run(worker="advisor", mode="plan", cwd="D:\LacViet\project", prompt="review the approach")
agy_run(worker="executor", mode="accept-edits", cwd="D:\LacViet\worktrees\executor", prompt="implement the approved change")
agy_run(worker="experiment", mode="accept-edits", cwd="D:\LacViet\worktrees\experiment", prompt="try the alternative implementation")
agy_run(worker="reviewer", mode="plan", cwd="D:\LacViet\worktrees\executor", prompt="verify the result")
```

## Runtime boundaries

- Workers bind only to `127.0.0.1`.
- Worker URLs must use literal `http://127.0.0.1`; remote hosts are rejected.
- `/run`, `/stop`, `/usage`, and `/identity` require the role bearer secret.
- Advisor/Reviewer cannot be promoted to write mode by a caller; worker-side mode gates enforce the restriction again.
- The main `agy.allowedModes` gate still runs before worker routing.
- Each worker restricts requested `cwd` to its configured root, runs one AGY job at a time, and applies request-size, process-timeout, and output-buffer limits. Stop aborts the active AGY process before closing the worker listener.
- All four roles default to `USER_DIR/agy-workspaces`; a custom root is explicit per role in `setting.json`. Automatic provisioning requires all four resolved roots to match and grants cross-user identities access there. The owner's home directory is rejected as a provisioning root; distinct per-role roots need separate Windows ACL setup.
- For the default workspace, the fixed role users receive only non-inheriting Traverse (X), ReadAttributes (RA), and Synchronize (S) on its `.aki` and `mcpsv` parent directories. These parent grants do not include file read or directory listing; access to the workspace itself remains on its protected DACL.
- AGY OAuth credentials are neither read nor copied by AKIMCP; AGY continues to own them in each fixed Windows role user's credential vault. Logout deletes only that role user's AGY Credential Manager entries.
- AKIMCP resolves the main account's installed `agy.exe` and passes its explicit path to all workers. Provisioning grants the fixed role users read/execute access to that shared AGY install, avoiding three extra AGY installs.
- The pool's generated bearer secrets are local control secrets, not AGY credentials. Same-user workers receive them through process environment; cross-user launches use a short-lived ACL-restricted token file that the worker deletes after reading, so the bearer value is not placed on the worker command line.
- A local administrator already controlling the machine can still inspect processes and protected files; the bearer layer protects the loopback worker interface from ordinary accidental local calls, not from an administrator.

## Files

- `scripts/agy-mcp.js`: local vs named-worker routing.
- `scripts/agy-worker.js`: loopback worker HTTP server.
- `scripts/agy-pool-config.js`: role config and secret initialization.
- `scripts/agy-pool-manager.js`: status/provision/login/logout/start/stop and Windows role launcher; Login opens the visible AGY CLI.
- `scripts/agy-provision-users.ps1`: one-UAC, non-interactive provisioning of the three fixed standard Windows role identities.
- `scripts/agy-role-process.ps1`: hidden cross-user helper using the DPAPI-protected role credential; its Login action opens the visible AGY CLI.
- `bin/aki-agy-worker.js`: worker CLI.
- `bin/aki-agy-pool-init.js`: optional setup CLI.
