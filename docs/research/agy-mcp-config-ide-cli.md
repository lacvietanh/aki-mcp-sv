# How Antigravity CLI (`agy`) and Antigravity IDE load MCP servers

Status: amended 2026-10-25 (see ## Amendments) — the Decision still stands.

## Start time
2026-09-29, ~10:50–13:00 local, macOS (Darwin 25.6.0), against aki-mcp-sv 2.1.0 + uncommitted panel changes.

## Initial purpose
Settle, for the panel's AGY tab (`POST /api/agy-apply-mcp`): which file each Antigravity product reads MCP servers from, which transports it accepts, how per-tool permission prompts are pre-allowed, and whether one config entry can serve both the CLI and the IDE. Constraint: the local `/mcp` endpoint requires an OAuth Bearer token (`scripts/gatekeeper.js`), and the IDE block then in the panel (`serverUrl` + static Bearer) shared file and key with the CLI entry.

## Strategy
Read the vendor's own shipped docs and the app bundle first (no launch), then observe the running product. Rungs of `coding.B5`: read docs → search local tree → probe mechanically → run the real thing reversibly (isolated profile).

## Checklist
- [x] Read `agy-customizations/docs/mcp_servers.md` shipped inside agy 1.2.13
- [x] Read the `automation` skill shipped with agy for the permission-grant syntax
- [x] Inspect `~/.gemini` layout (symlinks, per-product `mcp/` caches)
- [x] Grep the IDE bundle (`Antigravity IDE.app`, 2.5.5) for the MCP config path constant and the MCP server schemas
- [x] Launch the IDE with `--remote-debugging-port=9333 --user-data-dir=<scratch>` (12:35), watch which processes its language server spawns, quit it
- [x] Relaunch on the real, signed-in profile with the same flag (12:41; IDE was not running, so nothing was displaced): read the page via CDP, check spawned processes, tool-schema cache mtimes and the IDE's own logs, then quit it (port closed)
- [x] Diff filesystem side effects of the launches (files modified in the last 30 minutes)
- [x] Grep the `agy` binary for the permission grammar
- [x] Headless `agy -p --model gemini-3.8-flash-low --mode plan` asking it to call `aki__list_allowed_directories` (a tool not individually allow-listed): returned the real directory list, no popup possible in headless mode
- [x] Tool call from the IDE agent chat, driven over CDP on the real profile (12:45, owner-authorized quota): the IDE showed `MCP Tool: akimcp / aki__list_allowed_directories` with its own "Allow using this MCP tool?" prompt, "Yes, allow this time" was chosen, the tool ran and the chat printed the real directory list. The chat thread remains in the IDE's history

## Result

### R1 — CLI config file and transports
agy 1.2.13's own doc states the global file is `~/.gemini/config/mcp_config.json`, with a `mcpServers` map, and exactly two transports: stdio (`command` required, `args`, `env`) and SSE (`serverUrl` only). The doc lists no `httpUrl` and no `headers` field; that is absence in the doc, not a probed rejection. The doc says the Language Server spawns the stdio process.

### R2 — IDE shares the file and spawns stdio
- `~/.gemini/antigravity/mcp_config.json` is a symlink to `~/.gemini/config/mcp_config.json` (mtime May 20, predating this work).
- The IDE bundle sets `mcpConfigFilePathSegments:["mcp_config.json"]` and ships `McpServerCommandSchema` beside `McpRemoteServerSchema`; its plugin UI renders both `command` and `serverUrl` entries.
- Observed twice (scratch profile 12:35, real profile 12:41): launching the IDE made its bundled `language_server_macos_arm` spawn `node scripts/stdio.js` (two children, parents = the language-server processes). On the real profile, the 40 tool-schema files in `~/.gemini/antigravity-ide/mcp/akimcp/` were rewritten at 12:41:14, one second after the spawn, i.e. the IDE listed the server's tools over stdio. Its own log for that run has only an unrelated `mcp_manager.go` warning (`Failed to write server states, eagerly loading all tools: failed to get server directory`); no connection error.

### R3 — IDE is CDP-drivable, with caveats
- The IDE is Electron/Chromium 142.0.7444.175. `--remote-debugging-port` is honored and `/json` lists the `workbench.html` page. The flag takes effect only at process start, so a window already running cannot be attached to.
- A fresh `--user-data-dir` has no login session, so the IDE shows its sign-in screen. Launching on the real profile with the flag (IDE not previously running) gives the signed-in workbench: workspace list, Agent panel with a model picker; the page text is readable through `cdp-engine.evaluate`.
- Side effect: with a scratch `--user-data-dir`, `~/Library/Application Support/Antigravity IDE/User/settings.json` and `keybindings.json` (the default profile) still got a new mtime at launch. Content looks intact; no pre-launch copy exists to diff, cause unverified.
- A `kill -9` of the scratch instance left two crash logs in `~/.gemini/antigravity-ide/crashes/`.

### R4 — Permissions
The `automation` skill shipped with agy documents grants as `mcp(<server_name>/<tool_name>)` in the permission allow-list and forbids the bare `mcp(*)`. The `agy` 1.2.13 binary itself contains the per-server wildcard form (`mcp(chrome_devtools/*)`, a built-in pattern), so `mcp(<server>/*)` is grammar agy recognizes. The per-server wildcard `mcp(akimcp/*)` is present in the live `~/.gemini/antigravity-cli/settings.json` `permissions.allow`; that it suppresses every per-tool prompt was observed in an earlier session (`docs/plan/done/agy-panel-ux-preallow.md` § Bằng chứng, item 6: `akimcp` Connected, a tool call ran, no popup).

### R5 — Server identity
`~/.gemini/antigravity-cli/mcp/akimcp/` (40 schema files) and the earlier session's observation (plan § Bằng chứng, item 5) show agy drops the hyphen from `aki-mcp`, giving `akimcp`. The panel now writes `akimcp` directly.

## Verification
- R1, R4 (syntax): read from files shipped in the installed product, 2026-09-29.
- R2, R3: observed on this machine 2026-09-29 (process tree via `ps`, `curl localhost:9333/json`, `stat`, bundle grep).
- R2/R3 second run: process tree, cache mtimes and IDE log on the real signed-in profile, 2026-09-29 12:41.
- R4 re-run: headless `agy` returned output for a tool with no individual allow entry, only the `mcp(akimcp/*)` wildcard covers it (headless cannot prompt, so a missing grant would have returned empty per `harness-fact.md`).
- R2 end to end: IDE chat tool call executed, 2026-09-29 12:45.
- **Not verified**: the cause of the default-profile `settings.json`/`keybindings.json` mtime change on the scratch-profile launch (observed, not explained); R5's normalization beyond the two recorded observations. Scope: every path above is macOS; Windows/Linux layouts were not examined.

### R6 — IDE permissions are its own
The IDE does not read the CLI's `permissions.allow` (evidence: the prompt appeared although `mcp(akimcp/*)` was present there): its first call to an MCP tool raised an in-IDE prompt with four choices (allow this time / always in this conversation / always / no). The panel's "Apply to AGY CLI" pre-allow therefore covers the CLI only.

## Decision
**Action:** the IDE-specific `serverUrl` + Bearer block was removed from the panel; one stdio entry serves CLI and IDE (`scripts/config-page.js`, `scripts/panel.js`, `scripts/stdio.js`). Distilled facts: [`ref/fact-agy-mcp-config.md`](../ref/fact-agy-mcp-config.md). Plan: [`plan/done/agy-panel-ux-preallow.md`](../plan/done/agy-panel-ux-preallow.md).
**Cross-references:** `ref/harness-fact.md` (agy headless-run facts, a separate subject).
**Reopen if:** the IDE stops reading `~/.gemini/config/mcp_config.json`, or a sign-in test shows the IDE cannot run the stdio entry.

## Amendments
- 2026-10-25 · R5: `agy --version` now reports 1.4.7 (was 1.2.13 at the original run). `ls ~/.gemini/antigravity-cli/mcp/akimcp/` held 31 `aki__*.json` tool files plus `instructions.md` (the original run recorded 40 files), and **no `aki__agy_run.json`** though the server serves `aki__agy_run` (`docs/plan/done/audit-tool-drift-oct25.md` F8). Cause unknown on agy's side; the server surface is correct (the schema mirror is written by agy/IDE on connect, not by AkiMCP). CLI-1…CLI-4 and the IDE/CDP rows were not re-run against 1.4.7; they keep their 2026-09-29 read date. The Decision (one stdio entry serves CLI and IDE) is unaffected.
- 2026-10-25 · R5: re-read 22:01 to 22:12: the folder's 32 `aki__*.json` files and `instructions.md` were rewritten between 22:01 and 22:03, six of the nine running `agy` processes had started after the `agy_run` rewrite (commit 49d3497, 16:20), and `aki__agy_run.json` is still absent. AkiMCP hides `aki__agy_run` from `tools/list` only when its agy provider is switched off or finds no `agy` on the server's PATH (`scripts/provider-registry.js`, `scripts/agy-mcp.js` provider `detect`). Neither holds here: `providers.agy.enabled` is true, and the PATH of one `scripts/stdio.js` child agy spawned holds `~/.local/bin`, where `agy` lives. That child's `tools/list` was not read, so the cause stays unknown; no code change (plan F8, absent branch). The Decision is unaffected.
