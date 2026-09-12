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

## Session lifecycle

- **Single shared session**: `scripts/streamable-bridge.js` maintains exactly **one** internal session for the process, held over an in-process `InMemoryTransport` pair (no child process, no SSE). External clients multiplex onto it via JSON-RPC ID remapping; `initialize` is answered locally from cache.
- **No per-client session Map**: Never reintroduce per-client session tracking or an `MCP_MAX_SESSIONS` cap.
- **Timeouts & Persistence**: Per-request timeout only (`MCP_REQUEST_TIMEOUT_MS`, default 10m). Tokens persist in `scripts/oauth.js`; Funnel routing is ephemeral.

## Process topology (Stage 2 — single process)

1 Node process. `start.js` orchestrates: in-process gatekeeper (OAuth + `/mcp`), panel, a boot-time `warmToolsServer()` call. The `scripts/aki-pmcontrol/` daemon child (finished copy of private lab `aiobox/labs/aki-pmcontrol`, except `package.json`, a local `{"type":"commonjs"}` shim; see `docs/feat/tools.md`) is never started at boot — `scripts/postman-mcp.js`'s `launchPostmanDaemon()` is its one spawn path, triggered only by clicking Launch Postman in the panel's Postman tab (`POST /api/postman-launch`). Status/quit also honor `~/.aki/cdp-postman/daemon.pid` so a lab-started daemon is not invisible to Ctrl+C (that legacy dir keeps `data.json`/`daemon.pid`/`new-window.flag`; per-provider chat prompts live under `~/.aki/mcpsv/prompts/`, the same `$AKI_DATA_DIR` SSoT as the main server — unifying the two dirs is a deliberate follow-up, not done here). `scripts/tools-server.js` builds the one shared `McpServer`, mounting `shell`, `agy`, `kiro`, `search`, `filesystem`, `postman` as `register(server)` modules (tool namespace: `aki__*` — `aki__run_cmd`, `aki__agy_run`, `aki__kiro_read`, `aki__find_path`, `aki__search_content`, `aki__postman_status`, plus the native filesystem tools). `streamable-bridge.js` talks to it directly over `InMemoryTransport`; no `mcp-hub`, no third-party filesystem child. Folder scope (`scripts/roots.js`) is read fresh from `setting.json` on every call — a panel save takes effect on the next tool call, no restart.

## Release process

Governed directly by `RULE-release.md` (`B4`, `B6`, `B7`). Repo-specific deltas:
- **No `releases.json`**: CLI/local app; `CHANGELOG.md` + GitHub Release are the only release artifacts.
- **Bare semver tags**: New git tags must be bare semver (`1.7.0`, not `v1.7.0`). Existing `v1.x.x` tags are immutable history. Display title may show `v{version}`.
- **Drift check**: Before committing, verify section numbers in `scripts/config-page.js`, `README.md`, and `docs/index.md`.
- **Immutability**: `done/` plan docs and released CHANGELOG blocks are read-only.
