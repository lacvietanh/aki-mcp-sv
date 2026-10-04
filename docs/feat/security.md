# Security

> updated 2026-10-04 · v3.0.0

The one place for akimcp's whole security picture: stance, every surface and its gate, the connection limits, who holds access and who uses it, what each secret on disk unlocks and how to revoke it, and what is logged. README carries a summary and points here. Design record for client activity and the security-only log: `docs/plan/done/client-activity-and-security-log.md`.

## Design stance — convenience first, guardrail second

The root the rest of this doc, the README Security section, panel section 6 and `feat/tools.md` defer to. Owner decision, 2026-09-29.

- **Priority order:** (1) convenient use, (2) safety. The guardrail exists so that convenience is not paid for with accidents; it never outranks convenience.
- **Owners allow everything in practice.** Clients such as Claude Code already have an auto mode that permits every command, and a deny rule leaves no reason to use akimcp at all. So akimcp is not a fortress and does not add another permission layer for the owner to configure.
- **What the guardrail is for:** stopping "weak" models — less safe than Claude, or overeager and not yet safe to trust — from doing damage. Such models (the `agy` ones) make per-call approval prompts unbearable, which is why the guardrail is a fixed allowlist rather than a question asked on every call.
- **What the guardrail must be:** clearly delimited (the line between what runs freely and what needs the owner is explicit), principled and professional, balanced between convenience and security, and free of nuisance. A rule that is complex, intrusive or hard to explain fails this bar even when it is safer.
- **Durability is part of the bar:** akimcp is meant to run for weeks unattended. Every security mechanism keeps bounded memory, writes to disk only on rare events (a registration, an approval, a token grant, a settings save), and logs only what changes the security state.

Consequences already decided:
- The shell allowlist is the guardrail. Commands the owner adds are the owner's responsibility.
- Command arguments are not path-scoped (only `cwd` is): too complex and intrusive for the gain.
- Tools are not split into read/write variants to carry permissions: clients differ, and the owner allows everything anyway. What needs safety goes back to the allowlist.
- A dedicated tool beside `run_cmd` earns its place only by saving tokens (compact output for reads); otherwise `run_cmd` covers it, and its description steers the model to the tool that does it cheaper.

## Surfaces at a glance

| Surface | Who can reach it | Gate | Code |
|---|---|---|---|
| OAuth endpoints (`/.well-known/*`, `/register`, `/authorize`, `/token`, `/revoke`) | anyone who learns the public hostname (`503` when no ingress) | redirect allowlist, passphrase, PKCE S256, client secret for Claude; connection limits | `scripts/oauth.js`, `scripts/gatekeeper.js` |
| `/mcp` over the ingress | same | Bearer access token | `scripts/gatekeeper.js` |
| `/mcp` on `127.0.0.1:9999` | processes on this machine, including browser pages | Bearer access token (never skipped on loopback) | `scripts/gatekeeper.js` |
| Control panel `127.0.0.1:9998` | processes on this machine | per-start panel token in URL and `x-panel-token` header; never exposed through the ingress | `scripts/panel.js` |
| Tools (files, search, git, shell) | whoever holds a valid access token | folder scope, shell allowlist, trusted script zones | `scripts/roots.js`, `scripts/allowlist.js`, `scripts/shell-mcp.js` |

## Remote auth — minimal OAuth 2.1

```
claude.ai / ChatGPT / Grok / Gemini / Notion
   │  GET /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
   │      (/.well-known/openid-configuration is an alias of the latter, so ChatGPT can auto-discover registration_endpoint)
   │  ChatGPT, Grok, Gemini, Notion (and optionally Claude): POST /register  (DCR)
   ▼
gatekeeper.js  ── /register  → RFC 7591, redirect URI must be allowlisted
               ── /authorize → confirmation page, requires the passphrase
               ── /token     → PKCE S256; confidential clients need client_secret (form body or Basic header), DCR public clients use none
               ── /revoke    → RFC 7009; signs out only the calling client, the shared access token stays
               ── /mcp       → Bearer access token required, else 401 + WWW-Authenticate → tools server (in-process)
```

