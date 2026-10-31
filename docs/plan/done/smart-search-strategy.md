# Smart search strategy — protocol + tool gaps

**Start:** 2026-08-10
**Status:** shipped 2026-08-10 — D2 (`-iE` in `searchContent`) + D1/D3 ladder in `docs/feat/tools.md`
**Predecessor / evidence:** live Claude Code sessions under `~/.claude/projects/-Volumes-DEV-Nodejs-aki-mcp-sv/` (esp. `cae18bd9-231b-4dea-9d6a-8bb022e42b2a.jsonl`); existing prompt tool-selection root (`docs/research/instruction-prompt-first-principles.md` root 4); `scripts/search-mcp.js`; prompt residual in `buildPrompt()`
**Task working:** `$HOME/.aki/mcpsv/task/learn-search-strategy/working.md`
**Revised:** 2026-08-10 — folded in external investigation-loop review (signal-expansion, relationship-chaining, absence-check); see D1.

---

## Goal

Make remote-model search on aki-mcp-sv match the efficiency shape Claude Code already uses locally: **one call, multi-alias, scoped, list-first, progressive** — without bloating the ≤1500-char instruction prompt or inventing a third search primitive.

Ultimate: fewer round-trips, less context pollution, higher hit rate on the first try.

---

## Facts (verified)

### Claude Code patterns (mined from jsonl)

Observed tool_use shapes in the aki-mcp-sv project sessions:

| Pattern | Example | Why it works |
|---|---|---|
| Extended multi-alias OR | `grep -rliE "cloudflare\|ingress\|alternative.*funnel\|thay.*funnel" docs/plan/ docs/research/` | One call covers EN + VI + synonym + partial phrase |
| List-files-only first | `-l` / `-rliE` | Cheap inventory before reading bodies |
| Scoped roots | `docs/plan/ docs/research/` not whole repo | Noise ↓, time ↓ |
| Batch probes | single Bash with `echo ===; grep -ciE …; grep -rliE …` | One round-trip for count + list |
| Suppress noise | `2>/dev/null` | Empty dirs do not abort the batch |
| Progressive narrow | broad alias set → then tighter path or exact term | Avoids re-scanning |

Claude Code pays for a full Bash because its native Grep is not the only path; the model invents the OR-regex and the scope in one shot.

### Current aki-mcp-sv search surface

| Tool | Strength | Gap vs Claude pattern |
|---|---|---|
| `find_path` | 1-call whole-tree (~0.2s), files **and** dirs, substring or glob, auto-skip build dirs | No content match; no multi-alias content |
| `search_content` | recursive content, optional `glob`, skip-dirs, limit | **No `-i`** (case-sensitive). **No `-E`** (BRE only — `\|` needed for OR, fragile). Single `-e query` only. No multi-root list in one call beyond the `path` arg |
| `run_cmd` + allowlisted `grep` | Can express full `-rliE "A\|B\|C" path1 path2` | Requires model to remember allowlist + absolute cwd rule; not the preferred path for text hunt |
| Prompt residual | Forces `find_path` → `search_content` → `run_cmd cwd=absolute`; bans `list_directory` / `search_files` | Correct contract, but does not teach *how* to compose multi-alias or progressive scope |

Code evidence (`scripts/search-mcp.js` `searchContent`):

```
args = ['-rnI', '--binary-files=without-match', …exclude-dir…]
if (glob) args.push(`--include=${glob}`)
args.push('-e', query, base)
```

No `-i`, no `-E`. A query containing `|` is literal in BRE unless the model writes `\|`.

### Investigation-loop shape (external review, 2026-08-10)

An external proposal framed search as a loop — hypothesis → evidence → narrow → verify, chaining concept → symbol → file → dependency → related symbol, closing with an absence check — illustrated with a `forwardToHub` / `MCP_HUB_PORT` example. That example is not hypothetical: it is this repo's own dead-code removal (`CHANGELOG.md`, `scripts/gatekeeper.js`, superseded by `streamable-bridge.js`) — reused below instead of inventing one. Two pieces are genuinely new versus D1 as first written; the rest (broad-then-narrow, cheap-first) the ladder already does:

