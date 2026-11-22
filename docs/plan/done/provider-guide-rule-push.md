# Provider Guide Rule Push (`aiobox_write` Call-Entry Gate)

> Tool names here use `aki__` by default (`scripts/mcp-name.js`).

- **Status:** Done (2026-11-22 — commit `84741c7`, Post-Implementation Audit Round 2 `PASS` / 0 Blocking, 0 Nit via `/akithink` deep 4 rounds by Challenger `P59·W7`)
- **Date:** 2026-11-21
- **Owner / Order:** Owner 15:55 (via AGY Coordinator AIObox & Challenger `P58·W21` `/akithink` deep 4 rounds; pre-impl audit Round 1 `PASS WITH FIXES` `/akithink` deep 5 rounds [B1–B3 + N1–N3] by Challenger `P59·W7`, approved by Lead `P59·W2`)
- **Target Repo:** `aki-mcp-sv/`

---

## 0. Pre-Implementation Audit Ruling (`P59·W7` `/akithink` Deep 5 Rounds: B1–B3 + N1–N3 + M-check 2 Option A)

- **[x] [B1 — CRITICAL SECURITY — DO NOT widen `globalZones` to `~/.aki`]:**
  - Keep `globalZones = [pathApi.join(homeDir, '.claude'), pathApi.join(homeDir, '.aki', 'akidevrule')]` untouched at `scripts/rule-context.js:121` (because `rule-context.js` does not pass through `roots.js` credential filtering, widening `globalZones` to `~/.aki` would allow a project `CLAUDE.md` containing `@~/.aki/mcpsv/auth.json` to leak credentials).
  - In `scripts/rule-context.js`: distinguish server-supplied top-level `extraFiles` (`depth === 0`, passing `allowDirect = true` in the `extraFiles` loop at `:204-208`) so the top-level `extraFile` itself is authorized even when `setting.json` narrows `folders` outside `~/.aki`; however, any `@import` directive inside that file (`depth >= 1`) passes `allowDirect = false` and remains strictly checked by `authorized(real)` (blocking `@~/.aki/mcpsv/auth.json` with `IMPORT_OUTSIDE_TRUST_ZONE`). Zero mention of `aiobox` in `scripts/rule-context.js`.
- **[x] [B2 — Strict `guideDir` Symlink Containment, Win32 Case-Insensitivity & Post-Realpath Dedupe/Sort]:**
  - In `scripts/aiobox-mcp.js`: `extraRuleFiles(own)` resolves `realGuideDir = fs.realpathSync(guideDir())` and `realFile = fs.realpathSync(path.join(realGuideDir, `${id}.md`))`, checks containment inside `realGuideDir` with a trailing `path.sep` and case-insensitive comparison on `win32` (matching `containedIn` in `scripts/roots.js`), checks `fs.statSync(realFile).isFile()`, and deduplicates + sorts **after** `realpathSync` (`[...new Set(out)].sort()`) so case variants on macOS APFS / Windows (`Claude` vs `claude`) collapse to one canonical path.
  - In `scripts/rule-gate.js`: wrap `await extraRuleFiles(own)` in a defensive `try/catch` (failing open to `[]`) and deduplicate cumulative `extraFiles` (`[...new Set([...(entry.extraFiles || []), ...missing])].sort()`).
- **[x] [B3 — Complete Security & `claimShown` 10s Test Matrix]:**
  - Extend `test/rule-context.test.js`, `test/rule-gate.test.js`, and `test/aiobox-mcp.test.js` with:
    1. Narrowed `folders: [tmp]`: top-level `extraFiles` outside `folders` triggers `RULE_PUSH`, while `@~/.aki/mcpsv/auth.json` inside both project `CLAUDE.md` and inside the `extraFile` itself (`depth >= 1`) is blocked with `IMPORT_OUTSIDE_TRUST_ZONE`.
    2. Symlink escape inside `guideDir` pointing to `setting.json` or outside `~/.aki` is completely ignored (`[]`).
    3. Multi-provider accumulation (provider A -> `receipt1` -> provider B -> `receipt2` covering both A & B) + 2 concurrent calls to the same provider sharing the base receipt within the 10s `claimShown` window (first call receives full `rulesBlock`, second call receives the compact 1-line pointer with the same `<newReceipt>`) + fail-open when AIObox is stopped / `no_window` / `FILE_ID` path traversal.
