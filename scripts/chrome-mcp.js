// Chromium Profile & Remote Automation MCP tools (chrome_*).
// Discovers profiles, opens or attaches to the shared CDP clones AIObox provisions (stealth Chrome on dynamic port 0),
// provides interactive typing & scroll-to-center clicking, tab management, and AI session probing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import {
  listProfiles,
  listInstalledBrowsers,
  listSharedProfiles,
  profilesRoot,
  launchChrome,
  stopChrome,
  resolvePort,
} from './chrome-profile.js';

// While AIObox runs it owns these clones: a Chrome opened here has no AIObox panel, guard or handle. Warn only until AIObox can open a stopped profile itself (plan/aiobox-control-ops.md O2), then refuse.
export function aioboxWarning() {
  if (!fs.existsSync(path.join(os.homedir(), '.aki', 'aiobox', 'cdp', 'windows.json'))) return null;
  return 'AIObox is running and owns these profiles: for a chat window use aki__aiobox_write op=new_window from a window of that profile (aki__aiobox op=state lists them); a Chrome opened here has no AIObox panel or handle.';
}

export const provider = {
  id: 'chrome',
  title: 'Chrome profiles & tabs',
  detect: () => (listInstalledBrowsers().length ? { available: true } : { available: false, reason: 'no Chromium browser installed (Chrome, Brave, Edge)' }),
  register,
};

export function register(server) {
  server.registerTool(
    'chrome_profiles',
    {
      title: 'Chromium: list installed browsers and profiles',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'List installed Chromium browsers (Chrome, Brave, Edge) and their profiles (name, email, folder ID) from Local State, plus shared clone ids for chrome_launch.',
      inputSchema: {
        browser: z.string().optional().describe('chrome, brave, or edge (default chrome)'),
      },
    },
    async ({ browser }) => {
      try {
        const browsers = listInstalledBrowsers();
        const b = browser || 'chrome';
        const profiles = listProfiles(b);
        return ok(JSON.stringify({ detectedBrowsers: browsers.map((x) => x.name), selectedBrowser: b, profiles, sharedRoot: profilesRoot(), sharedProfiles: listSharedProfiles() }, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_launch',
    {
      title: 'Chromium: open shared profile on a CDP port',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description:
        'Opens a shared profile clone made by AIObox (logins kept). If another process runs it, attaches to its CDP port (owned false) and opens url as a new tab; else launches stealth Chrome on --remote-debugging-port=0 (owned true). Never clones.',
      inputSchema: {
        profile: z.string().optional().describe('Profile 14 or shared id chrome-profile-14 (default Default)'),
        browser: z.string().optional().describe('chrome, brave, or edge (default chrome)'),
        url: z.string().optional().describe('URL to open (new tab on attach)'),
        headless: z.boolean().optional().describe('only for a new launch (default false)'),
      },
    },
    async ({ profile, browser, url, headless }) => {
      try {
        const res = await launchChrome(profile || 'Default', {
          browser,
          url,
          headless: headless ?? false,
        });
        const warning = aioboxWarning();
        return ok(JSON.stringify(warning ? { ...res, warning } : res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'chrome_tabs',
    {
      title: 'Chromium: manage tabs (list, open, close, activate)',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
        const p = await resolvePort(port);
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
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
        const p = await resolvePort(port);
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
    'chrome_stop',
    {
      title: 'Chromium: stop active or specified Chrome session',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Ends the active session: kills a Chrome this server launched (owned true), only forgets an attached one (owner keeps running). An explicit pid is always killed.',
      inputSchema: {
        pid: z.number().int().optional().describe('PID to kill (default: active session if owned)'),
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
