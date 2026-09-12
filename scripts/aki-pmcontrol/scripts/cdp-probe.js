#!/usr/bin/env node
/**
 * Read-only CDP DOM probe for the Aki Postman controller.
 *
 * Prints the exact DOM / localStorage contract that scripts/cdp-autoclicker.js depends on
 * (permission-card roots, chat container, model-menu button, settings button, send button,
 * agent-mode localStorage) for the CURRENT Postman build — so selector fixes are data-driven,
 * never guessed. It ONLY calls Runtime.evaluate (returnByValue); it clicks nothing, navigates
 * nothing, writes nothing.
 *
 * Usage (from the repo root, in a normal terminal):
 *   node scripts/aki-pmcontrol/scripts/cdp-probe.js
 *
 * Requires Postman to be running with the CDP flag (launch it from the Aki panel, which passes
 * --remote-debugging-port). To capture the toggle labels too, open the model dropdown and the
 * chat settings menu in Postman just before running, so their [role=menuitem] text is visible.
 */
const CDP = require('chrome-remote-interface');
const { PostmanSession } = require('./postman-session');

// Runs inside the Postman renderer. Kept self-contained (no closures) so Function.toString ships it whole.
function pageProbe() {
  const all = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const q = (s) => document.querySelector(s);
  const txt = (el) => ((el && (el.innerText || el.textContent)) || '').trim().slice(0, 80);
  const lsKeys = Object.keys(localStorage);
  const agentKeys = lsKeys.filter((k) => /agent|think|autorun|auto-?run|mode/i.test(k));
  const agentLs = {};
  agentKeys.forEach((k) => { agentLs[k] = localStorage.getItem(k); });

  // Heuristic scan for tool-approval UI regardless of exact class name, so a selector drift shows up even if
  // .tool-approval-wrapper / .tool-approval-single-item no longer match this build. Run the probe WHILE a
  // permission card ("Approve / Run / Continue ...") is on screen: matchedKnownRoot:false means the current
  // PERMISSION_CARD_ROOT no longer wraps the card, and cardClass/cardTestid reveal the correct new selector.
  const chatContainer = q('[data-testid="ai-chat-container"]');
  const approvalWord = /^(approve|allow|run|continue|accept|try again|reject|deny)$/i;
  const scanRoot = q('[data-testid="ai-chat-conversation-container"]') || chatContainer || document.body;
  const approvalButtons = Array.prototype.slice.call(scanRoot.querySelectorAll('button'))
    .filter((b) => approvalWord.test((((b.getAttribute('aria-label') || b.innerText || b.textContent)) || '').trim()))
    .slice(0, 12)
    .map((b) => {
      let card = b.closest('.tool-approval-wrapper, .tool-approval-single-item, .external-mcp-tool-approval, .ai-chat-loop-approval-message, [role="dialog"], [role="alertdialog"]');
      const matchedKnownRoot = !!card;
      if (!card) card = b.parentElement && b.parentElement.parentElement;
      return {
        button: (((b.getAttribute('aria-label') || b.innerText || b.textContent)) || '').trim().slice(0, 30),
        matchedKnownRoot,
        cardTag: card && card.tagName.toLowerCase(),
        cardClass: card && (card.getAttribute('class') || '').slice(0, 140),
        cardTestid: card && card.getAttribute('data-testid'),
      };
    });

  return {
    url: location.href,
    hasChatContainer: !!chatContainer,
    lastMessage: (() => {
      const msgs = all('.ai-chat-message, .ai-chat-agent-message');
      const last = msgs[msgs.length - 1];
      return last ? (last.innerText || '').slice(-400).replace(/\s+/g, ' ') : null;
    })(),
    approvalButtons,
    folderSearch: (() => {
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (/connect.*folder|local.*folder/i.test(node.textContent)) {
          results.push({ tag: node.parentElement.tagName, text: node.textContent.trim().slice(0, 100), class: node.parentElement.className });
        }
      }
      return results;
    })(),
    allChatButtons: chatContainer ? Array.from(chatContainer.querySelectorAll('button')).map((b) => ({
      text: txt(b),
      testid: b.getAttribute('data-testid'),
      aria: b.getAttribute('aria-label'),
      svg: b.querySelector('svg use, svg path') ? (b.querySelector('svg use')?.getAttribute('href') || b.querySelector('svg use')?.getAttribute('xlink:href') || 'has-path') : null
    })) : [],
    dialogs: all('[role="dialog"], [role="alertdialog"], .modal-dialog').map((d) => ({ class: String(d.className), text: txt(d) })),
    permissionRoots: {
      toolApprovalWrapper: all('.tool-approval-wrapper').length,
      toolApprovalSingleItem: all('.tool-approval-single-item').length,
      externalMcpToolApproval: all('.external-mcp-tool-approval').length,
      aiChatLoopApprovalMessage: all('.ai-chat-loop-approval-message').length,
      roleDialog: all('[role="dialog"]').length,
      roleAlertDialog: all('[role="alertdialog"]').length,
    },
    settingsButton: !!q('[data-testid="ai-chat-input-settings-button"]'),
    modelMenuButtons: all('[data-testid="aether-menu-button"][aria-haspopup="menu"]')
      .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 60)),
    sendButton: !!q('.ai-chat-input-send-button'),
    sendButtonDetail: (() => {
      const btn = q('.ai-chat-input-send-button');
      return btn ? {
        className: btn.className,
        disabled: btn.disabled,
        ariaDisabled: btn.getAttribute('aria-disabled'),
      } : null;
    })(),
    chatInput: !!q('[data-testid="ai-chat-input-editor"] [contenteditable="true"]'),
    inputDetail: (() => {
      const input = q('[data-testid="ai-chat-input-editor"] [contenteditable="true"]');
      return input ? { text: (input.innerText || '').trim() } : null;
    })(),
    openMenuItems: (() => {
      const chunks = window.rspackChunk_postman_app_renderer;
      if (!chunks) return [];
      const hits = [];
      for (const item of chunks) {
        const mods = item && item[1];
        if (!mods) continue;
        for (const mid of Object.keys(mods)) {
          let src = '';
          try { src = Function.prototype.toString.call(mods[mid]); } catch (e) { continue; }
          if (src.includes('ai-chat') && /try again/i.test(src)) {
            const idx = src.search(/try again/i);
            hits.push({ mid, context: src.slice(Math.max(0, idx - 150), idx + 250) });
            if (hits.length >= 3) break;
          }
        }
        if (hits.length >= 3) break;
      }
      return hits;
    })(),
    mcpLocalStorage: Object.keys(localStorage).filter(k => /mcp/i.test(k)).map(k => ({ key: k, value: localStorage.getItem(k)?.slice(0, 300) })),
    stats: window.__pmStats || null,
    agentModeSettingsRaw: localStorage.getItem('agentModeSettings'),
    agentLocalStorageKeys: agentKeys,
    agentLocalStorage: agentLs,
  };
}

