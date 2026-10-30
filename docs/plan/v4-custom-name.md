# AkiMCP 4.0.0: a configurable name, tool names that follow it

Status: draft 2026-10-29, not started. Plan only: no code, no release. Starts at P0 when the owner names it. This file is the one home of the name model: nothing in it points at a file outside the repo; the research tables the builders need are copied in as Appendices A to D.

Conclusion: the owner types one value, the Display name. The Server ID and the Tool prefix follow from it by a written rule (REQ-4), and each can be set by hand instead (REQ-6). Keeping all three defaults changes nothing for anyone: every served byte equals 3.3.1, no reconnect, no new "Always allow".

## Goal and requirements

Owner request (2026-10-29, thread root), each fragment quoted and mapped to the phases that answer it.

| REQ | Owner words | Answered by |
|---|---|---|
| REQ-1 | "thực hiện nghiên cứu" | Appendix A (every site), B (12 clients), C (12 contracts); P0 sources what the research could not |
| REQ-2 | "lên plan chi tiết về kế hoạch nâng cấp lên bản 4" | this document; version 4.0.0 (D1); P0 to P8 |
| REQ-3 | "khả năng custom cả Name" | P2 identity, P6 panel field |
| REQ-4 | "các tool bên trong cũng đổi name theo cả lõi luôn" | P2 derivation (slug, stem) so tools follow the Display name; P3 every tool name and every text that names a tool; P4 log |
| REQ-5 | "cân nhắc kỹ mọi khía cạnh của việc này" | What breaks, Appendix C, P4 to P8, Not in v4, DEFERRED |
| REQ-6 | "linh hoạt tối đa về cách đặt tên mcp" | P2 (each field overridable, empty prefix allowed), length budgets, P0 ceilings |
| REQ-7 | "mà không phải edit mã nguồn" | P2 reads `setting.json`; P6 panel field; P3 verify renames with no source edit |

## Decisions

- D1 · version 4.0.0 · because the owner named it, and because 3.x implicitly promised "tools are always `aki__*`, the connector always contains `akimcp`" and AIObox, the labs launcher and prompts lean on it (Appendix C, C1 C3 C4); withdrawing a promise others rely on is a major change even when the defaults stay · reopen if the owner says 3.x.
- D2 · "Name" means what clients see of this instance: Display name, Server ID, Tool prefix. The npm package, domain, OAuth realm and brand stay AkiMCP.
- D3 · several instances side by side (own port, data dir, lock) are not in v4 · reopen if the owner says multi-instance is the goal.
- D4 · at the default identity every served string is byte-identical to 3.3.1 (proved by the P1 fixtures), so nobody who keeps the defaults gets an "Always allow" prompt again.
- D5 · one home for the identity: `setting.json`, read once per process, applied on restart, never live. `scripts/stdio.js` children are separate processes that read the same file when they start; a flag or env would not reach them.
- D6 · no alias for the old names: 38 tools would become 76, client approvals double, AIObox compares tool lists by name, and an alias saves nothing because "Always allow" must be granted again for the new name anyway · reopen if a client is shown to forbid removing an approved tool.
- D7 · no new field in `instance.json` for AIObox: AIObox already reads `serverInfo` and `tools/list`. CLAUDE.md "Stable core" holds: nothing here is done for an AIObox feature; the AIObox side is DEFERRED.
- D8 · the Display name is free text (letters of any language with their accents, digits, space and `. _ -`, starting with a letter or digit, 1 to 40 characters after NFC), not shaped to fit any AIObox macro · because Stable core forbids shaping AkiMCP around an AIObox feature · rejected a forced "AkiMCP first" title and a separate label field · the panel warns when AIObox auto-connect would miss the name (D12).
- D9 · the length ceiling is split in two so an update can never invalidate a saved name: a name budget (Server ID plus Tool prefix at most 28) checked on the identity alone, and a tool budget (every bare tool name at most 29) checked by a repo test. 7 + 28 + 29 = 64 · rejected a boot check that reads the tool list (a longer tool added by an update would flip a user's names back to `aki__` out of sight), rejected truncation (a guess) · reopen if P0 sources a ceiling where 28 + 29 does not fit, or a tool needs 30.
- D10 · an invalid identity (only a hand edit or a connected AI writing `setting.json` can make one) serves the defaults, prints one boot line, and shows a red panel row with Reset. It does not refuse to start, because that would take the repair surface down with it · rejected serving zero tools (same outage, louder).
- D11 · Apply deletes or overwrites a client entry only when its key is in `applied.keys` (written by Apply only) AND the entry points at this machine's AkiMCP (loopback `/mcp` on any port, or this checkout's `scripts/stdio.js`). It refuses to write the current key over an entry that is not ours, and refuses to run while an identity problem shows · rejected record-only (one AI writing `["github"]` would delete another server) and target-only (it would touch any local `/mcp` server).
- D12 · the AIObox auto-connect warning runs AIObox's own test on the Display name (lowercased, whitespace removed, contains `akimcp`), never `slug()` · because `slug()` drops `-`, so `Aki-MCP` would look safe while AIObox misses it.

## The identity (what P2 builds)

The user types one value, the Display name. Server ID and Tool prefix follow it, so renaming the server renames every tool (REQ-4); either can be set by hand instead (REQ-6). All three live in `setting.json` under `identity`; a field that is not set follows the rule below.

| Field | Meaning | Value when not set by hand | Rule |
|---|---|---|---|
| Display name | `serverInfo.title`; the connector name the panel suggests for web AIs | `AkiMCP` | stored NFC, then must match `^(?!.*\p{Default_Ignorable_Code_Point})[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd} ._-]{0,39}$` with the `u` flag (letters of any language with their accents, digits, space, `. _ -`; starts with a letter or digit; 1 to 40 characters; no default-ignorable character, that is no blank filler such as U+3164, invisible joiner such as U+034F, zero-width or direction character). So no `<`, newline, control or invisible character can pass, which closes `</script>` reaching the panel's inline script (`scripts/config-page.js:677`) and look-alike names such as U+200B, U+3164 or U+202E inside `AkiMCP`. Shown with its derived Server ID and Tool prefix before Save; escaped wherever shown; never inserted into any text sent to an AI |
| Server ID | `serverInfo.name`; the key Apply writes into Claude Code, Codex, Cursor, Claude app, agy, Postman | `slug(Display name)` | `^[a-z][a-z0-9]*$` (no `-`: agy drops it; no `.` or `]`: they break the Codex table; no `_`: `__` splits `mcp__server__tool`) |
| Tool prefix | served tool name = Tool prefix + bare name | `stem(slug(Display name)) + "__"` | empty, or `^[a-z][a-z0-9]*__$` |
| remembered keys | every key Apply has written into a client | `aki-mcp`, `akimcp` | `setting.json` `applied.keys`, written by Apply only (P5), outside `identity`, so Reset never clears it |

One pure function, `resolveIdentity(settings.identity)` in `scripts/mcp-name.js`, applies the rule and returns `{ identity: { name, key, prefix }, problem }`:

- `slug(s)`: NFKD (the Display name is stored NFC first; NFKD splits accents and also folds fullwidth letters and ligatures), drop combining marks (`\p{M}`), lowercase, map the letters NFKD leaves whole through one closed table of lowercase keys (`đ` to `d`, `ø` to `o`, `ß` to `ss`, `ı` to `i`, `æ` to `ae`, `œ` to `oe`, `ł` to `l`, `þ` to `th`, `ð` to `d`, `ħ` to `h`, `ŧ` to `t`, `ŋ` to `n`), keep only `[a-z0-9]`, then drop leading digits. A letter outside the table is dropped; the Server ID preview shows the result before Save. A slug that is empty is a problem on Server ID: "set it by hand".
- `stem(x)`: drop a leading `akimcp` when what is left starts with a letter; otherwise drop one trailing `mcp` when at least one character is left; otherwise nothing. Why the first branch: the default is AkiMCP and the natural edit appends a word (`AkiMCP Office PC` is 14 + 16 = 30 characters of Server ID and prefix, over 28; with the strip it is 14 + 10 = 24).

Every row below is a named case in `test/identity.test.js` (P2):

| Display name | Server ID | Tool prefix | one served tool | why it is in the table |
|---|---|---|---|---|
| `AkiMCP` (default) | `akimcp` | `aki__` | `aki__run_cmd` | byte for byte as 3.3.1 |
| `Aki MCP` | `akimcp` | `aki__` | `aki__run_cmd` | same slug as the default, renames no tool, needs no reconnect |
| `AkiMCP Work` | `akimcpwork` | `work__` | `work__run_cmd` | leading `akimcp` stripped: the default plus an appended word |
| `AkiMCP Office PC` | `akimcpofficepc` | `officepc__` | `officepc__run_cmd` | fits 28 (24) only because of the strip |
| `WorkMCP` | `workmcp` | `work__` | `work__run_cmd` | trailing `mcp` stripped |
| `MCP` | `mcp` | `mcp__` | `mcp__run_cmd` | stem keeps at least one character; valid |
| `AkiMCP 2` | `akimcp2` | `akimcp2__` | `akimcp2__run_cmd` | stripping the leading `akimcp` would leave `2__`, invalid, so it is not stripped |
| `2 AkiMCP` | `akimcp` | `aki__` | `aki__run_cmd` | the leading digit is dropped, so the pair equals the default; the preview shows it |
| `1 Office`, `2 Office` | `office` | `office__` | `office__run_cmd` | two names, one pair; the preview shows it, and Apply refuses a clash in a shared client |
| `ＡｋｉＭＣＰ` (fullwidth) | `akimcp` | `aki__` | `aki__run_cmd` | NFKD folds it |
| `AkiMCP™` | none | none | none | U+2122 is category So, outside the charset: refused (S9g), defaults served |
| `Máy Mac` | `maymac` | `maymac__` | `maymac__run_cmd` | Vietnamese, marks dropped |
| `Đà Nẵng` | `danang` | `danang__` | `danang__run_cmd` | `Đ` mapped through the table |
| `4Work` | `work` | `work__` | `work__run_cmd` | leading digit dropped, no dead end |
| `Æble` | `aeble` | `aeble__` | `aeble__run_cmd` | `Æ` lowercased, then through the table |
| `Œuvre` | `oeuvre` | `oeuvre__` | `oeuvre__run_cmd` | same |
| `Þór` | `thor` | `thor__` | `thor__run_cmd` | `þ` to `th` |
| `STRAẞE` | `strasse` | `strasse__` | `strasse__run_cmd` | capital `ẞ` lowercases to `ß` before the table |
| `Ðóra` | `dora` | `dora__` | `dora__run_cmd` | `ð` to `d` |
| `Ħal` | `hal` | `hal__` | `hal__run_cmd` | `ħ` to `h` |
| `Ŧur` | `tur` | `tur__` | `tur__run_cmd` | `ŧ` to `t` |
| `Ŋga` | `nga` | `nga__` | `nga__run_cmd` | `ŋ` to `n` |
| `123`, `Мой` | none | none | none | empty slug: a problem on Server ID, "set it by hand"; never a guess |
| `Laptop văn phòng` | `laptopvanphong` | `laptopvanphong__` | none | 14 + 16 = 30 over 28: refused, see Length |

