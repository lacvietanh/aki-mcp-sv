'use strict';
// Daemon-side wrapper. Two trigger points (main-process boot, this daemon's own start) share one fetch impl (rule-version-core.cjs fetchLatestRuleVersion) and write the same STATUS_PATH, so whichever ran last wins and the other side picks it up on its next disk read.

const path = require('path');
const fs = require('fs');
const core = require('../rule-version-core.cjs');
const { AKI_DATA_DIR } = require('./postman-data-paths.cjs');

const STATUS_PATH = path.join(AKI_DATA_DIR, 'aki-mcp-status.json');

// null before the main process has ever run checkForUpdate — getRuleStatus(null) then degrades to "current known, latest unknown".
function readMainProcessLatest() {
  try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'))?.rule?.latest ?? null; }
  catch { return null; }
}

function getLocalVersions() {
  const status = core.getRuleStatus(null);
  return { current: status.current, installed: status.installed, unreleasedOnly: status.unreleasedOnly };
}

function localSnapshot() {
  return { rule: core.getRuleStatus(readMainProcessLatest()) };
}

// Rebuilds the rule branch from disk so a post-install reload flips installed/unreleasedOnly/state without a network round-trip.
function refreshLocalVersions(updateInfo) {
  if (!updateInfo || !updateInfo.rule) return updateInfo;
  updateInfo.rule = core.getRuleStatus(readMainProcessLatest());
  return updateInfo;
}

// Merges `rule` into the shared status file without disturbing the `mcp` branch the main process owns.
function writeSharedRule(rule) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')); } catch { existing = {}; }
  const info = { checkedAt: new Date().toISOString(), mcp: existing.mcp ?? null, rule };
  try {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, `${JSON.stringify(info, null, 2)}\n`);
  } catch { /* best-effort, matches update-check.js writeStatusFile */ }
}

// Once per daemon start, never per Postman window/target. On fetch failure, falls back to whatever `latest` the status file already holds rather than downgrading it to unknown.
async function refreshFromNetwork(timeoutMs = 3000) {
  const fetched = await core.fetchLatestRuleVersion(timeoutMs, 'aki-postman-daemon').catch(() => null);
  const latest = fetched ?? readMainProcessLatest();
  const rule = core.getRuleStatus(latest);
  writeSharedRule(rule);
  return { rule };
}

module.exports = {
  getLocalVersions,
  localSnapshot,
  refreshLocalVersions,
  refreshFromNetwork,
};
