# Per-client tool surface — fewer duplicate tools, no rule handshake for clients that already run akirule

Status: wishlist 2026-10-22, kept, not scheduled (owner: "không bỏ, để làm sau"). Starts at P0 when the owner names it. Why it waits: coding clients made 0 calls in the 2026-10-05..14 logs (§ Why), and Claude Code, the one measured live, pays ~0.7k tokens per session because it defers tool schemas, so today the gain is one handshake round trip; the numbers are in the Amendments of `research/tool-surface-provider-toolkit.md`. It moves up if `tool-calls.jsonl` shows a coding client on the AkiMCP host calling regularly. Log lines by agent (`grep -c`, 2026-10-26): `claude-code/` 282, 44, 20, 57 on 10-19 to 10-22, 0 on 10-23 and 10-24, 28 in the undated current file; `Cursor/` 10 (10-19), 29 (10-22), 1 (10-23), 64 (10-24), 1 (undated). The log has no peer address, so whether those clients ran on the AkiMCP host is unproven and the wait condition stands.

## Why — measured 2026-10-18 on v3.0.1, this machine

AkiMCP was built for web chats (claude.ai, ChatGPT, Grok, Gemini, Notion, Gumloop) that have no local files, shell, search or rules. A coding client running on the AkiMCP host (Claude Code, Antigravity `agy`, Cursor, Codex) already has all four, yet is served the same surface and the same rule handshake.

| What a client pays at session start | Size | How measured |
|---|---|---|
| `tools/list`, 33 tools served here (38 with kiro and postman) | 31,500 chars, ~7.9k tokens | live `tools/list` over `POST /mcp`, ÷4 chars/token (estimated) |
| `initialize` `instructions` | 1,649 chars, ~0.4k tokens | same call |
| `aki__akidevrule_context` result, which the instructions order the model to call first | 49,282 chars, ~12.3k tokens | live `tools/call` with `workingPath=/Users/aki` |
| Total | ~20.6k tokens | the handshake is the largest part and repeats what `CLAUDE.md` / `AGENTS.md` already delivered natively |

Of the 33 tools, 19 duplicate something a coding client on the AkiMCP host has natively (file read/write/edit, search, shell, background tasks, git, ports, clipboard, notify) and 14 do not.

Who really calls today (`~/.aki/mcpsv/tool-calls-2026-10-05..14.jsonl`, by `agent`): Notion 115,741 · AIObox (`node`) 1,033 · Gumloop 816 · claude.ai (`Claude-User`) 492 · ChatGPT (`openai-mcp/1.0.0`) 305 · Grok 102 · Codex (`openai-mcp/1.0.0 (Codex)`) 80. **Claude Code, agy and Cursor: 0 calls** — the surface was never connected to them, so this plan serves a client class that has no usage yet; the cost argument is why it is worth doing before the first connect. Codex already called `akidevrule_context` 4 times, a handshake its resident `AGENTS.md` makes redundant.

### Claude Code, observed live 2026-10-19 (Linux box `bien` → `mba20.akitao.com/mcp`, bearer header, user scope)

| What | Estimate above | Observed in Claude Code | How measured |
|---|---|---|---|
| Tool schemas at session start | ~7.9k tokens | ~0.3k: only the 33 names (929 chars) are in context; Claude Code defers MCP schemas by default (tool search) and loads one on demand, ~0.3–0.6k each (`akidevrule_context` 2,244 chars) | session's own deferred-tool list; live `tools/list`; ÷4 chars/token (estimated) |
| `instructions` | ~0.4k | ~0.4k (1,650 chars) | same |
| `akidevrule_context` result | ~12.3k | ~0.3k: the model received only `structuredContent` (~1.2k chars of receipt + sources); the corpus in `content` never reached it | the result as shown to the model in that session |
| Total | ~20.6k | ~0.7k per session, ~1.6k once a `mac` tool is used | sum |

