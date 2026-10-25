const AUTO_CLICK_IGNORES = ['cancel', 'reject', 'deny', 'delete', 'close', 'back', 'remove', 'reset'];

// Prompt + procedure: docs/ref/postman-permission-popup-test.md
const PERMISSION_CARD_ROOT = '.tool-approval-wrapper, .tool-approval-single-item, .external-mcp-tool-approval, .ai-chat-loop-approval-message';
const DIALOG_ROOT = '[role="dialog"], [role="alertdialog"]';
const CHAT_ROOT = '[data-testid="ai-chat-container"]';
const PANEL_ROOT = '#aki-control-panel';

// A card counts only while on screen and outside our own panel: a hidden one left in the DOM is not waiting on anyone.
const isLiveCard = (el) => isVisible(el) && !el.closest(PANEL_ROOT);
const approvalCardShowing = () => [...document.querySelectorAll(PERMISSION_CARD_ROOT)].some(isLiveCard);

// Cancel slot of the same pending surface — only when copy is this folder dialog.
const AUTO_REJECT_PICK_FOLDER = {
  configKey: 'autoRejectPickFolder',
  statKey: 'rejectPickFolderCount',
  badgeId: 'aki-badge-reject-folder',
  checkboxId: 'aki-opt-reject-folder',
  rowLabel: 'Auto <strong>reject</strong> "Connect a local folder"',
  bodyNeedle: 'connect a local folder to this workspace'
};

const AUTO_CLICK_TARGETS = [
  {
    configKey: 'autoApprove',
    statKey: 'approveCount',
    statLabel: 'Approve',
    badgeId: 'aki-badge-approve',
    checkboxId: 'aki-opt-approve',
    rowLabel: 'Auto click <strong>Approve / Allow</strong>',
    keywords: ['approve', 'allow'],
    matchExact: false,
    classifyText: null,
    classifyRank: 4
  },
  {
    configKey: 'autoContinue',
    statKey: 'continueCount',
    statLabel: 'Continue',
    badgeId: 'aki-badge-continue',
    checkboxId: 'aki-opt-continue',
    rowLabel: 'Auto click <strong>Continue</strong>',
    keywords: ['continue'],
    matchExact: false,
    classifyText: 'continue',
    classifyRank: 1
  },
  {
    configKey: 'autoRun',
    statKey: 'runCount',
    statLabel: 'Run',
    badgeId: 'aki-badge-run',
    checkboxId: 'aki-opt-run',
    rowLabel: 'Auto click <strong>Run (Dialog / Modal)</strong>',
    keywords: ['run'],
    matchExact: true,
    classifyText: 'run',
    classifyRank: 2
  },
  {
    configKey: 'autoRetry',
    statKey: 'retryCount',
    statLabel: 'Retry',
    badgeId: 'aki-badge-retry',
    checkboxId: 'aki-opt-retry',
    rowLabel: 'Auto click <strong>Try again</strong>',
    keywords: ['try again'],
    matchExact: false,
    classifyText: 'try again',
    classifyRank: 3
  }
];

class AutoClickManager {
  constructor(targets) {
    this.targets = targets;
    this.byRank = [...targets].sort((a, b) => a.classifyRank - b.classifyRank);
    this.stats = this._hydrateStats();
  }

  // Merges defaults into whatever survives a non-navigation re-injection (daemon restart, AKI_UI_V rebuild) instead of an all-or-nothing `||`, so a field added after __pmStats already existed in the page is filled in without a full page reload.
  _hydrateStats() {
    const defaults = {};
    this.targets.forEach((t) => { defaults[t.statKey] = 0; });
    window.__pmStats = Object.assign(defaults, window.__pmStats || {});
    return window.__pmStats;
  }

  defaultConfig() {
    const cfg = {};
    this.targets.forEach((t) => { cfg[t.configKey] = true; });
    return cfg;
  }

  persistedConfig(config) {
    const cfg = {};
    this.targets.forEach((t) => { cfg[t.configKey] = config[t.configKey]; });
    return cfg;
  }

  updateBadges() {
    this.targets.forEach((t) => {
      const el = document.getElementById(t.badgeId);
      if (el) el.textContent = this.stats[t.statKey];
    });
  }

  renderRows(config) {
    return this.targets.map((t) => `
        <div class="aki-row">
          <label class="aki-label">
            <input type="checkbox" id="${t.checkboxId}" ${config[t.configKey] ? 'checked' : ''}>
            <span>${t.rowLabel}</span>
          </label>
          <span id="${t.badgeId}" class="aki-badge">${this.stats[t.statKey]}</span>
        </div>`).join('\n');
  }

  bindRows(panelEl, config, onChange) {
    this.targets.forEach((t) => {
      const cb = panelEl.querySelector(`#${t.checkboxId}`);
      if (!cb) return;
      cb.onchange = (e) => {
        config[t.configKey] = e.target.checked;
        onChange();
      };
    });
  }

  // Which stat bucket a click counts toward, by priority (continue > run > try again > approve fallback), independent of which config flag made the button clickable.
  _classify(text) {
    const hit = this.byRank.find((t) => t.classifyText && text.includes(t.classifyText));
    return hit || this.targets.find((t) => t.classifyText === null) || this.targets[0];
  }