Length. The 64-character ceiling (`mcp__<Server ID>__<tool>`; 7 = `mcp__` + `__`) is an ASSUMPTION until P0 and is held as constants in `scripts/mcp-name.js` (`CEILING` 64, `NAME_BUDGET` 28, `TOOL_BUDGET` = CEILING - 7 - NAME_BUDGET = 29). Under the 60-character reading (Server ID + tool at most 60) the pair gives 28 + 29 = 57, still inside.

- Name budget: `len(Server ID) + len(Tool prefix) <= 28`, the prefix counting its own `__`. Checked by `resolveIdentity` on the identity alone, live at the Display name field. Save is refused while it fails, with: "Server ID and Tool prefix together are {n} characters, 28 at most. Shorten the Display name, or set Tool prefix by hand in Customize fields."
- Tool budget: every bare tool name `<= TOOL_BUDGET`, checked by `test/tool-surface.test.js` over every provider the registry can list with Postman and AIObox present. Longest today: `postman_rename_conversation`, 27 (`list_allowed_directories`, 24, without Postman).
- No check reads the tool list at boot. A new tool that is too long fails the repo test before release; an update cannot turn a saved, valid name invalid.

Hand-set values. A Server ID or Tool prefix set by hand stops following the Display name. On Save, when the new Display name would change the Server ID or Tool prefix that are serving now, the panel offers one click to keep them; the click writes the serving values as hand-set values (no extra field). "Reset to AkiMCP" clears all three; when the serving names are not the defaults it is a rename too, so the same notice shows and Save commits it. The red row's "Reset to AkiMCP" saves at once, since the defaults are already serving.

Where it is read (D5). `scripts/mcp-name.js` computes `IDENTITY = resolveIdentity(readSettings().identity)` at import, exposing `IDENTITY`, `IDENTITY_PROBLEM` (what `resolveIdentity` refused, or `null`) and `served(bare)` = prefix + bare. The main process reads it once at start (restart to change). Every `scripts/stdio.js` child (Claude app, agy) imports the same module from `createToolsServer()` and reads `setting.json` when that child starts, so a stdio client spawned after Save serves the new name before the restart, while URL clients (web AIs, Claude Code, Codex, Cursor) get it after the restart. The panel says so (S7b, S8a). Every start prints `Serving as {Display name} · Server ID {key} · tools {prefix}*`.

Invalid identity (D10): the process serves the defaults, prints one boot line naming field, value and rule, and the panel shows a red row with Reset. AI-facing text stays the default bytes. The panel page's inline script only ever receives a validated name (an invalid one serves `AkiMCP`), and the red row shows the refused value as escaped text, never inside a `<script>`.

Known gap, not widened: a main process started with a custom `AKI_MCP_DATA_DIR` has its own `setting.json`, while a stdio child reads the default data dir's. The same gap exists today for folders.

## What breaks, and for whom

Keeping all three defaults: nothing. No reconnect, no re-allow, AIObox untouched (D4). Appendix C holds the 12 contracts behind this table.