Consequences for this plan:
- For Claude Code the token argument shrinks ~13×; `RULE-agent-behavior.md` alone is ~6k tokens. What remains of the handshake is one mandatory round trip before the first act, a receipt to re-issue whenever rules change, and a blocking failure mode: `workingPath` of a directory not created yet returns `WORKING_PATH_UNAVAILABLE` (observed for `/Volumes/DEV/labs/bien-rti`). The handshake gives Claude Code nothing but the receipt, since its rules arrive through `CLAUDE.md`, so D3 holds on round trips rather than tokens.
- A coding client is not always on the AkiMCP host. This one runs on another machine and reaches the AkiMCP host only through AkiMCP: `read_text_file`, `edit_file`, `find_path`, `search_content`, `run_cmd`, `git` are its only path to host files. D2 as written would hide exactly those. See D7.
- For the same remote client the D23 project-rule push is useful, not redundant: the host repo's `CLAUDE.md` is not on the client's disk. Observed cost: the first `edit_file` in each repo was not run and returned that repo's `CLAUDE.md` (aiobox with `GEMINI.md`, ~20 KB) plus a new receipt, one extra round trip per repo.
- The calls are logged: today's file is the undated `tool-calls.jsonl` (rolled to a dated sidecar the next day, `scripts/tool-call-log.js`), with `agent` = user-agent `claude-code/2.1.303 (cli)`.
- The largest per-call cost this client met is AIObox `op=state` (guide 15,790 B + ops table ~16 KB, ~8k tokens), outside this plan; tracked in aiobox `docs/plan/backlog-v1.0.md` B5.

## Constraints this plan keeps

- `CLAUDE.md` "Stable core": the reason is a core need (context cost on a new client class), not an AIObox feature. AIObox tools are untouched.
- `CLAUDE.md` "Native command, then guide, then tool": this plan removes surface, adds no tool.
- `feat/tools.md` anchor: `agy_run` / `kiro_read` are never hidden by a profile.
- `research/tool-surface-provider-toolkit.md` K7: no tool is renamed and the default profile stays byte-identical, so no existing client or "always allow" grant breaks.
- Single shared internal session (`plan/done/bridge-session-churn.md`): a profile can only filter what the bridge returns per client; `RegisteredTool.disable()` is global and would hide tools from the web clients.

## Decisions (proposed)

