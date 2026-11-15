# akiflow council session — ingress UX, standalone packaging, .env config (v0.18 prep)

**Start time:** 2026-08-15

**Initial purpose:** Execute three existing `docs/plan/` design docs (`ingress-setup-ux.md`, `standalone-packaging.md`, `env-file-configuration.md`) as real shipped code under an akiflow council, ahead of a planned v0.18 release. The council ran with a standing lint-supervisor seat active before and after every maker's coding turn, and an independent final reviewer spawned only after all makers reported done. A follow-on round added a 2-round adversarial UX audit of the full repo-entry-to-config-panel flow, triggered by the owner flagging Step 0 as weak. Full requirement ledger and per-item rationale: the council room's own checklist (see Cross-references).

## Strategy
Multi-seat akiflow council: makers implement one plan doc each, declaring target files in the room first to avoid collisions; a `conduct-lint` seat runs `scythe.py`-backed lint passes before/after every maker turn; a `challenger-final` seat reconciles the merged diff against the original prompt only after every maker reports done. A separate `judge-ux`/persona-walkthrough seat ran a pre-release gate, escalated to a 10-round adversarial debate (`judge-ux-2` vs `challenger-ux`) per an owner mid-run instruction. A second, later round (`judge-entry-ux` vs `challenger-entry-ux`) re-audited the same flow after a new Option 3 feature landed, converging in 3 rounds each per akiflow's peer law.

## Checklist
- [x] I1 — `ingress-setup-ux.md` executed: Section 0 rebuilt as a 3-tab ingress picker
- [x] I2 — `standalone-packaging.md` executed: portable-Node build script added
- [x] I3 — `env-file-configuration.md` executed: native `.env` loading wired in
- [x] I4 — lint supervision logged across every maker turn (2 PASS rounds, all 3 makers' diffs)
- [x] I5 — pre-release persona UX audit, escalated to a 10-round adversarial debate, re-closed
- [x] I6 — independent final review reconciling the merged diff against the original prompt
- [x] I8 — Option 3 (ingress tab 3) rebuilt as a real domain-purchase-request UX + footer utm/style cleanup
- [x] I9 — round-2 adversarial UX audit (repo entry through panel Step 0-4), fix pass shipped
- [-] I7 — release v0.18 — NOT executed, explicitly blocked by the owner

## Result
Three plan docs shipped as code, plus two feature/UX rounds the owner requested mid-session; the release itself did not run.

- **I1** — Section 0 became a 3-tab ingress picker (Tailscale + Funnel / Owned public origin / a third tab), reusing the existing `.tabs`/`.tab`/`.tabpane` pattern; the akitao/contact link was re-grepped and confirmed unchanged.
- **I2** — `scripts/build/package.js` added: bundles a portable Node binary, `node_modules`, and app code into a per-OS archive for Node-less client machines; `npm ci` runs at build/CI time only, never at client runtime. Known gap: Windows/Linux archives have not actually been built or tested — only the macOS path is verified — deferred to the release gate (I7).
- **I3** — all 4 implementation steps done: `.gitignore` rule for `.env*`, `.env.example` created, `process.loadEnvFile?.()` wired into `scripts/start.js` (wrapped in try/catch after the maker caught a plan-vs-reality gap — a bare call throws `ENOENT` when no `.env` file exists), README/docs updated. Default Tailscale flow is unaffected when `.env` is absent (fail-silent).
- **I5** — a 10-round persona/adversarial UX audit found 6 HIGH-severity issues: 4 were fixed (dead-end docs/copy issues), 1 (a 3-way version mismatch) was escalated to and answered by the owner directly, 1 (a Gatekeeper risk) was converted into a documented mitigation in the README.
- **I8** — tab 3 (originally "aiobox.app", relabeled "Hosted domain") became a real domain-purchase-request UI: a 4-TLD dropdown (akitao.com $24/yr, akinet.me $19/yr, aiobox.app $12/yr, akimcp.cfd $5/yr default-selected as cheapest), a free-text subdomain input, and a submit button that opens a prefilled Messenger contact link in a new tab. This supersedes the original `ingress-setup-ux.md` assumption that tab 3 would integrate with a separate, not-yet-designed "aiobox" project service — no such external integration exists or is planned; the flow is built entirely in this repo. Footer links also gained a shared `withUtm()` helper carrying `?utm_source=aki-mcp-sv-footer` (mailto excluded), and `.eco-icon`'s background/padding box styling was removed.
- **I9** — a second adversarial UX round found 1 HIGH (Step 0's done-badge was unconditional, contradicting the live Tailscale state shown on the same screen — fixed: the badge is now conditional on `origin`) and 4 MEDIUM issues (a value-prop sentence for Option 3, tab label relabeling with the internal `data-tab`/id wiring kept unchanged as load-bearing, an outbound-link marker on the Messenger submit button, and a caption clarifying the 2 distinct Messenger accounts in use). All 5 were fixed and independently re-verified.
- **I7** — **not done.** Actual git init / GitHub Release / tag / push never ran. Explicitly BLOCKED: the owner said not to release yet. No release artifact was created or pushed anywhere. This is not implied-done by any other item's closure above.

### Verification
Every item's closing rationale (lint-pass logs, re-grep confirmations, independent re-verification counts) is recorded in the council room's own checklist, which is the authoritative record for this session — not restated here in full to avoid drift between two copies of the same finding. This doc's own summary is corroborated against that checklist, not against a separate independent check.

### Corroborating links
- Council room: `/Users/aki/.aki/agent-council/aki/2026.08.15-0039-aki-mcp-sv-release-018/` — the full room transcript.
- `/Users/aki/.aki/agent-council/aki/2026.08.15-0039-aki-mcp-sv-release-018/checklist.md` — the requirement ledger (REQ-1..18) and every item's full closing rationale, the safest source for item-by-item detail.

## Decision
**Action** → `docs/plan/done/ingress-setup-ux.md`, `docs/plan/done/standalone-packaging.md`, `docs/plan/done/env-file-configuration.md` (moved from `docs/plan/`, Status/Decision updated to record what actually shipped); `README.md` (stale "aiobox.app" tab-3 description corrected); `scripts/config-page.js` (I1/I8/I9 code, not touched by this doc-closure pass).

**No action** → v0.18 release (I7): the owner explicitly withheld the go-ahead ("chưa release vội"). CHANGELOG.md, GitHub Release, tag, and push all remain untouched pending that go-ahead.

**Cross-references:** `docs/plan/done/ingress-setup-ux.md`, `docs/plan/done/standalone-packaging.md`, `docs/plan/done/env-file-configuration.md` — the three closed plans this session executed; `docs/index.md` — updated to point at the relocated `env-file-configuration.md`.
