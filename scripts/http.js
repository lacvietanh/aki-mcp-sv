// Shared plumbing for the two HTTP front-ends; the static server is a security boundary, kept single-copy so its path-traversal guard can't diverge.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(PKG_ROOT, 'public');
// Font Awesome Free is an npm dependency served from node_modules, so the panel has no CDN dependency and works offline.
const FA_DIR = dirname(createRequire(import.meta.url).resolve('@fortawesome/fontawesome-free/package.json'));
const FA_URL = /^\/vendor\/fa\/(css\/all\.min\.css|webfonts\/[\w-]+\.woff2)$/;
const MIME = {
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.txt': 'text/plain; charset=utf-8',
};

// Rejects when the client aborts mid-body, and with statusCode 413 past maxBytes: every caller must catch.
export function readBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= maxBytes) return chunks.push(c);
      chunks.length = 0;
      reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function json(res, status, body, headers) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file) {
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export async function serveStatic(res, urlPath, aliases = {}) {
  const rel = normalize(aliases[urlPath] || urlPath).replace(/^([/\\.]+)/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + sep)) return false;
  return sendFile(res, file);
}

export async function serveFontAwesome(res, urlPath) {
  const match = FA_URL.exec(urlPath);
  return match ? sendFile(res, join(FA_DIR, match[1])) : false;
}
