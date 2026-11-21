# CLI arm harness facts — agy & kiro

> updated 2026-11-21 · v4.2.0

Facts the two "arm" MCPs (`scripts/agy-mcp.js`, `scripts/kiro-mcp.js`) depend on. Each is marked and dated, because all of it is version-bound and expected to rot. Style borrowed from akidevrule's `references/harness-facts.md`, scoped to what *this* repo actually invokes.

- **[obs]** — observed here by running the CLI on this machine. True-until-contradicted; re-verify before relying on a detail.
- **[owner]** — supplied by the owner / upstream docs, not runnable here. Weakest tier: a rule leaning on it must carry a verification step.

If a fact changes, revisit the code that encodes it rather than patching around it.

## agy (Antigravity CLI 1.5.13+ — verified live on 1.5.14) — `scripts/agy-mcp.js`

Fully runnable on this machine; facts are [obs] unless noted.

How agy and the Antigravity IDE load MCP servers (config file, transports, permissions) is a separate subject: [`fact-agy-mcp-config.md`](fact-agy-mcp-config.md).

**The model list, the effort levels, the modes and the output formats are read from the CLI at call time** by `scripts/agy-capabilities.js` (`agy models`, `agy --help`, `agy --version`, plus 0-token `agy -p "/usage" --output-format json --log-file <tmp>`), cached **per authenticated account** for 1 h (1 min after a failed models probe so one transient failure does not switch the default model off for an hour), with a 30 s micro-TTL on `/usage` (bypassed on `refresh()`). `agy-mcp.js` holds no model list or versioned model IDs as literals — this preserves the drift fix (`docs/plan/done/audit-tool-drift-oct25.md` F1–F5, D1) while adding account/tier/quota awareness and background runs (`docs/plan/agy-run-tier-and-long-run.md`).

