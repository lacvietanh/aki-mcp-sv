# Named Temporary Tokens & External Management Surface (API / CLI / MCP Tool)

> Tool names here use the default prefix `aki__`. A server with another Tool prefix serves the same tools under that prefix; panel section 1 shows the active one.

- **Task ID:** `task-1795365466307`
- **Target Repo:** `aki-mcp-sv/`
- **Status:** In Progress (Phase 2 — Pre-Impl Audit PASS WITH FIXES applied: B1–B2, M1–M4, N1–N3)
- **Author:** Worker `P60·W4` (Lead: `P60·W3`, Challenger: `P10·W182`)
- **Date:** 2026-11-23

---

## 0. Context, Owner Intent & Baseline Facts

### 0.1 Owner Request (`.akidevsync/notes.json`)
- **Title:** `temp token cần một cái name để định danh cho dễ`
- **Detail:** `và phải có khả năng chạy từ ngoài, kiểu như api hoặc thông qua tools (phải audit kỹ vấn đề bảo mật), tối ưu context, token,.. tối ưu mọi khía cạnh`

### 0.2 Pre-Impl Ruling Summary (Challenger `P10·W182` + Lead `P60·W3`)
All 9 points from Challenger `P10·W182`'s 5-round `/akithink` Pre-Impl Audit (`PASS WITH FIXES`: 2B · 4M · 3Nit) are binding in Phase 2:
- **B1 (Caller Principal Propagation — Fail-Closed via SDK `authInfo`, drop ALS/Map):** Drop `AsyncLocalStorage` and `callerByUpstreamId`. Call `bearerPrincipal(req.headers.authorization)` **once** in `scripts/gatekeeper.js:96`, pass `principal.id` to `noteTempTokenUse` when `kind === 'temp'`, and pass `principal` to `handleStreamableMcp(req, res, principal)`. Forward `{ authInfo: { token: '', clientId: principal.kind, scopes: [], extra: { caller: principal } } }` through `requestUpstream` / `postMessage` -> `session.transport.send(message, { authInfo })`. Initialize `createToolsServer({ requireCaller: true, tempTokenMode: 'in-process', getOrigin })` in `streamable-bridge.js`; when `requireCaller === true` and `extra?.authInfo?.extra?.caller` is absent, **fail-closed** (throw error, never default to `"local"`).
- **B2 (Loopback SSRF Block on Control Panel Port in `scripts/fetch-mcp.js`):** Export `getActivePanelPort()` from `scripts/panel.js`. In `checkedUrl(url)` (async, executed on initial URL and every 3xx redirect hop; keeping `isBlockedHost` synchronous), compute blocked panel ports `{ getActivePanelPort(), readLock()?.panelPort, Number(process.env.PANEL_PORT || (IS_DEV ? 9996 : 9998)) }` (finite > 0). Match normalized host against `/^(localhost|.*\.localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|::1|::|::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::ffff:0\.0\.0\.0|::ffff:0:0)$/`. When targeting a panel port with a non-IP hostname, resolve via `dns.promises.lookup(host, { all: true })` and block if any resolved address matches loopback (0ms DNS overhead for non-panel ports). Also block `x-panel-token` header (case-insensitive).
- **M1 (Explicit `"proxy"` vs `"in-process"` Mode & Sanitized Proxy Errors):** Pass `tempTokenMode: "proxy"` in `stdio.js` and `"in-process"` in `streamable-bridge.js`. In `"proxy"` mode, fail explicitly if `instance.json` is missing or `!isPidAlive(lock.pid)` (never silently mutate dead in-process RAM). Check caller AuthZ before dispatching. Sanitize non-2xx proxy errors (`data?.error` or status code only; never embed raw HTTP headers/body).
- **M2 (`refuseCredentialArgs` Hardening in `scripts/roots.js` & Honest Framing):** In `refuseCredentialArgs`, check both `path.resolve(cwd, candidate)` and `fs.realpathSync` (when the target exists on disk), and also inspect the path portion after `=` in `--flag=path` arguments against `[...credentialFiles(), ...instanceLockFiles()]` (keeping `CREDENTIAL_FILES` unchanged so `read_text_file` + `redactResult` works on `instance.json`). State honestly in docs that `fetch-mcp.js` (B2) is the primary load-bearing boundary cutting `local_fetch -> panel`, while `refuseCredentialArgs` on `instance.json` is defense-in-depth.
- **M3 (Name Uniqueness, Conflicting Selectors & 7-Day Horizon Cap):** Enforce case-insensitive (`toLowerCase()`) uniqueness for live token names and case-insensitive name matching on `extend`/`revoke` while preserving display case. Reject conflicting selectors (`id` + `name` together, or `all: true` + `id`/`name`, or positional CLI target matching both a live name and a different live `>=8`-hex `id` prefix) with HTTP 400 / Error. Throw an explicit error when `extend` would exceed `Date.now() + 7 * 24 * 3600_000` (never return `ok: true` with 0 minutes added).
- **M4 (Compact 1-Line MCP Tool Payloads & Description Budget):** `aki__temp_token` returns 1-line `JSON.stringify(res)`, strips `ok`/`message`/`token`/`mcpUrl`/`guideUrl`, truncates `id` to 12 hex chars in MCP tool output (Panel HTTP API keeps full 64-hex `id` for UI compatibility), and omits null `lastAddress`/`lastAgent`/`lastSeen`. Trim 3 verbose descriptions in `scripts/system-mcp.js` so total 39-tool surface stays under `BUDGET_CHARS = 37922`.
- **N1 (CLI `--dev` Flag Ordering & Help):** Detect subcommand via `const cmd = process.argv.slice(2).find((a) => !a.startsWith('-'))` in `bin/akimcp.js` so `akimcp --dev temp-token ...` works; handle `-h`/`--help` in `scripts/temp-token-cli.js`.
- **N2 (Verification Commands & Execution Checklist):** Include `scythe.py`, `release_lint.py --latest .`, and `plan_lint.py` in §6.2, plus §7 Execution Checklist.
- **N3 (Live Origin Getter, DOM XSS Safety, Shared Proxy Helper & Test Receipts):** Pass live `getOrigin` getter from `start.js` -> `gatekeeper.js` -> `streamable-bridge.js` -> `createToolsServer`; use only DOM APIs (`createElement`/`textContent`/`createTextNode`, 0 `innerHTML`) in `public/panel-client.js`; share `scripts/temp-token-proxy.js` between CLI and MCP tool; pass valid `receipt` on `aki__temp_token` calls in tests.