- **[x] [N1 — Fallback `args.like` Only When `providers.size === 0` in `scripts/aiobox-mcp.js`]:**
  - First collect `providers` from `own?.args?.provider` (matching `FILE_ID`), `own?.window`, and `own?.args?.window`.
  - Check `own?.args?.like` **only as a fallback when `providers.size === 0`** so `handoff_open(provider: "claude", like: "P59·W7 [aistudio]")` only pushes `claude.md` and does not push 9.6 KB of `aistudio-google-com.md` from the old window being replaced, while `place_like(like: "P1·W1")` (if called without `window`) still resolves `like`. Zero hardcoded op names (BR-8).
- **[x] [N2 — Type/Empty Guard in `uncovered()` at `scripts/rule-gate.js`]:**
  - Use `if (typeof f !== 'string' || !f || known.has(f) || missing.includes(f)) continue;` in the `uncovered()` loop over candidate rule files.
- **[x] [N3 — Docs, Plan Status & `coding.B3` Discipline]:**
  - Keep `AIOBOX_STEP` (`scripts/rule-context-mcp.js:33`) and `withRules` (`scripts/rule-gate.js:160`) unchanged (M-check 2 Option A).
  - Update `docs/plan/provider-guide-rule-push.md`, `CHANGELOG.md`, and `docs/index.md`; run `npm test` once via `aki__task_start` at the end of Phase 2 (`coding.B3`).

---

## 1. Objective & Hard Boundaries

### 1.1 Objective
Enforce a hard call-entry gate in `aki-mcp-sv` so that whenever an LLM hands off or operates an AIObox provider window via `aki__aiobox_write`, the server forcibly pushes the target provider's guide (`~/.aki/aiobox/guide/<provider>.md`) into the LLM's context via the existing D23 `RULE_PUSH` mechanism (`scripts/rule-gate.js`) before executing the write operation.

### 1.2 Why Session / `from` / `ss` Mapping Is Impossible (Code Proof)
- `scripts/streamable-bridge.js:25-30`:
  - Line 25–28: `let shared = null;` — all external HTTP clients multiplex onto **one single internal `McpServer` session** over `InMemoryTransport` with remapped request IDs (`nextUpstreamId`).
  - Line 29–31: `// Minted external session ids, for a protocol-correct 404-on-stale. claude.ai mints a new one every ~10s, never reused; keep only the most recent, so a dropped id just re-initializes.`
- Because `claude.ai` rotates `mcp-session-id` every ~10 seconds and all clients share a single `McpServer`, `aki-mcp-sv` holds no persistent per-window or per-chat state.
- `from` on `aki__aiobox_write` (`scripts/aiobox-mcp.js:456`) and `ss` on acting tools (`scripts/rule-gate.js:12-14,132-136`) are caller-supplied per call and optional; neither tracks what provider guides are currently in the LLM's context window (especially after context compaction).
- By contrast, the cryptographic `receipt` (`sha256:<64 hex>`, `scripts/rule-gate.js:15,41-53`) is mandatory on every `aki__aiobox_write` call and maps in `issued` (`scripts/rule-gate.js:20`) to `{ mode, workingPath, extraFiles }`. Tying `~/.aki/aiobox/guide/<provider>.md` to `extraFiles` of the receipt guarantees:
  1. First `aki__aiobox_write` targeting `<provider>` returns `RULE_PUSH` with the full guide text + a new covering `receipt`, without executing the write.
  2. Retrying with the new `receipt` passes `uncovered()` (`known.has(f)` or `knownSha.has(sha)`) and executes immediately.
  3. After context compaction, when the LLM calls `aki__akidevrule_context` (which resets `extraFiles: []`), the next `aki__aiobox_write` automatically re-pushes the provider guide.

