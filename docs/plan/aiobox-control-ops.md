# aiobox provider: typed control ops

Status: M0, M1, the AkiMCP-only part of M3 and the M5 warn phase implemented 2026-10-03 (`scripts/aiobox-mcp.js`, `scripts/tool-call-log.js`, `scripts/tool-calls-report.js`, `test/aiobox-mcp.test.js`), in 3.0.0 (not yet published); M2, M4–M6 wait on AIObox (`aiobox/docs/plan/ai-control-surface.md` A1–A5). Evidence: `aiobox/docs/research/ai-control-audit.md`. Decisions O1–O4 and the mailbox were taken by the owner on 2026-10-03 (recommendations accepted as a set). Related: [`plan/IMPORTANT-akimcp-aiobox-contract.md`](IMPORTANT-akimcp-aiobox-contract.md), [`plan/IMPORTANT-shared-cdp-profiles.md`](IMPORTANT-shared-cdp-profiles.md), [`arch/provider-toolkit.md`](../arch/provider-toolkit.md), [`research/tool-surface-provider-toolkit.md`](../research/tool-surface-provider-toolkit.md).

## Conclusion

LLMs misused the `aiobox` tools because the surface had three write ops (`new_window | compose | eval`), no picture of profiles, accounts or busy chats, no way for a chat to know which window it is, and no version a client could use to notice its cached schema is stale (the bridge keeps one shared session, `research/tool-surface-provider-toolkit.md:49`). Fix: measure at the bridge, give each common intent one self-checking op, return the rules in a result rather than a description, then route profiles, cold opens and submit through the AIObox control channel; `eval` stays as the last resort.

## Facts the design rests on

- F1. An MCP call comes from the provider's server (Notion, OpenAI, xAI through the tunnel), not from the tab: the caller's window cannot be derived from the connection.
- F2. A chat that is answering reads `busy: true` through `akipanel.live.chat()`.
- F3. An AI cannot see its tab's URL or title, but it sees the user's latest message verbatim.
- F4. A client that cached an older schema never tries an op added later, so the server gets no call to answer with an error.
- F5. `akipanel.send` only reaches the target page's `onMessage`; nothing shows it to the AI on that page.

## Decisions

