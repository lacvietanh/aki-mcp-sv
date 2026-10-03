// App-agnostic DevTools/CDP MCP tools (devtools_*). Thin envelopes over scripts/cdp-engine.js —
// they work against ANY Chromium/Electron app exposing a --remote-debugging-port (Chrome, Postman,
// VS Code, Slack, …). Postman-specific knowledge (selectors, named actions) lives in postman-mcp.js,
// not here. Served names are prefixed aki__ by tools-server.js.
import { z } from 'zod';
import { ok, okImage, fail } from './mcp-tool.js';
import cdp from './cdp-engine.js';
import { resolvePort } from './chrome-profile.js';

const NO_SESSION_HINT = 'A window not launched by aki__chrome_launch has no active session: find its port with aki__port_status first, then pass port. An AIObox window is reached by its handle (P#·W#) through aki__aiobox instead.';

// No detect: it also serves Postman, VS Code and AIObox's Chrome, so hiding it by "no session running" would hide it exactly when an attach needs it.
export const provider = { id: 'cdp', title: 'DevTools (CDP)', register };

export function register(server) {
  server.registerTool(
    'devtools_targets',
    {
      title: 'DevTools: list targets',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'List the CDP page targets on a Chromium/Electron remote-debugging endpoint (Chrome, Postman, VS Code, …). Provide port or omit to use active Chrome session. ' + NO_SESSION_HINT,
      inputSchema: {
        port: z.number().int().optional().describe('remote-debugging port (default: active Chrome session)'),
        host: z.string().optional().describe('default 127.0.0.1'),
      },
    },
    async ({ port, host }) => {
      try {
        const p = await resolvePort(port);
        const pages = (await cdp.listTargets({ host, port: p }))
          .filter((t) => t.type === 'page')
          .map((t) => ({ id: t.id, url: t.url, title: t.title }));
        return ok(JSON.stringify(pages, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'devtools_eval',
    {
      title: 'DevTools: evaluate JS',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Evaluate a JavaScript expression inside a page/renderer over CDP and return the serialized result (throws surface the page-side error). Optionally pick the target by a url/title substring (filter) or an exact targetId; default = first page. For Postman, aki__postman_eval finds its endpoint and main renderer itself. ' + NO_SESSION_HINT,
      inputSchema: {
        expression: z.string().describe('JS evaluated in the page; the last expression is returned (returnByValue)'),
        port: z.number().int().optional().describe('remote-debugging port (default: active Chrome session)'),
        filter: z.string().optional().describe('substring matched against "<url> <title>" to choose the target'),
        targetId: z.string().optional().describe('exact CDP target id (overrides filter)'),
        host: z.string().optional().describe('default 127.0.0.1'),
        awaitPromise: z.boolean().optional().describe('await a returned Promise before serializing (default true)'),
      },
    },
    async ({ port, expression, filter, targetId, host, awaitPromise }) => {
      try {
        const p = await resolvePort(port);
        const out = await cdp.evaluate({ host, port: p, expression, filter, target: targetId, awaitPromise: awaitPromise ?? true });
        return ok(JSON.stringify(out, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'devtools_screenshot',
    {
      title: 'DevTools: capture screenshot',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Capture a screenshot of a Chromium/Electron target page over CDP. Returns image directly in MCP response. ' + NO_SESSION_HINT,
      inputSchema: {
        port: z.number().int().optional().describe('remote-debugging port (default: active Chrome session)'),
        host: z.string().optional().describe('default 127.0.0.1'),
        filter: z.string().optional().describe('substring matched against "<url> <title>" to choose target'),
        targetId: z.string().optional().describe('exact CDP target id (overrides filter)'),
        format: z.enum(['png', 'jpeg']).optional().describe('image format (default png)'),
        quality: z.number().int().min(0).max(100).optional().describe('compression quality for jpeg (0-100)'),
      },
    },
    async ({ port, host, filter, targetId, format, quality }) => {
      try {
        const p = await resolvePort(port);
        const { data, mimeType } = await cdp.screenshot({ host, port: p, target: targetId, filter, format, quality });
        return okImage(data, mimeType);
      } catch (e) {
        return fail(e);
      }
    },
  );
}

export default { register };
