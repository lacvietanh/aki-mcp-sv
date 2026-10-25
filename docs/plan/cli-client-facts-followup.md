# CLI client facts: re-check the agy loading claims, add the `claude mcp add` and `codex mcp add` lookups, finish the `agy_run` live check

Status: open, not scheduled. Carried from `done`-bound `audit-tool-drift-oct25.md` (P5 boxes 4 and 5, P6 live check) at the 3.1.0 gate, 2026-10-26. None of it blocks the release.

## Why it waits

`claude` and `codex` are off the default shell allowlist, so their `--help` cannot be read from a tool call, and the agy loading checks need a shell that runs `agy` directly. The `agy_run` default call and `effort=xhigh` spend model quota, which the owner decides. An owner shell does all three.

## Work

- [ ] `docs/ref/fact-agy-mcp-config.md`: re-run CLI-1 to CLI-5 against the installed agy (1.4.7 at carry time) and IDE-1 to IDE-3 against the installed IDE; every claim that changes lands as an `## Amendments` entry in `docs/research/agy-mcp-config-ide-cli.md` first, then the stamp is rewritten (`docs.A6`).
- [ ] `docs/ref/`: a lookup doc for `claude mcp add` (scope `local` by default, `-s user`, `--transport http`, `--header`) and `codex mcp add`, each with the date its `--help` was read. The panel's Apply buttons and the README connector sections depend on these.
- [ ] `agy_run` on a real MCP client: one default call and one `effort=xhigh` call; paste the result lines under § Verification. `list=models`, `list=capabilities` and an unknown model were checked on 2026-10-26.

## Verification

Nothing run yet.
