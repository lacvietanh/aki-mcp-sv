# Aki MCP control center — multi-profile, self-hosted usage tracking (Electron vs Tauri open)

## Status
Superseded & Deferred. Dự án nền tảng đám mây tập trung `aiobox.app` (quản lý định tuyến subdomain Cloudflare, multi-tenant & tunnel) đã chính thức được khởi động. Do đó, kế hoạch xây dựng ứng dụng desktop control center cục bộ (Electron/Tauri) này không còn cần thiết và được lưu trữ vào `done/`.

## Goal
One app the owner fully controls, modeled on the multi-profile game-automation apps (Telegram auto-game) the owner already builds: a control center that sees every claude.ai "profile" at once (status, account, usage/limit), drives the usage bar and context-size readout without depending on a third-party extension, auto-runs setup JS (widen pane, etc.) on every new window, creates/edits/deletes profiles the way Chrome profiles work, opens new windows from a given profile, and gives those windows a custom, minimal, own-titlebar chrome.

Immediate goal → control every open claude.ai session from one place. Intermediate → stop manual babysitting of rate limits across accounts. Ultimate → same operating model the owner already runs for game automation, applied to claude.ai. No conflict with this repo's own "no desktop app" README stance: that stance is about not depending on *Anthropic's* Claude Desktop (device-ID lock-in the owner doesn't control); this is an app the owner owns end to end, which is the opposite case.

## This supersedes the Playwright-only recommendation floated earlier in chat
That recommendation covered only "detect limit + auto-continue" — it did not have items 4–5 (profile CRUD as first-class objects, custom-chrome windows) in scope. A headless/scripted Playwright process has no native window-chrome or multi-window session model; building one on top of it means reimplementing what Electron already is. Given the full 5-item requirement list, Electron is the smaller build, not the bigger one. Superseded, not layered on top of.

## Facts vs assumptions (first-principles pass)

**Facts, verified this session:**
- Chrome ≥136 only blocks `--remote-debugging-port`/`--remote-debugging-pipe` against the **default** user-data directory; a non-default dir works fine (`docs/research/chrome-cdp-default-profile-block.md`, 5-source-corroborated). Not relevant to the Electron path below (Electron ships its own Chromium, never touches the host's Chrome profile at all), but rules out "drive the user's live default-profile Chrome" as an option either way.
- claude.ai's own usage bars are **not** DOM-scraped by the reference implementation. `she-llac/claude-counter` (MIT, 1.1k★) reads a native `/usage` REST endpoint plus live SSE `message_limit` fields from the chat stream, authenticated via the `lastActiveOrg` cookie already on the page — "more accurate than the rounded /usage page." Token count shown is a **client-side approximation** (`gpt-tokenizer` o200k_base), not a server-reported number — there is no server-exact context-size figure to read, only estimate.
- claude-counter's network bridge is injected as a `world: "MAIN"` content script that patches `fetch`/`EventSource` in the page's own JS context to observe the SSE stream (v0.5.1 changelog note) — the same technique works from any environment that can run an init script in page context, extension or not.
- This repo already scoped and rejected building a custom Chrome extension for this exact usage-bar problem, choosing Tampermonkey instead specifically to avoid extension-maintenance cost (`docs/plan/chrome-tampermonkey-autosetup.md`). That decision was made without today's full requirement list (profile CRUD, custom chrome) — Electron changes the cost-benefit because it replaces "extension we'd maintain" with "one app we already have to build for items 4–5."

**Unverified — needs a runtime check before committing engineering time (`coding.B3`):**
- Whether claude.ai's Cloudflare layer (or any layer in front of it) challenges/blocks a **plain Electron `BrowserWindow`** loading claude.ai while logged in. General web-scraping literature says Playwright/Puppeteer get flagged via `navigator.webdriver` and CDP-automation signals — but a stock Electron `BrowserWindow` is not driven through the WebDriver/CDP automation surface those articles describe, so the failure mode may not transfer. No source found that tests claude.ai specifically either way. First checklist item below, before anything else is built.
- Whether the `/usage` endpoint and `message_limit` SSE field are stable, undocumented internal APIs (most likely, given claude-counter reverse-engineered them) — expect breakage risk on Anthropic-side changes, same class of risk this repo already accepted for the DOM-anchor approach in `chrome-tampermonkey-autosetup.md`.
- Whether claude.ai's custom-connector flow (this repo's own MCP integration) can point at `localhost` from an Electron-embedded page, which would let a profile window keep this repo's filesystem/shell tools without Funnel/OAuth. Nice-to-have, not required for v1 — do not let it block the plan.

## Hard requirement: multi-profile

Profile isolation is non-negotiable (same operating model as AkiTgAuto game multibox). Each profile = isolated cookies/storage so multiple claude.ai accounts run side-by-side. Shell choice (Electron vs Tauri) is still open; isolation maturity is the deciding lens.

## Shell comparison — Electron vs Tauri (open, not decided)

| Dimension | Electron | Tauri v2 |
|---|---|---|
| **Multi-profile isolation** | `session.fromPartition('persist:<id>')` — one line, shipped, cross-platform stable | Weak today: #11491 (data_directory only partial isolation; full WKWebsiteDataStore control requested, not shipped); #10981 (localStorage isolation broken/inconsistent on Linux); wry #621 (cookie share needs WKProcessPool workaround on macOS) |
| **Inject into claude.ai** | preload + `contextBridge` / `ipcRenderer`; or `executeJavaScript` on dom-ready — proven on AkiTgAuto remote origins | `initialization_script()` (runs before page JS on remote origin) + capabilities `remote.urls` allowlist; no invoke bridge into foreign origin by default — talk back via postMessage/custom events |
| **Titlebar / custom chrome** | `frame: false` + `-webkit-app-region: drag` | First-class: `decorations:false` + `transparent:true` + `top: var(--titlebar-h)` (`RULE-stack-tauri.md` B1) |
| **Binary / memory** | Bundled Chromium — heavy per profile window | System webview (WKWebView/WebView2) — lighter; fingerprint ≠ Chromium → anti-bot risk different |
| **Backend / reuse** | Node — direct reuse of widen-script, `/usage`+SSE logic, panel-style JSON registry | Rust — inject JS still plain JS; profile-registry/IPC needs rewrite or Node sidecar (`tauri.A2` PATH race); `/usage` poll must be `async` + `spawn_blocking` (`tauri.A1`) |
| **Fingerprint / anti-bot** | Chromium-like; Phase 0 still must prove claude.ai does not challenge a plain BrowserWindow | WKWebView fingerprint different from Chromium; may be better or worse on claude.ai — untested |

**Decision lean (owner-confirmed 2026-08-11):**
- **v1 ship path = Electron** — multi-profile isolation is the hard gate and is already solved (`session.fromPartition`); reuse AkiTgAuto inject pattern; Phase 0 = claude.ai fingerprint only.
- **Tauri stays on the table for a later pass** — only if isolation is proven (issue #11491 closed, or a verified per-webview data-store workaround on ship OS). Do not plan an Electron→Tauri rewrite until that spike passes.
- **Do not mix shells in v1.**

### Alternative Path C: Tauri + External Chrome via CDP (Remote Control)
Instead of Electron or Tauri's system WebView, we could use Tauri as a control app that spawns and controls Google Chrome directly on the host machine via the Chrome DevTools Protocol (CDP) using `--remote-debugging-port`.
- **Pros:**
  - **Extremely Lightweight:** No Chromium footprint bundled in the installer.
  - **Native Isolation:** Using `--user-data-dir` for each spawned Chrome window provides robust profile isolation (cookies, storage, sessions) out of the box.
  - **Transparency:** The user interacts with a familiar browser instance they trust.
- **Cons & Fatal Risks:**
  - **Cloudflare Turnstile Detection (Fatal):** Enabling `--remote-debugging-port` forces `navigator.webdriver = true` and exposes automation flags. Claude.ai's Cloudflare Turnstile bot detection will immediately trigger CAPTCHA loops or block the sessions.
  - **No Custom Chrome (UI Constraint):** We cannot remove the browser's window borders/titlebars, violating the "minimal custom titlebar" requirement.
  - **Process Management Overhead:** Tauri must orchestrate external Chrome processes (assigning random unused debug ports, handling crashes, cleanup of zombie processes, WebSocket CDP connections).

## Requirement → mechanism (shell-agnostic where possible)

| Requirement | Mechanism sketch |
|---|---|
| 1. Control center sees every profile status/account/usage | In-process store of open profiles → dedicated control window (IPC / Tauri events) |
| 2. Usage bar + context size, no third-party extension | Init/preload script in page context: patch `fetch`/`EventSource` for `message_limit` SSE + poll `/usage` with session cookies + `gpt-tokenizer` client estimate (claude-counter technique) |
| 3. Auto-widen + arbitrary injected JS per new window | Port widen script from `docs/plan/chrome-tampermonkey-autosetup.md` into init/preload |
| 4. Profile CRUD, open window from profile | **Must** be real isolated stores — Electron partition *or* Tauri equivalent once proven |
| 5. Minimal window, custom titlebar | Electron `frame:false` **or** Tauri decorations pattern |
| No Chrome extension | Own inject path only |

## Critique (mandatory pass, `METHOD-deep-think.md` B3)

1. **Steelman the option this rejects (headless Playwright, script-only, no GUI shell).** Smaller surface, no packaging, no Chromium-bundle weight, easiest to run as a background service on a headless machine. If the owner never actually wants a window (pure background automation, checked via the aki-mcp-sv panel or a CLI), this plan is doing more work than needed. Worth a one-line confirmation before starting: does the owner want to *see* windows, or only *query* status?
2. **Attack the favored option (Electron).** Bundled Chromium is a real disk/memory cost per profile window if many profiles run concurrently — game-multiboxing tools hit exactly this ceiling. No mitigation designed yet; size it once profile count is known.
3. **Inversion — how would this fail on purpose?** Ship it depending on the undetected-fingerprint assumption above being false: claude.ai starts challenging the Electron session on day one, every window shows a CAPTCHA instead of chat. That is why it is checklist item #1, not an afterthought.
4. **Pre-mortem, six months out.** Anthropic changes the `/usage` response shape or SSE field name (unversioned internal API) → usage bars silently show stale/wrong numbers with no error, because nothing currently in this plan validates the shape before trusting it. Add a schema sanity-check, not just a try/catch.
5. **Second-order effects.** A second, Electron-owned Chromium profile per claude.ai account means login state now lives in two places (the owner's normal browser and this app) — sign-out/2FA/session-expiry handling has to be designed per profile, not assumed away.
6. **Tauri + External Chrome CDP path.** Exposing the remote debugging port forces `navigator.webdriver = true` and other automated headers. This introduces a critical point of failure where Cloudflare challenges the browser session with endless CAPTCHA prompts.

## Open questions to resolve before execution starts

- Confirm item 1 of the critique: window-based or headless-first?
- Where does this app live — new repo, or a subfolder of `aki-mcp-sv`? Different bounded context (`pattern.A6`) from the existing MCP server; leaning new repo, not decided.
- Concurrent profile count target — shapes whether Chromium-per-window memory cost (critique #2) needs addressing in v1 or can wait.

## Execution checklist (phased, not started)

- [-] (superseded by AIObox) **Phase 0 — spike, answers the unverified blockers.** (a) Bare window loading claude.ai on the chosen shell — Electron `BrowserWindow` and/or Tauri webview — log in by hand, confirm no bot challenge and that `/usage` + SSE respond from that context. (b) If evaluating Tauri: prove real per-profile cookie/storage isolation on ship OS (or document a working workaround). (c) If evaluating Tauri + External Chrome CDP: verify if claude.ai blocks the debug-enabled instance (via `navigator.webdriver` check) with Cloudflare CAPTCHA challenges. Stop and rethink if any fail for the shell under test.
- [-] (superseded by AIObox) **Phase 1 — profile registry.** JSON store + partition-per-profile create/rename/delete, no UI yet (CLI or panel-style temp UI for testing).
- [-] (superseded by AIObox) **Phase 2 — claude.ai window.** Preload script: widen-pane injection (ported from the Tampermonkey draft) + fetch/EventSource patch for `message_limit` + `/usage` poll, IPC the parsed numbers to main.
- [-] (superseded by AIObox) **Phase 3 — control center window.** Lists all profiles + live status pushed from main; start/open/close actions per profile.
- [-] (superseded by AIObox) **Phase 4 — custom chrome.** `frame:false` + drag region + minimal window styling.
- [-] (superseded by AIObox) **Phase 5 (stretch, not required for v1).** Investigate whether an Electron-embedded window can register as this repo's MCP custom connector via `localhost`, removing the Funnel/OAuth hop for this specific app.

## Out of scope (this note)

- Auto-clicking "continue" on limit reset — trivial to add once Phase 2's usage data is live (same numbers, one more IPC action), deliberately left out of v1 scope so the plan doesn't balloon before Phase 0 even answers whether the approach works at all.
- Anti-detection hardening (stealth patches, proxy rotation) — only relevant if Phase 0 fails; do not pre-build a mitigation for a risk not yet confirmed real.
- Any change to `aki-mcp-sv` itself. This is a new, separate app; nothing here edits `scripts/*.js` in this repo.

## Cross-references

- `docs/plan/chrome-tampermonkey-autosetup.md` — the widen-script source this plan ports into a preload script; also the prior (now superseded, see above) reasoning for avoiding a custom extension.
- `docs/research/chrome-cdp-default-profile-block.md` — why "attach to the user's live default Chrome" was never an option, for either this or the old `chrome.js`.
- `she-llac/claude-counter` (MIT, github.com/she-llac/claude-counter) — source of the `/usage` + SSE `message_limit` mechanism this plan reuses; read `userscript/claude-counter.user.js` directly when Phase 2 starts, don't reimplement from this summary alone.
- `RULE-stack-tauri.md` B1 — titlebar-boundary pattern this plan's Phase 4 echoes conceptually (Electron mechanism differs).
- AkiTgAuto (`/Volumes/DEV/Frameworks/Electron/AkiTgAuto`) — proven Electron multi-profile + preload inject into remote origin (same pattern this plan uses for claude.ai).

## Decision
**v1 = Electron** (isolation gate). Tauri deferred until isolation spike passes — not a parallel v1 track. **Action** → Phase 0 Electron spike first (claude.ai load + `/usage`/SSE). Not started.
