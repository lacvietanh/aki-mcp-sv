# Plan — npm Trusted Publishing through GitHub Actions OIDC

Status: wishlist · deferred, not started (owner 2026-10-24: "cái npm trusted pub là deffered/wishlist rồi"); `npm publish` with the owner's OTP stays the release step until the owner names this plan.

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

- The filename is only `release.yml`, not `.github/workflows/release.yml`.
- Confirm the actor configuring the package has package publish permission and the package is already associated with the npm scope `@akinet`.
- Remove any legacy `NPM_TOKEN` and OTP-related GitHub Actions secrets after a successful OIDC release. Never replace them with an environment secret.

## Workflow change

Update `.github/workflows/release.yml` only:

1. Keep `push.tags: ['[0-9]+.[0-9]+.[0-9]+']`; it matches the repository's bare-semver tag convention.
2. Retain `contents: write` for `gh release create` and add `id-token: write` at job or workflow scope. Do not grant broader permissions.
3. Use a GitHub-hosted runner, check out the tagged commit with full history, set up Node `>=22.14.0`, and install npm `>=11.5.1` before publishing because that npm version supports trusted publishing.
4. Run `npm ci`, `npm test`, `npm pack --dry-run`, then install and exercise the packed tarball in CI's temporary directory; fail before publish on any error.
5. Assert `package.json` version equals `${GITHUB_REF_NAME}` and that the tag's `CHANGELOG.md` contains the matching version heading.
6. Run `npm publish` with no `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `--otp`, or interactive input. Keep `publishConfig.access: public`.
7. Verify the registry after publish with `npm view @akinet/akimcp@${GITHUB_REF_NAME} version`; it must equal the tag.
8. Create the GitHub Release only after that verification, retaining the existing tagged-CHANGELOG notes and compare-link logic. Make the release step idempotent for a successful workflow rerun.
9. Do not add `--provenance`: trusted publishing supplies provenance automatically.

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
