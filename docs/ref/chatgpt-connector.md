# ChatGPT — Add custom connector (real install flow)

OpenAI requires **Developer mode** before you can create custom MCP apps ([docs](https://developers.openai.com/api/docs/guides/developer-mode)). Registration URL and Advanced OAuth stay unused: ChatGPT auto-discovers those from `/.well-known/openid-configuration`.

## Install steps

1. Enable **Developer mode**: ChatGPT → Settings → Security and login ([open ↗](https://chatgpt.com/#settings/Security)).
2. Open [Create a connector ↗](https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins) (ChatGPT → Settings → Connectors → New connector).
3. **Icon** (optional). Use `<repo>/public/favicon/icon-48.png` or any image.
4. **Name**: `AkiMCP` (AIObox's connect macro recognizes its connector by this name).
5. **Description**: your choice (e.g. `Local file and shell access via MCP`).
6. **Connection → Server URL**: paste the **MCP URL** from the panel (e.g. `https://aki-mba16.tailf23d51.ts.net/mcp`).
7. Tick **I understand and want to continue**, then **Create**.
8. On connect, the browser opens the auth page. Enter the **Passphrase** shown in the panel.

That's it. ChatGPT self-registers as an OAuth client via DCR (RFC 7591, PKCE, no secret) using the `registration_endpoint` it reads from `/.well-known/openid-configuration`. No Client ID or Secret to paste.

## What ChatGPT does under the hood

- Reads `/.well-known/openid-configuration` → gets `authorization_endpoint`, `token_endpoint`, `registration_endpoint`.
- Calls `POST /register` with its own `redirect_uri` (`chatgpt.com/connector/oauth/…`) → server issues a fresh `client_id`.
- Runs a standard PKCE authorization-code flow → user enters Passphrase on the server's confirm page → tokens issued.

## Notes

- **Nothing to paste.** ChatGPT uses DCR and gets its own client; the pre-issued Client ID/Secret is not used here.
- **Write tools may be limited** depending on OpenAI's current policy for custom connectors.
- Requires a ChatGPT paid plan (Plus / Pro / Team / Enterprise).

## Cross-references

- `scripts/config-page.js` — panel ChatGPT tab (section 1)
- `scripts/oauth.js` — `handleRegister` (DCR endpoint), `metadataHandlers` (well-known)
- `scripts/gatekeeper.js` — routes `/.well-known/openid-configuration` → `authorizationServer`
- `docs/feat/security.md` — OAuth model (Claude and ChatGPT DCR; pre-issued client for Gemini)
- `docs/plan/done/audit-1.1.0-todo.md` §A1–A2 — original DCR blocker and fix
- `docs/plan/done/merge-pr1-windows-chatgpt.md` — how ChatGPT DCR was merged