- Decided: log every `aki__aiobox*`, `aki__chrome_*`, `aki__devtools_*` call at the bridge, never the arguments' text · because only `scripts/streamable-bridge.js` sees the external `MCP-Session-Id` and the user agent · rejected logging inside `aiobox-mcp.js` (no caller) · reopen if the bridge goes per-session.
- Decided: `aki__aiobox op=whoami {quote}`: the AI passes ≥20 characters of the user's latest message; AkiMCP probes every chat tab (AIObox reader first, page text otherwise), prefers a busy tab, returns `you` or `ambiguous` · because F1 rules out the connection and F3 gives a key every provider has today · rejected owner-typed handles (wrong after a renumber), hints injected into the composer, title search (F3), markers in tool-call arguments (rendering unverified) · reopen if M0 shows a provider sending a conversation id in a request header (header names are logged for that).
- Decided: the rules for acting in AIObox live in the result of `aki__aiobox op=state` (`guide`, versioned, ≤1,200 chars, one constant in `aiobox-mcp.js`); the tool description only says "start with op=state"; `akidevrule_context` carries one pointer line ("whoami, then state") · because a description is paid on every turn by every client and frozen in a cached schema (F4), while a result is always the running server's copy and only paid when AIObox work happens · rejected MCP resources/prompts (not shown by web clients through the bridge), a separate `op=guide`, the full guide in a description or in `akidevrule_context` · reopen if M0 shows >10% of AIObox call chains reaching a write op without `state` or `whoami` first.
- Decided: every refusal carries a stable `code`, one `next` step and the running version; every `op=windows`/`op=state` result carries `akimcp` and `ops` · because a client older than the server (the real case, F4) can only notice by comparing `ops` with its own schema · rejected relying on the zod enum error (only fires when the server is older).
- Decided: `from=<own chatId>` on write ops; `compose` into `from` is refused (`self_target`) · because an AI composing into its own chat edits the owner's next message.
- Decided: `wait_idle` polls `chat().busy` from AkiMCP (1 s, default 120 s, `timedOut` instead of an error); a page without a reader is refused with `no_adapter`, busy is never guessed from the DOM · because aiobox rejected `waitForReply` in akipanel (`plan/provider-chat-standard.md`) and DOM guesses break doctrine · reopen if polling load is measured.
- Decided (owner, 2026-10-04): `new_chat {window}` = AIObox `akipanel.newChat()` (sync; itself refuses offline, `busy`, `draft`), which navigates that tab to the URL New window opens (provider home, one path for all, not a capability); AkiMCP refuses the caller's own chat (`self_target`), tolerates the page context being destroyed by the navigation, and returns once the new page's panel is online and its reader shows an empty chat (a page without a reader: load complete) with no chat id in the URL, `chatId: null` · because a chat id exists only after the first message (Notion `/ai` has no `?t=` until then) · rejected finding a New chat button in the DOM, a variant of `new_window` · reopen if a provider keeps a chat id in its new-chat URL.
- Decided: `new_window` refuses to take a window someone else opened: while the panel rests (`akipanel.opening`, 1 s after any New window) it waits the rest out, counts the windows that appeared as existing, then asks once more; still resting → `opening` · because during the rest `newWindow()` is a no-op and the next new handle would be the owner's.
- Decided (O1): submit only into AI-provider chats (Notion first, then ChatGPT/Claude/Grok), only through the AIObox control channel's isolated-world executor, with `expect` (chatId) and `from` required, refused when the target is busy, every submit logged · because it closes compose → submit → wait → read for handoff layers L2–L4 · rejected `akipanel.submit()` callable from pages, submit to human recipients · reopen if a message is sent to the wrong chat or by prompt injection.
- Decided (O2): `chrome_launch` on an AIObox clone only warns until AIObox A3 ships cold `open`; after A3 it refuses while AIObox runs and points to `aiobox_write op=open` · because before A3 there is no other path · rejected refusing now · reopen if A3 is late and M0 still counts bypasses. `IMPORTANT-shared-cdp-profiles.md` changes in both repos at the refusal phase.
- Decided (O3): no `stop_profile` in v1 · because no need seen and its blast radius includes the caller's own chat · reopen if a real task needs it.
- Decided (O4): Facebook read + compose only, never submit · because a real person must never receive a machine message the owner has not seen.
- Decided: no `send_data` · because of F5 nothing an AI sees consumes it · reopen if a page shows or feeds `onMessage` to its AI.
- Decided (mailbox): a message between sessions is a file in `~/.aki/handoff/` with front matter `from`/`to` (chatIds) and `reply`; the pointer line is composed into the target chat with a source tag `[P#·W# → P#·W#]`; a tagged message never carries the owner's authority for one-way actions (push, delete, release) · rejected auto-submit between all sessions · reopen on an AI–AI loop or a session acting one-way on a tagged message. Until AIObox A4, delivery is the coordinating session's own act, not an AkiMCP op.
- Decided: provider comes from `windows.json` `tab.provider` (AIObox A1); `PROVIDER_BY_HOST` stays one release as fallback, then goes · because AIObox already classifies tabs and has custom providers.

## Session rotation when a chat runs out of quota (owner procedure, not an op)

A coordinating session hands its role to a fresh chat before its workspace quota runs out; the old chat cannot be asked anything afterwards.

