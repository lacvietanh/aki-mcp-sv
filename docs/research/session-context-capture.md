# Capturing the full AI-chat session context (for the "context window %" feature)

## 1. Start time
2026-09-07, during work on commit `8a3d884` (branch `main`, version 1.14.0 with an open `[Unreleased]`).

## 2. Initial purpose
The panel wants a "context window %" style indicator. That needs two things, and the owner split them with different bars:

- **Part 1 — capture the full session context. MANDATORY.** We must be able to see the full knowledge/content of the current chat session either **exactly**, or **as accurately as technically possible**. This is the hard requirement.
- **Part 2 — convert that to a token count. OPTIONAL.** If an accurate token count is not achievable, drop it — do not pull in a tokenizer library (`gpt-tokenizer` etc.) or build a rube-goldberg flow just to show a number. Showing KB / character size instead of tokens is an acceptable outcome.

Constraint at capture time: the active model is Claude Opus (`CLAUDE_OPUS_48_BEDROCK`), which has no local tokenizer (Anthropic ships none for Claude 3+). Postman runs as a Chromium app reachable over CDP (DevToolsActivePort). The daemon is `scripts/aki-pmcontrol/` and the panel is injected from `scripts/aki-pmcontrol/scripts/cdp-autoclicker.js`.

This doc records what was already probed live so the follow-up research does not start from zero. It is a handoff, not the final answer — Part 1 is not yet solved.

## 3. Strategy
Enumerate every place the full conversation could live, and probe each one live over CDP against the running Postman (port read from `~/Library/Application Support/Postman/DevToolsActivePort`):
1. The request body on the wire (CDP Network) — what the client actually sends each turn.
2. Client-side persistence — localStorage, IndexedDB.
3. In-memory React state on the page (fiber walk from the rendered conversation node).
4. The rendered DOM (known to be lossy; measured as the floor).

## 4. Checklist
- [x] Measure the DOM conversation text.
- [x] Enumerate localStorage keys related to chat/agent/conversation.
- [x] Enumerate IndexedDB databases, then open `postman-app` and list every object store.
- [x] Walk React fibers upward from the conversation container looking for a messages array.
- [-] Walk fibers **downward/children** (not done — handed to the follow-up; not pursued: the DOM char-length bar was kept instead, restored 2026-09-27, see Amendments).
- [x] Inspect the chat request/response bodies on the wire in detail — re-verified live 2026-09-07 across 3 turns of one fresh conversation on a dedicated experiment window (probe `tmp-probe-newwin.js`).
- [-] Inspect a redux/mobx-style store if one is reachable from `window.pm` or a module (not pursued, same reason).

## 5. Result

### What each source gives (measured live)

| Source | Full context? | Evidence |
|---|---|---|
| **DOM** (`ai-chat-conversation-container` innerText) | **No — lossy floor.** ~37,465 chars this session. Missing: hidden system prompt, tool schema, and the full body of collapsed tool results (shown only as "Finished executing tool …"). | probe `tmp-probe-convo.js` |
| **localStorage** | **No.** Only small settings: `agentModeSettings`, `ai-chat-last-selected-model` (`CLAUDE_OPUS_48_BEDROCK`), panel layout. No conversation body anywhere. | probe `tmp-probe-ctx-source.js` |
| **IndexedDB `postman-app` (v350)** | **No.** 48 object stores, all normal Postman entities (collections, requests, history, environments, runners…). **No chat/conversation/message/agent store at all.** | probe `tmp-probe-idb.js` — `interesting: []` |
| **React fiber (upward walk, 60 levels)** | **Not found upward.** No messages-shaped array on ancestor fibers' `memoizedProps`/`memoizedState`. | probe `tmp-probe-store.js` — `hitCount: 0` |
| **Request body on the wire** (re-verified live 2026-09-07) | **No — message-only, not even a delta of prior turns.** 3 turns of one conversation: request `input` = `{chatType, query, toolResponse, conversationId, agent, product, startedFrom}`, no messages/history array at all. `query` held only the turn's own text (51/51/53 chars); body was a flat ~8.2k chars on **every** turn (8215/8222/8224) — turn 1 was NOT larger, so it does not seed the full context. Turn 1 sent `conversationId:null` and the response `conversation` event minted `7540b014…`, reused verbatim on turns 2–3. The ~8.2k is fixed schema/agent/product overhead, not conversation content. | probe `tmp-probe-newwin.js`; dump `~/.aki/tmp-newwin-dump.jsonl` |

### The core finding
Every client-visible source is either **lossy** (DOM) or **empty of conversation** (localStorage, IndexedDB) or **message-only** (wire). The wire carries only the current turn's message plus a `conversationId` — not the prior turns, not even as a delta — so the full context is held **server-side**, keyed by `conversationId`. Exact context capture from the client is **not possible**: there is no client-visible source that ever contains it.

**Verification:** DOM/localStorage/IndexedDB findings are verified by the four original probes (re-runnable). The wire finding is now verified live (2026-09-07) by `tmp-probe-newwin.js` over 3 turns of a fresh conversation — no longer carried-over/unverified. The earlier "delta ~9.5k" note was itself imprecise: it is not a delta of the conversation, it is a message-only body of fixed ~8.2k overhead.

