# aki-mcp-sv — project guidance

Local MCP server (filesystem, search, shell, agy) for claude.ai & ChatGPT over Tailscale Funnel + OAuth 2.1. Entry: `npm start` → `scripts/start.js` (foreground, manual stop/start). Rule loader: `akirule` skill.

## RECURRING #1 — "Couldn't connect" / no `POST /token`: Tailscale Funnel desync, NOT the code

Signature: `npm start` is healthy, funnel status says "on", but client reports "Couldn't connect" and gatekeeper stops at `POST /authorize -> 302` with **no `POST /token`**. The local serve-config did not sync to Tailscale's public edge; external calls fail at the TLS layer.

- **Do not debug `scripts/oauth.js` or `scripts/gatekeeper.js`** — OAuth & bridge code are correct.
- **Do not trust local `curl https://$HOST`** — macOS WireGuard mesh (`100.100.100.100`) returns a false 200. Always probe the public IP via `--resolve`:
  ```bash
  HOST=$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//'); PUB=$(dig @8.8.8.8 $HOST +short | head -1)
  curl --resolve $HOST:443:$PUB https://$HOST/.well-known/oauth-authorization-server   # exit 35 / 000 = desync
  ```
- **Reset cycle**:
  ```bash
  tailscale funnel --https=443 off && tailscale serve reset && tailscale funnel --bg 9999
  ```
- **Bypass / Ingress precedence**: `--tunnel <cred.json>` (Cloudflare) > `PUBLIC_ORIGIN` > Tailscale Funnel.

## Two client paths, one OAuth server

`scripts/oauth.js` serves both without handler-level branching:
- **Claude**: Pre-registered confidential client in `oauth-client.json` (`client_secret_post`).
- **ChatGPT**: Public client via RFC 7591 DCR (`POST /register`), PKCE only, stored in `oauth-dcr-clients.json`.
- **Invariants**: `resolveClient()` is the single SSoT lookup for both. Redirect URIs are strictly allowlisted in `isAllowedRedirect` (`claude.ai`, `chatgpt.com`, `googleusercontent.com`, `grok.com`). Auth codes and refresh tokens are bound to their issuing client ID.

## OS-agnostic by decision, not by accident

- **Data tables only**: Platform differences exist strictly as declarative maps indexed by `process.platform` (`LAUNCHER` in `open-browser.js`, `WIN_EXTRA` in `allowlist.js`). Never branch business logic (`if (win32)`).
- **Prerequisites over fallbacks**: Windows runs Unix binaries via Git for Windows (`grep`, `find`). Do not add pure-JS reimplementations.
- **Permanently removed**: `scripts/chrome.js` stays deleted (Chrome 136 blocks remote debugging on default profile) and native folder picker stays removed.

## Stable core — AIObox never drives an AkiMCP change (ABSOLUTE)

Owner 2026-10-05, verbatim (full text: aiobox `docs/arch/akimcp-boundary.md` § 0a): "tôi k thích akimcp phải thay đổi chỉ vì aiobox. cần nó ổn định bất kể aiobox phát triển thế nào đi nữa. muốn tinh gọn hiệu quả nhất chỉ 1 lần v3 này thôi, rồi hanj chế thay đổi nó." · "chứ tôi thấy động tí là edit akimcp là không đúng nguyên tắc".

- **3.x is the last reshaping for AIObox.** After it, AkiMCP changes only for a core need or security. An edit here whose reason is an AIObox feature is refused: the feature belongs in AIObox (code, `akipanel`, its guide).
- **AIObox internals live only in the AIObox adapter tool.** No other file names AIObox ops, handles, files or rules (funnel and bootstrap lines excepted, aiobox `docs/arch/akimcp-boundary.md` BR-1, BR-9). The adapter forwards generically, so AIObox can add ops without an AkiMCP release; the target is one tool (today two).

## Native command, then guide, then tool

Pick the first rung that works; a higher rung needs the lower one to have failed, with the evidence in the PR.

