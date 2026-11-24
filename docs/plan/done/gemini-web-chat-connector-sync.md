# Gemini Web Chat Connector Sync (`aki-mcp-sv` + `akimcp.top`)

> status: done 2026-11-25 · Stage 5 cross-repo sync completed (Pro + Free TIER0 live QA verified)

## 1. Context & Live Verification Evidence

Google Gemini web chat (`https://gemini.google.com/devmode`) runs a live MCP connector over OAuth 2.0 Dynamic Client Registration (DCR) on Chrome 158. While `aki-mcp-sv` (`scripts/config-page.js:381–393` and `README.md:133`) already replaced the old `Not recommended` banner with the 6-step DCR setup flow, live verification on Chrome 158 uncovered **4 real behavioral deltas** (plus a stale generated artifact `app/generated/panel-demo.ts:2` and tool-count drift in `akimcp.top` and `docs/ref/fact-client-tool-names.md:27`).

### 1.1 Verified Live on Google AI Pro Account (Chrome 158)
- **Cold-load `/devmode` redirect & SPA entry**: A cold address-bar navigation (`location.assign("https://gemini.google.com/devmode")`) can redirect to `/app` even on a paid **Google AI Pro** account. When landed on `/app`, entering Developer Mode succeeds reliably via the in-page SPA menu **Settings → Developer Mode** (`a[href="/devmode"]`). The canonical URL has **no trailing slash** (`https://gemini.google.com/devmode` — a trailing `/devmode/` returns HTTP 404) and supports multi-account paths (`/u/<n>/devmode`).
- **App picker modal & registration controls**: Clicking the topbar connector control (`Connect to an MCP server` or `Change app: <name>`) opens `<dev-mode-app-picker-dialog>` titled **Choose an app**. Selecting `AkiMCP` transitions the session to `AkiMCP Active` (topbar button `Change app: AkiMCP`). The button to register a new MCP server is labeled **Create new** (no leading `+` sign), and the 6-step DCR flow names the app in step 6 (**Save your custom app** → **Display name** `AkiMCP` → **Connect** / **Save**).
- **Live MCP tool execution & confirmation cards**: Safe read-only tool calls (verified live with `aki__aiobox op=state`, HTTP `200 OK` in `~696ms` on the Telemetry `Event log`) can execute directly **without** triggering an inline confirmation card. When Gemini requires confirmation for an action (write operations / Spark `<remy-confirmation-card-v2>`), the inline confirmation card offers **Allow once** and **Always allow** (saved server-side per custom app).
- **`Authentication` tab & token rotation recovery**: Inside `<dev-mode-side-panel>`, the two tabs are `Tool schemas` and `Authentication`. When linked, `Authentication` shows `Connected · Account linked` with **Disconnect account** and **Use a different account** (used alongside **Reconnect** after clicking **Roll & sign out all clients** in the AkiMCP control panel).
- **AIObox integration alignment**: AIObox now reads live `5h` and `7d` Gemini quota windows via background `UsagePageQuery` GraphQL directly on `/app` and `/devmode` tabs (preserving `/u/<n>` multi-account prefixes) and ships automated **Connect AkiMCP** and **Widen** macros for Gemini.

### 1.2 Verified Live on Google Free Account (`TIER0`, Chrome 158)
- `[x]` **Live QA verified on Google Free (`subscriptionTier: "TIER0"`)**: In-page **Settings** completely omits **Developer Mode** (`a[href="/devmode"]` absent in both EN and VI locales, with no upsell entry), and `UsagePageQuery` returns `subscriptionTier: "TIER0"` with `GXU_FIVE_HOURLY` and `GXU_WEEKLY` pools. A cold load of `/devmode` without `?hl=en` on a non-EN locale redirects to `/app`, whereas opening `/devmode?hl=en` directly still reaches Developer Mode and loads `37/37` enabled `aki__*` tools (default prefix `aki__`).
- **Documentation rule**: Do not claim Free Google accounts are strictly blocked from Developer Mode; state that **Settings** omits **Developer Mode** on Free Google accounts and direct `/devmode` access on Free is unguaranteed and locale-dependent (while AIObox pool routing continues to prefer paid accounts via `akimcp.paidOnly`).

---

## 2. Scope Part A — `aki-mcp-sv` Repository (4 Core Files)

