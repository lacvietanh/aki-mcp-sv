# Plan — npm Trusted Publishing through GitHub Actions OIDC

Status: active · named by the owner 2026-10-29 (deferred before that: 2026-10-24 "deffered/wishlist", 2026-10-26 out of 3.1.0). `release.yml` is rewritten (verify → publish → release). Open: the owner saves the trusted publisher on npmjs.com immediately before tagging the next release (a saved configuration expires if no publish succeeds within 2 days), then the first tag release proves it. Until that release succeeds, `npm publish` by hand with the owner's login stays the fallback.

## Goal

Publish `@akinet/akimcp` from the existing bare-semver tag release path without an interactive OTP or a long-lived npm credential. GitHub Actions authenticates to npm with an ephemeral OIDC token; no `NPM_TOKEN` is stored in GitHub, the repository, environments, or local release instructions.

## Current state

- `package.json` declares `@akinet/akimcp`, public npm access, Node `>=22`, and repository `https://github.com/lacvietanh/aki-mcp-sv.git`.
- `.github/workflows/release.yml` runs on bare semver tag pushes and creates the GitHub Release from the tagged `CHANGELOG.md` section.
- The existing tag trigger remains the release boundary. Publishing must finish before GitHub Release creation so a failed npm publish never produces a release record for an unavailable package.

## One-time npm configuration

In npm package settings for the existing `@akinet/akimcp` package, add a GitHub Actions trusted publisher with these exact values:

| npm field | Value |
|---|---|
| GitHub organization or user | `lacvietanh` |
| Repository | `aki-mcp-sv` |
| Workflow filename | `release.yml` |
| Environment name | blank, unless the workflow is deliberately bound to a GitHub Environment |
| Allowed actions | direct `npm publish` enabled (npm docs 2026-10-29: `npm stage publish` is always allowed, direct publish is a separate choice) |

- The filename is only `release.yml`, not `.github/workflows/release.yml`.
- Confirm the actor configuring the package has package publish permission and the package is already associated with the npm scope `@akinet`.
- Remove any legacy `NPM_TOKEN` and OTP-related GitHub Actions secrets after a successful OIDC release. Never replace them with an environment secret.

## Workflow change

Update `.github/workflows/release.yml` only:

1. Keep `push.tags: ['[0-9]+.[0-9]+.[0-9]+']`; it matches the repository's bare-semver tag convention.
2. Three jobs, each with only its own permissions (workflow level `permissions: {}`): `verify` (`contents: read`), `publish` (`contents: read`, `id-token: write`), `release` (`contents: write`). Do not grant broader permissions.
3. Split so no third-party code runs where the OIDC token exists: `verify` runs `npm ci` and `npm test`; `publish` installs no dependency and only runs `npm publish` from the tagged checkout (the package has no install, prepare or prepack script).
4. `verify` asserts `package.json` version equals `${GITHUB_REF_NAME}`, that the tag's `CHANGELOG.md` has the matching heading, then installs the packed tarball into a temp directory and checks that `akimcp --stdio` answers `initialize` with the tag as `serverInfo.version`.
5. `publish` uses GitHub-hosted runners, Node `22.14.0`, and installs npm `11.21.0` (trusted publishing needs `>=11.5.1`; Node 22.14.0 ships an older npm). Third-party actions are pinned by commit SHA.
6. `npm publish` runs with no `NPM_TOKEN`, `--otp` or interactive input, and is skipped when the registry already has the version (rerun-safe). `publishConfig.access: public` stays; no `--provenance` flag, trusted publishing supplies it.
7. After publishing, `npm view @akinet/akimcp@${GITHUB_REF_NAME} version` is polled up to five times and must equal the tag.
8. `release` runs only after `publish` succeeds, with the existing tagged-CHANGELOG notes and compare-link logic, and stays idempotent.

## Release process

1. Complete the normal release preparation: release artifacts and package version agree, tests pass, and the `CHANGELOG.md` version section is final.
2. Create and push the existing-format bare semver tag, for example `2.0.3`; do not publish from a workstation and do not provide an OTP.
3. GitHub Actions validates, publishes with OIDC, verifies the registry, then creates the GitHub Release.
4. Treat the release as complete only when the Actions job succeeds, `npm view` returns the tag version, and npm shows trusted-publisher provenance for the package version.

## Failure and rollback

- Before `npm publish` fails: correct the workflow, npm trusted-publisher fields, or package contents; rerun the same tag workflow. Do not create a GitHub Release manually while the package is absent.
- `npm publish` rejects OIDC: confirm the exact npm publisher fields, workflow filename, repository owner, tag-triggered ref, `id-token: write`, and npm version; retry only after correction.
- Publish succeeds but later verification or GitHub Release creation fails: do not republish the burned version. Rerun the workflow to complete verification/release creation; use `npm view` as the source of truth.
- A published package version is immutable. Roll forward with a new semver version for a package defect; do not unpublish or reuse the version as normal recovery.
- Emergency stop: disable/remove the npm trusted publisher or the workflow publish step, then investigate. Restore only after the trust configuration and workflow diff are reviewed. No token fallback is permitted.

## Verification checklist

- [ ] npm trusted publisher exactly matches `lacvietanh` / `aki-mcp-sv` / `release.yml` and has no environment binding unless intentionally configured.
- [ ] Workflow grants only required `contents: write` and `id-token: write` permissions.
- [ ] Workflow contains no `NPM_TOKEN`, `NODE_AUTH_TOKEN`, OTP secret, `--otp`, or interactive publish path.
- [ ] CI runs install, tests, `npm pack --dry-run`, tag/version/CHANGELOG consistency checks, `npm publish`, and registry verification in order.
- [ ] A test release shows npm provenance and `npm view @akinet/akimcp@<version> version` returning `<version>`.
- [ ] The GitHub Release is created only after the registry verification succeeds.

## Scope

This plan does not publish, alter a package version, change application code, commit, push, or configure npm/GitHub remotely. It schedules the later npm settings and workflow change.