1. **Native command.** The OS, the browser or the app already exposes the control (`osascript`/System Events, CDP `Browser.setWindowBounds`, an app's global shortcut, a CLI). Use it through the generic tools already served (`run_cmd`, `devtools_eval`, `task_start`). No code.
2. **Guide line.** The native path works but an AI does not find it, or calls it wrong. Write one line where that AI already reads (`docs/feat/tools.md`, a tool's result `next`, or the AIObox guide for AIObox). No new tool.
3. **Tool or op.** Only when the job is needed mid-task AND the cheapest native path costs 3+ calls or keeps failing in the log (aiobox `akimcp-boundary.md` T5′), AND it is generic: useful without AIObox. AIObox-only jobs become AIObox ops, never AkiMCP code.

Example (2026-10-05): moving the AIObox window took six probes because no rung-2 line existed; the fix is a guide line pointing at the F1 shortcut and `Browser.setWindowBounds`, not a new tool.

## Session lifecycle

- **Single shared session**: `scripts/streamable-bridge.js` maintains exactly **one** internal session for the process, held over an in-process `InMemoryTransport` pair (no child process, no SSE). External clients multiplex onto it via JSON-RPC ID remapping; `initialize` is answered locally from cache.
- **No per-client session Map**: Never reintroduce per-client session tracking or an `MCP_MAX_SESSIONS` cap.
- **Timeouts & Persistence**: Per-request timeout only (`MCP_REQUEST_TIMEOUT_MS`, default 10m). Tokens persist in `scripts/oauth.js`; Funnel routing is ephemeral.

## Process topology (Stage 2 — single process)

1 Node process. `start.js` orchestrates: in-process gatekeeper (OAuth + `/mcp`), panel, a boot-time `warmToolsServer()` call. The `scripts/postman/` daemon child (see `docs/feat/tools.md`) is never started at boot — `scripts/postman/postman-mcp.js`'s `launchPostmanDaemon()` is its one spawn path, triggered only by clicking Launch Postman in the panel's Postman tab (`POST /api/postman-launch`). Status/quit also honor `$AKI_DATA_DIR/daemon.pid` so an externally-started daemon is not invisible to Ctrl+C; the daemon's `data.json`/`daemon.pid`/`ownership-status.json`/`new-window.flag` and the per-provider chat prompts (`prompts/`) share the main server's one data dir, `~/.aki/mcpsv` by default, with the paths defined once in `scripts/postman/postman-data-paths.cjs`. `scripts/tools-server.js` builds the one shared `McpServer`, mounting 16 `register(server)` modules — `rule-context`, `shell`, `agy`, `kiro`, `search`, `filesystem`, `postman`, `cdp`, `aiobox`, `chrome`, `fetch`, `system`, `task`, `port`, `git`, `sqlite` (38 tools total) (tool namespace: `aki__*` — `aki__run_cmd`, `aki__agy_run`, `aki__kiro_read`, `aki__find_path`, `aki__search_content`, `aki__postman_status`, plus the native filesystem tools). `streamable-bridge.js` talks to it directly over `InMemoryTransport`; no `mcp-hub`, no third-party filesystem child. Folder scope (`scripts/roots.js`) is read fresh from `setting.json` on every call — a panel save takes effect on the next tool call, no restart.

## Release process

Governed directly by `RULE-release.md` (`B4`, `B6`, `B7`). Repo-specific deltas:
- **No `releases.json`**: CLI/local app; `CHANGELOG.md` + GitHub Release are the only release artifacts.
- **Bare semver tags**: New git tags must be bare semver (`1.7.0`, not `v1.7.0`). Existing `v1.x.x` tags are immutable history. Display title may show `v{version}`.
- **Drift check**: Before committing, verify section numbers in `scripts/config-page.js`, `README.md`, and `docs/index.md`.
- **Immutability**: `done/` plan docs and released CHANGELOG blocks are read-only.
- **Never suggest removing `public/` images**: the panel and README use them; a reference scan that misses them is wrong, not proof they are dead.