- **Claude (pre-registered):** Client ID/Secret from `oauth-client.json`, shown in panel section 1, pasted into claude.ai's advanced settings. Redirect fixed to `https://claude.ai/api/mcp/auth_callback`, auth method `client_secret_post`.
- **ChatGPT, Grok, Gemini (DCR):** the provider calls `POST /register`; each connector instance becomes one entry in `oauth-dcr-clients.json`. Auth method `none` (PKCE only). Redirect allowlist (`isAllowedRedirect`): the Claude callback, `chatgpt.com/connector/oauth/*` and the legacy ChatGPT callback, `grok.com/connectors-oauth-exchange-code/*`, `oauth-redirect.googleusercontent.com/r/*`. Registration is open by design: a registered client still has to pass the passphrase.
- **Notion (DCR, confidential):** Notion custom MCP registers with `client_secret_basic` or `client_secret_post` and gets a generated secret. Its callback must be https on exactly one of `notion.so`, `www.notion.so`, `app.notion.so`, `notion.com`, `www.notion.com`, `app.notion.com`, `mcp.notion.com` (parsed hostname; lookalikes, userinfo and `#` rejected). The scope Notion asks for is carried to the token and echoed; a refresh may narrow it, never widen it. It grants nothing extra: tools stay gated by folders and the allowlist. `POST /revoke` from a client drops that client's refresh grant (revoking the shared access token signs only that client out). Ported from PR #7 (TheLucasHenry), except its per-connector access token, which contradicts the single token.
- **Hardening from the same PR:** a `client_id` such as `constructor` or `__proto__` no longer resolves a prototype member and crashes the process; a `/register` body that is `null`, an array or a scalar returns `400`; a rejected callback logs only its origin, unknown grant types log as `unsupported`, and request logs omit the query string.

The two layers that actually block access:
1. **Passphrase at `/authorize`** — 10 random characters from `abcdefghjkmnpqrstuvwxyz23456789` (31 symbols, about 49.5 bits). Without it no authorization code is issued. Deliberately not a bare Approve button: `POST /authorize` is public, and a scripted request cannot be told apart from a click without a secret.
2. **PKCE S256** — a token is issued only to the client whose `code_verifier` matches the `code_challenge` of that authorization.

**Whoever knows the passphrase can get a token.** They can register their own client and read the code off the redirect. The passphrase is therefore the real key, and a leaked passphrase is handled as a leaked token (see When something leaks).

Tokens: there is exactly one access token, shared by every client, TTL 1 year (`getOrIssueAccessToken`, design: `docs/plan/done/single-access-token.md`). Refresh tokens are per authorization, bound to their client, and do not expire. Panel section 1 shows the token and offers *Roll token* (new access token, refresh kept: OAuth clients — Claude, ChatGPT, Grok, Gemini, Notion — refresh silently on their next `401`; a token pasted as a fixed bearer has no refresh and gets `401` until re-pasted, which is why only local snippets take a pasted token and Notion connects with the passphrase like the other web AIs) and *Roll & sign out all clients* (also clears refresh tokens: every AI reconnects with the passphrase). Both files survive restarts: a connector is long-lived access, not a login session.

The ingress (Tailscale Funnel by default, a `PUBLIC_ORIGIN` edge, or a Cloudflare tunnel via `--tunnel`) only terminates TLS and forwards to the same loopback server; it never changes the trust boundary. Without an ingress, discovery, `/register`, `/authorize` and `/token` return `503` while local `/mcp` keeps serving; attaching one takes effect on restart.

## Loopback — zero trust on 127.0.0.1

The gatekeeper binds `127.0.0.1:9999` (`9997` in `--dev`) at startup, with or without an ingress, so local clients (Cursor, Claude Code, AGY, Codex, Postman) connect directly.

1. **Bind `127.0.0.1`, never `0.0.0.0`.** The kernel refuses packets from other machines, so nothing on the same Wi-Fi or LAN reaches the port.
2. **The Bearer token stays mandatory on loopback.** A browser on the same machine can run a hostile page that fires `fetch('http://127.0.0.1:9999/mcp')`; without a token that is remote code execution through `run_cmd`. The defense is token secrecy, not CORS: the gatekeeper answers `Access-Control-Allow-Origin: *`, so a page can send the request but cannot supply the token, and gets `401`.

Use the literal `127.0.0.1`, never `localhost`: on macOS `localhost` can resolve to `::1` while the server listens on IPv4 only.