| New piece | Gap in D1 as written | Folded into |
|---|---|---|
| Chain a hit to its next signal (symbol → caller → const → route) | old step 4 only tightens `path`/`glob`; does not follow a term found *inside* a hit | step 4, renamed "Follow the thread" |
| Verify absence before closing a decision-bearing search | Nowhere stated; a conclusion currently assumes "not found = doesn't exist" | new step 6, severity-gated (skip for quick lookups) |

### Residual failure modes already seen

From `docs/research/instruction-prompt-first-principles.md` and live use:
- Model still reaches for `list_directory` / walks one level (prompt already bans; filter for `search_files` is separate work in `improve-instructions-1.3.1`).
- Multi-concept hunt becomes N sequential `search_content` calls instead of one OR.
- Case mismatch misses (`Funnel` vs `funnel`).
- Over-broad path → token flood; under-scoped path → false “not found”.

---

## Decisions

### D1 — Protocol (doc + prompt residual only; no new tool)

Adopt a fixed search ladder the model must follow. Document it once; keep prompt line short.

**Ladder (order is load-bearing):**

1. **Orient + expand signals** — before the first call, turn the ask into 2–3 signals: the literal keyword, an obvious synonym/variant (EN+VI), a likely path/filename. Run `find_path` with the tightest one. One call. Prefer `path=` when the tree is known.
2. **Content, simple** — `search_content` with one precise query + optional `glob` + scoped `path`. Prefer this over shell.
3. **Content, multi-alias / case / OR** — either:
   - (preferred after D2) one `search_content` with extended/case-insensitive support, **or**
   - `run_cmd` `grep -rliE "a\|b\|c" <scoped dirs>` with `cwd` absolute under allowed roots. Never `cd`/`-C`.
4. **Follow the thread** — a hit is a new signal, not an endpoint. Read it, pull out the next term it names (a called function, a referenced constant, an imported path), repeat from step 2 with that term, scoped tighter. This is `concept → symbol → file → dependency → related symbol` on grep-only tools — no AST/LSP needed. Real instance, this repo: `forwardToHub` → `MCP_HUB_PORT` → `/messages` route → traced to `scripts/gatekeeper.js`, confirmed dead, removed.
5. **Progressive narrow** — if 2–4 return too much: tighten `path` or `glob` and re-call; do not dump full bodies into context. Ask for conclusion, not dump (`agent.A5`).
6. **Verify closure** — before stating a conclusion that will be *acted on* (not a quick lookup): run one more search confirming no other implementation/reference remains, and say so ("no other reference found under `<scope>`"). Severity-gated (`think.B5`), not mandatory on every call — skip for simple lookups.
7. **Batch independent lookups** in one turn (`agent.A2`).

**Non-goals for protocol:** do not teach `list_directory` walking; do not restore `search_files`; do not build a query-expansion engine — steps 1/4 are a one-sentence mental habit, not new tooling.

### D2 — Harden `search_content` (small code change, high leverage)

Make the default content search match the Claude shape without forcing shell:

| Change | Rationale |
|---|---|
| Add `-i` always (or default-on flag) | Case-insensitive is the common intent; explicit case-sensitive is rare |
| Add `-E` (extended regex) | Enables `a\|b\|c` or `a\|b\|c` cleanly; matches Claude `-E` |
| Keep single `query` string | Model composes the OR inside the string; no API break |
| Optional later: multi-`path` array | Nice-to-have; not required for v1 — model can call twice or use shell |

Ship behind the existing tool name; update tool description so the model sees “case-insensitive extended regex”.

### D3 — Where the protocol lives

| Surface | Action |
|---|---|
| `docs/feat/tools.md` | Add short “Search ladder” subsection under `search` — SSoT for humans + future audits |
| Instruction prompt (`buildPrompt`) | **Do not** expand the tool line beyond the existing residual. If anything, one extra token-class phrase only if measured under 1500 after D2 description change. Prefer tool-description force over prompt bloat |
| `docs/plan/` (this file) | Decision record; move to `done/` when D2 shipped + ladder verified |
| Research companion (optional) | If more jsonl mining is wanted later, write `docs/research/claude-code-search-patterns.md` as immutable event log; not required to ship D2 |

### D4 — Shell remains the escape hatch

Complex pipelines (count + list + head in one shot, multi-root, exclude globs grep does not express) stay on `run_cmd`. Protocol says: prefer `search_content` after D2; fall back to shell when the OR/scope still does not fit one query.