### Corroborating links
- Probes (throwaway, in scratchpad — re-runnable, not committed): `~/.aki/tmp-probe-convo.js`, `~/.aki/tmp-probe-ctx-source.js`, `~/.aki/tmp-probe-idb.js`, `~/.aki/tmp-probe-store.js`.
- Existing wire hook to build on: `hookChatUsageCapture` / `applyChatUsageFromSSE` in `scripts/aki-pmcontrol/index.js` (already captures the chat POST request + SSE response over CDP).
- Web check: Anthropic publishes no client-side tokenizer for Claude 3+ (only the server `count_tokens` API); OpenAI's `o200k_base` (via `gpt-tokenizer`) covers GPT-4o/4.1/5/o-series. Claude Opus context window is ~1M tokens on the API surface.

## 6. Decision — Follow-up research (Part 1 unsolved)

Leads for the next chat, in rough order of "most likely to give exact/maximal context":

1. ~~**Reconstruct from the wire across the whole session.**~~ **RULED OUT (2026-09-07, `tmp-probe-newwin.js`).** Turn 1 does NOT carry a full seeded input and later turns are NOT deltas — every turn sends only its own message + `conversationId`, so there is nothing on the wire to accumulate into the full context. This was the most promising "exact" path; it is now closed. Exact client-side capture is impossible; the remaining leads (#2, #3) can only raise accuracy toward a maximum, never reach exact.
2. **Fiber walk downward/children**, not just upward — the messages array is more likely on a child fiber of the conversation list than an ancestor. This session only walked `.return` (ancestors).
3. **Expand collapsed tool-result nodes in the DOM** before reading text — click/di-expand each "Finished executing tool …" node, or find the collapsed content in the node's props, to raise DOM accuracy toward the maximum even if not exact.
4. **Server `count_tokens` preflight** (only if Part 2's exact token count is later deemed worth it): one extra request per turn, needs credentials, explicitly flagged as probably-too-heavy by the owner.

**No action taken on code** — this is investigation only; no capture mechanism was built. Part 2 (tokenization) stays deferred and may be dropped entirely per the owner's constraint.

### Conclusion for the feature (2026-09-07, reframed after /akithink)
The original problem framing was wrong. The circle's **ultimate goal is only to signal "time to start a new chat"** so the agent's answer quality does not degrade on an over-long session — it is a **threshold/trigger** problem, not a measurement problem. An exact context size was never required; chasing it (count_tokens, tokenizer, reconstruct-from-wire) was goal-substitution against a harder problem than the real one.

What the trigger needs is a **monotonic proxy that grows with conversation length**, read passively, plus a threshold. The DOM conversation-text length is exactly that: verified monotonic and readable passively via `[data-testid="ai-chat-conversation-container"].innerText.length` (probe `tmp-measure-dom.js`, run read-only against a dedicated experiment window — never the live chat window). Its lossiness (omits hidden system prompt + tool schema; collapsed tool-results undercount) does **not** break a trigger: a stable undercount stays monotonic, so a calibrated threshold still fires.

Decision:
- **Signal:** DOM conversation-text char count, polled passively.
- **Display:** a colored circle (green → amber → red) by configurable char thresholds, labelled in KB/chars. **No token count, no "% of 1M"** — a fake-precise number would mislead the new-chat decision (critique inversion).
- **Ruled out:** exact capture, count_tokens preflight, tokenizer libs, wire reconstruction, and the team-pooled `usage` millicredits delta (noisy — shared pool, `isTeamPooled=true`).
- **Not blocking:** expanding collapsed tool-results (lead #3) only sharpens threshold calibration; downward fiber walk (lead #2) is unnecessary for a trigger. Both are optional accuracy nice-to-haves, not prerequisites.

Plan: `docs/plan/context-circle-newchat-signal.md`.

### Cross-references
- Feature target lives in the panel (`scripts/aki-pmcontrol/scripts/cdp-autoclicker.js`); if a capture mechanism ships, add a `feat/` doc then.
- Prior notes referenced a `docs/research/chat-gateway.md` that does not exist in the repo; a code comment in `index.js` also points to it. If that content is recovered, link it here.

## Amendments

- 2026-09-25: the feature this research fed — the context-length bar in the Postman chat footer and its plan `docs/plan/context-circle-newchat-signal.md` — was removed: two Postman releases later the owner no longer needs a new-chat signal. The findings above (context is server-held, not client-visible) stay valid. `docs/research/chat-gateway.md`, named in Cross-references, never existed in this repo.
- 2026-09-27: **context-length bar restored** — the owner needs the new-chat signal again. `readConversationChars`/`renderContextBar` are re-added to the injected page code (now `scripts/postman/page/postman-panel.js`, not the old `cdp-autoclicker.js`), reading `[data-testid="ai-chat-conversation-container"].innerText.length` with the same 80K/150K char thresholds. The Decision above stands unchanged: DOM char-length as a monotonic trigger, no token count.
- 2026-09-27: **credit-usage-delta probe removed** — a later experiment (`logUsageTurn` → `~/.aki/cdp-postman/usage-turns.jsonl`, added in 2.1.0) logged the per-turn delta of the SSE `usage` millicredits per `conversationId`, to "offline-validate" whether that delta tracks context growth. It has been dropped. This only confirms what §6's Decision already **Ruled out**: the `usage` figure is the **team-wide weekly credit pool** (`isTeamPooled=true`), shared across all members and conversations, so the per-turn delta cannot isolate one chat's context and is not a valid context signal. The credit number is still shown as a *quota/limit* readout (its real purpose); it is just no longer mined as a context proxy.
