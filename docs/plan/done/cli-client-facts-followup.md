# CLI client facts: re-check the agy loading claims and the kiro rows, add the `claude mcp add` and `codex mcp add` lookups

Status: closed 2026-10-28 with no run, every box struck with its reason below. Carried from `audit-tool-drift-oct25.md` (P5 boxes 1, 4 and 5) at the 3.1.0 gate, 2026-10-26. Reopen if a connector break is traced to how agy or kiro-cli loads MCP servers, or `claude mcp add` / `codex mcp add` changes its flags (the panel's Apply then fails and says so).

## Why it waited

`claude`, `codex` and `kiro-cli` are off the default shell allowlist, so their `--help` cannot be read from a tool call, and the agy loading checks need a shell that runs `agy` directly. An owner shell does all three.

## Work

- [x] struck: the fact doc already names the version each claim was read on (stamp and the 2026-10-25 re-check line), so it is dated, not wrong; `agy_run` ran live on agy 1.4.7 on 2026-10-26 (`audit-tool-drift-oct25.md` § Verification), and no consumer waits on a re-run · `docs/ref/fact-agy-mcp-config.md`: re-run CLI-1 to CLI-5 against the installed agy (1.4.7 at carry time) and IDE-1 to IDE-3 against the installed IDE; every claim that changes lands as an `## Amendments` entry in `docs/research/agy-mcp-config-ide-cli.md` first, then the stamp is rewritten (`docs.A6`).
- [x] struck: the `claude mcp` argv lives once, in `scripts/config-page.js` (snippets) and `scripts/panel.js` (Apply), and `test/connector-apply.test.js` asserts it with a fake `claude` on `PATH`; Codex Apply edits `config.toml` itself and runs no `codex mcp add`; a `--help` copy in `docs/ref/` would be a second copy that drifts (`pattern.A1`) · `docs/ref/`: a lookup doc for `claude mcp add` (scope `local` by default, `-s user`, `--transport http`, `--header`) and `codex mcp add`, each with the date its `--help` was read. The panel's Apply buttons and the README connector sections depend on these.
- [x] struck: the kiro rows keep their 2026-08-09 date, which says when they were true; `kiro_read`'s model id was re-confirmed in `kiro-cli chat --list-models` on 2026-10-25 (`audit-tool-drift-oct25.md` § Audit result) · `docs/ref/harness-fact.md`: re-run the kiro rows against the installed `kiro-cli` (2.16.2 at carry time, rows last run 2026-08-09) and rewrite the dates.

## Verification

Nothing run: closed by reading the code, the tests and the dated fact docs.