### 2.1 `scripts/config-page.js` (`#tab-gemini` at `:381–393`, preserve `GEMINI_SETTINGS_URL` at `:18, :560`)
- **Current baseline**: `scripts/config-page.js:381–393` already removed the historical `Not recommended` / `17106276` / `2026-08-09` warning and documents the 6-step DCR flow (**Choose an app** → paste **MCP URL** & click **Next** → tick risk checkbox & click **Connect** → `myaccount.google.com` **Agree and continue** → enter **Passphrase** & click **Approve** → **Save your custom app** with **Display name** `AkiMCP` & click **Connect** / **Save**). Keep this exact 6-step DCR order intact.
- **Apply exact 4 live deltas on `#tab-gemini` (`:381–393`)**:
  1. **`:383` (SPA entry fallback & Free caveat)**: State `Built for Google AI Pro or AI Ultra`, clarify that a cold load of `/devmode` can redirect to `/app` even on paid accounts — when that happens, open **Settings → Developer Mode** from the bottom-left Gemini sidebar — and note that Free Google accounts omit Developer Mode in Settings while direct `/devmode` access on Free is unguaranteed/locale-dependent.
  2. **`:385` (Button label)**: Change `<strong>+ Create new</strong>` to `<strong>Create new</strong>` (remove the redundant `+` sign).
  3. **`:392` (`Authentication` tab recovery)**: Expand the post-**Roll & sign out all clients** instruction on the **Authentication** tab in `/devmode` to include **Disconnect account** / **Use a different account** (alongside **Reconnect**) so users see the exact live button labels when re-linking.
  4. **`:392` (Confirmation card behavior)**: Clarify that read-only tool calls can run directly while actions requiring confirmation show an inline confirmation card with **Allow once** or **Always allow** (saved server-side per custom app).
- **MANDATORY INVARIANT — Preserve `GEMINI_SETTINGS_URL`**:
  - **DO NOT remove** `const GEMINI_SETTINGS_URL = "https://gemini.google.com/saved-info";` at `:18`. It is actively used at `:560` in Section 3 (`Gemini ↗` link to Google Saved info for pasting system instructions).

### 2.2 `README.md` (`:133`)
- Update the **Gemini — verified via Developer Mode (`/devmode`)** prose paragraph at `:133` under `## Connecting from Grok and Gemini` (`:127`):
  - Apply the same **4 live deltas** as `scripts/config-page.js:381–393` while preserving the 6-step DCR flow order: (a) cold-load `/devmode -> /app` fallback via **Settings → Developer Mode**, (b) **Choose an app** → **Create new** (no `+`), (c) **Authentication** tab recovery via **Disconnect account** / **Use a different account** (or **Reconnect**) after **Roll & sign out all clients**, and (d) read-only calls running directly vs **Allow once** / **Always allow** when Gemini prompts for confirmation.
  - Replace the hardcoded `All 39 aki__* tools` phrase (default prefix `aki__`) with neutral or dual-surface wording (*"all enabled `aki__*` tools"* or *"39 full surface / 37 enabled by default"*).

### 2.3 `docs/ref/fact-client-tool-names.md` (`:27`)
- Reconcile the tool count at `:27` (currently stating `38 aki__* tools`) with `scripts/provider-registry.js:42` and `test/tool-surface.test.js:42`:
  - Document clearly that the full MCP surface is **39** `aki__*` tools and the default enabled surface is **37** `aki__*` tools (because the two opt-in IDE bridge providers `agy` and `kiro` default to disabled unless enabled in panel Section 2).

### 2.4 `test/panel-identity.test.js` (`:166–180` — Strict `RULE-test.md` Compliance)
- **Single-test in-place update (`test.A2`)**:
  - Modify **only** the existing `#tab-gemini` test block at `:166–180`. Create **0** new test files, add **0** duplicate `test(...)` blocks, and produce **0** temporary files or `$TMPDIR` leaks.
- **Cut obsolete historical negative assertions (`:174–176`)**:
  - Remove the 3 historical negative assertions at `:174–176` (`!geminiTab.includes('support.google.com/g/answer/17106276')`, `!geminiTab.includes('Not recommended')`, and `!geminiTab.includes('2026-08-09')`) which trigger `suite_lint.py` `[HISTORY]` warnings.
- **Pin real behavioral invariants**:
  - `geminiTab` contains `href="https://gemini.google.com/devmode"` and does **not** contain a trailing slash (`!geminiTab.includes('gemini.google.com/devmode/"')`).
  - `geminiTab` includes SPA fallback keywords (`Settings`, `Developer Mode`), plan requirement (`Google AI Pro or AI Ultra`), live registration controls (`Choose an app`, `Create new` without `+ Create new`), token rotation recovery (`Roll token`, `Roll &amp; sign out all clients` / `Roll & sign out all clients`, `Authentication`, `Disconnect account`, `Reconnect`), and confirmation controls (`Allow once`, `Always allow`).
  - `html` outside `#tab-gemini` still contains `https://gemini.google.com/saved-info` (proving Section 3 `GEMINI_SETTINGS_URL` remains intact).