---

## 1. Pillar 1 — Named Temporary Token (`name` Identity & Schema)

### 1.1 Storage Model & In-Memory Schema (`scripts/oauth.js`)
- Keep `tempTokens` **in-memory only** (`docs/plan/done/web-chat-client.md` D1: restarting AkiMCP revokes every temporary token).
- Extend the `tempTokens` value record:
  ```js
  // Map<sha256Hex, { name: string | null, created: number, expires: number, revoked: boolean, lastAddress: string | null, lastAgent: string | null, lastSeen: number | null }>
  ```
- **Validation & Sanitization (`coding.C5` — `normalizeTempTokenName(raw)`):**
  1. If `raw === undefined || raw === null`, return `null`.
  2. If `typeof raw !== 'string'`, throw `new Error('temp token name must be a string')`.
  3. Normalize Unicode via `.normalize('NFC')`, strip C0/C1 control characters and line separators (`/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g` -> `' '`), collapse whitespace (`/\s+/g` -> `' '`), and `.trim()`.
  4. If empty after trimming, return `null`.
  5. Enforce length cap: `Array.from(clean).length <= 48` codepoints (`MAX_TEMP_NAME_CHARS = 48`) and `Buffer.byteLength(clean, 'utf8') <= 128` bytes (`MAX_TEMP_NAME_BYTES = 128`). Exceeding throws `new Error('temp token name must be at most 48 characters (128 UTF-8 bytes)')`.
