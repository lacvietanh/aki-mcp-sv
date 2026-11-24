# aki-mcp-sv — project guidance

Local MCP server for web/local AIs (Funnel / Cloudflare Tunnel + OAuth 2.1). `npm start` → `scripts/start.js` (foreground, manual stop/start) · `npm test` · `docs/index.md`.

## Stable core — AIObox never drives an AkiMCP change (ABSOLUTE)

Owner 2026-10-05 (`aiobox docs/arch/akimcp-boundary.md` § 0a): "tôi k thích akimcp phải thay đổi chỉ vì aiobox. cần nó ổn định bất kể aiobox phát triển thế nào đi nữa. muốn tinh gọn hiệu quả nhất chỉ 1 lần v3 này thôi, rồi hanj chế thay đổi nó." · "chứ tôi thấy động tí là edit akimcp là không đúng nguyên tắc".

- 3.x is the last AIObox reshaping; afterwards change only for core/security (AIObox features stay in AIObox).
- 2 AIObox tools (`aiobox`, `aiobox_write`, free `op`); `aiobox` mentions in `scripts/` stay within `akimcp-boundary.md` BR-1/BR-9 allow-list.

## OS-agnostic

- Windows/Linux/macOS: say "this computer" (never "this Mac", `~/Library`, `brew` alone); name per-OS steps.
- OS deltas go in `process.platform` tables (`open-browser.js`, `allowlist.js`) or OS-adapter modules; no `if (win32)` in core logic.
- Windows uses Git for Windows Unix tools (`grep`, `find`) — no pure-JS rewrites.
- Permanently removed: `scripts/chrome.js` (Chrome 136 default-profile block ≠ `chrome-mcp.js`) & native folder picker.

## Public repo hygiene

- Zero real secrets/tokens/passphrases in tracked files, commits, or probes (read env or `~/.aki/mcpsv/setting.json`; fakes in fixtures).
- Redact tunnel/Tailscale hosts, non-loopback IPs (except 100.100.100.100), emails, private chat URLs in `docs/`.
- Scan `git diff --cached` pre-commit; unpushed leak fix overrides `done/` immutability.

## Runtime, OAuth & session lifecycle

- **1 process:** `start.js` runs gatekeeper (OAuth + `/mcp`), panel, boot `warmToolsServer()`. `tools-server.js` delegates to `provider-registry.js` (`docs/arch/provider-toolkit.md`); default prefix `aki__` (`mcp-name.js`). `roots.js` reads `setting.json` fresh per call.
- **1 session (`streamable-bridge.js`):** 1 `InMemoryTransport` session (no `mcp-hub`, fs child, SSE; cached `initialize`). No per-client `Map` or `MCP_MAX_SESSIONS`. Timeout: `MCP_REQUEST_TIMEOUT_MS` (10m).
- **Postman daemon:** never boot-started — only `POST /api/postman-launch` (`launchPostmanDaemon()`). Shared `$AKI_DATA_DIR` (`~/.aki/mcpsv`): paths in `postman-data-paths.cjs` (`daemon.pid` honored on quit); `prompts/` in `postman-daemon.cjs`.
- **1 OAuth server (`oauth.js`):** `resolveClient()` SSoT, no per-client branches. DCR (`oauth-dcr-clients.json`, PKCE or confidential e.g. Notion), static (`oauth-client.json`), Bearer (Roll token breaks shared Bearer). Callbacks: `oauth-callbacks.js` + `setting.json` `oauth.callbacks` (re-checked at `/authorize`, never `gatekeeper.js`); codes/refresh bind `client_id`.

## Native command, then guide, then tool

Lowest rung wins; higher rungs need PR evidence:
1. **Native command:** OS/browser/app controls via generic tools (`run_cmd`, `devtools_eval`, `task_start`).
2. **Guide line:** one line in `docs/feat/tools.md`, tool `next`, or AIObox guide (e.g. F1/CDP move).
3. **Tool/op:** mid-task need, native takes 3+ calls or fails in logs (`akimcp-boundary.md` T5′), generic without AIObox.

## RECURRING #1 — Tailscale Funnel desync, NOT the code

`npm start` healthy + funnel "on", `POST /authorize -> 302` with **no `POST /token`** = Funnel TLS desync — **never debug `oauth.js`/`gatekeeper.js`**. Local `curl https://$HOST` gives false 200 on macOS WireGuard `100.100.100.100`:
```bash
H=$(tailscale status --json|jq -r .Self.DNSName|sed 's/\.$//'); curl --resolve $H:443:$(dig @8.8.8.8 $H +short|head -1) https://$H/.well-known/oauth-authorization-server
tailscale funnel --https=443 off && tailscale serve reset && tailscale funnel --bg 9999
```
Ingress: `--tunnel <cred.json>` > `PUBLIC_ORIGIN` > `ingress.json` > Tailscale Funnel.

## Adding a connector

**Read `docs/ref/adding-connector.md` first.** Gates: highest auth rung (OAuth DCR → static → Bearer if no OAuth), macro-automatable (Owner 2026-10-22), no per-client OAuth branch (ClickUp may need reconnect after Roll token), unknown callbacks live via `Other AI (sign-in)` (no release).

## Release process

`RULE-release.md` (`B4`, `B6`, `B7`): no `releases.json` (`CHANGELOG.md` + GitHub Release); bare semver tags (`1.7.0`, `v1.x.x` immutable history, runs `release.yml` Trusted Publishing `@akinet/akimcp`); sync section numbers (`config-page.js`, `README.md`, `docs/index.md`); `done/` & released CHANGELOG read-only; **never suggest removing `public/` images** (panel/README use them; grep misses them).
