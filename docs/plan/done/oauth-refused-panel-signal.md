# Plan: Live Refused-Callback Signal in Control Panel & Contract Freeze

- **Status:** done (2026-11-23 · commit `28de970` · Challenger `P10·W182` Post-Impl Audit PASS `0B · 0M · 0Nit`)
- **Related:** [plan/done/custom-oauth-callbacks.md](custom-oauth-callbacks.md) (shipped in 4.2.0), [plan/done/IMPORTANT-akimcp-aiobox-contract.md](IMPORTANT-akimcp-aiobox-contract.md), [feat/security.md](../../feat/security.md), twin plan `aiobox/docs/plan/akimcp-oauth-callback-signal.md`.

## 1. Goal / Outcome

1. **Standalone F7 parity (AkiMCP without AIObox):** When an OAuth client's redirect callback is refused while the AkiMCP web control panel is already open in a browser tab, switching back to that tab immediately surfaces a dynamic banner and a live count badge on the **Other AI (sign-in)** tab—no page reload or manual Refresh click required.
2. **Cross-repo contract freeze:** Freeze the 3 loopback routes shipped in 4.2.0 (`GET /api/oauth-callbacks`, `POST /api/oauth-callbacks/add`, `POST /api/oauth-callbacks/remove`) in `docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md` and `test/aiobox-contract.test.js` so AIObox's desktop signal and `/akimcp` card can depend on them safely.

## 2. Current State & Exact Gap (Verified in 4.2.0)

- `scripts/config-page.js:318` **already renders** an SSR-only banner when `listRefused()` has an addable callback at initial HTML render time:
  - `An AI tried to sign in through an address AkiMCP does not allow yet.` + button `Open Web → Other AI (sign-in)` (`data-act="openOtherAi"`).
- `scripts/config-page.js:336` renders `<button class="tab" data-tab="otherai">...Other AI (sign-in)</button>` with no count indicator.
- `public/panel-client.js` only calls `loadCallbacks()` when the user clicks the `otherai` tab (line 840) or clicks Refresh / Add / Remove inside that tab (lines 422–443). It does **not** fetch on panel boot, does **not** refresh on `visibilitychange` / `focus`, and never updates the top banner or tab badge dynamically.
- **Result:** In the common workflow where the control panel is already open before the user tries connecting a new AI client, returning to the panel shows zero indication that a callback was blocked unless the user reloads the whole page.
- **Contract gap:** `docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md` and `test/aiobox-contract.test.js` do not yet cover the 3 `/api/oauth-callbacks*` endpoints introduced in 4.2.0.

## 3. Boundaries & Invariants

- **No OS notifications in `aki-mcp-sv`:** Desktop OS alerts belong in AIObox (`aiobox/docs/plan/akimcp-oauth-callback-signal.md`); keep `aki-mcp-sv` zero-dependency and standalone.
- **No new HTTP endpoints and no background `setInterval` polling:** Reuse existing `GET /api/oauth-callbacks` strictly on user-driven lifecycle events (boot, tab visibility, window focus, tab click, mutations).
- **Preserve `custom-oauth-callbacks.md` D8:**
  - Refused attempts remain in-memory only and are never written to `security.log`.
  - The top banner and tab badge MUST show parsed `host` strings only—**never** self-declared `clientName`.
  - Only **addable** refused callbacks that are not yet matched by `entries` (`!c.reason` and not matched by user/built-in callbacks) trigger the banner and tab badge, deduplicated by parsed `c.host` (newest-first) so a host refused on two paths counts once and a mixed-callback row clears immediately after its addable callback is added; unaddable entries (`http://`, IP literals, `localhost`) stay quiet outside the `Other AI (sign-in)` tab list.
- **Public-repo safety:** No private hostnames, tokens, passphrases, or OS username paths in docs or tests.

## 4. Decisions (D1–D4)

### D1 — Always-rendered dynamic banner (`#refusedCallbackBanner`)
- Replace the conditional SSR-only `<p class="helptext">` at `scripts/config-page.js:318` (above `.tier-switch`) with a stable container `#refusedCallbackBanner` (visible on SSR when `addableRefusedHosts()` is non-empty at load time, `hidden` otherwise) holding a static `<span id="refusedCallbackText">` and static `<button type="button" data-act="openOtherAi">Open Web → Other AI (sign-in)</button>`.
- `renderCallbacks()` in `public/panel-client.js` keeps `#refusedCallbackBanner` in sync after every `loadCallbacks()` call:
  - Lists unique parsed host names only (e.g. `api.example.com` or `api.example.com (+2 more)`), never `clientName`.
  - Updates `#refusedCallbackText` and `#otherAiBadge` strictly via `textContent` (SSR via `esc()`), never raw HTML interpolation.
  - Protects `[hidden]` in `public/panel.css` (`[hidden] { display: none !important; }`) so author `display` rules never reveal hidden banners or badges.
  - Automatically hides when the last addable refused host is added (including mixed-callback rows).