- **Case-Insensitive Live-Name Uniqueness (M3):**
  - If `name !== null`, check whether any currently **live** temp token (`!entry.revoked && entry.expires >= now`) has `entry.name && entry.name.toLowerCase() === name.toLowerCase()`.
  - If a live token already holds that name, throw `new Error(\`a live temporary token named "${name}" already exists; pick another name or revoke it first\`)` (HTTP `400` on `POST /api/temp-token`).
  - Once a named token expires or is revoked, its name can be reused immediately.
- **Selector Resolution (`resolveTempTokenId({ id, name, target })` — M3):**
  - Reject conflicting selectors: if both `id` and `name` are provided, throw `new Error('specify either id or name, not both')`. On `revoke`, if `all === true` and (`id` or `name` or `target` is provided), throw `new Error('specify either all or a single token (id/name), not both')`.
  - Exact `id` (64 hex chars) or unique `id` prefix (`8..63` hex chars, `/^[0-9a-f]{8,63}$/i`) across live tokens; if prefix matches >1 live token, throw `new Error('ambiguous temporary token id prefix; provide more characters')`.
  - Case-insensitive `name` match (`entry.name && entry.name.toLowerCase() === norm.toLowerCase()`) across live tokens.
  - Positional `target` (CLI `akimcp temp-token extend <target>` / `revoke <target>`): checks both live `name` (case-insensitive) and `>=8`-hex live `id` prefix; if both match different live tokens, throw `new Error(\`ambiguous target "${target}": matches both a token name and an id prefix; use --name or --id\`)`.
- **Memory & Horizon Guardrails (M3):**
  - `MAX_LIVE_TEMP_TOKENS = 64`: `mintTempToken` throws if 64 live temp tokens already exist.
  - Revoked-entry sweep when `tempTokens.size > 256`.
  - `MAX_TEMP_EXTEND_HORIZON_MS = 7 * 24 * 3600_000`: `extendTempToken` throws `new Error('cannot extend temporary token beyond 7 days from now')` if `entry.expires + TEMP_EXTEND_MS > Date.now() + MAX_TEMP_EXTEND_HORIZON_MS`.

### 1.2 Panel UI, Kickoff & Security Log
- **Panel UI (`scripts/config-page.js` & `public/panel-client.js`):**
  - Add `#tempName` input (`maxlength="48"`, placeholder `Optional name (e.g. aistudio-p60, postman)`) before **Mint temp token & copy kickoff**.
  - Render `Name` as the first column in `#tempTokenList` using pure DOM APIs (`document.createElement`, `textContent`, `document.createTextNode`, 0 `innerHTML` — N3).
  - Include `token.name` in the **Revoke** confirmation prompt.
- **Kickoff Block:** Keep `tempTokenKickoff({ origin, token, expires })` at **0 extra characters** (do not inject `NAME:` into kickoff).
- **Security Log (`scripts/oauth.js`):** Log `name=<JSON.stringify(name)>` when present alongside `id=<8hex>` on `temp_token_issued`, `temp_token_extended`, and `temp_token_revoked`.

---

## 2. Pillar 2 — External Invocation Surfaces & Security Threat Model

### 2.1 Three External Surfaces
1. **Loopback Control Panel HTTP API (`127.0.0.1:<panelPort>`, `x-panel-token`):**
   - `POST /api/temp-token` (`{ name? }`) -> `{ ok: true, id, name, token, mcpUrl, guideUrl, expires, kickoff }`
   - `GET /api/temp-tokens` -> `{ tokens, extendMinutes }`
   - `POST /api/temp-token/extend` (`{ id?, name?, target? }`) -> `{ ok: true, id, name, expires, message }`
   - `POST /api/temp-token/revoke` (`{ id?, name?, target?, all? }`) -> `{ ok: true, revoked, name?, message }`