---

## Non-goals

- New MCP tool name or third search server.
- Fork of official filesystem MCP (already handled by filter plan in `improve-instructions-1.3.1`).
- Teaching the model to use `find` binary (blocked by design; `find_path` replaces it).
- Full-text index / sqlite / ripgrep dependency — keep `grep` + walk as now unless measured pain.
- Changing allowlist of shell just for search (grep is already in the read-only default set).

---

## Implementation checklist (execute later)

- [x] D2: patch `scripts/search-mcp.js` `searchContent` → `-rniIE` (adds `-i` + `-E`); tool description now states "case-insensitive extended regex" with an OR-alias example.
- [x] Manual verify: `funnel|ingress` under `docs/` returned 70 lines incl. case variants (`Funnel`) — no `run_cmd`.
- [x] Update `docs/feat/tools.md` with the ladder (D1/D3).
- [x] Re-measure: `buildPrompt()` uses a static residual string (config-page.js:363), not tool descriptions — no char change.
- [-] Optional: sample 2–3 more jsonl sessions for failure modes; append to research only if new shape appears. Not run: optional, and no new failure shape has been reported since the ladder shipped (2026-08-10).
- [x] Move this plan → `docs/plan/done/` + one-line index entry.

---

## Critique (steelman / attack)

- **Steelman “do nothing, only protocol doc”:** tool already works; prompt already forces the right names. Risk: model still cannot OR without shell, and shell is the higher-friction path → more wrong-tool calls.
- **Steelman “only enhance search_content”:** highest leverage, one file, no prompt growth. Risk: `-E` changes meaning of existing queries that used BRE metacharacters intentionally (rare in practice for this corpus).
- **Attack D2:** if clients cache tool schemas aggressively, description change alone may not retrain behavior until reconnect — acceptable; behavior change is in the binary flags.
- **Subtract first:** is multi-alias search needed at all? Yes — owner already demonstrated the Claude pattern as the desired intelligence; the gap is mechanical, not speculative.
- **Attack step 6 (verify closure):** mandatory absence-check on every search would double round-trips for trivial lookups — the exact anti-pattern D1 exists to avoid. Mitigated by severity-gating (`think.B5`): a quick "where is X" skips it, an "is Y still referenced anywhere" conclusion does not.

---

## Definition of done

- `search_content` is case-insensitive extended-regex by default.
- `docs/feat/tools.md` states the ladder in ≤15 lines.
- No prompt char regression past ChatGPT 1500.
- One live multi-alias search in a real session succeeds without `run_cmd`.
- A decision-bearing search states its absence-check explicitly (step 6); a quick lookup does not.

---

## Measured outcome (2026-08-10, this repo)

Honest before/after on the three axes the goal claims — measured, not asserted. Not every axis improved, and one moved the opposite way from the plan's framing.

| Axis | Before | After | Real verdict |
|---|---|---|---|
| **Round-trips** | 3-concept hunt = 3 `search_content` calls, or 1 call needing BRE `\|` escaping | 1 reliable call | **The actual win.** Each MCP call re-sends the whole conversation; N→1 cuts N× history re-send. This is where context/cost is saved — not in one result's size. |
| **Hit rate / correctness** | `funnel` case-sensitive → 27 lines, missed `Funnel` | `-i` → 66 lines | Old missed 39 lines → false "not found" risk. Clearest correctness win. |
| **BRE fragility** | forget `\|` → literal search `funnel|ingress` → 2 junk lines vs 34 | `|` is native ERE → 34 lines | Old path silently returned wrong/near-empty results → a *second* wasted round-trip to retry. |
| **Time** | 3 walks ≈ 22ms | 1 walk ≈ 7ms | **Negligible** at this tree size. Not a real lever here. |
| **Context per result** | narrow, fewer lines | OR + case-insens → *more* lines (66 vs 27) | **Not reduced — increased.** A single OR result is the union of all aliases; case-insensitive adds hits. Savings are fewer envelopes + fewer history re-sends, not smaller payloads. |

**Correction to the goal's "less context pollution":** true only in the sense of *fewer round-trips → fewer full-history re-sends*, not smaller per-call output. Per-result payload can grow. The load-bearing wins are **correct-on-first-try** (no case/BRE misses) and **one call instead of N**; the time saving is ~0 at this scale.
