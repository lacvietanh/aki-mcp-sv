# Web chat client: temporary token + public guide

Status: 3.2, unreleased until the owner's preview. Council room: `~/.aki/agent-council/aki-mcp-sv/2026.10.26-2102-temp-token-webchat/`.

## Problem

A web chat that can send HTTP requests but offers no custom MCP connector cannot use AkiMCP today. Pasting the shared access token would work but hands it a year-long key and forces Roll token (which breaks every pasted-bearer client) to take it back. Wanted: the owner gives the chat a guide URL, the MCP URL and a token that dies on its own, and the chat ends it when its job is done, touching no other token or client. Sources merged: the pinned note "feat: temporary token", `AKIMCP-VM-CLIENT-SETUP.md`, `mcp-over-http-postman-agent-playbook.md`.

## Decisions

| # | Decision | Because | Rejected | Reopen if |
|---|---|---|---|---|
| D1 | Temp tokens live in memory only: `tempTokens` Map in `scripts/oauth.js`, sha256 → `{ expires, revoked }` | restart fails closed, no migration, `tokens.json` (AIObox contract, single valid `access`) and `retired-tokens.json` untouched | an `access` entry with a flag (collapse drops it, AIObox picks it); `temp-tokens.json` (needs `CREDENTIAL_FILES` and cleanup) | the owner restarts AkiMCP mid-chat often |
| D2 | One check point: `bearerStatus` answers `valid` on a live temp hash, `retired` on a revoked or expired one | gatekeeper's existing retired-401 path needs no new branch; a finished chat is never counted as a failed login | a second verifier in the gatekeeper | a provider must not get `run_cmd` (then scope it) |
| D3 | TTL is one constant, 4 h, no picker; temp tokens are many at once; no refresh grant, no client | a chat job is short; fewer knobs | picker, 24 h cap | jobs routinely outlive 4 h |
| D4 | Self-roll = `DELETE <MCP_URL>` with the temp Bearer: revokes that hash and ends the session; the same token then gets `401` | one spec-native request, works without ingress, shared-token DELETE unchanged | RFC 7009 `POST /revoke` (client auth, 503 without ingress); `/mcp/revoke` (new route, same act) | an SDK sends DELETE on close by itself |
| D5 | Hard roll revokes temp tokens; soft roll leaves them | hard roll means "token may have leaked" | soft roll also | never |
| D6 | Panel `POST /api/temp-token` (loopback, `x-panel-token`) returns the one-time kickoff block `GUIDE / MCP_URL / TOKEN / EXPIRES` under an owner-voice order line; needs a public origin. `GET /api/temp-tokens` lists live ones, `POST /api/temp-token/revoke` ends one or all. UI: panel section 1, Web tier, tab *Any HTTP chat* | the token is shown once, the owner pastes a ready block; the order in the owner's voice keeps the fetched guide pure spec | a CLI, a file | owner wants it without ingress |
| D7 | The guide is one plain `.md` at `https://akimcp.top/guide/mcp-http/v1.md`; canonical copy in core `public/guide/mcp-http/v1.md` (core serves it with `text/markdown`, so preview needs no deploy), the web repo pulls it byte for byte; raw HTTP only (no SDK bridge); address is one constant, `GUIDE_URL` in `scripts/config-page.js` | every provider's fetch tool reads a static file; installs never auto-upgrade, so the path carries `v1`; bumped only when a chat following the old text would fail | HTML page; unversioned path; SDK section; a second copy edited by hand in the web repo | Hands shows raw HTTP failing where the SDK works |

## Guide sections

The text and its section map live in `public/guide/mcp-http/v1.md` only (writer owns the text). The order line lives once, in `tempTokenKickoff` (`scripts/config-page.js`); the guide section 0 quotes it.

## Checklist

Core
- [x] `scripts/oauth.js`: `tempTokens`, `mintTempToken`, `revokeTempToken`, `bearerStatus`, hard roll
- [x] `scripts/gatekeeper.js`: DELETE on `/mcp` revokes the temp Bearer, `Access-Control-Allow-Methods` gains DELETE
- [x] `scripts/panel.js` + `scripts/config-page.js` + `public/panel-client.js`: `POST /api/temp-token`, section 1 button, `GUIDE_URL`, kickoff block
- [x] `test/temp-token.test.js`
- [x] `scripts/http.js`: `.md` MIME; `docs/feat/security.md`, README, `docs/index.md` drift
- [ ] CHANGELOG `[Unreleased]` (publisher)

Web (after the web room closes)
- [ ] pull the guide from core `main` into the web repo `public/guide/mcp-http/v1.md` (needs core `main` pushed: owner), `public/_headers` for `/guide/*`
- [ ] pitch line in the web positioning and the `/connect/` section once Hands names which providers can do it
- [ ] release order: the guide file reaches akimcp.top with or before the core 3.2 publish; the pitch pages wait for core

Release
- [ ] 3.2 stays `[Unreleased]`: no bump, tag, publish or deploy until the owner has previewed

## No action

- Per-token scope or tool limits: same tools as the shared token (D2).
- Persisting temp tokens across a restart (D1).
- Extending a temp token: mint a new one.

## Live check

Not run. Needs a fresh web chat holding only the kickoff block. Core serves the guide at `<public origin>/guide/mcp-http/v1.md` now, so the owner's preview needs no deploy (put that URL on the GUIDE line); the panel constant stays the akimcp.top address, which answers after the web deploy.