  matchPrimary(text) {
    return this.byRank.find((t) => t.keywords && matchesAutoClickTarget(text, t)) || null;
  }
}

function isDeclineLabel(label) {
  return !!label && AUTO_CLICK_IGNORES.some((kw) => label === kw || label.includes(kw));
}

const PRESS_RETRY_MS = 3000;

// A multi-tool card keeps the same DOM node while its label counts down ("Approve (3)" → "(2)"), and a swallowed click leaves the node untouched — a permanent boolean marker would strand both cases.
function isPressInFlight(btn) {
  const [label, at] = (btn.dataset.akiPressed || '').split('@');
  return !!at && label === buttonLabel(btn) && Date.now() - Number(at) < PRESS_RETRY_MS;
}

function cardCopy(card) {
  return (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
}

// Finds pending permission surfaces and presses their confirm (or, for the folder dialog, decline) slot (docs/ref/postman-permission-popup-test.md).
class PermissionCardClicker {
  constructor(manager, rejectFolder, onFolderRejected) {
    this.manager = manager;
    this.rejectFolder = rejectFolder;
    this.onFolderRejected = onFolderRejected;
  }

  _slotButton(card, kind) {
    const buttons = [...card.querySelectorAll('button')].filter((b) => isVisible(b) && !b.disabled && !isPressInFlight(b));
    if (kind === 'decline') return buttons.find((b) => isDeclineLabel(buttonLabel(b))) || null;
    return buttons.find((b) => this.manager.matchPrimary(buttonLabel(b)))
      || (card.matches(PERMISSION_CARD_ROOT) ? buttons.find((b) => !isDeclineLabel(buttonLabel(b))) : null);
  }

  _cardOf(btn) {
    return btn.closest(PERMISSION_CARD_ROOT)
      || btn.closest(DIALOG_ROOT)
      || btn.closest('[class*="approval"], [class*="Approval"]')
      || btn.closest('.ai-chat-message')
      || btn.parentElement;
  }

  // Label checks reject most chat buttons before any layout-forcing visibility work.
  cards() {
    const found = new Set(document.querySelectorAll(PERMISSION_CARD_ROOT));
    for (const dialog of document.querySelectorAll(DIALOG_ROOT)) {
      if (!dialog.querySelector(PERMISSION_CARD_ROOT)) found.add(dialog);
    }
    const chat = document.querySelector(CHAT_ROOT) || document.body;
    for (const btn of chat.querySelectorAll('button')) {
      if (btn.disabled || isPressInFlight(btn)) continue;
      const label = buttonLabel(btn);
      const isAction = !!this.manager.matchPrimary(label);
      if (!isAction && !isDeclineLabel(label)) continue;
      if (!isVisible(btn) || btn.closest(PANEL_ROOT)) continue;
      const card = this._cardOf(btn);
      if (!card || found.has(card)) continue;
      if (isAction || cardCopy(card).toLowerCase().includes(this.rejectFolder.bodyNeedle)) found.add(card);
    }
    return [...found].filter(isLiveCard);
  }

  _creditArmed() {
    const armed = window.__pmArmedCard;
    if (!armed) return;
    if (armed.el && armed.el.isConnected && (!armed.btn || armed.btn.isConnected)) return;
    window.__pmArmedCard = null;
    if (armed.kind === 'folder') {
      window.__pmStats[this.rejectFolder.statKey]++;
      console.log(`[⚡ AutoRun] folder card gone (Stats: rejectPickFolder=${window.__pmStats[this.rejectFolder.statKey]})`);
      this.onFolderRejected();
      return;
    }
    const bucket = this.manager._classify(armed.label);
    this.manager.stats[bucket.statKey]++;
    const summary = this.manager.targets.map((t) => `${t.statLabel}=${this.manager.stats[t.statKey]}`).join(', ');
    console.log(`[⚡ AutoRun] permission card gone: "${armed.label}" (Stats: ${summary})`);
    this.manager.updateBadges();
  }

  // A press is async, so a card can survive several ticks before leaving the DOM; without a marker the loop re-presses it every tick, and that double-press is what freezes the chat session — mark the button (label@time, see isPressInFlight), credit it when it disappears.
  _press(card, button, kind, copy, label) {
    button.dataset.akiPressed = `${label}@${Date.now()}`;
    window.__pmArmedCard = { kind, copy, label, el: card, btn: button };
    press(button);
    if (!card.isConnected) this._creditArmed();
  }

  tick(cfg) {
    this._creditArmed();
    for (const card of this.cards()) {
      const copy = cardCopy(card);
      const folderIntent = cfg[this.rejectFolder.configKey] && copy.toLowerCase().includes(this.rejectFolder.bodyNeedle);
      if (folderIntent) {
        const decline = this._slotButton(card, 'decline');
        if (decline) this._press(card, decline, 'folder', copy, buttonLabel(decline));
        continue;
      }
      const confirm = this._slotButton(card, 'confirm');
      if (!confirm) continue;
      const label = buttonLabel(confirm);
      const row = this.manager.matchPrimary(label);
      const allowed = row ? cfg[row.configKey] : (card.matches(PERMISSION_CARD_ROOT) && cfg.autoApprove);
      if (allowed) this._press(card, confirm, 'confirm', copy, label);
    }
  }
}
