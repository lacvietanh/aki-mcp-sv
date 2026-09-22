# Connecting Notion AI to aki-mcp-sv

## Setup

The server must be running with a public HTTPS ingress. Local-only MCP access still works without ingress, but Notion is a remote client and cannot use the loopback URL. In the control panel, finish the ingress setup and use the **Notion** tab under **Web · needs ingress**. Postman remains the default tab for local clients.

1. In Notion workspace settings, enable **custom MCP servers**. Ask a workspace administrator if that setting or approval is unavailable.
2. Open [Notion connections](https://www.notion.so/my-connections). Add an approved **Custom MCP server**, using the **MCP URL** shown in the panel, including its `/mcp` suffix.
3. Connect and enter the **Passphrase** on the AKIMCP confirmation page.
4. Add the connection inside the intended **agent** and **republish the agent**. Approving a workspace connection alone does not attach it to a published agent.

Notion self-registers through Dynamic Client Registration (DCR). There is no Client ID or Client secret to paste. Workspace eligibility, approval permissions, and the names of Notion's settings can vary; this guide does not establish that a particular workspace has access.

The connection exposes the existing MCP tool suite with the existing folder and shell allowlists. OAuth scope is carried through the protocol; it does not introduce per-tool permissions or change those allowlists.

## Protocol contract

### Redirects and consent

Notion callbacks must parse as URLs, use HTTPS, contain no literal `#` anywhere, have no username or password, and use exactly one of these hostnames:

- `notion.so`
- `www.notion.so`
- `app.notion.so`
- `notion.com`
- `www.notion.com`
- `app.notion.com`
- `mcp.notion.com`

Other subdomains, suffix lookalikes, HTTP URLs, userinfo, and fragments are rejected. Paths, queries, and HTTPS ports are not separately restricted. DCR pins each client to the exact redirect URI it registered. The existing Claude, ChatGPT, Grok, and Gemini callback rules are unchanged.

`GET /authorize` presents consent; `POST /authorize` checks the passphrase and issues a code. PKCE **S256 remains mandatory**, including for confidential clients. The trimmed scope is HTML-escaped in the hidden consent field, stored with the code, and returned on token issuance when non-empty.

### Discovery and client registration

Protected-resource metadata is available at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`. The following routes return the same authorization-server metadata:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-authorization-server/mcp`
- `/.well-known/openid-configuration`
- `/.well-known/openid-configuration/mcp`

The OpenID-named routes are discovery aliases, not an implementation of OpenID Connect identity tokens.

Metadata advertises `/authorize`, `/register`, `/token`, and `/revoke`. Both token and revocation authentication method lists are `none`, `client_secret_post`, and `client_secret_basic`.

`POST /register` defaults to `none` when the authentication method is omitted. Public clients receive no secret. Both confidential methods receive a generated secret; unsupported methods return `400 invalid_client_metadata`.

All of these OAuth routes return `503` without ingress. The shared route guard does not change local `/mcp`, static files, `OPTIONS`, wrong methods, or unknown paths.

### Client authentication

`POST /token` and `POST /revoke` share client authentication:

- With no Authorization header, credentials come from the form body's `client_id` and `client_secret`.
- With a Basic header, the payload is Base64-decoded and split at the first colon. Each half is then form-decoded, including percent escapes and `+` as a space, as required by RFC 6749 section 2.3.1.
- A present but malformed, undecodable, or non-Basic header fails authentication; it never falls back to body credentials.
- Public clients need a known client ID. Confidential clients need a matching stored secret, compared with `timingSafeEqual`.

Authentication failure is `401 {"error":"invalid_client"}`. Basic attempts also receive `WWW-Authenticate: Basic realm="aki-mcp-sv"`. Inherited object properties do not resolve as registered clients.

### Scope and refresh

Non-empty scope is included in the token response and persisted on the refresh record. Empty scope is omitted from both. A refresh without a `scope` parameter uses the stored scope; an explicit empty scope narrows it to empty. Every space-separated requested scope part must already be in the stored scope, or the request returns `400 {"error":"invalid_scope"}` without issuing tokens.

A successful narrowing is stored on the same refresh token, so subsequent refreshes cannot recover removed scope parts. Refresh tokens remain non-rotating, and access tokens retain the existing 365-day lifetime. Previously issued access tokens are not removed by scope narrowing.

### Revocation

Send a form-encoded `POST /revoke`, authenticating as above and supplying `token`. Authentication happens first. A missing or empty token returns `400 {"error":"invalid_request"}`. The optional `token_type_hint` does not change lookup: refresh tokens are checked first, then access tokens.

Successful revocation, an unknown token, a repeated request, and another client's token all return the same `200 {}` with no token-status disclosure. A foreign client's token is not deleted. Token-store persistence finishes before the response.

New access records contain `{ clientId, refreshToken, expires }`. New refresh records contain `{ clientId }`, or `{ clientId, scope }` when scope is non-empty. Revoking an owned refresh token removes that refresh token and only the access records that explicitly link to it **and** belong to the authenticated client. Another grant belonging to the same client is not affected. Revoking a single access token does not remove its refresh token or sibling access tokens.

## Existing data and precise legacy limits

Existing 2.1.0 token and DCR files load unchanged, without a startup rewrite, migration, or reset. Storage remains plaintext. Keep credential and token files private and preserve them across restarts.

- Old access records containing only `{ expires }` remain valid until their normal expiry or individual revocation.
- Old refresh records containing `{ clientId }` remain valid. Refreshing one issues a newly linked access record without rotating its refresh token.
- Revoking an old refresh record cannot discover the access tokens issued before links existed. Those unlinked access records remain valid; revoke each known access token separately if it must stop working before expiry.
- A token record with no recorded owner may be revoked individually by an authenticated client presenting that token. This does **not** infer ownership of any other record.
- A refresh cascade never deletes a record solely because ownership or a refresh link is missing. Even an explicitly linked access record is retained when its owner is missing or different. A present but empty or null owner is not treated as an absent owner.
- Existing expired-access cleanup on token-store writes is unchanged.

Do not reset the token file to try to reconstruct missing ownership or links. The server deliberately does not guess them.

## Troubleshooting and rollback

A `503` on discovery or authorization means ingress was not configured at startup. Finish ingress setup and restart. Check that the Notion connection uses the public MCP URL, then reconnect, attach it to the agent, and republish.

If the consent page's Approve button stays on "Confirming…" and no `POST /authorize` reaches the log, the form submission is being held before it leaves the machine, not by this server. A local filtering or ad-blocking proxy that inspects HTTPS is the usual cause; such a proxy also injects its own scripts into this page. Confirm the endpoint independently with `curl -i -X POST <origin>/authorize -d "client_id=test&passphrase=test&code_challenge=test&code_challenge_method=S256&redirect_uri=https://www.notion.so/cb"`, which must return `400` and log `authorize REJECTED (POST)`. If it does, exclude the ingress hostname from the proxy or retry in a browser without extensions.

Rejected callback diagnostics remain available, but log only callback origins. Request logs omit query strings, and authentication diagnostics do not echo submitted credentials. An unknown callback host requires an explicit allowlist review; do not allow arbitrary Notion-looking suffixes.

To roll back, stop the server, reverse the patch, and restart with the existing data files. The old readers tolerate the added record fields, but the Notion-specific protocol additions and panel tab will be unavailable. Rollback does not revoke already issued tokens. Do not restore an older token snapshot: that could resurrect a revoked grant.

For implementation boundaries and regression coverage, see [the engineering plan](../plan/notion-connector-2.1.0.md).
