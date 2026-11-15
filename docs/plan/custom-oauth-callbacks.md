# Custom OAuth callbacks — any AI with its own sign-in connects without a new AkiMCP release

Status: proposed 2026-11-15 on the owner's direction: "để mở rộng sự linh hoạt tối đa, ta cần tìm cách để người ta custom tối đa được, như cách ta đã mở rộng kiến trúc linh hoạt custom provider/macro bên aiobox vậy. và cả đợt akimcp v4 cho phép custom cả đống name prefix". Options were weighed by an advisor and a challenger review the same day; their findings are folded into the Decisions and Rejected below.

## Why

- `isAllowedRedirect` (`scripts/oauth.js:69`) is a code constant that reads no setting, so a new OAuth AI, or a provider moving its callback, needs a code edit, a test and a release. That happened 6 times across 5 releases: 1.1.0 ChatGPT, 1.2.0 and 1.2.1 Grok and Gemini (guessed callbacks, corrected the same day), 3.0.0 Notion, 3.1.0 Gemini's moved callback and ClickUp.
- Until the user upgrades, the AI only shows its own vague error: the refusal at `/register` (`scripts/oauth.js:331-335`) is printed to the console alone.

## Decisions (proposed)

| # | Decision | Why |
|---|---|---|
| D1 | **Callbacks are data.** The built-in callbacks move into one list of entries `{ name, match, value }`, `match` one of `exact`, `prefix`, `host`; `isAllowedRedirect` walks the built-in list, then the user's list | One shape for both, the way AIObox providers and the v4 custom names work; built-in behavior stays identical (tests) |
| D2 | **User entries live in `setting.json` key `oauthCallbacks`, same shape,** read on every request like the shell allowlist (`scripts/allowlist.js`); a malformed key is ignored and the built-ins still apply | Settable by hand, by the panel, by a macro or an AI's file tool, with no restart (`plan/done/connector-setup-ux.md` D5: every rung automatable) |
| D3 | **Panel tab "Any OAuth AI" (Web tier):** the custom entries with Add and Remove, plus the callbacks the server refused since start (memory only), each with "Add as exact URL" | The user never has to find a callback in a log; the list is a shortcut to fill the form, not a safety gate |
| D4 | **One shape rule for every entry, built-in or custom:** https, no userinfo, no fragment; `host` is an exact hostname (no wildcard, no IP literal, `xn--` shown raw); `prefix` includes a path and ends with `/` | A custom entry can never be looser than the built-ins; prefer `exact` or `prefix` for a host that serves many tenants |
| D5 | **The consent page names the site the code goes to** (the callback's hostname) next to the client's self-declared name | The owner's check before typing the passphrase; useful for the built-ins too (today only the client name shows, `scripts/oauth.js:434-441`) |
| D6 | **Remove stops new registrations and authorizations for that entry; it does not end existing grants.** Those end through the client's own Remove in the Clients section or Roll token, and the tab says so | Refresh records hold only `clientId` and `scope` (`scripts/oauth.js:668`), so an entry cannot find its grants |

Accepted risk: anything that can write `setting.json`, an AI's file tools included (`docs/feat/security.md` § file tools reach akimcp's own data dir), can add a callback. A code still needs the passphrase, typed by the owner on a page that now names the destination (D5). Same stance as the shell allowlist.

## Rejected

| Option | Why not |
|---|---|
| Any https callback behind the passphrase | Drops the only enforced check on where a code goes; `plan/done/integrate-gemini-grok.md:22` "do **not** loosen to a domain regex" |
| A signed or fetched remote list | Whoever controls the list widens every install at once; the most code; the owner stays the bottleneck |
| Approve an unknown callback on the consent page | The decision would sit inside the page a phisher sends |
| A manual Allow click as the safety gate | `plan/done/connector-setup-ux.md` D5: safety comes from where a key may go, never from leaving a step to the user |

Out of scope: OAuth with loopback callbacks for desktop and CLI clients (RFC 8252), so Claude Code, Codex and Cursor stop needing a pasted Bearer token; a separate idea.

## Steps

- [ ] **P1 · data list and matcher** in `scripts/oauth.js`. Tests in `test/oauth.test.js`: every built-in callback accepted exactly as before; a custom `exact`, `prefix` and `host` entry accepted; http, userinfo, `#`, IP literal, wildcard and lookalike hosts refused, built-in or custom.
- [ ] **P2 · `oauthCallbacks` setting** read per request; a malformed or missing key behaves exactly like 4.1.0 (test).
- [ ] **P3 · panel tab** in `scripts/config-page.js` section 1 Web tier and its API behind the panel token; the refused callbacks since start; the console's reject line names the tab.
- [ ] **P4 · consent page shows the destination site**; the stale comment at `scripts/oauth.js:320` ("Only Claude/ChatGPT redirect URIs are accepted") fixed.
- [ ] **P5 · docs:** `CLAUDE.md` "Two client paths" and "Adding a connector" step 2 (a custom entry first; a built-in entry only for a client that gets its own tab), `docs/feat/security.md`, README, `docs/index.md`, `CHANGELOG.md`.
- [ ] **P6 · live check:** connect one AI through a custom entry added in the panel, with no built-in entry for it.
