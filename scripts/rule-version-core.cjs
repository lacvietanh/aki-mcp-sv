'use strict';
// SSoT for akidevrule version parsing/compare/classification, shared by the ESM checker (scripts/update-check.js) and the CommonJS Postman daemon checker (scripts/postman/postman-rule-update-check.cjs); kept .cjs so both module systems require/import the same file instead of drifting copies.

const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

const RULE_DIR = path.join(os.homedir(), '.aki', 'akidevrule');
// Install rules (panel.js installRules, the Postman daemon's own copy): a clone the owner pointed at in .source-repo, else ours in RULE_CLONE_DIR.
const RULE_SOURCE_FILE = path.join(RULE_DIR, '.source-repo');
const RULE_CLONE_DIR = path.join(os.homedir(), '.aki', 'akidevrule-src');
const RULE_REPO_URL = 'https://github.com/lacvietanh/akidevrule.git';
const RULE_CHANGELOG = path.join(RULE_DIR, 'CHANGELOG.md');
const RULE_INDEX = path.join(RULE_DIR, 'index.md');
const RULE_CHANGELOG_URL = 'https://raw.githubusercontent.com/lacvietanh/akidevrule/master/CHANGELOG.md';

// First `## [x.y.z]` heading, skipping `[Unreleased]` — akidevrule has no version field, so its CHANGELOG is the SSoT.
function parseChangelogVersion(text) {
  const m = text && text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}

// -1 / 0 / 1 for a<b / a==b / a>b on 3-part numeric semver. An unknown side yields 0 (no update claim).
function cmpSemver(a, b) {
  if (!a || !b) return 0;
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Installed if either the changelog or the index landed under ~/.aki/akidevrule.
function isRuleInstalled() {
  return fs.existsSync(RULE_CHANGELOG) || fs.existsSync(RULE_INDEX);
}

// A dev clone whose CHANGELOG has only an `[Unreleased]` buffer (no released heading yet).
function isUnreleasedOnly(text) {
  return !!(text && !parseChangelogVersion(text) && /^##\s*\[Unreleased\]/m.test(text));
}

// missing (not installed) · ahead (unreleased-only / local > latest) · unknown (no latest) · update (latest > local) · current (equal).
function classifyRule(rule) {
  if (!rule.installed) return 'missing';
  if (rule.unreleasedOnly) return 'ahead';
  if (!rule.latest) return 'unknown';
  if (rule.updateAvailable) return 'update';
  if (rule.current && cmpSemver(rule.current, rule.latest) > 0) return 'ahead';
  if (rule.current && rule.latest && cmpSemver(rule.current, rule.latest) === 0) return 'current';
  return 'unknown';
}

// current is null when the corpus isn't installed.
function getRuleStatus(latest = null) {
  let text = null;
  try { text = fs.readFileSync(RULE_CHANGELOG, 'utf8'); } catch { text = null; }
  const current = parseChangelogVersion(text);
  const rule = {
    current,
    latest,
    updateAvailable: cmpSemver(current, latest) < 0,
    installed: isRuleInstalled(),
    unreleasedOnly: isUnreleasedOnly(text),
  };
  rule.state = classifyRule(rule);
  return rule;
}

// Never throws — a network/timeout/non-200 failure resolves to null, so callers degrade gracefully.
function fetchText(url, timeoutMs, redirectsLeft = 3, userAgent = 'aki-mcp-sv') {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': userAgent } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return done(fetchText(new URL(res.headers.location, url).toString(), timeoutMs, redirectsLeft - 1, userAgent));
      }
      if (res.statusCode !== 200) { res.resume(); return done(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      res.on('error', () => done(null));
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

// Shared by every caller (main-process boot, Postman daemon start) so a fetch-mechanic change never needs a second edit.
async function fetchLatestRuleVersion(timeoutMs = 3000, userAgent = 'aki-mcp-sv') {
  const text = await fetchText(RULE_CHANGELOG_URL, timeoutMs, 3, userAgent);
  return parseChangelogVersion(text);
}

module.exports = {
  RULE_DIR, RULE_SOURCE_FILE, RULE_CLONE_DIR, RULE_REPO_URL,
  cmpSemver, getRuleStatus,
  fetchText, fetchLatestRuleVersion,
};