### D2 — Live count badge on the `Other AI (sign-in)` tab (`#otherAiBadge`)
- Add `<span id="otherAiBadge" class="tab-badge" hidden>` inside `<button class="tab" data-tab="otherai">` (`scripts/config-page.js:336`).
- Seed the initial count during SSR from `addableRefusedHosts()` (unique addable refused hosts, matching D1's unit) and update it inside `renderCallbacks()`.
- Hide the badge when the count is `0`.

### D3 — Event-driven refresh with ≥ 5 s throttle and monotonic sequence guard
- Trigger `maybeRefreshCallbacks()` on:
  1. Initial panel client boot (top-level init),
  2. `document` `visibilitychange` when `document.visibilityState === 'visible'`,
  3. `window` `focus`.
- Guard passive triggers with a **5-second minimum interval** (`CALLBACKS_REFRESH_MIN_MS = 5000`), an in-flight flag `passiveCallbacksInFlight`, and silent `.catch(() => {})` (no error spam during restarts).
- Guard `loadCallbacks()` with a monotonic sequence counter `callbacksSeq` so a slower passive response can never overwrite a newer explicit Refresh/Add/Remove response. Explicit clicks (Refresh, Add, Remove, clicking the `otherai` tab) call `loadCallbacks()` directly, bypassing the passive throttle/lock and surfacing errors. `openOtherAi` avoids double-clicking `otherai` when `lastTab === 'otherai'`.

### D4 — Freeze `/api/oauth-callbacks*` in the AkiMCP ↔ AIObox contract (exact 4.2.0 wire shape)
- Add a row in `docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md` documenting the exact 4.2.0 wire shapes:
  - `GET /api/oauth-callbacks` → `200 { entries, skipped, readError, refused }` where `entries[i]` is `{ match, value, host }`, `skipped[i]` is `{ entry, reason }`, `readError` is `string | null`, and `refused[i]` is `{ callbacks: [{ href, shown, host, prefix, reason }], clientName, firstAt, lastAt, count }` (no `builtins` key),
  - `POST /api/oauth-callbacks/add` (body `{ match: 'exact' | 'prefix', value: string }` → `200 { ok: true, message }`, `400 { error }`, `403 { error }`),
  - `POST /api/oauth-callbacks/remove` (body `{ match: 'exact' | 'prefix', value: string }` → `200 { ok: true, message }`, `400 { error }`, `403 { error }`),
  - `x-panel-token` header gate, loopback-only, `404 { error: 'not found' }` on AkiMCP < 4.2.0.
- Add inline contract comments beside the 3 route registrations in `scripts/panel.js:538-546` (matching `/api/security` and `/api/clients/remove`).
- Lock all 3 shapes plus `400`/`403` gates in `test/aiobox-contract.test.js`.

## 5. Phased Execution Plan

### P1 — Dynamic Banner, Tab Badge & Focus/Visibility Refresh
- **Files:**
  - `scripts/oauth-callbacks.js` — export pure helpers `addableRefusedHosts(rows, entries)` (unique addable hosts not yet matched by `entries`, newest-first) and `formatRefusedBanner(hosts)` so SSR and tests share the exact definition.
  - `public/panel.css` — add `[hidden] { display: none !important; }` and `.tab-badge` styling.
  - `scripts/config-page.js` — replace the SSR-only `<p class="helptext">` (line 318) with `#refusedCallbackBanner` (SSR-seeded with parsed hosts only, `hidden` when empty), add `#otherAiBadge` on `data-tab="otherai"` (line 336), and style `.tab-badge` cleanly.
  - `public/panel-client.js` — update `renderCallbacks()` to sync `#refusedCallbackBanner` and `#otherAiBadge`; add `maybeRefreshCallbacks()` with 5 s throttle + in-flight guard wired to initial boot, `visibilitychange` (`visible`), and `window.focus`.
- **Tests:**
  - Extend `test/oauth-callbacks.test.js` (or panel render tests) to verify:
    1. SSR renders `#refusedCallbackBanner` and `#otherAiBadge` hidden when `listRefused()` is empty or contains only unaddable (`reason != null`) callbacks.
    2. SSR renders visible `#refusedCallbackBanner` (containing parsed `host`, never `clientName`) and `#otherAiBadge` with exact addable count when an addable refused row exists.
    3. Client helper logic hides banner/badge when addable count drops to `0`.
  - Verify `npm test` passes completely.
- **Done when:** Open the panel before any OAuth attempt, send a refused `POST /register` for an HTTPS callback outside built-ins, switch focus back to the panel tab → `#refusedCallbackBanner` (showing the parsed host) and `#otherAiBadge` (`1`) appear immediately without reloading; clicking **Add** clears both immediately.

### P2 — Cross-Repo Contract Freeze & Contract Tests
- **Files:**
  - `docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md` — add the `/api/oauth-callbacks*` contract row (L4 cross-repo handoff: hand verbatim row text to AIObox Lead to mirror in `aiobox/docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md`; AkiMCP does not directly edit the AIObox repo).
  - `scripts/panel.js` — add contract pointer comments on the 3 `/api/oauth-callbacks*` routes (lines 538–546).
  - `test/aiobox-contract.test.js` — add contract assertions covering `GET /api/oauth-callbacks`, `POST /api/oauth-callbacks/add`, and `POST /api/oauth-callbacks/remove` (including `refused[]` shape after a refused `/register`).
  - `docs/index.md` — update plan status when completed.
- **Tests:**
  - `node test/aiobox-contract.test.js` passes.
  - Full `npm test` passes.
- **Done when:** All 3 routes are contract-tested and documented in `aki-mcp-sv/docs/plan/done/IMPORTANT-akimcp-aiobox-contract.md`, with verbatim updated contract text handed to AIObox Lead for twin-file sync.
