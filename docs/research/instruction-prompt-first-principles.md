# Instruction prompt — first-principles analysis of mandatory roots

Status: superseded 2026-10-04 · the paste-in prompt became static and two lines in 2.2.0 (CHANGELOG `[2.2.0]`), and the roots it kept now live in the `aki__akidevrule_context` description and server `instructions` (`docs/arch/rule-context-delivery.md`, the canonical target); kept as historical reasoning.

**Start time:** 2026-08-10

**Initial purpose:** Decide what *must* live in the pasteable MCP instruction prompt (`buildPrompt()` in `scripts/config-page.js`) versus what is already guaranteed by the force-loaded akidevrule core (`index.md`, `RULE-agent-behavior.md`, `RULE-coding.md`, `RULE-design-core.md` + router `akirule/SKILL.md`). Context: prior work (`docs/plan/done/instruction-prompt-improve.md`, shipped 1.2.0) fixed prefix-repetition and added the working.md workflow under ChatGPT's 1500-char cap, but left open the deeper question of residual failure modes (YAPPING, wrong tool selection, sandbox/real-FS confusion) that persist even when core rules are present. Constraints at the time: one prompt serves all clients (Claude, ChatGPT, Gemini, Grok); ChatGPT hard-caps at 1500 chars; workers/subagents inherit neither router nor conversation context.

## Strategy
Apply `METHOD-deep-think` (goal excavation → first principles → mandatory critique → simplification) to the prompt itself. Separate facts / real constraints / assumptions. Map every candidate line to either (a) a residual failure mode not covered by force-load, or (b) duplication of core — then delete the latter. Output the minimal set of roots that still force correct behavior.

## Checklist
- [x] Read force-load surface: `~/.claude/CLAUDE.md`, `~/.aki/akidevrule/{index,RULE-agent-behavior,RULE-coding,RULE-design-core}.md`, `~/.claude/skills/akirule/SKILL.md`
- [x] Read current generator: `scripts/config-page.js` `buildPrompt()` + prior plan `docs/plan/done/instruction-prompt-improve.md`
- [x] Goal excavation (ultimate = reduce interaction cost + raise behavioral reliability across clients)
- [x] First-principles decomposition (facts / constraints / assumptions / natural flow)
- [x] Critique pass (steelman minimalism, attack favored set, inversion, pre-mortem, second-order)
- [x] Derive five mandatory roots; draft 5-line override-only prompt; estimate char budget

## Result

### Goal chain
Immediate → compact, behavior-forcing prompt.  
Intermediate → every connected client uses the right MCP tools and obeys core rules without per-turn owner correction.  
Ultimate → **lower interaction cost + higher behavioral reliability**.  
Tension: “force tightly” vs “stay under 1500 chars”.

### Facts
- Core four files + router are force-loaded *only when the prompt tells the client to read them* (web clients have no harness `@` import).
- Observed residual failures even with rules present: YAPPING/padding, wrong tool (list_directory / search_files instead of find_path), mutate-before-confirm, sandbox write treated as “done”, lost task state across sessions.
- Prompt is the only pre-decision mechanism that can force behavior before the model chooses what to load.

### Real constraints
- ≤1500 characters (ChatGPT custom-instruction field).
- Heterogeneous clients (Claude large context; ChatGPT hard truncate; workers inherit nothing).
- Prompt is SSoT for cross-client behavior; every extra line costs attention and token budget.

### Assumptions rejected
- “Already in core → no need to mention” — false for residual failure modes (YAPPING still fires despite agent.§0).
- “More rules in the prompt = safer” — false; each non-load-bearing word is real cost under the cap and dilutes the force of the remaining lines.

### Natural correct flow (what the prompt must make automatic)
1. Read core rules at session start.
2. Answer dense; no padding.
3. Confirm scope before any mutation.
4. Select MCP tools correctly (find_path / search_content / run_cmd+cwd).
5. Persist task state to working.md for resume.
6. Distinguish sandbox vs real FS; read-back after write.

### Five mandatory roots

| # | Root | Why mandatory | Residual / not in core |
|---|------|---------------|------------------------|
| 1 | **Density force** | Token + attention are scarce; YAPPING is the highest-frequency observed failure | Keyword `DON'T YAPPING` activates stronger than a long citation of agent.A4/§0 |
| 2 | **Force-load core** | Web clients do not auto-`@import`; unread rules are null | Absolute paths + the four filenames + router path |
| 3 | **Scope gate** | Mutate-before-confirm is a one-way door with recovery cost | Explicit “confirm with me before edit” |
| 4 | **Tool selection** | Wrong tool = wasted round-trips + polluted context | find_path / search_content / run_cmd+cwd contract |
| 5 | **State + boundary** | Session death loses context; sandbox vs real FS is easy to confuse | working.md path + sandbox/read-back rule |

Everything else (SSoT, Rule of Three, comment budget, Result pattern, design laws…) already lives in the force-loaded core → **do not restate in the prompt**.

### Minimal forcing prompt (5 lines, override-only)

```
ALWAYS short dense on-point. DON'T YAPPING. Claim=evidence; search=citation.
Session start MCP "AkiMCP": read ~/.claude/CLAUDE.md + ~/.aki/akidevrule/{index,RULE-agent-behavior,RULE-coding,RULE-design-core}.md; follow all session. Router: ~/.claude/skills/akirule/SKILL.md.
Every task: confirm scope with me before edit; plan $HOME/.aki/mcpsv/task/<id>/working.md (update live). <id>=short slug.
Files: always find_path (1 call, whole tree ~0.2s) — never list_directory nor search_files. Text→search_content. git/ls/grep: run_cmd cwd=absolute under /Users/aki — never cd/-C.
Repo: /Volumes/DEV/pj/aki-mcp-sv — edit there. Sandbox tools write throwaway only; paths under /Users/aki use MCP FS only; after write, read back via MCP before done.
```

Estimated length with real template vars: ~950–1100 chars — comfortable under 1500 even with the four default rules expanded to full paths if needed.

### Verification
- Cross-checked against force-load text: every core behavior listed in agent.A4/§0/B1–B3, coding.B3/B4, design.A1/A2/A7/A8 is *not* restated; only residuals remain.
- Char budget is static estimate only — **unverified at runtime** until `buildPrompt()` is re-run with live `RULES_DIR`/`DATA_DIR`/`REPO_ROOT` values and the panel counter is observed.
- Residual-force claim for `DON'T YAPPING` is observational (owner correction frequency), not a controlled A/B; treat as high-confidence hypothesis, not proven causal.

### Corroborating links
- `docs/plan/done/instruction-prompt-improve.md` — prior compaction + working.md introduction (shipped 1.2.0).
- `~/.aki/akidevrule/RULE-agent-behavior.md` §0 / A4 / B1–B3 — density, penalty cards, scope, verification.
- `~/.aki/akidevrule/RULE-coding.md` B3 — Done = verified.
- `~/.aki/akidevrule/RULE-design-core.md` A1/A2/A7/A8 — deliberately *excluded* from prompt restatement.
- `~/.aki/akidevrule/METHOD-deep-think.md` — method used for this analysis.
- `scripts/config-page.js` `buildPrompt()` — current generator under redesign.

## Decision
**Action** → materialize as execution plan: `docs/plan/done/instruction-prompt-minimal-override.md`.

**Cross-references:** `docs/plan/done/instruction-prompt-improve.md` (predecessor), `docs/index.md` (to be updated when plan ships).
