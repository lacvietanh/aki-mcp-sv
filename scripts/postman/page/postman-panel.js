/**
 * Postman CDP Automation & Aki Controller UI (Full English, Horizontal Trigger, No Reload Icons)
 */
(function () {
  if (window.__pmMasterInterval) {
    clearInterval(window.__pmMasterInterval);
  }

  const existingAkiPanel = document.getElementById('aki-control-panel');
  window.__pmAkiPanelOpen = !!(
    window.__pmAkiPanelOpen
    || (existingAkiPanel && existingAkiPanel.classList.contains('aki-open'))
  );

  // New Window = newRequesterWindow. New Browser Tab is NOT that — it is
  // NavigationService.transitionTo('build.browser-tab') via rspack module.g.
  const PM_EVENT_NEW_REQUESTER_WINDOW = 'newRequesterWindow';

  const autoClicker = new AutoClickManager(AUTO_CLICK_TARGETS);
  window.__pmAutoClicker = autoClicker;
  const permissionClicker = new PermissionCardClicker(autoClicker, AUTO_REJECT_PICK_FOLDER, updateRejectFolderBadge);

  if (typeof window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey] !== 'number') {
    window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey] = 0;
  }

  function updateRejectFolderBadge() {
    const el = document.getElementById(AUTO_REJECT_PICK_FOLDER.badgeId);
    if (el) el.textContent = window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey];
  }

  function renderRejectFolderRow(cfg) {
    const t = AUTO_REJECT_PICK_FOLDER;
    return `
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="${t.checkboxId}" ${cfg[t.configKey] ? 'checked' : ''}>
              <span>${t.rowLabel}</span>
            </label>
            <span id="${t.badgeId}" class="aki-badge">${window.__pmStats[t.statKey]}</span>
          </div>`;
  }

  function triggerPostman(eventName) {
    const mediator = window.pm && window.pm.mediator;
    if (!mediator || typeof mediator.trigger !== 'function') return false;
    mediator.trigger(eventName);
    return true;
  }

  // Live-caught: agent openBrowserPage → rspack 946554.g(url, {forceNew}) → transitionTo('build.browser-tab', {}, {url: encodeURIComponent(url)}, {tabOptions:{forceNew}}). Module id is hashed per Postman build; find by the unique route string.
  function webpackRequire() {
    if (typeof window.__akiReq === 'function') return window.__akiReq;
    const chunks = window.rspackChunk_postman_app_renderer;
    if (!chunks || typeof chunks.push !== 'function') return null;
    const id = Date.now();
    chunks.push([
      [id],
      { [id]: function (e, t, r) { window.__akiReq = r; } },
      function (req) { window.__akiReq = req; req(id); }
    ]);
    return typeof window.__akiReq === 'function' ? window.__akiReq : null;
  }

  function openNewBrowserTab() {
    const req = webpackRequire();
    if (!req) return false;
    if (typeof window.__akiOpenBrowserTab === 'function') {
      window.__akiOpenBrowserTab('about:blank', { forceNew: true });
      return true;
    }
    const chunks = window.rspackChunk_postman_app_renderer;
    if (!chunks) return false;
    for (const item of chunks) {
      const mods = item && item[1];
      if (!mods) continue;
      for (const mid of Object.keys(mods)) {
        const src = Function.prototype.toString.call(mods[mid]);
        if (!src.includes('build.browser-tab') || !src.includes('transitionTo')) continue;
        const mod = req(mid);
        if (mod && typeof mod.g === 'function') {
          window.__akiOpenBrowserTab = mod.g;
          mod.g('about:blank', { forceNew: true });
          return true;
        }
      }
    }
    return false;
  }

  // Opens a URL in the OS default browser via Postman's own openExternalLink (the same function its Docs / Support / billing links use), so links leave the app instead of opening an in-app tab. The defining module's id is hashed per build, so find it by its unique export signature — never a fixed id — cache the resolved function, and fall back to window.open if the module can't be found.
  function openExternalUrl(url) {
    if (!url) return false;
    try {
      if (typeof window.__akiOpenExternal === 'function') {
        window.__akiOpenExternal(url, '_blank');
        return true;
      }
      const req = webpackRequire();
      const chunks = window.rspackChunk_postman_app_renderer;
      if (req && chunks) {
        for (const item of chunks) {
          const mods = item && item[1];
          if (!mods) continue;
          for (const mid of Object.keys(mods)) {
            let src = '';
            try { src = Function.prototype.toString.call(mods[mid]); } catch (e) { continue; }
            if (src.indexOf('openExternalLink:()=>') === -1) continue;
            const mod = req(mid);
            if (mod && typeof mod.openExternalLink === 'function') {
              window.__akiOpenExternal = mod.openExternalLink;
              window.__akiOpenExternal(url, '_blank');
              return true;
            }
          }
        }
      }
    } catch (e) { /* fall through to window.open */ }
    try { window.open(url, '_blank'); } catch (e) { /* ignore */ }
    return false;
  }

  function loadConfig() {
    let baseConfig = {
      ...autoClicker.defaultConfig(),
      autoRejectPickFolder: true,
      autoInjectInstruction: false,
      autoSummarize: false,
      autoSummarizePct: 90,
      showAllTeams: false,
      isPinned: true
    };

    if (window.__pmInitialConfig && typeof window.__pmInitialConfig === 'object') {
      baseConfig = { ...baseConfig, ...window.__pmInitialConfig };
    }
    if (typeof baseConfig.isPinned !== 'boolean') baseConfig.isPinned = true;

    return baseConfig;
  }

  let config = loadConfig();
  config.instruction = typeof window.__pmInitialInstruction === 'string' ? window.__pmInitialInstruction : '';

  function syncAndSaveConfig(extra = {}) {
    const persistData = {
      ...autoClicker.persistedConfig(config),
      autoRejectPickFolder: config.autoRejectPickFolder,
      autoInjectInstruction: config.autoInjectInstruction,
      autoSummarize: config.autoSummarize,
      autoSummarizePct: config.autoSummarizePct,
      isPinned: config.isPinned,
      ...extra
    };

    if (typeof window.__cdpSaveAkiConfig === 'function') {
      window.__cdpSaveAkiConfig(JSON.stringify(persistData));
    }
  }

  window.__pmOnDocumentClick = function (e) {
    const panel = document.getElementById('aki-control-panel');
    if (!panel || !panel.classList.contains('aki-open') || config.isPinned) return;
    if (e.target.closest('#aki-control-panel') || e.target.closest('#aki-vertical-trigger')) return;
    togglePanel(false);
  };
  if (!window.__pmGlobalClickBound) {
    document.addEventListener('click', (e) => {
      if (typeof window.__pmOnDocumentClick === 'function') window.__pmOnDocumentClick(e);
    });
    window.__pmGlobalClickBound = true;
  }

  function readPostmanAgentMode() {
    try {
      const raw = localStorage.getItem('agentModeSettings');
      if (!raw) return { thinking: true, autorun: true };
      const s = JSON.parse(raw);
      return {
        thinking: s.thinkingToggleEnabled !== false,
        autorun: s.autoRun !== false
      };
    } catch (e) {
      return { thinking: true, autorun: true };
    }
  }

  function agentSwitchOpenBtn(kind) {
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    if (!chat) return null;
    if (kind === 'thinking') {
      const btns = [...chat.querySelectorAll('[data-testid="aether-menu-button"][aria-haspopup="menu"]')].filter(isVisible);
      return btns.find((b) => /claude|gpt|auto|sonnet|opus|model/i.test(b.getAttribute('aria-label') || b.innerText || '')) || btns[0] || null;
    }
    return chat.querySelector('[data-testid="ai-chat-input-settings-button"]');
  }

  function findChatInput() {
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    if (!chat) return null;
    return chat.querySelector('[data-testid="ai-chat-input-editor"] [contenteditable="true"]');
  }

  function isChatEmpty(container) {
    const list = container.querySelector('[data-testid="ai-chat-conversation-container"]');
    if (!list) return true;
    return !list.textContent || !list.textContent.trim();
  }

  const SEND_BUTTON = '.ai-chat-input-send-button';
  const CANCEL_BUTTON = '.ai-chat-input-cancel-button';

  // The send button is only present/enabled (React onClick attached) while the input has text and nothing is streaming (confirmed live on 12.26.5); returns whether it actually got pressed so the caller can retry a tick-too-early miss.
  function submitChatInput(inputEl) {
    const chat = inputEl.closest('[data-testid="ai-chat-container"]');
    const sendBtn = chat && chat.querySelector(SEND_BUTTON);
    if (!sendBtn || sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') return false;
    press(sendBtn);
    return true;
  }

  function agentSwitchItem(kind) {
    if (kind === 'thinking') {
      const menu = document.querySelector('[data-testid="ai-chat-model-menu"]');
      const scope = menu ? [...menu.querySelectorAll('[role="menuitem"]')] : [...document.querySelectorAll('[role="menuitem"]')];
      return scope.find((el) => /enable extended thinking/i.test((el.textContent || '').trim())) || null;
    }
    return [...document.querySelectorAll('[role="menuitem"]')].find((el) => ((el.innerText || el.textContent || '').trim() === 'Auto-run')) || null;
  }

  function closeAgentMenuIfOpened(kind) {
    if (!window.__pmAgentMenuOpened) return;
    const btn = agentSwitchOpenBtn(kind);
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    window.__pmAgentMenuOpened = false;
  }

  function applyPendingAgentSwitch() {
    const pending = window.__pmPendingAgentSwitch;
    if (!pending) return;
    pending.ticks = (pending.ticks || 0) + 1;
    if (pending.ticks > 12) {
      closeAgentMenuIfOpened(pending.kind);
      window.__pmPendingAgentSwitch = null;
      return;
    }

    const live = readPostmanAgentMode();
    const current = pending.kind === 'thinking' ? live.thinking : live.autorun;
    if (current === pending.want) {
      closeAgentMenuIfOpened(pending.kind);
      window.__pmPendingAgentSwitch = null;
      return;
    }

    const item = agentSwitchItem(pending.kind);
    const input = item && item.querySelector('input[data-testid="aether-toggle-switch"][type="checkbox"]');
    if (input) {
      if (input.checked !== pending.want) input.click();
      return;
    }

    const btn = agentSwitchOpenBtn(pending.kind);
    if (!btn) {
      // The model/settings control lives inside the AI chat panel; if it's collapsed or still loading at bootstrap, open it and wait instead of silently giving up — this is what made the toggle feel "not bound" on a fresh start. Only refund the give-up tick while we actually issued an open, so a truly absent control still expires and can never permanently stall the permission-card loop.
      if (ensureAiChatOpen()) {
        console.log('[⚡ AutoRun] Opening AI Chat Panel to apply ' + pending.kind + ' toggle...');
        pending.ticks = Math.max(0, pending.ticks - 1);
      }
      return;
    }
    if (btn.getAttribute('aria-expanded') !== 'true') {
      btn.click();
      window.__pmAgentMenuOpened = true;
    }
  }

  // Opens the AI chat side panel when it is hidden; returns whether a click was issued. Shared by startup and the agent-toggle apply path so Thinking / Auto-run work even when the chat is collapsed or still loading.
  function ensureAiChatOpen() {
    const toggleBtn = document.querySelector('button[data-testid="toggle-right-sidebar"]');
    if (!toggleBtn || !isVisible(toggleBtn)) return false;
    const svgUse = toggleBtn.querySelector('svg use, use');
    const href = svgUse ? (svgUse.getAttribute('href') || svgUse.getAttribute('xlink:href') || '') : '';
    if (href.includes('hidden')) {
      toggleBtn.click();
      return true;
    }
    return false;
  }

  function handleStartupSequence() {
    if (window.__pmStartupSequenceDone) return;

    const toggleBtn = document.querySelector('button[data-testid="toggle-right-sidebar"]');
    if (!toggleBtn || !isVisible(toggleBtn)) return;

    if (ensureAiChatOpen()) console.log('[⚡ AutoRun] Startup: Opening AI Chat Panel...');

    renderAkiWidget();
    const panel = document.getElementById('aki-control-panel');
    if (panel) {
      console.log('[⚡ AutoRun] Startup: Opening Aki Control Panel...');
      togglePanel(true);
      window.__pmStartupSequenceDone = true;
    }
  }

  function ruleInfo() {
    return (window.__pmUpdateInfo && window.__pmUpdateInfo.rule) || {};
  }

  // === AKI MODEL SWITCH ===
  // Maps the panel radio values to the exact model label + committed model id.
  const AKI_MODELS = {
    '56so': { label: 'GPT-5.6 Sol', id: 'GPT_56_SOL' },
    '56lu': { label: 'GPT-5.6 Luna', id: 'GPT_56_LUNA', more: true },
    '48op': { label: 'Claude Opus 4.8', id: 'CLAUDE_OPUS_48_BEDROCK' },
    'auto': { label: 'Auto', auto: true },
  };

  // Postman renders the Auto row label as "AutoOptimized for most tasks" (no separator) and the model-menu button's aria-label as "Auto" while Auto is on. Match a leading "auto" — /^auto\b/ fails on "AutoOptimized" (no word boundary between the two letters).
  const looksAuto = (t) => /^auto/i.test((t || '').trim());

  // Opens the AI chat model menu (reusing the same menu-open button as the agent-switch 'thinking' path) and waits a couple of rAF frames for the menu items to mount. Returns the menu element or null.
  async function openModelMenu() {
    let menu = document.querySelector('[data-testid="ai-chat-model-menu"]');
    if (menu) return menu;
    const btn = agentSwitchOpenBtn('thinking');
    if (!btn) { ensureAiChatOpen(); return null; }
    if (btn.getAttribute('aria-expanded') !== 'true') {
      btn.click();
      window.__pmAgentMenuOpened = true;
    }
    for (let i = 0; i < 6 && !menu; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      menu = document.querySelector('[data-testid="ai-chat-model-menu"]');
    }
    return menu;
  }

  function closeModelMenu() { closeAgentMenuIfOpened('thinking'); }

  // Inside an open model menu, reveal the collapsed 'More models' submenu if present; a no-op when the button is absent. "More models" opens on HOVER (onPointerEnter), not click, and renders its items in a separate portal (aether-portals) outside [data-testid="ai-chat-model-menu"] — so we hover to open and the caller must re-scan document-wide (see modelMenuItems). Mount is ~instant but we poll (holding hover) until the item set grows, to be robust.
  async function expandMoreModels() {
    const more = document.querySelector('[data-testid="ai-chat-more-models-button"]');
    if (!more) return false;
    const before = modelMenuItems().length;
    // This Postman build opens the "More models" submenu on click; older builds used hover — try both.
    if (more.getAttribute('aria-expanded') !== 'true') press(more);
    hoverEl(more);
    for (let i = 0; i < 30; i++) {
      if (modelMenuItems().length > before) return true;
      hoverEl(more);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return modelMenuItems().length > before;
  }

  // Scan document-wide (ignore the `menu` arg): the "More models" submenu renders its items in a portal (aether-portals) OUTSIDE [data-testid="ai-chat-model-menu"], so scoping to the menu container would miss GPT-5.6 Luna et al. The model menu is modal, so document-wide is safe.
  function modelMenuItems(menu) {
    return [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')]
      .filter((el) => !/enable extended thinking/i.test((el.textContent || '').trim()));
  }

  // Reads the currently active model + thinking state. The model-menu button label is the reliable live signal ("Auto" while Auto is on, else the model name): Postman sets no aria-checked on the menu items, and localStorage keeps naming the last concrete model even while Auto is on. No menu open needed.
  async function getCurrentModelSelection() {
    return { modelText: currentModelLabelCheap(), thinking: readPostmanAgentMode().thinking, id: localStorage.getItem('ai-chat-last-selected-model') };
  }

  function selectedModelId(selection) {
    if (selection.modelText) {
      const liveModel = Object.values(AKI_MODELS).find((candidate) => candidate.label === selection.modelText);
      return liveModel ? liveModel.id : null;
    }
    return selection.id;
  }

  // Cheap current-model read from the chat's model-menu button label — no menu open, safe on every panel render. agentSwitchOpenBtn('thinking') is the button whose label names the live model / Auto.
  function currentModelLabelCheap() {
    const btn = agentSwitchOpenBtn('thinking');
    if (!btn) return '';
    return (btn.getAttribute('aria-label') || btn.innerText || '').trim();
  }

  // Matches a model-menu item to a panel model. 'Auto' has no committed id, so it is matched by label prefix (Postman may render 'Auto' with a trailing description); concrete models match exactly.
  function modelItemMatches(el, model) {
    const text = (el.textContent || '').trim();
    return model.auto ? looksAuto(text) : text === model.label;
  }

  // Confirms a live selection is the requested model. Auto is a toggle whose only reliable signal is the model-button label ("Auto"); localStorage keeps naming the previous concrete id, so while Auto is on no concrete model may match. For concrete models the live label OR the committed id is authoritative.
  function selectionMatches(selection, model) {
    if (model.auto) return looksAuto(selection.modelText);
    if (looksAuto(selection.modelText)) return false;
    return selection.modelText === model.label || selection.id === model.id;
  }

  // Applies the requested model. Auto is a TOGGLE whose row collapses the menu to just itself while on, not a peer radio: to pick Auto we press its row; to pick a concrete model while Auto is on we first toggle Auto off (which re-expands the concrete list), then click the target. Verified via the button label.
  async function selectModel(model) {
    if (!model) return false;
    if (selectionMatches(await getCurrentModelSelection(), model)) return true;

    let menu = await openModelMenu();
    if (!menu) { console.warn('[AKI] selectModel: model menu not available'); closeModelMenu(); return false; }
    const autoRow = () => modelMenuItems(menu).find((el) => looksAuto((el.textContent || '').trim()));

    if (model.auto) {
      const row = autoRow();
      if (row) press(row);
    } else {
      // Auto on => the menu shows only the Auto row; toggle it off, then re-open to reveal the concrete list.
      if (looksAuto(currentModelLabelCheap())) {
        const row = autoRow();
        if (row) press(row);
        for (let i = 0; i < 8 && looksAuto(currentModelLabelCheap()); i++) await new Promise((r) => requestAnimationFrame(r));
        menu = await openModelMenu();
        if (!menu) { closeModelMenu(); return false; }
      }
      let item = modelMenuItems(menu).find((el) => modelItemMatches(el, model));
      if (!item && model.more) {
        await expandMoreModels();
        item = modelMenuItems(menu).find((el) => modelItemMatches(el, model));
      }
      if (!item) {
        console.warn('[AKI] selectModel: no menu item for ' + model.label);
        closeModelMenu();
        return false;
      }
      press(item);
    }
    closeModelMenu();
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (selectionMatches(await getCurrentModelSelection(), model)) return true;
    }
    console.warn('[AKI] model switch not confirmed as ' + model.label);
    return false;
  }

  function instructionPrefix() {
    return `[akidevrule ${ruleInfo().current || 'not installed'}]`;
  }

  function teamAddonsUrl(team) {
    const host = String((team && team.slug) || '').replace(/[^a-zA-Z0-9-]/g, '');
    return host ? `https://${host}.postman.co/billing/add-ons/overview` : '';
  }

  function quotaFillClass(pct) {
    return pct >= 90 ? 'aki-fill-error' : pct >= 70 ? 'aki-fill-warn' : 'aki-fill-ok';
  }

  function quotaPct(q) {
    return q ? Math.min(100, Math.max(0, q.percent || 0)) : 0;
  }

  function quotaLabel(q) {
    return q ? `${q.used.toLocaleString()} / ${q.limit.toLocaleString()}` : 'unavailable';
  }

  function quotaFill(q) {
    return q ? quotaFillClass(quotaPct(q)) : '';
  }

  function akiSpriteHref(symbolId) {
    const sample = document.querySelector('.status-bar use, .sb__item use');
    const raw = sample
      ? (sample.getAttribute('href') || sample.getAttribute('xlink:href') || '')
      : '';
    const base = raw.includes('#') ? raw.slice(0, raw.indexOf('#')) : '';
    return `${base}#${symbolId}`;
  }

  function akiIcon(symbolId, size) {
    const href = akiSpriteHref(symbolId);
    const s = size || 16;
    return `<svg class="aki-icon" width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="${href}" xlink:href="${href}"></use></svg>`;
  }

  function akiPinIcon(filled) {
    if (document.querySelector('.status-bar use, .sb__item use')) {
      return akiIcon(filled ? 'icon-action-pin-fill-small' : 'icon-action-pin-stroke-small');
    }
    return `<svg class="aki-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10.26 3.06a.75.75 0 0 1 .68.2l2 2a.75.75 0 0 1-.12 1.15L6.32 9.91a.75.75 0 0 1-.98-.2L3.76 6.56a.75.75 0 0 1 .2-.98l6.3-2.52z"/><path d="M5.15 10.15a.5.5 0 0 1 .7 0L3.35 13.35a.5.5 0 1 1-.7-.7l2.5-2.5z" opacity="${filled ? '1' : '0.7'}"/></svg>`;
  }

  function teamViewLink(team) {
    const href = teamAddonsUrl(team);
    if (!href) return '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" data-aki-team-view class="aki-view">View</a>`;
  }

  function getActiveUsageTeam() {
    const data = window.__pmUsageData;
    if (!data || !data.success || !Array.isArray(data.teams) || data.teams.length === 0) return null;
    const currentTeamId = new URLSearchParams(window.location.search).get('teamId');
    return data.teams.find(t => String(t.team_id) === String(currentTeamId)) || data.teams[0];
  }

  function formatCreditReset(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (!isFinite(ms)) return '';
    if (ms <= 0) return 'Resets now';
    const totalH = Math.floor(ms / 3600000);
    const d = Math.floor(totalH / 24);
    if (d >= 1) return `Resets in ${d}d ${totalH % 24}h`;
    const m = Math.floor((ms % 3600000) / 60000);
    return `Resets in ${totalH}h ${m}m`;
  }

  // "4:38:35 PM" (daemon locale time string) → "16:38:35"; passes anything already 24h through.
  function to24h(t) {
    const m = t && /^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
    if (!m) return t || '';
    let h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[4])) h += 12;
    return String(h).padStart(2, '0') + ':' + m[2] + ':' + m[3];
  }

  // Reads the conversation size as the character length of the rendered chat DOM. Lossy (omits hidden system prompt/tool schema, undercounts collapsed tool-results) but monotonic, so it works as a "time to start a new chat" trigger. Ruled out for exact capture: the full context is server-held (docs/research/session-context-capture.md).
  function readConversationChars() {
    try {
      const container = document.querySelector('[data-testid="ai-chat-container"] [data-testid="ai-chat-conversation-container"]');
      return container ? (container.innerText || '').length : 0;
    } catch (e) {
      return 0;
    }
  }

  // Horizontal context-length bar mounted at the bottom of .ai-chat-footer, right under the chat input, so the "time to start a new chat" signal sits at the edge of where the user types; fill width is chars/red capped at 100%, color crosses green→amber→red at the thresholds (defaults 80K/150K chars).
  function renderContextBar() {
    const footer = document.querySelector('[data-testid="ai-chat-container"] .ai-chat-footer');
    const host = footer && footer.querySelector('.ai-chat-center-content');
    if (!host) return;
    const chars = readConversationChars();
    const amber = config.ctxCharAmber || 80000;
    const red = config.ctxCharRed || 150000;
    const pct = Math.max(2, Math.min(100, Math.round((chars / red) * 100)));
    const color = chars >= red
      ? 'var(--content-color-error)'
      : chars >= amber
        ? 'var(--content-color-warning, #f5a623)'
        : 'var(--content-color-success)';
    const kb = chars > 0 ? Math.round(chars / 1000) + 'K' : '0';
    let bar = document.getElementById('aki-ctx-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'aki-ctx-bar';
    }
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 12px 4px;font-size:10px;opacity:.85';
    // Mount inside the footer's center-content, not the footer itself — appending to the footer pushed the bar past .ai-chat-container's overflow:hidden clip edge, making it invisible.
    if (host.lastElementChild !== bar) host.appendChild(bar);
    const summarizeAt = config.autoSummarize ? config.autoSummarizePct || 90 : null;
    bar.title = `Chat context — ${chars.toLocaleString()} characters (${kb})\nHow long this conversation has grown. Longer chats can make the assistant's answers drift, so this is your cue to reset.\nGreen: healthy · Amber ≥ ${Math.round(amber / 1000)}K · Red ≥ ${Math.round(red / 1000)}K → start a new chat.${summarizeAt ? `\nAuto-summarize at the tick: ${summarizeAt}% (${Math.round(autoSummarizeMark() / 1000)}K).` : ''}`;
    const tick = summarizeAt ? `<div style="position:absolute;top:0;bottom:0;left:${summarizeAt}%;width:2px;margin-left:-1px;background:var(--content-color-primary,#fff);opacity:.7"></div>` : '';
    bar.innerHTML = `<span style="color:var(--content-color-secondary,#8b8b8b);white-space:nowrap">Context</span><div style="position:relative;flex:1;height:4px;border-radius:2px;background:var(--background-color-tertiary,rgba(128,128,128,.25));overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};transition:width .3s"></div>${tick}</div><span style="color:${color};font-variant-numeric:tabular-nums;white-space:nowrap">${kb}</span>`;
  }

  function renderStatusBarUsage() {
    const el = document.getElementById('aki-status-bar-usage');
    if (!el) return;

    const team = getActiveUsageTeam();
    if (!team || !team.quota) {
      el.classList.add('aki-sb-empty');
      el.innerHTML = '<span class="aki-sb-team">Credits</span><span class="aki-sb-bar"></span>';
      return;
    }

    const pct = Math.min(100, Math.max(0, team.quota.percent || 0));
    el.classList.remove('aki-sb-empty');
    el.innerHTML = `
      <span class="aki-sb-team">${team.name || team.slug || 'Team'}</span>
      <span class="aki-sb-bar"><span class="aki-sb-fill ${quotaFillClass(pct)}" style="width: ${pct}%;"></span></span>
      <span class="aki-sb-credits" title="${formatCreditReset(team.quota.resetAt)}">${team.quota.used.toLocaleString()} / ${team.quota.limit.toLocaleString()}</span>
    `;
  }

  function renderUsageContent() {
    renderStatusBarUsage();

    const box = document.getElementById('aki-usage-box');
    if (!box) return;

    const data = window.__pmUsageData;
    if (!data || !data.success || !Array.isArray(data.teams)) {
      box.innerHTML = `
        <div class="aki-row">
          <span class="aki-section-label">AI CREDITS QUOTA</span>
          <span class="aki-muted">Synchronizing...</span>
        </div>
      `;
      return;
    }

    const currentTeamId = new URLSearchParams(window.location.search).get('teamId');
    const activeTeam = getActiveUsageTeam() || data.teams[0];

    let allTeamsHTML = '';
    if (config.showAllTeams) {
      allTeamsHTML = `
        <div class="aki-all-teams">
          ${data.teams.map(t => {
            const isCur = String(t.team_id) === String(currentTeamId);
            const pct = quotaPct(t.quota);
            return `
              <div class="aki-team ${isCur ? 'aki-team-cur' : ''}">
                <div class="aki-row aki-team-head">
                  <span class="aki-team-name-wrap">
                    <span class="aki-team-name">${t.name || t.slug}</span>
                    ${teamViewLink(t)}
                  </span>
                  <span class="aki-muted aki-nowrap">${quotaLabel(t.quota)}${t.quota ? ` (${pct}%)` : ''}</span>
                </div>
                <div class="aki-bar-track aki-bar-sm">
                  <div class="aki-sb-fill ${quotaFill(t.quota)}" style="width: ${pct}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const actPct = quotaPct(activeTeam.quota);
    const resetStr = formatCreditReset(activeTeam.quota && activeTeam.quota.resetAt);

    box.innerHTML = `
      <div>
        <div class="aki-row aki-usage-head">
          <div class="aki-team-name-wrap">
            <span class="aki-section-label">${activeTeam.name || activeTeam.slug}</span>
            ${teamViewLink(activeTeam)}
            <span class="aki-tag">Active</span>
          </div>
          <span class="aki-quota">${quotaLabel(activeTeam.quota)}${activeTeam.quota ? ` (${actPct}%)` : ''}</span>
        </div>
        <div class="aki-bar-track">
          <div class="aki-sb-fill ${quotaFill(activeTeam.quota)}" style="width: ${actPct}%;"></div>
        </div>
        <div class="aki-row aki-usage-foot">
          <button id="aki-toggle-all-teams" class="aki-text-btn">
            ${config.showAllTeams ? 'Collapse' : `View all ${data.teams.length} teams`}
          </button>
          <span class="aki-muted">${resetStr ? resetStr + ' · ' : ''}${data.updatedAt ? 'updated ' + to24h(data.updatedAt) : ''}</span>
        </div>
        ${allTeamsHTML}
      </div>
    `;

    const toggleAll = box.querySelector('#aki-toggle-all-teams');
    if (toggleAll) toggleAll.onclick = (e) => {
      e.stopPropagation();
      config.showAllTeams = !config.showAllTeams;
      renderUsageContent();
    };

    box.querySelectorAll('[data-aki-team-view]').forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrl(link.href);
      };
    });
  }

  window.__pmRenderUsageBox = renderUsageContent;

  const PANEL_WIDTH = 350;
  const ANCHOR_GAP = 4;
  const VIEWPORT_PAD = 8;
  const AKI_UI_V = 'aether22';

  function togglePanel(forcedState) {
    const panel = document.getElementById('aki-control-panel');
    const trigger = document.getElementById('aki-vertical-trigger');
    if (!panel) return;

    const next = (typeof forcedState === 'boolean') ? forcedState : !panel.classList.contains('aki-open');
    panel.classList.toggle('aki-open', next);
    if (trigger) trigger.classList.toggle('aki-trigger-active', next);
    window.__pmAkiPanelOpen = next;
    if (next) renderUsageContent();
    positionAkiWidget();
  }

  function positionAkiWidget() {
    const trigger = document.getElementById('aki-vertical-trigger');
    const panel = document.getElementById('aki-control-panel');
    if (!trigger || !panel) return;

    const anchor = trigger.getBoundingClientRect();
    if (anchor.width <= 0 || anchor.height <= 0) return;

    const left = Math.min(
      Math.max(VIEWPORT_PAD, anchor.left),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_PAD
    );
    const bottom = anchor.top - ANCHOR_GAP;
    panel.style.left = `${left}px`;
    panel.style.top = `${bottom}px`;
    panel.style.maxHeight = `${Math.max(0, bottom - VIEWPORT_PAD)}px`;
  }

  function injectAkiStyles() {
    const css = `
      .status-bar-container.status-bar {
        position: relative;
      }
      #aki-status-bar-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        height: 100%;
        min-width: 0;
        pointer-events: none;
      }
      .status-bar-container.status-bar > #aki-status-bar-slot {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 1;
        flex: none;
      }
      #aki-vertical-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: center;
        height: var(--size-s);
        padding: 0 var(--spacing-s);
        background: var(--button-primary-background-color, var(--base-color-brand));
        border: none;
        border-radius: var(--border-radius-default);
        cursor: pointer;
        user-select: none;
        pointer-events: auto;
        font-family: var(--text-family-default);
        font-size: var(--text-size-s);
        font-weight: var(--text-weight-medium);
        color: var(--button-primary-content-color, var(--content-color-constant));
        white-space: nowrap;
        flex-shrink: 0;
      }
      #aki-vertical-trigger:hover,
      #aki-vertical-trigger.aki-trigger-active {
        background: var(--button-primary-hover-background-color, var(--highlight-background-color-brand));
      }
      #aki-status-bar-usage {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-s);
        height: 100%;
        max-height: var(--size-s);
        max-width: 100%;
        padding: 0 var(--spacing-s);
        box-sizing: border-box;
        background: var(--background-color-tertiary);
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-default);
        font-family: var(--text-family-default);
        font-size: var(--text-size-s);
        line-height: var(--line-height-s);
        color: var(--content-color-secondary);
        white-space: nowrap;
        overflow: hidden;
      }
      #aki-status-bar-usage.aki-sb-empty {
        color: var(--content-color-tertiary);
      }
      #aki-status-bar-usage .aki-sb-team {
        font-weight: var(--text-weight-medium);
        color: var(--content-color-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }
      #aki-status-bar-usage.aki-sb-empty .aki-sb-team {
        color: var(--content-color-tertiary);
        font-weight: var(--text-weight-regular);
      }
      #aki-status-bar-usage .aki-sb-bar {
        width: 72px;
        height: var(--border-width-xl);
        background: var(--highlight-background-color-transparent);
        border-radius: var(--border-radius-s);
        overflow: hidden;
        flex-shrink: 0;
      }
      .aki-sb-fill {
        display: block;
        height: 100%;
      }
      .aki-fill-ok { background-color: var(--base-color-success); }
      .aki-fill-warn { background-color: var(--base-color-warning); }
      .aki-fill-error { background-color: var(--base-color-error); }
      #aki-status-bar-usage .aki-sb-credits {
        font-variant-numeric: tabular-nums;
        color: var(--content-color-tertiary);
        flex-shrink: 0;
      }
      #aki-control-panel {
        position: fixed;
        overflow-y: auto;
        z-index: 9999999;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-90%);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
        background: var(--popover-background-color, var(--background-color-primary));
        border: var(--border-width-default) solid var(--popover-outline-color, var(--border-color-default));
        border-bottom-width: var(--border-width-l);
        border-bottom-color: var(--content-color-brand);
        border-radius: var(--border-radius-l);
        box-shadow: var(--popover-box-shadow, var(--shadow-default));
        font-family: var(--text-family-default);
        font-size: var(--text-size-m);
        color: var(--content-color-primary);
        padding: var(--spacing-m);
        box-sizing: border-box;
      }
      #aki-control-panel.aki-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(-100%);
      }
      #aki-control-panel .aki-icon {
        display: block;
        fill: currentColor;
      }
      #aki-control-panel .aki-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: var(--border-width-default) solid var(--border-color-default);
        padding-bottom: var(--spacing-s);
        margin-bottom: var(--spacing-m);
      }
      #aki-control-panel .aki-title {
        font-size: var(--text-size-l);
        font-weight: var(--text-weight-bold);
        color: var(--content-color-primary);
      }
      #aki-control-panel .aki-head-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-s);
      }
      #aki-control-panel .aki-brand {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }
      #aki-control-panel .aki-title-row {
        display: flex;
        align-items: baseline;
        gap: var(--spacing-s);
        flex-wrap: wrap;
      }
      #aki-control-panel .aki-version {
        font-size: var(--text-size-xs);
        color: var(--content-color-tertiary);
        font-weight: var(--text-weight-regular);
      }
      #aki-control-panel .aki-brand-link {
        font-size: var(--text-size-xs);
        color: var(--content-color-brand);
        text-decoration: none;
        font-weight: var(--text-weight-medium);
        cursor: pointer;
        width: fit-content;
      }
      #aki-control-panel .aki-brand-link:hover { text-decoration: underline; }
      #aki-control-panel .aki-runtime {
        display: block;
        margin-top: 2px;
        font-size: var(--text-size-xs);
        color: var(--content-color-tertiary);
        font-variant-numeric: tabular-nums;
      }
      #aki-control-panel .aki-pin {
        background: none;
        border: var(--border-width-default) solid transparent;
        border-radius: var(--border-radius-default);
        color: var(--content-color-tertiary);
        cursor: pointer;
        padding: 1px var(--spacing-xs);
        display: inline-flex;
        align-items: center;
      }
      #aki-control-panel .aki-pin.is-pinned {
        background: var(--background-color-brand);
        border-color: var(--content-color-brand);
        color: var(--content-color-brand);
      }
      #aki-control-panel .aki-stack {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-s);
        font-size: var(--text-size-m);
        margin-bottom: var(--spacing-m);
      }
      #aki-control-panel .aki-stack.aki-rule {
        border-top: var(--border-width-default) solid var(--border-color-default);
        padding-top: var(--spacing-s);
      }
      #aki-control-panel .aki-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #aki-control-panel .aki-label {
        display: flex;
        align-items: center;
        gap: var(--spacing-s);
        cursor: pointer;
      }
      #aki-control-panel .aki-model-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--spacing-s);
      }
      #aki-control-panel .aki-model-row .aki-label {
        min-width: 0;
        gap: var(--spacing-xs);
        white-space: nowrap;
      }
      #aki-control-panel .aki-model-row .aki-label span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #aki-control-panel .aki-model-row input {
        flex: 0 0 auto;
        margin: 0;
      }
      #aki-control-panel .aki-badge {
        color: var(--content-color-brand);
        font-weight: var(--text-weight-medium);
        font-size: var(--text-size-m);
      }
      #aki-control-panel input[type="checkbox"] {
        accent-color: var(--base-color-brand);
      }
      #aki-control-panel .aki-section-label {
        font-size: var(--text-size-s);
        font-weight: var(--text-weight-bold);
        color: var(--content-color-brand);
      }
      #aki-control-panel .aki-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-left: 4px;
        border-radius: 50%;
        background: var(--background-color-tertiary);
        color: var(--content-color-tertiary);
        font-size: 10px;
        font-weight: var(--text-weight-bold);
        cursor: help;
        vertical-align: middle;
      }
      #aki-usage-box {
        margin-bottom: var(--spacing-m);
        padding: var(--spacing-s);
        background: var(--background-color-secondary);
        border-radius: var(--border-radius-default);
      }
      #aki-control-panel .aki-btn {
        background: var(--button-primary-background-color, var(--base-color-brand));
        color: var(--button-primary-content-color, var(--content-color-constant));
        border: none;
        border-radius: var(--border-radius-s);
        padding: 3px var(--spacing-s);
        font-family: var(--text-family-default);
        font-size: var(--text-size-xs);
        font-weight: var(--text-weight-bold);
        cursor: pointer;
      }
      #aki-control-panel .aki-btn:hover {
        background: var(--button-primary-hover-background-color, var(--highlight-background-color-brand));
      }
      #aki-install-rule-status {
        font-size: var(--text-size-xs);
        color: var(--content-color-tertiary);
        line-height: 1.4;
        min-height: 14px;
      }
      #aki-control-panel .aki-ok { color: var(--content-color-success); }
      #aki-control-panel .aki-err { color: var(--content-color-error); }
      #aki-control-panel .aki-muted {
        color: var(--content-color-tertiary);
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-view {
        color: var(--content-color-tertiary);
        font-size: var(--text-size-xs);
        font-weight: var(--text-weight-medium);
        text-decoration: none;
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-s);
        padding: 0 var(--spacing-xs);
        line-height: var(--line-height-xs);
        cursor: pointer;
        flex-shrink: 0;
      }
      #aki-control-panel .aki-tag {
        font-size: var(--text-size-xs);
        background: var(--background-color-brand);
        color: var(--content-color-brand);
        padding: 1px var(--spacing-xs);
        border-radius: var(--border-radius-s);
      }
      #aki-control-panel .aki-team-name-wrap {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        min-width: 0;
      }
      #aki-control-panel .aki-team-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #aki-control-panel .aki-team-cur {
        background: var(--background-color-brand);
        border-left: var(--border-width-l) solid var(--content-color-brand);
        padding-left: var(--spacing-xs);
      }
      #aki-control-panel .aki-team-cur .aki-team-name {
        color: var(--content-color-brand);
        font-weight: var(--text-weight-bold);
      }
      #aki-control-panel .aki-bar-track {
        background: var(--highlight-background-color-transparent);
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: var(--spacing-xs);
      }
      #aki-control-panel .aki-bar-track.aki-bar-sm {
        height: var(--border-width-xl);
        border-radius: var(--border-radius-s);
        margin-bottom: 0;
      }
      #aki-control-panel .aki-text-btn {
        background: none;
        border: none;
        color: var(--content-color-tertiary);
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
        font-family: inherit;
        font-size: inherit;
      }
      #aki-control-panel .aki-all-teams {
        max-height: 130px;
        overflow-y: auto;
        margin-top: var(--spacing-s);
        border-top: var(--border-width-default) solid var(--border-color-default);
        padding-top: var(--spacing-xs);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-team-head,
      #aki-control-panel .aki-usage-head {
        margin-bottom: 2px;
        gap: var(--spacing-xs);
      }
      #aki-control-panel .aki-usage-foot {
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-nowrap { flex-shrink: 0; }
      #aki-control-panel .aki-textarea {
        width: 100%;
        box-sizing: border-box;
        margin-top: var(--spacing-xs);
        padding: var(--spacing-xs);
        background: var(--background-color-secondary);
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-default);
        color: var(--content-color-primary);
        font-family: monospace;
        font-size: var(--text-size-xs);
        line-height: 1.4;
        resize: vertical;
        min-height: 90px;
      }
      #aki-control-panel .aki-number {
        width: 4.5em;
        padding: 0 var(--spacing-xs);
        background: var(--background-color-secondary);
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-default);
        color: var(--content-color-primary);
        font-size: var(--text-size-xs);
      }
    `;
    let style = document.getElementById('aki-injected-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'aki-injected-styles';
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function findStatusBar() {
    return document.querySelector('.status-bar-container.status-bar');
  }

  // Live Postman bar (12.25): first .sb-section = left (sidebar, Git, Terminal, Console);
  // .sb-section--center = native empty center; last .sb-section = right (Globals, Vault, Tools).
  function findLeftStatusSection() {
    const bar = findStatusBar();
    if (!bar) return null;
    const sections = [...bar.querySelectorAll(':scope > .sb-section')];
    return sections.find((s) => !s.classList.contains('sb-section--center')) || sections[0] || null;
  }

  function findCenterStatusHost() {
    const bar = findStatusBar();
    if (!bar) return null;
    return bar.querySelector(':scope > .sb-section.sb-section--center') || bar;
  }

  function renderRuleStatus() {
    const status = document.getElementById('aki-install-rule-status');
    const btn = document.getElementById('aki-btn-install-rule');
    if (!status || !btn) return;
    if (btn.dataset.busy === '1') return;
    if (status.dataset.sticky === '1') return;

    const r = ruleInfo();
    const state = r.state || 'unknown';
    const current = r.current ? String(r.current) : '';
    const latest = r.latest ? String(r.latest) : '';
    status.dataset.state = state;
    status.classList.remove('aki-err');

    if (state === 'missing') {
      btn.className = 'aki-btn';
      btn.textContent = 'Install';
      status.innerHTML = '<span class="aki-err">not installed</span>'
        + (latest ? `<span class="aki-muted"> · latest ${latest}</span>` : '');
      return;
    }
    if (state === 'update') {
      btn.className = 'aki-btn';
      btn.textContent = 'Update';
      status.innerHTML = `<span>${current} → ${latest}</span>`;
      return;
    }
    if (state === 'unknown') {
      btn.className = 'aki-text-btn';
      btn.textContent = 'Install / update';
      status.innerHTML = (current ? `<span class="aki-muted">${current} · </span>` : '')
        + '<span class="aki-muted">update check failed</span>';
      return;
    }

    btn.className = 'aki-text-btn';
    btn.textContent = 'Install / update';
    status.innerHTML = current ? `<span class="aki-muted">${current}</span>` : '';
  }

  window.__pmRenderRuleStatus = renderRuleStatus;

  function renderAkiWidget() {
    if (!document.body) return;
    injectAkiStyles();

    const leftSection = findLeftStatusSection();
    let akiTrigger = document.getElementById('aki-vertical-trigger');
    if (leftSection) {
      if (!akiTrigger) {
        akiTrigger = document.createElement('button');
        akiTrigger.id = 'aki-vertical-trigger';
        akiTrigger.type = 'button';
        akiTrigger.innerHTML = '<span>Aki Control Panel</span>';
      }
      akiTrigger.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      };
      if (leftSection.firstElementChild !== akiTrigger) {
        leftSection.insertBefore(akiTrigger, leftSection.firstElementChild);
      }
    }

    const centerHost = findCenterStatusHost();
    if (centerHost) {
      let slot = document.getElementById('aki-status-bar-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.id = 'aki-status-bar-slot';
      }
      if (slot.parentElement !== centerHost) centerHost.appendChild(slot);
      let usageEl = document.getElementById('aki-status-bar-usage');
      if (!usageEl) {
        usageEl = document.createElement('div');
        usageEl.id = 'aki-status-bar-usage';
      }
      if (usageEl.parentElement !== slot) slot.appendChild(usageEl);
    }

    let panel = document.getElementById('aki-control-panel');
    if (panel && panel.dataset.akiUi !== AKI_UI_V) {
      window.__pmAkiPanelOpen = panel.classList.contains('aki-open') || window.__pmAkiPanelOpen;
      panel.remove();
      panel = null;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'aki-control-panel';
      panel.dataset.akiUi = AKI_UI_V;
      panel.style.width = `${PANEL_WIDTH}px`;

      const agentMode = readPostmanAgentMode();
      const appVer = (typeof window.__pmAppVersion === 'string' && window.__pmAppVersion) ? window.__pmAppVersion : '';
      const rt = (window.__pmRuntime && typeof window.__pmRuntime === 'object') ? window.__pmRuntime : {};
      const runtimeLine = rt.cdpPort
        ? `<span class="aki-runtime" title="Postman remote-debugging (CDP) port and control-daemon PID">CDP :${escapeHtml(String(rt.cdpPort))}${rt.daemonPid ? ' · PID ' + escapeHtml(String(rt.daemonPid)) : ''}</span>`
        : '';
      panel.innerHTML = `
        <div class="aki-head">
          <div class="aki-brand">
            <div class="aki-title-row">
              <span class="aki-title">Aki MCP for Postman</span>
              ${appVer ? `<span class="aki-version">v${escapeHtml(appVer)}</span>` : ''}
            </div>
            <a href="https://akimcp.top" data-aki-ext class="aki-brand-link" title="Open akimcp.top in your browser">akimcp.top</a>
            ${runtimeLine}
          </div>
          <div class="aki-head-actions">
            <button type="button" id="aki-btn-new-window" class="aki-btn">NEW WINDOW</button>
            <button type="button" id="aki-panel-pin" class="aki-pin${config.isPinned ? ' is-pinned' : ''}" title="Pin panel (stay open when clicking outside)">${akiPinIcon(config.isPinned)}</button>
          </div>
        </div>

        <div class="aki-stack">
          ${autoClicker.renderRows(config)}
          ${renderRejectFolderRow(config)}
        </div>

        <div id="aki-usage-box"></div>

        <div class="aki-stack aki-rule">
          <div class="aki-section-label">CHAT AGENT</div>
          <div class="aki-row aki-model-row">
            <label class="aki-label" title="GPT-5.6 Sol">
              <input type="radio" name="aki-model" value="56so"> <span>5.6 Sol</span>
            </label>
            <label class="aki-label" title="GPT-5.6 Luna">
              <input type="radio" name="aki-model" value="56lu"> <span>5.6 Luna</span>
            </label>
            <label class="aki-label" title="Opus 4.8 — logic sâu nhất, coding phức tạp & agentic dài hơi; suy luận đa bước bền. Chậm/đắt hơn — để dành việc khó.">
              <input type="radio" name="aki-model" value="48op"> <span>Opus 4.8</span>
            </label>
            <label class="aki-label" title="Auto — Postman tự chọn model phù hợp cho từng bước">
              <input type="radio" name="aki-model" value="auto"> <span>Auto</span>
            </label>
          </div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-thinking" ${agentMode.thinking ? 'checked' : ''}>
              <span><strong>Thinking</strong> (high)</span>
            </label>
          </div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-autorun" ${agentMode.autorun ? 'checked' : ''}>
              <span><strong>Auto-run</strong> (agent tool calls)</span>
            </label>
          </div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">AKI DEV RULE</span>
            <span class="aki-head-actions">
              <a href="https://github.com/lacvietanh/akidevrule" data-aki-ext class="aki-view" title="Open the AkiDevRule repo in your browser">Repo</a>
              <button type="button" id="aki-btn-install-rule" class="aki-btn">Install</button>
            </span>
          </div>
          <div id="aki-install-rule-status" data-state="unknown"></div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">ANTI-BOT<span class="aki-help" title="Sites can check navigator.webdriver to tell a browser is automated. Protected = Postman was launched with the flag that hides it. Unprotected = it wasn't (still works fine, just detectable).">?</span></span>
            <button type="button" id="aki-btn-new-browser-tab" class="aki-btn">NEW BROWSER TAB</button>
          </div>
          <div id="aki-stealth-status">${navigator.webdriver
            ? '<span class="aki-err">Unprotected</span><br><span class="aki-muted">Quit Postman fully (Cmd+Q), then npm start / npm run launch to fix.</span>'
            : '<span class="aki-ok">Protected</span>'}</div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">PROMPT INSTRUCTION</span>
            <button type="button" id="aki-btn-send-instruction" class="aki-btn">SEND NOW</button>
          </div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-auto-inject" ${config.autoInjectInstruction ? 'checked' : ''}>
              <span>Auto-inject into each new chat</span>
            </label>
          </div>
          <textarea id="aki-instruction-textarea" class="aki-textarea" readonly title="Read-only: served natively from the app; cannot be edited here.">${escapeHtml(config.instruction)}</textarea>
          <div class="aki-row">
            <span class="aki-section-label">SUMMARIZE FOR HANDOFF<span class="aki-help" title="Sends a summarize prompt into this chat so the model writes a handoff summary you can paste into a new chat, keeping the context when this one gets long.">?</span></span>
            <button type="button" id="aki-btn-summarize-chat" class="aki-btn">SUMMARIZE THIS CHAT</button>
          </div>
          <div class="aki-row">
            <label class="aki-label" title="Presses Summarize this chat for you once, when a chat you are working in fills the Context bar to this percent and the assistant has finished replying. 100% is the bar's red mark. A chat that is already past it when you open it is left alone.">
              <input type="checkbox" id="aki-opt-auto-summarize" ${config.autoSummarize ? 'checked' : ''}>
              <span>Auto-summarize when the Context bar reaches</span>
            </label>
            <input type="number" id="aki-opt-auto-summarize-pct" class="aki-number" min="50" max="100" step="5" value="${config.autoSummarizePct}" title="Percent of the Context bar, 50 to 100. Default 90."><span>%</span>
          </div>
        </div>
      `;

      document.body.appendChild(panel);

      panel.onclick = (e) => e.stopPropagation();

      panel.querySelector('#aki-btn-new-window').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerPostman(PM_EVENT_NEW_REQUESTER_WINDOW);
      };

      panel.querySelector('#aki-btn-new-browser-tab').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNewBrowserTab();
      };

      // One handler for every static external link in the panel (brand akimcp.top, AkiDevRule repo, …): route them all through the OS default browser instead of a Postman in-app tab. DRY — team View links bind the same opener where they are re-rendered.
      panel.querySelectorAll('[data-aki-ext]').forEach((el) => {
        el.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(el.getAttribute('href'));
        };
      });

      autoClicker.bindRows(panel, config, syncAndSaveConfig);
      const rejectFolderCb = panel.querySelector(`#${AUTO_REJECT_PICK_FOLDER.checkboxId}`);
      if (rejectFolderCb) {
        rejectFolderCb.onchange = (e) => {
          config[AUTO_REJECT_PICK_FOLDER.configKey] = e.target.checked;
          syncAndSaveConfig();
        };
      }

      // Instruction is served natively read-only from the repo asset; the textarea is display-only (no save binding).
      const autoInjectCb = panel.querySelector('#aki-opt-auto-inject');
      if (autoInjectCb) {
        autoInjectCb.onchange = (e) => {
          config.autoInjectInstruction = e.target.checked;
          syncAndSaveConfig();
        };
      }
      const autoSummarizeCb = panel.querySelector('#aki-opt-auto-summarize');
      if (autoSummarizeCb) {
        autoSummarizeCb.onchange = (e) => {
          config.autoSummarize = e.target.checked;
          syncAndSaveConfig();
        };
      }
      const autoSummarizePctInput = panel.querySelector('#aki-opt-auto-summarize-pct');
      if (autoSummarizePctInput) {
        autoSummarizePctInput.onchange = (e) => {
          const pct = Math.round(Number(e.target.value));
          config.autoSummarizePct = Number.isFinite(pct) ? Math.min(100, Math.max(50, pct)) : 90;
          e.target.value = config.autoSummarizePct;
          syncAndSaveConfig();
        };
      }
    }

    const pinBtn = panel.querySelector('#aki-panel-pin');
    if (pinBtn) {
      pinBtn.type = 'button';
      const pinned = !!config.isPinned;
      if (pinBtn.classList.contains('is-pinned') !== pinned) {
        pinBtn.classList.toggle('is-pinned', pinned);
        pinBtn.innerHTML = akiPinIcon(pinned);
      }
      pinBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        config.isPinned = !config.isPinned;
        pinBtn.classList.toggle('is-pinned', config.isPinned);
        pinBtn.innerHTML = akiPinIcon(config.isPinned);
        syncAndSaveConfig();
      };
    }

    const liveMode = readPostmanAgentMode();
    const thinkingCb = panel.querySelector('#aki-opt-thinking');
    if (thinkingCb) {
      if (!window.__pmPendingAgentSwitch && thinkingCb.checked !== liveMode.thinking) {
        thinkingCb.checked = liveMode.thinking;
      }
      thinkingCb.onchange = (e) => {
        window.__pmPendingAgentSwitch = { kind: 'thinking', want: e.target.checked };
        applyPendingAgentSwitch();
      };
    }
    const autorunCb = panel.querySelector('#aki-opt-autorun');
    if (autorunCb) {
      if (!window.__pmPendingAgentSwitch && autorunCb.checked !== liveMode.autorun) {
        autorunCb.checked = liveMode.autorun;
      }
      autorunCb.onchange = (e) => {
        window.__pmPendingAgentSwitch = { kind: 'autorun', want: e.target.checked };
        applyPendingAgentSwitch();
      };
    }

    const modelRadios = panel.querySelectorAll('input[name="aki-model"]');
    const liveModelId = localStorage.getItem('ai-chat-last-selected-model');
    const liveLabel = currentModelLabelCheap();
    const liveIsAuto = looksAuto(liveLabel);
    const radioChecked = (m, isAuto, id, label) =>
      m.auto ? isAuto : (!isAuto && (m.id === id || (label && m.label === label)));
    modelRadios.forEach((radio) => {
      radio.checked = radioChecked(AKI_MODELS[radio.value], liveIsAuto, liveModelId, liveLabel);
      radio.onchange = async (e) => {
        await selectModel(AKI_MODELS[e.target.value]);
        const confirmed = await getCurrentModelSelection();
        const confirmedAuto = looksAuto(confirmed.modelText);
        const confirmedId = selectedModelId(confirmed);
        modelRadios.forEach((item) => {
          item.checked = radioChecked(AKI_MODELS[item.value], confirmedAuto, confirmedId, confirmed.modelText);
        });
      };
    });

    const sendBtn = panel.querySelector('#aki-btn-send-instruction');
    if (sendBtn && !window.__pmSendInFlight) {
      sendBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendAiPrompt(config.instruction);
      };
    }

    const summarizeChatBtn = panel.querySelector('#aki-btn-summarize-chat');
    if (summarizeChatBtn && !window.__pmSendInFlight) {
      summarizeChatBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.__cdpRequestSummarize === 'function') window.__cdpRequestSummarize('');
      };
    }

    const installBtn = panel.querySelector('#aki-btn-install-rule');
    if (installBtn) {
      installBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (installBtn.dataset.busy === '1') return;
        installBtn.dataset.busy = '1';
        const status = document.getElementById('aki-install-rule-status');
        if (status) {
          status.dataset.sticky = '';
          status.textContent = 'Installing...';
        }
        try {
          if (typeof window.__cdpInstallAkiRule === 'function') window.__cdpInstallAkiRule('');
          else if (status) {
            status.dataset.sticky = '1';
            status.textContent = 'Install binding not ready. Restart the daemon.';
            installBtn.dataset.busy = '';
          }
        } catch (err) {
          if (status) {
            status.dataset.sticky = '1';
            status.textContent = 'Error: ' + ((err && err.message) || err);
          }
          installBtn.dataset.busy = '';
        }
      };
    }

    const open = !!window.__pmAkiPanelOpen;
    if (open !== panel.classList.contains('aki-open')) {
      togglePanel(open);
    } else {
      const trigger = document.getElementById('aki-vertical-trigger');
      if (trigger) trigger.classList.toggle('aki-trigger-active', open);
    }
    renderStatusBarUsage();
    renderRuleStatus();
  }

  window.__pmRenderInstallRuleResult = function () {
    const panel = document.getElementById('aki-control-panel');
    if (!panel) return;
    const btn = panel.querySelector('#aki-btn-install-rule');
    const status = panel.querySelector('#aki-install-rule-status');
    const r = window.__pmInstallRuleResult || {};
    if (btn) btn.dataset.busy = '';
    if (!status) return;
    if (r.ok) {
      status.dataset.sticky = '';
      renderRuleStatus();
      return;
    }
    status.dataset.sticky = '1';
    status.textContent = r.msg || 'Failed';
    status.classList.add('aki-err');
  };

  // Lexical editor (contenteditable): a synthetic 'beforeinput' event is ignored (no getTargetRanges()), so this drives it via the native execCommand pipeline instead, then double-rAF-waits for Lexical's DOM reconciliation (not synchronous with this tick) before the button reads the typed state.
  async function typeChatText(input, text) {
    if (input && input.__lexicalEditor) {
      const ed = input.__lexicalEditor;
      input.focus();
      const insertCmd = Array.from(ed._commands.keys()).find((k) => (k && k.type) === 'CONTROLLED_TEXT_INSERTION_COMMAND' || String(k).includes('CONTROLLED_TEXT_INSERTION'));
      if (insertCmd) {
        ed.dispatchCommand(insertCmd, text);
      }
    } else {
      input.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(input);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  const HANDOFF_POLL_MS = 250;
  const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;
  const NEW_CHAT_BUTTON = '[data-testid="ai-chat-new-conversation-button"]';
  const AGENT_REPLY = '.ai-chat-message-group--last .ai-chat-agent-message';
  const AGENT_REPLY_NOISE = '[class*="thinking"], .ai-chat-agent-debug-message';

  // Stop showing or an approval card up means the agent is known busy and restarts the bound, so it runs out only on a step that stays unfinished while the agent is not busy, a sign the selectors no longer match Postman.
  function agentWorking() {
    return !!document.querySelector(CANCEL_BUTTON) || !!document.querySelector(PERMISSION_CARD_ROOT);
  }

  async function waitUntil(step, ready) {
    let deadline = Date.now() + HANDOFF_TIMEOUT_MS;
    while (!ready()) {
      if (agentWorking()) deadline = Date.now() + HANDOFF_TIMEOUT_MS;
      else if (Date.now() > deadline) throw new Error(`timed out waiting for ${step}`);
      await new Promise((r) => setTimeout(r, HANDOFF_POLL_MS));
    }
  }

  // Send and Stop are one switch in Postman, but Send also shows while the agent waits on a tool approval, where a submit would answer the card instead of sending.
  function agentIdle() {
    return !!document.querySelector(SEND_BUTTON) && !document.querySelector(PERMISSION_CARD_ROOT);
  }

  async function typeAndSubmitChat(input, text) {
    await typeChatText(input, text);
    await waitUntil('the agent to be idle and Send ready', () => agentIdle() && submitChatInput(input));
  }

  async function awaitReply() {
    await waitUntil('the agent to start replying', () => !agentIdle());
    await waitUntil('the agent to finish replying', agentIdle);
  }

  function lastAgentReplyText() {
    const replies = document.querySelectorAll(AGENT_REPLY);
    const reply = replies[replies.length - 1];
    if (!reply) return '';
    let text = reply.innerText || '';
    for (const noise of reply.querySelectorAll(AGENT_REPLY_NOISE)) text = text.replace(noise.innerText || '', '');
    return text.trim();
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.log('[⚡ AutoRun] Summarize handoff: clipboard copy failed: ' + e.message);
    }
  }

  // Owns the composer from the summarize prompt to the unsent paste; the caller holds __pmSendInFlight, so every loop step and button stands down until PASTE.
  async function summarizeHandoff(input, prompt, setLabel) {
    setLabel('WAITING FOR AGENT…');
    await typeAndSubmitChat(input, prompt);
    setLabel('SUMMARIZING…');
    await awaitReply();
    const summary = lastAgentReplyText();
    if (!summary) throw new Error('the summary reply was empty');
    await copyToClipboard(summary);
    setLabel('NEW CHAT…');
    const newChatBtn = document.querySelector(NEW_CHAT_BUTTON);
    if (!newChatBtn) throw new Error('the new-chat button is missing');
    press(newChatBtn);
    await waitUntil('the new chat', () => {
      const chat = document.querySelector(CHAT_ROOT);
      return !!chat && isChatEmpty(chat) && !!findChatInput();
    });
    if (config.autoInjectInstruction) {
      armedForNewChat = false;
      setLabel('SENDING INSTRUCTION…');
      await typeAndSubmitChat(findChatInput(), instructionPrefix() + '\n\n' + config.instruction);
      await awaitReply();
    }
    await typeChatText(findChatInput(), summary);
  }

  async function withChatLock(btnId, task) {
    if (window.__pmSendInFlight) return false;
    const input = findChatInput();
    if (!input) return false;
    window.__pmSendInFlight = true;
    const btn = document.getElementById(btnId);
    const oldLabel = btn ? btn.textContent : null;
    const setLabel = (label) => { if (btn) btn.textContent = label; };
    if (btn) btn.disabled = true;
    setLabel('SENDING…');
    try {
      await task(input, setLabel);
      return true;
    } catch (e) {
      console.log('[⚡ AutoRun] Chat send stopped: ' + e.message);
      return false;
    } finally {
      window.__pmSendInFlight = false;
      if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
    }
  }

  async function sendChatPrompt(text, btnId) {
    if (!text || !text.trim()) return false;
    return withChatLock(btnId, (input) => typeAndSubmitChat(input, text));
  }

  function sendAiPrompt(text) {
    return sendChatPrompt(instructionPrefix() + '\n\n' + text, 'aki-btn-send-instruction');
  }

  async function sendSummarizePrompt(text) {
    if (!text || !text.trim()) return false;
    return withChatLock('aki-btn-summarize-chat', (input, setLabel) => summarizeHandoff(input, text, setLabel));
  }

  window.__pmDeliverSummarizePrompt = function (text) { sendSummarizePrompt(text); };

  let armedForNewChat = false;
  function checkAndInjectInstruction() {
    if (!config.autoInjectInstruction || window.__pmSendInFlight) return;
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    const empty = chat && isChatEmpty(chat);
    if (!empty) { armedForNewChat = true; return; }
    if (!armedForNewChat) return;
    armedForNewChat = false;
    sendAiPrompt(config.instruction);
  }

  // Presses Summarize once per chat crossing the mark by less than the amber-to-red span (a bigger jump is a chat switch), only while idle; docs/plan/done/postman-auto-summarize.md decisions 1-2.
  let ctxPrev = null;
  let summarizePending = false;
  function autoSummarizeMark() {
    return Math.round((config.ctxCharRed || 150000) * (config.autoSummarizePct || 90) / 100);
  }
  function checkAutoSummarize() {
    const chars = readConversationChars();
    const prev = ctxPrev;
    ctxPrev = chars;
    const mark = autoSummarizeMark();
    if (!config.autoSummarize || chars < mark) { summarizePending = false; return; }
    const span = (config.ctxCharRed || 150000) - (config.ctxCharAmber || 80000);
    if (prev !== null && prev < mark && chars - prev < span) summarizePending = true;
    if (!summarizePending || window.__pmSendInFlight || !agentIdle()) return;
    const input = findChatInput();
    if (!input || (input.textContent || '').trim()) return;
    summarizePending = false;
    if (typeof window.__cdpRequestSummarize === 'function') window.__cdpRequestSummarize('');
  }

  const LOOP_INTERVAL_MS = 500;

  new PageLoop(LOOP_INTERVAL_MS, [
    ['startup', handleStartupSequence],
    ['widget', () => { renderAkiWidget(); positionAkiWidget(); }],
    ['context-bar', renderContextBar],
    ['agent-switch', applyPendingAgentSwitch],
    ['permission-cards', () => permissionClicker.tick(config)],
    ['auto-inject', checkAndInjectInstruction],
    ['auto-summarize', checkAutoSummarize],
  ]).start();
})();
