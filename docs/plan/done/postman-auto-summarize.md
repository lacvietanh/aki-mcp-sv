# Plan — Postman AI chat: auto-summarize when the chat grows long

Status: done 2026-10-22 (`scripts/postman/page/postman-panel.js` `checkAutoSummarize`, the *Auto-summarize when the Context bar reaches [90] %* switch); step 6 closed by tracing the code path. Decisions 1 to 3 were changed while building, see their text.

## Goal

The owner's request: "tự tóm tắt khi gần đầy" (auto-summarize when the chat is nearly full), learning from part of AIObox's auto handoff. The Postman AI chat sends the existing summarize prompt into itself when the context bar turns red, so the owner no longer has to press the button.

## Facts

- The context bar (`scripts/postman/page/postman-panel.js:515-549`) is the conversation container's `innerText` length, not tokens. Amber is at 80K chars and red at 150K (`config.ctxCharAmber` / `config.ctxCharRed`, `:530-531`). It renders every 500 ms in the PageLoop (`:1555-1560`) and is display only.
- Honest scale: 150K chars is about 37K tokens, against a ~1M-token window (`docs/research/session-context-capture.md:52`). The red mark is a drift signal, "time to start a new chat" (`:66`), not a measure of a full window. Exact token capture from the client was ruled out (`:45`, `:72-73`). So this plan fires at the existing red threshold and calls it that; it does not claim to detect a full window.
- A manual "SUMMARIZE THIS CHAT" button already exists (`postman-panel.js:1303`, `:1421-1426` → daemon binding `__cdpRequestSummarize`, `scripts/postman/postman-daemon.cjs:366`, `:396-400` → `sendSummarizePrompt` `:1538-1540` → `sendChatPrompt` `:1517-1531`). It uses `scripts/postman/prompts/aki-prompt-sum-to-new-chat.md`, a self-contained handoff in a 4-backtick fence.
- `sendChatPrompt` goes through `typeAndSubmitChat` (`:1489-1515`, called at `:1526`), which selects everything in the input box and replaces it (`:1500-1507`), then tries to press send up to 5 times (`:1511-1514`); `sendChatPrompt` returns true even when send was never pressed (`:1526-1527`).
- Each chat has an identity on the wire: the chat request's `input` carries `conversationId` (`docs/research/session-context-capture.md:42`, verified live 2026-09-07). The page code holds none today (no `conversationId` under `scripts/postman/`).
- The arm-then-fire-once pattern already exists: `checkAndInjectInstruction` with `armedForNewChat` (`:1544-1553`). The sibling auto-send flag `autoInjectInstruction` defaults to false (`:127`).
- Borrowed from AIObox (`aiobox: docs/feat/handoff.md`, `desktop/panel/quotaNear.ts:61-111`): fire once, the "born full" guard (a tab already over the mark at its first reading never fires on its own, and the manual button stays), and the per-window on/off switch. Not borrowed: AIObox's trigger is account usage quota (82% / 87%), not context; account switching; archiving; opening a successor window.

## Decided

1. Decided: no chat identity. The switch arms when a reading crosses the mark (decision 3) by less than the amber-to-red span (70K chars by default) and fires once; a larger jump is a switch to another chat, a chat first seen over the mark never arms, and a reading under the mark (a new chat) resets it · because the conversation id sits in the chat request, not the page, and reaching it costs a daemon hook for one guard · rejected keying on `conversationId` (cost) and a count-only arm flag (fires on a switch from a short chat into a long one) · accepted edge: switching from a chat just under the mark into a slightly longer one over it fires once there · reopen if that happens in practice.
2. Decided: fire only when idle: the chat text unchanged for 5 s, the input box empty, no send in flight · because `sendChatPrompt` replaces the box's content, so firing while the owner types or the model replies would wipe a draft or queue behind a turn · rejected reporting a real send press first (a summary typed but not sent stays visible in the box, recoverable) · reopen if a summary is ever sent over a draft.
3. Decided: the mark is a share of the red threshold, `autoSummarizePct` (50 to 100, default 90) × `config.ctxCharRed`, set beside the switch and drawn as a tick on the bar · because it lets the switch fire before red while the mark still derives from the one red number, so it cannot drift from the bar's colours · rejected an absolute character threshold (a second number for the same signal) · reopen if a share of red proves too coarse.
4. Decided: switch "Auto summarize" in the panel's Postman controls, stored like `autoInjectInstruction`, default OFF · because the panel ships in the public npm package to every Postman user, and each auto-send takes a chat turn and spends shared team credits; the owner turns it on with one checkbox · rejected default ON (spends credits for users who never asked) · reopen if the owner wants it on by default.
5. Decided: summary only. No automatic new chat and no automatic paste into a new chat; the owner pastes the fenced block · because the owner's scope is "chỉ thiếu mỗi 'tự tóm tắt khi gần đầy'" · rejected the full auto handoff (outside the owner's stated scope) · reopen if the owner wants the second half.

## Steps

- [x] 1. No chat identity needed (decision 1); idle = chat text stable 5 s + empty input box (decision 2).
- [x] 2. Dropped with decision 2; the manual button is unchanged and the auto path calls the same `__cdpRequestSummarize` binding.
- [x] 3. The per-chat first-reading record plus fire in the PageLoop beside `context-bar`.
- [x] 4. The config flag plus the panel checkbox with one help line.
- [x] 5. Docs: README § Connecting from Postman (the panel controls are documented only there), CHANGELOG `[Unreleased]` Added.
- [x] 6. Closed by tracing the code path, no live run: the auto path ends in the same `__cdpRequestSummarize` → daemon → `__pmDeliverSummarizePrompt` → `sendChatPrompt` chain the manual button has used daily, and each expected case is a branch of `checkAutoSummarize`: a chat growing past the mark arms it and it fires after 5 s of unchanged text with an empty box; a non-empty box returns before firing; a first reading over the mark (`prev === null`) or a jump of the span or more never arms; the switch off clears the arm; after firing the reading stays over the mark, so it cannot fire twice in one chat. Not observable from code: a model that pauses over 5 s mid-turn with no new text; the summary then waits in the box unsent (decision 2).

## Not in scope

- Token counting.
- AIObox.
- An absolute character threshold (decision 3).
