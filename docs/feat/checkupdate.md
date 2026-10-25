# Check-update — version-check for aki-mcp-sv and akidevrule

> updated 2026-10-25 · v3.1.0

"Checkupdate" covers **two independent version checks bundled into one pipeline**: this repo's own package (`@akinet/akimcp`, compared against `package.json` on GitHub) and the akidevrule rule corpus (compared against its `CHANGELOG.md` on GitHub). Both live in `checkForUpdate()` (`scripts/update-check.js`) and both are shown from the same `updateInfo` object — `{ mcp, rule }` — in the web panel and the Postman panel.

## Single source of truth

- **Classification core**: `scripts/rule-version-core.cjs` — the only place that parses a changelog version, compares semver, and classifies akidevrule install state (`missing`/`ahead`/`unknown`/`update`/`current`). It is `.cjs` so both the ESM web checker and the CommonJS Postman daemon can require it without a second copy.
- **Network fetch**: `scripts/rule-version-core.cjs`'s `fetchLatestRuleVersion()` is the one implementation that asks GitHub for akidevrule's latest version. Two trigger points call it — the main server at boot, and the Postman daemon once per its own start (each "Launch Postman" click) — never a third copy.
- **Shared state file**: `~/.aki/mcpsv/aki-mcp-status.json` (`STATUS_PATH`) is what both processes write and read `latest` through — whichever ran most recently wins, and the other side picks up the fresher value on its next disk read.

## Lifecycle

```mermaid
flowchart TD
    Boot["scripts/start.js boot"] --> CFU["checkForUpdate()<br/>scripts/update-check.js"]
    CFU -->|"GET raw package.json<br/>lacvietanh/aki-mcp-sv"| MCPNet["mcp.latest"]
    CFU -->|"GET raw CHANGELOG.md<br/>lacvietanh/akidevrule"| RuleNet["rule latest version"]
    RuleNet --> Core1["rule-version-core.cjs<br/>getRuleStatus(latest)"]
    Core1 --> RuleObj["rule: {current,latest,updateAvailable,<br/>installed,unreleasedOnly,state}"]
    MCPNet --> MCPObj["mcp: {current,latest,updateAvailable}"]
    MCPObj --> UpdateInfo["updateInfo = {mcp, rule}<br/>held in-memory as ctx.updateInfo"]
    RuleObj --> UpdateInfo
    UpdateInfo --> WriteStatus["writeStatusFile(updateInfo)"]
    WriteStatus --> StatusFile[("~/.aki/mcpsv/aki-mcp-status.json")]

    UpdateInfo --> PanelRender["GET / → renderPanel()<br/>scripts/config-page.js"]
    PanelRender --> Badge["section 2 rule badge +<br/>update banner (mcp/rule rows)"]

    subgraph WebInstall["Web panel — Install/update click"]
        InstallRoute["POST /api/install-rules<br/>scripts/panel.js"]
        InstallRoute --> DoInstall["installRules()<br/>git clone/pull + install.sh|.ps1"]
        DoInstall --> Refresh1["refreshLocalVersions(ctx.updateInfo)<br/>NO network — re-reads disk<br/>against the latest already known"]
        Refresh1 --> Core2["rule-version-core.cjs<br/>getRuleStatus(sameLatest)"]
        Core2 --> WriteStatus2["writeStatusFile(updateInfo)"]
        WriteStatus2 --> StatusFile
        Refresh1 --> Reload["client reloads the page (800ms)"]
    end
    UpdateInfo --> InstallRoute

    subgraph DaemonLife["Postman daemon — a separate child process"]
        Launch["Launch Postman button<br/>(panel action, never at boot)"] --> DaemonBoot["postman-daemon.cjs main()"]
        DaemonBoot --> LocalSnap["localSnapshot()<br/>immediate disk-only read, for the<br/>synchronous first script injection"]
        LocalSnap --> CachedInfo["cachedUpdateInfo<br/>(module-level var)"]
        CachedInfo --> InjectPage["injected into the Postman page<br/>as window.__pmUpdateInfo"]

        DaemonBoot -->|"async, in parallel"| NetFetch["refreshFromNetwork()<br/>postman-rule-update-check.cjs"]
        NetFetch -->|"GET raw CHANGELOG.md<br/>lacvietanh/akidevrule"| RuleNet2["rule latest version"]
        RuleNet2 --> Core3["rule-version-core.cjs<br/>getRuleStatus(latest)"]
        Core3 --> WriteStatus3["writeSharedRule(rule)"]
        WriteStatus3 --> StatusFile
        Core3 --> CachedInfo2["cachedUpdateInfo reassigned"]
        CachedInfo2 --> PushAll["pushUpdateInfoToAll()<br/>re-pushes to every attached client"]

        CDPBind["Postman page: install/update click<br/>→ CDP binding __cdpInstallAkiRule"] --> DoInstall2["installAkiRule()<br/>own git clone/pull + install script"]
        DoInstall2 --> Refresh2["refreshLocalVersions(cachedUpdateInfo)<br/>NO network — readMainProcessLatest() again"]
        Refresh2 --> Core4["rule-version-core.cjs<br/>getRuleStatus(...)"]
        Core4 --> CachedInfo
        CachedInfo --> PushPage["pushUpdateInfoToPage(client)"]
    end
    StatusFile -.->|"read by readMainProcessLatest()<br/>as a fallback if the fetch fails"| NetFetch

    style CFU fill:#ffe0b2,stroke:#e65100
    style Core1 fill:#c8e6c9,stroke:#2e7d32
    style Core2 fill:#c8e6c9,stroke:#2e7d32
    style Core3 fill:#c8e6c9,stroke:#2e7d32
    style Core4 fill:#c8e6c9,stroke:#2e7d32
    style NetFetch fill:#ffe0b2,stroke:#e65100
    style StatusFile fill:#fff9c4,stroke:#f9a825
```

