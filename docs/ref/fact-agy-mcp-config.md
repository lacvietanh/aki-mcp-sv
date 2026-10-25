# Fact: how Antigravity CLI and IDE load MCP servers

> updated 2026-10-25 · v3.1.0

Claims about the outside world, macOS only — Windows/Linux layouts were not examined. Current state only; every change lands through a research event ([`research/agy-mcp-config-ide-cli.md`](../research/agy-mcp-config-ide-cli.md)). Headless-run flags of `agy` live in [`harness-fact.md`](harness-fact.md), not here.

2026-10-25 re-check (`docs/plan/audit-tool-drift-oct25.md` F8, P0): `agy --version` now reports **1.4.7** (was 1.2.13 when CLI-1…CLI-5 were verified on 2026-09-29; the Antigravity IDE version was not re-read). The config-loading claims below were **not** re-run against 1.4.7 — they stay as last verified 2026-09-29 and keep that read date; the panel's Apply route still writes the paths they name and no breakage is reported. Two observations did change, recorded on their rows: the `akimcp/` cache holds 31 `aki__*.json` tool files plus `instructions.md` (not 40), and it has **no `aki__agy_run.json`** though the server serves that tool — cause unknown on agy's side, open (research `§ Amendments`).

## CLI — `agy` (loading facts last verified against 1.2.13 on 2026-09-29; running 1.4.7)

| ID | Fact | Source | Research |
|---|---|---|---|
| CLI-1 | Global MCP servers are read from `~/.gemini/config/mcp_config.json`, a `mcpServers` map keyed by server id. Not from `~/.gemini/antigravity-cli/settings.json`. | `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md` § Location | § R1 |
| CLI-2 | Two transports only: stdio (`command` required; `args`, `env` optional; spawned by the Language Server) and SSE (`serverUrl` only). The doc lists no `httpUrl` and no `headers` field. | same doc § Configuration Schema | § R1 |
| CLI-3 | Permissions are `permissions.allow` entries in `~/.gemini/antigravity-cli/settings.json`, written `mcp(<server>/<tool>)`; bare `mcp(*)` is documented as forbidden. | `~/.gemini/antigravity-cli/builtin/skills/automation/SKILL.md` lines 89–92, 154 | § R4 |
| CLI-4 | `mcp(<server>/*)` is a grammar agy recognizes (its binary carries `mcp(chrome_devtools/*)`) and pre-allows every tool of one server with no per-tool popup. Re-run 2026-09-29: headless `agy` called a tool with no individual entry and returned its real output. | `agy` 1.2.13 binary strings; headless run 2026-09-29; `docs/plan/done/agy-panel-ux-preallow.md` § Bằng chứng, item 6 | § R4 |
| CLI-5 | The hyphen is dropped from a server's name (`aki-mcp` → `akimcp`); per-server tool schemas are cached in `~/.gemini/antigravity-cli/mcp/<server>/`. On 2026-10-25 that folder held 31 `aki__*.json` files plus `instructions.md`, with no `aki__agy_run.json` though the server serves `aki__agy_run` (F8, cause unknown agy-side). | plan § Bằng chứng, item 5; `ls ~/.gemini/antigravity-cli/mcp/akimcp/` 2026-10-25 | § R5 |

## IDE — Antigravity IDE 2.5.5

| ID | Fact | Source | Research |
|---|---|---|---|
| IDE-1 | The IDE reads the same file: `~/.gemini/antigravity/mcp_config.json` is a symlink to `~/.gemini/config/mcp_config.json`. | `ls -la ~/.gemini/antigravity` | § R2 |
| IDE-2 | The bundle ships `McpServerCommandSchema` (stdio) beside `McpRemoteServerSchema`, and `mcpConfigFilePathSegments:["mcp_config.json"]`. | `Antigravity IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` | § R2 |
| IDE-3 | On launch the IDE's bundled `language_server_macos_arm` spawns a stdio entry from that file (`node scripts/stdio.js`) and rewrites the server's tool schemas in `~/.gemini/antigravity-ide/mcp/<server>/` within a second, so it lists the tools. Seen on the scratch and the signed-in profile. A tool call from the IDE agent chat executed and returned real output. | process tree, cache mtimes, IDE log, chat run, 2026-09-29 12:35–12:45 | § R2 |
| IDE-4 | The IDE has its own MCP permission prompt (allow this time / always in this conversation / always / no); the CLI's `mcp(<server>/*)` in `antigravity-cli/settings.json` does not pre-allow it. | IDE chat run 2026-09-29 12:45 | § R6 |

## CDP on the IDE

| ID | Fact | Source | Research |
|---|---|---|---|
| CDP-1 | The IDE is Electron/Chromium 142.0.7444.175; `--remote-debugging-port=<n>` is honored and `http://localhost:<n>/json` lists the `workbench.html` page. | `curl localhost:9333/json/version` | § R3 |
| CDP-2 | The flag applies only at process start; an already-running IDE window cannot be attached. | Electron/Chromium behavior, consistent with the run | § R3 |
| CDP-3 | A fresh `--user-data-dir` has no login session (sign-in screen). Launching with the flag on the real profile, with the IDE not already running, gives the signed-in workbench, readable through `scripts/cdp-engine.js` `evaluate`. | runs 2026-09-29 12:35 and 12:41 | § R3 |
| CDP-4 | A launch with a scratch `--user-data-dir` still changed the mtime of the default profile's `User/settings.json` and `keybindings.json`; content stayed intact-looking, cause not established. | `stat`, 2026-09-29 | § R3 |
