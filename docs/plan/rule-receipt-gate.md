# Plan — rule receipt gate

Status: implemented, tested (`test/rule-gate.test.js`) and checked live 2026-10-04 (owner restart): `aki__run_cmd` without receipt came back `RULE_RECEIPT_MISSING` with the step; after `aki__akidevrule_context` the same call with `receipt=` ran.

## Problem

`aki__akidevrule_context` returns a receipt, but nothing asked for it: `knownReceipt` only lets the tool answer `unchanged` (`scripts/rule-context.js`), and `rule-context-handshake.md` Gates 0/1 only remind the AI to call the tool. An AI that skipped the rules, or lost them to a compaction, still called every write tool.

## Outcome

Every tool that acts refuses a call that does not carry the receipt of the rules in force:

- **Gated:** every tool whose `annotations.readOnlyHint` is not `true`: `aiobox_write`, `write_file`, `edit_file`, `move_file`, `run_cmd`, `task_start`, `task_manage`, `kill_port`, `clipboard_write`, `chrome_*`, `devtools_*` that act, `fetch`, the Postman writes, `agy_run` when it may write, and any later tool that does not say it is read-only.
- **Not gated:** read-only tools (`read_text_file`, `aiobox`, `git`, `sqlite_*`, `kiro_read`, …) and `akidevrule_context` itself.
- **Refusal:** a tool error `RULE_RECEIPT_<CODE>: … call aki__akidevrule_context, then call this tool again with receipt=<the sha256:… it returns> (a schema of this tool without receipt is stale: reconnect AkiMCP first)`. Codes: `MISSING`, `INVALID` (not `sha256:<64 hex>`), `UNKNOWN` (not issued by this server since it started), `STALE` (the rules changed since), `UNCHECKED` (the rules could not be read; never let through).

## Decided

| # | Decision | Why |
|---|---|---|
| D1 | One check in `mountProviders` (`scripts/provider-registry.js`) via `scripts/rule-gate.js`, keyed on `readOnlyHint !== true` | Every provider goes through that proxy, so no tool is forgotten and a new provider is gated without knowing it; `readOnlyHint` is already held true only where the tool cannot write by mechanism (`test/tool-surface.test.js`). |
| D2 | A common optional argument `receipt` added to each gated tool's input schema; the wrapper checks it and strips it before the tool sees its input | The call itself carries the proof, so an AI that lost its context after a compaction must load the rules again; no tool code changes. Optional in the schema so a missing receipt reaches our refusal with its next step instead of the SDK's bare `-32602`. |
| D3 | Valid = issued by this server **and** still what the same `akidevrule_context` call returns now (same `mode`, `workingPath`) | The receipt already hashes the content and provenance of every rule source (`rule-context.js`); re-running the assembler is a stat of each dependency while the cache holds, so a rule edit makes the old receipt `STALE` at the next call, with no watcher. |
| D4 | Issued receipts held in memory only (newest 200) | A file would be readable by `read_text_file`, a way around loading the rules. A restart forgets them: the next write is refused `UNKNOWN` with the step to reload, which is cheap and also refreshes a model whose context may be stale. |
| D5 | Degraded results (a required source missing) still issue a receipt | The receipt names the rules as they are on this machine; refusing every write when one optional global file is missing would block all work without making anyone read more rules. |
| D6 | `akidevrule_context` output says `Every tool that acts needs receipt=<receipt>`, and its description and the server instructions carry the rule | The model learns the argument where it gets the receipt; the error repeats it at the first refusal. |

## Rejected

- **Bind the receipt to the MCP session.** Notion opens a new session per call (`tool-calls.jsonl` `client` changes every call), and a session outlives a compaction, so it would neither hold nor catch a lost context.
- **A client header.** Web clients cannot add headers; `baggage`/`traceparent` name the turn, not the chat (D3 check, 2026-10-04).
- **A required `receipt` in the schema.** The SDK refuses with a generic validation error that does not say to call `akidevrule_context`; a client on an old schema could not send it at all.
- **A `receipt` argument written into each tool by hand.** Drifts as tools are added; one wrapper cannot.
- **Persisting issued receipts to the data dir.** See D4.
- **Accepting any receipt whose global part matches.** The receipt is one opaque hash of global + project sources; splitting it would change the published receipt format for no gain over D3.

## Limits

- An AI could copy a receipt another chat printed; it is still the receipt of the rules in force. The gate stops forgetting, not a deliberate forger.
- A client holding an old tool schema has no `receipt` argument: it is told to reconnect AkiMCP (guide step 9).

## Done

- [x] `scripts/rule-gate.js` (check, schema, wrapper), wired in `scripts/provider-registry.js`; `scripts/rule-context-mcp.js` records issued receipts and names the argument.
- [x] `test/rule-gate.test.js`: every code, the same-call re-check, schema only on gated tools, a refused write writes nothing, a read needs no receipt, a project `CLAUDE.md` edit makes the receipt stale and a reload passes; `credential-redaction` and `streamable-bridge` tests carry a receipt; `tool-surface` budget raised for the argument.
- [x] Live (2026-10-04, after the owner's restart): a write without receipt is refused with the step, and one with the receipt passes.
