# Integrate Gemini + Grok chat connectors

## Goal
Let Gemini and Grok reach the same MCP server over the same Funnel URL and OAuth 2.1 flow that Claude and ChatGPT already use, adding only what each new client's redirect callback and onboarding require. No new transport, no second auth model — the RFC 7591 DCR + PKCE path built for ChatGPT already fits a public client, so this is additive.

## What is known (verified 2026-08-09)
- **Grok** supports custom remote MCP connectors directly in chat: `grok.com/connectors → New Connector → Custom → paste MCP URL`, then it completes whatever auth flow the server prompts for. Reachable-over-public-internet is the only hard requirement — which the Funnel already satisfies. Source: `docs.x.ai/grok/connectors`, `docs.x.ai/developers/tools/remote-mcp`.
- **Gemini** custom MCP connectors with OAuth 2.0 exist under **Gemini Enterprise / Business edition** (not confirmed for the consumer gemini.google.com app): register the connector as an OAuth client, public HTTPS endpoint, user authorizes with their identity. Source: `support.google.com/g/answer/17106276`, `docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server`.
- Both therefore ride the existing server unchanged **except** the one gate that is deliberately narrow: `isAllowedRedirect` (`scripts/oauth.js:30-34`), which today allows only `claude.ai` and `chatgpt.com` callbacks.

## The one unknown that blocks a clean landing — the exact redirect_uri
`isAllowedRedirect` matches on exact callback strings / a `chatgpt.com/connector/oauth/` prefix. The real redirect_uri Grok and Gemini send is **not documented and must be observed from a live connect attempt**, exactly as ChatGPT's `https://chatgpt.com/connector/oauth/<id>` prefix was discovered from the `[oauth] authorize REJECTED … redirect_ok=false` log line (see `docs/plan/done/audit-1.1.0-todo.md` §A1).

### Status (RESOLVED 2026-08-09, both verified from live connects)
- **Gemini — RESOLVED (two bugs).** (1) redirect_uri `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<numeric>-<host_with_underscores>` — Google's OAuth proxy, not a `gemini.google.com` path → `GEMINI_CALLBACK_PREFIX` corrected. (2) Deeper: Gemini reuses Claude's **confidential** client (pasted ID/secret), but `handleAuthorize` pinned that client to `[CLAUDE_CALLBACK]` and never ran `isAllowedRedirect` on it, so authorize kept rejecting even after the prefix fix. The static client now carries `isStatic:true` and accepts any allowlisted callback at authorize; DCR clients stay pinned to their registered URI. Flow model corrected: Gemini **pastes Client ID/Secret** (does not self-register), on **paid tiers including Pro**.
- **Grok — RESOLVED.** Real redirect_uri `https://grok.com/connectors-oauth-exchange-code/` (not `/connector/oauth/`), observed via the new `register REJECTED (redirect_uri not allowlisted): [...]` log. `GROK_CALLBACK_PREFIX` corrected; Grok self-registers as a public client and passes.

## Decisions

| Issue | Decision | Why |
|---|---|---|
| Redirect allowlist shape | Add `GROK_CALLBACK_PREFIX` and `GEMINI_CALLBACK_PREFIX` constants beside the existing `CHATGPT_*` ones; `isAllowedRedirect` returns true on a match. Keep it a flat list of exact-or-prefix checks — do **not** loosen to a domain regex | The narrow allowlist is the one place a bad redirect could enter (`CLAUDE.md` §"Two client paths"); widening it by adding named prefixes preserves that property, a broad regex destroys it |
| Provisional values | Land the constants with a clearly-commented `PROVISIONAL — confirm against a live authorize log` note and the discovery command, so the exact string is filled once observed | Honest state (`coding.B3`): the code path is right, the literal is unverified until a real connect happens |
| DCR reuse | No change to `handleRegister`/`authenticateClient` — Grok/Gemini self-register as public clients (PKCE, `none`) just like ChatGPT, landing in `oauth-dcr-clients.json` | `resolveClient()` already covers both static and DCR clients; never special-case a client in a handler (`CLAUDE.md`) |
| Panel onboarding | Add Gemini and Grok subsections to panel section 2 (`config-page.js`), each: the connector entry point URL, `Server URL = <origin>/mcp`, `Registration URL = <origin>/register`, "auth = OAuth, token endpoint auth = none", and the passphrase step. Emit `<origin>/register` as a copy field (already computed) | Same walkthrough shape that unblocked ChatGPT DCR; the missing-Registration-URL trap (§A1 of the audit) applies identically |
| Hardcoded log string | Generalize `oauth.js:231` `"redirecting to claude.ai"` to name the actual redirect host from `redirectUri` | Cosmetic truth — the line now lies for any non-Claude client |
| README | One row in the connector list documenting Gemini (Enterprise) + Grok alongside Claude/ChatGPT, with the "reachable over public internet" note | Keep README truthful against the code (`docs.C1`) |

## Out of scope
- The consumer gemini.google.com app if it turns out not to support custom remote MCP connectors — document the finding, do not build a workaround.
- Any per-client tool filtering or scope narrowing — every connector sees the same tool set; that is the existing design.
- Verifying the live OAuth round-trip on Gemini/Grok — user-triggered runtime (`coding.B3`); this plan lands the code path and the provisional allowlist, marked unverified.

## Execution checklist
- [x] `scripts/oauth.js` — add `GROK_CALLBACK_PREFIX` + `GEMINI_CALLBACK_PREFIX` (provisional, commented) and extend `isAllowedRedirect`.
- [x] `scripts/oauth.js:231` — generalize the redirect-host log line.
- [x] `scripts/config-page.js` — Gemini + Grok subsections in section 2, each emitting `<origin>/register` as a copy field.
- [x] `README.md` — connector-list row for Gemini + Grok.
- [x] `node --check` the changed scripts.
- [-] Record the redirect-uri discovery command in the code comment so the provisional constants can be confirmed on first real connect. Not needed: the constants were confirmed from live connects (Status RESOLVED 2026-08-09).

## Cross-references
- `scripts/oauth.js` — `isAllowedRedirect` (§`:30`), the `CHATGPT_*`/`CLAUDE_CALLBACK` constants (§`:17`), `handleRegister` (§`:140`)
- `docs/plan/done/audit-1.1.0-todo.md` §A1 — how ChatGPT's redirect_uri was discovered from the authorize-reject log; same method here
- `docs/ref/security-model.md` — the OAuth model this extends
- `CLAUDE.md` §"Two client paths, one OAuth server" — the redirect-allowlist invariant this must preserve

## Decision
**Action** → extend `isAllowedRedirect` with provisional Grok/Gemini prefixes + panel walkthroughs; the exact redirect literals are confirmed against a live authorize log on first connect. Code path unverified until then (`coding.B3`).
