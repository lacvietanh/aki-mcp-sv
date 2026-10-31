# Plan — accurate AI usage from `chrome_probe_ai`

Status: dropped 2026-09-30 by owner decision, not executed. `aki__chrome_probe_ai` was removed: it depended on three vendors' private web APIs, so keeping it accurate meant per-vendor maintenance that does not last. Reopen if a model must auto-switch accounts on quota exhaustion without AIObox.

## Goal

`aki__chrome_probe_ai` returns the 5h and 7d usage a person would read off the provider, as normalized numbers with a stated source, and never a fabricated figure. Today it returns raw provider JSON that is all-null for free Claude accounts.

## Evidence (measured 2026-09-28, one live claude.ai tab, free plan, over CDP)

- `/api/organizations/<org>/usage` returned 200 with `five_hour`, `seven_day` and every other window `null`, `limits: []`. `/rate_limits` returned only per-model `concurrents` limiters. `/api/bootstrap` gave `rate_limit_tier: default_claude_ai` and `rate_limit_upsell: upgrade_to_pro`.
- The real figure was in `localStorage`: one key under the prefix `claudeai.` holding `{utilization: 0.64, resetsAt: 1790590200, atWall: false}`, resetting about 3.7 h after the read, so a 5h window at 64%. No weekly bucket existed.
- `chrome_probe_ai` on the same tab failed with `path.organization_uuid: ... found 9` and reported `plan: "free"`. Nine characters is `undefined`, and `'free'` is what the pre-fix code printed for a missing `org.plan`. Inference, not verified: the running akimcp process predates the org-resolution fix that sits under `[Unreleased]` in `CHANGELOG.md` (npm `2.1.0` does not contain it).
- Reference implementation: AIObox desktop, `src-tauri/src/cdp/probe.rs` (`observe_script`, Claude branch) collects the org from the `lastActiveOrg` cookie, `/usage`, and the `localStorage` buckets; `src-tauri/src/usage/mod.rs` (`parse_usage_endpoint`, `parse_claude_local_storage`) normalizes them. Its own comment states that free accounts get all-null windows from `/usage` and that the `localStorage` key name is obfuscated and rotates, so buckets are matched by value shape.

## Current state of `scripts/cdp-engine.js::probeAi`

- Claude: resolves the org from the cookie (unreleased fix, `CHANGELOG.md` `[Unreleased]` › Fixed), calls `/usage`, returns the body unchanged. No `localStorage` fallback, so a free account yields all-null.
- Defects in that branch, read from the code on 2026-09-28: (a) `orgId = cookieOrgId || org.uuid || org.id` while `org` falls back to `orgList[0]`, so a cookie that matches no listed org mixes one org's name and plan with another org's usage; (b) the `/usage` fetch sits in `catch {}` and never checks the HTTP status, so a failed call looks the same as an all-null body; (c) the tab is recognised by `href.includes('claude.ai')`, which also matches a URL that merely contains that text.
- Plan is `rate_limit_tier` verbatim (`default_claude_ai`), not a `free|pro|max5|max20` label, and the fallback chain still ends in `|| 'free'`, which prints a plan nothing reported.
- Tab choice: the tool description says "auto-detects AI tab", but with no `targetId` the engine takes the first page target of any URL (`selectTarget`), so a non-AI first tab yields `provider: 'unknown'`.
- ChatGPT and Grok: raw `wham/usage` and `rate-limits` bodies, no 5h/7d mapping.
- Tests: `test/chrome-mcp.test.js` asserts only that the tool is registered. The page script cannot be unit-tested as written because collection and interpretation share one string.

## Steps

1. **Confirm the stale-process cause before changing code.** Restart akimcp from the working tree, rerun `chrome_probe_ai` on a claude.ai tab, and expect the org error to disappear. If it persists, the cause is not the stale process and step 2 starts with that.
2. **Split collect from interpret.** The page script returns only raw facts: the cookie org id; the org's name and tier fields only when the cookie id matches a listed org (no `orgList[0]` guess: no match means `orgResolved: false`); the `/usage` HTTP status and body text; and every `localStorage` value, under any key, that parses as JSON with numeric `utilization` and `resetsAt`. Matching is by value shape, not by the `claudeai.` prefix, because AIObox records the key name as obfuscated and rotating and the prefix may rotate too; the scan is capped in key count and value size, and only matching buckets leave the page. The tab is recognised by `location.hostname`, not `href.includes`. A new pure Node module (`scripts/ai-usage.js`) turns that into the result; it is the unit-testable part.
3. **Claude normalization rules in that module** (rules taken from AIObox, verified there by its own tests, not re-derived here, except the two marked *changed here*):
   - An endpoint window that is an object wins over any bucket.
   - Otherwise a bucket with at most 5 h left to `resetsAt` (small tolerance) is the session (5h) window and one with more than 5 h left is the weekly (7d) window; `utilization` is a 0-1 fraction, so multiply by 100; `resetsAt` is epoch seconds (`1790590200` is a 2026 date), and a value that only makes sense as milliseconds is ignored. *Changed here:* AIObox uses a 24 h cut-off, which would label a weekly bucket in its last day as the session window, since a 5h window cannot be more than 5 h from reset. This is reasoning, not a live check; reopen if a live capture shows a session bucket with more than 5 h left.
   - A bucket whose `resetsAt` is already past is reported `stale: true` with `pct: null` and the last value under `lastPct`, because the window has reset and the number no longer describes now.
   - All-null endpoint and no bucket gives `pct: null`, `source: 'none'`. It is never `0`.
   - Map the plan with the AIObox heuristics (`20x`/`max_20` to `max20`, `5x`/`max_5` to `max5`, `plus`/`pro` to `pro`, `free`/`default` to `free`, tested in that order) and keep the raw string in `planRaw`. *Changed here:* an unmatched string gives `plan: null` with `planRaw` kept, and no field at all gives both `null`; the `|| 'free'` fallback is deleted.
