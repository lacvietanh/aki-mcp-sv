# claude.ai — Add custom connector (dialog fields)

Recorded because it decides which auth mechanism this server has to use.

Screenshot of the new dialog (as of 2025-08-28): `docs/img/claude-mcp-Aug28.png`

## New dialog structure (Aug 28 2025)

The "Add custom connector" dialog was redesigned. It now has two explicit sections:
**Authentication** and **Advanced** (Transport).

### Authentication section

Three radio options for when auth is required:

| Option | Label | Notes |
|--------|-------|-------|
| `always_required` | **Always required** | Each user signs in through the server's OAuth flow before they can use any tools or resources. |
| `required_when_asked` | **Required when the server asks** | Claude connects without credentials first and prompts users to sign in when the server asks. Pick this for servers that offer some tools without an account. |
| `none` | **None** | No sign-in. Pick this for servers with open access, or for servers that use an API key instead of OAuth. |

Three radio options for **client registration method**:

| Option | Label | Notes |
|--------|-------|-------|
| `cimd` | **Use Anthropic's hosted client metadata** *(Recommended)* | The server reads Claude's client details from a URL Anthropic hosts (CIMD). Nothing to setup, but the server must support it. |
| `dcr` | **No client ID — register one automatically** *(Detected)* | Claude registers OAuth clients with the server as users connect (DCR). Works with most servers, but creates many client registrations on busy servers. |
| `own_client` | **Use your own OAuth client** | Enter a client ID you registered with the server yourself. Leave the secret blank unless your authorization server requires one. |

When **Use your own OAuth client** is selected, two fields appear:
- **OAuth Client ID** — The public identifier from your provider's OAuth app settings. Not an API key or token.
- **OAuth Client Secret (optional)** — Leave blank unless your authorization server requires a client secret.

### Advanced section (Transport)

> "Set from the URL automatically. Change it only if the server's docs say to."

| Option | Label | Notes |
|--------|-------|-------|
| `streamable_http` | **Streamable HTTP** *(default)* | The current MCP transport. Use this unless the server only supports SSE. |
| `sse` | **SSE (legacy)** | An older transport being phased out. Selected automatically when the URL ends in `/sse`. |

### Footer note

> "Only use connectors from developers you trust. Anthropic does not control which tools developers make available and cannot verify that they will work as intended or that they won't change."
>
> "Building an MCP server? Report issues and subscribe to updates here"

---

## Fields available (summary)
- **Name** — display name in the connector list.
- **Remote MCP server URL** — required, shape `https://mcp.example.com/mcp`.
- **Authentication** — when required + client registration method (see above).
- **OAuth Client ID** / **OAuth Client Secret (optional)** — shown when "Use your own OAuth client" is selected.
- **Transport** — Streamable HTTP (default) or SSE (legacy).

---

## What changed from the old dialog (before Aug 28 2025)

The old dialog had:
- A flat **Advanced settings** section with just **OAuth Client ID** and **OAuth Client Secret**.
- A **Request headers** (beta) field for `Authorization: Bearer <token>` — not visible in the new dialog.
- No explicit auth-timing radio (always / when asked / none).
- No explicit transport radio (Streamable HTTP / SSE).

The new dialog:
- Makes auth timing explicit (always / when asked / none).
- Makes client registration method explicit (CIMD / DCR / own client).
- Adds transport selection (Streamable HTTP / SSE legacy).
- The "Request headers" beta field is **no longer visible** in the new UI.

---

## Consequence — changed since the first read

The first read of this dialog (before 2026-08-07) assumed "no header field → the token has to go in the URL." **Wrong in practice**: even with OAuth Client ID/Secret left blank, claude.ai still automatically attempts Dynamic Client Registration (DCR) before connecting, and fails immediately if the server doesn't answer the OAuth handshake correctly — token-in-URL doesn't dodge this step. Confirmed with a real test plus Anthropic's public GitHub issue (`anthropics/claude-ai-mcp#457`) — full detail: `docs/research/claude-ai-oauth-connector.md`.

**Current decision**: leave the Client ID/Secret fields blank and let Claude register itself through DCR (PKCE S256) against a minimal self-hosted authorization server; the user enters only the URL and the passphrase. `registration_endpoint` is advertised and `https://claude.ai/api/mcp/auth_callback` is allowlisted. The pre-issued confidential client in `oauth-client.json` is not used by Claude. See `scripts/oauth.js`, `docs/feat/security.md`.

---

## Cross-references
- `docs/research/claude-ai-oauth-connector.md` — full research, dates, sources
- `docs/feat/security.md` — current OAuth security model
- `docs/plan/done/init.md` — architecture decisions
- `docs/img/claude-mcp-Aug28.png` — screenshot of the new dialog (Aug 28 2025)