### 1.3 Compliance with `akimcp-boundary.md` & Surface Locks

| Rule | Constraint | How This Design Complies |
|---|---|---|
| **BR-1** (`akimcp-boundary.md:50-58`) | Set of files in `scripts/` containing `"aiobox"` (case-insensitive) is strictly locked to the 20-file allowlist; generic core (`rule-gate.js`, `rule-context.js`, `project-rules.js`, `roots.js`) must contain 0 occurrences of `aiobox`. | **0 new source files.** `scripts/rule-gate.js`, `scripts/provider-registry.js`, and `scripts/rule-context.js` use only generic terms (`extraRuleFiles`, `extraFiles`, `allowDirect`). All AIObox logic lives inside `scripts/aiobox-mcp.js` (already in the BR-1 adapter group). |
| **BR-2** (`akimcp-boundary.md:60`) | One writer per contract file; AkiMCP only reads `~/.aki/aiobox/guide/<provider>.md` and `cdp/windows.json`. | `extraRuleFiles` in `scripts/aiobox-mcp.js` only checks `fs.realpathSync` + `fs.statSync(realFile).isFile()` and reads `windows.json` via existing `readMap()`; 0 new writes. |
| **BR-3 & BR-6** (`akimcp-boundary.md:62,68`, `test/tool-surface.test.js:27-66`) | Static tool descriptions and `inputSchema`; preserve Claude `Always allow` definition hash; keep surface locked at **38 tools / `37023 / 37922` chars**. | **0 changes** to any tool `description`, `title`, `annotations`, or `inputSchema`. `extraRuleFiles` is an internal registration property on the config object passed to `server.registerTool` and stripped before `target.registerTool`. |
| **BR-8** (`akimcp-boundary.md:72`) | No hardcoded AIObox `op` list or provider list in AkiMCP. | `extraRuleFiles` inspects the call envelope (`own.args?.provider`, `own.window`, `own.args?.window`, fallback `own.args?.like`) generically across **all** `aiobox_write` ops without naming any op (`send`, `handoff_open`, `new_window`, etc.) or any provider id. |
| **S-1** (`akimcp-boundary.md:33`) | Edit AkiMCP only for a clear gain AIObox cannot achieve alone. | Only AkiMCP's `rule-gate.js` sits in front of every `aki__aiobox_write` call and controls the `receipt` state machine across compaction boundaries. |
| **BR-9 F7** (`akimcp-boundary.md:81,180`, `test/surface-no-aiobox.test.js:1-100`) | On a machine without `~/.aki/aiobox`, no tool breaks and no core output mentions AIObox. | When `~/.aki/aiobox` is absent, provider `aiobox` is disabled by `detect()` and `extraRuleFiles` is never invoked. |

---

## 2. Generic Seam in `scripts/provider-registry.js` & `scripts/rule-gate.js`

### 2.1 `scripts/provider-registry.js` (`:77-86`)
Destructure `extraRuleFiles` out of `config` so it is forwarded to `gate(handler, hasSchema, extraRuleFiles)` and never leaked onto the MCP SDK's `target.registerTool` descriptor:
```js
        return (name, config, handler) => {
          const { extraRuleFiles, ...restConfig } = config;
          const gated = isGated(restConfig);
          const hasSchema = restConfig.inputSchema !== undefined;
          // A read tool always runs; one that touched a project with rule files appends a line naming them (D23). The rule tool itself is left as it is.
          const call = gated ? gate(handler, hasSchema, extraRuleFiles) : (p === rule ? handler : withRules(handler, hasSchema));
          // Claude requires both readOnlyHint and destructiveHint on every tool (A12), and the MCP default for a missing destructiveHint is true: a read-only tool states false here, once.
          const a = restConfig.annotations;
          const declared = a?.readOnlyHint === true && a.destructiveHint === undefined ? { ...restConfig, annotations: { ...a, destructiveHint: false } } : restConfig;
          const served = gated ? { ...declared, inputSchema: withReceipt(declared.inputSchema) } : declared;
```

