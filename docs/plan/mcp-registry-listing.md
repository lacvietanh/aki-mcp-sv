# Plan — list `@akinet/akimcp` in the Official MCP Registry

Status: active · local part done 2026-10-04 (P1·W2, T5): `mcpName`, `server.json`, `akimcp --stdio`, `test/registry-listing.test.js`; publishing waits for the next release and the owner's `mcp-publisher login github`.

## Goal

Get akimcp a canonical, namespace-verified record in the Official MCP Registry so registry-fed clients and directories (PulseMCP, Smithery and others, per third-party sources) can discover it, without waiting on any per-vendor review.

## Current state

- npm: `@akinet/akimcp` latest published is `2.2.0` (registry.npmjs.org, 2026-10-04); the tree is `3.0.0`, unpublished. `package.json` carries `mcpName: io.github.lacvietanh/akimcp` from 3.0.0 on (published versions are immutable, so the first listable one is the next release).
- GitHub: `https://github.com/lacvietanh/aki-mcp-sv`.
- `server.json` in the repo root (schema 2025-12-11): one npm package entry, `transport: stdio`, argument `--stdio`; not in the npm `files` list (the Registry reads it from the publisher, and `mcpName` from the tarball).
- Shape: a per-user self-hosted gateway. Each user runs it on their own machine and exposes it through Tailscale Funnel or a Cloudflare tunnel with OAuth 2.1 (`package.json` description; ingress plans under `plan/done/`). There is no single production URL shared by all users.
- Gemini and Grok already connect as custom OAuth+DCR connectors, not through a directory (`plan/done/integrate-gemini-grok.md`).
- `docs/biz/` does not exist; the USP in the `package.json` description is falsifiable and is reused below.

## Steps

1. Choose the registry name (see Decisions) and add `"mcpName": "<name>"` to `package.json`. The Registry validates an npm package by reading `mcpName` from it, and the name must equal `server.json` `name`.
2. Ship the change in the next normal release. A published npm version is immutable, so `2.1.0` cannot carry `mcpName`; the release follows `plan/npm-trusted-publishing.md` and the version rules in `release.A`. Do not cut a release only for this.
3. Install `mcp-publisher` (pre-built binary or `brew install mcp-publisher`), run `mcp-publisher init` in the repo root, then edit `server.json`: `name` = `mcpName`, `version` and `packages[0].version` = the just-published npm version, `repository` = the GitHub URL above with `source: github`.
4. Set the `server.json` `description` to the falsifiable USP in one short sentence (whitelist-only shell, not a blocklist; claude.ai gets local filesystem/search/shell over Funnel + OAuth 2.1). Check the schema's length limit for `description` first, since the current `package.json` description is long.
5. Authenticate: `mcp-publisher login github` for an `io.github.*` name, or DNS authentication for a domain-based name.
6. `mcp-publisher publish`, then verify with `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>"`.
7. About a week later, check PulseMCP, Smithery and Glama; claim the Glama listing (GitHub OAuth) and, if PulseMCP has not picked it up, email the Registry name, GitHub URL, version and description to `hello@pulsemcp.com` (per a maintainer discussion, third-party).
8. Follow-up, not part of this plan: automate registry publishing after the npm publish in `release.yml` (the docs have a GitHub Actions page, not yet read).

## Decisions

- **Name `io.github.lacvietanh/akimcp`.** Decided (P1·W2 2026-10-04, owner: no extra questions) · because the GitHub namespace is verified by the account that owns the repo, with no DNS key to keep, and `mcp-publisher login github` is the one owner step · rejected `top.akimcp/akimcp` (DNS TXT + key management for the same proof) · reopen if the repo moves to an organisation or the listing must carry the domain brand (a new name = a new listing).
- **Transport `stdio` through `akimcp --stdio`.** Decided · because a registry client spawns the npm package; plain `npx @akinet/akimcp` starts the gateway and turns on Tailscale Funnel, which no installer should do, while `scripts/stdio.js` (AGY's entry) serves the same tools in-process with no network and no token · rejected a `streamable-http` package entry on `http://127.0.0.1:9999/mcp` (needs a running gateway and a pasted token), `remotes` (no shared URL) · reopen if the Registry or a major client stops spawning stdio packages.
- **Version: the next normal release.** `server.json` `version` and `packages[0].version` move with `package.json` (the test fails otherwise); no release only for this (`release.A`).

## Open questions (read before step 3)

- ~~`server.json` `packages[].transport`~~: resolved, `stdio` via `akimcp --stdio` (Decisions).
- Whether `server.json` must ship inside the npm tarball: the quickstart validates `mcpName` in `package.json` only, so `files` in `package.json` is expected to stay unchanged; confirm at first publish.
- Whether the same version can ever be re-published: a third-party source says no; the official docs were not found to state it. Treat each `publish` as final.

## What listing gives and does not give

- Gives: a namespace-verified metadata record, API-searchable, ingested by downstream catalogs (third-party claim), and a canonical URL to cite.
- Does not give: a place in Claude's Connectors Directory or ChatGPT's plugin directory; a review; traffic. The Registry is a metadata feed and is still in preview (breaking changes or data resets possible).
- Discoverability by LLM browsing depends on server-rendered docs, question-shaped headings, `Organization` schema with `alternateName` and `sameAs` on `akimcp.top` (`seo.B`), not on this listing.

## Deferred channels and why

| Channel | Blocker for akimcp as it stands |
|---|---|
| Claude Connectors Directory (`claude.ai/directory/manage`) | Needs one production Streamable HTTP endpoint with OAuth 2.1 + PKCE, annotated tools, docs and a privacy policy; akimcp has one URL per user. Local MCPB is no longer accepted. |
| OpenAI plugin portal (ChatGPT and Codex) | Needs one production HTTPS URL, domain verification at `/.well-known/openai-apps-challenge`, verified publisher identity, tool annotations with justifications, test cases. Local or temporary tunnels are refused. |
| Gemini, Grok | No submission channel found; they already connect as custom connectors. |

Reopen when a hosted multi-tenant or narrow-scope remote variant of akimcp exists.

## Sources (read 2026-09-28)

- Registry quickstart, fetched in full: `https://modelcontextprotocol.io/registry/quickstart` (`mcpName`, `server.json`, `mcp-publisher`, GitHub auth namespace rule).
- Claude directory submission and OpenAI plugin submission: search-result snippets only, pages not fetched: `https://claude.com/docs/connectors/building/submission`, `https://developers.openai.com/plugins/deploy/submission`.
- Third-party guides for downstream ingestion (PulseMCP, Smithery, Glama): unverified against vendor docs.

## Verification checklist

- [ ] `package.json` `mcpName` equals `server.json` `name`; `server.json` versions equal the published npm version.
- [ ] `npm view @akinet/akimcp@<version> mcpName` returns the chosen name.
- [ ] The `curl` search against the Registry API returns the record.
- [x] Transport open question resolved and `server.json` matches what `npx @akinet/akimcp --stdio` actually starts (`test/registry-listing.test.js` spawns it and reads `initialize`).
- [ ] One week later: PulseMCP, Smithery, Glama listing state recorded in this doc or its successor.

## Scope

Local part (steps 1, 3 and 4, without `mcp-publisher init`) is in the tree. Left: the release carrying `mcpName`, then steps 5–8 by the owner.