## Connection limits

`scripts/rate-limit.js`, wired in `scripts/gatekeeper.js`, configured in panel section 7 (Security & connection limits). Only **failures** count, so a caller with valid credentials is never counted or refused.

| Setting (`setting.json` → `rateLimit`) | Default | Meaning |
|---|---|---|
| `enabled` | `true` | off lifts every block at once |
| `failMax` / `failWindowSeconds` | 5 / 60 | rejected credentials allowed per caller in the window |
| `blockMinutes` | 15 | how long the caller is then refused (`429` with a counting-down `Retry-After`) |
| `registerMax` / `registerWindowMinutes` | 100 / 10 | `POST /register` per caller in the window (every attempt counts: it writes a file); the block lasts one window |
| `maxClients` | 500 | registered DCR clients stored; beyond it `/register` answers `429 too_many_clients` |

- **What counts as a failure:** `401` only — wrong passphrase at `/authorize`, wrong client secret at `/token`, invalid Bearer on `/mcp`. `400` and `404` never count: they happen during ordinary connects. Connecting many providers in a row is never blocked.
- **When a block ends:** by itself after `blockMinutes` (the counter restarts from zero), when the owner presses Release (one caller, or everyone) in panel section 7, when limits are turned off, or on restart. The panel lists every blocked caller with its remaining time.
- **Valid Bearer always passes:** a caller that is blocked but holds the real token keeps working, so an attacker's failures from a shared address never cut an existing connection.
- **Settings are read on every request**: a save applies at once. A missing or malformed value falls back to its default (`LIMIT_DEFAULTS`).
- **Caller key:** the socket address; when the peer is loopback (tunnelled traffic), `CF-Connecting-IP`, else the last `X-Forwarded-For` entry, else the single bucket `loopback`. Headers are read only from a loopback peer, and the key is cut to 64 characters.
- **Footprint:** in memory only, at most 10,000 caller keys per limiter, a few timestamps each.

Verdict record (`proportion.C1`):

| Measure | Value |
|---|---|
| Reach | anyone who learns the public hostname (estimated: Funnel hostnames appear in certificate transparency logs, so scanners find them) |
| Capability | plain HTTP requests (estimated: lowest rung) |
| Motive | shell and file access on the owner's machine (estimated: high) |
| Blast radius | brute force cannot succeed (49.5-bit passphrase, 256-bit token; at 1,000 guesses per second trying every passphrase takes about 26,000 years, calculated; at the default 5 per minute per address, far longer); the reachable harm is a disk and CPU flood through unauthenticated `/register` and log noise, recoverable |
| Rung | 2: enforced once at the gatekeeper, the trust boundary that already exists |

**Reopen when** the ingress is confirmed to forward no client address (then per-caller keys need another source or a global cap), a second user or a shared host is added, or the passphrase becomes user-chosen.

## Tool reach — folders, shell allowlist, trusted zones

- **Folders:** every file, search and git tool, and every shell `cwd`, is confined to the folders in `setting.json` → `folders` (default `$MCP_DATA_DIR`, i.e. `$HOME`, plus `~/.aki` and `~/.claude`), read fresh on every call. `~/.claude` is reachable at folder level, so session tokens and chat history inside it are in reach; the panel row is locked, edit `setting.json` to remove it.
- **Shell allowlist:** `run_cmd` uses `execFile`, never a shell, and refuses `; & | \``. A binary runs only if it is on the allowlist (inspection-first by default: reads plus a few dev and media helpers; flag-rich binaries that escape read-only, such as `find` and `sort`, are kept out; `git branch`/`tag`/`remote` pass in their read forms only). Bare `git` on the list means every git command. Edited in panel section 6; any command the owner adds is the owner's responsibility.
- **Trusted script zones:** a script under `shell.allowlistDirs` (default `~/.claude/skills`, `~/.aki/akidevrule`, the folders the akidevrule installer writes) runs without an allowlist row. The check resolves symlinks on both sides, lets `node`/`python3`/… through only when the zone script is the first argument (so `node -e`, `node --eval=… script` and `node --require other.js script` stay blocked; an interpreter flag such as `python3 -u` needs an allowlist row), and excludes shells. Write and run cannot chain: the file tools refuse any path inside a zone (`scripts/roots.js:resolveRealWritable`). Shell commands the owner opts into that write files (`cp`, `git checkout`, …) are outside that guarantee.

