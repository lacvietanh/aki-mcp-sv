// Chromium Profile & Remote Automation MCP tools (chrome_*).
// Discovers profiles, clones with zero lock conflict, launches stealth Chrome on dynamic port 0,
// provides interactive typing & scroll-to-center clicking, tab management, and AI session probing.
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import {
  listProfiles,
  listInstalledBrowsers,
  launchChrome,
  stopChrome,
  getActivePort,
  getActiveSession,
} from './chrome-profile.js';

function resolvePort(explicitPort) {
  const p = explicitPort || getActivePort();
  if (!p) {
    throw new Error('No CDP port specified and no active Chrome session. Launch one with aki__chrome_launch or provide port.');
  }
  return p;
}

export function register(server) {
  server.registerTool(
    'chrome_profiles',
    {
      title: 'Chromium: list installed browsers and profiles',
      description:
        'List installed Chromium browsers (Chrome, Brave, Edge) and their profiles (name, email, folder ID) by inspecting Local State.',
      inputSchema: {
        browser: z.string().optional().describe('chrome, brave, or edge (default chrome)'),
      },
    },
    async ({ browser }) => {
      try {
        const browsers = listInstalledBrowsers();
        const b = browser || 'chrome';
        const profiles = listProfiles(b);
        return ok(JSON.stringify({ detectedBrowsers: browsers.map((x) => x.name), selectedBrowser: b, profiles }, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_launch',
    {
      title: 'Chromium: launch cloned stealth profile on dynamic port',
      description:
        'Clones a real profile (preserving Keychain/DPAPI logins and cookies without touching the live browser), purges locks, and launches stealth Chrome with --remote-debugging-port=0.',
      inputSchema: {
        profile: z.string().optional().describe('profile folder id like Default or Profile 1 (default Default)'),
        browser: z.string().optional().describe('chrome, brave, or edge (default chrome)'),
        url: z.string().optional().describe('initial URL to open'),
        refresh: z.boolean().optional().describe('force re-sync clone from source profile (default false)'),
        headless: z.boolean().optional().describe('run in headless mode (default false)'),
      },
    },
    async ({ profile, browser, url, refresh, headless }) => {
      try {
        const res = await launchChrome(profile || 'Default', {
          browser: browser || 'chrome',
          url,
          refresh: refresh ?? false,
          headless: headless ?? false,
        });
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_tabs',
    {
      title: 'Chromium: manage tabs (list, open, close, activate)',
      description:
        'Manage page tabs on the active Chrome session or target port. Supports listing open tabs, opening new URL, closing, and activating a tab.',
      inputSchema: {
        action: z.enum(['list', 'open', 'close', 'activate']).optional().describe('action to perform (default list)'),
        url: z.string().optional().describe('URL to open when action is open'),
        targetId: z.string().optional().describe('target ID to close or activate'),
        port: z.number().int().optional().describe('CDP port (default: active session port)'),
      },
    },
    async ({ action = 'list', url, targetId, port }) => {
      try {
        const p = resolvePort(port);
        if (action === 'open') {
          const tab = await cdp.openTab({ port: p, url: url || 'about:blank' });
          return ok(JSON.stringify({ opened: true, tab }, null, 2));
        }
        if (action === 'close') {
          if (!targetId) throw new Error('close action requires targetId');
          const res = await cdp.closeTab({ port: p, targetId });
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === 'activate') {
          if (!targetId) throw new Error('activate action requires targetId');
          const res = await cdp.activateTab({ port: p, targetId });
          return ok(JSON.stringify(res, null, 2));
        }
        // action === 'list'
        const targets = await cdp.listTargets({ port: p });
        const pages = targets
          .filter((t) => t.type === 'page')
          .map((t) => ({ id: t.id, title: t.title, url: t.url }));
        return ok(JSON.stringify({ port: p, pages }, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_interact',
    {
      title: 'Chromium: interact with DOM element (click or type)',
      description:
        'Interacts with a web page: "click" scrolls the element into center view before clicking; "type" dispatches synthetic input and change events so React/Vue/SPA forms accept the value.',
      inputSchema: {
        action: z.enum(['click', 'type']).describe('interaction type'),
        selector: z.string().describe('CSS selector of the target element'),
        text: z.string().optional().describe('text to type (required for type action)'),
        clear: z.boolean().optional().describe('clear existing value before typing (default false)'),
        enter: z.boolean().optional().describe('dispatch Enter key after typing (default false)'),
        targetId: z.string().optional().describe('optional CDP target ID'),
        port: z.number().int().optional().describe('CDP port (default: active session port)'),
      },
    },
    async ({ action, selector, text, clear, enter, targetId, port }) => {
      try {
        const p = resolvePort(port);
        if (action === 'click') {
          const res = await cdp.click({ port: p, target: targetId, selector });
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === 'type') {
          if (text === undefined) throw new Error('type action requires text parameter');
          const res = await cdp.type({
            port: p,
            target: targetId,
            selector,
            text,
            clear: clear ?? false,
            enter: enter ?? false,
          });
          return ok(JSON.stringify(res, null, 2));
        }
        throw new Error(`unknown action: ${action}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_probe_ai',
    {
      title: 'Chromium: probe AI quota and session (Claude, ChatGPT, Grok)',
      description:
        'Probes the active web tab for AI service login state and rate limits (supports claude.ai /api/organizations + /usage, chatgpt.com /backend-api/wham/usage, grok.com /rest/rate-limits).',
      inputSchema: {
        targetId: z.string().optional().describe('optional CDP target ID (default: auto-detects AI tab)'),
        port: z.number().int().optional().describe('CDP port (default: active session port)'),
      },
    },
    async ({ targetId, port }) => {
      try {
        const p = resolvePort(port);
        const res = await cdp.probeAi({ port: p, target: targetId });
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_stop',
    {
      title: 'Chromium: stop active or specified Chrome session',
      description: 'Terminates the spawned Chromium process and cleans up active session state.',
      inputSchema: {
        pid: z.number().int().optional().describe('process PID to kill (default: active session PID)'),
      },
    },
    async ({ pid }) => {
      try {
        const res = stopChrome({ pid });
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

export default { register };
