# Panel section 1 polish: one MCP JSON tab, logos, temp-token renewal, AIObox strip

Done 2026-10-31.

## Ask

Owner 2026-10-31, verbatim:

> local direct: cái kiểu khai báo như của postman là gặp rất nhiều nơi, ta có thể quy thành một khái niệm chung thay vì newbie họ không hiểu rằng "lấy của postman cop ra cũng đc". chắc là General gì gì đấy..
> cursor cần logo, tự kiếm sao cho hiệu quả, hợp lý đi.. agy, codex,.. cũng cần logo.. mấy cái provider thiếu logo phải đi kiếm về.
> phần web: any http client đưa ra đầu tiên. tính năng gia hạn tôi note không biết triển khai chưa, kiểm lại /akiopen xem có cái nào gần đây hoặc liên quan thì xử lý nốt..
> phần connect ta vẫn cần 1 area nhỏ nhỏ ở dưới để quảng bá về aiobox, vì nó rất hữu dụng tới mức không ai ngờ được, mọi thứ chỉ 1 click là tự connect akimcp.. hãy tìm lời lẽ và cách trình bày thật tối thượng, wow, thượng thừa, ux đỉnh cao nhất. dẫn link cho ngta mở ra trang web aiobox.

The renewal note (`.akidevsync/notes.json` task-1793301360386): "thêm tính năng gia hạn cho cái any http client." · "mặc định click 1 phát là thêm 30 phút. và nó cũng cần được show ra trong list là được kết nối từ cái gì (vốn những thuật toán này có đầy đủ, không triển khai lại. chỉ tái sử dụng)".

## Decisions

- **D1 · Any MCP app, first Local tab.** Named in parallel with *Any HTTP chat*; it holds the loopback `mcpServers` JSON (`localBearerJson`) and the from-another-computer variant, and is the Local tier's default tab. The Postman tab stays: Launch, the overlay and Connected Accounts are Postman-only. Rejected: "General" (says nothing about what the tab is for).
- **D2 · No Apply on the generic tab.** It serves any app, so there is no config file to write. The retired-name hint drops "Apply does this for you" on tabs without Apply (`legacyNameHint(false)`: Any MCP app, Postman).
- **D3 · Logos are SVG files in `public/img/providers/`**, official asset first, then Simple Icons (CC0), then the vendor's own file; black marks turn white under `prefers-color-scheme: dark`. Fetched 2026-10-31:

| File | Source |
|---|---|
| `cursor.svg` | Simple Icons `cursor` |
| `antigravity.svg` | antigravity.google press asset `antigravity-icon__full-color.svg`, unmodified |
| `codex.svg` | Simple Icons `openai` (Codex has no mark of its own) |
| `buda.svg` | buda.im brand asset `logo-icon.svg`, color set from its primary `oklch(0.52 0.076 78)` |
| `clickup.svg` | Simple Icons `clickup` |
| `mcp.svg` | Simple Icons `modelcontextprotocol` |
| `http.svg` | drawn here: an outline globe, not a brand |

- **D4 · Renewal reuses what exists.** `+30 min` adds `TEMP_EXTEND_MS` (beside `TEMP_TTL_MS`) to a live token's expiry, no cap; an expired or revoked one stays dead. After the Bearer check, `/mcp` passes the address and user-agent `recordCaller` already uses to `noteTempTokenUse`, which keeps them in the token's memory entry; the row shows them, or *not used yet*. No second caller-identification path, nothing written to disk.
- **D5 · AIObox strip at the bottom of section 1, both tiers.** Copy is `AIOBOX_CONNECT` in `scripts/aiobox-guide.js` (eyebrow with the closed beta, a one-click headline, one line of proof, the *See AIObox* button to `https://aiobox.app/?from=akimcp-connect`); once `~/.aki/aiobox/` exists it shows `AIOBOX_PANEL.installed` with no link. No image, no OS name, no comparison with another product (aiobox `docs/biz/positioning.md`). Recorded as a funnel surface in aiobox `docs/arch/akimcp-boundary.md` BR-9 F2 and D7 (aiobox commit 192a4970).

## Items

- [x] P1 Any MCP app tab and pane (`scripts/config-page.js`), `test/remote-snippet.test.js` and `test/passphrase-roll.test.js` extended, each new assertion seen failing against a broken render.
- [x] P2 Logos fetched (D3) and wired on every connector tab; all 18 icons load in a rendered page.
- [x] P3 Any HTTP chat first in the Web tier.
- [x] P4 Temp-token renewal and *Last used* (`scripts/oauth.js`, `scripts/gatekeeper.js`, `scripts/panel.js`, `public/panel-client.js`), `test/temp-token.test.js`, `docs/feat/security.md`, `public/guide/mcp-http/v1.md`.
- [x] P5 AIObox strip (`AIOBOX_CONNECT`, `aioboxConnectStrip()`, `.aiobox-strip` in `public/panel.css`), screenshot checked in the dark theme.
- [x] P6 README, `docs/feat/tools.md` § AIObox in the panel, CHANGELOG `[Unreleased]`, `docs/index.md`.
- [x] V1 The temp-token row in a running panel. Checked 2026-10-31 on a scratch instance (`test/fixtures/start-scratch.js`, ports 19998/19999, headless Chrome), not the owner's running AkiMCP: fed a `GET /api/temp-tokens` reply in the shape `test/temp-token.test.js` asserts, the list showed `3 min ago` over `203.0.113.7 · python-httpx/0.27` for a used token and `not used yet` for a new one, each with **+30 min** and Revoke; **+30 min** on an id the server does not hold reached `POST /api/temp-token/extend` and showed `no live temporary token to extend: refresh the list`. The scratch instance has no public address, so it cannot mint; mint, use through `/mcp` and extend are covered through the public entries by `test/temp-token.test.js`.
