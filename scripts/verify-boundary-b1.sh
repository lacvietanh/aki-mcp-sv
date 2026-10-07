#!/usr/bin/env bash
# Mac handoff check for B1 of docs/plan/akimcp-aiobox-boundary-plan.md (steps: docs/plan/boundary-handoff-mac.md); the dev box ran the full suite green; here it is confirmed on macOS.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AIOBOX_REPO="${AIOBOX_REPO:-$REPO_ROOT/../aiobox}"
CONTRACT="docs/plan/IMPORTANT-akimcp-aiobox-contract.md"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

cd "$REPO_ROOT"

echo "== 1/4: shared contract is byte-identical in both repos =="
[ -f "$AIOBOX_REPO/$CONTRACT" ] || fail "aiobox repo not found at $AIOBOX_REPO (set AIOBOX_REPO=<path>)"
ours="$(shasum -a 256 "$CONTRACT" | cut -d' ' -f1)"
theirs="$(shasum -a 256 "$AIOBOX_REPO/$CONTRACT" | cut -d' ' -f1)"
[ "$ours" = "$theirs" ] || fail "$CONTRACT differs between aki-mcp-sv ($ours) and aiobox ($theirs) — the aiobox copy is the source; copy it over, never edit this one"
echo "ok $ours"

echo "== 2/4: node --check on every script and test =="
for f in scripts/*.js test/*.test.js; do node --check "$f" || fail "syntax error in $f"; done

echo "== 3/4: npm ci =="
npm ci || fail "npm ci failed"

echo "== 4/4: npm test =="
npm test || fail "npm test failed — fix against plan §4 I1/I2/I4, stop and report if the plan cannot hold"

echo
echo "== Automated layers passed. Manual checks no test covers (AIObox A1 installed, AkiMCP started from this working tree) =="
cat <<'EOF_MANUAL'
  (a) aki__aiobox op=state returns running, the guide and the op table; with AIObox quit it still answers, running:false.
  (b) A window op (op=read window=<handle>) and a request op (aki__aiobox_write op=new_window) both reach AIObox and answer.
  (c) An op missing from the table answers unknown_op with the list of names; a write op on aki__aiobox answers wrong_tool.
  (d) curl -H "x-panel-token: <token from ~/.aki/mcpsv/instance.json>" http://127.0.0.1:<panelPort>/api/access-token returns {accessToken}; without the header, 403.
  (e) On a machine without ~/.aki/aiobox, tools/list has no aiobox tool and akidevrule_context shows only the one-line AIObox pitch.
EOF_MANUAL