2. **Local CLI Subcommand (`akimcp temp-token <list|mint|extend|revoke>`):**
   - Dispatched in `bin/akimcp.js` via `const cmd = process.argv.slice(2).find((a) => !a.startsWith('-'))` (N1) so `akimcp --dev temp-token ...` works.
   - Uses shared `scripts/temp-token-proxy.js` (N3) to call the live daemon over loopback HTTP using `readLock()`.
3. **In-House MCP Tool (`aki__temp_token` in `scripts/system-mcp.js`):**
   - Single multiplexed tool (`op: "list" | "mint" | "extend" | "revoke" | "revoke_self"`, `name?`, `id?`, `all?`).

### 2.2 Threat Matrix & Fail-Closed Mitigations (B1, B2, M1, M2, M3)

| Threat ID | Attack Vector | Fail-Closed Mitigation |
|---|---|---|
| **T1 — Temp-Token Privilege Escalation via `aki__temp_token`** | A chat holding a 4h temp token calls `aki__temp_token` to mint/extend/revoke tokens. | **B1 Caller Principal Isolation:** `gatekeeper.js` calls `bearerPrincipal(req.headers.authorization)` once and passes `principal` to `handleStreamableMcp(req, res, principal)`, which passes `authInfo: { token: '', clientId: principal.kind, scopes: [], extra: { caller: principal } }` into `session.transport.send`. `createToolsServer({ requireCaller: true, tempTokenMode: 'in-process', getOrigin })` fails closed if `extra?.authInfo?.extra?.caller` is missing. When `caller.kind === 'temp'`, only `op="list"` (filtered to `caller.id`) and `op="revoke_self"` are permitted; `mint`, `extend`, and `revoke` fail with `TEMP_TOKEN_FORBIDDEN`. |
| **T2 — Loopback SSRF Bypass via `aki__local_fetch` -> Panel API** | A temp-token holder calls `aki__local_fetch` targeting `http://127.0.0.1:9998/api/temp-token` (or `127.0.0.2`, `[::ffff:127.0.0.1]`, `foo.localhost`, `[::]`, custom `/etc/hosts` alias, or 3xx redirect). | **B2 Panel Port & Header Block in `scripts/fetch-mcp.js`:** `checkedUrl(url)` (async, run on initial URL and every 3xx redirect hop) computes blocked panel ports `{ getActivePanelPort(), readLock()?.panelPort, Number(process.env.PANEL_PORT \|\| (IS_DEV ? 9996 : 9998)) }` and blocks any request to those ports if normalized host matches `LOOPBACK_HOST_RE` or (for non-IP hostnames targeting a panel port) resolves via `dns.promises.lookup(host, { all: true })` to any loopback address. Also blocks `x-panel-token` header. This is the primary load-bearing boundary cutting `local_fetch -> panel`. |
| **T3 — Reading `instance.json` via `aki__run_cmd` (Defense-in-Depth)** | Passing `~/.aki/mcpsv/instance.json` to `cat`/`head`/`tail` via `aki__run_cmd`. | **M2 Hardened `refuseCredentialArgs` in `scripts/roots.js`:** Adds `INSTANCE_LOCK_PATH` to `refuseCredentialArgs`, checks both `path.resolve(cwd, candidate)` and `fs.realpathSync` (when existing), and checks the path portion after `=` in `--flag=path` arguments. (`read_text_file` continues to redact `"token"` via `redactResult`; residual `grep -ro` on `USER_DIR` is documented honestly per `security.md`). |
| **T4 — Stdio Split-Brain & Error Log Leakage** | `stdio.js` mutating its own empty RAM instead of the live daemon, or leaking raw headers in error strings. | **M1 Explicit `"proxy"` Mode & Error Sanitization:** `stdio.js` passes `tempTokenMode: 'proxy'`, which requires a live `instance.json` (`isPidAlive(lock.pid)`) and never falls back to dead in-process RAM. Proxy errors sanitize non-2xx responses to `data?.error` or `HTTP <status>`. |
| **T5 — Log / Kickoff / DOM XSS Injection & Resource Exhaustion** | Malicious `name` with control chars/HTML tags, or flooding mint/extend. | **M3 & N3:** `normalizeTempTokenName` strips C0/C1/line separators and caps at 48 chars / 128 bytes; `panel-client.js` uses only `textContent`/`createTextNode` (0 `innerHTML`); `security.log` uses `JSON.stringify(name)`; 64 live-token cap and 7-day extend horizon cap. |