Green nodes = the one shared classification core (`rule-version-core.cjs`). Orange = the two places that make a real network call, both through the one shared `fetchLatestRuleVersion()`. Blue = reading the shared status file instead of the network.

## When a NEW network check runs (vs. a disk-only re-classification)

| Trigger | What runs | Network call? | Where |
|---|---|---|---|
| Main process boot (`npm start`) | `checkForUpdate()` — fetches both `mcp.latest` and `rule.latest` from GitHub | **Yes** | `scripts/start.js`, the `checkForUpdate()` call |
| Web panel "Install / update" click (`POST /api/install-rules`) | `installRules()` then `refreshLocalVersions(ctx.updateInfo)` | No — reuses the `latest` already in `ctx.updateInfo` | `scripts/panel.js`, route `POST /api/install-rules` |
| Web panel "Pull & restart" click (`POST /api/pull-update`, this repo's own code) | `git pull --ff-only` | No version check at all; banner clears only on the next boot | `scripts/panel.js`, route `POST /api/pull-update` |
| Postman daemon launch (clicking "Launch Postman" in the panel) | `localSnapshot()` for the immediate page injection, then async `refreshFromNetwork()` — fetches, writes `STATUS_PATH`, reassigns `cachedUpdateInfo`, pushes to every attached client | **Yes** — same `fetchLatestRuleVersion()` as boot | `scripts/postman/postman-daemon.cjs` `main()` → `postman-rule-update-check.cjs` |
| Postman injected page "Install/update" click | `installAkiRule()` then `refreshLocalVersions(cachedUpdateInfo)` | No — same status-file read | `scripts/postman/postman-daemon.cjs`, the `installAkiRule()` caller |

**There is no periodic/interval/cron re-check.** Both network triggers above are one-shot, each per its own process's start (main-process boot, Postman daemon launch) — not on a timer. The `mcp`/`rule` "latest" values are frozen for the lifetime of each process between those triggers; the way to learn about a newer release is either restarting `npm start` or clicking "Launch Postman" again. The install-click rows only re-check **local install state** against the already-known `latest` — never a new GitHub round-trip.

## Known duplication not covered by this doc

`installAkiRule()` (`scripts/postman/postman-daemon.cjs`) and `installRules()` (`scripts/panel.js`) are two independent, near-identical implementations of "clone/pull akidevrule + run its installer" — unlike the version-*check* logic above, this install *action* was never merged into one SSoT. Out of scope here; flagged for a future pass.

## Related

- `docs/research/repo-architecture-subtraction-inventory.md` — Amendments (2026-09-27): the version-check duplication this doc describes as fixed.
- `docs/plan/done/update-check-notify.md` — original 1.6.0 feature (dual update-check, status file, staleness self-check).
- `docs/plan/done/2.0.0-improve.md` §1 — status file path migration to `~/.aki/mcpsv/`.
