# Web chat client: temporary token + public guide

Status: done, shipped in 3.2.0. Council rooms: `~/.aki/agent-council/aki-mcp-sv/2026.10.26-2102-temp-token-webchat/` (build), `~/.aki/agent-council/aki-mcp-sv/2026.10.27-0017-temp-token-webchat-ship/` (ship).

## Problem

A web chat that can send HTTP requests but offers no custom MCP connector cannot use AkiMCP today. Pasting the shared access token would work but hands it a year-long key and forces Roll token (which breaks every pasted-bearer client) to take it back. Wanted: the owner gives the chat a guide URL, the MCP URL and a token that dies on its own, and the chat ends it when its job is done, touching no other token or client. Sources merged: the pinned note "feat: temporary token", `AKIMCP-VM-CLIENT-SETUP.md`, `mcp-over-http-postman-agent-playbook.md`.

## Decisions

| # | Decision | Because | Rejected | Reopen if |
|---|---|---|---|---|
| D1 | Temp tokens live in memory only: `tempTokens` Map in `scripts/oauth.js`, sha256 → `{ created, expires, revoked }` | restart fails closed, no migration, `tokens.json` (AIObox contract, single valid `access`) and `retired-tokens.json` untouched | an `access` entry with a flag (collapse drops it, AIObox picks it); `temp-tokens.json` (needs `CREDENTIAL_FILES` and cleanup) | the owner restarts AkiMCP mid-chat often |
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
- [x] CHANGELOG `[Unreleased]` (publisher)

Web
- [x] the web repo holds the guide at `public/guide/mcp-http/v1.md`, byte-equal to core (sha256 `290ddbe6…05a9`), and `public/_headers` covers `/guide/*`; its prebuild pulls the file from core `main` (`scripts/pull-panel.js`)
- [x] pitch line in the web positioning and the `/connect/` section
- [x] release order: core `main` is pushed first (the web prebuild reads it), then the npm publish, then the web push, then the tag and GitHub Release by `gh release create` once the live guide answers 200

Release
- [x] 3.2 stayed `[Unreleased]` until the public-origin protocol check passed and the owner ordered `/akiship`

## No action

- Per-token scope or tool limits: same tools as the shared token (D2).
- Persisting temp tokens across a restart (D1).
- Extending a temp token: mint a new one.

## Live check

Checked 2026-10-27 on the public origin (`https://mba20.akitao.com`, `fresh-chat.md`): `POST /api/temp-token` (4 h TTL, kickoff block), `GET /guide/mcp-http/v1.md` (`200 text/markdown`, CORS `*`, sha256 `290ddbe6…05a9`), `OPTIONS` preflight (`204`, `DELETE` allowed), `initialize` (`200`, `MCP-Session-Id`), `notifications/initialized` (`202`), `tools/list` (`200`, 33 tools = shared token 33 tools exact match), `tools/call aki__list_allowed_directories` (`200`), `DELETE <MCP_URL>` (`204`), second `DELETE` (`401`), `tools/list` after revoke (`401 invalid_token`), `GET /api/temp-tokens` (`0` rows). Pasting the kickoff into a provider's web chat UI was skipped by owner order (2026-10-27).
