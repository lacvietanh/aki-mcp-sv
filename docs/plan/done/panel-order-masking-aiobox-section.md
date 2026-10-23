# Plan — panel order by need, one masking path, AIObox section, canonical footer

Status: done 2026-10-22 (code, tests, docs, akimcp.top copy). Run as a small akiflow council: lead, one challenger (architecture and UX), two makers (panel, site).

## Owner request (2026-10-22, verbatim fragments)

| REQ | Owner's words | Item |
|---|---|---|
| R1 | "nếu ai dùng bản npm npx thì có thể trong panel đấy gợi ý nút tải dẫn tới icon 48" | I1 |
| R2 | "tại sao các biến nhạy cảm trong các connector không được che đi? lập trình SOLID DRY SRP cho tái sử dụng logic đấy cho mọi field có chứa nhạy cảm" | I2 |
| R3 | "nhu cầu tắt mở tool phải nằm trên nhu cầu quản lý log" · "các mục log phải đưa xuống dưới cùng" | I3 |
| R4 | "bỏ cái phần extension gợi ý đi. thay vào đó là gợi ý dẫn tới aiobox.app hẳn một section giới thiệu thuyết phục hấp dẫn" | I4 |
| R5 | "footer cần cập nhật phản ánh chính xác các icon và các link, đầy đủ dự án." | I5 |
| R6 | "nhớ cập nhật đồng thời cả trang web repo akimcp.top." | I6 |
| R7 | "còn lại những vấn đề gì tồn đọng quan trọng phải xử lý hết trong đợt này đi." | I7 |

## Items and closure

- [x] **I1 icon.** The ChatGPT tab offers `<a download href="/favicon/icon-48.png">Download icon</a>` instead of a repo path. Same origin, so `download` holds for every install kind, offline included; an akimcp.top URL would be cross-origin and only open the image. Test: `test/oauth.test.js` (link present, PNG served).
- [x] **I2 masking.** `copyEl` in `scripts/config-page.js` is the one masking path: the visible text is the value with every secret replaced by the mask, the real value sits in `data-v`, the masked text in `data-mask`, and empty secrets are skipped. `secretField` and `secretSnippet` (passphrase, access token, Buda header, Postman, Cursor, Claude Code, Codex snippets) go through it; `public/panel-client.js` only swaps the two attributes and toggles the eye label Show/Hide. Test: `test/passphrase-roll.test.js` (7 masked spans, no secret in visible text, re-hidden snippet keeps its shape, copy yields the real value).
- [x] **I3 order.** 0 Ingress · 1 Connectors · 2 AkiDevRule · 3 Instructions · 4 Tool providers · 5 Folders · 6 Shell · 7 Security & limits · 8 AIObox · 9 Logs (call log + security log). Only 4 and 8 changed number; AIObox is not a setup step. Test: every `#sN` resolves and each stepper number matches its heading. README, `docs/index.md`, `docs/feat/*`, `docs/arch/provider-toolkit.md` follow.
- [x] **I4 AIObox section.** Browser utilities (extensions, Widen) removed; the extension images stay in `public/`. Section 8 renders `AIOBOX_PANEL` from `scripts/aiobox-guide.js` (copy from aiobox `docs/biz/positioning.md` Messaging, Shipped row, Release state): headline, story, four benefits, closed-beta line, primary CTA `https://aiobox.app/?from=akimcp-panel`; with AIObox installed, one line and no link. No OS name, no remote asset, no network call. aiobox `docs/arch/akimcp-boundary.md` BR-9 F1/F2 and twin row T7 record the surface; `test/rule-context.test.js` holds T7 (no OS name, headline pinned).
- [x] **I5 footer.** Panel `ECOSYSTEM`/`SOCIAL` copy the akitao.com footer (25 products, 5 socials, mailto): icons `https://akitao.com/pj/icon-<x>-96.png`, UTM `utm_source=akimcp-panel&utm_medium=footer` on every product row, the `ecosystem` flag sets only `rel`, socials plain (UNIDOC Web §2.4b).
- [x] **I6 akimcp.top.** Footer to the same list (UTM source `akimcp.top`, names wrap), current guides and homepage use the new section numbers, extension screenshots removed, the icon step names the Download icon button; `/whats-new/` keeps the 3.0.1 text it shipped with.
- [x] **I7 no-token count.** `scripts/gatekeeper.js`: a `/mcp` request with no Authorization header gets the 401 challenge and is neither counted nor logged; an empty, non-Bearer or wrong bearer still counts and logs. Test: `test/rate-limit.test.js`. Docs: `docs/feat/security.md`.

## Decisions taken in the run

- Order: operations above the AIObox pitch, so the pitch never sits between a user and a setting (challenger); rejected: AIObox in slot 4, which renumbered four sections and put an ad among setup steps.
- Widen snippet dropped with its section: it tweaks claude.ai CSS, unrelated to MCP; AIObox ships Widen as a macro.
- Footer UTM follows the canonical `ecosystemHref` (every non-internal row), not only `ecosystem: true` rows.

## Verification

`npm test` 60/60; akimcp.top `npm run check` and `npm run typecheck` exit 0. Headless render of the panel with demo secrets: no secret in visible text, 7/7 eye toggles reveal and re-hide, section 8 and footer screenshots checked, 26/26 footer images load. akimcp.top footer at 1300px and 390px: 25 UTM links, no clipped name, no horizontal overflow.

## Roster

lead (Opus) · challenger (aki-challenger, two passes: plan, then diff) · maker-panel (aki-maker, Sonnet) · maker-site (aki-maker, Sonnet).

Seat tokens (`council_cost.py`, the four seats plus the tally): output 464,726 · cache write 3,724,519 · cache read 55,557,768. The lead's share is not split out: it ran in a longer session.