- **Ownership boundary**:
  - **DO NOT** assert hardcoded tool counts (`37`, `38`, `39`) inside `test/panel-identity.test.js`; `test/tool-surface.test.js` is the sole owner of tool-count assertions.

---

## 3. Scope Part B — `akimcp.top` Web Repository

### 3.1 `app/data/guides.ts` (Inline Bilingual `{ en, vi }` Blocks at `:691–704` & `:908–916`)
- **Gemini connection block (`:691–704`, inline `{ en, vi }`)**:
  - `intro` (`:694`): Clarify in both `en` and `vi` (`Built for Google AI Pro or AI Ultra`) that a cold load of `gemini.google.com/devmode` can redirect to `/app` even on paid accounts — instruct users to enter via **Settings → Developer Mode** in the bottom-left Gemini sidebar (while Free Google accounts omit Developer Mode in Settings and direct `/devmode` access on Free is unguaranteed and locale-dependent).
  - `steps` (`:695–702`): Update step 1 (`:696`, `en` + `vi`) from `+ Create new` to **Create new** while keeping the 6-step DCR sequence intact.
  - `note` (`:703`): Update `en` + `vi` to mention **Disconnect account** / **Use a different account** (alongside **Reconnect**) on the **Authentication** tab after **Roll & sign out all clients**, and clarify read-only direct execution vs **Allow once** / **Always allow** confirmation cards.
- **Gemini `/devmode` troubleshooting entries (`:908–916`, inline `{ en, vi }`)**:
  - `/devmode` redirect entry (`:912`, `en` + `vi`): Update so it explains cold-load `/devmode -> /app` redirects on Pro/Ultra (solved via **Settings → Developer Mode** in the bottom-left sidebar) and the Free account behavior (Settings omits Developer Mode; direct `/devmode` access is unguaranteed and locale-dependent).
  - `Roll & sign out all clients` recovery entry (`:914`, `en` + `vi`): Include **Disconnect account** / **Use a different account** alongside **Reconnect** under the **Authentication** tab.

### 3.2 `app/generated/panel-demo.ts` (`:2`)
- **DO NOT hand-edit `app/generated/panel-demo.ts`**.
- `app/generated/panel-demo.ts:2` is the only place still holding the stale `Tested 2026-08-09` / `answer/17106276` HTML. After `scripts/config-page.js` is updated in `aki-mcp-sv`, run `node scripts/pull-panel.js` in `akimcp.top` to regenerate `app/generated/panel-demo.ts` cleanly from source.

### 3.3 `app/data/homepage.ts` (`:36`), `app/data/whatsNew.ts` (`:132`) & `docs/biz/positioning.md` (`:33`)
- Keep `app/data/homepage.ts:36` at **`export const toolTotal = 38`** to match released `4.2.0` per `akimcp.top/CLAUDE.md:8` (comment noting `38` in released `4.2.0`; `39` pending `[Unreleased]` `4.3.0`), pin literal `38` on `app/data/whatsNew.ts:132` for the historical 4.1.0 benchmark, and keep `app/data/guides.ts:703` neutral (`up to ${toolTotal}`).
- Update `docs/biz/positioning.md:33` to `38 tools in released 4.2.0` (noting `39 in main [Unreleased], 37 enabled by default`).

### 3.4 Mandatory Verification Gates in `akimcp.top`
- `node scripts/pull-panel.js` (clean regen, zero manual drift in `app/generated/panel-demo.ts`)
- `npm run check` (`scripts/validate-routes.js`)
- `npm run typecheck`
- `npm run build` (including `postbuild`: `scripts/validate-seo.js` and `scripts/validate-css-vars.js`)

---

## 4. Acceptance Checklist & Privacy / Test Discipline Gates

- [x] **Strict Test Discipline (`RULE-test.md`)**:
  - `python3 suite_lint.py --all test/panel-identity.test.js` reports **0 hits** on the edited `#tab-gemini` block (`:166–184`; pre-existing harness lines `:25`/`:44` out of scope).
  - `node --test test/panel-identity.test.js test/tool-surface.test.js` and full `npm test` in `aki-mcp-sv` pass 100% with **0** `$TMPDIR` leaks and **0** stray/temp files.
- [x] **Web Gates (`akimcp.top`)**:
  - `npm run check`, `npm run typecheck`, and `npm run build` pass 100% after `node scripts/pull-panel.js`.
- [x] **Privacy Gate (`CLAUDE.md §7`)**:
  - Zero personal emails, zero account/profile handles or internal window identifiers, zero local machine paths, and zero tokens/secrets in code, tests, docs, or commit messages.
- [x] **L8 Audit & Release Hold**:
  - Submit both Part A (`aki-mcp-sv`) and Part B (`akimcp.top`) diffs for POST-IMPL L8 audit before committing, and hold `/akiship` until final cross-repo audit completes.
