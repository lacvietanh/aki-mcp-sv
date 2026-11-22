# Plan: Gemini 4 Developer Mode (/devmode) MCP Sync (aki-mcp-sv + akimcp.top)

> Created 2026-11-22 · Updated 2026-11-22 (Pre-impl audit `PASS WITH FIXES` B1–B2, N1–N2 from Challenger `P59·W7`) · Task `task-1795207778267` (`.akidevsync/notes.json`) · Status: **Done (2026-11-22 — commits `bdfb201` [aki-mcp-sv] + `5f1f520` [akimcp.top]; Challenger `P59·W7` audit vòng 2 PASS, 0 Blocking, 0 Nit)** · Sync Point 2 from AIObox Lead `P5·W261` (commits `7b8b0203`, `94126c82`, `f1539c55`, Challenger `P58·W21` PASS L8 100%).
> Tool names here use `aki__` by default (`scripts/mcp-name.js`).

## 1. Goal & Boundary (S-1)

- **Goal:** Replace stale `2026-08-09` Gemini web copy (`experimental / not recommended / tool use unreliable`) across both `aki-mcp-sv/` (product SSoT: control panel, README, ref docs, tests, changelog) and `akimcp.top/` (public marketing & guide site, EN + VI) with the live-verified **Gemini Developer Mode (`/devmode`)** MCP flow.
- **Boundary S-1 (zero server/OAuth changes):** No changes to OAuth 2.1, DCR (`POST /register`), callback allowlist (`scripts/oauth-callbacks.js`), or MCP tool definitions/handlers in `aki-mcp-sv`. Gemini connects directly through AkiMCP's existing DCR flow (`oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-...`, `User-Agent: Google`), already shipped in **AkiMCP v4.2.0** (so `akimcp.top` can publish this immediately against `currentVersion = '4.2.0'`, `toolTotal = 38`, without waiting for 4.3).
- **Tool surface lock:** **0 changes** to `tools/list` (38 tools, `37023 / 37922` chars in `test/tool-surface.test.js`).

## 2. Live-Verified Facts & Pre-Impl Audit Fixes (B1–B2, N1–N2)

Sources read: `aiobox/providers/gemini/guide.md` (v3), `aiobox/providers/gemini/macros/connect-akimcp.js`, `aiobox/docs/plan/gemini-devmode-macro-capabilities.md`, `aki-mcp-sv/.akidevsync/notes.json` (`task-1795207778267`).

