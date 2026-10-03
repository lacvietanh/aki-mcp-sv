// Single-instance discipline: a second `akimcp` launch reuses the running instance's panel
// instead of racing it for the same ports and dying with a token 403 the user can't decode
// (docs/plan/done/2.0.0-improve.md follow-up). The lock file records enough for that second
// launch to find, verify, and — if it's an older version — replace the running instance.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { USER_DIR } from './userdata.js';

const LOCK_PATH = path.join(USER_DIR, 'instance.json');

export function readLock() {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// AIObox reads panelPort, token and origin from this file (docs/plan/IMPORTANT-akimcp-aiobox-contract.md): origin is the ingress this process serves in every mode, ingress.json only the panel's saved pick.
export function writeLock({ pid, panelPort, gatePort, token, version, origin = null, ingress = null }) {
  writeFileSync(LOCK_PATH, JSON.stringify({ pid, panelPort, gatePort, token, version, origin, ingress, startedAt: new Date().toISOString() }), { mode: 0o600 });
}

export function clearLock() {
  try { unlinkSync(LOCK_PATH); } catch {}
}

// SIGTERM first so the old instance tears down its own children (cloudflared, Postman daemon) cleanly; SIGKILL only if it doesn't exit within the grace period.
export async function killAndWait(pid, graceMs = 3000) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start > graceMs) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
