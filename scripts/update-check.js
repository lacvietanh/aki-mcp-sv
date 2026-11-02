// Update check for both aki-mcp-sv and akidevrule. Network failure degrades to "current known, latest unknown" — never throws, never blocks startup (coding.C1).
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { USER_DIR } from './userdata.js';
import ruleCore from './rule-version-core.cjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lives under this app's own USER_DIR — akidevrule's own data stays under ~/.aki directly (paths owned by rule-version-core.cjs).
const STATUS_PATH = path.join(USER_DIR, 'aki-mcp-status.json');
const REPO_MCP = 'lacvietanh/aki-mcp-sv';
const BRANCH_MCP = 'main';

const MCP_PKG_URL = `https://raw.githubusercontent.com/${REPO_MCP}/${BRANCH_MCP}/package.json`;

// The version logic and the rule install paths live in rule-version-core.cjs, shared with the Postman daemon; panel.js imports them from here.
const { fetchText, fetchLatestRuleVersion } = ruleCore;
export const { cmpSemver, getRuleStatus, RULE_DIR, RULE_SOURCE_FILE, RULE_CLONE_DIR, RULE_REPO_URL } = ruleCore;

function readLocalMcp() {
  try { return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || null; }
  catch { return null; }
}

// Local mcp version only — the rule branch is always built from getRuleStatus() directly (reads ~/.aki/akidevrule itself), never through this function.
export function getLocalVersions() {
  return { mcp: readLocalMcp() };
}

// { mcp:{current,latest,updateAvailable}, rule:{current,latest,updateAvailable,installed,unreleasedOnly,state} }. current is local (always attempted); latest is null on any network/parse failure; mcp.updateAvailable is only true when latest > current.
export async function checkForUpdate({ timeoutMs = 3000 } = {}) {
  const local = getLocalVersions();
  const [mcpPkg, ruleLatest] = await Promise.all([
    fetchText(MCP_PKG_URL, timeoutMs),
    fetchLatestRuleVersion(timeoutMs),
  ]);
  let mcpLatest = null;
  try { mcpLatest = mcpPkg ? (JSON.parse(mcpPkg).version || null) : null; } catch { mcpLatest = null; }
  const mcp = { current: local.mcp, latest: mcpLatest, updateAvailable: cmpSemver(local.mcp, mcpLatest) < 0 };
  return { mcp, rule: getRuleStatus(ruleLatest) };
}

// A convenience mirror the pasted instruction reads at session start (under ~/.aki = a locked allowed root), so a remote AI can tell the user its instruction is stale. Never fatal — the console/panel banners stand alone.
export function writeStatusFile(info) {
  try {
    writeFileSync(STATUS_PATH, `${JSON.stringify({ checkedAt: new Date().toISOString(), ...info }, null, 2)}\n`);
  } catch { /* best-effort */ }
}
