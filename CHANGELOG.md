# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning per [SemVer](https://semver.org/).

## [Unreleased]

## [2.0.0] - 2026-09-13

### Added
- **Background Task Runner (`aki__task_start`, `aki__task_manage`)**: Detached, asynchronous background command execution with allowlist gating, zero-RAM direct-to-disk log streaming, process-group teardown (POSIX `-pid` / Windows `taskkill /t /f`), PID recycling defense, and non-blocking head/tail log truncation.
- **OS Native Integration (`aki__notify_user`, `aki__clipboard_read`, `aki__clipboard_write`)**: Cross-platform desktop notification banner with alert sound chime (macOS `osascript` Glass, Windows Toast, Linux `notify-send`) and system clipboard bridge (`pbcopy`/`pbpaste`, PowerShell `Get-Clipboard`/`Set-Clipboard`, `xclip`) enabling remote AI to alert the user upon task completion and seamlessly copy/paste text.
- **Localhost & Intranet HTTP Fetcher (`aki__local_fetch`)**: Safe client allowing remote LLMs (Claude Web, ChatGPT) to test local dev servers and LAN APIs with 5-layer SSRF protection (blocks cloud metadata `169.254.*`, link-local IPv6, non-HTTP schemes, 512KB response truncation, max 15s timeout).
- **Chromium Remote & Profile Automation (`aki__chrome_profiles`, `aki__chrome_launch`, `aki__chrome_tabs`, `aki__chrome_interact`, `aki__chrome_probe_ai`, `aki__chrome_stop`)**: Clones real user profiles (Chrome, Brave, Edge) into `~/.aki/mcpsv/chrome-clones/` via atomic allowlist swap (`.incoming`), preserving macOS Keychain and Windows DPAPI cookie decryption without touching running browsers; launches stealth Chrome on dynamic `--remote-debugging-port=0` with `DevToolsActivePort` capture, bot-detection evasion (`--disable-blink-features=AutomationControlled`), synthetic React/Vue typing (`type`), center-scroll clicking (`click`), multi-tab management, and live AI quota/session probing (Claude, ChatGPT, Grok).
- **Auto CDP Port Fallback**: All `aki__devtools_*` tools (`devtools_targets`, `devtools_eval`, `devtools_screenshot`) now make `port` optional and automatically fall back to the active Chrome session port.
- **Dev Server & TCP Port Management (`aki__port_status`, `aki__kill_port`)**: Cross-platform TCP port inspection and process killing to quickly diagnose and free up occupied ports (e.g. 3000, 5173, 8080) with self-protection guards preventing accidental termination of the server's own ports.
- **Structured Git Operations (`aki__git_status`, `aki__git_diff`, `aki__git_log`)**: Scope-checked Git tools returning clean JSON status, commit history, and smart diffs with 30KB head/tail truncation to conserve LLM context window.
- **SQLite & Local DB Inspector (`aki__sqlite_schema`, `aki__sqlite_query`)**: Built-in zero-dependency SQLite inspection using Node 22 native `node:sqlite` in strict read-only mode with DDL/DML rejection and 100-row result capping.
- **CDP Screenshot Automation (`aki__devtools_screenshot`)**: Visual page screenshot capture directly returned as MCP image content over Chrome DevTools Protocol.
- **Scoped npm distribution (`@akinet/akimcp`) & Global CLI**: installable via `npm i -g @akinet/akimcp` or runnable on-demand via `npx @akinet/akimcp`. Bundles a dedicated binary launcher `bin/akimcp.js` exposing the global `akimcp` command with standard CLI flags (`-v`, `--version`, `-h`, `--help`, `--dev`, `--port`, `--panel-port`, `--no-browser`, `--tunnel`, `--origin`).
- **Dev vs Production run separation**: Dev mode (`npm run dev` or `--dev`) cleanly isolates runtime data to `~/.aki/mcpsv-dev` and defaults to non-conflicting ports `9997` (gatekeeper) and `9996` (panel), allowing active development without interfering with a live production server or production data at `~/.aki/mcpsv`.
- **Brand-aligned MCP server metadata**: `McpServer` now broadcasts `serverInfo: { name: 'aki-mcp', version: '2.0.0', title: 'Aki MCP' }` upon initialization handshake.
- **First-run onboarding resilience**: when starting without Tailscale or with unconfigured ingress, `start.js` no longer throws a fatal crash; gatekeeper is paused while the web panel starts cleanly at `http://127.0.0.1:9998` to guide the user through section 0 setup.
- **Read-only CDP DOM probe (`scripts/aki-pmcontrol/scripts/cdp-probe.js`)**: dumps the exact DOM/localStorage contract the autoclicker depends on (permission-card roots, chat container, model-menu button, settings/send buttons, `agentModeSettings`) for the current Postman build, plus a heuristic `approvalButtons` scan that flags when `PERMISSION_CARD_ROOT` has drifted (`matchedKnownRoot:false`, reporting the real `cardClass`/`cardTestid`). It only calls `Runtime.evaluate` — clicks, navigates, and writes nothing.
- **"Aki MCP for Postman" panel branding**: the CDP-injected in-app panel is retitled from "Aki Postman Control Panel" and now shows the app version subline (`v<version>`, injected as `window.__pmAppVersion` from the repo-root `package.json`) and an `akimcp.top` link under the title.
- **"Repo" link in the panel's AKI DEV RULE section** that opens `https://github.com/lacvietanh/akidevrule`.

### Fixed
- **Test suite is hermetic and complete**: `postman-mcp.test.js` now neutralizes the real on-disk daemon pid file (it already mocked `cp.spawn`), so the read-only baseline no longer fails on a machine where the Postman control daemon happens to be running; `aki-pmcontrol-copy.test.js` model assertions track the Auto-aware `selectionMatches` (`||`, not the removed `&&`); and seven previously-orphaned test files (`postman-status`, `postman-ownership`, `postman-panel-ownership`, `roots`, `shell-mcp`, `rule-context`, `rule-context-mcp`) are wired into `npm test`.
- **Panel Auto controls now execute their named behavior and preserve user choices**: the shared permission-card loop no longer pauses behind an unrelated Thinking/Auto-run menu transition, the hidden auto-inject kill switch is removed, and daemon startup no longer rewrites every persisted Auto checkbox to `true`. Defaults remain on for unset values; explicit checks/unchecks now survive reinjection. Thinking/Auto-run and model radios continue to reflect confirmed live Postman state rather than speculative clicks.
- **Windows rule install crashed with `execvpe(/bin/bash) failed`**: `installRules()` (`scripts/panel.js`) and `installAkiRule()` (`scripts/aki-pmcontrol/index.js`) ran `bash.exe install.sh`, which on Windows resolves to the WSL launcher and dies when no distro is installed. Windows now runs `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1` (or `py -3 install.py`), and never falls through to WSL bash; non-Windows still runs `bash install.sh`. Error detection broadened to `execvpe|/bin/bash|WSL`.
- **Thinking / Auto-run toggles not bound on a fresh start**: when the AI chat panel was collapsed or still loading at bootstrap, `applyPendingAgentSwitch` received a null control and silently expired after its give-up ticks. Extracted `ensureAiChatOpen()` (now shared with the startup sequence); when the control is missing it opens the chat and refunds one give-up tick only while an open was actually issued — bounded, so a genuinely absent control still expires and can never permanently stall the permission-card loop. The chat-already-open path is unchanged.

### Changed
- **MCP tool prefix migrated from `local__*` to `aki__*`**: all tools now uniformly register under `aki__` (`aki__run_cmd`, `aki__find_path`, `aki__search_content`, `aki__read_text_file`, `aki__write_file`, `aki__edit_file`, `aki__akidevrule_context`, etc.).
- **Execution directory independence**: `scripts/http.js` and `scripts/panel.js` resolve public assets relative to package root instead of `process.cwd()`, allowing `akimcp` to be executed safely from any working directory.
- **Postman AI instruction is now served natively read-only**: the daemon injects it straight from the bundled repo asset (`scripts/aki-pmcontrol/assets/prompts/postman.md`); `loadInstructionFile()` reads only `DEFAULT_PROMPT_PATH` (no writable home copy, no legacy fallback), `init()` no longer seeds `~/.aki/mcpsv/prompts/postman.md`, and the panel's PROMPT INSTRUCTION textarea is `readonly` with the `__cdpSaveInstruction` save path removed. The prompt itself was trimmed to Postman-only provider overrides — the rule-context bootstrap is owned by the `aki__akidevrule_context` tool and is no longer restated in the instruction.
- **Model selector moved from PROMPT INSTRUCTION to CHAT AGENT**: exact-label/model-id switching is unchanged, and the radios now resync from Postman's confirmed `ai-chat-last-selected-model` value after each attempted switch and on every panel render.
- **Panel external links now open in the OS default browser**, not an in-app Postman tab: a new `openExternalUrl()` helper resolves Postman's own `openExternalLink` (located by export signature — the rspack module id is hashed per build — then cached, with a `window.open` fallback). The `akimcp.top` link, the AkiDevRule **Repo** link, and every per-team **View** link route through it.
- **"New Browser Tab" moved out of the panel header into the ANTI-BOT section** (browser-tab automation now sits with the anti-bot / `navigator.webdriver` status); the header keeps a single-line **New Window** button.