| Fact / Audit Item | Verified Live Behavior & Fix (`[obs]`, 2026-11-21..22) |
|---|---|
| Entry URL | `https://gemini.google.com/devmode` — **strictly no trailing slash** (`/devmode/` returns HTTP 404 on every account). Multi-account prefix `/u/<n>/devmode` (also no trailing slash) works. |
| Plan gate | Requires an eligible paid Gemini plan (**Google AI Pro** or **Google AI Ultra**). Free Google accounts automatically redirect from `/devmode` to `/app` (standard chat has no custom MCP apps). |
| Setup UI flow (6 steps) | Open `/devmode` → **Choose an app** → **+ Create new** → paste **MCP URL** (`https://.../mcp`) & click **Next** → tick risk acknowledgment checkbox & click **Connect** → Google Account Linking notice (`myaccount.google.com`): click **Agree and continue** → AkiMCP confirmation page (shows Google's shared sign-in relay `oauth-redirect.googleusercontent.com`): enter **Passphrase** & click **Approve** → **Save your custom app**: enter **Display name** (default `AkiMCP`) & click **Connect** / **Save**. |
| Auth & DCR | Self-registers via RFC 7591 DCR (PKCE, no Client ID/Secret to paste). Existing `scripts/oauth-callbacks.js` allowlist covers `oauth-redirect*.googleusercontent.com`. |
| **B1 (Roll token behavior)** | Connected via OAuth DCR, so Gemini **refreshes automatically after `Roll token`** (like Claude, ChatGPT, Grok, Notion). **`Roll & sign out all clients`** revokes refresh tokens: reconnect under the **Authentication** tab in `/devmode` (**Connect** / **Reconnect**). Stated explicitly in `scripts/config-page.js`, `README.md`, and `akimcp.top/app/data/guides.ts` (`#gemini`). |
| **B2 (`coding.B3` single-run & sequential verification)** | In `aki-mcp-sv`, run `npm test` **exactly once** via `aki__task_start` (do NOT re-run `test/tool-surface.test.js` separately because `npm test` includes it). In `akimcp.top`, run sequentially one by one: (a) `npm run check`, (b) `npm run typecheck` via `aki__task_start`, (c) `PANEL_SRC=aki-mcp-sv npm run generate` via `aki__task_start` (`postgenerate` runs `validate-seo.js` and `validate-css-vars.js`; do NOT run them separately). Record `(command, exitCode, logFile)` for every task. |
| **N1 (`panelRef('connectors')` & `/vi/` internal links)** | In `akimcp.top/app/data/guides.ts:694` (`#gemini` intro), include `${panelRef('connectors')}` (EN + VI) so the section names the Connectors panel section dynamically without hardcoding a section number, and ensure every internal `<a href="...">` inside any `vi:` string carries the `/vi/` prefix. |
| **N2 (`fact-client-tool-names.md` header & row 27)** | Bump `docs/ref/fact-client-tool-names.md:3` from `> updated 2026-10-31 · v4.0.0` to `> updated 2026-11-22 · v4.2.0`, and update row `:27` to record the verified `FACT` that Gemini Developer Mode (`/devmode`) loads all 38 `aki__*` tools in **Tool schemas** while keeping `ASSUMPTION` on the unprobed 64 vs 128 character ceiling. |
| Per-tool approval | First tool call shows an inline confirmation card with **Allow once** / **Always allow**. **Always allow** persists server-side per custom MCP app (no auto-confirm). |
| Custom instructions URL | `https://gemini.google.com/saved-info` (`config-page.js:18`, Section 3 `:556`) remains valid for pasting the static AkiMCP instruction prompt. |

## 3. Part A — `aki-mcp-sv/` (Product SSoT)

| File & Lines | Current State | Planned Change |
|---|---|---|
| `scripts/config-page.js:18` | `const GEMINI_SETTINGS_URL = 'https://gemini.google.com/saved-info';` | **Keep unchanged** (used by Section 3 `:556` for Saved info / custom instructions). |
| `scripts/config-page.js:22` | `const GEMINI_CONNECTOR_URL = 'https://support.google.com/g/answer/17106276';` | Change to `const GEMINI_CONNECTOR_URL = 'https://gemini.google.com/devmode';` with inline comment noting strictly no trailing slash (`/devmode/` returns HTTP 404). |
| `scripts/config-page.js:379-389` | `#tab-gemini` warns `Tested 2026-08-09 ... doesn't reliably discover or invoke the MCP tools ... Not recommended.` and links to Google Support article. | Replace with live `/devmode` walkthrough: top `p.lnk` opening `GEMINI_CONNECTOR_URL` (`↗ Open Gemini Developer Mode`, noting no trailing slash and `/u/<n>/devmode`); `helptext` stating Google AI Pro / AI Ultra requirement (Free accounts redirect to `/app`); 6-step `<ol class="steps">` (**Choose an app** → **+ Create new** → **MCP URL** + **Next** → risk checkbox + **Connect** → Google Account Linking **Agree and continue** → **Passphrase** + **Approve** → **Save your custom app** with **Display name** + **Connect** / **Save**); closing `helptext` covering DCR self-registration (no Client ID/Secret to paste), automatic refresh after **Roll token** (while **Roll & sign out all clients** requires **Reconnect** under **Authentication** in `/devmode` — **B1**), and the first-call **Allow once** / **Always allow** confirmation card (saved server-side per custom app). |
| `README.md:3` | Omits Gemini from the main web AI list and appends `*(Gemini support remains experimental.)*`. | Add `Gemini` into the main web AI list (`Claude, ChatGPT, Grok, Gemini, Notion, ClickUp, Buda, and any other AI that signs in with OAuth`) and remove `*(Gemini support remains experimental.)*`. |
| `README.md:127-134` | `:133` marks Gemini `experimental, connection works but tool use doesn't (yet)` with `2026-08-09` caveat and stale `isAllowedRedirect` in `scripts/oauth.js` pointer. | Rewrite `:133` to **Gemini — verified via Developer Mode (`/devmode`)**: `https://gemini.google.com/devmode` (no trailing slash; `/u/<n>/devmode` supported), requires Google AI Pro / AI Ultra (Free redirects to `/app`), DCR self-register + risk consent + Google Account Linking + passphrase + **Save your custom app**, automatic refresh after **Roll token** (or **Reconnect** under **Authentication** after **Roll & sign out all clients** — **B1**), first tool call prompts **Allow once** / **Always allow** (persists server-side per app), built-in callback allowlist in `scripts/oauth-callbacks.js` (`oauth-redirect*.googleusercontent.com`). |
| `docs/ref/fact-client-tool-names.md:3, :27` | Header `:3` is `2026-10-31 · v4.0.0`; row `:27` is `Gemini web connector, Gemini API`. | **N2:** Bump header `:3` to `> updated 2026-11-22 · v4.2.0`; update row `:27` client label to `Gemini Developer Mode (/devmode), Gemini API` recording `FACT` that live `/devmode` loads all 38 `aki__*` tools in **Tool schemas** (`ASSUMPTION` kept for the unprobed 64 vs 128 character ceiling). |
| `test/panel-identity.test.js` | Renders `config-page.js` via `inWorld`, no `#tab-gemini` assertion yet. | Add a test asserting rendered panel HTML `#tab-gemini` contains `https://gemini.google.com/devmode` (not `/devmode/` and not `support.google.com/g/answer/17106276`), excludes stale strings (`Not recommended`, `2026-08-09`, `doesn't reliably`), and documents paid-plan gate (`AI Pro` / `AI Ultra`), `Roll token`, and `Allow once` / `Always allow`. |
| `CHANGELOG.md` (`## [Unreleased]`) | No Gemini `/devmode` entry yet. | Add `### Changed` bullet under `## [Unreleased]` documenting the panel & docs sync for Gemini Developer Mode (`/devmode`), explicitly noting 0 OAuth/server changes and 0 tool-definition changes. |
| `docs/index.md` | Does not list this plan yet. | Add active plan entry `[plan/gemini-4-devmode-sync.md](plan/gemini-4-devmode-sync.md)` under `## In-flight / active plans` (move to `docs/plan/done/` only after Challenger post-impl audit PASS). |

## 4. Part B — `akimcp.top/` (Public Web EN + VI)

> **Guardrails:** NEVER touch or stage `docs/FROM-UNIDOC.md`. NEVER touch `app/data/contact.ts` (stays `currentVersion = '4.2.0'`, `toolTotal = 38`). Zero em-dash (`—`) or en-dash (`–`) in meta/new copy. Site-relative internal links only, and every `<a href="...">` in a `vi:` string MUST carry the `/vi/` prefix (**N1**).

| File & Lines | Current State | Planned Change (EN + VI) |
|---|---|---|
| `app/data/homepage.ts:32` | `{ id: 'gemini', ..., tag: { en: 'experimental', vi: 'thử nghiệm' }, group: 'web' }` | Remove `tag: { en: 'experimental', vi: 'thử nghiệm' }`. |
| `app/data/guides.ts:397` (`/security/` trade-offs) | `Gemini is experimental: it signs in again in 3.1 (not yet checked live), but tool use was unreliable in earlier tests.` (EN + VI) | Replace with honest current behavior: Gemini custom MCP runs in Developer Mode (`/devmode`, on Google AI Pro and AI Ultra plans) and pauses on each new tool behind an **Allow once** / **Always allow** confirmation card (**Always allow** is saved server-side per custom app). |
| `app/data/guides.ts:512-513` (`/connect/` lead) | Ends with `Claude and Grok are the most dependable today; Gemini is experimental and not recommended.` (EN + VI) | Update lead: ChatGPT needs Developer mode on first, Gemini connects in Developer Mode at `/devmode` (on Google AI Pro or AI Ultra), and Notion needs custom MCP servers enabled. Remove `Gemini is experimental and not recommended`. |
| `app/data/guides.ts:692-701` (`/connect/#gemini`) | `h2: 'Gemini (experimental)'` / `'Gemini (thử nghiệm)'`; stale `not recommended` intro, old support-doc steps, unreliable-tool note. | Keep `id: 'gemini'`; set `h2` to `'Gemini'` (EN + VI); rewrite `intro` referencing `${panelRef('connectors')}` (**N1**), Google AI Pro / AI Ultra requirement (Free redirects to `/app`), DCR self-registration (no Client ID/Secret to paste), and automatic refresh after **Roll token** (**B1**); rewrite `steps` to the live 6-step `/devmode` flow (strictly no trailing slash on `https://gemini.google.com/devmode`; `/u/<n>/devmode` supported); rewrite `note` to document **Tool schemas**, **Allow once** / **Always allow** (saved server-side per app), and **Reconnect** under **Authentication** after **Roll & sign out all clients** (**B1**). |
| `app/data/guides.ts:906-910` (`/troubleshooting/`) | `h2: 'Gemini connects but does not use the tools'` with stale limitation bullet. | Replace with real `/devmode` troubleshooting (EN + VI): (1) HTTP 404 on `/devmode/` → remove trailing slash (`https://gemini.google.com/devmode` or `/u/<n>/devmode`); (2) redirect to `/app` → Free account lacks Developer Mode (requires Google AI Pro or AI Ultra); (3) reply waits before a tool runs → click **Allow once** or **Always allow** on Gemini's inline confirmation card; (4) after **Roll & sign out all clients** → open the **Authentication** tab in `/devmode` and click **Reconnect** (standard **Roll token** refreshes on its own). |
| `app/data/guides.ts:944` (`/faq/` supported apps) | Ends with `Gemini signs in again but is experimental: tool use was unreliable in tests.` (EN + VI) | Update to list Gemini (via Developer Mode at `/devmode` on Google AI Pro and AI Ultra) alongside Claude, ChatGPT, Grok, Notion, and ClickUp as web AI apps that sign in with the passphrase. |
| `CLAUDE.md:3` | `...; Gemini experimental)` | Change to `(Claude, ChatGPT, Grok, Gemini, Notion, ClickUp, Buda)`. |
| `CHANGELOG.md` (`## [Unreleased]`) | Currently holds `### Added` for `/agent-communication/`. | Add `### Changed` bullet under `## [Unreleased]` summarizing the Gemini Developer Mode (`/devmode`) sync across `homepage.ts`, `guides.ts` (EN + VI), and `CLAUDE.md`. |

## 5. Verification Checklist (Phase 2 — `coding.B3`)

### Part A (`aki-mcp-sv/`)
- [x] Apply edits to `scripts/config-page.js`, `README.md`, `docs/ref/fact-client-tool-names.md`, `test/panel-identity.test.js`, `CHANGELOG.md`, `docs/index.md`.
- [x] Grep active files for stale `2026-08-09` / `Not recommended` / `experimental` Gemini strings and for accidental `/devmode/` trailing slash.
- [x] Run `npm test` **exactly once** via `aki__task_start` (covers all unit tests + `test/tool-surface.test.js` 38 tools / `37023 / 37922` chars; do NOT re-run `tool-surface.test.js` separately) + `node test/lint/check-docs-note.js` + `node test/lint/check-residue.js`.
- [x] Commit explicitly on `main` (do not push).

### Part B (`akimcp.top/`)
- [x] Apply edits to `app/data/homepage.ts`, `app/data/guides.ts`, `CLAUDE.md`, `CHANGELOG.md`.
- [x] Grep `app/data/` for remaining stale Gemini `experimental` / `thử nghiệm` / `not recommended` / `/devmode/` strings and verify every `<a href="...">` in `vi:` carries `/vi/`.
- [x] Run sequentially (never parallel, to protect 16 GB RAM):
  1. `npm run check`
  2. `npm run typecheck` (via `aki__task_start`)
  3. `PANEL_SRC=aki-mcp-sv npm run generate` (via `aki__task_start`; includes `postgenerate` `validate-seo.js` + `validate-css-vars.js`)
- [x] Inspect prerendered HTML (`dist/connect/index.html`, `dist/vi/connect/index.html`, `dist/panel-preview/index.html`) for clean EN/VI Gemini `/devmode` copy, zero `/devmode/` trailing slash, and `/vi/` prefix on all internal links in `dist/vi/`.
- [x] Confirm `git status` leaves `docs/FROM-UNIDOC.md` and `app/data/contact.ts` untouched; commit explicitly on `main` (do not push).
