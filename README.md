# aki-mcp-sv (`@akinet/akimcp`)

Give Claude on the **web** (claude.ai), **ChatGPT**, and **Grok** read/edit access to files and a whitelisted shell on your local machine. Operates over HTTPS through a swappable public edge (Tailscale Funnel by default, or your own Cloudflare tunnel / any stable HTTPS edge), gated by OAuth 2.1. *(Experimental support for Gemini — see [Connecting from Grok and Gemini](#connecting-from-grok-and-gemini). Also connectable from Postman's AI Agent — see [Connecting from Postman](#connecting-from-postman).)*

No desktop app. No device lock-in. One command to run.

<img width="1190" height="1062" alt="aki-mcp-sv control panel" src="https://github.com/user-attachments/assets/760a7202-ad61-4f5d-86e3-973e90c74bd3" />

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](CHANGELOG.md) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![npm version](https://img.shields.io/npm/v/@akinet/akimcp.svg)](https://www.npmjs.com/package/@akinet/akimcp) [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#install)

**Contents:** [Why this exists](#why-this-exists) · [When to use & Core Use-Cases](#when-to-use--core-use-cases) · [Install & Run](#install--run) · [Connecting from Claude web](#connecting-from-claude-web) · [Connecting from ChatGPT](#connecting-from-chatgpt) · [Connecting from Grok and Gemini](#connecting-from-grok-and-gemini) · [Connecting from Postman](#connecting-from-postman) · [Autonomous Cloud Automation](#autonomous-cloud-automation-grok--local-mcp) · [Requirements](#requirements) · [Architecture](#architecture) · [Directory layout](#directory-layout) · [Configuration](#configuration) · [Exposing to the internet](#exposing-to-the-internet) · [Finding files](#finding-files) · [Security](#security)

## Why this exists

Claude.ai's web/Pro quota is far cheaper than paying per token via the API for equivalent usage. But most real work is project work: reading, editing, and running commands against files on your machine, not open-ended chat.

The Claude Desktop app already does local file access, but ties usage to a device ID you don't control, and running multiple accounts means repeated login/logout. With this web-based approach, you get true multi-account flexibility instead: just switch browser profiles to pick up a different account (e.g. several Claude Pro subscriptions), all pointed at the same local machine, no device lock-in.

**aki-mcp-sv** routes around both problems: run an MCP server on your machine, expose it over HTTPS through Tailscale Funnel, and connect it to claude.ai as a custom connector.

**The payoff:**
- **Use your web quota** for local file and shell access, straight from the browser.
- **True multi-account flexibility:** switch browser profiles to instantly pick up a different account, all pointed at the same machine.
- **Safe by default:** a strict command whitelist, not a leaky blocklist — see [Security](#security).

### When to use & Core Use-Cases

- **At your desk:** a native Terminal/CLI (Claude Code, Antigravity CLI, Cursor) is still the fastest, most fluid option — use that.
- **Away from your desk (mobile / web / a machine that isn't yours):** use `aki-mcp-sv` via Claude Web, ChatGPT Mobile, or Grok to check on a running job, read logs, clean up temp files, or pull the latest code on your home/office machine.
- **On a schedule, with nobody watching:** pair Grok's scheduled prompts with `aki-mcp-sv` for cloud-triggered local execution — see [Autonomous Cloud Automation](#autonomous-cloud-automation-grok--local-mcp).

## Install & Run

> [!NOTE]
> **Is this safe to run?** Nothing is installed system-wide outside user directory, no background daemon is created, and no `sudo`/administrator privileges are required. Settings and tokens live safely at `~/.aki/mcpsv/`. The shell tool is whitelist-only (see [Security](#security)). Closing the terminal window stops the server.

### 1-Line Global Install (Recommended)

```bash
npm install -g @akinet/akimcp
akimcp
```

Or run instantly without installing:

```bash
npx @akinet/akimcp
```

### From Source (For Contributors)

```bash
git clone https://github.com/lacvietanh/aki-mcp-sv.git
cd aki-mcp-sv
npm install

# Run in isolated development mode (~/.aki/mcpsv-dev, ports 9997/9996)
npm run dev

# Or run in standard production mode (~/.aki/mcpsv, ports 9999/9998)
npm start
```

## Run

```bash
cp .env.example .env   # optional: only if you need PUBLIC_ORIGIN or another non-default var
npm start
```

Nothing needs preparing beforehand; `npm start` handles it:
- **Passphrase** and **OAuth client ID/secret** in `~/.aki/mcpsv/`: generated once, reused on every later run.
- **Funnel**: checks `tailscale funnel status`; if port `9999` isn't on yet, runs `tailscale funnel --bg 9999` (idempotent: never toggles an already-enabled port).
- Prints the 4 values you need: **Remote MCP server URL**, **OAuth Client ID**, **OAuth Client Secret** (paste into claude.ai), and **Passphrase** (enter on the confirmation page when you hit Connect).
- Opens the **control panel** at `http://127.0.0.1:9998/?t=<token>`. A step header maps the flow (0 Setup · 1 Connectors · 2 Install rules · 3 Instructions · 4 Extension), then the sections follow it: 0 Setup (a 3-tab ingress picker: Tailscale + Funnel / Owned public origin / Hosted domain), 1 Connectors, 2 Install akidevrule, 3 Instructions prompt, 4 Browser utilities, 5 allowed Folders, 6 shell allowlist.

The default allowed root is your **home directory** (`$HOME`, or `%USERPROFILE%` on Windows): the one folder guaranteed to exist on any machine and to hold the projects you actually want Claude to reach. In plain terms, that means the whole home folder (Desktop, Documents, Downloads, Photos, everything under it), not just the projects you meant to share. Add/remove folders from **panel section 5**: click "+ Add folder…" and type an absolute path (`/Users/you/projects` or `C:\Users\you\projects`). Saving takes effect immediately for every tool — shell, find, search, and file read/write/edit alike — no restart. To change the root from the start: `MCP_DATA_DIR=/other/path npm start` (or `set MCP_DATA_DIR=D:\work` then `npm start` on Windows cmd).

Beyond `$MCP_DATA_DIR`, the filesystem tools are also granted `~/.aki` (where akidevrule deploys) and `~/.claude`, so claude.ai can read your **native** `CLAUDE.md` and skill router the same way Claude Code does, with no copying or staging.

`~/.claude` is granted at the folder level (the filesystem tools can't scope to individual files), so `.claude.json`/`auth-cache.json` (session tokens) and `history.jsonl` (chat history) inside it are also reachable through the connector. This row is locked in panel section 5, with no delete button by design so it can't be revoked by accident; the panel itself cannot remove it. If you don't want `~/.claude` granted at all, edit `~/.aki/mcpsv/setting.json` and remove the `~/.claude` entry from its `folders` list before connecting; claude.ai then loses access to your `CLAUDE.md` too.

`npm start` runs in the foreground: Ctrl+C to stop, restart manually when needed. **After editing code, Ctrl+C and `npm start` again** (Node doesn't hot-reload).

## Connecting from Claude web

1. Go to **claude.ai → Settings → Connectors → Add custom connector**
2. **Remote MCP server URL**: paste `https://your-machine.your-tailnet.ts.net/mcp` (printed by `npm start`)
3. **Advanced settings → OAuth Client ID / OAuth Client Secret**: paste the two values `npm start` printed
4. Click **Connect**: a local confirmation page opens; enter the **passphrase** shown in the control panel (section 1 · Connectors) to approve — or read it straight from `~/.aki/mcpsv/passphrase.txt`

Why not token-in-URL: `docs/ref/claude-connector.md`, `docs/research/claude-ai-oauth-connector.md`.

claude.ai connects and calls the in-house `aki__*` tool suite (39 tools):
- **Chromium Remote & Profiles**: `aki__chrome_profiles`, `aki__chrome_launch`, `aki__chrome_tabs`, `aki__chrome_interact`, `aki__chrome_probe_ai`, `aki__chrome_stop` (stealth port-0 clone, auto-port fallback, React/Vue synthetic typing, scroll-to-center click, and AI quota probe)
- **DevTools & CDP**: `aki__devtools_targets`, `aki__devtools_eval`, `aki__devtools_screenshot`
- **OS Native Integration**: `aki__notify_user` (desktop notification banner & chime sound), `aki__clipboard_read`, `aki__clipboard_write` (system clipboard read/write bridge)
- **Localhost & Intranet Fetch**: `aki__local_fetch` (SSRF-protected HTTP client for local backend APIs and LAN services)
- **Background Tasks**: `aki__task_start`, `aki__task_manage` (detached background execution, process-group teardown, zero-RAM direct log streaming & tailing)
- **Filesystem**: `aki__read_text_file`, `aki__write_file`, `aki__edit_file`, `aki__create_directory`, `aki__move_file`, `aki__get_file_info`, `aki__list_allowed_directories`
- **Search & Execution**: `aki__find_path`, `aki__search_content`, `aki__run_cmd`
- **Dev Servers & Ports**: `aki__port_status`, `aki__kill_port`
- **Git Operations**: `aki__git_status`, `aki__git_diff`, `aki__git_log`
- **SQLite Database**: `aki__sqlite_schema`, `aki__sqlite_query`
- **Agent & Context**: `aki__agy_run`, `aki__kiro_read`, `aki__akidevrule_context`
- **Postman Control**: `aki__postman_status`, `aki__postman_eval`, `aki__postman_rename_conversation`, `aki__postman_panel_fullwidth`

**Note on the connector icon:** claude.ai doesn't read the icon from the MCP server. It queries Google's favicon service with the tailnet's **apex domain**, not your host: `https://t2.gstatic.com/faviconV2?...&url=http://<tailnet>.ts.net&size=32`. `<tailnet>.ts.net` has no public DNS record, so Google returns 404 and claude.ai falls back to a default letter icon. This server serves `/favicon.ico` publicly, but no file placed here can change that result: your subdomain never appears in the query Google receives.

## Connecting from ChatGPT

Needs ChatGPT Plus/Pro (or Business/Enterprise/Edu) with **Developer mode** for custom connectors.

1. ChatGPT → Settings → Security and login → enable **Developer mode**
2. Create a custom connector / app → paste the same MCP URL (`https://your-machine.your-tailnet.ts.net/mcp`)
3. Enter the same **passphrase** on the confirmation page

ChatGPT self-registers via DCR (RFC 7591, PKCE, no secret) from `/.well-known/openid-configuration`. Do not paste Claude's Client ID or Secret. Same folder allowlist and shell allowlist as Claude.

## Connecting from Grok and Gemini

Both ride the same MCP URL and passphrase flow — no separate transport or auth. They differ in *how* the client authenticates, and the connector panel (section 1) prints the exact copy fields for each.

**Grok — verified, production-ready:** **self-registers** via the `/register` DCR path like ChatGPT — paste only the MCP URL, no Client ID. Its real `redirect_uri` `https://grok.com/connectors-oauth-exchange-code/` was observed live 2026-08-09 and is allowlisted via `GROK_CALLBACK_PREFIX`. Verified working end to end (`authorize → token` 200). If a future Grok change moves that callback, a rejected registration logs `register REJECTED (redirect_uri not allowlisted): [...]` so the new value can be re-allowlisted.

**Gemini — experimental, connection works but tool use doesn't (yet)** (paid tiers only — Pro / Business / Enterprise; the free tier may not expose custom apps): pastes a **confidential client**, exactly like Claude — set the custom app link to the MCP URL, then under Advanced Settings paste the same Client ID / Client secret. Gemini's redirect goes through Google's OAuth proxy `https://oauth-redirect.googleusercontent.com/r/...` (observed live 2026-08-09), allowlisted by `isAllowedRedirect` in `scripts/oauth.js`. **Caveat:** the OAuth handshake succeeds and Gemini accepts the instruction, but in repeated testing 2026-08-09 it did not reliably discover or drive the MCP tools — connection healthy, tool use unreliable. Claude and Grok are the dependable clients today.

## Connecting from Postman

Postman's AI Agent (Flows / Connected Accounts) has no OAuth redirect for third-party MCP servers and no persistent system-prompt field.

1. In the panel's Postman tab, click the filled JSON to copy. It has the live MCP URL and a real minted access token. It is not the passphrase.
2. In Postman, add a new MCP server (Settings → Connected Accounts) and paste the JSON.
3. Paste the panel's prompt into each new chat, since Postman doesn't persist one across sessions.

The Postman tab also has a **Launch** button that attaches control to the Postman desktop app itself — auto-clicking Approve/Continue/Run/Try again and toggling Thinking/Auto-run inside the Postman window, on top of opening it if it isn't already running. **Quit** stops that control daemon; **New window** asks it to open another Postman window. None of this runs at `npm start` boot — it starts only when Launch is clicked. The in-app overlay it injects is the **Aki MCP for Postman** panel (opened from a status-bar button): it shows the running version and an `akimcp.top` link under the title, keeps the **New Browser Tab** control in the **ANTI-BOT** section, and opens every external link — `akimcp.top`, the AkiDevRule **Repo** button, and each team's **View** — in your OS default browser through Postman's own link handler.

## Autonomous Cloud Automation (Grok + Local MCP)

Grok's scheduled prompts turn your machine into a headless "personal remote AI node": no browser tab, no desktop app, just `npm start` running in the background.

- **Cloud-triggered local execution:** set up a scheduled prompt in Grok (Automation) that fires at a fixed time.
- **Headless:** Grok's cloud service sends the request to `/mcp` over your Tailscale Funnel URL, and `aki-mcp-sv` runs the task — health check, log sweep, `git pull`, cleanup — with nothing open on your end.
- **Zero UI required:** as long as the process is running, no browser or app needs to be open for the scheduled task to execute.

## Requirements

- Node.js 22, on Windows, Linux, or macOS.
- **Windows only:** [Git for Windows](https://git-scm.com/download/win) (or WSL) on `PATH` — the shell/search tools shell out to Unix binaries (`ls cat pwd grep head tail wc file stat tree ps df du whoami uname`), and akidevrule's `install.sh` needs `bash`; Git for Windows' `usr/bin` ships the coreutils/findutils/grep/diffutils this needs. Same category of prerequisite as Tailscale below, not a code dependency.
- Tailscale (one-time setup):
  1. [Install Tailscale](https://tailscale.com/download) and sign in (on macOS, the app or `brew install tailscale` both work as long as `tailscale` is on PATH)
  2. Enable [Funnel](https://tailscale.com/docs/features/tailscale-funnel) for your tailnet: free on every plan, a one-time toggle via the `login.tailscale.com/f/funnel` link `npm start` prints if it isn't on yet

After that, `npm start` enables Funnel on port 9999 automatically every run.

## Architecture

```
Claude web / ChatGPT
      │  HTTPS + OAuth 2.1 (Claude: paste client ID/secret; ChatGPT: DCR self-register)
      ▼
Tailscale Funnel        (https://your-machine.your-tailnet.ts.net)
      │
      ▼
gatekeeper.js  — public port 9999
      │           /.well-known/oauth-* + openid-configuration  metadata (openid is an alias for ChatGPT discovery)
      │           /authorize, /token    minimal authorization server (scripts/oauth.js)
      │           /register         RFC 7591 dynamic client registration (ChatGPT self-registers here)
      │           /mcp                  requires a valid Bearer access token, else 401
      │                                 POST → real Streamable HTTP (scripts/streamable-bridge.js)
      ▼
tools-server.js — one shared McpServer, in-process (InMemoryTransport, no child, no SSE), tools:
                                  search-mcp.js       (find_path/search_content, whole-tree in one call)
                                  shell-mcp.js        (allowlisted commands, curated to read-only)
                                  agy-mcp.js          (Antigravity CLI, read-only plan mode)
                                  kiro-mcp.js         (kiro_read, read-only, needs kiro-cli on PATH)
                                  filesystem-mcp.js   (native read/write/edit inside the allowed folders)
                                  postman-mcp.js      (Postman daemon status/eval/rename/panel tools)
                                  rule-context-mcp.js (akidevrule_context handshake tool)
                                  chrome-mcp.js       (profile clone, stealth launch, tabs, interact)
                                  chrome-profile.js   (Chrome/Brave/Edge profile clone + cookie decrypt)
                                  cdp-mcp.js          (devtools_targets/eval/screenshot over CDP)
                                  cdp-engine.js       (shared CDP launch/target/eval engine)
                                  fetch-mcp.js        (SSRF-protected localhost/LAN HTTP fetch)
                                  task-mcp.js         (detached background task start/manage)
                                  port-mcp.js         (TCP port status/kill)
                                  git-mcp.js          (scope-checked git status/diff/log)
                                  system-mcp.js       (notify_user, clipboard read/write)
                                  sqlite-mcp.js       (read-only node:sqlite schema/query)

panel.js       — 127.0.0.1:9998, never exposed via Funnel
                 control UI: allowed folders, shell allowlist,
                 install akidevrule, generate the connector prompt
```

The ingress layer is swappable: Tailscale Funnel is the zero-config default, but the same `/mcp` endpoint can instead be served through your own Cloudflare named tunnel or any stable public HTTPS edge you already run — see [Exposing to the internet](#exposing-to-the-internet). Everything below the ingress line (gatekeeper, OAuth) is unchanged whichever edge you pick.

OAuth (not token-in-URL) is used because claude.ai always attempts Dynamic Client Registration regardless of configuration (`docs/research/claude-ai-oauth-connector.md`). ChatGPT also expects OAuth; this server advertises `/register` (RFC 7591 DCR) so ChatGPT can self-register while Claude can keep using the pre-issued Client ID/Secret.

## Directory layout

```
aki-mcp-sv/
├── package.json
├── LICENSE
├── bin/
│   └── akimcp.js                 # global CLI entry point (`npm i -g @akinet/akimcp`), imports scripts/start.js
├── scripts/
│   ├── start.js                 # orchestrates gatekeeper + panel, single process
│   ├── open-browser.js           # cross-platform "open default browser" — the one per-OS seam, no external dep
│   ├── gatekeeper.js             # OAuth-gated reverse proxy, public port
│   ├── oauth.js                  # minimal authorization server (pre-registered client + RFC 7591 DCR)
│   ├── streamable-bridge.js      # Streamable HTTP shim <-> the in-process tools server (InMemoryTransport)
│   ├── tools-server.js           # builds the one shared McpServer mounting every tool arm below
│   ├── http.js                   # shared HTTP helpers: readBody / json / serveStatic (+ MIME)
│   ├── shell-mcp.js              # allowlist-gated shell tool (curated to read-only)
│   ├── agy-mcp.js                # register() module for the agy CLI (mounted by tools-server.js)
│   ├── kiro-mcp.js               # Kiro arm: kiro_read (read-only) tool, sonnet-4.5 locked, needs kiro-cli on PATH
│   ├── filesystem-mcp.js         # native read/write/edit tools, symlink-safe path containment
│   ├── postman-mcp.js            # postman_status/eval/rename/panel_fullwidth tools + daemon launch/kill path
│   ├── rule-context-mcp.js       # akidevrule_context MCP tool (schema, registration, output mapping)
│   ├── rule-context.js           # pure rule-context assembler used by rule-context-mcp.js
│   ├── chrome-mcp.js             # chrome_profiles/launch/tabs/interact/probe_ai/stop tools
│   ├── chrome-profile.js         # clones real browser profiles (Keychain/DPAPI cookie decryption)
│   ├── cdp-mcp.js                # devtools_targets/eval/screenshot tools over CDP
│   ├── cdp-engine.js             # app-agnostic CDP launch/target/eval engine shared by chrome-mcp/postman-mcp
│   ├── fetch-mcp.js              # aki__local_fetch: SSRF-protected localhost/LAN HTTP client
│   ├── task-mcp.js               # aki__task_start/task_manage: detached background task runner
│   ├── port-mcp.js               # aki__port_status/kill_port: TCP port inspection + kill
│   ├── git-mcp.js                # aki__git_status/diff/log: scope-checked git tools
│   ├── system-mcp.js             # aki__notify_user, clipboard_read/write
│   ├── sqlite-mcp.js             # aki__sqlite_schema/query: read-only node:sqlite inspector
│   ├── aki-pmcontrol/            # finished copy of the private aiobox lab: CDP-driven Postman desktop control
│   ├── mcp-tool.js               # shared MCP tool-result envelope: ok / err / fail
│   ├── allowlist.js              # default command set + settings reader — shared by server and panel
│   ├── search-mcp.js             # find_path / search_content — whole tree in one call
│   ├── roots.js                  # path containment shared by every filesystem-touching tool
│   ├── tailscale.js              # reads Funnel status — shared by start.js and panel
│   ├── update-check.js           # checks for newer aki-mcp-sv/akidevrule versions, shown in the panel
│   ├── log.js                    # shared timestamped logger
│   ├── panel.js                  # loopback-only control panel (:9998), token-gated
│   ├── config-page.js            # renders the panel page
│   ├── html.js                   # HTML escaper (esc) — shared by oauth confirm page and panel
│   └── userdata.js               # user data location (~/.aki/mcpsv) — single source of truth
├── test/                         # test suite (run via `npm test`)
└── public/                       # panel CSS/JS, favicon + images, served publicly by gatekeeper
```

Your data lives outside the repo, at `~/.aki/mcpsv/` (the same convention CLIs like `~/.aws` or `~/.docker` use):

```
~/.aki/mcpsv/
├── setting.json          # allowed folders + shell allowlist, edited from the panel
├── oauth-client.json     # pre-issued client ID + secret, for Claude (0600)
├── oauth-dcr-clients.json # clients that self-registered via /register, one per ChatGPT connector (0600)
├── passphrase.txt        # passphrase for the /authorize consent screen (0600)
├── tokens.json           # access/refresh tokens (0600)
└── prompts/              # per-provider chat prompts (aki-pmcontrol), seeded from scripts/aki-pmcontrol/assets/prompts/
```

`scripts/aki-pmcontrol/assets/prompts/` in the repo is the bundled **default, read-only** source for those prompts — the daemon copies a file from there into `~/.aki/mcpsv/prompts/` on first launch only, and never writes back into the repo.

A clone stays exactly as checked out: editing folders/allowlist from the panel never produces a diff in the repo.

## Configuration

Copy `.env.example` to `.env` and uncomment what you need — `start.js` loads it automatically on boot (falls back silently to defaults when `.env` is absent, so the default Tailscale flow is unaffected). Supported vars: `PUBLIC_ORIGIN`, `GATEKEEPER_PORT`, `PANEL_PORT`, `MCP_DATA_DIR`, `MCP_REQUEST_TIMEOUT_MS`. For a one-off alternate profile, pass `node --env-file=.env.user ./scripts/start.js` instead.

## Exposing to the internet

Tailscale Funnel is the default, zero-config path and stays the recommended flow. If Funnel is unreliable for you, two alternative ingress options let you bring your own public edge instead — see [Alternative ingress](#alternative-ingress-if-funnel-is-unreliable) below.

`npm start` enables Funnel automatically when needed (see above), no manual step. Funnel is state stored in `tailscaled` (survives reboots), independent of `npm start`'s own lifecycle; disable it entirely with `tailscale funnel 9999 off`.

**Know before enabling Funnel:**
- Free on every Tailscale plan, but the tailnet needs a one-time opt-in first (the `login.tailscale.com/f/funnel?node=...` link `tailscale funnel --bg` prints if it's missing).
- Only 3 ports are fundeable: `443`, `8443`, `10000`; you can't expose an arbitrary port.
- Bandwidth is limited; Tailscale doesn't publish an exact number.
- Don't toggle Funnel on/off repeatedly: re-issuing the certificate too often can hit Let's Encrypt's rate limit (~34h lockout). `start.js` avoids this by checking `Web[].Handlers[].Proxy` for port 9999 in `tailscale funnel status --json` before deciding Funnel is off (not the `AllowFunnel` key, which reflects the public port 443, not 9999).

**Diagnosing "claude.ai can't connect" while `tailscale funnel status` says "on":** the serve-config can save locally but fail to sync to Tailscale's control plane, so a real client on the open internet is blocked at the TLS layer while the host machine, routed through the internal mesh, sees everything as fine. **Don't test with a bare `curl https://<host>` from the machine running `npm start`**: that machine is in the tailnet and silently takes the mesh shortcut. Test the real path instead:

```bash
dig @8.8.8.8 <host> A +short   # real public IP
curl --resolve <host>:443:<IP-from-above> https://<host>/.well-known/oauth-authorization-server
```

If that returns `SSL_ERROR_SYSCALL`/timeout despite `tailscale funnel status` saying "on", re-run `tailscale funnel --bg 9999` to force a config re-push (not a code bug). Full writeup: `docs/research/claude-ai-oauth-connector.md`, section "Debug round 5".

### Alternative ingress (if Funnel is unreliable)

The Funnel edge can intermittently drop individual requests in some regions. The drop-rate difference against Cloudflare is still unmeasured, so these are not a proven upgrade — reach for them only if Funnel is unreliable for you. Both replace the Tailscale edge entirely; the OAuth server and tool suite are unchanged. Precedence when more than one is set: `--tunnel` > `PUBLIC_ORIGIN` > saved panel config (section 0 → "Owned public origin") > Tailscale Funnel. Full rationale: `docs/plan/done/cloudflare-tunnel-ingress.md`.

**Bring your own edge (`PUBLIC_ORIGIN`):** point an env var at a stable public HTTPS origin you run and terminate yourself, and `npm start` skips Tailscale entirely, serving at that origin:

```bash
PUBLIC_ORIGIN=https://your-host npm start
```

**Cloudflare named tunnel (`--tunnel`):** the server launches a Cloudflare named tunnel for you, reading `TunnelID` from a cloudflared credentials JSON and running `cloudflared tunnel run` forwarding to `127.0.0.1:9999`:

```bash
npm start -- --tunnel <cred.json> --origin https://your-host
```

`--origin` is **required** because a credentials JSON carries no hostname. This is JSON-credentials mode only — no `yml` config, no token. Before it works you need a Cloudflare account, a named tunnel already created (`cloudflared tunnel create`), its credentials JSON, and a DNS route pointing the hostname at that tunnel.

**Someone gave you a tunnel JSON:** if a host who owns the domain already created the tunnel and DNS route and sent you the credentials JSON, you need no Cloudflare account of your own — just install `cloudflared`, then run with the origin they assigned:

```bash
npm start -- --tunnel <the-json-they-sent> --origin https://the-subdomain-they-gave-you
```

To get a subdomain under a host's domain, arrange it with them directly; there is no self-serve signup.

**From the panel (no CLI flags):** open the control panel → section 0 → "Owned public origin" tab → upload your cloudflared credentials JSON and the hostname you routed it to → Save. Takes effect on the next `npm start` (restart required, not a live switch); a "Use Tailscale Funnel instead" button reverts it.

When a custom ingress is active, the panel's section 0 skips the Tailscale checks and instead shows the active ingress and the serving origin — so the absent Tailscale UI is expected, not a fault.

## Finding files

Use `aki__find_path` to locate a file or directory — it scans the whole tree in one call (measured: ~0.2s across 164k files / 11.7k directories), returns **both files and directories**, and skips `node_modules`/`.git`/build output automatically. `query` is a case-insensitive substring, or a glob when it contains `*`/`?`.

## Security

Minimal OAuth 2.1: Claude uses a pre-issued confidential Client ID/Secret; ChatGPT uses DCR (`POST /register`) as a public client (`token_endpoint_auth_method: none`) with `chatgpt.com` redirect URIs allowlisted. Full writeup: `docs/ref/security-model.md`.

- `$MCP_DATA_DIR` (default `$HOME`, reaching your whole home folder: Desktop, Documents, Downloads, Photos, everything under it, not just projects) is every tool's main root, plus `~/.aki` and `~/.claude` (for native rule files) — read fresh from `~/.aki/mcpsv/setting.json` on every call, so a panel edit takes effect on the next call, no restart. `~/.claude` is granted at the folder level, so session tokens and chat history inside it are also in the connector's reach (a known tradeoff; the panel row is locked and can't be removed there: edit `~/.aki/mcpsv/setting.json`'s `folders` list directly if you want it out).
- The shell MCP is hand-written (`shell-mcp.js`), enforcing the allowlist in code (`execFile`, never through a shell, `; & | \`` blocked). The default set is read-only, defined in `allowlist.js` — flag-rich binaries whose own flags escape read-only (`find -delete`/`-exec`, `sort -o <path>`) are deliberately kept out of it (issue #2), so a default connector cannot write, delete, or exec through the shell tool; the `find_path`/`search_content` tools cover the read-only lookup they were used for. The panel shows exactly that set as your starting point for edits, saved to `~/.aki/mcpsv/setting.json` → `shell.allowlist`. **Any command you add is your own responsibility**: adding an obvious write command (e.g. `git commit`) widens the surface further. A command can run in any directory under the allowed roots via the `cwd` parameter, used instead of `cd`/`-C` to target a specific repo.
- `gatekeeper.js` is the single public entry point; every tool runs in-process behind it, nothing else listens on any port.
- `panel.js` writes config and runs commands on your machine, so it **only binds to `127.0.0.1`** and is never exposed via Funnel. Its token is regenerated every `npm start` and required both in the page's query string and in the `x-panel-token` header on every API call, blocking other browser tabs from POSTing to it.
- `~/.aki/mcpsv/passphrase.txt` (the `/authorize` consent passphrase) and `~/.aki/mcpsv/oauth-client.json` (client ID/secret) are mode 0600, live outside the repo (never reach git), and are only ever shared once, pasted into the connector dialog.
- Access/refresh tokens live in `~/.aki/mcpsv/tokens.json` (mode 0600) and survive restarts: a connector is long-lived file access, not a login session, so losing tokens on every `npm start` would just force pointless re-authentication. Access token TTL is 1 year, refresh tokens don't expire. Revoke by deleting `~/.aki/mcpsv/tokens.json` and restarting.
- Each ChatGPT connector instance self-registers one client into `~/.aki/mcpsv/oauth-dcr-clients.json` (mode 0600). Registration is open but not a way in on its own: only `claude.ai` and `chatgpt.com` redirect URIs are accepted, and a registered client still has to pass the passphrase consent screen and PKCE before it gets a token. Revoke those registrations by deleting that file and restarting.
- Funnel stays enabled in the background for the whole project; `npm start` is the only thing you actively start/stop.

### How this differs from Desktop Commander

[Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) is the most widely used MCP terminal server. It runs locally for **Claude Desktop** and guards shell access with a **blocklist** (`blockedCommands`, an explicit list of forbidden commands). A blocklist is inherently leaky: you can't enumerate every dangerous command and variant, and the default is *allow*: anything not on the list gets through.

This project targets a different scenario: exposing local access to Claude **on the web**, across the open internet via Funnel. It makes the opposite default choice: a **whitelist**. Nothing runs unless it's explicitly allowed.

### Why whitelist, not blocklist

- **Fail-safe**: an unfamiliar or new command is blocked automatically, no guessing required.
- **Minimal attack surface**: only the exact commands you've approved can run, nothing more.
- **Granular down to the subcommand**: `git` is scoped to `status/log/diff/show`, something a blocklist can't express cleanly.
- **Neutralizes prompt injection**: exposed to the open internet, a hard whitelist means a malicious or injected instruction has nothing to escalate to — there's no unlisted command for it to reach for.
- **Read-only by construction**: the built-in set is read-only — flag-rich binaries that could escape it via their own flags (`find`, `sort`) are kept out (issue #2); adding a write command is a deliberate edit to `~/.aki/mcpsv/setting.json`, not the removal of a ban.

## Screenshots
<img width="899" height="1035" alt="image" src="https://github.com/user-attachments/assets/c7504913-7ff0-4802-b607-b6a6220e82c2" />
<img width="898" height="834" alt="image" src="https://github.com/user-attachments/assets/2b64541a-aea8-4bcf-b4dc-341254895a32" />
<img width="892" height="1032" alt="image" src="https://github.com/user-attachments/assets/69413798-5445-4277-9797-a671da6657bd" />
<img width="651" height="701" alt="gpt-aki-mcp-setting" src="https://github.com/user-attachments/assets/c067919c-1b7f-4f49-af81-82f1193f1f17" />
