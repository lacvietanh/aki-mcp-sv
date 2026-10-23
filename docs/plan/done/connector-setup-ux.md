# Plan — connector setup UX: one auth ladder for every provider, local Claude (app and Claude Code), ClickUp

Status: done 2026-10-22 (ClickUp, the Claude Code & app tab, live checks of step 4). Gemini's live connect ([`gemini-oauth-dcr.md`](gemini-oauth-dcr.md)) stays optional, since the panel marks Gemini not recommended; Buda's own form is not run (step 4).

## Problem

| # | Fact | Source |
|---|---|---|
| F1 | Panel section 1 has a local "Claude Code" tab holding one `claude mcp add` line, and nothing for the Claude desktop app | `scripts/config-page.js:261`, `:371` |
| F2 | The web "Claude" tab opens claude.ai's Add custom connector; it does not say whether a connector added there also appears in the Claude app, nor that it needs the ingress while the local tab does not | `scripts/config-page.js:266`, `:274` |
| F3 | Someone with both the Claude app and Claude Code cannot tell from the panel which path each one takes, whether one setup covers the other, or which to pick; owner 2026-10-21: the panel must leave no aspect that makes the user unsure | owner |
| F4 | A local stdio entry already exists, `scripts/stdio.js` (AGY uses it); it needs no token, so Roll token does not break it | `scripts/stdio.js:2`, `scripts/config-page.js:124` |
| F5 | ClickUp's Connect an MCP Server form offers `OAuth`, `Authorization header`, `No Authentication`. With `OAuth` and Advanced configuration closed, Next makes ClickUp read AkiMCP's OAuth metadata and `POST /register` (DCR) with the callback `https://search.clickup-prod.com/connect/mcp`; Advanced configuration takes a Client ID/Secret/Scopes instead | AIObox window P7·W331 via `aki__aiobox` and `aki__devtools_eval`, server log `[oauth] register REJECTED (redirect_uri not allowlisted): ["https://search.clickup-prod.com"]`, 2026-10-21 |
| F6 | That callback is now allowlisted as the exact URL; `test/oauth.test.js` accepts it and rejects `/other` and a lookalike host | `scripts/oauth.js` `CLICKUP_CALLBACK` |
| F7 | The pre-issued client accepts any allowlisted callback and `client_secret_post` or `client_secret_basic`, so an OAuth client without DCR needs only its callback allowlisted | `scripts/oauth.js:27`, `:239`, `:390` |
| F8 | An OAuth client gets its own refresh token, so Roll token does not break it; the access token goes server to server; the panel lists it by name and removes it alone. A Bearer client holds the same shared access token with no refresh: Roll token breaks it until the new token is set again, and it cannot be removed alone. Both are automatable by a tool on the user's side | `CLAUDE.md` § Two client paths; aiobox `docs/feat/akimcp-connect.md` rule 9 |
| F9 | Buda's Add MCP server form has Name, Connection type (Remote HTTP, or Local stdio, which starts a command inside Buda's own agent runtime, not on the user's computer), HTTPS endpoint and Authentication headers (+ Add header); no OAuth, so Buda stays on rung 3 | owner's screenshot 2026-10-22 |
| F10 | claude.ai custom connectors are "configured and brokered through your Claude account", and "Claude connects to your remote MCP server from Anthropic's cloud infrastructure, rather than from your local device", for "every Claude client, including claude.ai, Claude Desktop, Cowork, and the mobile apps"; "Local MCP servers configured in Claude Desktop via `claude_desktop_config.json` are a separate mechanism … not available in Cowork or claude.ai" | support.claude.com article 11175166 "Getting started with custom connectors using remote MCP", read 2026-10-22 |
| F11 | Claude Desktop runs on macOS, Windows and Linux; its config is `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), the Linux path is not given; a local server is an `mcpServers` entry with `command`, `args`, `env`; the app needs a full quit and restart to load it; no remote `url` entry is documented for this file | modelcontextprotocol.io "Connect to local MCP servers", read 2026-10-22; Claude 2.42304.2 on macOS has the file with an empty `mcpServers` |

## Facts to verify before building (rung 3–5, `coding.B3`)

- [x] V1. Yes, on every OS (F11). The panel sends the user through the app's own Settings → Developer → Edit Config, which opens the file wherever it lives, so no per-OS path is needed; `scripts/stdio.js` is the entry AGY already runs.
- [x] V2. Yes: a claude.ai connector belongs to the account and every Claude client, the app included, reaches it from Anthropic's cloud, so it needs the ingress even on the machine running AkiMCP (F10).
- [x] V3. Only stdio is documented for the app's local config; remote servers go through the account's connectors (F10, F11).
- [x] V4. ClickUp is rung 1: it self-registers (F5). Its live sign-in is step 4.
- [x] V5. No: Buda's form has headers only (F9).

## Outcome

- **Claude, one place, two clients.** The local group's "Claude Code" tab becomes "Claude" with two labelled blocks: **Claude Code (terminal)** with the command, and **Claude app (desktop)** with the config that V1 confirms. One line above both answers the three questions F3 names: each client is set up on its own, setting up one does not connect the other; local = the computer running AkiMCP only, no ingress, 0 ms; the web "Claude" tab = claude.ai (and the app, if V2 holds) on any device, needs the ingress. Each block says what Roll token does to it (Claude Code: paste again; stdio: nothing).
- **Web "Claude" tab** gains one line pointing at the local tab for use on the computer running AkiMCP, and the V2 answer about the app.
- **ClickUp tab** in the web group (done): Settings → App Center → MCP Servers → OAuth, Advanced configuration closed, passphrase in the tab ClickUp opens; no Client ID, secret or token; Brain uses the tools without a mention.
- `README.md` § Connecting local IDEs and the connector list in section 1's help text name the same paths.

## Decided

| # | Decision | Why |
|---|---|---|
| D0 | **One auth ladder for every provider; take the highest rung it offers.** 1 · OAuth with DCR: URL + passphrase. 2 · OAuth without DCR: URL + the pre-issued Client ID/Secret + passphrase. 3 · Bearer header, only when the provider has no OAuth | Rungs 1–2 survive Roll token, refresh on their own and are removable per client (F8); the only AkiMCP change per provider is its callback in `isAllowedRedirect` (F7); rung 3 is the fallback, not a choice |
| D5 | **Every rung is automatable; a connector the user must set up by hand is unfinished.** Owner 2026-10-22: "nếu macro mà chưa tự làm được thì là chưa được. vô vàn cách xử lý vấn đề, không thiếu cách để vừa tự động vừa an toàn" | Safety comes from where each key may go, never from leaving a step to the user; the client-side mechanism (AIObox) is outside this repo |
| D1 | ClickUp is on rung 1, its callback allowlisted as the exact URL | F5, F6 |
| D2 | ClickUp is a generic AkiMCP connector tab; AIObox's ClickUp macro is not a reason for it and nothing here names AIObox | `CLAUDE.md` § Stable core: the tab is useful to anyone with ClickUp, as Buda's is |
| D3 | The Claude app's local path uses `scripts/stdio.js` if V1 holds, not a token-bearing HTTP entry | No token to roll or leak, works offline, already shipped for AGY (F4) |
| D4 | Every path and step is given per OS where it differs (Windows, Linux, macOS) | `CLAUDE.md` § OS-agnostic |

## Steps

Follows `CLAUDE.md` § Adding a connector.

- [x] 1. V1–V3 and V5 above, each answer with its source (F9–F11); V1's real run moves to step 4.
- [x] 2a. ClickUp: `scripts/oauth.js` `isAllowedRedirect` + `test/oauth.test.js` for its callback, panel tab, `README.md`, `docs/feat/security.md`, CHANGELOG `[Unreleased]`.
- [x] 2b. `scripts/config-page.js`: local tab **Claude Code & app** with both blocks, the line on the web Claude tab; no ClickUp icon ships in `public/img/providers/`.
- [x] 3. `README.md` § Connecting local IDEs and § Connecting from Claude web, CHANGELOG `[Unreleased]`; no `docs/feat/` line names the local Claude clients.
- [x] 4. Live, by the owner. ClickUp signed in by OAuth 2026-10-21 and 2026-10-22 (`token granted (authorization_code) to ClickUp`) and ClickUp Brain calls AkiMCP's tools; the Claude app loads the stdio entry from the panel and lists AKIMCP's tools (owner, 2026-10-22). ClickUp's first call without a token, which starts its OAuth discovery, no longer counts as a failure (`scripts/gatekeeper.js`, [`panel-order-masking-aiobox-section.md`](panel-order-masking-aiobox-section.md) I7). Not run, by decision: Buda's own form, since a Bearer header on `/mcp` is the path Cursor, Codex and Postman use daily. Proven without a separate check: Claude Code (connected live from `bien` 2026-10-19), Roll token (soft and hard roll in `test/oauth-single-token.test.js`), the connection scope.
