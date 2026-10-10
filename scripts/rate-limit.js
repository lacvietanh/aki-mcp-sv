// Failure-only limiter for the public gatekeeper: a caller who keeps presenting rejected credentials is blocked for a while, a caller with valid credentials is never counted (docs/feat/security.md § Rate limiting).
import { readSettings } from './allowlist.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_KEY_LENGTH = 64;

export const LIMIT_DEFAULTS = {
  enabled: true,
  failMax: 5,
  failWindowSeconds: 60,
  blockMinutes: 15,
  registerMax: 100,
  registerWindowMinutes: 10,
  maxClients: 500,
};

const isCount = (v) => Number.isInteger(v) && v >= 1 && v <= 100000;

// Per-call read of setting.json, same as roots.js: a panel save applies to the next request. A malformed value falls back to its default.
export function readLimits() {
  const stored = readSettings().rateLimit;
  const limits = { ...LIMIT_DEFAULTS };
  if (!stored || typeof stored !== 'object') return limits;
  for (const [name, fallback] of Object.entries(LIMIT_DEFAULTS)) {
    const ok = typeof fallback === 'boolean' ? typeof stored[name] === 'boolean' : isCount(stored[name]);
    if (ok) limits[name] = stored[name];
  }
  return limits;
}

export function validateLimits(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('limits must be a JSON object');
  const limits = {};
  for (const [name, fallback] of Object.entries(LIMIT_DEFAULTS)) {
    const value = input[name];
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`);
    } else if (!isCount(value)) {
      throw new Error(`${name} must be a whole number from 1 to 100000`);
    }
    limits[name] = value;
  }
  return limits;
}

export function createLimiter({ settings, maxKeys = 10000, now = Date.now }) {
  const hits = new Map();
  const blocked = new Map();
  const cap = (map) => { if (map.size > maxKeys) map.delete(map.keys().next().value); };
  return {
    retryAfterSeconds(key) {
      const until = blocked.get(key);
      if (!until) return 0;
      if (until <= now() || !settings().enabled) { blocked.delete(key); return 0; }
      return Math.ceil((until - now()) / 1000);
    },
    // Returns true on the failure that starts a block.
    record(key) {
      const { enabled, max, windowMs, blockMs } = settings();
      if (!enabled) return false;
      const cutoff = now() - windowMs;
      const list = (hits.get(key) || []).filter((t) => t > cutoff);
      list.push(now());
      if (list.length >= max) {
        hits.delete(key);
        blocked.set(key, now() + blockMs);
        cap(blocked);
        return true;
      }
      hits.set(key, list);
      cap(hits);
      return false;
    },
    blockedList() {
      return [...blocked.keys()].map((key) => ({ key, retryAfterSeconds: this.retryAfterSeconds(key) })).filter((entry) => entry.retryAfterSeconds > 0);
    },
    release(key) {
      if (key === undefined) { hits.clear(); blocked.clear(); return; }
      hits.delete(key);
      blocked.delete(key);
    },
  };
}

export const failures = createLimiter({
  settings: () => {
    const l = readLimits();
    return { enabled: l.enabled, max: l.failMax, windowMs: l.failWindowSeconds * 1000, blockMs: l.blockMinutes * 60 * 1000 };
  },
});

export const registrations = createLimiter({
  settings: () => {
    const l = readLimits();
    const windowMs = l.registerWindowMinutes * 60 * 1000;
    return { enabled: l.enabled, max: l.registerMax, windowMs, blockMs: windowMs };
  },
});

// Tunnelled traffic arrives from loopback, so the key is the one header the running ingress writes itself (docs/feat/security.md § Rate limiting); any other header is client text there.
// A header key is caller-controlled: length-bounded here, rendered as text, never markup.
const OWN_EDGE = ['cf-connecting-ip', 'x-forwarded-for'];
const EDGE_HEADERS = { cloudflared: ['cf-connecting-ip'], funnel: ['x-forwarded-for'] };
let addressHeaders = OWN_EDGE;

export function useIngress(mode) {
  addressHeaders = EDGE_HEADERS[mode] ?? OWN_EDGE;
}

export function clientKey(req) {
  const peer = req.socket.remoteAddress || 'unknown';
  if (!LOOPBACK.has(peer)) return peer;
  let key = 'loopback';
  for (const name of addressHeaders) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) { key = value.split(',').pop().trim(); break; }
  }
  return key.slice(0, MAX_KEY_LENGTH) || 'loopback';
}
