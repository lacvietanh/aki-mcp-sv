# Provider toolkit — how tools are hosted, hidden and added

> updated 2026-10-03 · v3.0.0 (plan: [`plan/provider-toolkit-architecture.md`](../plan/provider-toolkit-architecture.md), measurements: [`research/tool-surface-provider-toolkit.md`](../research/tool-surface-provider-toolkit.md))

The tools server is one `McpServer` that hosts every tool module (a provider). This doc is the contract for what each provider declares, how the registry decides what a client sees, the shape a new provider takes, and the test that holds the whole surface in place. Tool names and schemas of the existing 36 tools were not changed by it.

## Contract 1 — Annotations

Every tool passes `annotations` in its own `registerTool` call.

- `readOnlyHint: true` only when the tool cannot write by mechanism. "Usually used to read" is not enough. `agy_run` is read-only only while `plan` is its single allowed mode, computed from `setting.json` at registration.
- Every tool states `readOnlyHint`; a tool that is not read-only also states `destructiveHint`. `openWorldHint: true` when the tool can reach a page or a service off the machine (`git` because `op=tags remote=` runs `ls-remote`), `false` when it only touches the local machine. `idempotentHint` only when certain.
- Annotations are client UX: ChatGPT asks for confirmation on every tool without `readOnlyHint`. They replace none of the allowlist, roots or SSRF guard.

## Contract 2 — Registry, descriptor, detect

Each module exports a `provider` descriptor next to its `register`:

```js
export const provider = {
  id: 'chrome',                 // key in setting.json, never renamed
  title: 'Chrome profiles & tabs',
  detect: () => listInstalledBrowsers().length ? { available: true } : { available: false, reason: 'no Chromium browser installed' },
  register,
};
```

`scripts/provider-registry.js` holds the one list (`PROVIDERS`, whose order is the `tools/list` order):

1. Detect runs once, at the first mount (boot), and again only on `redetect()`. It answers "is the app installed", never "is it running", and spawns nothing: binaries are found by `scripts/find-on-path.js` (`PATHEXT` suffixes on win32 are a data table). Postman is the one exception that may run `which`/`where` once, and only when Postman is not at its standard path (`postman-paths.cjs`).
2. Every provider is always registered, so `warmToolsServer` still catches a schema error in any of them. A provider that is not available or is switched off has its tool handles disabled: it is absent from `tools/list`, and a call fails with the SDK's disabled-tool error.
3. The switch is `providers.<id>.enabled` in `setting.json` (default on). `required: true` providers cannot be switched off: `rule` (the rule prompt and AIObox call it by name), `filesystem`, `search`, `shell` (core primitives). `cdp` has no detect because it also serves Postman, VS Code and AIObox's Chrome; hiding it by "no session running" would hide it exactly when an attach needs it.
4. API: `listProviders()` → `[{ id, title, required, available, reason, enabled, tools }]`; `setEnabled(id, bool)` writes `setting.json` atomically and applies to every mounted server; `redetect()` reruns detect without a restart.
5. Panel section 8 "Tool providers" reads `GET /api/providers` and posts `{ id, enabled }` or `{ redetect: true }` to `POST /api/providers` (same `x-panel-token` as every panel route). A client sees a change on its next `tools/list`, which for web clients usually means a new chat; the bridge has no server → client channel for `list_changed`.

## Contract 3 — Shape for a new provider

1. Split by risk: `aki__<p>` holds only read ops (`readOnlyHint: true`), `aki__<p>_write` holds the write ops.
2. An `op` enum plus flat parameters, like `aki__git`. A parameter description starts with the op that uses it. The root schema is a flat object: no `anyOf`/`oneOf`, no free-form `args`.
3. Per-op required parameters are checked in the handler, and the error names the op and the missing field: `op=read needs window`.
4. At most about 8 ops per tool; past that, split by sub-domain, never `op=help`.
5. Description: one sentence on what the tool does, one clause per op, then the alternative tool where they overlap. It describes behavior and does not instruct the model (ChatGPT flagged imperative descriptions as `Suspicious Instruction`). At most 700 characters.
6. A descriptor, a detect and annotations are mandatory. Secrets live under the keys dir of `userdata.js` and never reach output or logs.
7. Each op still has to earn its place beside `run_cmd` (`feat/tools.md` § When a tool earns its place).

The first provider built on it is `aiobox` (`scripts/aiobox-mcp.js`): `aki__aiobox` (`op` = `windows` | `read` | `text` | `screenshot`, read-only by mechanism because the page code is fixed) and `aki__aiobox_write` (`op` = `new_window` | `eval`). Its file and page contract with AIObox is in [`plan/IMPORTANT-akimcp-aiobox-contract.md`](../plan/IMPORTANT-akimcp-aiobox-contract.md) § Hợp đồng AkiMCP đọc từ AIObox.

## Contract 4 — Tool surface test

`test/tool-surface.test.js`, last in `npm test`:

1. Budget: `JSON.stringify(tools/list .tools).length` ≤ `round(BASELINE_CHARS × 1.10) + sum(RAISES)`. The baseline (27207 chars, 36 tools, measured 2026-10-02 before annotations) and every raise (date, reason, measured chars) are constants in the test, so growth is a visible line in the diff. It prints a per-tool size table and a 16-hex sha256 of the surface, so "the surface did not change" across a refactor is a one-line comparison.
2. Annotations, description length (≤ 700, except `akidevrule_context`, whose description carries the rule-delivery handshake: `arch/rule-context-delivery.md`) and cross-references (every `aki__<name>` in a description or the server instructions is a registered tool) are checked over every registered tool, disabled ones included, so the result does not depend on what this machine has installed. CI on Ubuntu has no agy, Postman or Chrome.
3. Registry: providers map to their tools; switching `git` and `postman` off hides them, a call is refused, the switch is persisted, switching back restores them; a required provider and an unknown id are refused; an empty `PATH` plus `redetect()` hides `agy_run` and `kiro_read`. The panel routes are exercised the same way.

## Reopen "do not merge the surface" when

- the budget test shows `tools/list` above about 40,000 chars (~10K tokens);
- a real client reports exceeding its tool-count limit;
- a model repeatedly picks the wrong tool and a cross-reference in the description does not fix it;
- the bridge gains a server → client channel and major clients honor `list_changed`.