---

## 3. Pillar 3 — Context, Token & Tool-Surface Optimization (M4)

- **Single Multiplexed Tool (`aki__temp_token`) + Sibling Description Trim:**
  - Trim verbose sentences in `notify_user`, `clipboard_read`, and `clipboard_write` in `scripts/system-mcp.js` (~233 chars saved) so adding `aki__temp_token` keeps total 39-tool surface under `BUDGET_CHARS = 37922`.
- **1-Line Compact JSON Responses (`JSON.stringify(res)`):**
  - `op="list"`: `{"callerKind":"access","extendMinutes":30,"tokens":[{"id":"<12hex>","name":"...","created":...,"expires":...}]}` (omitting null `lastAddress`/`lastAgent`/`lastSeen`).
  - `op="mint"`: `{"id":"<12hex>","name":"...","expires":...,"kickoff":"..."}` (no duplicate `token`/`mcpUrl`/`guideUrl`/`ok`/`message`).
  - `op="extend"`: `{"id":"<12hex>","name":"...","expires":...}`.
  - `op="revoke"` / `op="revoke_self"`: `{"revoked":1,"name":"..."}`.

---

## 4. Pillar 4 — AIObox Contract & Ecosystem Invariants

- **`BR-1` (0 `"aiobox"` in core files):** Verified across all modified/added core files.
- **`BR-2` (MCP tool schema backward compatibility):** Existing 38 tools keep identical names and input schemas; `aki__temp_token` is additive.
- **`BR-3` (`instance.json` schema):** Unchanged.
- **`check-residue.js` & `check-docs-note.js`:** No literal `aki__` in `scripts/` or `public/`; `default prefix \`aki__\`` note present in all docs touching `aki__`.

---

## 5. File-by-File Implementation Plan

1. `scripts/oauth.js`: Named temp tokens, `normalizeTempTokenName`, `bearerPrincipal`, `resolveTempTokenId`, `extendTempToken`, `revokeTempTokenTarget`, 64-live cap, 7-day extend horizon cap, security log `name=`.
2. `scripts/config-page.js` & `public/panel-client.js`: Export `GUIDE_URL`, add `#tempName` input, add XSS-safe `Name` column and revoke prompt.
3. `scripts/panel.js`: Export `getActivePanelPort()`, update `/api/temp-token*` endpoints for `name` / `id` / `target` / `all`.
4. `scripts/gatekeeper.js` & `scripts/streamable-bridge.js`: Single `bearerPrincipal` call per `/mcp` request, pass `principal` into `handleStreamableMcp(req, res, principal)`, forward SDK `authInfo` to `session.transport.send`, configure `createToolsServer({ requireCaller: true, tempTokenMode: 'in-process', getOrigin })`.
5. `scripts/tools-server.js`, `scripts/provider-registry.js`, `scripts/stdio.js`: Forward `options` to provider `register(proxy, options)`; `stdio.js` passes `{ tempTokenMode: 'proxy' }`.
6. `scripts/temp-token-proxy.js` (new) & `scripts/system-mcp.js`: Shared proxy/in-process dispatcher with sanitized errors; register `aki__temp_token` with fail-closed `requireCaller` check, `caller.kind` AuthZ before dispatch, and 1-line compact JSON output; trim 3 sibling descriptions.
7. `bin/akimcp.js`, `scripts/temp-token-cli.js` (new), `scripts/cli-flags.js`: Flag-order-independent `temp-token` CLI subcommand + `--help`.
8. `scripts/fetch-mcp.js` & `scripts/roots.js`: B2 async `checkedUrl` panel-port loopback + DNS + `x-panel-token` block; M2 `refuseCredentialArgs` hardening for `instance.json`, `realpathSync`, and `--flag=path`.
9. Tests & fixtures: `test/temp-token.test.js`, `test/fetch-mcp.test.js`, `test/roots.test.js`, `test/system-mcp.test.js`, `test/fixtures/surface-default.json`, `test/fixtures/surface-default-aiobox.json`.
10. Docs: `README.md`, `docs/feat/tools.md`, `docs/feat/security.md`, `docs/index.md`, `CHANGELOG.md`.

