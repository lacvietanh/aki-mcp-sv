# Plan: instruction prompt 1.4.1

**Start:** 2026-08-11
**Shipped:** 2026-08-11
**Repo:** /Volumes/DEV/pj/aki-mcp-sv
**Generator:** `scripts/config-page.js` → `buildPrompt()`
**Cap:** ≤1500 chars (ChatGPT)
**Basis:** `docs/research/instruction-prompt-first-principles.md`, `docs/plan/done/instruction-prompt-minimal-override.md`, `docs/plan/done/improve-instructions-1.3.1.md`
**Target version:** 1.4.1

## Goal
Update residual-only prompt: rename `working.md` → `plan.md`, make plan creation dynamic, force path reply on create, strengthen MCP-over-sandbox priority. Keep density. No core-rule restatement.

## Changes applied

| Line | Change |
|------|--------|
| 3 | `working.md` → `plan.md`; dynamic (mutate/multi-step only; skip pure Q&A); reply path on create |
| 5 | `local paths=Aki MCP FS only; sandbox throwaway; after write read-back MCP` |

### Shipped wording

**Line 3:**
`Task (mutate/multi-step): confirm scope; plan $HOME/.aki/mcpsv/task/<id>/plan.md (live); reply path on create. Skip pure Q&A. <id>=short slug.`

**Line 5:**
`Repo: <REPO_ROOT>. local paths=Aki MCP FS only; sandbox throwaway; after write read-back MCP.`

## Checklist
- [x] Edit `buildPrompt()` lines 3 + 5
- [x] `node --check scripts/config-page.js`
- [x] CHANGELOG `[Unreleased]`
- [x] Move to `docs/plan/done/`
- [-] Measure default char count in panel (runtime). Not needed: the prompt became static (CHANGELOG 2.2.0 Removed).

## Non-goals
- No Grok/browser rule in shared prompt
- No restatement of akidevrule core
- No change to `DEFAULT_RULES` / UI lock of `index.md`