### 2.2 `scripts/rule-gate.js` (`:82-102`, `:139-145`)
Extend `uncovered(own, entry, current, extraRuleFiles)` and `gate(handler, hadSchema, extraRuleFiles)`:
- Call `let extra = []; try { if (typeof extraRuleFiles === 'function') extra = await extraRuleFiles(own); } catch {}` so any provider callback error fails open without crashing the gate.
- Merge `...(Array.isArray(extra) ? extra : [])` into the candidate rule file list `[...await rulesFor(pathsOf(own)), ...await routeRulesFor(filePathsOf(own)), ...(Array.isArray(extra) ? extra : [])]`.
- Guard and skip duplicate paths within the loop (`if (typeof f !== 'string' || !f || known.has(f) || missing.includes(f)) continue;`) [N2] so `missing` contains unique valid file paths.
- Deduplicate and sort cumulative `extraFiles`: `const extraFiles = [...new Set([...(entry.extraFiles || []), ...missing])].sort();`.
- Zero mention of `aiobox` anywhere in `scripts/rule-gate.js`.

---

## 3. AIObox Provider Registration in `scripts/aiobox-mcp.js`

### 3.1 Path Helper, Strict `guideDir` Containment, `args.like` Fallback & Lazy `readMap()`
In `scripts/aiobox-mcp.js`:
- Define `const guideDir = () => path.join(aioboxDir(), 'guide');`.
- Define `const insideDir = (file, dir) => (process.platform === 'win32' ? file.toLowerCase().startsWith((dir + path.sep).toLowerCase()) : file.startsWith(dir + path.sep));` [B2].
- Define `export function extraRuleFiles(own)` (exported for direct unit testing in `test/aiobox-mcp.test.js` and wired onto `aiobox_write` in `register(server)`):
  1. Collect primary target `providerId` values from:
     - **(a) Explicit `own?.args?.provider`:** if `typeof own?.args?.provider === 'string' && FILE_ID.test(own.args.provider)`, add `own.args.provider`.
     - **(b) Primary window references `own?.window` and `own?.args?.window`:** using a lazy memoized `readMap()` (`let map; const getMap = () => (map ??= readMap());`), for each `ref` where `typeof ref === 'string' && ref.trim()`, resolve `resolveTab(getMap(), ref)?.provider` inside its own `try/catch`. If the resolved `provider` matches `FILE_ID`, add it.
     - **(c) Fallback `own?.args?.like` when `providers.size === 0` [N1]:** if `providers.size === 0` and `typeof own?.args?.like === 'string' && own.args.like.trim()`, resolve `resolveTab(getMap(), own.args.like)?.provider` inside `try/catch` and add it if it matches `FILE_ID`.
  2. **Strict symlink containment inside `guideDir` + post-realpath dedupe & sort [B2]:**
     - Resolve `let realGuideDir; try { realGuideDir = fs.realpathSync(guideDir()); } catch { return []; }`.
     - For each `id` in `providers`:
       - Inside `try/catch`: resolve `const realFile = fs.realpathSync(path.join(realGuideDir, `${id}.md`));`.
       - Verify `insideDir(realFile, realGuideDir) && fs.statSync(realFile).isFile()`; only then push `realFile`.
     - Return `[...new Set(out)].sort()`.

---

## 4. Mandatory Technical Verification (`M-check 1` & `M-check 2`)

### 4.1 M-check 1: `rule-context.js` Server-Supplied `extraFiles` Trust vs `@import` Containment [B1]
1. **Why `globalZones` MUST stay `[~/.claude, ~/.aki/akidevrule]` (`scripts/rule-context.js:121`):**
   - `scripts/roots.js:21-25` only includes `~/.aki` in `getRoots()` when `setting.json` has no `folders` key. When `folders` is narrowed in Panel Section 5 (or `folders: [tmp]` in tests), `~/.aki` is outside `roots` and outside `extraRoots`.
   - However, widening `globalZones` to `~/.aki` is forbidden [B1] because `rule-context.js` does not call `roots.js:refuseCredentialFile`: if `~/.aki` were in `globalZones`, an untrusted project `CLAUDE.md` containing `@~/.aki/mcpsv/auth.json` would pass `authorized(real)` at `depth = 1` and leak credentials into the assembled context.
