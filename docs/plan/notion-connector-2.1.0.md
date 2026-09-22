# Notion connector compatibility on 2.1.0

## Goal and boundaries

Add Notion's custom MCP connector to the existing Node ESM server without changing its runtime architecture, settings, tool names, dependencies, release version, or local-first behavior. The operator workflow belongs in [the Notion connector guide](../ref/notion-connector.md).

The change is limited to these ten files:

- `scripts/oauth.js`
- `scripts/gatekeeper.js`
- `scripts/config-page.js`
- `test/notion-oauth.test.js`
- `package.json` — insert the new test immediately after the existing OAuth test only
- `README.md`
- `CHANGELOG.md` — entries under the existing Unreleased heading only
- `docs/index.md`
- `docs/ref/notion-connector.md`
- `docs/plan/notion-connector-2.1.0.md`

The supplied `public/img/providers/notion.png` is binary and therefore not in the diff. It must be copied into the repository manually when applying the patch. Do not replace or regenerate it. Panel styles, panel client JavaScript, the startup orchestrator, and the MCP bridge remain unchanged.

## Six protocol behaviors

1. **Exact-hostname redirects.** Keep existing provider predicates intact. Accept a Notion callback only after URL parsing confirms HTTPS, an exact allowlisted hostname, no userinfo, and no literal fragment marker. DCR retains exact registered-URI matching at authorization time.
2. **Confidential DCR.** Share one authentication-method constant across registration and both metadata lists. Generate secrets for both confidential methods, omit them for public clients, and reject unsupported methods.
3. **Basic authentication.** Share credential extraction and authentication between token issuance and revocation. A present header is authoritative, including when malformed. Decode Base64, split at the first colon, then form-decode each half. Require a stored secret for confidential clients and compare it with `timingSafeEqual`. Use own-property lookup for DCR IDs. Return the Basic challenge for failed Basic attempts.
4. **Scope round-trip.** Trim scope at authorization, escape the hidden form value, retain it on the code, and pass it to token issuance. Persist and return only non-empty scope. Refresh defaults to the stored scope and can narrow it, never widen it; persist successful narrowing without rotating the refresh token.
5. **RFC 7009 revocation.** Advertise the endpoint and authenticate with the same helper. Look up refresh records before access records. Revoke only an owned or ownerless held token; cascade only to explicitly linked access records owned by the same client. Persist before returning the same empty success response for owned, foreign, unknown, and repeated tokens.
6. **Discovery and dispatch.** Add the suffixed OpenID discovery alias. Build a method/path route map with a single ingress guard, leaving local MCP, static files, preflight, and fallback behavior untouched. Log request paths without query strings.

Keep diagnostic events rather than deleting them. Rejected registration callbacks disclose only origins, not userinfo, paths, or query credentials. Log known grant/challenge classifications instead of arbitrary submitted strings.

## Panel integration

Add one Notion URL constant, a button in the existing Web group, and a matching pane. Reuse the current markup and tab switching. Explain workspace enablement and approval, the MCP URL, passphrase consent, adding the connection to an agent, and republishing. Explain self-registration without pasted client credentials. Postman stays active by default.

## Persistence and rollback

Do not change token loading. No migration, startup write, reset, hashing, encryption, or refresh rotation is introduced. New access records add explicit client ownership and a refresh link; refresh records gain scope only when non-empty. The access-token lifetime and existing expiry cleanup remain unchanged.

Legacy access records have no reliable grant link. Revoking a legacy refresh token therefore cannot sweep them. A held ownerless token can be revoked individually, but absent ownership on another record is never evidence that it belongs to the caller. Present null or empty owners are not absence. Document those limits rather than trying to reconstruct ownership.

Rollback is a code reversal with the current data retained. Older readers tolerate extra fields, but the new protocol support disappears. Reversing code does not undo revocation or revoke extant grants; restoring stale token backups could resurrect grants and is not part of rollback.

## Regression strategy

Use a plain async Node-core test with cleanup in `finally`, temporary data, fresh server processes, ephemeral HTTP ports, and real requests. Keep it runnable before dependency installation. Test-only module hooks isolate the unchanged MCP bridge and desktop-control imports; OAuth, gatekeeper dispatch, panel rendering, and static serving use their actual modules. These doubles do not establish tool execution or desktop integration behavior.

Eleven numbered cases cover:

1. All exact Notion hostnames, lookalikes, scheme, userinfo, fragments, and the unchanged existing provider rules; retain mandatory S256 checks.
2. Secret issuance for both confidential methods, omission for public clients, and rejection of unsupported methods.
3. Percent and plus form-decoding of both Basic halves, first-colon splitting, header precedence, body-only credentials, malformed input, and challenges on both endpoints.
4. Escaped consent scope, code exchange, stored scope, refresh defaults, empty omission, narrowing, and widening rejection.
5. Isolated grant revocation, uniform responses, token validation, metadata, foreign ownership, access-only revocation, and refresh-first lookup.
6. Every OAuth route with and without ingress, discovery aliases, and unchanged preflight, static, local MCP, wrong-method, and unknown-route behavior.
7. Populated 2.1.0 token and DCR fixtures across fresh loads, reloads, writes, and revocations; compare bytes and modification times to detect startup rewrites; preserve unlinked and ownership-ambiguous records.
8. The Web-group Notion tab, default Postman tab, setup copy, and byte-identical served icon.
9. Unknown and prototype-named clients, credential-free diagnostics, retained rejection origins, and query-free request logging.
10. Pre-upgrade refresh records that carry no scope: they keep refreshing when the client still sends `scope`, record it on first use, and narrow only afterwards, while a grant explicitly narrowed to an empty scope still rejects widening.
11. Panel grant isolation: the panel mints and reuses its own local access token, and a connector revoking its own grant leaves that token and its local client configurations working.

The existing repository test command also runs the new test immediately after `test/oauth.test.js`.

## Delivery checks

- Run `node --check` on every repository JavaScript file and report the count.
- Run the standalone regression before dependency installation and retain its entire output.
- Attempt `npm ci` and `npm test`; report blockers and partial results rather than implying a pass.
- Generate a unified diff over only the ten allowed paths.
- Check strict whitespace application against an untouched 2.1.0 copy, apply, and check reverse application.
- Compare every delivered full file byte-for-byte with the applied result.
- Confirm the version, dependency declarations, lockfile, existing redirect predicates, S256 requirement, icon, and protected files are unchanged.
- Review delivery text for confidential execution details and report the scan result without disclosing matching private values.

Live Notion workspace approval, connection, tool execution, and agent republishing require an operator acceptance pass. Automated HTTP tests do not substitute for that external verification.