### Removed
- **Redundant/divergent Postman instruction copies**: deleted the byte-identical `scripts/aki-pmcontrol/data/aki-postman-instruction.md` and the stale writable home copy `~/.aki/mcpsv/prompts/postman.md`; removed the `USER_PROMPT_PATH` / `LEGACY_INSTRUCTION_PATH` / `LEGACY_REPO_INSTRUCTION_PATH` fallbacks, `saveInstructionFile()`, and the `__cdpSaveInstruction` CDP binding.
- **Redundant Postman paste-in prompt in the web control panel's Postman tab** (`scripts/config-page.js`): the `POSTMAN_PROMPT` snippet and its "Paste this prompt into each new chat" copy box are gone — the injected panel auto-injects the prompt and section 3 "Instructions" already carries the shared prompt.

## [1.15.0] - 2026-09-07

### Added
- **Context-length indicator in the Postman chat footer**: a colored bar (green/amber/red) showing conversation size in KB/characters, signaling when a chat has grown long enough to start a new one. Thresholds (`ctxCharAmber`/`ctxCharRed`, default 80K/150K chars) are configurable in code — no panel control to edit them yet.
- **Weekly AI credit reset countdown**: the panel usage footer and status-bar credits tooltip now show "Resets in Xd Yh" alongside the used/limit numbers.
- **Per-turn AI usage delta logged to JSONL** (`~/.aki/cdp-postman/usage-turns.jsonl`): one row per chat turn (conversation id, model, usage delta), for offline validation of the usage-tracking signal.
- **Summarize-for-handoff button in Postman control panel**: a panel button ("Summarize this chat") sends a shared summarize prompt (`aki-prompt-sum-to-new-chat.md`) into the chat, so the model writes a handoff summary you can carry into a new chat, wrapped in a 4-backtick fenced code block so it copies cleanly in one click.
- **Instruction store helper (`scripts/aki-pmcontrol/scripts/instruction-store.js`)**: modular handler for ordered prompt resolution (`loadInstruction`), directory-safe persistence (`saveInstruction`), and non-destructive default template copying (`copyDefaultIfMissing`).
- **Bundled default prompt assets**: `scripts/aki-pmcontrol/assets/prompts/` contains `postman.md` and `aki-prompt-sum-to-new-chat.md` as read-only seeds.

### Changed
- **Directory-based prompt storage for Postman control**: provider chat instructions moved to `$AKI_DATA_DIR/prompts/<provider>.md` (default `~/.aki/mcpsv/prompts/postman.md`), sharing the `$AKI_DATA_DIR` single source of truth with the main MCP server.
- Panel's "updated" timestamp now shown in 24-hour time.

### Fixed
- **Auto-click double-press could freeze the chat session**: a permission card surviving several polling ticks before leaving the DOM was being re-pressed every tick; cards are now marked once pressed and skipped afterward.
- **Chat-prompt send could silently miss**: the send button's handler attaches a render after the text lands, so one early press could hit a not-yet-wired button; sending now retries across a few frames instead of firing once.

## [1.14.0] - 2026-09-05

### Added
- **Postman app control from the panel**: a new Postman-tab **Launch** button starts (or attaches to) a control daemon (`scripts/aki-pmcontrol/`, a finished copy of the private `aiobox/labs/aki-pmcontrol` lab, driven over the Chrome DevTools Protocol) that auto-clicks Approve/Continue/Run/Try again and toggles Thinking/Auto-run inside the Postman desktop app. **Quit** stops the daemon; **New window** asks it to open another Postman window. Neither the daemon nor the panel's launch path runs at `npm start` boot. A new read-only `postman_status` MCP tool reports whether it is attached. `SIGINT`/`SIGTERM` plus `~/.aki/cdp-postman/daemon.pid` let panel Quit and `npm start` Ctrl+C stop the daemon even if it was started from the standalone lab checkout.

### Changed
- Tests live in `test/`, not mixed into `scripts/`. The lab-copy gate is `test/aki-pmcontrol-copy.test.js` (skips the sibling-lab byte check when that checkout is absent, so public CI still runs).
- New dependency: `chrome-remote-interface`, used by the Postman control daemon's CDP driver.

## [1.13.0] - 2026-09-03

### Added
- **Postman MCP JSON on the panel**: the Postman tab mints or reuses a real `/mcp` access token (same `oauth.js` issuance and `tokens.json` store) and prefills a complete MCP JSON for one-click copy. No hunting `tokens.json`, no "connect another client first", no Generate click.

### Fixed
- **ChatGPT Developer mode step restored**: 1.12.0 panel/docs dropped a still-required OpenAI step (Settings → Security and login). Custom MCP apps still need it. Registration URL / Advanced OAuth stay omitted (well-known auto-discovery).
- **ChatGPT icon path is click-to-copy** on the panel, same as other copyable values.

### Changed
- **Postman tab and README**: copy the filled JSON, paste in Postman. Prompt paste stays as a second copy field. Generate button removed; the token is issued at panel render via `getOrIssueAccessToken()`.

### Removed
- **Standalone package delivery**: Node-less bootstrap launchers, payload archives, `scripts/build/`, and the tag-triggered asset/smoke-test jobs. Install is `git clone`, `npm install`, `npm start`. GitHub Releases still publish CHANGELOG notes on a bare semver tag, with no binary assets. The panel update row is always Pull & restart (the no-git Download launcher link is gone).

## [1.12.0] - 2026-08-31

### Added
- **Postman connector**: a fifth control-panel tab (`scripts/config-page.js`) alongside Claude/Grok/ChatGPT/Gemini, with a setup walkthrough, an MCP config JSON snippet, a paste-in prompt (Postman has no persistent system-prompt field), and screenshots (`public/img/aki-mcp-instruct-postman-*.png`). Postman has no OAuth redirect for third-party MCP servers, so it authenticates with a static bearer token instead of the passphrase/OAuth flow the other clients use — the panel now instructs connecting one other client first, then copying an already-issued access token straight out of `tokens.json` (any entry works; `verifyBearer()` only checks map membership + expiry, not which client minted it).
- **Regression test for the streamable bridge session header** (`scripts/streamable-bridge.test.js`, run via `npm test` and now in CI): confirms repeated `initialize` calls reuse exactly one internal tools-server session and that a mixed-case `mCp-SeSsIoN-iD` request header is still accepted (Node normalizes incoming header names to lowercase).