| When | What breaks | Who acts |
|---|---|---|
| Any rename, including Reset to AkiMCP from a non-default name | web connectors list tools again; Claude asks "Always allow" again; Notion workspaces read `tools_stale` once | user, once |
| Tool prefix changes | prompts and guides that call `aki__akidevrule_context` (council templates, AIObox prompt, akimcp.top guide) name a tool that no longer exists; one bridge sentence in the rule-context tool's description and in `instructions` covers it (untested until V1, P8) | AkiMCP (P3); owner runs V1 |
| Tool prefix changes | the AIObox labs ClickUp launcher checks the exact name `aki_mcp__aki__akidevrule_context` and a count of 36; 15 Super Agents would need re-binding | AIObox side, DEFERRED |
| Display name lacks `akimcp` (AIObox's own test, D12) | the AIObox Claude connector finder misses the connector it created | panel warns; fix is AIObox-side, DEFERRED |
| Server ID changes | entries stay under the old key in Claude Code, Codex, Cursor, agy until Apply removes them | Apply (P5) |
| Downgrade to 3.x while renamed | 3.x ignores the setting and serves `aki__*` again | user: set the defaults back first |
| Two machines in one AI account, both Display names containing `akimcp` | the AIObox macro deletes the other machine's connector (it only loses configuration, reconnect fixes it) | panel warning; AIObox-side, DEFERRED |
| A stdio child (Claude app, agy) starts between Save and restart | it serves the new name while URL clients still serve the old | S7b says so |

## Phases

Each phase lists files, tests (file + case), a verify command that can be pasted, and a done-when. Commands run from the repo root; each verify is one command with no pipe, `;`, `&&`, `&`, `$(...)` or loop, because the builders' allowlist rejects them, so a check that needs a filter is a node test or a script under `test/lint/` or `test/fixtures/`, and the filter lives once, in it. No phase edits AIObox, and none changes AkiMCP because of an AIObox feature. A change that adds an assertion states the red result first: the assertion is written, run against unchanged code and seen failing, then the change turns it green.

### P0 · Confirm client limits (docs only)

- Files: `docs/ref/fact-client-tool-names.md` (new; each claim with source, read date and research origin per docs.A6), one `docs/research/` event for the verification.
- Action: for each Appendix B row the code relies on (64 and 60 character caps, charset, `mcp__` composition), find a vendor page or run a live screen, and record it with a date. Unsourced rows stay ASSUMPTION and the constants keep 28 and 29.
- Verify: `grep -c "ASSUMPTION" docs/ref/fact-client-tool-names.md` prints the number of rows still unsourced; `grep -nE "^\| .*\| (20[0-9]{2}-[0-9]{2}-[0-9]{2}) \|" docs/ref/fact-client-tool-names.md` shows a read date on every sourced row.
- Done when: `CEILING` in P2 equals the sourced figure, or the doc records that none was found and the 64 stays an ASSUMPTION in `scripts/mcp-name.js`'s comment.

### P1 · Freeze the 3.3.1 surface (before the first code edit)

- Files: `test/fixtures/record-surface.js` (new), `test/fixtures/surface-3.3.1.json`, `test/fixtures/surface-3.3.1-aiobox.json` (new), `test/setup.js` (its drop list widens to the run-mode variables the server reads, `GATEKEEPER_PORT`, `PANEL_PORT`, `PUBLIC_ORIGIN` and `NODE_ENV`, and it maps SIGINT and SIGTERM to `process.exit(128 + n)`).
- Action: `test/setup.js` is the one place a test process is isolated (scratch HOME and data dir, no inherited `AKI_*`, `MCP_*` or run-mode variable), so no helper builds an environment of its own and nothing reaches the instance already serving this machine. Its drop list also covers the run-mode variables the server reads, and the signal mapping makes its remove-on-exit cleanup run when task_manage stops a child. `record-surface.js` imports it first, sets no environment of its own, runs with `os.tmpdir()` as its working directory, spawns `node scripts/stdio.js` directly (it binds no port), sends `initialize`, `notifications/initialized` and `tools/list` as newline-delimited JSON, and writes each fixture as `{ "initialize": <result>, "providers": { "<provider id>": [<tool>, ...] } }`, the tools grouped by the provider that registered them (`scripts/provider-registry.js`). Without a flag it writes both fixtures; with `--check` it records both again in the scratch HOME and compares them byte for byte with the committed files (exit 1 on any difference, and when the two recordings list the same tool count). It records what this machine detects, so `--check` passes on this machine only. `--deadline-ms=N` (default 30000) bounds each answer from `stdio.js`; a silent child ends the run with exit 1 and a line naming the method. `surface-3.3.1.json` is recorded with every provider the scratch HOME switches on (the opt-in providers agy and kiro stay off, because the scratch HOME holds no `setting.json`); `surface-3.3.1-aiobox.json` after creating `$HOME/.aki/aiobox/` in the scratch HOME, because the served text differs by detected provider and the AIObox text carries the most `aki__`. The unit of comparison is the tool, not the whole list, so a host with fewer providers still passes (P3 case 7). The script throws when the two recordings list the same tool count, which proves this directory is what detection reads.
- Verify: `node test/fixtures/record-surface.js --check` (exit 0 on this machine: recording again at HEAD gives both fixtures byte for byte, and the two differ).
- Done when: `node test/fixtures/record-surface.js --check` exits 0 (task_start, exit code and last 20 lines posted) and its output shows `HOME passed to the children` and `AKI_MCP_DATA_DIR passed to the children` (when set), both under the same `akimcp-test-*` directory (stdio prints no `MODE` or data-directory line and binds no port, so the helper prints the two values it passes on), and `--check --deadline-ms=1` exits non-zero with a `gave no answer` line. Both fixtures are committed on their own, before P2, with the `test/setup.js` change. Later `test/identity-served.test.js` case 7 compares the default identity with the fixtures tool by tool (P3).

### P2 · Identity module

- Files: `scripts/mcp-name.js` (becomes `resolveIdentity`, `IDENTITY`, `IDENTITY_PROBLEM`, `served(bare)`, `DEFAULT_PREFIX`, the three budget constants, `problemLine`; `MCP_NAME`, `MCP_SERVER_KEY` and `LEGACY_MCP_SERVER_KEY` stay as default-valued exports until P3 and P5 stop importing them), `test/identity.test.js` (new, pure), `test/tool-surface.test.js` (add the tool-budget case).
- Cases in `test/identity.test.js`: every row of the Display name table above (one test per row, by that row's name); Server ID and Tool prefix set by hand; empty prefix; a hand-set Server ID kept while the Display name changes; a Display name that is empty, has 41 characters, has a newline, is `</script>`, has U+200B, U+3164 or U+034F inside `AkiMCP`, has U+202E, or starts with a space (each refused, defaults served); a refused value holding ESC, BEL and U+009B prints none of them raw in the boot line S10a (every `\p{Cc}` character is written as `\uXXXX`, then the whole is JSON-quoted); a Display name, Server ID or Tool prefix that is not text (`{key:['akimcp']}`, `{prefix:['work__']}`, `{name:true}`) is refused, and `null` counts as not set; an identity that is not an object (`"Work"`, `5`, `true`, `["Work"]`) is refused with a problem on identity; each invalid input (Server ID `my.tools`, `a_b`, `My-Tools`; prefix `x_`; `123` with nothing set by hand; Server ID + prefix of 29 characters) returns the defaults plus a problem naming the field and the rule; the same name typed NFD and NFC gives one result.
- Case in `test/tool-surface.test.js`: every bare name of every provider (Postman and AIObox included) is at most `TOOL_BUDGET`; the case is shown failing first by a fixture bare name of 30 characters.
- Verify: `node --test --import ./test/setup.js test/identity.test.js test/tool-surface.test.js`.
- Done when: green; `resolveIdentity` takes no tool list; the `DEFAULT_*` identity constants are declared only in `scripts/mcp-name.js`.

### P3 · Mount, and every text that names a tool

- Files: `test/lint/check-residue.js` (new, written first), `scripts/tools-server.js:16,19` and each site in Appendix A sections A, B, B2, B3 (`rule-context-mcp.js`, `rule-gate.js`, `project-rules.js`, `shell-mcp.js`, `task-mcp.js`, `cdp-mcp.js`, `cdp-engine.js`, `chrome-mcp.js`, `chrome-profile.js`, `aiobox-mcp.js`, `config-page.js:28,147`, `prompts/postman.md` (its `akimcp tools (aki__*)` becomes `{serverId} tools ({prefix}*)`) and `postman/postman-instruction-store.cjs` with `postman/postman-daemon.cjs:206-216,320` (`loadInstructionFile()` reads the file verbatim today and substitutes nothing; P3 adds `renderInstruction(text, identity)` to the store, the one replacement of those two tokens, and the daemon calls it where it injects the first message, no template language, so the rendered text at the default identity is today's, byte for byte)). When the prefix differs from `aki__`, the description of the rule-context tool and `instructions` carry the bridge sentence S11, built from `DEFAULT_PREFIX` so it holds no `aki__` literal. ClickUp agents receive descriptions, not `instructions` (observed), so the description is the channel that must carry it.
- Tests, in `test/identity-served.test.js` (new; scratch `AKI_MCP_DATA_DIR` with `setting.json` `{identity:{name:'MacMCP'}}` written before the import):
  1. `serverInfo` equals `{name:'macmcp', title:'MacMCP'}`.
  2. `tools/list` count equals the count from `listProviders()` (never a literal 38); every name starts `mac__`, none starts `aki__`.
  3. `aki__` appears in `instructions` and in every description only inside the bridge sentence.
  4. Result-time text (critic row 5): one case per Appendix A section B2 site whose text a test can build without Chrome, AIObox or a CDP timeout reaches it with a scratch setup and dumps the returned text to the test log: the refusal `AGAIN` and the rules push line (`rule-gate.js:46,136`), the read-result suffix (`project-rules.js:213,229`), `chrome-profile.js:300,302`. Each asserts it names `mac__` tools and contains no `aki__`. The other B2 sites, the `next` hint (`cdp-engine.js:78`), `chrome-mcp.js:22` and `aiobox-mcp.js:82,393`, are covered by `check-residue.js` and by one read confirming each builds its tool name through `served()`.
  5. A receipt-gated write succeeds with the receipt and is refused without it, the refusal naming `mac__akidevrule_context`.
  6. Stdio per spawn: a child `node scripts/stdio.js` started after the file is rewritten to `{name:'WorkMCP'}` lists `work__*` while the in-process server still lists `mac__*`.
  7. Default identity (no `identity`), compared tool by tool with the P1 fixtures (`surface-3.3.1-aiobox.json` when `~/.aki/aiobox/` is present, else `surface-3.3.1.json`): every tool served equals its fixture entry byte for byte, and `initialize` equals the fixture's apart from `serverInfo.version`; every fixture tool of a provider detected on this host is served; a detected provider with no recording fails, never skips. A host without Postman passes; a host with a provider the fixture lacks fails.
  8. The Postman first message rendered at the default identity equals the `postman.md` line at HEAD byte for byte; at `{identity:{name:'MacMCP'}}` it names `macmcp tools (mac__*)` and no `aki__`.
  - `test/tool-surface.test.js:104-108` (dead-reference guard, matches `aki__[a-z0-9_]+`) is retargeted to `served()` so it keeps guarding at any prefix. The description size table in that file is untouched: the bridge sentence is served only at a non-default prefix.
- Verify: `node --test --import ./test/setup.js test/identity-served.test.js test/tool-surface.test.js test/rule-gate.test.js`, then `npm test`, then `node test/lint/check-residue.js`.
- Done when: green, and `node test/lint/check-residue.js` exits 0 printing exactly `public/panel-client.js:558` and the five lines P4 owns (`scripts/tool-call-log.js:18`, `scripts/tool-calls-report.js:9,15,17,24`); P4's done-when shrinks the list to `public/panel-client.js:558`, and P5's expects nothing. The lint runs `git grep -n aki__ -- scripts public` through `spawnSync('git', ...)` (a `git grep` with no match exits 1, which `execFileSync` would throw on) with no shell and exempts only `//` comment lines, the whole of `scripts/verify-boundary-b1.sh` (its only `aki__` lines are the echoed checklist text), `scripts/mcp-name.js` (the default constants) and `public/guide/` (default-name examples, owned by P7). Its exemptions are keyed on file and comment marker. Its expected list is keyed by file and trimmed line text, so a line added above an expected one leaves a correct tree green; it still prints `path:line` for the reader. A markdown heading in a verbatim prompt file is not exempt (no `#` rule). The lint holds its expected list as a literal and exits 1 when what is left differs from it. It holds the post-P3 list (`public/panel-client.js:558` and the five P4 lines), so its first run, before any P3 source edit, prints the 31 lines described next and exits 1: the room's proof that every line is in a class. P4 shrinks the literal to `public/panel-client.js:558` and P5 to none. It lives under `test/lint/`, outside `npm test` (a lint reads the working tree, which a tarball does not hold) and outside the shipped `scripts/`; P5 and P7 reuse it.

Before P3 the whole `git grep` lists 58 lines (51 in 25 files under `scripts/`, 7 in 2 files under `public/`, Appendix A). FACT (hands, 2026-10-29, on this plan's bytes of 13:38): the exemptions leave 31, 30 in `scripts/` (classes A, B, B2, B3) plus `public/panel-client.js:558` (58 - 18 `//` lines - 3 `verify-boundary-b1.sh` - 6 `public/guide/`). Any other count means a line is in no class.

### P4 · Log and report survive a rename

- Files: `scripts/tool-call-log.js:17-18`, `scripts/tool-calls-report.js:9,15,17,24`, `scripts/provider-registry.js` (one `isServed(name)` export), `scripts/mcp-name.js` (`announceIdentity`), `scripts/start.js`, `scripts/stdio.js`, `test/lint/check-residue.js`, `test/tool-call-log.test.js` (extend the case at line 42, `isLoggedTool logs every aki__ tool`, so it asks the registry: a registered name is logged at any prefix, `undefined` and `''` are not), `test/tool-calls-report.test.js` (extend), `test/identity.test.js` (one case for the boot line).
- Change: each log line gains `bare` (the tool's own name: one prefix per process, so `name.slice(IDENTITY.prefix.length)`, no served-to-bare map); `isLoggedTool` asks the registry's `isServed`, not `startsWith`; the log's `tool` field cap moves from 40 to `CEILING`, so a 56-character served name is logged whole; the report counts by `bare`; a line without `bare` (written before 4.0.0) has the constant `aki__` stripped. That old-line branch is removed once the 40-day keep-by-age has passed; the removal date goes in the CHANGELOG. `announceIdentity()` in `scripts/mcp-name.js` prints S10a (when `IDENTITY_PROBLEM` is set) then S10, through `console.error` only (stdout is the JSON-RPC channel on stdio), and is called once from `scripts/start.js` and once from `scripts/stdio.js`, never from `createToolsServer`. `test/lint/check-residue.js` compares on file and trimmed line text, and its expected literal shrinks to the one `public/panel-client.js` line. The change is additive to the D9 log shape (`docs/plan/done/akimcp-tool-refactor.md`).
- Tests: a log mixing pre-4.0 lines (`aki__aiobox`, no `bare`) and 4.0 lines (`mac__aiobox`, `bare`) counts one AIObox total; a logged call at prefix `mac__` writes `tool:'mac__run_cmd', bare:'run_cmd'`. Red first: both fail on the unchanged code.
- Verify: `node --test --import ./test/setup.js test/tool-call-log.test.js test/tool-calls-report.test.js`.
- Done when: green, and a renamed server still writes log lines.

### P5 · Apply and snippets

- Files: `scripts/panel.js:9,57-78,122-123,138-141,339,353-356`, `scripts/config-page.js:142-178,302,447-458,677`, `public/panel-client.js:558` (the Tools column strips the active prefix, not the literal `^aki__`; after P5 the file holds no `aki__` literal, or the P7 lint lists it), `test/connector-apply.test.js` (extended), `test/aiobox-contract.test.js:17,82`, `test/lint/check-residue.js` (its expected list becomes none).
- Why extend `test/connector-apply.test.js` and not a new file: it already owns Apply for Codex, Cursor and Claude Code (`ROUTES['POST /api/codex-apply']` and its siblings, a fake `claude` on `PATH`, HOME isolated by `test/setup.js`), so the new cases share its fixtures. There is no `test/panel-apply.test.js`.
- Change: snippets and Apply use the Server ID (D11). Apply removes a remembered key from a client only when that entry is ours; refuses to write the Server ID into a client where an entry of that name exists and is not ours, naming the client; refuses while an identity problem is showing (S9j); reports each old key it kept (S9k); records the key it wrote. `aiobox-contract.test.js:82` asserts that `name` and `key` contain `akimcp` under the default identity only.
- Existing cases that must change: the retired-key fixtures in `connector-apply.test.js` write `url = "x"` for the old `aki-mcp` entry. Under D11 that entry is not ours and would survive, so the fixture url becomes `http://127.0.0.1:9999/mcp`; the diff says so.
- New cases (scratch HOME, red first): A then B then C leaves no client holding A or B; a foreign `github` entry is never removed or overwritten, even when a hand edit puts `github` in `applied.keys`; an `akimcp` entry pointing at another machine's URL survives and Apply says it kept it; key `github` over a foreign `github` entry is refused with the client named; Apply is refused while `setting.json` holds an invalid `identity`.
- Verify: `node --test --import ./test/setup.js test/connector-apply.test.js test/aiobox-contract.test.js`.
- Done when: green; the existing default-identity cases still pass with only the fixture urls changed; `git grep -n "aki__" public/panel-client.js` prints nothing, and `node test/lint/check-residue.js` exits 0 printing nothing.

### P6 · Panel: where the user sets the name

- Files: `scripts/config-page.js` (section 1), `public/panel-client.js`, `test/panel-identity.test.js` (new, same `ROUTES` style as `connector-apply.test.js`), `test/fixtures/start-scratch.js` (new).
- Behavior: the field replaces the read-only "MCP Name" row; walk the Panel walkthrough below for the exact text and order. The derived Server ID and Tool prefix show before Save (so a look-alike letter cannot slip through); the AIObox auto-connect warning runs D12's test; the one-click keep on Save (beside Save or inside the notice is the builder's layout choice).
- Tests: with `setting.json` holding the Display name `</script><script>alert(1)</script>`, the page serves `AkiMCP` in its script block and the red row shows the refused value as text; Save with keep writes the serving Server ID and Tool prefix as hand-set values, and after a restart the served tool names are unchanged; Reset to AkiMCP from a serving non-default name shows the S8 notice and writes only on Save, while the red row's Reset writes at once; the C1 warning shows for `Aki-MCP` and `WorkMCP` and stays silent for `AkiMCP Work` and `Aki MCP`; each S9 error shows for its input and disables Save; Reset clears `identity` and leaves `applied.keys`.
- Verify (no source edit between steps):
  1. `node --test --import ./test/setup.js test/panel-identity.test.js`.
  2. Hands runs `node -e "console.log(require('fs').readdirSync(require('os').tmpdir()).filter(n=>n.startsWith('akimcp-test-')).length)"` and posts the number; port_status on 19998 and 19999 shows nothing. Then hands starts `node test/fixtures/start-scratch.js` with task_start. It imports `test/setup.js` first, sets no environment of its own, runs with `os.tmpdir()` as its working directory (so no `.env` is read) and always passes `--no-browser --dev --port 19999 --panel-port 19998`. Its task log shows `MODE: development (ports: gate :19999, panel :19998)`, `data directory:` under an `akimcp-test-*` directory, `MCP_SKIP_BROWSER_OPEN set`, no `already running` and no `loaded environment from .env`. Development mode only reads the Tailscale funnel status and never writes it (`scripts/start.js`, dev branch), so the `MODE: development` line replaces any funnel before/after check. The ux seat opens `http://127.0.0.1:19998`, walks steps 1 to 11 of the walkthrough and compares each on-screen text with the quoted string.
  3. Hands stops it with task_manage; port_status on 19998 and 19999 then shows nothing (no child left) and the `node -e` count above prints the same number as before.
- Done when: every walkthrough step shows its exact text and the next action; a step that needs a guess fails the phase.

### P7 · Docs and release notes

- Files: `test/lint/check-docs-note.js` (new), `README.md` (23 lines of `aki__`: defaults stay, one R2 note at the start of the tools section), `public/guide/mcp-http/v1.md` (stays v1, R3's three added sentences), `docs/feat/tools.md`, `docs/feat/security.md`, `docs/feat/session-file.md`, `docs/arch/provider-toolkit.md`, `docs/arch/rule-context-delivery.md`, `docs/ref/fact-agy-mcp-config.md` (stamp rewritten), `CLAUDE.md` § Process topology, `docs/index.md` (7 `aki__` lines: the R2 note once, and the plan's one line), the comment at `scripts/provider-registry.js:67` and the comment at `scripts/mcp-name.js:1`, `CHANGELOG.md` (entries under `## [Unreleased]`; P7 adds no version heading and does not bump `package.json`).
- The `## [Unreleased]` block of `CHANGELOG.md` carries S18 under `### Added` and the "What breaks" rows under `### Changed`.
- Verify: `node test/lint/check-docs-note.js` exits 0, i.e. every file that names `aki__` also carries the default-prefix note (R2 or R3), apart from the listed exceptions; on failure it prints each file without the note. The lint lists the files with `git grep -l aki__` over `README.md docs public CLAUDE.md` minus the exceptions below, tests each for `default prefix .aki__|aki__. by default`, runs `git` through `execFileSync('git', ...)` with no shell, and lives beside `check-residue.js`.

  Exceptions, never edited: `docs/plan/ss-session-file.md` (8 lines) and `docs/plan/per-client-tool-surface.md` (1 line), two active plans written at the default names ("No action: written at default names"), `CHANGELOG.md` released blocks, `docs/plan/done/`, `docs/research/` (history, docs.B2), `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` (modified by another session; its twin lives in the AIObox repo; DEFERRED) and this plan. Every doc under docs.A4 stamps shows the new date and version.
- Done when: `node test/lint/check-docs-note.js` exits 0 and `node test/lint/check-residue.js` still exits 0 printing nothing.

### P8 · Live checks (owner-run: they spend session quota)

- V1: with a prefix other than `aki__`, one ClickUp Super Agent and one claude.ai chat, each given a prompt that still calls `aki__akidevrule_context`, from boot to the first receipt-gated write. Pass: both call `<prefix>akidevrule_context` and the write is not refused. Until it passes, C3 reads "designed, not verified".
- V2: Postman with a non-default prefix, using the safe-flag probe `scripts/postman/debug/postman-probe-instruction-flag.js`. Pass: the flag rate does not rise against the default sentence (the wording of `prompts/postman.md` is what keeps Postman's safety check quiet, `postman-daemon.cjs:29`).
- V3 (builder, local, no quota): the default-identity diff of P1, run again at release: `node --test --import ./test/setup.js test/identity-served.test.js` case 7.

## Panel walkthrough (the P6 spec)

Strings are in Appendix D (S-numbers); this order is what the builder walks, from a default user to the repair of a bad value. The panel is English only. Example name: `Work Laptop`, giving Server ID `worklaptop` and Tool prefix `worklaptop__` (10 + 12 = 22, under 28).

1. **Open section 1, default user.** Sees S1 "Display name" holding `AkiMCP`, S2, S3 rows `akimcp` · `aki__` · `aki__run_cmd`, the S4 preview and S7a. No Save, no Reset, no notice. Does nothing; nothing changes.
2. **Type a new Display name.** S3 and S4 update on each keystroke. S8b shows "Changing the Display name also changes the Server ID and Tool prefix made from it." with the button "Keep akimcp and aki__"; under it S8 line 1, S8 line 2, and S8 line 3 when the name fails AIObox's test (`Work Laptop`, `WorkMCP` and `Aki-MCP` do; `AkiMCP Work` and `Aki MCP` do not). S5 "Save name" is enabled.
3. **Choose: new tool names, or only a new Display name.** To keep the tool names, click "Keep akimcp and aki__": the S3 rows show `akimcp` and `aki__` again, each with S3d "Use the one made from the Display name (worklaptop)", and S8 line 2 goes away; S8 line 1 is replaced by S8 line 1b. Otherwise leave it.
4. **Optional: Customize fields.** Opens the Server ID and Tool prefix inputs with S3a and S3b. A typed value stops following the Display name; S3d undoes it.
5. **Fix any error.** Each problem shows its S9 text under its field (S9a, S9b to S9d, S9e, S9f, S9g, S9g2, S9h, S9l) and Save stays disabled until none is left. The text names the fix, so no step needs a guess. Inputs to try: `Laptop văn phòng` (S9e, n = 30), `123` and `Мой` (S9l), a 41-character name (S9h), `.Work` (S9g2), a name with a line break (S9g).
6. **Click "Save name".** S8a "Saved. To serve Work Laptop to web AIs, restart AkiMCP (press Ctrl+C in the terminal where it runs, then start it again the way you started it, for example npm start); the Claude app and AGY get it the next time they start." S7b replaces S7a.
7. **Restart AkiMCP** as S8r says. The console prints S10. S7a shows the new name; the S8 lines go away. After a change of the Display name alone (step 3), stop here.
8. **Press Apply in each Local tab.** It writes `worklaptop` and removes old AkiMCP entries; results S9i (stopped, a foreign entry), S9k (kept an entry that points elsewhere), and S15 under pasted snippets.
9. **Web AIs.** Add the connector again, typing the Display name as the connector name (S4 footnote), and paste the section 3 instruction (S12) again. Claude and AGY ask to allow the tools again (S8 line 2).
10. **Go back to the default.** Click S6 "Reset to AkiMCP": the fields show `AkiMCP` · `akimcp` · `aki__` and the S8 notice shows the reconnect cost, as in step 2. Click "Save name", then steps 7 to 9.
11. **A hand edit or an AI wrote a bad value into `setting.json`** (for example Server ID `my.tools`). The console prints S10a then S10; section 1 shows the red row S10b; Apply answers S9j. Clicking the row's "Reset to AkiMCP" saves at once, since AkiMCP is already serving the defaults; or the user fixes the field and saves. Then restart.

## Not in v4

- Several AkiMCP instances side by side (D3).
- Renaming the product, package, domain or OAuth realm.
- Live rename without restart.
- Automatic repair of an unusable name (`123`, `Мой`): guessing the owner's intent; the Server ID preview shows that no Server ID can be made (S9l), and Save waits until Server ID is set by hand.

## DEFERRED (not this repo, or not this session)

- AIObox repo: find the connector by the name AkiMCP reports instead of `/akimcp/` (`provider/claude/tools.js:27`); delete a competing connector only when the name matches; the labs ClickUp launcher compares the bare tool suffix and counts from `tools/list` (`core.cjs:25,130,141,152`).
- `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` (modified in the working tree by another session, twin in the AIObox repo): its § Id và tên says the name is always `AkiMCP`, and `connect.rs:17` shows AkiMCP's own name is used; whoever owns that file decides the wording.
- Owner: V1 and V2; the P0 web verification (no seat had web search); the release of 4.0.0 (version bump, tag, publish; `RULE-release`), run only on the owner's go after P8; `release.yml` checks that `serverInfo.name` is `akimcp` under an empty HOME, which D4 keeps true at the defaults; the commit of this plan.
- Not inspected by any grep: user prompts outside the machine (council templates in other workspaces, ClickUp Super Agent prompts, claude.ai project instructions); the migration note tells users to check.

---

## Appendix A · Every site of `aki__` / `akimcp` / `AkiMCP`

Base: HEAD b5556aa, read 2026-10-29 13:20. AIObox repo read the same hour. FACT = the grep named on the row was run and the lines read. Counts are lines.

| Class | Question it answers | Phase |
|---|---|---|
| A logic | changes behavior when prefix or key changes | P2, P4, P5 |
| B served definition | text in `tools/list` descriptions, schemas, `instructions` | P3 |
| B2 result-time text | text returned in a result or refusal | P3 |
| B3 text a user pastes or a client receives outside `tools/list` | snippets, Postman first message, public guide | P3, P5, P7 |
| C allowed residue | `aki__` that stays after P3 (comments only) | P3 done-when |
| D static docs | README, docs, guide | P7 |
| E tests | tests naming `aki__` | P2 to P5 |
| F other repos | AIObox, labs, akidevrule, `~/.claude` | DEFERRED / migration note |

### A. Logic (8 sites)

| Site | Now | v4 source | Grep that finds it |
|---|---|---|---|
| `scripts/tools-server.js:19` | `mountProviders(server, 'aki__')`, the one place the prefix is applied (`provider-registry.js:67-93`) | `IDENTITY.prefix` | `git grep -n "aki__" -- scripts/tools-server.js` |
| `scripts/tools-server.js:16` | `{ name: MCP_SERVER_KEY, title: MCP_NAME }` | `IDENTITY.key`, `IDENTITY.name` | `git grep -n -E "MCP_SERVER_KEY\|MCP_NAME" -- scripts` |
| `scripts/tool-call-log.js:18` | `isLoggedTool = name.startsWith('aki__')`; a wrong prefix logs 0 lines, silently | registry membership | `git grep -n "aki__" -- scripts/tool-call-log.js` |
| `scripts/tool-calls-report.js:9,15,17,24` | `aki__aiobox_write`, `aki__aiobox`, `/^aki__(chrome\|devtools)_/` | count by log field `bare`; old lines strip the constant `aki__` | `git grep -n "aki__" -- scripts/tool-calls-report.js` |
| `scripts/panel.js` (9,57,69,70,74,76-78,122,123,138-141,339,353,356) | Apply writes and removes by key; allow rule `mcp(${MCP_SERVER_KEY}/*)` | `IDENTITY.key`, remembered keys | `git grep -n -E "MCP_SERVER_KEY\|LEGACY_MCP_SERVER_KEY" -- scripts/panel.js` |
| `scripts/config-page.js` (6,142,153,164,165,175,178,302,447,457,458,677) | snippets, Codex table, agy and Claude app JSON, the "MCP Name" field (:302 goes through `field()`, escaped); :677 writes `const MCP_NAME = ${JSON.stringify(MCP_NAME)};` inside the inline `<script>` that opens at :670, and `JSON.stringify` leaves `<` alone, so only a validated name may reach it (The identity, Display name rule) | `IDENTITY.*` | `git grep -n -E "MCP_SERVER_KEY\|LEGACY_MCP_SERVER_KEY\|MCP_NAME" -- scripts/config-page.js` |
| `public/panel-client.js:558` | `n.replace(/^aki__/, '')` for the Tools column | strip the active prefix | `git grep -n "aki__" -- public/panel-client.js` |
| `scripts/mcp-name.js:2-4` | `MCP_NAME 'AkiMCP'`, `MCP_SERVER_KEY 'akimcp'`, `LEGACY_MCP_SERVER_KEY 'aki-mcp'` (now default-valued exports beside the `DEFAULT_*` constants) | becomes `resolveIdentity` | `git grep -n -E "akimcp\|aki-mcp\|AkiMCP" -- scripts/mcp-name.js` |

### B. Served definition (descriptions, schemas, instructions)

Class grep: `git grep -n "aki__" -- scripts public`, then drop the C and A rows.

| Site | Says |
|---|---|
| `scripts/rule-context-mcp.js:17` `SS_STEP`, `:31` `AIOBOX_STEP`, `:33` `BASE_INSTRUCTIONS` | `aki__akidevrule_context` (3 times), `aki__aiobox`; these are the `instructions` |
| `scripts/rule-gate.js:16` `receiptSchema` | `.describe('... from aki__akidevrule_context')` on the argument of every acting tool |
| `scripts/aiobox-mcp.js:444,455` | `aki__aiobox_write`, `aki__aiobox`, `aki__akidevrule_context` |
| `scripts/cdp-mcp.js:11` (`NO_SESSION_HINT`, appended to every CDP tool description), `:48` | `aki__chrome_launch`, `aki__port_status`, `aki__postman_eval` |
| `scripts/shell-mcp.js:190`; `scripts/task-mcp.js:316,338` | `aki__task_start`, `aki__task_manage` |

### B2. Result-time text

| Site | Says |
|---|---|
| `scripts/rule-gate.js:46` `AGAIN` (refusal), `:136` (rules push line) | `aki__akidevrule_context`, `aki__read_text_file` |
| `scripts/project-rules.js:213,229` | `readable with aki__read_text_file`, appended to every read result |
| `scripts/cdp-engine.js:78` | `next` hint: `aki__port_status` |
| `scripts/chrome-profile.js:300,302` | `aki__port_status`, `aki__devtools_targets`, `aki__chrome_launch` |
| `scripts/chrome-mcp.js:22` | `aki__aiobox op=state` |
| `scripts/aiobox-mcp.js:82,393` | refusal `next`: `aki__aiobox`, `aki__aiobox_write` |
| `scripts/streamable-bridge.js:12,22` | `akimcp ${VERSION}`, `reconnect AkiMCP`: product name, no tool name (stays) |

### B3. Text a user pastes or a client receives outside `tools/list`

| Site | Says |
|---|---|
| `scripts/config-page.js:28` | client instruction block: `Always use the akimcp tools (aki__*)` |
| `scripts/config-page.js:147` | help text `The aki__ tools run on the machine ...` |
| `scripts/postman/prompts/postman.md:1` | Postman's first message, verbatim: `akimcp tools (aki__*)`; the wording is load-bearing for Postman's safety check (`postman-daemon.cjs:29`); P3 turns the two names into tokens and adds the read-time replacement in the daemon |
| `public/guide/mcp-http/v1.md:53,57,59,65,76,95` | six lines naming `aki__run_cmd`, `aki__akidevrule_context` |

### C. Allowed residue after P3

Only `//` comment lines, the whole of `scripts/verify-boundary-b1.sh` (its only `aki__` lines are the echoed checklist text), the default constants in `scripts/mcp-name.js` and the default-name examples in `public/guide/`; the exact set is the exemption list of the P3 done-when command, keyed on file and comment marker (its expected list is keyed by file and trimmed line text, see P3 done-when). What it allows today in `scripts/` (21 lines: 18 comment lines and 3 echoed lines): `aiobox-mcp.js:1`, `allowlist.js:8`, `cdp-mcp.js:4`, `git-mcp.js:3`, `port-mcp.js:3`, `sqlite-mcp.js:3`, `panel.js:317`, `postman/postman-mcp.js:1`, `postman/postman-daemon.cjs:29`, `provider-registry.js:67`, `rule-context-mcp.js:29,37`, `rule-gate.js:3,37`, `session-file.js:1`, `tool-call-log.js:17`, `config-page.js:26`, `tools-server.js:13`, `verify-boundary-b1.sh:43-45`. Total before P3: 51 `aki__` lines in 25 files under `scripts/` (A 6, B 11, B2 10, B3 3, C 21), 7 lines in 2 files under `public/` (6 in `public/guide/`, 1 in `public/panel-client.js`).

### D. Static docs (P7)

| File | Lines of `aki__` | P7 action |
|---|---|---|
| README.md | 23 | defaults stay; one R2 note |
| public/guide/mcp-http/v1.md | 6 | R3's three added sentences |
| docs/index.md | 7 | R2 note once; the plan's one line |
| docs/arch/rule-context-delivery.md | 8 | edit |
| docs/arch/provider-toolkit.md | 5 | edit |
| docs/feat/tools.md | 3 | edit |
| docs/feat/session-file.md | 3 | edit |
| docs/feat/security.md | 1 | edit |
| docs/ref/fact-agy-mcp-config.md | 2 | edit, stamp rewritten |
| CLAUDE.md | 1 (§ Process topology) | edit |
| docs/plan/ss-session-file.md | 8 | No action: written at default names (named exception of the P7 lint) |
| docs/plan/per-client-tool-surface.md | 1 | No action: written at default names (same) |
| docs/plan/IMPORTANT-akimcp-aiobox-contract.md | 21 | not this plan: another session's edit, twin in AIObox; DEFERRED |
| CHANGELOG.md 41 · docs/plan/done/* · docs/research/* | history | never edited (docs.B2) |

Count command: `git grep -c "aki__" -- . ":!scripts" ":!public" ":!test"`.

### E. Tests (102 lines in 13 files)

rule-gate 25 · tool-call-log 15 · tool-calls-report 11 · surface-no-aiobox 10 · tool-surface 10 · search-mcp 8 · streamable-bridge 8 · credential-redaction 5 · cdp-extensions 4 · aiobox-mcp 3 · chrome-profile 1 · git-mcp 1 · rule-context 1. Count command: `git grep -c "aki__" -- test`. These keep the default literals (they prove nothing breaks for users who set nothing); non-default behavior is tested only in `test/identity-served.test.js`, `test/connector-apply.test.js` and `test/panel-identity.test.js`. `test/aiobox-contract.test.js:17,82` imports `MCP_NAME`, `MCP_SERVER_KEY`.

### E2. Product identity that stays AkiMCP (D2)

`package.json` (name `@akinet/akimcp`, mcpName, bin), `server.json`, `bin/akimcp.js`, `scripts/cli-flags.js`, `start.js`, `instance-lock.js`, `update-check.js`, `oauth.js:503` realm `aki-mcp-sv`, `fetch-mcp.js:76` user agent, `rule-version-core.cjs:69,90`, `system-mcp.js:22,27,138`, `port-mcp.js:107,116,128`, `chrome-profile.js:359` `--aki-launcher=akimcp` (AIObox reads this flag today), `aiobox-mcp.js` request ids `akimcp-<pid>-...` (151,328), refusal `by: 'akimcp'` (81,269), op=state key `akimcp` (377), file `akimcp-state.json` (14,407): contract fields with AIObox. Grep: `git grep -n -i -o -E ".{0,50}(akimcp|aki mcp|aki-mcp).{0,50}" -- scripts`.

### F. Other repos (read 2026-10-29)

| Repo / path | Finding |
|---|---|
| AIObox `desktop/src-tauri/src/akimcp/readiness.rs:117,150,330-331` | already reads `serverInfo.title` else `.name` and keeps it for every label, so AIObox's own labels follow a rename |
| AIObox `provider/notion/tools.js:3` | a Notion workspace is compared to what AkiMCP serves now, by tool name; another list = `stale` |
| AIObox `provider/claude/tools.js:26-27` | connector found by `name` lowercased, whitespace removed, containing `akimcp`, or a legacy name, plus the same URL; a Display name without `akimcp` is not found |
| AIObox `resources/providers/clickup/macros/connect-akimcp.js:118` | `isOurs` = `/akimcp/` or the name AkiMCP gives itself or a legacy name; the ClickUp macro follows a rename, the Claude finder does not |
| AIObox `resources/prompts/akimcp-instruction.md:6-7`, `automation/quota.rs:1601`, `automation/request.rs:2880-2882,2924`, `shared/guide/aiobox.md` (13) and its web copy (13) | text sent to the AI naming `aki__*`: user prompts of the same class as any outside prompt |
| AIObox `app/data/content/akimcpWindows.ts`, `.claude/skills/aio-macro/SKILL.md:31`, `scripts/win/vm.ps1`, `labs/.../auto-setup-connector.js`, `desktop/panel/akipanel.ts:163`, `providers/capabilities.ts`, test fixtures | text, comments, fixtures; no behavior |
| AIObox `labs/providers/clickup.com/shared-by/phong/clickup-akimcp-launcher/core.cjs:25,130,138,141,145,152` (git-ignored) | prompt names `aki__akidevrule_context`; connector name must equal `AkiMCP`; tools filtered by prefix `aki_mcp__aki__`; verification needs 36 tools and `aki_mcp__aki__akidevrule_context` |
| akidevrule `~/.aki/akidevrule` | 0 hits in payload, skill or script files (`aki__`/`akimcp` only in `CHANGELOG.md`) |
| `~/.claude` (CLAUDE.md, skills, hooks, settings) | 0 hits outside client config and transcripts (`.claude.json` is Apply's P5 target; `history.jsonl`, `jobs/`, `backups/`, `plans/` are never edited) |

## Appendix B · Client naming limits (12 clients)

FACT = read in this repo or observed. ASSUMPTION = outside knowledge with no local source; P0 sources it with a dated page before the code relies on it.

| Number | Value | Tag | Source |
|---|---|---|---|
| Bare tool names served | 38 | FACT | CLAUDE.md § Process topology |
| Longest bare name | `postman_rename_conversation` = 27 (Postman installed) | FACT | `scripts/postman/postman-mcp.js:290` |
| Longest without Postman | `list_allowed_directories` = 24 | FACT | `scripts/filesystem-mcp.js:294` |
| Default key + prefix | `akimcp` 6 + `aki__` 5 = 11 | FACT | `scripts/mcp-name.js`, `scripts/tools-server.js:19` |
| Ceiling if a client caps the full name at 64 (Claude Code form `mcp__<key>__<prefix><tool>`) | key + prefix + 27 <= 64 - 7 | arithmetic on an ASSUMPTION | row 1 |
| Ceiling if a client caps server + tool at 60 | key + prefix + 27 <= 60 | arithmetic on an ASSUMPTION | row 5 |
| Safe pair | 28 + 29 = 57 inside both | derived | D9 |

| # | Client | Shown name built as | Charset / max length / bans | Source | Measured here |
|---|---|---|---|---|---|
| 1 | Claude Code (CLI) | `mcp__<key>__<tool>`; key = what Apply passes to `claude mcp add` | hyphen worked (old key `aki-mcp`); 64 total, `[a-zA-Z0-9_-]`, `__` inside the key unsafe: ASSUMPTION | `scripts/panel.js:70`; CHANGELOG "One MCP server key" | form yes, limits no |
| 2 | claude.ai (web connector) | composition unknown; "Always allow" is tied to the tool definition, so a renamed tool asks again | same 64 rule: ASSUMPTION | CHANGELOG 3.0 "Tool definitions changed" | no |
| 3 | ChatGPT (connector) | unknown; reads annotations (`readOnlyHint`), confirms every write tool; instruction prompt capped at 1500 characters | `^[a-zA-Z0-9_-]{1,64}$`: ASSUMPTION | `docs/feat/tools.md:32`; `docs/research/instruction-prompt-first-principles.md:7` | no |
| 4 | Codex | table `[mcp_servers.<key>]` in `~/.codex/config.toml` written by Apply; shown form `mcp__<key>__<tool>`: ASSUMPTION | a key with `.` or `]` breaks the TOML table: FACT by reading | `scripts/panel.js:122-123` | config form yes |
| 5 | Cursor | `mcpServers.<key>` in `~/.cursor/mcp.json`; shown form unknown | about 60 characters server + tool: ASSUMPTION, undated | `scripts/panel.js:126-141` | config form yes |
| 6 | agy CLI and Antigravity IDE | server id = key with the hyphen dropped; schemas cached as `mcp/<server>/aki__*.json`; allow rule `mcp(<server>/<tool>)` or `mcp(<server>/*)`; IDE has its own prompt | hyphen dropped: FACT; rest unknown | `docs/ref/fact-agy-mcp-config.md` CLI-3, CLI-4, CLI-5, IDE-4 (verified on agy 1.2.13; agy is 1.4.7 now and the CLI claims were not re-run) | yes on 1.2.13 |
| 7 | Gemini (web connector) | unknown; Gemini CLI form `mcp_<server>_<tool>`: ASSUMPTION | letters, digits, `_`, `.`, `-`, 64: ASSUMPTION | `docs/feat/security.md:49` | no |
| 8 | Grok (web connector) | unknown | unknown | `docs/feat/security.md:49` | no |
| 9 | Notion (custom MCP) | unknown; a workspace holding 36 tools while the server serves 37 is marked stale (AIObox `notion/tools.js:3`) | unknown | `docs/feat/security.md:50` | no |
| 10 | ClickUp (Super Agent MCP) | `<connector name>__<tool>`, e.g. `akimcp__aki__run_cmd`; the connector name is typed in ClickUp's form, not read from `serverInfo.name`; only per-tool descriptions reach the agent, not `instructions` (observed) | limit unknown; what ClickUp does with a renamed tool (re-bind or drop) is untested | measured in a live run 2026-10-29 | form yes |
| 11 | Buda | bearer header only, no DCR; shown form unknown | unknown | CLAUDE.md § Two client paths | no |
| 12 | Postman (local client + daemon) | shown form unknown; its first-message prompt hardcodes `akimcp tools (aki__*)` | unknown | `scripts/postman/prompts/postman.md:1` | no |

What the rows force:

1. The name budget applies to rows 1, 4, 5, 6 only. For web connectors (2, 3, 7, 8, 9, 10) the first half of the shown name is typed by the user, outside any ceiling the server can set.
2. No row shows a client that needs the Server ID and the Tool prefix to agree. Each client composes its own name from parts it owns (FACT for 1, 4, 5, 6, 10). That is why they are two derived values and not one.
3. Forced limits: no `.` or `]` in the key (row 4), no reliance on a hyphen (row 6), no `__` inside the key (row 1, ASSUMPTION).
4. For clients that drop `instructions` (row 10), only tool descriptions carry tool names to the AI, so every name inside a description follows the served prefix and the bridge sentence lives in a description.
5. A prefix lengthens all 38 tools; the ceiling applies to the longest served name, which depends on whether Postman is installed (27 vs 24).

Unknown until a live screen or a dated vendor source: the shown name and cap for rows 2, 3, 7, 8, 9, 11, 12, the charset for rows 1, 4, 5, agy 1.4.7 key handling, and the 64 and 60 figures themselves. That is P0.

## Appendix C · Contracts C1 to C12, migration, why 4.0.0

"Rename" below means any of the three fields differs from `AkiMCP` / `akimcp` / `aki__`.

| # | Contract (who reads the name) | Keep defaults | Rename | Who acts |
|---|---|---|---|---|
| C1 | AIObox creates and finds the connector. The ClickUp macro and `readiness.rs` follow the name AkiMCP reports; the Claude finder (`provider/claude/tools.js:26-27`) matches the name lowercased with whitespace removed against `akimcp` plus the URL | holds | breaks for the Claude finder when the Display name lacks `akimcp` by that exact test (`Aki-MCP`, `WorkMCP` break; `Aki MCP`, `AkiMCP Work` hold) | AkiMCP: the panel warns with that test (D12). AIObox: find by reported name, DEFERRED |
| C2 | AIObox compares tool lists by name (`notion/tools.js:3`, `automation/request.rs:2101-2113`); Claude's "Always allow" is keyed by server, tool and definition hash | holds | Notion `tools_stale` until reconnect once; Claude asks again per tool; correct, since the tool really changed | user, once |
| C3 | Prompts and guides that call tools by hard-coded name: AIObox `akimcp-instruction.md`, `shared/guide/aiobox.md`, council templates, `public/guide/mcp-http/v1.md` | holds | an AI told to call `aki__akidevrule_context` finds no such tool, gets no receipt, every write is refused | AkiMCP: served text renders from the served prefix, and the bridge sentence sits in the rule-context description (ClickUp does not receive `instructions`). V1 proves it (P8) |
| C4 | The labs ClickUp launcher checks the exact name `aki_mcp__aki__akidevrule_context` and a count of 36 (`core.cjs:152`; the count is already stale against 38 served) | holds | `FINAL_VERIFICATION_FAILED`; 15 Super Agents lose their tools until re-bound | labs (owner's, AIObox side): compare the bare suffix, count from `tools/list`. DEFERRED |
| C5 | akidevrule receipt: `rule-gate.js:3`, a hash of the rule files, not the name. `aki__` in the AkiDevRule payload: 0 | holds | the receipt holds; only the refusal text and descriptions render the served name | AkiMCP (P3) |
| C6 | Local clients store by Server ID: Claude Code user scope and allow `mcp__akimcp__*` (`panel.js:69-70`), Codex `[mcp_servers.akimcp]` (`:122`), Cursor `mcpServers.akimcp` (`:139`), agy `mcp(akimcp/*)` and cache `~/.gemini/antigravity-cli/mcp/akimcp/` | holds | the old entry stays, the allow rule must be granted again, and a same-named foreign entry could be overwritten | Apply (P5, D11) |
| C7 | Web connectors (claude.ai, ChatGPT, Grok, Gemini, Notion, ClickUp, Buda, Postman): the first half of the shown name is typed by the user; OAuth DCR is keyed by client ID (`oauth.js` `resolveClient`), not by name | holds | auth holds; a new prefix means the client lists tools again and asks for approval; ClickUp agents must be re-bound | user, from the panel checklist |
| C8 | Product: npm `@akinet/akimcp`, `mcpName io.github.lacvietanh/akimcp`, domain akimcp.top | holds | holds (D2) | nobody |
| C9 | Tool-call log history: the report reads old `tool-calls-YYYY-MM-DD.jsonl` files | holds | holds if the report counts by `bare` and strips `aki__` from old lines; otherwise before/after counts split silently | AkiMCP (P4) |
| C10 | Postman first message: `prompts/postman.md:1` names `aki__*`, and its exact wording is what keeps Postman's safety check quiet (`postman-daemon.cjs:29`) | holds, byte for byte | another prefix changes a checked sentence: ASSUMPTION it may be flagged | AkiMCP renders the prefix; V2 probes it (P8) |
| C11 | Downgrade 4.x to 3.x while renamed | holds | breaks: 3.x ignores the setting and serves `aki__*`/`akimcp` while clients are connected under the new names | user: set the defaults back first; one CHANGELOG line says it |
| C12 | Two machines in one AI account (`IMPORTANT-akimcp-aiobox-contract.md:16`: an `AkiMCP` pointing at another URL is deleted by the macro; `config-page.js:147` has a snippet to paste on another machine) | holds (one machine, one `AkiMCP`) | second-order effect: renaming is the natural way to attach two machines (different keys). If both Display names contain `akimcp`, the AIObox macro on one machine deletes the other's connector (configuration only; reconnect fixes it) | AkiMCP: panel warning for AIObox auto-connect users. DEFERRED: AIObox deletes only a same-named connector. D3 stays (one instance per machine) |

Result: with the defaults 12 of 12 contracts hold. With a rename, C1 (Display name lacks `akimcp`), C3 and C4 (prefix changes), C11 (downgrade) and C12 (two machines) break; C2, C6, C7 cost the user one redo; C9 and C10 hold if P4 is done right and V2 passes. No contract needs AkiMCP to change because of AIObox.

Migration.

- A rename is something the user does on purpose, once. There is no automatic migration for web clients, because the server cannot write into them (C7). Rejected: reconnecting for the user.
- Someone who keeps the defaults does nothing: upgrading 3.x to 4.0.0 asks no reconnect and no new "Always allow", because every served byte is unchanged (D4). The mechanism (Claude keys "Always allow" by definition hash) is an ASSUMPTION from an AIObox comment (`claude/tools.js:2`); a live observation supports it (AIObox `desktop/CHANGELOG.md:401`, 2026-10-05: tools rewritten in place were asked again).
- At every rename the panel shows, at the field and before Save, what to do per client: Apply fixes C6 itself, C7 is by hand, C1 and C4 say "not yet supported when renamed".
- V1 and V2 spend session quota, so the owner runs them (`agent.B3`); V3 is local and the builder's.
- No alias (D6). No `identity` field in `instance.json` (D7).
- Why 4.0.0: see D1. The CHANGELOG line (S18) says it plainly: "Keep the default and nothing changes: no reconnect, no new Always allow."

## Appendix D · Words (glossary, strings, rules for static docs)

`{x}` is filled at render; `{field}` is Server ID or Tool prefix unless a row says otherwise. Errors state the problem first, then the fix. Buttons start with a verb. Panel text that shows the Display name escapes it. No string carries an em or en dash.

### Glossary

| Term | Tiếng Việt | What it is | Default | Never call it |
|---|---|---|---|---|
| Display name | Tên hiển thị | the one name the owner types (`identity.name`, `serverInfo.title`); the connector name the panel suggests; never sent inside instructions, descriptions or errors | `AkiMCP` | MCP Name, Base name, title, label |
| Server ID | Mã server | the key clients store this server under (`identity.key`, `serverInfo.name`): configs and allow rules | made from the Display name (see The identity) | server key, MCP key |
| Tool prefix | Tiền tố tool | text in front of every tool name (`identity.prefix`); may be empty | the Server ID without a leading `akimcp` when a letter follows it, else without one final `mcp` when something is left, plus `__` | namespace |
| Tool name | Tên tool | Tool prefix + the tool's own name, e.g. `aki__run_cmd` | | |
| Connector name | Tên connector | the name the owner types in a web AI's connector form; AkiMCP can only suggest it | the owner's choice | Server ID |
| AkiMCP | AkiMCP | the software: package, panel, docs; never renamed | | AKIMCP |

Writing rule: lowercase `akimcp` appears only as a literal (command, package, Server ID value). Capital `AKIMCP` appears nowhere in source text.

### Strings

| Id | Where | Text | Shown when |
|---|---|---|---|
| S1 | section 1, input label (replaces the read-only "MCP Name" row) | Display name | always |
| S2 | under S1 | The name AI clients list this server as. The Server ID and Tool prefix below are made from it as you type; to set either one yourself, open Customize fields. | always |
| S3 | rows under S1, live | Server ID · Tool prefix · Example tool | always |
| S3a | Customize fields, Server ID help | The name client configs store this server under. Lowercase letters and digits, starting with a letter. | open |
| S3b | Customize fields, Tool prefix help | Text in front of every tool name. Leave it empty to use bare names, for example run_cmd; an AI that also has another server with a tool of the same name may then call the wrong one. | open |
| S3d | link beside each override | Use the one made from the Display name ({derived}) | field differs from its derived value |
| S4 | preview heading and rows | What each AI shows · {client}: {shownToolName} · footnote: Web AIs put the connector name you typed in front of each tool, for example {connector}__{prefix}run_cmd in ClickUp. Type {displayName} as the connector name. | always |
| S5 | button | Save name | input differs from saved; disabled while an S9 error shows |
| S6 | button | Reset to AkiMCP | saved identity is not the default; fills the fields with AkiMCP and clears hand-set values, then S8 shows and Save commits |
| S7a | status line | Serving now: {displayName} · Server ID {serverId} · tools {prefix}* | serving = saved |
| S7b | status line | Serving now: {servingDisplayName} · {servingServerId} · {servingPrefix}*. Saved: {savedDisplayName} · {savedServerId} · {savedPrefix}*. Web AIs and Local clients that connect by URL get the saved name after you restart AkiMCP. The Claude app and AGY start their own copy, so they get it the next time they start, even before the restart. | after Save, before restart |
| S8r | the restart words, used inside S8 line 1, S8 line 1b and S8a | restart AkiMCP (press Ctrl+C in the terminal where it runs, then start it again the way you started it, for example npm start) | wherever a string says to restart; S7b keeps the short "restart AkiMCP" because S8 shows the how right above it |
| S8 line 1 | notice under the row | After Save, {S8r}, then press Apply in each Local tab, add the connector again in each web AI and paste the section 3 instruction again. | Server ID or Tool prefix differs from serving, after typing or after Reset to AkiMCP |
| S8 line 1b | same, instead of line 1 | After Save, {S8r}. The Server ID and tool names stay the same, so no client needs to reconnect; rename the connector in a web AI only if you want it to show the new name. | only the Display name differs from serving, for example after the S8b button |
| S8b | same, above line 2, with a button | Changing the Display name also changes the Server ID and Tool prefix made from it. · button: Keep {servingServerId} and {servingPrefix} | the Display name changed and the derived Server ID or Tool prefix differs from serving, neither set by hand; the button writes the serving values as hand-set values, so line 2 disappears |
| S8 line 2 | same | Claude and AGY ask you to allow every tool again, and ClickUp Super Agents and saved prompts that name {servingPrefix} tools need the new names. | Server ID or Tool prefix differs from serving |
| S8 line 3 | same | AIObox connects claude.ai by itself only when the Display name contains AkiMCP; capitals and spaces don't matter, so Aki MCP works and Aki-MCP does not. Otherwise, add the connector yourself with the steps in the Claude tab above. | the Display name, lowercased with whitespace removed, lacks `akimcp` (D12) |
| S8a | beside Save | Saved. To serve {savedDisplayName} to web AIs, {S8r}; the Claude app and AGY get it the next time they start. | Save succeeded |
| S9a | inline error | Display name is empty. Type a name, for example AkiMCP. | empty |
| S9b | inline error | {field} must start with a letter. Remove "{firstChar}" at the start. | hand-set value |
| S9c | inline error | {field} must be lowercase. Use {lowered}. | only uppercase letters are wrong |
| S9d | inline error | {field} can use only letters a to z and digits. Remove {badChars}. | a symbol in a Server ID |
| S9e | inline error, live at the field | Server ID and Tool prefix together are {n} characters, 28 at most. Shorten the Display name, or set Tool prefix by hand in Customize fields. | key + prefix > 28; Save disabled |
| S9f | inline error | Tool prefix must be empty or end with two underscores, for example {suggest}__. | prefix not empty and not `^[a-z][a-z0-9]*__$` |
| S9g | inline error | Display name can use only letters, digits, spaces and . _ -. Remove {badChars}. | a character outside the rule, invisible ones included; {badChars} names an invisible character by its name and code, for example "line break", "zero-width space (U+200B)", "Hangul filler (U+3164)" |
| S9g2 | inline error | Display name must start with a letter or digit. Remove "{firstChar}" at the start. | the first character is a space or . _ - |
| S9h | inline error | Display name is {n} characters, 40 at most. Shorten it. | over 40 |
| S9l | inline error, Server ID row | No Server ID can be made from "{displayName}": a Server ID uses only a to z and 0 to 9, and this name has no letter a to z. Set Server ID in Customize fields. | empty slug and no hand-set Server ID |
| S9i | Apply result | Apply stopped: {client} already has a server named {serverId} that points at {target}, not at this AkiMCP. Pick another Server ID, or remove that entry in {client} yourself. | the entry with the current key is not ours |
| S9j | Apply result | Apply stopped: {field} "{value}" in setting.json is not valid, so AkiMCP is serving the default names. Fix it above or press Reset to AkiMCP, then Apply again. | an identity problem is showing |
| S9k | Apply result, after success | Kept {oldKey} in {client}: it points at {target}, not at this AkiMCP. | an old key's entry is not ours, so Apply leaves it |
| S10 | console at start (`npm start`, `scripts/stdio.js`) | Serving as {displayName} · Server ID {serverId} · tools {prefix}* | every start |
| S10a | console, before S10 | {field} "{value}" in {settingPath} is not valid: {reason}. Serving the default names until it is fixed in panel section 1. | invalid `identity`; {value} is printed with every control character (C0, DEL, C1) written as \uXXXX and the whole JSON-quoted, in the one function that renders the problem for the boot line; S10 and S10a go through `console.error`, never `console.log` or `process.stdout`, because on `scripts/stdio.js` stdout is the JSON-RPC channel |
| S10b | section 1, red row | {field} "{value}" in setting.json is not valid: {reason}. AkiMCP is serving the default names until you fix it. · button: Reset to AkiMCP | same; this button saves at once |
| S11 | rule tool description and server `instructions`, one added sentence | This server's tools start with {prefix}. Text that names aki__<tool> means {prefix}<tool>. · empty prefix: This server's tools have no prefix. Text that names aki__<tool> means <tool>. | Tool prefix is not `aki__` |
| S12 | section 3 paste-in, `config-page.js:28` | Always use the {serverId} tools ({prefix}*) for local files, shell and browser. · empty prefix: Always use the {serverId} tools for local files, shell and browser. | always (default renders today's words) |
| S13 | "From another computer" help, `config-page.js:147` | The {prefix} tools run on the machine running AkiMCP, not on the computer you paste this on. · empty prefix: The {serverId} tools run on ... (rest unchanged) | always |
| S14 | rule-gate refusal tail (`AGAIN`, `rule-gate.js:46`) and receipt description (`:16`) | call {prefix}akidevrule_context (without knownReceipt if the rules are no longer in your context), then call this tool again with receipt=<the sha256:... it returns> (a schema of this tool without receipt is stale: reconnect {serverId} first) · required: the sha256:... receipt from {prefix}akidevrule_context | refusal; every gated schema (default renders today's words) |
| S15 | under each pasted snippet (`legacyNameHint`) | Your config may still have entries named {otherAppliedKeys}; delete them. Apply does this for you. | `applied.keys` holds keys other than the current one |
| S17 | panel prose: h1 and the "AKIMCP" mentions | AkiMCP | always |
| S18 | CHANGELOG 4.0.0 headline | **Name the server without editing code** (`setting.json` `identity`, panel section 1): the Display name you type also sets the Server ID and Tool prefix (`MacMCP` gives `macmcp` and `mac__run_cmd`), and each can be set on its own. Keep the default and nothing changes: no reconnect, no new Always allow. A new name needs a restart and a reconnect in every client; set the default back before installing a 3.x version. | release |

Every other served text that names a tool (descriptions, `next` hints, `rule-context-mcp.js` steps, the `project-rules.js` line, `postman.md`, result text) renders the same words with the served prefix in place of `aki__`; no other wording changes. `postman.md` is safety-tested: its rendered text at a non-default prefix needs the V2 live check, not a rewrite.

### Rules for static docs

- R1 README, `docs/feat/`, `docs/arch/`, `docs/ref/`, `CLAUDE.md` and the public guide write tool names in full with the default prefix: `aki__run_cmd`, never `run_cmd` or `<prefix>run_cmd`.
- R2 Each of those docs carries one note at its first tool name: "Tool names here use the default prefix `aki__`. A server with another Tool prefix serves the same tools under that prefix; panel section 1 shows yours." README puts it at the start of its tools section.
- R3 `public/guide/mcp-http/v1.md` stays v1 and gets three additive edits: § 2 step 2 adds "Tool names start with the server's Tool prefix, `aki__` by default: take the exact names from this list."; § 2 step 3 reads "`tools/call` the tool ending in `akidevrule_context` (`aki__akidevrule_context` by default)"; § 3 row "receipt missing" next step reads "the `...akidevrule_context` tool again, the new receipt". The curl and JSON examples keep the default names.
- R4 The temporary-token kickoff block gets no new field: `tools/list` already gives the names.
- R5 History keeps its words: released CHANGELOG blocks, `docs/plan/done/`, `docs/research/` stay as written.
- R6 Prose calls the software AkiMCP. Text read by an AI names only the Server ID and Tool prefix. Panel and console text read by a person may show the Display name, escaped.
- R7 Every `docs/arch/` or `docs/feat/` file edited for v4 rewrites its `updated` stamp in the same edit (docs.A4).