---

## 6. Verification Plan (`test.A1–A3`, `docs.B2–B4`, `release.A1–A5`)

### 6.1 Unit & Security Test Matrix
- `test/temp-token.test.js`: Named mint, NFC, control-char stripping, >48 chars / >128 bytes, case-insensitive duplicate live name, reuse after revoke/expiry, conflicting selectors, 8-hex prefix & ambiguity, 64 live cap, 7-day extend cap, panel HTTP routes, CLI `akimcp temp-token` (including `--dev temp-token` and `--help`), MCP tool `aki__temp_token` caller isolation (`access` vs `temp` vs `requireCaller` fail-closed).
- `test/fetch-mcp.test.js`: B2 blocks on panel port (`127.0.0.1`, `127.0.0.2`, `[::ffff:127.0.0.1]`, `foo.localhost`, `[::]`, 3xx redirect to panel port) and `x-panel-token` header while allowing non-panel localhost dev ports.
- `test/roots.test.js`: M2 `refuseCredentialArgs` blocks `instance.json`, symlink to `instance.json`, and `--file=.../instance.json`, while `read_text_file` still reads `instance.json` with redacted token.

### 6.2 Sequential Gate Commands (Run Strictly One at a Time)
1. `npm test`
2. `node test/lint/check-docs-note.js`
3. `node test/lint/check-residue.js`
4. `python3 ~/.claude/skills/akiflow/scripts/scythe.py`
5. `python3 ~/.claude/skills/akiflow/scripts/release_lint.py --latest .`
6. (Upon Post-Impl Audit PASS when moving plan to `docs/plan/done/`): `python3 ~/.claude/skills/akiflow/scripts/plan_lint.py docs/plan/done/named-temp-token-external-api.md`

---

## 7. Execution Checklist

- [x] Update `docs/plan/named-temp-token-external-api.md` with Pre-Impl Ruling (`B1–B2`, `M1–M4`, `N1–N3`).
- [x] Implement named temp tokens, selector resolution, 64-live cap, 7-day extend cap, and `bearerPrincipal` in `scripts/oauth.js`.
- [x] Update Panel UI (`scripts/config-page.js`, `public/panel-client.js`) and Panel HTTP API + `getActivePanelPort()` (`scripts/panel.js`).
- [x] Implement B1 fail-closed caller propagation via SDK `authInfo` (`scripts/gatekeeper.js`, `scripts/streamable-bridge.js`, `scripts/tools-server.js`, `scripts/provider-registry.js`, `scripts/stdio.js`).
- [x] Implement shared `scripts/temp-token-proxy.js`, MCP tool `aki__temp_token` + sibling description trim (`scripts/system-mcp.js`), and CLI `akimcp temp-token` (`bin/akimcp.js`, `scripts/temp-token-cli.js`, `scripts/cli-flags.js`).
- [x] Implement B2 panel-port SSRF block (`scripts/fetch-mcp.js`) and M2 `refuseCredentialArgs` hardening (`scripts/roots.js`).
- [x] Add unit & security tests (`test/temp-token.test.js`, `test/fetch-mcp.test.js`, `test/roots.test.js`, `test/system-mcp.test.js`) and update surface fixtures (`test/fixtures/surface-default*.json`).
- [x] Sync product docs (`README.md`, `docs/feat/tools.md`, `docs/feat/security.md`, `docs/index.md`, `CHANGELOG.md`) and pass all 5 sequential verification gates.