2. **Exact Fix in `scripts/rule-context.js:147-153, 178, 204-208`:**
   - Keep `globalZones = [pathApi.join(homeDir, '.claude'), pathApi.join(homeDir, '.aki', 'akidevrule')]` untouched.
   - Add parameter `allowDirect = false` to `async function load(file, kind, depth, requiredSource = false, allowDirect = false)`.
   - At `scripts/rule-context.js:153`, check `if (!(allowDirect && depth === 0) && !authorized(real)) { warnings.push({ code: 'IMPORT_OUTSIDE_TRUST_ZONE', path: file }); return; }`.
   - At `scripts/rule-context.js:178` (recursive `@import` expansion), call `await load(imported, 'import', depth + 1, false, false);`.
   - At `scripts/rule-context.js:206` (the `extraFiles` loop), call `await load(file, pathApi.basename(file) === 'CLAUDE.local.md' ? 'local' : 'project', 0, false, true);`.

### 4.2 M-check 2: Keep `AIOBOX_STEP` & `withRules` Unchanged (Option A — Approved)
- `AIOBOX_STEP` (`scripts/rule-context-mcp.js:33`) and `withRules` (`scripts/rule-gate.js:160`) remain untouched so read-only `aki__aiobox` JSON outputs are not polluted with a second text block and `test/rule-context.test.js:82,121` stays green.

---

## 5. Phase 2 Execution Checklist

- [x] **Step 1:** Update `scripts/rule-context.js` (`allowDirect = false` on `load`, `!(allowDirect && depth === 0) && !authorized(real)`, `allowDirect = true` on `extraFiles` loop at `depth === 0`, keeping `globalZones` untouched).
- [x] **Step 2:** Update `scripts/provider-registry.js` (strip `extraRuleFiles` from `config` and pass to `gate(handler, hasSchema, extraRuleFiles)`).
- [x] **Step 3:** Update `scripts/rule-gate.js` (accept `extraRuleFiles` in `gate` and `uncovered`, wrap `await extraRuleFiles(own)` in `try/catch`, guard `typeof f !== 'string' || !f`, deduplicate `missing` and `entry.extraFiles`).
- [x] **Step 4:** Update `scripts/aiobox-mcp.js` (export `extraRuleFiles(own)` with lazy `readMap()`, `FILE_ID` validation, fallback `args.like` only when `providers.size === 0`, strict `insideDir(realFile, realGuideDir)` symlink containment, post-realpath `[...new Set(out)].sort()`, and wire `extraRuleFiles` onto `aiobox_write`).
- [x] **Step 5:** Add tests in `test/rule-context.test.js`, `test/rule-gate.test.js`, and `test/aiobox-mcp.test.js`.
- [x] **Step 6:** Update `CHANGELOG.md` and `docs/index.md`, then run `npm test` once via `aki__task_start` (`coding.B3`) + `node test/lint/check-docs-note.js` + `node test/lint/check-residue.js`.

---

## 6. Post-Implementation Audit & Closure

- **Commit:** `84741c7` (`feat(aiobox): push target provider guide via rule-gate before aiobox_write`, 10 files `+341/-15`, `package.json` unchanged at `4.2.0`).
- **Verification (`coding.B3`):** `npm test` exit `0` (`195/195 pass, 0 fail`, `tool surface: 38 tools, 37023 chars (budget 37922), sha256 4e409e4d3a67a060`, log `task_1795341885114_xcj99.log`), `node test/lint/check-docs-note.js` exit `0` (`task_1795341930163_9ojnt.log`), `node test/lint/check-residue.js` exit `0` (`task_1795341931859_yj7r4.log`).
- **Audit Verdict:** Challenger `P59·W7` (Neon) Post-Implementation Audit Round 2 (`/akithink` deep 4 rounds, read-only static diff + 3 logs) = **`PASS`** (0 Blocking, 0 Nit). Closed to `docs/plan/done/provider-guide-rule-push.md` by Lead `P59·W2`.
