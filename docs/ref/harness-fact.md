# CLI arm harness facts — agy & kiro

> updated 2026-10-25 · v3.1.0

Facts the two "arm" MCPs (`scripts/agy-mcp.js`, `scripts/kiro-mcp.js`) depend on. Each is marked and dated, because all of it is version-bound and expected to rot. Style borrowed from akidevrule's `references/harness-facts.md`, scoped to what *this* repo actually invokes.

- **[obs]** — observed here by running the CLI on this machine. True-until-contradicted; re-verify before relying on a detail.
- **[owner]** — supplied by the owner / upstream docs, not runnable here. Weakest tier: a rule leaning on it must carry a verification step.

If a fact changes, revisit the code that encodes it rather than patching around it.

## agy (Antigravity CLI 1.4.7) — `scripts/agy-mcp.js`

Fully runnable on this machine; facts are [obs] unless noted.

How agy and the Antigravity IDE load MCP servers (config file, transports, permissions) is a separate subject: [`fact-agy-mcp-config.md`](fact-agy-mcp-config.md).

**The model list, the effort levels, the modes and the output formats are read from the CLI at call time** by `scripts/agy-capabilities.js` (`agy models`, `agy --help`, `agy --version`), cached 1 h, or 1 min after a failed models probe so one transient failure does not switch the default model off for an hour. `agy-mcp.js` holds none of them as a literal — this is the fix for the drift the 1.x docs carried, where a hardcoded list rotted silently when agy's server-side list moved (`docs/plan/audit-tool-drift-oct25.md` F1–F5, D1). So the rows below are behavior that is stable across agy releases; the volatile values are an example of one probe, not a fact to maintain.

| Fact (behavior, stable) | Checked | Where it is encoded |
|---|---|---|
| `-p`/`--print` takes the prompt as its **value**, so it must be the **last** arg — anything after it is swallowed into the prompt, not parsed as a flag, and the call returns a confident, unrelated answer with no error. | 2026-10-25 | `agy-mcp.js` pushes `-p` last, after `--mode`/`--model`/`--effort`/`--output-format`. |
| `--mode plan` is read-only **by mechanism**, not by prompt wording. It is the only mode enabled by default; others must be opted in via `setting.json → agy.allowedModes`. The tool's `readOnlyHint` and its read-only sentence are generated from the allowed modes, so they tell the truth when the allowlist is widened. | 2026-10-25 | `agy-mcp.js` `DEFAULT_MODES=['plan']`, allowlist gate, `describe(modes)`. |
| The default model is **not pinned**: resolved at call time as `setting.json → agy.defaultModel`, else the newest `gemini-<n>-flash-medium` the probe reports, else no `--model` (agy's own default). The tool names the tier, never an id. | 2026-10-25 | `agy-mcp.js` `resolveModel`, `agy-capabilities.js` `newestFlashMedium`. |
| `model`, `effort` and `outputFormat` are passed straight to agy, which validates them. A rejected value refreshes the probe once and returns agy's own error plus the live valid list; `list="models"`/`"capabilities"` reads the current values with no prompt spawned. | 2026-10-25 | `agy-mcp.js` `runWithValueHelp`, `listReply`. |
| agy writes its **own errors to stdout**, not stderr; a denied action still exits 0 with an **empty** response. Empty stdout is inconclusive (possible silent denial), never a clean empty result. A model/effort conflict surfaces as `error: invalid model selection … conflicts with --effort` on stdout, exit 1. | 2026-10-25 | `agy-mcp.js` checks `stdout` first, treats empty as `err`. |
| agy's global workspace index resolves paths **outside `cwd`**, so `cwd` is not a hard scope boundary — the prompt must name exact paths. | 2026-10-25 | the `agy_run` tool description. |
| `--output-format json` returns a JSON object with `conversation_id`, `status`, `response`, `duration_seconds`, `num_turns`, `usage{input/output/thinking/cache_read/total}`. AkiMCP buffers the whole output; it exposes no resume, so `conversation_id` is informational only (`docs/plan/audit-tool-drift-oct25.md` D5). | 2026-10-25 | spike, § Verification of the plan. |

**Probe example (this machine, agy 1.4.7, 2026-10-25) — a snapshot, not a maintained list.** `agy models` prints `id<TAB>label` lines after a `Fetching available models...` line on stderr: `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium`. `agy --help`: `--effort (low|medium|high|xhigh|max)`, `--mode (accept-edits, auto, plan)`, `--output-format (text, json, stream-json)`, `--print-timeout` default `0s`. These move without an agy version bump, which is exactly why they are read live rather than written here.

## kiro (kiro-cli 2.16.2) — `scripts/kiro-mcp.js`

Installed at `~/.local/bin/kiro-cli`; every row below was run-verified on this machine 2026-08-09, so all are **[obs]**. Still version-bound — re-check after a kiro-cli upgrade. (Not re-run on 2026-10-25: the kiro provider is switched off and `kiro-cli` is not on the audit shell's allowlist; the code constant and 2.16.2 pin are unchanged.)

| Fact | Checked | Where it is encoded |
|---|---|---|
| Headless invocation is `kiro-cli chat --no-interactive <prompt>`, prompt passed as a separate `execFile` arg (no shell tokenizing). `--list-models` and `--effort` are `chat` subflags, not top-level. | 2026-08-09 | `kiro-mcp.js` |
| Tool grant is set by `--trust-tools=fs_read` (read-only); `--trust-tools=` (empty) trusts nothing. `kiro_write` (`fs_read,fs_write`) was removed 2026-08-10 — redundant with the `filesystem` MCP arm's `write_file`/`edit_file` (`docs/plan/done/remove-kiro-write.md`). Flag name confirmed verbatim in `chat --help`. | 2026-08-09 | `kiro-mcp.js` (single `registerTool`) |
| Model is hard-locked to `claude-sonnet-4.5` (dot-minor form) — confirmed a real id in `chat --list-models` (1.30x credits). Not a tool parameter, so a prompt cannot escalate tier. A failure naming the model returns `next: kiro-cli chat --list-models` (`docs/plan/audit-tool-drift-oct25.md` D8). | 2026-08-09 | `kiro-mcp.js` `const MODEL` |
| `--effort` accepts `low\|medium\|high\|xhigh\|max` — confirmed in `chat --help`. kiro's full range is real; it is read from a static `z.enum` here, not from a probe, because the id is hard-locked and the range has been stable. | 2026-08-09 | `kiro-mcp.js` `effortSchema` |
| A missing binary or denied action must fail loud, never fabricate output. Empty stdout is reported as a possible silent denial. | 2026-08-09 | `kiro-mcp.js` — ENOENT → `err`, empty stdout → `err`. |

## Why this file exists

The 1.2.0 release shipped agy tuning verified against live `--help` **and** a kiro arm whose literals came from upstream docs the same release proved unreliable elsewhere. The evidence-tier split kept the then-unverified kiro literals from reading as settled fact. On 2026-08-09 `kiro-cli` 2.16.2 was installed here and every kiro row was promoted `[owner]→[obs]`. On 2026-10-25 the agy drift audit removed the model/effort/mode/output-format literals from both the code and this doc: those values now come from `scripts/agy-capabilities.js` reading the CLI, so this file carries agy's stable behavior and one dated probe example, never a list to maintain (`docs/plan/audit-tool-drift-oct25.md` D1, D6).
