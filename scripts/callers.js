// Live callers of /mcp (docs/plan/done/client-activity-and-security-log.md, D2): memory only, bounded, fed after the Bearer check passes.
const MAX_CALLERS = 64;
const AGENT_MAX_CHARS = 64;

export function createCallers({ max = MAX_CALLERS, now = Date.now } = {}) {
  // Map insertion order is recency order: every hit deletes and re-inserts, so the first key is the least recently seen.
  const byKey = new Map();

  function recordCaller(key, agent) {
    const t = now();
    const prev = byKey.get(key);
    byKey.delete(key);
    // AIObox reads agent and lastSeen through GET /api/security (docs/plan/IMPORTANT-akimcp-aiobox-contract.md).
    byKey.set(key, {
      key,
      agent: [...String(agent ?? '')].slice(0, AGENT_MAX_CHARS).join(''),
      firstSeen: prev ? prev.firstSeen : t,
      lastSeen: t,
      requests: prev ? prev.requests + 1 : 1,
    });
    if (byKey.size > max) byKey.delete(byKey.keys().next().value);
    return !prev;
  }

  const listCallers = () => [...byKey.values()].map((c) => ({ ...c })).sort((a, b) => b.lastSeen - a.lastSeen);

  return { recordCaller, listCallers };
}

export const { recordCaller, listCallers } = createCallers();
