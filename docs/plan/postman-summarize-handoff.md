# Plan: summarize a Postman AI chat into a new chat

Status: decided 2026-10-25, wait bound and reply detection 2026-10-26; code in `4c7800c`; live check by the owner open (step 6). Reverses decision 5 of `docs/plan/done/postman-auto-summarize.md` (summary only, no new chat, no paste), which the owner reopened.

## Goal

The owner's request: wait until Send is available, which means the agent has stopped ("đợi nút send available tức là agent dừng"), send the summarize prompt, wait for the reply, copy it, open a new chat and paste it there ("tự dán vào"). Pasted, not sent: the owner reads the summary before spending a turn.

## Facts before the change (HEAD 7b74170)

- `typeAndSubmitChat` (`scripts/postman/page/postman-panel.js`) inserted the text, then tried `submitChatInput` for 5 animation frames and returned silently; `submitChatInput` refuses while the assistant streams. A prompt fired during a reply stayed in the box unsent, and `sendChatPrompt` returned true regardless.
- `__pmSendInFlight` covered the typing only, not the reply.
- With `autoInjectInstruction` on, `checkAndInjectInstruction` sends the instruction into every empty chat after a non-empty one; it replaced the box content, so a summary pasted before it ran was lost.
- The auto trigger's idle proxy was 5 s of unchanged conversation text (`IDLE_MS`), which fires during a reply that waits on a long tool call.
- New chat button: `[data-testid="ai-chat-new-conversation-button"]` (`scripts/postman/debug/postman-probe-instruction-flag.js`).
- Postman 12.33.4 (read-only probe, 2026-10-25): the composer renders the Send button (`.ai-chat-input-send-button`) only while no query runs and a Stop button (`.ai-chat-input-cancel-button`) while one does. Each turn is an `.ai-chat-message-group`, the newest carries `ai-chat-message-group--last`, and the assistant's text sits in `.ai-chat-agent-message` beside a thinking block and a debug box (`.ai-chat-agent-debug-message`). While a tool approval waits, Send is shown and a submit answers that approval; the approval card matches `PERMISSION_CARD_ROOT` (`scripts/postman/page/postman-autoclick.js`).
- `scripts/postman/test/postman-daemon-copy.test.js` asserts `function sendSummarizePrompt`, `window.__cdpRequestSummarize` and `window.__pmDeliverSummarizePrompt` exist.

## Decided

1. Decided: one page-side `summarizeHandoff(prompt)` owns the input box from the first send to the paste and holds `__pmSendInFlight` the whole time, so every control that already checks the flag stands down · because several writers on one input box is the defect · rejected per-step guards.
2. Decided: phases TYPE → SEND (await `agentIdle()` with the prompt in the box, then press Send) → REPLY (await `agentIdle()` false after the submit, then await `agentIdle()`) → CAPTURE (the newest turn's `.ai-chat-agent-message`, thinking and debug nodes removed) → COPY (clipboard, for the owner) → NEWCHAT (click the button, await an empty chat) → INSTRUCT (only with Auto-inject on: send the instruction, await idle) → PASTE (insert, do not send) · because that is the owner's order, the instruction must not overwrite the summary, and seeing busy first proves a new turn started, so CAPTURE cannot take the user's own message or the previous reply · rejected suppressing the instruction (breaks the Auto-inject switch) and ending REPLY on conversation growth plus idle (the prompt bubble can render before Stop does).
3. Decided: one idle definition, `agentIdle()`: the Send button is in the DOM and no tool-approval card is, used by the auto trigger, by SEND and by REPLY; Stop is read only to restart the wait bound, never as idle; text-quiet is no longer an idle signal anywhere · because Postman renders Send and Stop as one either-or, and the one state where Send shows mid-task is a pending tool approval, which a submit would answer; an Agent Mode reply waiting on a long tool call emits no text, so a quiet timer would capture a half-written summary · rejected text-quiet, typing a character to test Send (writes into the owner's input box) and reading the Stop button's absence (a renamed class would read idle and type into a running agent, while a renamed Send reads busy and the bounded wait times out) · reopen if Postman stops rendering Send and Stop as one either-or.
4. Decided: paste without sending · because the owner said "tự dán vào" · reopen if the owner wants it sent.
5. Decided: capture from the DOM, not the clipboard · because a page cannot read the clipboard without a permission prompt and a synthetic paste is blocked.
6. Decided: every wait is bounded by one constant, `HANDOFF_TIMEOUT_MS` (5 min), counted while Postman shows neither Stop nor a tool-approval card (`agentWorking()` false); a poll that sees Stop (the agent is working) or the card (the user's turn) restarts it. On timeout release the lock, leave what is visible and log an `[⚡ AutoRun]` line (forwarded by `scripts/postman/postman-daemon.cjs`); no retry loop · because a busy agent is the state the owner asked to wait out, while 5 minutes with no sign of work and the step still unfinished means a broken selector or a missed signal (a reply that ended inside one poll, a Send that does not take, a new chat that never reads empty), which must fail loudly · rejected a flat cap (cuts a long agent run and leaves the prompt unsent, the old defect) and no bound (a renamed selector holds the lock forever) · reopen if Postman legitimately shows no Stop and no card for more than 5 minutes mid-step.
7. Decided: the manual button and the auto switch run the same handoff (they already share `__cdpRequestSummarize`); the daemon is unchanged.
8. Decided: a read-only DOM probe of a running Postman (no typing, no send) is allowed for the selector; a run that sends prompts spends the owner's Postman AI quota and waits for the owner's go.

## Steps

- [x] 1. Live read-only DOM probe names the idle signal and the last-assistant-message selector (2026-10-25, Postman 12.33.4, see Facts). Open: the thinking block's root class inside the agent message, confirmed in step 6.
- [x] 2. `typeAndSubmitChat` waits for `agentIdle()` before pressing Send; on timeout it throws, `withChatLock` releases the lock and logs an `[⚡ AutoRun]` line, and `sendChatPrompt` returns false.
- [x] 3. `summarizeHandoff` with the phases of decision 2, keeping the three names the daemon-copy test pins.
- [x] 4. A test of the phase order and of each timeout exit (`scripts/postman/test/postman-summarize-handoff.test.js`).
- [x] 5. Button and switch labels, README § Connecting from Postman, CHANGELOG 3.1.0.
- [ ] 6. Live check by the owner in a fresh empty Postman chat, never an existing user chat: fired while the assistant replies, the prompt waits and sends once Send is back; the captured text equals the last message; the new chat opens, the instruction is sent first when the switch is on, the summary sits in the box unsent; the old chat is not typed into again.

## Not in scope

- Sending the pasted summary.
- Token counting.
- AIObox.