| Fact (behavior, stable) | Checked | Where it is encoded |
|---|---|---|
| `-p`/`--print` takes the prompt as its **value**, so it must be the **last** arg — anything after it is swallowed into the prompt, not parsed as a flag, and the call returns a confident, unrelated answer with no error. | 2026-11-21 | `agy-mcp.js` pushes `-p` last, after `--mode`/`--model`/`--effort`/`--output-format`/`--print-timeout`. |
| `--mode plan` is read-only **by mechanism**, not by prompt wording. It is the only mode enabled by default; others must be opted in via `setting.json → agy.allowedModes` (changing `allowedModes` takes an AkiMCP restart to redraw description and `readOnlyHint`). `readOnlyHint: true` remains true while `plan` is the sole allowed mode; `background: true` writes only bookkeeping/log files under `USER_DIR`, never repository files. | 2026-11-21 | `agy-mcp.js` `DEFAULT_MODES=['plan']`, allowlist gate, `describe(modes)`. |
| The default model is **not pinned**: resolved at call time as `setting.json → agy.defaultModel`, else the newest `gemini-<n>-flash-high` the probe reports (falling back to `-flash-medium` when `-high` is absent), else no `--model` (agy's own default). `newestFlashMedium` was removed. The tool names the tier, never a model id. | 2026-11-21 | `agy-mcp.js` `resolveModel`, `agy-capabilities.js` `defaultFlashModel`. |
| Active account & 0-token `/usage`: `~/.gemini/google_accounts.json` is **not** authoritative for `agy` (observed pointing to a different account than `agy`'s OAuth session). `agy --log-file <tmp> --output-format json -p "/usage"` spends `0` model tokens, logs `OAuth: authenticated successfully as <email>` to `--log-file`, and emits `command.data.groups[]` (`remaining_fraction`, `reset_time`) on stdout. The temp dir is `0o700` and removed in `finally`; raw log text is never returned. | 2026-11-21 | `agy-capabilities.js` `runUsageProbe`, `parseAuthEmail`, `parseUsageJson`. |
| Local plan tier & `.frame` fallback: `~/.gemini/antigravity-cli/aki-plan-tier/<email>` holds the plain-text plan name (e.g. `Google AI Pro`, `Antigravity Starter Quota`), and `~/.gemini/antigravity-cli/rate-limits/<email>.frame` holds 2-line NDJSON (line 1 `{email, userTier:{name}}`, line 2 `{command:{name:"usage", data:{groups}}}`). Plan tier is read from those files at call time and never inferred from quota buckets; `.frame` quota is used only as a fallback when live `/usage` fails and file mtime is ≤ 6 h. | 2026-11-21 | `agy-capabilities.js` `readLocalPlanTier`, `readLocalQuotaFrame`. |
| Plan-mismatch checking: when an explicit `model` is missing from the live account's model list (refreshed once before rejecting), `explainMissingModel` matches gated model families (never versioned IDs) and reports a tier mismatch only when `planTier` is missing or does not include the required plan; if the current plan already includes that family, it reports an unknown model with the live list. | 2026-11-21 | `agy-capabilities.js` `explainMissingModel`, `agy-mcp.js` `validateExplicitModel`, `runWithValueHelp`. |
| Long runs & timeout: synchronous `agy_run` accepts `timeoutSec` `10..600` (default `120`). `background: true` runs detached via the shared task store (max 4 concurrent `agy` background runs, refused before spawn if the `task` provider is disabled), defaults `outputFormat: "json"`, always passes `--print-timeout` (default `1800` s, up to `1800` s), splits stdout (`.log`) and stderr (`.err.log`), and extracts `agySummary` + `emptyOutput` idempotently on exit or lazily in `task_manage action="status"`. | 2026-11-21 | `agy-mcp.js`, `task-mcp.js` `startBackgroundProcess`, `applyAgySummary`, `taskManage`. |
| agy writes its **own errors to stdout**, not stderr; a denied action still exits 0 with an **empty** response. Empty stdout is inconclusive (possible silent denial), never a clean empty result. Prompts should include a `BLOCKED`-on-tool-failure clause. A model/effort/tier conflict refreshes once and returns agy's error plus live valid values. | 2026-11-21 | `agy-mcp.js` `run`, `VALUE_COMPLAINT`, `runWithValueHelp`; `task-mcp.js` `applyAgySummary`. |
| agy's global workspace index resolves paths **outside `cwd`**, so `cwd` is not a hard scope boundary — the prompt must name exact paths. | 2026-11-21 | the `agy_run` tool description. |
| `--output-format json` returns a JSON object with `conversation_id`, `status`, `response`, `duration_seconds`, `num_turns`, `usage{input/output/thinking/cache_read/total}` (and `command` for slash commands like `/usage`). AkiMCP exposes no resume, so `conversation_id` is informational only. | 2026-11-21 | `task-mcp.js` `applyAgySummary`, `agy-capabilities.js` `parseUsageJson`. |

### Plan ↔ Model-family & Quota-group matrix (2026-11-21)

Reference matrix only (cross-checked with `Aki-Dev-Sync/docs/ref/fact-antigravity-quota-tiers.md`). **Code never hardcodes versioned model IDs** — `agy models` remains the runtime source of truth.

| Plan tier | Evidence | Model families available | Quota groups observed in `/usage` |
|---|---|---|---|
| `Antigravity Starter Quota` (Starter) | **[obs]** | Flash tier (newest Flash), 3P Claude / GPT-OSS families (no Gemini 4 Pro/Neon/Argon/Hydrogen/Orchestrator) | Gemini Models (5h + weekly), Claude and GPT models (5h + weekly) |
| `Google AI Pro` (Pro) | **[obs]** | Starter families + Gemini 4 Pro families (Neon, Argon, Hydrogen, Orchestrator) | Gemini Models (5h + weekly), Claude and GPT models (5h + weekly), Gemini 4 Argon (separate weekly bucket) |
| `Google AI Ultra` (Ultra) | **[owner]** | Pro families + Carbon family (verify live via `agy models` when an Ultra account is active) | Larger shared Gemini quota bucket (Argon folded into Gemini bucket per `/usage` description) |

**Probe example (this machine, agy 1.5.14, Google AI Pro, 2026-11-21) — a snapshot, not a maintained list.**
- `agy models` (23 rows, `id<TAB>label` after `Fetching available models...` on stderr): `gemini-4-neon-{low,medium,high,xhigh}`, `gemini-4-argon-{low,medium,high}`, `gemini-4-hydrogen-{low,medium,high,xhigh}`, `gemini-pro-orchestrator-{neon,g1-pro}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium`.
- `agy --help`: `--effort (low|medium|high|xhigh|max)`, `--mode (accept-edits, auto, plan)`, `--output-format (text, json, stream-json)`, `--print-timeout` (default `0s`), `--log-file`.
- `agy -p "/usage" --output-format json` (0 tokens): groups `Gemini Models` (`gemini-weekly`, `gemini-5h`), `Claude and GPT models` (`3p-weekly`, `3p-5h`), `Gemini 4 Argon` (`gemini-argon-wtu-weekly`).

## kiro (kiro-cli 2.16.2) — `scripts/kiro-mcp.js`

Installed at `~/.local/bin/kiro-cli`; every row below was run-verified on this machine 2026-08-09, so all are **[obs]**. Still version-bound — re-check after a kiro-cli upgrade. (Not re-run on 2026-10-25 or 2026-11-21: the kiro provider is switched off and `kiro-cli` is not on the audit shell's allowlist; the code constant and 2.16.2 pin are unchanged.)

| Fact | Checked | Where it is encoded |
|---|---|---|
| Headless invocation is `kiro-cli chat --no-interactive <prompt>`, prompt passed as a separate `execFile` arg (no shell tokenizing). `--list-models` and `--effort` are `chat` subflags, not top-level. | 2026-08-09 | `kiro-mcp.js` |
| Tool grant is set by `--trust-tools=fs_read` (read-only); `--trust-tools=` (empty) trusts nothing. `kiro_write` (`fs_read,fs_write`) was removed 2026-08-10 — redundant with the `filesystem` MCP arm's `write_file`/`edit_file` (`docs/plan/done/remove-kiro-write.md`). Flag name confirmed verbatim in `chat --help`. | 2026-08-09 | `kiro-mcp.js` (single `registerTool`) |
| Model is hard-locked to `claude-sonnet-4.5` (dot-minor form) — confirmed a real id in `chat --list-models` (1.30x credits). Not a tool parameter, so a prompt cannot escalate tier. A failure naming the model returns `next: kiro-cli chat --list-models` (`docs/plan/done/audit-tool-drift-oct25.md` D8). | 2026-08-09 | `kiro-mcp.js` `const MODEL` |
| `--effort` accepts `low\|medium\|high\|xhigh\|max` — confirmed in `chat --help`. kiro's full range is real; it is read from a static `z.enum` here, not from a probe, because the id is hard-locked and the range has been stable. | 2026-08-09 | `kiro-mcp.js` `effortSchema` |
| A missing binary or denied action must fail loud, never fabricate output. Empty stdout is reported as a possible silent denial. | 2026-08-09 | `kiro-mcp.js` — ENOENT → `err`, empty stdout → `err`. |

## Why this file exists

The 1.2.0 release shipped agy tuning verified against live `--help` **and** a kiro arm whose literals came from upstream docs the same release proved unreliable elsewhere. The evidence-tier split kept the then-unverified kiro literals from reading as settled fact. On 2026-08-09 `kiro-cli` 2.16.2 was installed here and every kiro row was promoted `[owner]→[obs]`. On 2026-10-25 the agy drift audit removed the model/effort/mode/output-format literals from both the code and this doc: those values now come from `scripts/agy-capabilities.js` reading the CLI, so this file carries agy's stable behavior and one dated probe example, never a list to maintain (`docs/plan/done/audit-tool-drift-oct25.md` D1, D6). On 2026-11-21 the tier/quota and long-run upgrade extended `agy-capabilities.js` and `agy-mcp.js` for `agy 1.5.13+` (verified live on `1.5.14`) while keeping zero hardcoded model IDs in code (`docs/plan/agy-run-tier-and-long-run.md`).
