# CLI client facts: re-check the agy loading claims and the kiro rows, add the `claude mcp add` and `codex mcp add` lookups

Status: open, not scheduled. Carried from `audit-tool-drift-oct25.md` (P5 boxes 1, 4 and 5) at the 3.1.0 gate, 2026-10-26. None of it blocks the release.

## Why it waits

`claude`, `codex` and `kiro-cli` are off the default shell allowlist, so their `--help` cannot be read from a tool call, and the agy loading checks need a shell that runs `agy` directly. An owner shell does all three.

## Work

- [ ] `docs/ref/fact-agy-mcp-config.md`: re-run CLI-1 to CLI-5 against the installed agy (1.4.7 at carry time) and IDE-1 to IDE-3 against the installed IDE; every claim that changes lands as an `## Amendments` entry in `docs/research/agy-mcp-config-ide-cli.md` first, then the stamp is rewritten (`docs.A6`).
- [ ] `docs/ref/`: a lookup doc for `claude mcp add` (scope `local` by default, `-s user`, `--transport http`, `--header`) and `codex mcp add`, each with the date its `--help` was read. The panel's Apply buttons and the README connector sections depend on these.
- [ ] `docs/ref/harness-fact.md`: re-run the kiro rows against the installed `kiro-cli` (2.16.2 at carry time, rows last run 2026-08-09) and rewrite the dates.

## Verification

Nothing run yet.
