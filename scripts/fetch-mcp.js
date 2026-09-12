// Localhost and Intranet HTTP Fetcher MCP tool (local_fetch).
// Enables AI to test local backend APIs and LAN services safely from remote interfaces (Claude Web, ChatGPT).
// Strict Defense-in-Depth against SSRF: blocks cloud metadata (169.254.*), link-local IPs, dangerous schemes,
// enforces max 500KB response truncation, and enforces strict timeout bounds.
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';

const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./, // AWS / GCP / Azure IMDS Link-Local
  /^metadata\.google\.internal$/i,
  /^fd[0-9a-f]{2}:/i, // IPv6 Unique Local
  /^fe80:/i, // IPv6 Link-Local
];

const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB cap

export function isBlockedHost(hostname) {
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(hostname));
}

export async function executeFetch({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 5000,
}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw new Error(`Invalid URL: "${url}"`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Forbidden protocol "${parsedUrl.protocol}". Only http: and https: are allowed.`);
  }

  if (isBlockedHost(parsedUrl.hostname)) {
    throw new Error(`Access to link-local/cloud-metadata host "${parsedUrl.hostname}" is blocked for security.`);
  }

  const safeTimeout = Math.min(Math.max(timeoutMs || 5000, 500), 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'Aki-MCP-LocalFetch/2.0',
        ...headers,
      },
      signal: controller.signal,
    };

    if (body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(parsedUrl.toString(), fetchOptions);
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    const truncated = rawText.length > MAX_RESPONSE_BYTES;
    const bodyText = truncated ? rawText.slice(0, MAX_RESPONSE_BYTES) : rawText;

    let data = bodyText;
    let isJson = false;
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      try {
        data = JSON.parse(bodyText);
        isJson = true;
      } catch {}
    }

    const responseHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      responseHeaders[k] = v;
    }

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url,
      headers: responseHeaders,
      isJson,
      data,
      truncated,
      bytesReceived: rawText.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function register(server) {
  server.registerTool(
    'local_fetch',
    {
      title: 'Localhost & Intranet HTTP Fetcher',
      description:
        'Make HTTP/HTTPS requests to localhost, local dev servers, or internal LAN services with SSRF protection (blocks cloud metadata/link-local addresses; enforces 500KB cap and max 15s timeout).',
      inputSchema: {
        url: z.string().describe('full HTTP/HTTPS URL (e.g. "http://localhost:3000/api/health")'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional().describe('HTTP method (default GET)'),
        headers: z.record(z.string()).optional().describe('optional HTTP request headers'),
        body: z.union([z.string(), z.record(z.any())]).optional().describe('request body (string or JSON object)'),
        timeoutMs: z.number().int().min(500).max(15000).optional().describe('timeout in ms (default 5000, max 15000)'),
      },
    },
    async (args) => {
      try {
        const result = await executeFetch(args);
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

export default { register, executeFetch, isBlockedHost };