**D1 · Two profiles.** `full` (default: web chats and every unknown client; today's behavior) and `native` (the client runs on the AkiMCP host and has its own file, shell, search and rules there, D7). Only `tools/list` and `instructions` differ; every tool stays registered and callable on both.

**D2 · What `native` serves.** A tool is hidden only if a native equivalent exists and AkiMCP's version shows no proven edge.

| Hidden in `native` (19) | Native equivalent |
|---|---|
| `read_text_file`, `write_file`, `edit_file`, `create_directory`, `move_file`, `get_file_info`, `list_allowed_directories` | the client's Read / Write / Edit / shell |
| `find_path`, `search_content` | the client's Glob / Grep — **kept only if P0 proves an edge** |
| `run_cmd`, `task_start`, `task_manage`, `git` | the client's shell, background run, git |
| `port_status`, `kill_port`, `clipboard_read`, `clipboard_write`, `notify_user` | shell (`lsof`, `kill`, `pbcopy`, `osascript`) |
| `akidevrule_context` | rules arrive natively (`CLAUDE.md`, `AGENTS.md`, installed `akirule-*.md`) |

| Kept in `native` (14) | Why |
|---|---|
| `agy_run` (+ `kiro_read` when on) | agent delegation, anchored in `feat/tools.md` |
| `chrome_*` (5), `devtools_*` (3) | a controllable Chrome over CDP; no native browser tool in a coding CLI |
| `aiobox`, `aiobox_write` (when installed), `postman_*` (when installed) | owner's own apps |
| `sqlite_schema`, `sqlite_query` | read-only by mechanism; `sqlite3` is a shell permission prompt elsewhere |
| `local_fetch` | SSRF-guarded localhost/LAN fetch; hidden only if V3 shows the client's own fetch reaches localhost |

Estimated `native` cost: 14,879 chars, ~3.7k tokens for the list, no handshake. Per session ~20.6k → ~3.7k tokens, about 82% less, "up to" because the handshake only costs when the model obeys the instruction. The 14,879 sums measured per-tool sizes; the `receipt` parameter dropped by D3 saves a little more. These are the web-client figures: Claude Code defers schemas and showed ~0.7k per session (§ Claude Code, observed live), so for it the gain is round trips, not tokens.

**D3 · No receipt for `native`.** A `native` session gets tool schemas without `receipt`, and `scripts/rule-gate.js` treats its calls as satisfied (no `RULE_RECEIPT_*` refusal, no appended rule lines). Safe because the receipt proves issuance, not presence (`rule-gate.js` header) and the gate is compliance UX, not security (`feat/security.md` § Design stance). The profile reaches the gate through the request's `params._meta` (V1 confirms the SDK hands it to the handler; fallback `AsyncLocalStorage`). `full` sessions keep today's gate unchanged.

**D4 · How a client gets its profile.** The bridge stores, per minted `MCP-Session-Id`, the profile resolved at `initialize` (today `clientInfo` is read only for the first client and discarded). `native` only when the `initialize` request both carries `?profile=native` on the connector URL (`claude mcp add --transport http akimcp "http://127.0.0.1:9999/mcp?profile=native" …`) and arrives co-located (D7); everything else, `?profile=full` included, is `full`. No `clientInfo.name` table: a product name says which client it is, not where it runs, and the same Claude Code is local on the AkiMCP host and remote on `bien`. `clientInfo.name` and `user-agent` are still recorded, for P0 and the log. Unknown means `full`: a mistake costs tokens, never a missing tool.

**D5 · Where "hidden in native" is declared.** On each tool's own registration, next to `annotations`, as `native: 'hide'` plus `equivalent: '<native capability>'`; the 14 kept carry nothing. `test/tool-surface.test.js` asserts a hidden tool names its equivalent, and holds the `native` list budget (≤ 16,000 chars) next to the existing one.

**D6 · `instructions` per profile.** `native` receives no handshake sentence; `full` keeps today's text byte for byte.

**D7 · `native` means "runs on the AkiMCP host", nothing else.** A coding client on another machine (Claude Code on the Linux box `bien`, any CLI reaching AkiMCP through the tunnel) is served like a web chat: `full` surface, handshake, receipt and D23 project-rule push, all unchanged. The Mac file and shell tools are its only path to host files, and the pushed `CLAUDE.md` is the only copy of a Mac repo's rules it receives. Owner 2026-10-19: "như vậy thì vẫn dùng full tool như các web chat AI thôi".

- **Co-located, mechanically:** the request carries no tunnel or proxy header (`cf-connecting-ip`, `cf-ray`, `x-forwarded-for`, Tailscale's own; exact set by V8). The peer address proves nothing: the gatekeeper listens only on `127.0.0.1` (`scripts/gatekeeper.js`), so a tunnelled request also arrives from loopback. `native` needs this and the explicit opt-in (D4); either missing → `full`.
- **Why every doubt lands on `full`:** a wrong `full` costs tokens; a wrong `native` hides the only path to the host, and the model then works on whatever stale local copy it has.
- **Edge cases.** A remote client that copies the local URL with `?profile=native` arrives through the tunnel → `full`. A Host-local client that uses the tunnel URL → `full`, tokens only; the README tells local clients to use `http://127.0.0.1:9999/mcp?profile=native`. A tailnet or Funnel connection is proxied to loopback by Tailscale, so it is told apart only if Tailscale adds a header (V8); if it adds none it looks local and only the opt-in guards it, as in the SSH case below. An SSH `-L` port-forward from another machine lands on loopback with no header and cannot be told apart over HTTP; only the opt-in guards it, so a forwarded connector never carries `?profile=native` (accepted: it takes two deliberate wrong steps).
- **Deferred: a "rules native, but remote" value** that skips the handshake and keeps the tools. It saves a remote Claude Code one round trip and ~0.3k tokens per session (§ Claude Code, observed live), costs a second opt-in value, and the D23 push rides on the receipt gate, so dropping the receipt drops a push that client still needs. Reopen if `tool-calls.jsonl` shows remote coding clients' handshake failing or repeating often enough to matter. The one blocking failure seen, `WORKING_PATH_UNAVAILABLE`, is fixed at its root instead (T2), which helps web chats too.

## Evidence rule for the AkiMCP-is-better exception

Owner's carve-out: keep a duplicate when AkiMCP's is clearly better (search, grep, edit). That claim is not yet measured against Claude Code's Grep/Glob/Edit. P0 runs the same 5 hunts and 5 edits through both and compares calls, output tokens and wall time; a tool with no clear win is hidden. The result is recorded in the P0 research doc, not asserted here.

## Rejected

| Option | Why not |
|---|---|
| Second server or port per client | a second process; the topology is one process, one shared session |
| `RegisteredTool.disable()` per profile | global on the shared server; hides tools from web clients |
| Client-side `ENABLE_TOOL_SEARCH` only | defers schemas but the handshake round trip and the receipt gate remain, and agy/Cursor may not support it; useful as a complement, not the fix. Claude Code already defers by default and showed the handshake at ~0.3k, not 12.3k (§ Claude Code, observed live) |
| Drop `akidevrule_context` for everyone | web chats have no other rule loader |
| Refuse calls to hidden tools | a stale client list or an owner who wants `run_cmd` once would hit a wall; hiding is enough, `?profile=full` is the override |
| 36 → 17 merge by renaming | stays rejected (research K9) |
| Two axes, "rules native" apart from "co-located" (first D7 draft) | deferred, not rejected: small saving, a second value, and it would cut the D23 push (D7) |
| A `clientInfo.name` table that grants `native` | the same client runs local and remote; a name match would hide the host tools from `bien` (D4, D7) |

## Steps

- [ ] **P0 · measure (read-only).** Connect Claude Code, agy, Cursor and Codex once each; record the `clientInfo.name` and `user-agent` each really sends (`GET /api/security` callers and the `initialize` body); confirm whether Cursor's install delivers akirule natively (V2). Run the search/edit comparison above. Output: a `research/` doc on the `docs.B2` schema; `Decision → Action` links here.
- [ ] **P1 · profile resolution** in `scripts/streamable-bridge.js`: per-session profile at `initialize` from `?profile=` and the co-location check (V4 verified: the query reaches the bridge in `req.url`; V8: the headers the check reads). Tests in `test/streamable-bridge.test.js`: `?profile=native` with no tunnel header → `native`; the same request with a tunnel header → `full`.
- [ ] **P2 · filtered `tools/list` + `instructions`** per profile, `receipt` stripped for `native`; `full` output asserted byte-identical to the pre-change `tools/list`. Tests in `test/tool-surface.test.js`.
- [ ] **P3 · gate bypass for `native`** in `scripts/rule-gate.js`. Tests in `test/rule-gate.test.js`: a `native` call without receipt runs; a `full` call still gets `RULE_RECEIPT_MISSING`.
- [ ] **P4 · docs.** `feat/tools.md` (a Profiles section, stamp rewritten, the receipt-gate section names the bypass), `arch/provider-toolkit.md`, `arch/rule-context-delivery.md` (Gate 0 not needed for native clients), README connect line for Claude Code with `?profile=native`, `docs/index.md`, `CHANGELOG.md`; append an `## Amendments` entry to `research/tool-surface-provider-toolkit.md` reopening its "toolset per client" No-action line with the measured numbers above.
- [ ] **P5 · live check (needs the owner, `agent.B3`).** Real Claude Code on `?profile=native`: tool count 14, `/context` before and after, one end-to-end browser task through `chrome_launch` + `devtools_eval` with no receipt; a web client (claude.ai or Notion) still sees all 33 and still handshakes; Claude Code on `bien` through the tunnel, even with `?profile=native` on its URL, still sees all 33 and handshakes.

## Open items

| Code | Item | Weight if ignored |
|---|---|---|
| D1 | Owner approval of this plan, and of "unknown client = `full`" | nothing starts without it |
| V1 | Closed 2026-10-19: the SDK hands `request.params._meta` to the tool handler as `extra._meta` (`@modelcontextprotocol/sdk` `shared/protocol.js:321`) and the bridge forwards `params` whole | — |
| V2 | Cursor's install delivers akirule natively (`install.mjs` lists a Cursor dir, delivery unconfirmed) | medium: if not, Cursor stays on `full` until it does |
| V3 | A coding client's own fetch reaches localhost/LAN | low: decides only whether `local_fetch` is hidden |
| V4 | Closed 2026-10-19: `gatekeeper.js` matches the path before `?` and passes `req` whole to the bridge, so `req.url` keeps `?profile=` | — |
| V5 | `clientInfo.name` strings of Claude Code, agy, Cursor, Codex. Claude Code's user-agent is known (`claude-code/2.1.303 (cli)`, `tool-calls.jsonl` 2026-10-19); its `clientInfo.name` is not | low: names are recorded for P0 and the log, they no longer decide a profile (D4) |
| D2 | Closed 2026-10-19: owner approved that a coding client off the AkiMCP host keeps the full surface (D7) | — |
| V8 | Which headers Cloudflare Tunnel and Tailscale Funnel/Serve add: Cloudflare's `cf-*` and `x-forwarded-for` appear in `tool-calls*.jsonl`, Tailscale's not yet seen; the peer address cannot help, the gatekeeper binds only `127.0.0.1` | medium: the co-location check rests on it; until verified `native` is never granted, which costs tokens only |
| T2 | `akidevrule_context` with a `workingPath` not created yet fails `WORKING_PATH_UNAVAILABLE` instead of resolving the nearest existing parent (observed `/Volumes/DEV/labs/bien-rti`) | low: one blocked call and a retry per new-folder task, for every client; a core fix outside this plan |
| V6 | Claude Code passes `structuredContent` to the model instead of `content` when both are present (one session observed; vendor docs not checked) | low: only the cost of the handshake until D3 ships; after D3 a native client never calls it |

Risk checked: `?profile=native` lets any holder of the bearer token skip the receipt, but that token already grants `run_cmd`, so no power is added (`feat/security.md`).
