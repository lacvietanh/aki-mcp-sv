# Adding a connector (web AI or local client)

Runbook for adding a new web AI or local MCP client connector to `aki-mcp-sv`. Every step below is mandatory before closing the plan.

## 1. Auth path (from real screens and recorded facts first)

- Record the client's real screens and auth behavior with source and date first (`docs/ref/fact-*` or the active plan).
- Take the highest rung the client supports: **OAuth with DCR** (URL + passphrase) → **OAuth without DCR** (pre-issued static Client ID/Secret + passphrase) → **Bearer header** only when the client has no OAuth.
- **Macro-automatable (Owner 2026-10-22):** every rung must be settable by automation, not only by hand — a connector a macro cannot configure by itself is not finished.
- **Why OAuth ranks first:** it refreshes its own token (so **Roll token** needs no re-paste — **ClickUp** is the observed exception and may need one reconnect, CHANGELOG 2026-10-24), keeps tokens server-to-server, and creates a named client the control panel can remove independently.
- **Single OAuth path:** never add a per-client OAuth handler branch in `scripts/oauth.js`.

## 2. Redirect URI (OAuth only)

- Any user can allow an unknown callback at runtime in the control panel (**section 1 → Web → Other AI (sign-in)**) without an AkiMCP release; refused attempts appear there and in the log line `[oauth] register REJECTED (redirect_uri not allowlisted): [origins]`.
- Add a built-in entry to `BUILTIN_CALLBACKS` in `scripts/oauth-callbacks.js` **only** for a client that gets its own panel tab: capture the exact callback from a real sign-in attempt and add a test in `test/oauth-callbacks.test.js`. Never add callback checks in `scripts/gatekeeper.js`.

## 3. Panel tab, docs, and single-source lists

- Add the connector's panel tab in `scripts/config-page.js` **section 1** (Local or Web tier), with steps written from the client's real screens and an explicit note on what **Roll token** does to it.
- Add a `README.md` section with its link in the `Contents` line and its name in the headline list, update `docs/index.md`, and record the change in `CHANGELOG.md`.
- Everywhere else, describe connectors as a group — never create another hand-kept connector list.

## 4. Live verification before closing the plan

- Run a live check against the real client before moving the plan to `docs/plan/done/`; until that live check runs, the plan's status must explicitly state it was not run.