4. **Result shape:** `{provider, loggedIn, orgResolved, orgName, plan, planRaw, usageStatus, session: {pct, resetsAt, stale}|null, weekly: same|null, source: 'usage_endpoint'|'claude_local_storage'|'none', raw}`. `usageStatus` is the `/usage` HTTP status or an error string, so a failed call is distinguishable from an all-null body. `raw` keeps today's provider body so existing callers do not lose data.
5. **Real AI-tab detection.** With no `targetId`, choose page targets whose URL host is `claude.ai`, `chatgpt.com` or `grok.com`. One match: probe it. Several: probe each and return one result per tab with its `targetId` and title. None: return an explicit `no AI tab` result instead of `unknown`. An explicit `targetId` still wins. The host test uses the target's parsed URL host, and the in-page script repeats it with `location.hostname`.
6. **ChatGPT and Grok normalization (second, separable slice).** WHAM windows are assigned to 5h or 7d by `limit_window_seconds`, not by the `primary_window` and `secondary_window` names; Grok maps `remainingQueries` and `totalQueries` to a used percentage. AIObox records the ChatGPT live capture as not yet verified, so this slice ships only with a live check, or is marked unverified in the tool description.
7. **Tests.** Add fixtures for `normalize`: all-null plus a 0.64 bucket, an endpoint object window, a session bucket plus a weekly bucket, an expired bucket, all-null plus no bucket, a two-org cookie choosing the right org, a cookie that matches no listed org (`orgResolved: false`, no name or plan taken from another org), a `null` `resetsAt` shape that must be ignored, a single bucket with 10 h left (weekly, not session), a `resetsAt` in milliseconds (ignored), and a non-200 `/usage` (`usageStatus` set, not reported as all-null). Register the new test file in the explicit list in the `package.json` `test` script.
8. **Docs and tool text.** Update the `chrome_probe_ai` description in `scripts/chrome-mcp.js` (output shape, `localStorage` fallback, the `source` field) and `docs/feat/tools.md`. When step 3 is verified live, record the `localStorage` bucket shape as `docs/ref/claude-usage-fact.md` (named like the existing `docs/ref/harness-fact.md`) with its research origin (`docs.A6`); it is a claim about a vendor internal, so it needs that trail.

## Decisions recorded

| Decision | Choice | Reason | Reopen if |
|---|---|---|---|
| No-data reporting | `pct: null`, never `0` | On the measured account the endpoint said all-null while the true figure was 64%, so null does not mean unused. AIObox's endpoint parser turns null into 0%. | A source proves null always means unused for some plan. |
| Share code with AIObox | No, keep two implementations aligned by copying fixtures | Different languages (Rust and JS) in separate repos; a shared package fails the Rule of Three (`pattern.A2`). | A third consumer appears. |

## Risks

- The `localStorage` bucket is an undocumented claude.ai internal. Its key name rotates, possibly including the prefix, and its shape can change. Matching by shape and falling back to `source: 'none'` bounds the failure to "no figure", not a wrong one. Fixtures cannot detect an upstream change, so step 3 needs a live check each time it is touched.
- The probe only reads. It must never write `localStorage` or send a chat message.

## Verification checklist

- [-] (dropped with the tool, 2026-09-30) After step 1, a live probe on the free-plan tab resolves the right org with no `undefined` in the request path.
- [-] (dropped with the tool, 2026-09-30) Live: the returned session percentage equals the bucket read directly with `devtools_eval` at the same moment, and rises after one more message in that chat (the person sends that message by hand; the probe never does).
- [-] (dropped with the tool, 2026-09-30) Live: a multi-tab session (one non-AI tab first) returns the AI tab, not `unknown`.
- [-] (dropped with the tool, 2026-09-30) Fixture tests for step 7 pass and are part of `npm test`.
- [-] (dropped with the tool, 2026-09-30) A paid-plan account is probed once to confirm the endpoint-window path and the weekly window; until then that path is unverified live.
- [-] (dropped with the tool, 2026-09-30) `docs/feat/tools.md`, the tool description and `CHANGELOG.md` `[Unreleased]` describe the new shape.

## Scope

This plan changes no code, tests, `package.json` or `CHANGELOG.md`. It schedules the later work.
