# Postman permission-popup & auto-click self-debug

Canonical procedure to **trigger and verify** every automation in `scripts/aki-pmcontrol/scripts/cdp-autoclicker.js`. That file points here from the `PERMISSION_CARD_ROOT` definition and from `tickPermissionCards`. Diagnosis is read-only via `scripts/aki-pmcontrol/scripts/cdp-probe.js`.

## What the autoclicker acts on

`tickPermissionCards(cfg)` runs every 400 ms (the `runLoop` interval). Each tick it scans `permissionCards()` — elements matching `PERMISSION_CARD_ROOT` (`.tool-approval-wrapper, .tool-approval-single-item, .external-mcp-tool-approval, .ai-chat-loop-approval-message`) plus any `[role="dialog"]`/`[role="alertdialog"]` and dynamic chat action buttons — visible, and outside `#aki-control-panel`. For each unpressed card it selects the primary button, checks the matching config flag, presses once, marks `dataset.akiPressed = '1'`, and credits the stat when the card leaves the DOM (`creditArm`).

Primary-button selection (`slotButton` → `matchPrimary`):
- a button whose label matches a target keyword wins;
- otherwise, **on a known card root only**, the first non-decline button wins (fallback → `autoApprove`).

Decline buttons are never pressed as a confirm; they match `AUTO_CLICK_IGNORES`: `cancel, reject, deny, delete, close, back, remove, reset`.

## Automations, trigger, and test signal

| Feature (config key) | Reacts to | Button rule | How to raise the signal |
|---|---|---|---|
| Approve / Allow (`autoApprove`) | tool-approval card | label contains `approve`/`allow`, **or** any non-decline button on a known card (fallback) | Turn Postman native **Auto-run OFF**, then send a prompt that forces one tool call |
| Run dialog (`autoRun`) | dialog / card | label is **exactly** `run` | A modal/card whose primary button is literally "Run" |
| Continue (`autoContinue`) | dialog / card | label contains `continue` | A "Continue" prompt (truncated / continue-generating boundary) |
| Try again (`autoRetry`) | dialog / card | label contains `try again` | Cause a failure that renders a "Try again" button |
| Reject folder-connect (`autoRejectPickFolder`) | card whose text contains `connect a local folder to this workspace` | presses the **decline** button | Any action that raises the "Connect a local folder" card |

Agent toggles are **not** card-driven — the daemon applies them by toggling Postman's own settings, read from the `agentModeSettings` localStorage key:

| Toggle | localStorage key (default) | Menu item clicked |
|---|---|---|
| Thinking (high) | `thinkingToggleEnabled` (true) | model menu → "Enable extended thinking" |
| Auto-run (agent tool calls) | `autoRun` (true) | chat settings menu → "Auto-run" |

## Self-prompt procedure (new window)

1. **Preconditions** — daemon running (`postman_status`) and panel injected. Set the auto under test **ON** in the panel.
2. **Force the card** — to test `autoApprove`/`autoRun`, set Postman native **Auto-run OFF**; with Auto-run on, no approval card is ever raised. Flip it via the panel's **Auto-run** toggle (the daemon applies it through the bounded `applyPendingAgentSwitch` loop, which clicks the menuitem's inner `input[data-testid="aether-toggle-switch"]`) or by hand in the chat settings menu. Do **not** flip it with an ad-hoc CDP `.click()`: clicking the menuitem wrapper does not change `agentModeSettings.autoRun`, and driving the toggle from a raw CDP session tears down that page's execution context (websocket closes).
3. **New window** — panel **New Window** (fires `newRequesterWindow`); open Agent Mode.
4. **Self-prompt one tool-forcing turn.** Programmatic hook, present on every injected page: `window.__pmDeliverSummarizePrompt('<prompt>')` types and submits `<prompt>` into the active chat (a thin type-and-submit wrapper over `sendChatPrompt` → `typeAndSubmitChat`; the name is historical). Example that forces a read-only tool: `"List the allowed directories using your tools."`
5. **Expect** — within 1–2 ticks (~400–800 ms) the daemon presses the primary button; the panel badge (Approve/Run/…) increments once the card leaves the DOM, and the console logs `[⚡ AutoRun] permission card gone: "<label>" (Stats: …)`.

## Diagnose selector drift — `cdp-probe.js`

Run **while a card is on screen** (read-only — clicks, navigates, writes nothing):

```
node scripts/aki-pmcontrol/scripts/cdp-probe.js
```

Read `approvalButtons[]`:
- `matchedKnownRoot: true` — the button's card still matches `PERMISSION_CARD_ROOT`; the selector holds.
- `matchedKnownRoot: false` — **drift**. Take the reported `cardClass` / `cardTestid` and update `PERMISSION_CARD_ROOT` (top of `cdp-autoclicker.js`) **and** the matching assertion in `test/aki-pmcontrol-copy.test.js`. Never blind-change the selector: the probe's live DOM is the evidence.

`permissionRoots` counts each candidate selector; `openMenuItems` and `agentModeSettingsRaw` verify the toggle contract (open the model dropdown and chat settings menu before running so their `[role="menuitem"]` text is captured).

## Invariants (do not break)

- `test/aki-pmcontrol-copy.test.js` regex-asserts the exact `PERMISSION_CARD_ROOT` literal and the single-press guard — change both together or the test fails.
- One press per card: the `dataset.akiPressed` marker prevents the double-press that freezes the chat session (`flow.B6`). Keep it.