## Who holds access, who uses it

Panel section 7 shows two tables and the security log, refreshed with the section's Refresh buttons.

- **Clients** (`listClients()`, `scripts/oauth.js`): every client record, the Claude pair included, with name (self-declared), kind, redirect host, first seen, last approval, last token grant, and the caller address and User-Agent at that moment. The fields live on the client record itself (`firstSeenAt`, `approvedAt`, `tokenAt`, `lastAddress`, `lastAgent`) and are written only on registration, approval and token grant. The client files are written atomically (temp file, then rename). Records from before tracking show "before tracking". **Signed in** means the client holds a refresh token and can renew access on its own.
- **Dead clients are cleared** (`pruneClients()`, at start and at every `/register`): a DCR client never approved within 1 hour of registering goes, so strangers cannot fill `maxClients` and lock the owner out; any other DCR client goes once it holds no refresh token and has been idle 30 days (records from before tracking count as idle). The 30 days let a connector reconnect with its stored client ID after Roll & sign out all clients.
- **Remove / Sign out** (`removeClient()`, `POST /api/clients/remove`): drops the client's refresh tokens and forgets a DCR record; the Claude pair is only signed out, since its ID and secret are pasted into claude.ai. The shared access token the client already holds keeps working until Roll token; the other clients renew on their own after that roll.
- **Active now** (`scripts/callers.js`): callers that used the valid token since the last restart, keyed by caller address, with User-Agent, first and last seen and request count. Memory only, 64 entries, least recently seen evicted. With one shared token this is the only view of `/mcp` usage; it cannot name the client.
- **The one action for anything unrecognized:** Roll passphrase, then Roll & sign out all clients (section 1). A client can only have been approved with the passphrase.

## Secrets on disk

All under the data dir (`~/.aki/mcpsv/` by default), mode `0600`, never inside the repo.

| File | Holds | Leaked alone means | Revoke |
|---|---|---|---|
| `passphrase.txt` | consent secret for `/authorize` | anyone can obtain a token | panel section 1: Roll passphrase, then Roll & sign out all clients |
| `tokens.json` | the shared access token and every refresh token; AIObox's Notion connect macro still reads the access token to paste as Notion's bearer, until it moves to the passphrase flow | full tool access | Roll & sign out all clients (or delete the file and restart) |
| `oauth-client.json` | Claude's Client ID/Secret | nothing without the passphrase | delete and restart, paste the new pair into claude.ai |
| `oauth-dcr-clients.json` | registered public clients (no secret) | nothing | delete and restart; every DCR connector reconnects |
| `setting.json` | folders, allowlist, trusted zones, limits | not secret, but a write widens access | the local owner (panel or editor); also the file tools while the data dir is under an allowed folder, see Real limitations |
| `tool-calls.jsonl` | one line per `aiobox*` / `chrome_*` / `devtools_*` call: time, client, user agent, `op`, `window`, `port`, ok or error, never the arguments' text (rotated at 1 MB) | which AI drove which window, when | delete any time |
| `aiobox-seen.json` | the AIObox window map last seen (handle per targetId, chat ids), for renumbering warnings | which chats are open | delete any time; the next call starts a new baseline |

The panel token lives only in memory and changes on every start; `instance.json` (0600) carries it with the panel port and the running ingress origin so AIObox can call the loopback panel, and is removed on shutdown. Which of these files AIObox reads, and in what shape, is pinned in `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` and `test/aiobox-contract.test.js`.

## When something leaks

| Suspicion | Do | Why that is enough |
|---|---|---|
| Passphrase seen by someone | Roll passphrase, then Roll & sign out all clients | the new passphrase stops new authorizations; the hard roll evicts any token already obtained |
| Access token seen (screenshot, pasted snippet) | Roll & sign out all clients | a soft roll leaves refresh tokens, which a holder could use to get the new token |
| Unknown client in the list, or a caller you do not recognize using the token | both rolls, as for the passphrase | a client can only have been authorized with the passphrase |
| A connector you no longer use | Remove it in section 7, then Roll token | removal ends its refresh; the roll ends the access token it holds |
| A flood of failed attempts | nothing; the limits handle it | brute force is infeasible; Release in panel section 7 if your own address got blocked |