### Fixed
- **Postman tab shipped with a non-functional auth instruction**: it told users to send `Authorization: Bearer <Passphrase>`, but `/mcp` only ever accepts a real minted access token (`scripts/oauth.js`'s `verifyBearer()`) — the passphrase is checked only at the one-time `/authorize` consent page. Every request built from the original instructions would have 401'd. Now points at a real token instead.
- **ChatGPT tab had stale setup instructions**: it described a Developer Mode toggle, Advanced OAuth settings, and a Registration URL to paste — none of which the current ChatGPT connector UI has. ChatGPT now auto-discovers everything from `/.well-known/openid-configuration`. `scripts/config-page.js`'s ChatGPT tab and new `docs/ref/chatgpt-connector.md` describe the real current flow (icon → name → description → connection URL → passphrase).

### Changed
- **Session-id header casing**: `Mcp-Session-Id` → `MCP-Session-Id` in `scripts/gatekeeper.js` and `scripts/streamable-bridge.js` (CORS allow/expose lists and the minted response header). Purely cosmetic on the wire — HTTP header names are case-insensitive and this repo already reads incoming headers through Node's lowercased `req.headers` — done for consistency with this project's own "MCP" capitalization elsewhere.
- **`agy` tool renamed to `agy_run`** (`scripts/agy-mcp.js`) for consistency with `kiro_read`'s `<agent>_<verb>` naming; default model bumped `gemini-3.6-flash-medium` → `gemini-3.7-flash-medium` per akidevrule's current discovery-tier default.
- **Tool descriptions no longer bake in one hardcoded root path**: `filesystem-mcp.js`, `search-mcp.js`, `shell-mcp.js` now describe scope generically ("the configured roots") instead of interpolating `getRoots()[0]` at registration time, correct now that multiple roots are supported and can change live via the panel.
- **`docs/ref/claude-connector.md`** rewritten for claude.ai's Aug 28 2025 "Add custom connector" dialog redesign (explicit Authentication/Advanced sections, auth-timing and client-registration radios, transport selection).
- **`.gitignore`** now excludes Postman's own GUI workspace scaffolding (`.postman/`, `postman/`), auto-generated when Postman opens this folder.

## [1.11.0] - 2026-08-23

### Added
- **First-session MCP onboarding**: `docs/ref/mcp-intro.md` (live-plan pattern, cross-account continuity) is read once, gated by `~/.aki/mcpsv/intro.json`, via a single pointer line in the pasted instruction prompt — not the full text, since the ChatGPT 1500-char cap has no room for it (measured: 1141/1500 chars before this change, 1292/1500 after, `docs/plan/2.0.0-improve.md` checklist item 6).

### Fixed
- **`~/.aki/aki-mcp-status.json` lived outside this app's own `USER_DIR`**: `scripts/update-check.js`'s `STATUS_PATH` now joins from `USER_DIR` (`scripts/userdata.js`) instead of computing its own `~/.aki` root, matching every other piece of this app's userData (`docs/plan/2.0.0-improve.md` checklist item 1). The pasted-instruction text in `public/panel-client.js` reads the same `USER_DIR` (now injected as a client global by `scripts/config-page.js`, alongside the existing `AKI_DIR`). The old path is not kept as a compat shim — single-user tool, self-heals on next instruction re-paste.
- **GitHub Release notes were near-empty**: `.github/workflows/release.yml` used a bare `gh release create --generate-notes`, which derives content from merged PRs only — this repo commits straight to trunk, so the body was footer-only. Now extracts the tagged version's `CHANGELOG.md` section into the release notes plus a `**Full Changelog**` compare-link footer against the previous bare-semver tag.

### Decided
- **`.env` config stays** (`docs/plan/2.0.0-improve.md` item 4, previously "consider removing"): closed as keep, not removed — non-dev packaging stays the priority, dev-facing `.env` is secondary and already fully served by the panel UI for the one thing anyone actually touches (the tunnel/ingress JSON).

## [1.10.0] - 2026-08-21

### Added
- **Provider icons in the control panel**: real Claude/Grok/ChatGPT/Gemini logos (`public/img/providers/`) now sit next to each connector tab and each section-3 settings link, replacing plain text labels.
- **Widened default read-only git allowlist**: `git ls-remote`, `describe`, `shortlog`, `merge-base` are now pre-allowed alongside the existing read-only subcommands, cutting permission-prompt friction on common lookups (`docs/plan/2.0.0-improve.md` checklist item 8). `git fetch` stays excluded since it writes local refs. `ls-remote` is only pre-allowed with zero extra arguments — git's `ext::` transport helper can turn a repository/URL argument into arbitrary process execution, so a bare `git ls-remote` is safe but one with `ext::` args is not, and the allowlist match alone can't tell them apart.

### Fixed
- **`.jpg`/`.jpeg` served with the wrong `Content-Type`**: `scripts/http.js`'s static-file `MIME` map had no JPEG entry, so `public/QR-Aki.MOMO.jpg` (and any future `.jpg`) was served as `application/octet-stream`. Browsers were rendering it anyway via content sniffing, but anything relying on the actual header (CORS, `fetch` content-type checks, downloads) would have gotten it wrong.
- **Boot-time update check cost ~22MB RSS for one HTTP request**: `scripts/update-check.js`'s `fetchText()` used the global `fetch()`, which lazily initializes Node's whole bundled `undici` client on first call anywhere in the process — for a one-shot version-check GET, that's a poor trade. Rewritten on `node:https` directly (redirect-following, same timeout/abort/JSON-or-null contract, verified against the real GitHub URLs it calls). Measured: same two requests (`checkForUpdate()`'s `Promise.all`) now cost **+8MB** instead of +22MB. Real end-to-end effect on the full running server: **~92MB → ~72.6MB RSS**. The remaining gap to the ~40MB target in `docs/plan/2.0.0-improve.md` §7 is the MCP SDK's own fixed ~27MB import cost — not something this repo's code can reduce further; ~72-76MB is the realistic floor while depending on the official SDK.
- **Panel's donate-domain price note went stale as `akimcp.cfd` approaches its 2027-08-13 expiry**: `akimcp.top` is now the default selection, with the price line carrying an inline note (e.g. the expiry warning) alongside the $/yr figure.
- **`~/.aki/aki-mcp-status.json` (the staleness file AI sessions read at session start) stayed stale until process restart**: the panel's version-refresh only updated its in-memory state; `writeStatusFile()` is now called right after so the on-disk file stays in sync on every refresh (`docs/plan/2.0.0-improve.md` checklist item 2).

