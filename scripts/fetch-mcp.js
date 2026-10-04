// Localhost and Intranet HTTP Fetcher MCP tool (local_fetch).
// Enables AI to test local backend APIs and LAN services safely from remote interfaces (Claude Web, ChatGPT).
// Strict Defense-in-Depth against SSRF: blocks cloud metadata (169.254.*), link-local IPs, dangerous schemes,
// re-checks every redirect hop, stops reading a response at 512KB, and enforces strict timeout bounds. A DNS name that resolves to a blocked address is not caught.
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';

const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./, // AWS / GCP / Azure IMDS Link-Local
  /^metadata\.google\.internal$/,
  /^fe[89ab][0-9a-f]:/, // IPv6 Link-Local fe80::/10
  /^fd00:ec2::254$/, // AWS IMDS over IPv6; the rest of fc00::/7 stays open, it is where a tailnet and a home LAN live
  /^::ffff:a9fe:/, // 169.254.0.0/16 written as an IPv4-mapped IPv6 address
];

const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB cap
const MAX_REDIRECTS = 5;

// URL.hostname keeps the brackets of an IPv6 literal and may carry a trailing dot; both would slip past the patterns.
export function isBlockedHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(host));
}

function checkedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Forbidden protocol "${parsed.protocol}". Only http: and https: are allowed.`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Access to link-local/cloud-metadata host "${parsed.hostname}" is blocked for security.`);
  }
  return parsed;
}

// Stops reading at the cap, so a large or endless response costs 512 KB of memory, not its full size.
async function readCapped(res) {
  if (!res.body) return { text: '', bytes: 0, truncated: false };
  const chunks = [];
  let bytes = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated: false };
    chunks.push(value);
    bytes += value.length;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { text: Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf8'), bytes, truncated: true };
    }
  }
}

export async function executeFetch({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 5000,
}) {
  let target = checkedUrl(url);

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

    // Redirects are followed by hand so every hop passes the same host check as the first URL.
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(target, { ...fetchOptions, redirect: 'manual' });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      await res.body?.cancel();
      if (hop === MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
      const next = checkedUrl(new URL(location, target).toString());
      if (next.origin !== target.origin) fetchOptions.headers = { 'User-Agent': fetchOptions.headers['User-Agent'] };
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && fetchOptions.method === 'POST')) {
        fetchOptions.method = 'GET';
        delete fetchOptions.body;
      }
      target = next;
    }
    const contentType = res.headers.get('content-type') || '';
    const { text: bodyText, bytes, truncated } = await readCapped(res);

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
      url: target.toString(),
      headers: responseHeaders,
      isJson,
      data,
      truncated,
      bytesReceived: bytes,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const provider = { id: 'fetch', title: 'Local HTTP fetch', register };

export function register(server) {
  server.registerTool(
    'local_fetch',
    {
      title: 'Localhost & Intranet HTTP Fetcher',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