async function main() {
  const port = PostmanSession.getDevToolsPort();
  let targets;
  try {
    targets = await CDP.List({ port });
  } catch (e) {
    console.error(
      `Cannot reach Postman DevTools on port ${port}. Launch Postman from the Aki panel ` +
      `(it adds --remote-debugging-port), then retry. Detail: ${e && e.message}`,
    );
    process.exit(1);
  }

  const pages = targets.filter((t) => t.type === 'page');
  const results = [];
  for (const t of pages) {
    let client;
    try {
      client = await CDP({ target: t.id, port });
      await client.Runtime.enable();
      if (process.argv.includes('--click') || process.argv.includes('--apply')) {
        const fs = require('fs');
        const path = require('path');
        const clickerCode = fs.readFileSync(path.join(__dirname, 'cdp-autoclicker.js'), 'utf8');
        await client.Runtime.evaluate({ expression: clickerCode });
        await new Promise((r) => setTimeout(r, 600));
      }

      if (process.argv.includes('--new-chat')) {
        await client.Runtime.evaluate({
          expression: `(() => {
            const btn = document.querySelector('button[data-testid="ai-chat-new-conversation-button"]');
            if (btn) { btn.click(); return true; }
            return false;
          })()`
        });
        await new Promise((r) => setTimeout(r, 1200));
      }

      const promptIdx = process.argv.indexOf('--prompt');
      if (promptIdx !== -1 && process.argv[promptIdx + 1]) {
        const text = process.argv[promptIdx + 1];
        await client.Runtime.evaluate({
          expression: `if (typeof window.__pmDeliverSummarizePrompt === 'function') window.__pmDeliverSummarizePrompt(${JSON.stringify(text)});`
        });
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (process.argv.includes('--autorun-off')) {
        await client.Runtime.evaluate({
          expression: `window.__pmPendingAgentSwitch = { kind: 'autorun', want: false };`
        });
        await new Promise((r) => setTimeout(r, 600));
      }

      if (process.argv.includes('--autorun-on')) {
        await client.Runtime.evaluate({
          expression: `window.__pmPendingAgentSwitch = { kind: 'autorun', want: true };`
        });
        await new Promise((r) => setTimeout(r, 600));
      }

      if (process.argv.includes('--enable-mcp')) {
        await client.Runtime.evaluate({
          expression: `(() => {
            try {
              const cfg = [{
                name: 'aki-mcp-sv',
                config: {
                  url: 'http://127.0.0.1:9999/mcp',
                  headers: {
                    Authorization: 'Bearer 7609abaf386b6ec8ded7271249ea1eb4dbbed0b6f4945887549aec4a2557285e'
                  }
                },
                enabled: true,
                disabledTools: []
              }];
              localStorage.setItem('mcpServersConfig', JSON.stringify(cfg));
              return true;
            } catch (e) { return false; }
          })()`
        });
        await new Promise((r) => setTimeout(r, 600));
      }

      if (process.argv.includes('--wait')) {
        const waitIdx = process.argv.indexOf('--wait');
        const ms = waitIdx !== -1 && Number(process.argv[waitIdx + 1]) ? Number(process.argv[waitIdx + 1]) : 3000;
        await new Promise((r) => setTimeout(r, ms));
      }
      const { result, exceptionDetails } = await client.Runtime.evaluate({
        expression: `(${pageProbe.toString()})()`,
        returnByValue: true,
      });
      if (exceptionDetails) results.push({ target: t.url, error: exceptionDetails.text });
      else results.push({ target: t.url, probe: result.value });
    } catch (e) {
      results.push({ target: t.url, error: e && e.message });
    } finally {
      if (client) { try { await client.close(); } catch (_) { /* ignore */ } }
    }
  }

  const chatPages = results.filter((r) => r.probe && r.probe.hasChatContainer);
  console.log(JSON.stringify({ port, pageTargets: pages.length, chatPages, allPages: results }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('probe failed:', e && e.message);
  process.exit(1);
});