### Changed
- **Donate QR made responsive**: `public/panel.css`'s `.donate .qr` grew from a fixed 118px box to a responsive one capped at 250px (`width:100%; max-width:250px; aspect-ratio:1/1`), and `config-page.js`'s PayPal QR `<img>` width/height attributes now match.
- **Collapsed from 4 Node processes to 1**: `mcp-hub` and the third-party `@modelcontextprotocol/server-filesystem` child are gone. `streamable-bridge.js` now talks to a single in-process `McpServer` (`scripts/tools-server.js`) directly over the SDK's `InMemoryTransport` — no more SSE handshake to a separately spawned process. The claude.ai session-multiplexing fix (`docs/plan/done/bridge-session-churn.md`) is unchanged: one shared internal session, `initialize` answered from cache, JSON-RPC id remapping.
- **Runtime-verified against a live `npm start` (2026-08-21)**: 8 repeated bare `initialize` calls (no `Mcp-Session-Id`, the resend pattern documented in `docs/plan/done/bridge-session-churn.md`) opened the shared tools-server session exactly once, confirming the multiplexer holds under the single-process model; sessions minted before and after all continued routing to it. The ChatGPT-style OAuth DCR round-trip (`/register` → `/authorize` with passphrase → `/token` with PKCE → a `tools/call` → `/token` refresh grant) passed end-to-end against the real gatekeeper/oauth code. A folder added to `setting.json`'s `folders` array took effect on the very next `write_file` call with **zero restart** of the running process, matching the shell/search allowlist's existing live-reload behavior.
- **Baseline RAM measured and root-caused (2026-08-21)**: single process, idle after boot, measured **~92MB RSS** — over the ~40MB target in `docs/plan/2.0.0-improve.md` §7. Isolated by incrementally importing each subsystem and reading `process.memoryUsage()`: bare Node 22.14 + `zod` alone is already ~40MB (the original target, met); importing `@modelcontextprotocol/sdk`'s `McpServer`/`Server` adds **+27MB** on its own — `types.js` eagerly builds zod schemas for the *entire* MCP protocol (resources, prompts, sampling, elicitation, tasks — 215 schema definitions), not just the `tools/*` capability this server actually uses, and the SDK's `package.json` exports no lighter server subpath, so this is a fixed cost of depending on the official SDK's server module. This project's own 5 tool modules add only ~3MB combined. The other ~22MB came from `scripts/update-check.js`'s boot-time `fetch()` call — Node's `fetch` lazily initializes the bundled `undici` client on first use anywhere in the process; fixed below.
- **File read/write/edit tools rewritten native**: `scripts/filesystem-mcp.js` replaces the third-party package with 7 hand-written tools (`read_text_file`, `write_file`, `edit_file`, `create_directory`, `move_file`, `get_file_info`, `list_allowed_directories`), symlink-safe (realpath containment check, ported from the package's own `validatePath()`) and reading allowed folders live from `setting.json` via `roots.js` — a panel folder edit now takes effect on the very next call, same as shell/search already did. Dropped rather than ported: `read_file` (deprecated alias), `list_directory`/`list_directory_with_sizes`/`directory_tree`/`search_files` (superseded in practice by `find_path`/`search_content`), `read_multiple_files`, `read_media_file` (no evidence of real use through this remote connector).
- **Tool names unchanged**: served names still carry the `local__` prefix (`local__read_text_file`, `local__write_file`, …) despite the aggregator that used to apply it being gone — reproduced centrally in `tools-server.js` so nothing already configured on claude.ai/ChatGPT (or the pasted instruction prompt) needs updating.

### Removed
- **"Restart hub" and "Apply to file tools" panel buttons**: both are pointless now that every tool — file read/write/edit included — picks up a folder-list change on its next call with no restart. `POST /api/restart` and `POST /api/paths/apply-filesystem` are gone from `panel.js`.
- **`mcp-hub` dependency and `mcp-hub.config.json`**: including `scripts/userdata.js`'s live-config reconciliation logic and `splitLaunchArgs`, which existed only to keep that file's server set in sync across upgrades.

## [1.9.3] - 2026-08-16

### Changed
- **README restructured top-to-bottom**: Install now follows the value pitch directly instead of ~120 lines of architecture/requirements theory (`docs/plan/standalone-newbie-ux-followups.md` finding 13); Requirements/Architecture/Directory layout moved after the connector steps as reference material. Drafted through two independent `agy` passes (`gemini-3.1-pro-high` draft, `gemini-3.7-flash-high` adversarial fact-check against the live file) per the owner's explicit instruction, each claim re-verified against the actual repo before being applied — the pro draft's claim about the launcher's extraction path was wrong and the flash pass caught it. Gemini was also demoted out of the opening one-line pitch and labeled experimental, matching the tool-reliability caveat the README itself already documented; the `Run` section's "skip ahead" shortcut for standalone users (which skipped past required OAuth/folder-access context) was replaced with a pointer that keeps them reading instead of bypassing it. The `README.md` "Connecting from Claude web" step also had the same stale hidden-file-only passphrase wording as the OAuth confirm page below — fixed alongside it.

### Fixed
- **README standalone-launcher steps didn't cover the OS security warnings every user hits on first run**: browser download warnings for `.command`/`.cmd`/`.run`, macOS Gatekeeper (including the System Settings → Open Anyway path for macOS 15+, where the old right-click bypass is gone), Windows SmartScreen, and the Linux `chmod +x` step (files download without the executable bit). Also added a "keep the terminal window open" note — closing it kills the running server, not just a log.
- **A full newbie walkthrough (`docs/research/standalone-newbie-user-flow-audit-aug16.md`) found 3 more real gaps**: GitHub's own "Code → Download ZIP" button sits above the release link and produces an unrunnable source archive — README now steers around it; the OAuth confirm page told users to go find a hidden passphrase file instead of pointing at the value already shown in the control panel; standalone users had no way to know they can just rerun the same launcher file to start the server again later.

## [1.9.2] - 2026-08-16

### Changed
- **Release assets renamed `-app.zip`/`-app.tar.gz` → `-payload.zip`/`-payload.tar.gz`**: the old name read as "the app to download," same as the OS launchers next to it on the GitHub Release page, so users picked the wrong (non-runnable) file. `payload` signals its role — an internal file the launcher fetches, never one a user opens directly. `release.yml` now also writes a short "pick your OS file" line at the top of the release notes instead of leaving them blank.

## [1.9.1] - 2026-08-16

### Fixed
- **Standalone launchers (`-app.zip`/`-app.tar.gz`) shipped with a blank, unstyled panel**: `scripts/http.js` serves the panel's CSS/JS/favicon from `${cwd}/public`, but `scripts/build/targets.js`'s `APP_ENTRIES` list — the files the payload builder actually packages — never included `public/`, so every 1.9.0 release asset was missing it entirely. `APP_ENTRIES` now lists the exact `public/` files the server serves at runtime (`panel.css`, `panel-client.js`, `favicon/`, and the QR/extension images referenced by `config-page.js`/`panel-client.js`) rather than the whole directory, which also held multi-MB README-only screenshots that bloated the archive past the Windows smoke-test's extraction timeout. The payload builder also now excludes `.DS_Store` when copying it in.

## [1.9.0] - 2026-08-16

### Added
- **Control panel: filter bar for section 6 (allowed shell commands)**: text input above the chip list narrows chips/rows live by substring match, pure client-side, no re-render; Save still submits the full set.
- **Control panel: folders auto-sort alphabetically on save** (case-insensitive), matching section 6's already-sorted chip list.
- **Folder scope is now runtime-live for shell/find/search**: `setting.json` gains a `folders` key as the authoritative source, read fresh per call via `roots.js`'s `getRoots()` — a folder add/remove takes effect on the very next call, no restart, matching how the command allowlist already worked. The external filesystem child (`read_file`/`write_file`/`edit_file`) is still spawn-arg-bound; a new "Apply to file tools (restarts hub)" button explicitly opts into pushing the folder list to it and restarting.
- **Standalone release delivery**: tag-triggered GitHub Actions release workflow (build, smoke-test matrix, draft release, required-6-asset gate, publish), `scripts/build/release-gate.js` (verifies all 6 assets exist and per-OS launcher checksums match the release's own SHA256SUMS), a payload+launcher builder replacing the single-archive builder, and `scripts/build/smoke-test.js` (boots the real per-OS launcher against a throwaway local server with Node stripped from PATH).

### Changed
- **filesystem MCP server invocation is now network-free at runtime**: `mcp-hub.config.json`'s `npx -y @modelcontextprotocol/server-filesystem` became a direct `node` invocation of the resolved package entry point; removes the npm-registry dependency and the npx/npm-on-PATH requirement from the client runtime path.

### Fixed
- **"Apply to file tools" broke the filesystem MCP server on any pre-existing (upgrade) install**: the npx-to-node invocation change above left `scripts/userdata.js`'s live-config reconciliation stale — it only ever added or pruned server entries, never migrated an existing one's launch shape — so `scripts/panel.js`'s arg-rewrite produced a broken hybrid `npx -y <folder>` command. Reconciliation now migrates an entry's launch shape when the template's changed, recovering the user's real directories by absolute-path detection; fresh installs were never affected.
- **Bootstrap launcher never put the bundled Node runtime on PATH before exec'ing into `start.js`**, so mcp-hub's `node`-spawned children (`local`, `filesystem`) failed with ENOENT; caught by the new smoke test.
- **Payload builder's `npm ci` never resolved on Windows**: `execFileSync('npm', ...)` bypasses the shell, so it couldn't find Windows' `npm.cmd` shim; caught by the release workflow's own Windows smoke-test job on the first real tag run.
- **Payload builder's zip step failed on Windows**: the `zip` binary isn't on `windows-latest` runners; now uses PowerShell's `Compress-Archive` on that platform.
- **Windows bootstrap smoke test hung indefinitely on timeout**: Windows has no exec-replace, so the launcher's `cmd.exe -> powershell.exe -> node.exe` stay three separate processes; killing only the `cmd.exe` PID orphaned `node.exe` holding stdio open forever. Now tree-kills via `taskkill /T /F` on win32, spawned detached so the kill can't reach outside its own tree; a leaked open server handle after the switch to `process.exitCode` was fixed with `try/finally` cleanup, and the Windows first-run timeout was widened to 300s once logs showed `Expand-Archive` was still mid-extraction at 150s.
- **Release job failed on every tag**: the payload builder's `npm ci` staging directory (`dist/stage-payload/`) was never cleaned up, so `gh release create ... dist/*` tried to upload a directory as an asset and errored. Staging is now removed once the archives are built.

## [1.8.1] - 2026-08-15

### Fixed
- **Docs drift audit**: corrected `docs/ref/claude-connector.md`'s stale claim that DCR is off (`registration_endpoint` has been advertised since the ChatGPT connector work and is live); moved `docs/plan/consolidate-mcp-tool-processes.md` to `docs/plan/done/` with its status corrected from "runtime verification pending" to shipped and verified since 1.5.0; added the missing `docs.A4` anchor stamp to `docs/feat/tools.md`; added the three docs that existed but were missing from `docs/index.md` (`plan/panel-ux-improve.md` and two `research/` records) and removed a duplicate index entry.

## [1.8.0] — 2026-08-15

### Added
- **3-tab ingress picker in Setup Step 0**: Tailscale+Funnel / Owned public origin / Hosted domain. Ingress precedence gains a fourth tier: `--tunnel` > `PUBLIC_ORIGIN` > saved panel config > Tailscale Funnel, persisted to `~/.aki/mcpsv/ingress.json`.
- **Hosted-domain tab: domain-purchase-request UI**: 4-TLD dropdown with pricing (akitao.com / akinet.me / aiobox.app / akimcp.cfd), free-text subdomain input, submit opens a prefilled Messenger contact request.
- **Standalone packaging build script**: bundles a portable Node runtime + app into a per-OS archive for Node-less client machines. Windows/Linux archives not yet built/tested; macOS path only.
- **Native `.env` file support for local config**: `.env.example`, `.gitignore` rule, fail-silent when the file is absent.
- **CI smoke test** (`.github/workflows/ci.yml`): syntax-checks every script on push/PR to `main`.

### Changed
- Footer links now carry `utm_source=aki-mcp-sv-footer` tracking; eco-icon box styling removed.
- **Project guidance (`CLAUDE.md`) optimized & compacted**: trimmed narrative fluff and duplicate global release rules (~40% byte reduction), parameterized Tailscale diagnostic probe, and structured Chesterton's fences as high-density invariants.
- **OAuth confirm/error pages redesigned**: the connect-confirmation page now names the connecting client ("An app called X wants to connect"), and invalid/wrong-passphrase responses render a styled HTML error page instead of plain text.
- **`~/.claude` grant locked in panel section 5**: no delete button, so it can't be revoked by accident; removing it now requires editing `~/.aki/mcpsv/mcp-hub.config.json` directly.

### Fixed
- **Step 0's "done" badge now reflects live Tailscale/origin state** instead of always showing done.
- **Passphrase confirm page no longer leaks the OS username**: the displayed file path is now home-relative (`~/...`) instead of the absolute path.

## [1.7.0] — 2026-08-14

### Added
- **macOS shell allowlist gains `open`, `sips`, `ffmpeg`** (`scripts/allowlist.js`): local media handling for a connected client — open a file/URL/app (`open`), resize or convert images (`sips`), transcode media (`ffmpeg`). macOS-only, added to the `MAC_EXTRA` per-OS data table (not the shared Unix set). Unlike the rest of the allowlist these are not read-only.
- **`PUBLIC_ORIGIN` ingress escape hatch to bypass Tailscale** (`scripts/start.js`): set `PUBLIC_ORIGIN` to a stable public URL (e.g. a Cloudflare Tunnel subdomain that terminates TLS at its edge and forwards to the gatekeeper) and the server skips Tailscale entirely, using that origin as-is. Everything downstream keys off the single `origin` value, so no other code path changes. For regions where the Tailscale Funnel public edge is unreliable. Surfaced in panel section 0 as a fallback below the Funnel re-sync command. Approach contributed via PR #4 (`@Ran-Xing`), TLS-termination path dropped since Cloudflare terminates at the edge.
- **Opt-in `cloudflared` named-tunnel launcher** (`scripts/start.js`): `npm start -- --tunnel <cred.json> --origin https://your-host` reads `TunnelID` from the cloudflared credentials JSON and runs `cloudflared tunnel run` against `127.0.0.1:9999`, giving a stable public edge for regions where the Tailscale Funnel edge drops individual requests. Ingress precedence is `--tunnel` > `PUBLIC_ORIGIN` > Tailscale Funnel (default). JSON-credentials mode only (no yml, no token): the hostname comes from `--origin` (required — a credentials JSON carries none) and the forward port is fixed, so a single code path covers it; `--tunnel` without `--origin` exits with an error. The `cloudflared` child is killed on shutdown and via the exit safety net, a missing binary prints an install hint, and an unexpected exit tears the stack down. The reliability win over Funnel is not yet proven — the drop-rate test in the plan is design only. Plan: `docs/plan/cloudflare-tunnel-ingress.md`.

### Fixed
- **Panel section 0 stops reporting a false Tailscale failure under a custom ingress** (`scripts/panel.js`, `scripts/config-page.js`): when the server runs its own tunnel (`--tunnel`) or `PUBLIC_ORIGIN`, section 0 no longer runs the Tailscale probe or shows the Recheck button, the install/funnel checks, and the re-sync command; it shows a small "Custom ingress active" block naming the mode (Cloudflare tunnel or PUBLIC_ORIGIN) and the serving origin instead. Previously a user who intentionally ran their own tunnel saw a wrong/failed Tailscale state in section 0.
- **Instruction re-paste wording named the right place** (`scripts/config-page.js`, `scripts/start.js`): the panel banner, the section-3 warning, and the AI-facing prompt told users to paste "the header" into "each account" / "personalization field" — terms no provider's UI actually uses, so the AI parroted "paste the header into preferences" and users could not find it. Reworded to "re-paste the Instructions into the custom-instructions setting of each AI", matching the section-3 title and leaning on the existing per-provider settings links.
- **akidevrule update banner no longer reappears after updating** (`scripts/panel.js`, `scripts/config-page.js`): the boot-time `updateInfo` was never recomputed, so after **Install / update** updated the corpus on disk, a page reload re-rendered the "update available" banner from stale data. The `install-rules` route now re-reads the local version and clears `updateAvailable` for real, and the panel drops the now-empty banner box live. The mcp self-update banner intentionally stays until restart, since its new code isn't loaded until then.

## [1.6.0] — 2026-08-12

### Added
- **Update check for both aki-mcp-sv and akidevrule on every `npm start`** (`scripts/update-check.js`): one `checkForUpdate()` compares local vs GitHub — this repo via `main/package.json`, the rule corpus via the newest released header in `master/CHANGELOG.md` (akidevrule has no version field). Surfaced as a colored console banner (own update on top, rule below) and a panel banner under the title: mcp shows **Pull & restart** on a git checkout or a **Download** link on a zip install; akidevrule shows **Install / update** plus a warning to re-paste the instruction into each account. The same rule-update warning repeats in section 3 (rule select). New `POST /api/pull-update` route (`scripts/panel.js`) pulls this repo only when the tree is clean (`git status --porcelain` gate at click-time). Plan: `docs/plan/update-check-notify.md`.
- **Paste-in instruction now carries versions + a staleness self-check** (`scripts/config-page.js` `buildPrompt`): the prompt opens with `[akimcp <ver> · akidevrule <ver>]` and gains one line telling the model to read `~/.aki/aki-mcp-status.json` at session start and warn the user to re-paste (per account) when the pasted versions are older than what's installed, or an update is available. `start.js` writes that status file each boot under `~/.aki` (an already-allowed root the connector can read).
- **Scroll-to-top button + spy-TOC rail in the panel** (`scripts/config-page.js`): a fixed bottom-right button appears past 400px of scroll and smooth-scrolls up (every breakpoint incl. mobile); a fixed vertical numbered rail (sections 0–6, built from the sections themselves so labels never drift) highlights the section in view via `IntersectionObserver` and jumps on click, shown only ≥1040px where there is side room. Closes `docs/plan/panel-ux-improve.md` feature 4.

### Changed
- **One copy pattern for every copyable value/command** (`scripts/config-page.js`): a single `.copy` primitive (ui.A1 Tier-2 pattern class) replaces both the old `field()` label+value+button rows and the inline `<code>` boxes that looked copyable but weren't. Every command/value/inline-code (MCP URL, passphrase, `npm start`, `sudo`, the Funnel re-sync command, …) is now the same monospace chip: click anywhere to copy, ⧉ glyph, ✓ feedback — driven by one delegated click handler. `.mono` stays a plain-text monospace helper (no box, not clickable) so nothing masquerades as copyable. The long Funnel re-sync command moved out of prose into a proper copy row.

### Fixed
- **Long commands no longer overflow the panel on mobile** (`scripts/config-page.js`): the `.row` value track was `1fr` (implicitly `minmax(auto,1fr)`), so a long non-wrapping `.copy` command forced the track past the viewport instead of scrolling inside its chip. Changed to `minmax(0,1fr)` (desktop + the 560px breakpoint) so the chip caps at 100% width and the command scrolls within it.
- **Default rule selection tracks the akidevrule rename** (`scripts/config-page.js`): `RULE-design-core.md` → `RULE-pattern-core.md` in `DEFAULT_RULES`, so the generated instruction points the model at the file that now exists. Living plan docs repointed `design.*` → `pattern.*`; historical records (research, `done/`) intentionally keep the old name.

## [1.5.0] — 2026-08-12

### Changed
- Panel §0: Funnel re-sync hint for intermittent connector drops. When the public edge returns `200` but one ingress IP's TLS handshake is slow, §0 prints the `funnel off / serve reset / funnel --bg 9999` cycle to run (needs sudo). Evidence: `docs/research/claude-ai-oauth-connector.md` round 9.
- MCP tool processes consolidated 8 to 4; tool arms unified under one `local` server (`scripts/local-tools-mcp.js`; the shell/agy/kiro/search arms are now `register(server)` modules). Tools renamed to `local__*`: `local__run_cmd`, `local__agy_run`, `local__kiro_read`, `local__find_path`, `local__search_content`. Existing connectors must reconnect. `scripts/userdata.js` auto-migrates legacy config.
- Paste-in instruction reworked: `working.md` to `plan.md`, dynamic plan (skip pure Q&A), tighter MCP-over-sandbox boundary.
- README expanded with use-cases, product positioning, and Grok cloud automation.

## [1.4.0] — 2026-08-11

Panel onboarding is rebuilt for multi-client setup: a step-overview header, sections reordered to follow the real flow, and the Connectors section split into shared values + per-client tabs (Claude/Grok/ChatGPT/Gemini). Instructions now deep-links each client's settings page, not only Claude's. Plus a second usage-watch extension for Grok, an install-when-missing prompt line, a locked `index.md` rule checkbox, and case-insensitive extended-regex `search_content`.

### Added
- **Grok Usage Watch in panel §4 (Browser utilities)** (`scripts/config-page.js`): a second recommended Chrome extension beside Claude Token Counter, showing grok.com's rate-limit/usage bar that the site doesn't surface itself. Screenshot `public/extension-grok-usage.png`. The Claude extension image was renamed `claude-tokenizer-chrome-extension.png` → `public/extension-claude-usage.png` (naming now parallels the Grok one); the `<img src>` was repointed.
- **Panel prompt tells the model to install rules when they are missing** (`scripts/config-page.js` `buildPrompt`): when "load rules" is on but `index.md` is not present under the rules dir, the generated instruction gains one line asking the user to press Install/update in panel §2 before starting — closing the gap where a web client with no harness `@`-import silently ran with null rules. Plan: `docs/plan/done/improve-instructions-1.3.1.md` §1.

### Changed
- **Panel onboarding restructured — a step overview header + renumbered sections** (`scripts/config-page.js`): a new header shows the required flow as a horizontal stepper (0 Setup · 1 Connectors · 2 Install rules · 3 Instructions · 4 Extension), step 0 marked done and step 4 marked optional, each linking to its section. Sections were reordered to follow that flow: Tailscale becomes **0 · Setup** (its two live checks plus clone / `npm install` / `npm start` shown done), then **1 Connectors → 2 Install AkiDevRule → 3 Instructions → 4 Browser utilities → 5 Folders → 6 Allowed shell commands**. All in-panel cross-references were repointed to the new numbers.
- **Connectors (§1) reorganized into common values + client tabs** (`scripts/config-page.js`): the three values every client shares — **MCP Name, MCP URL, Passphrase** — sit once at the top, and the per-client walkthroughs (Claude / Grok / ChatGPT / Gemini, Claude active by default) moved into a horizontal tab strip, so a user reads only their own client's steps. Claude's two extra credentials (OAuth Client ID / Secret) live in the Claude tab; Gemini's steps reference them from there. Replaces the stacked `h3` sub-sections and the collapsed Gemini `<details>`. A small click handler toggles the active tab/pane.
- **Instructions (§3) links to each client's settings, not only Claude's** (`scripts/config-page.js`): the single "Open Settings → General" link (Claude-only) became a row of four deep links — Claude, Grok (`?_s=personality`), ChatGPT (`#settings/Personalization`), Gemini (`saved-info`) — and the copy hint is now client-neutral instead of naming claude.ai.
- **`index.md` rule checkbox is now locked** (`scripts/config-page.js` `renderRuleChecks`): it sorts first in the §3 rule checklist and renders checked + disabled with a 🔒, so the rule map can't be unchecked by accident (the other three core rules stay optional). Plan: `docs/plan/done/improve-instructions-1.3.1.md` §1.
- **Prompt drops the misleading singular `DATA_DIR`** (`scripts/config-page.js` `buildPrompt`): the allowlist is multi-root, so the prompt now says "run_cmd cwd=absolute under an allowed root" and "all local paths use Aki MCP FS only" instead of naming one directory. The dead `DATA_DIR` client const, its `renderPanel` param, and the caller arg (`scripts/panel.js`) were removed. Default 4-rule prompt is 833 chars (< 1500). Plan: `docs/plan/done/improve-instructions-1.3.1.md` §3.
- **`search_files` stays prompt-banned, not proxied out** (`docs/plan/done/improve-instructions-1.3.1.md` §2): the filter-proxy option was researched and rejected — a stdio passthrough would have to re-own JSON-RPC framing/shutdown and, decisively, it changes the shape of `filesystem.args`, which `filesystemPaths()`/`setFilesystemPaths()` in `scripts/panel.js` parse by fixed position to build the directory allowlist. MVP is the existing `never … search_files` line in the paste-in prompt — a soft/UX boundary, since `find_path` already supersedes the tool. Documented in `docs/feat/tools.md`.
- **`search_content` is now case-insensitive extended regex by default** (`scripts/search-mcp.js`, `grep -rnI` → `-rniIE`): a single query carries every alias joined by `|` (`"funnel|ingress|thay.*funnel"` hits EN+VI+synonym in one call, and `Funnel` matches `funnel`), so multi-concept hunts stop fanning out into N sequential calls or falling back to `run_cmd grep`. Measured on this repo: the two load-bearing wins are **correctness** (`funnel` case-sensitive found 27 lines and missed 39 `Funnel` hits → false "not found"; now 66) and **fewer round-trips** (N concepts → 1 reliable call, versus the old BRE path silently returning junk when `\|` was forgotten). Not a real win: query time (≈15ms at this tree size) and per-call output size (an OR result is *larger*, being the union of all aliases) — the context saving is fewer full-history re-sends, not smaller payloads. The tool description now states the `-iE` contract with an OR-alias example. `docs/feat/tools.md` gains a 7-step **search ladder**. No prompt change — `buildPrompt` uses a static residual, not tool descriptions. Plan (with the measured table): `docs/plan/done/smart-search-strategy.md`.

## [1.3.0] — 2026-08-10

Shell trust gets a second axis and a real editing UI: **trusted script directories** run Aki-authored scripts without a per-command allowlist row, the allowlist is reworked into **chips + rows** with a P0 revoke-bug fix in its storage format, and the paste-in instruction prompt is rewritten to **residual-only** (959 chars, down from ~1309). Plus a panel UI/content pass, and dead-route cleanup in the gatekeeper.

### Changed
- **Paste-in instruction prompt rewritten to residual-only** (`scripts/config-page.js` `buildPrompt`): carries only what the force-loaded akidevrule core cannot guarantee (density residual `DON'T YAPPING`, the force-load line, scope gate + `working.md`, MCP tool-selection contract, repo + sandbox boundary), dropping restatements of design/coding laws already in the four core files. Default (4 rules ticked) is now **959 chars**, down from ~1309; live char counter and over-1500 warning kept. Plan: `docs/plan/done/instruction-prompt-minimal-override.md`.
- **Panel UI/content pass** (`scripts/config-page.js`): copy fields shrunk (smaller text and box; copy button unchanged) and the MCP URL row highlighted; the no-op "Copy all 5 values" button removed. ChatGPT section corrected (Developer mode works on the **free** plan too; dropped the "paid plan" claim and plan-tier header) and trimmed; Gemini folded into a collapsed section with a "connects but doesn't reliably drive tools; not recommended" note; Grok cut to its two fields, with its **Name required to equal the MCP Name** (the paste-in instruction keys off that name). Rule-zone folder rows now show a 🔒 icon instead of a "locked · rules" label. Section 5 (akidevrule) de-duplicated against the section-6 checklist, plus a Windows install note; footer gains a MoMo donate QR. Trusted-dir list shows only **active** zones (the always-disabled `~/.aki`/`~/.claude` rows and their render/explain code are gone). All field lists share one compact CSS pattern; the panel's em-dashes replaced with plain punctuation.

### Added
- **Trusted script directories** — a second, directory-scoped trust mechanism beside the name allowlist (`shell.allowlistDirs`, default `~/.aki`, `~/.claude`): any executable, or a script run via an interpreter (`node`/`python3`/…), under a trusted zone runs without its own allowlist row, so new Aki skills/scripts need no `setting.json` edit. `checkPermission` is now `name-allow OR dir-allow`, so `node ~/.aki/x.js` passes without loosening `node`'s `-v`-only name entry, while `node -e '<code>'` (no file arg) stays blocked. Fail-safe: a zone overlapping a filesystem write root is dropped (write+exec = RCE) with a stderr warning; the panel shows each zone active/inactive with the offending folder named. Reuses `roots.js` containment, no second copy. The panel section 4 has an editable list (add / remove / save, live with no hub restart) to manage these zones, showing each active or disabled with the offending folder named. Plan: `docs/plan/done/shell-allowlist.md`.
- **Panel allowlist as chips + rows**: any-subcommand commands render as compact chips, restricted commands as rows with a subcommand field; click a chip to restrict it; empty a row's subcommands (or use its **any** button) to collapse it back (level inferred from the data). Risk flag colors the chip/row (red for destructive `rm`/`curl`/…, amber for `git`/`npm`/… while unrestricted). No raw-JSON editor. Stored as `{ added:[2-level entries], revoked:[] }` (bare string = any, `[bin, ...subs]` = restricted), so there is no hand-written `null`; enforcement (`checkPermission`, the `{bin:null|array}` map) is unchanged.
- Read-only default commands broadened and made cross-platform + per-OS (`jq`, `basename`, `git blame/rev-parse/…`, macOS/Linux/Windows tables), authored as a list where structure carries the level. `find`/`sort`/`fd`/`rg` deliberately excluded — their flags (`-exec`/`-o`/`-x`/`--pre`) escape read-only and the `args[0]` gate can't restrain a flag; `search__find_path`/`search__search_content` cover lookup.

### Fixed
- **Allowlist revoke bug (P0):** deleting a default command in the panel did not revoke it; the flat storage couldn't tell "explicitly removed" from "never mentioned", so it fell back to the default on reload, contradicting the UI's own hint. Storage is now an explicit diff against the defaults (`{ added, revoked }`); a removed default lands in `revoked` and stays gone. `loadAllowlist` still reads the older flat-map and `{overrides,revoked}` shapes.

### Removed
- **Dead `/messages` reverse-proxy route in `scripts/gatekeeper.js`** (`forwardToHub` + the `MCP_HUB_PORT` upstream const, ~20 lines) — a leftover of the pre-bridge design. Since `streamable-bridge.js` took over, external clients speak Streamable HTTP (`POST /mcp`) and the legacy SSE transport is hard-blocked (`GET /mcp` → 405), so no external client can open an SSE session to reach `/messages`; the internal bridge POSTs `/messages` straight to the hub on `127.0.0.1:19999`, bypassing the gatekeeper entirely. The route served no live traffic. No behavior change for any connector.
- `kiro_write` MCP tool (`scripts/kiro-mcp.js`) — duplicated the `filesystem` MCP arm's `write_file`/`edit_file`, which every connected session already has, behind a second hard-locked `claude-sonnet-4.5` worker. Owner decision: consolidate file-write trust into the connected session's own model. `kiro_read` (read-only) is retained unchanged. Does not restore git/shell write access (`shell.allowlist` in `~/.aki/mcpsv/setting.json`, separate axis, unaffected). Plan: `docs/plan/done/remove-kiro-write.md`.

## [1.2.1] — 2026-08-09

Patch: Gemini + Grok connectors fixed and confirmed from live connects (Gemini connects but drives tools unreliably), the Kiro arm actually deployed to existing installs and verified against `kiro-cli` 2.16.2, connector renamed OS-neutral, and a docs pass to the akirule standard.

### Fixed
- **Gemini connector now works — two bugs, both from live traces (2026-08-09).** (1) Its `redirect_uri` goes through Google's OAuth proxy `https://oauth-redirect.googleusercontent.com/r/...`, not a `gemini.google.com` path — the 1.2.0 prefix was a wrong guess. (2) The deeper cause: Gemini reuses Claude's **confidential** client (pasted Client ID/Secret), but `handleAuthorize` pinned that client to exactly `[CLAUDE_CALLBACK]`, so `isAllowedRedirect` (only used at `/register`) never applied to it and every Gemini authorize hit `redirect_ok=false → 400`. The shared confidential client is now marked `isStatic` and accepts any allowlisted callback at authorize; DCR/public clients stay pinned to the exact URI they registered. Panel rewritten to Gemini's real flow: paste the confidential Client ID/Secret like Claude (it does not self-register), on paid tiers including Pro — not Enterprise-only.
- **Grok connector now works.** Its real `redirect_uri` is `https://grok.com/connectors-oauth-exchange-code/` (not the guessed `/connector/oauth/`), observed from the new register-reject log. `GROK_CALLBACK_PREFIX` corrected; Grok self-registers as a public client and its callback is now allowlisted. Both Gemini and Grok confirmed end to end from live connects 2026-08-09 (`authorize → token` both 200).
- **The Kiro arm never reached an existing install.** `scripts/userdata.js` copied `mcp-hub.config.json` into `~/.aki/mcpsv/` only when it was absent, so the `kiro` server added to the shipped template stayed invisible on any install created before it — the live hub kept booting the original four servers (filesystem/search/shell/agy). Startup now additively merges template servers that are missing from the live config, inheriting the panel's current roots, without touching panel-edited entries; Kiro (and any future arm) now deploys on the next `npm start`.

### Changed
- `POST /register` logs the submitted `redirect_uris` on a 400, so an unknown client reveals its real `redirect_uri` for allowlisting instead of failing silently.
- **Kiro arm verified against the live binary.** `kiro-cli` 2.16.2 is now installed here; the hard-locked `claude-sonnet-4.5` id (1.30x credits) and every flag it uses (`--no-interactive`, `--trust-tools=fs_read`/`fs_read,fs_write`, `--effort low|medium|high|xhigh|max`) were confirmed against `kiro-cli chat --help`/`--list-models` (2026-08-09). `docs/ref/harness-fact.md` § kiro promoted from `[owner]`/unverified to `[obs]`. Dropped `--require-mcp-startup` (guarded a state that can't arise — the arm configures no MCP servers). New `docs/ref/harness-fact.md` records the agy/kiro CLI facts by evidence tier.
- Connector display name changed from "Aki Mac MCPSV Shell & Filesystem" to "Aki MCP Server from local Shell & FileSystem" (drops the Mac-only wording — the server is OS-agnostic).
- Gemini connector documented with a caveat (panel + README): the OAuth handshake succeeds and Gemini accepts the instruction, but in repeated testing 2026-08-09 it did not reliably discover or drive the MCP tools — connection healthy, tool use unreliable. Claude and Grok are the dependable clients today.
- Docs brought to the akirule doc standard: the three completed plans (`integrate-gemini-grok`, `integrate-kiro-cli`, `instruction-prompt-improve`) moved to `docs/plan/done/`, and every inbound plan link (index, CHANGELOG, ref/research docs) repointed so nothing 404s. Also fixed a batch of pre-existing stale plan links (`init`, `bridge-session-churn`, `unify-windows-linux` were already in `done/`). README architecture diagram now lists the `agy` and `kiro` hub servers; `docs/index.md`'s "Gemini (Enterprise)" corrected to the real paid-tier/live-verified state.

## [1.2.0] — 2026-08-09

Two new connectors (Gemini + Grok) and a Kiro CLI worker arm, a paste-in instruction prompt tightened under ChatGPT's 1500-char cap, and the shell read-only guarantee closed for real (issue #2) — bundled with the 1.1.0 audit follow-up (ChatGPT connect fix, XSS fix, SSoT dedup) that was still sitting unreleased.

### Added
- **Gemini and Grok connectors** ride the existing OAuth 2.1 + RFC 7591 DCR path: `isAllowedRedirect` (`scripts/oauth.js`) now allowlists Grok and Gemini-Enterprise callbacks beside Claude and ChatGPT, and panel section 2 has an onboarding walkthrough for each (each emitting `<origin>/register` as a copy field). The Grok/Gemini `redirect_uri` prefixes are **provisional** — flagged in code with the live-connect discovery command — and the OAuth round-trip on each is unverified until a real connect. Consumer gemini.google.com may not support custom MCP connectors; the feature targets Gemini Enterprise/Business. Plan: `docs/plan/done/integrate-gemini-grok.md`.
- **Kiro CLI arm** (`scripts/kiro-mcp.js`, wired into `mcp-hub.config.json`): two separate MCP tools — `kiro_read` (`--trust-tools=fs_read`) and `kiro_write` (`--trust-tools=fs_read,fs_write`) — so a connector can approve write independently of read. The model is hard-locked to `claude-sonnet-4.5`; the prompt is a separate `execFile` arg. Requires `kiro-cli` on `PATH` and is **unverified at runtime** here (the binary isn't installed); it fails loud on a missing binary, never fabricating output. Plan: `docs/plan/done/integrate-kiro-cli.md`.
- Paste-in instruction prompt now carries a mandatory per-task workflow line: investigate and confirm scope before editing, then keep and update `$HOME/.aki/mcpsv/task/<id>/working.md` so a later session resumes. Plan: `docs/plan/done/instruction-prompt-improve.md`.
- `/.well-known/openid-configuration` served as an alias of the authorization-server metadata, so ChatGPT can auto-discover `registration_endpoint` and auto-fill its Registration URL.
- Panel section 2 now carries a concrete ChatGPT walkthrough (developer-mode + create-connector deep links) and emits the exact `<origin>/register` value as a copy field — the missing step that unblocks DCR. Claude's Client ID/Secret fields are scoped to a Claude-only subsection so they aren't pasted into ChatGPT by mistake.
- Panel folder rows for the trust zones (`~/.aki`, `~/.claude`, rules dir) render locked (no delete button), so rule-file access can't be revoked by an accidental row deletion.

### Changed
- SSoT dedup: extracted `scripts/http.js` (`readBody` / `json` / one traversal-guarded `serveStatic` + a single MIME map), `scripts/mcp-tool.js` (the `ok` / `err` / `fail` tool-result envelope, previously inlined ~8×), and `scripts/html.js` (the `esc` HTML-escaper). `oauth.js`, `gatekeeper.js`, `panel.js`, `streamable-bridge.js`, `search-mcp.js`, `shell-mcp.js`, `agy-mcp.js`, `config-page.js` now import these instead of carrying local copies. Dropped the dead `resolveClient` export. Net −64 lines.
- Panel and README copy corrected: the shell set is described as "curated to read-only" rather than "read-only only" / "fully off-limits" (and, with `find`/`sort` now removed — see Security — the default set is read-only by construction).
- Instruction prompt (`config-page.js` `buildPrompt`) compacted under ChatGPT's 1500-char instruction cap: the rules-dir path is emitted once instead of prepended per rule file, the lines are rewritten dense, and section 6 shows a live char count that turns red past 1500. The default (4 rules ticked) lands at ~1309 chars.
- `agy` tool tuned: the `effort` enum is restricted to `low|medium|high` to match the installed `agy --help` (it previously advertised `xhigh|max`, which the CLI rejects), and the valid agy model ids are documented on the `model` parameter.

### Fixed
- Reflected XSS on the `/authorize` confirmation page: the `state`, `codeChallenge`, `redirectUri`, `clientId`, and `codeChallengeMethod` hidden-field values are now HTML-escaped before rendering.

### Security
- **Shell read-only guarantee closed** (issue #2): `find` and `sort` are removed from the default allowlist. Their own flags escape read-only (`find -delete`/`-exec`, `sort -o <path>`) and `execFile` is no defense since the danger is the binary's argv, not a shell — so a default connector could previously write, delete, or exec through the shell tool. `find_path`/`search_content` cover the read-only lookup they were reached for. This reverses 1.1.0's "accepted tradeoff" framing in favour of closing the hole; no per-binary flag sanitizer was added (the allowlist curates the surface instead).

## [1.1.0] — 2026-08-08

Windows support and the ChatGPT custom connector come from [PR #1](https://github.com/lacvietanh/aki-mcp-sv/pull/1) by **capybara** (`okdev888`), rebuilt onto the OS-agnostic architecture of `docs/plan/done/unify-windows-linux.md` — see `docs/plan/done/merge-pr1-windows-chatgpt.md` for what was adopted as-is and what was reshaped.

### Added
- ChatGPT custom connector on the same Funnel URL (contributed): RFC 7591 `POST /register` (dynamic client registration), public-client token auth (`none`), and allowlisted `https://chatgpt.com/connector/oauth/…` redirects. Registered clients persist in `~/.aki/mcpsv/oauth-dcr-clients.json`. Panel section 2 documents Claude and ChatGPT side by side. Claude's pre-issued Client ID/Secret path is unchanged.
- `scripts/agy-mcp.js`: dedicated MCP server for the `agy` CLI (wired into `mcp-hub.config.json`), replacing the generic shell route that shell-tokenized the whole command and could mis-split a multi-word `-p` prompt. Here `prompt`/`mode`/`model`/`effort`/`outputFormat` are separate `execFile` args, so no quoting step can get them wrong. Defaults to read-only mode `plan` and the fast wide-context discovery model; other modes must be opted into via `setting.json` `agy.allowedModes`, and `cwd` is enforced under an allowed root through the shared `resolveUnderRoot`.
- `scripts/open-browser.js`: small cross-platform "open default browser" helper (`open` / `cmd start` / `xdg-open` by `process.platform`), replacing the macOS-only `execFileSync('open', ...)` call in `start.js` — no new npm dependency added.
- `scripts/log.js`: shared timestamped logger. Gatekeeper request lines now carry an ISO timestamp + duration; `oauth.js` and `streamable-bridge.js` log each OAuth step, session open/close (with reason), stale-session 404s, and request timeouts — so a failed connect points at its exact cause instead of going silent.

### Changed
- OAuth metadata advertises `registration_endpoint` and `token_endpoint_auth_methods_supported: ["none","client_secret_post"]` (contributed). The token endpoint now authenticates the client per its registered method and binds each authorization code and refresh token to the client it was issued to.
- `agy-mcp.js`, `search-mcp.js`, `shell-mcp.js`: each MCP server and tool now advertises a human-readable `title` ("Antigravity CLI", "File Index" / "Find Path" / "Search Content", "Shell" / "Run Command"), so the connector UI lists them by name instead of by bare protocol id.
- Windows/Linux unification (`docs/plan/done/unify-windows-linux.md`): `package.json` `start` script no longer relies on bash-only `${VAR:-default}` syntax; `scripts/panel.js` folder picker (`osascript`, macOS-only) replaced with a manual "+ Add folder…" text input; `validatePaths` now uses `path.isAbsolute` instead of a hardcoded leading-`/` check, so Windows drive-letter paths pass; `scripts/config-page.js`'s `CLAUDE_DIR` build now uses `path.join` instead of manual `/` string concatenation; `scripts/search-mcp.js`'s path-depth sort in `walk`/`findPath` now splits on `path.sep` instead of `/`.
- `streamable-bridge.js`: per-request response timeout raised 30s → 10 min (`MCP_REQUEST_TIMEOUT_MS`) so long shell runs aren't cut off. (The 5-minute idle auto-close and the per-client session model it belonged to are gone entirely — see the single-session rewrite under Fixed.)

### Removed
- `scripts/chrome.js` and its 4 panel routes/UI (Chrome tab connect/restart/list/eval via CDP): macOS-only (`pgrep`, `osascript`) and already broken since Chrome 136 regardless of OS. The manual "paste this into the browser console" widen-chat-pane snippet is kept, folded into the Utilities section, since it never depended on Chrome automation.

### Fixed
- `streamable-bridge.js`: **the mass "client disconnected from MCP HUB" log is fixed at the root** (`docs/plan/done/bridge-session-churn.md`, Option B). Measurement (`docs/research/claude-ai-mcp-session-reinit.md`) showed claude.ai re-sends `initialize` with no `Mcp-Session-Id` every ~10s — 17 hub sessions in 4 minutes for 3 conversations — so the old per-client model spawned a throwaway hub session each time, producing thousands of connect/disconnect pairs. The bridge now holds **one** internal hub session for the whole process: every external client multiplexes onto it via JSON-RPC id remapping, and each `initialize` is answered locally from the cached hub result. The hub now logs one connect at boot and one disconnect at shutdown regardless of re-initialize frequency. Removed the per-client sessions Map, the `MCP_MAX_SESSIONS` cap, LRU eviction, and the diagnostic churn counters that scoped this fix — all compensating machinery the corrected shape no longer needs.
- `start.js` / `tailscale.js`: `npm start` now auto-starts Tailscale when it is stopped. `tailscale status --json` returns valid JSON even while the backend is `Stopped`, so `funnelStatus` previously reported the daemon as healthy and never brought it up — the public Funnel URL then closed every connection (`ERR_CONNECTION_CLOSED`). `funnelStatus` now reads `BackendState`, and `start.js` runs `tailscale up` before enabling the Funnel. A `NeedsLogin` state still requires manual login (surfaced in the log).
- Windows (contributed): `npm start` no longer dies on `spawn npx ENOENT` — the hub is resolved with `require.resolve('mcp-hub/dist/cli.js')` and run through `process.execPath`, and every child inherits an explicit `HOME`/`USERPROFILE` so the `${HOME}` placeholders in `mcp-hub.config.json` expand. Child processes spawn with `windowsHide: true`, spawn failures are reported instead of dying silently, path containment compares case-insensitively, and the panel's rule installer looks for `bash.exe` with a Git-for-Windows hint when it is missing.
- `shell-mcp.js`: the backslash is no longer treated as a dangerous character on any platform. `execFile` never invokes a shell, so it is an inert literal everywhere while being a legitimate path separator on Windows — one branchless rule rather than a per-OS one.
- Default shell allowlist widened with read-only commands: `sort`, `uniq`, `cut`, `diff`, `basename`, `dirname`, `realpath`, `which`, `date` everywhere, plus `where`, `findstr`, `tasklist`, `hostname` on Windows. `sed`/`awk`/`xargs`/`perl`/`python`/`env` are deliberately excluded — each can write files or execute an arbitrary program.

## [1.0.2] — 2026-08-08

### Changed
- README restructured for density: em dash count in prose cut from 46 to 0 (replaced with periods/colons/parentheses per clause meaning), a Contents line added, vague headings renamed (`DEMO img` → `Screenshots`, `Chrome control — why "reconnect" is a separate button` → `Chrome control`, `Connector icon: not controllable from the server` → `Connector icon`), and self-justifying design commentary cut in favor of stated facts. No content removed, no accuracy changes.

## [1.0.1] — 2026-08-07

### Changed
- `roots.js`: single root (`ROOT`) widened to an array of roots (`ROOTS`), enforced identically for `shell-mcp.js` and `search-mcp.js` through the same `resolveUnderRoot`. Saving folders in the panel (`setFilesystemPaths`) now syncs that same list into `search`/`shell`'s `MCP_DATA_DIR` — one allowlist, not two copies that can drift apart.
- README rewritten entirely in English: added a "Why this exists" section (web vs API quota economics, why Tailscale+MCP instead of installing an app) and moved the whitelist-vs-blocklist comparison with Desktop Commander to the top instead of burying it at the end.

### Removed
- The one-time `<repo>/data/` → `~/.aki/mcpsv/` migration in `userdata.js` (added in 1.0.0): it serves no purpose past the first run, removed outright instead of leaving dead code in place permanently. **Known risk**: anyone who installed before `~/.aki/mcpsv/` existed and never ran 1.0.0 loses their old OAuth client/passphrase on upgrading straight to this version — accepted since 1.0.0 shipped the same day, with no external users yet.

### Fixed
- `resolveUnderRoot` (`roots.js`) now fails closed when `MCP_DATA_DIR` is empty/malformed (falls back to home) instead of silently losing containment.

## [1.0.0] — 2026-08-07

First public release: strip everything that only worked on the author's machine, so anyone can clone and run it.

### Added
- `scripts/userdata.js` — all user data (live config, OAuth client, passphrase, tokens) consolidated under `~/.aki/mcpsv/`, secrets at mode 0600.
- `scripts/tailscale.js` — reads Funnel status in one place, shared by `start.js` and the panel.
- `scripts/allowlist.js` — the default shell command set becomes a single source of truth: the server enforces and the panel displays the same set.
- `scripts/search-mcp.js` — `find_path` / `search_content`, whole tree scanned in one call.
- `scripts/chrome.js` — Chrome control via CDP, no external package dependency.
- Panel: Tailscale section with a status indicator, folder picker via macOS's native dialog (multi-select in one pass), akidevrule section showing the install command, AkiTao ecosystem footer.
- Panel shows every command verbatim for copying: the akidevrule install command, the claude.ai chat-window expansion command.

### Changed
- Default root for the filesystem MCP server: `$HOME` instead of the author's hardcoded path.
- `mcp-hub.config.json` in the repo becomes the shipped default; the live copy lives in `~/.aki/mcpsv/`, so nothing edited in the panel shows up as a repo diff.
- Panel sections reordered to match the actual setup sequence, Chrome moved to the end since it's optional.
- Chrome: "Connect" no longer quits Chrome on its own — Chrome only opens its debug port at launch, so reopening it now sits behind a button that says exactly what it does.

### Fixed
- Funnel re-enabling on every `npm start`: `AllowFunnel` is keyed by the public port (443), not the internal one, so the port-9999 comparison never matched. Repeated toggling risked hitting Let's Encrypt's certificate rate limit.
- The panel didn't validate incoming data: a wrongly-typed allowlist made `Array.isArray` false and **silently allowed every subcommand** of that binary. Now rejected at the boundary with an actionable error.
- The panel could show an empty allowlist and then save it over the entire default set.
- The "Copy all 5 values" button matched every copy field on the page, not just the intended ones.
- Author-specific paths left over in `docs/plan/`.

## [0.1.0]

Internal, never released.

- MCP server (filesystem + shell) exposed via Tailscale Funnel with an OAuth 2.1 gatekeeper.