1. Watch the quota. Notion: `~/.aki/aiobox/usage/<profileId>/notion.json` → `usage.scopes[]` gives per workspace (`label`) `session` and `weekly` `utilizationPct`. Rotate before `weekly` or `session` reaches 100%.
2. Open the new chat with `aki__aiobox_write op=new_window` from a window of that profile and provider, or `op=new_chat` on an idle window no session holds. Both go to the provider's new-chat URL (Notion `/ai`), never a "New chat" control found in the DOM (owner). Choosing a workspace is Notion's case only (owner, 2026-10-04): a Notion profile holds several workspaces, so open the chat in the one with the most usage left (lowest of the two `utilizationPct`); other providers have no workspace to pick.
3. Hand off by telling the new chat to read the old one: its first message names the old chatId and says `aki__aiobox op=read window=<old chatId> last=30`, the working file and the `~/.aki/handoff/` letters with the old handle in their name. Read, do not ask; the old chat may already be unable to answer. The same message first has the new chat check its connection: call `aki__aiobox op=state` and compare `ops` with the op enum in its own schema; an op missing from its schema means it holds an older AkiMCP schema, so it runs `aki__aiobox_write op=run_macro macro=connect-akimcp option=reconnect` on its own window and the owner opens a new chat (guide step 9).
4. The new chat tells every live window it now holds the role, with its own chatId (`op=send`; a busy target gets a `~/.aki/handoff/` letter instead).
5. Close the original window once the new chat has confirmed (until M4 `close`: CDP `/json/close/<targetId>` on the profile's port).

Symptom of a chat already out of quota: the composer is gone, so `live.send` (and `op=send`) to it fails with `composer not found`; treat that as "rotate now", not as a send bug.

## Steps

| ID | Step | Depends | Test | Status |
|---|---|---|---|---|
| M0 | Bridge log `tool-calls.jsonl` in the data dir: time, client (8 chars of the external session id), agent, tool, `op`, `window`, `port`, `from`, `macro`, `evalKind` (keyword tags, never the script), ok, error (200), ms, version; header names once per client; rotate at 1 MB. Report script grouping C1–C6 (eval share, bypass = `chrome_*`/`devtools_*` on an AIObox port, schema errors, version mismatch, refusal codes) | — | `test/streamable-bridge.test.js`, `test/tool-calls-report.test.js` | done: log + `npm run tool-calls [file] [--days N]` |
| M1 | Version in every `windows`/`state`/refusal result, `ops` list, guide in `op=state`, `-32602` stale-schema hint, descriptions point to `op=state`, `akidevrule_context` line "whoami, then state" | — | `test/tool-surface.test.js` (budget), `test/aiobox-mcp.test.js` | done |
| M2 | `op=windows`/`state` per tab: `provider` (field first, host map fallback), `capabilities`, `toolVersion` | AIObox A1 | `test/aiobox-mcp.test.js` with old and new `windows.json` | waiting on A1 |
| M3 | `whoami`, `state` lite (busy, account, macros from page probes, 3 s each), `wait_idle`, `run_macro` (`akipanel.runMacro`, poll `macroRuns`, 60 s), `from`/`self_target`, `new_window` rest guard | — (A2 `describe` later) | fake pages in `test/aiobox-mcp.test.js` | done |
| M4 | `op=profiles`; `state` adds profiles and usage from control `list_profiles`; `open {profile, provider\|url}` cold via control `open_window` (alias `new_window`); `focus`, `close` | AIObox A3 | fake control server (token, 401, stale `control.json`); live: `open` on a stopped profile | waiting on A3 |
| M5 | `chrome_launch` / attach on an AIObox clone: warn now, refuse while AIObox runs after A3 (O2) | M4 | `test/aiobox-mcp.test.js` (warn), `test/chrome-profile.test.js` (refuse) | warn phase done (`chrome-mcp.js` `aioboxWarning`, result `warning` while `windows.json` exists); refuse waits on A3 |
| M6 | `submit {window, expect, from}` via control `submit`; `send` = compose + submit + verify (user turn +1, optional `wait_idle`) | AIObox A4, O1 | fake control server; live on a Notion test account | waiting on A4 |

Every contract-touching step (M2, M4, M5, M6) updates `IMPORTANT-akimcp-aiobox-contract.md` here and in aiobox in the same session. Release notes say clients must reconnect (or open a new chat) to see new ops.

## Order and target

M0 + M1 + M3 → M2 → M4 → M5 → M6 → per-provider ops as AIObox A5 lands. No baseline wait: the targets are absolute and M0 is the "after" measurement. Target after M4: typed-op success ≥98%, eval share ≤5%, bypass 0, over ≥200 AIObox calls on ≥3 providers.