## What is logged

`[security]` events go through `logSecurity()` (`scripts/security-log.js`): printed to the console and appended to `security.log` in the data dir, which moves to `security.log.1` at 1 MB, so the file pair never exceeds about 2 MB. Panel section 7 shows the newest 200 lines of the current file. Everything else is console only (`scripts/log.js`, timestamped). Only events that change or threaten the security state print, so the log stays readable after weeks and an attacker cannot make it grow at will.

| Printed | Not printed |
|---|---|
| `[security]` wrong passphrase (with caller), client approved (name, redirect host, first approval), token granted (grant type, client), passphrase rolled, client removed or signed out from the panel, access token issued or rolled (console only) | `/mcp` 2xx, 202 and 405 access lines |
| `[security]` `/mcp` rejected bearer (with caller), caller blocked, caller released, limits saved | `/register` 201 (the client appears in the panel; its approval is the event) |
| `[security]` token used by new caller (first valid request from an address since start) | `429` refusals (the block line already said it) |
| `[gatekeeper]` access lines for discovery, `/authorize`, `/token` (rare; `CLAUDE.md` RECURRING #1 is diagnosed from them), and every 5xx | `404` on unknown paths (scanner noise) |
| registration rejected (redirect not allowlisted), token failures | |

Volume: idle, nothing; a normal day, tens of lines; under attack, at most `failMax` failure lines and one block line per address per `blockMinutes`.

## Footprint over a long run

| Thing | Bound |
|---|---|
| limiter state | memory, ≤ 10,000 caller keys per limiter |
| live callers | memory, 64 entries |
| authorization codes | memory, expired ones swept whenever a new code is added |
| refresh tokens | one per approval, persisted; tokens of a client that no longer exists are dropped at start |
| DCR clients | file, ≤ `maxClients`; unapproved ones expire after 1 hour, signed-out ones after 30 idle days |
| security log | file, ≤ 1 MB plus one rotated copy |
| disk writes | only on registration, approval, token grant, roll, settings save and a security event |

## Real limitations

- **One shared access token, so removing a client is not instant revocation:** Remove ends its refresh, but it keeps the current access token until Roll token; a leak is a leak for all. It also means `/mcp` traffic cannot be attributed to a client, only to a caller address.
- **A fixed-bearer client breaks on every roll:** a custom MCP given the access token as a pasted bearer holds no refresh token, so Roll token (soft or hard) cuts it off until the token is pasted again, and so does the 1-year TTL. Notion is therefore connected with the passphrase, never with a pasted token; AIObox's Notion connect macro still pastes one until it moves to the passphrase flow.
- **No refresh token rotation** for the pre-registered Claude client (the spec's rotation rule targets public clients).
- **The limiter is in memory and keyed per caller:** a restart clears it, a caller who can forge the forwarding headers picks its own key, and an ingress that forwards no address puts every remote caller in one bucket.
- **DCR stores one client per connector instance**; a connector deleted on the provider's side keeps its refresh token here, so it stays listed as signed in until removed in section 7.
- **The file tools reach akimcp's own data dir:** `~/.aki` is a default folder, so `write_file` / `edit_file` can change `setting.json` (folders, shell allowlist, trusted zones) and `read_text_file` can read `tokens.json` and `passphrase.txt`. A connected model can therefore widen its own shell allowlist; the allowlist guards against a model's mistakes, not against a model that sets out to remove it. Narrowing this (refusing the control files in the file tools) is an open owner decision.
- **`local_fetch` checks the host it is given, not what a DNS name resolves to:** a name pointing at a link-local address is not caught.
- **Client names are self-declared** by whoever registered; the redirect host (allowlisted) and the first-seen time are the trustworthy columns.

## Cross-references
- `docs/plan/done/client-activity-and-security-log.md` — decisions behind client activity, live callers, the security-only log and pending-registration expiry
- `docs/plan/done/single-access-token.md` — why one shared access token
- `docs/research/claude-ai-oauth-connector.md` — research that drove the Claude pre-registered path
- `docs/ref/claude-connector.md`, `docs/ref/chatgpt-connector.md` — connector dialogs
- OpenAI Apps SDK auth: https://developers.openai.com/apps-sdk/build/auth
