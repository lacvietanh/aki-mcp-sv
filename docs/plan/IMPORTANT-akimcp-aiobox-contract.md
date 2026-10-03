# IMPORTANT — Hợp đồng AkiMCP ↔ AIObox: id, tên, file, endpoint

> **IMPORTANT, ràng buộc cả hai repo.** Bản sinh đôi: `aiobox: docs/plan/IMPORTANT-akimcp-aiobox-contract.md`; hai bản giống nhau trừ dòng này, sửa một bản thì sửa luôn bản kia trong cùng phiên. Cùng nhóm: `docs/plan/IMPORTANT-shared-cdp-profiles.md` (một thư mục CDP profile chung).

Trạng thái: phần AIObox của luật đặt tên đã triển khai (2026-10-01); § Hợp đồng AkiMCP đọc từ AIObox đã làm ở cả hai phía (AkiMCP `aki__aiobox`, `aki__aiobox_write`, 2026-10-02); § Việc phía AkiMCP: tên `AkiMCP`, `origin` cho mọi mode trong `instance.json`, test giữ hình dạng đã làm phía AkiMCP (2026-10-03), identity theo client đã bỏ (chủ, 2026-10-03); AIObox đã đọc URL connector từ `instance.json` `origin` (2026-10-03, aiobox 4bd14f7), `ingress.json` ra khỏi hợp đồng · Luật macro: aiobox `docs/feat/akimcp-connect.md`.

## Vì sao IMPORTANT

AIObox dựng connector AkiMCP trên Claude, Grok và ChatGPT bằng macro, và macro dựa vào những thứ AkiMCP sở hữu: file trong `~/.aki/mcpsv/`, panel loopback, trang authorize, tên hiển thị. Đổi một thứ ở AkiMCP mà không đổi AIObox (hoặc ngược lại) là macro hỏng âm thầm: xoá nhầm, không nhận ra connector của mình, hoặc treo ở trang authorize. Mọi thay đổi chạm vào § Hợp đồng phải sửa cả hai repo trong cùng phiên và cập nhật file này ở cả hai bản.

## Id và tên

- Tên connector/app macro tạo trên provider luôn là **`AkiMCP`**, đúng chữ đó. Macro nhận connector của mình bằng tên, không bằng host hay URL: tên viết thường, bỏ khoảng trắng mà chứa `akimcp` (`AkiMCP`, `Aki MCP Server`, `Aki MCP Server from local Shell & FileSystem`, `AkiMCPSV`), hoặc là tên cũ `Aki Mac MCPSV Shell & Filesystem` (danh sách `LEGACY` trong macro). Mọi tên AkiMCP từng gợi ý đều là của macro.
- Mỗi tài khoản provider chỉ có một `AkiMCP`. Một `AkiMCP` trỏ URL khác (máy khác, domain ingress cũ, path cũ) bị macro xoá không hỏi; máy chạy macro sau cùng thắng. Một tài khoản dùng nhiều máy cùng lúc: không hỗ trợ.
- Tên ngoài luật trên không bao giờ bị macro đụng tới. Mọi hướng dẫn phía AkiMCP (README, panel, snippet copy cho Claude/ChatGPT/Grok) phải bảo đặt tên `AkiMCP`, không gợi ý tên khác; một tên gợi ý mới không chứa `akimcp` thì phải thêm vào `LEGACY` của cả ba macro trong cùng phiên.
- URL connector = `origin` của `instance.json` + `/mcp`. Đổi domain ingress nghĩa là `AkiMCP` cũ thành sai URL và bị thay.

## Hợp đồng AIObox đọc từ AkiMCP

| Thứ | Hình dạng AIObox dựa vào | Ai đọc, đi đâu |
|---|---|---|
| `~/.aki/mcpsv/passphrase.txt` | một dòng, trim | `akimcp/files.rs::passphrase`; chỉ đưa vào trang trên host ingress |
| `~/.aki/mcpsv/instance.json` | `{ pid, panelPort, gatePort, token, version, origin, ingress, startedAt }`; `origin` = `"https://<host>"` (không `/` cuối) hoặc `null` khi chưa có ingress; `ingress` = `"funnel"`\|`"cloudflared"`\|`"public-origin"` hoặc `null`. `scripts/instance-lock.js` `writeLock` ghi sau khi panel bind, xoá khi tắt; còn file mà `pid` chết = AkiMCP crash | `akimcp/files.rs::instance` → `akimcp/panel.rs`; token chỉ dùng trong Rust gọi panel loopback, không bao giờ vào trang. `akimcp/files.rs::ingress` (nơi duy nhất đọc `origin`, `ingress`) → `akimcp/connect.rs`: `origin + /mcp` là URL macro tạo và so; thiếu file = AkiMCP chưa chạy, `origin: null` hoặc JSON hỏng = chạy nhưng chưa có địa chỉ công khai (run báo lỗi nêu `instance.json` và bảo bật Tailscale Funnel, Cloudflare tunnel hoặc `PUBLIC_ORIGIN`; thẻ Ready to connect cùng lời) |
| `~/.aki/mcpsv/tokens.json` | `{ access: { "<token>": { expires } }, refresh: {…} }`, `expires` là Unix ms (`scripts/oauth.js` `saveTokens`) | `akimcp/files.rs::access_token`: lấy token `access` đầu tiên còn hạn, làm bearer cho Custom MCP của Notion, chỉ đưa vào trang Notion; không đọc `refresh`. Roll token (mềm hay cứng) xoá token này: bearer Notion đã dán nhận `401` và không tự refresh (không có refresh token), chỉ sống lại khi AIObox chạy lại Notion connect và dán token mới; client OAuth (Claude, ChatGPT, Grok, và Notion khi nối bằng passphrase thay vì bearer) tự refresh. Notion nối bằng passphrase không cần file này; macro Notion connect của AIObox hiện vẫn dán bearer, phải chuyển sang passphrase (§ Việc phía AIObox) |
| Panel `GET http://127.0.0.1:<panelPort>/api/security`, header `x-panel-token` | `clients[]: { redirectHost, signedIn, tokenAt }`, `callers[]: { agent, lastSeen }` | `akimcp/panel.rs::Panel::security` (nơi duy nhất gọi panel); timeout 2 s; lỗi thì macro chỉ dựa vào URL |
| Redirect host của client DCR | `claude.ai`, `chatgpt.com`, `grok.com`; Notion: `notion.so`, `www.notion.so`, `app.notion.so`, `notion.com`, `www.notion.com`, `app.notion.com`, `mcp.notion.com` | phân biệt provider |
| User agent gọi `/mcp` | `Claude-User`, `openai-mcp`, `grok-connectors-manager` (tiền tố) | `lastCallAt` |
| Trang authorize | `input[name=passphrase]` + nút có chữ `Approve` | macro điền passphrase và bấm |
| DCR | mở, provider tự đăng ký client | Claude `Register automatically`, ChatGPT/Grok tự làm |

Đổi bất kỳ dòng nào: sửa `akimcp/files.rs` (file), `akimcp/panel.rs` (panel), `akimcp/connect.rs` (thứ macro nhận) hoặc macro, test (`cargo test --lib`, `node --test src-tauri/src/provider/macros.test.mjs`) và file này ở cả hai repo. Mỗi chỗ đọc trong code có comment trỏ về dòng của nó ở bảng trên; phía AkiMCP mỗi chỗ ghi/định dạng có comment trỏ về file này và `test/aiobox-contract.test.js` giữ hình dạng `instance.json`, `tokens.json`, `passphrase.txt`, `ingress.json`, `/api/security`. AIObox không còn đọc `ingress.json` (2026-10-03); file đó là việc riêng của AkiMCP, test giữ hình dạng nó bỏ được.

Origin cho mọi mode: Decided `origin` + `ingress` trong `instance.json` · because bên ghi duy nhất là tiến trình đang phục vụ origin đó, đúng cho Funnel, `PUBLIC_ORIGIN`, `--tunnel` và tunnel đã lưu, và AIObox đã đọc file này · rejected ghi origin Funnel vào `ingress.json` (trộn lựa chọn đã lưu với trạng thái chạy; `start.js` và panel đọc file này như lựa chọn), file riêng `origin.json` (thêm một vòng đời file), endpoint panel (HTTP cho một chuỗi không đổi suốt đời tiến trình) · reopen nếu ingress đổi được lúc đang chạy.

Đề xuất, chưa làm: một endpoint loopback `GET /api/aiobox` (cùng `x-panel-token`) trả `{ origin, ingress, passphrase, notionBearer, clients, callers }`, để AIObox đọc một chỗ thay vì bốn file; khi có, `passphrase.txt` và `tokens.json` ra khỏi hợp đồng và AkiMCP đổi định dạng file không còn làm vỡ AIObox. Giá: AkiMCP phải đang chạy (URL hiện cũng đã cần), secret vẫn chỉ ở Rust.

## Hợp đồng AkiMCP đọc từ AIObox

Provider `aiobox` của AkiMCP (`scripts/aiobox-mcp.js`, tool `aki__aiobox` và `aki__aiobox_write`) chỉ đọc các file dưới đây, không bao giờ ghi; AIObox là bên ghi. Provider tự ẩn khi không có `~/.aki/aiobox/`.

| Thứ | Hình dạng AkiMCP dựa vào | Ai ghi, ai đọc |
|---|---|---|
| `~/.aki/aiobox/cdp/windows.json` | `{ version: 1, profiles: [{ name, port, windows: [{ handle, tabs: [{ handle, targetId, url, title }] }] }] }`; provider suy từ host của `url`, theo id AIObox (`gpt`, `claude`, `grok`, `gemini`, `notion`, `gmail`, `cloudflare`) | AIObox ghi; AkiMCP đọc lại mỗi lần gọi, version khác 1 thì báo lỗi, target không còn trên port hoặc title mang handle khác thì báo map cũ (trang chưa có tiêu đề hoặc không có tiền tố handle vẫn nhận) |
| Handle cửa sổ | `P<n>·W<n>[·T<n>]` | AIObox `cdp/handle.rs::parse_handle`; AkiMCP `scripts/aiobox-mcp.js` cùng luật và cùng ví dụ test (`test/aiobox-mcp.test.js`) |
| `window.akipanel.capabilities` | `{ usage?: 1, chat?: 1, compose?: 2 }`: capability chuẩn trang này có, số = version shape; thiếu key = không có (aiobox `docs/arch/provider-capabilities.md`, SSoT: shape `desktop/panel/providers/capabilities.ts`, version + adapter list `desktop/panel/providers/capabilities.json`) | AIObox panel cài vào trang; AkiMCP kiểm `capabilities.chat === 1` trước khi gọi `live.chat()`, version khác thì báo lỗi rõ |
| `window.akipanel.live.chat()` | đồng bộ, chỉ đọc, không throw: `{ ok: true, data: { messages: [{ role: 'user'\|'assistant', text }], busy } }` hoặc `{ ok: false, error }` (không phải trang chat của provider, DOM đổi); chat mới chưa có tin là `ok` với `messages: []`; cũ nhất trước, bỏ thinking/tool step | AIObox provider adapter (Notion từ 2026-10-02, AP11, chỉ chat toàn trang `app.notion.com/chat` hoặc `/ai`, side panel chưa hỗ trợ); AkiMCP `op=read` trả lại `error` nguyên văn; trang không có capability thì đọc `document.body.innerText` (Notion không có `main`; cắt 20000 ký tự cuối) |
| `window.akipanel.live.compose(text)` (compose v2, async; `capabilities.json` `versions.compose: 2`) | Promise, không reject: `{ ok: true, data: null }` hoặc `{ ok: false, error }`; thêm text vào cuối composer, **không bao giờ gửi**. v1 (đồng bộ) báo hỏng nhầm khi Notion vẽ trễ; v2 chờ tối đa 600 ms | AIObox Notion adapter (2026-10-02, cùng địa chỉ với `chat`, paste tổng hợp); người dùng: Prompts trong panel, AkiMCP `aki__aiobox_write op=compose` (kiểm `capabilities.compose === 2`, `await`) |
| `window.akipanel.account` | `{ label, plan, login: 'unknown'\|'signed_in'\|'signed_out', observedAt } \| null` (observe của AIObox, không phải trang) | AIObox Rust `PanelAccount`; mọi provider; AkiMCP trả trong `aki__aiobox op=read` (`account`) |
| `window.akipanel.newWindow()`, `window.akipanel.online` | `newWindow()` không tham số, không trả gì: AIObox mở một cửa sổ cùng profile và provider như nút New window của panel (Rust `PanelCall::NewWindow` → `open_window_boxed`); chỉ gọi khi `online` | AIObox panel; AkiMCP `aki__aiobox_write op=new_window` gọi rồi chờ `windows.json` có handle mới của profile đó (tối đa 15 s) và trả handle |
| Đọc object `akipanel` qua CDP | `akipanel` là readonly Proxy: `Runtime.evaluate` `returnByValue` trả `{}` cho field object (`capabilities`, `account`, `window`); bọc `JSON.stringify(...)` rồi parse. Kết quả `live.chat()` là object thường, trả thẳng được | AkiMCP `scripts/aiobox-mcp.js` |

Đổi bất kỳ dòng nào: sửa `cdp/handle.rs` hoặc chỗ ghi `windows.json` bên AIObox, sửa `scripts/aiobox-mcp.js` bên AkiMCP, chạy `node ./test/aiobox-mcp.test.js` và cập nhật file này ở cả hai repo.

## Identity — đã bỏ

AkiMCP giữ **một access token chung** cho mọi client và chỉ phân biệt client theo redirect host (`docs/plan/done/single-access-token.md`). Hệ quả đã biết: `signedIn` theo provider chứ không theo tài khoản (hai tài khoản ChatGPT trên hai profile đọc như nhau), nên macro chỉ dùng tín hiệu này để reconnect một lần, không bao giờ để xoá; Roll token làm bearer Notion đã dán nhận `401` cho tới khi AIObox chạy lại Notion connect.

Decided (chủ, 2026-10-03): bỏ token theo client, `/api/identity`, bearer có tên và việc AIObox ghi `client_id` theo profile · because một người dùng, các token cùng quyền, và cái giá (đổi hình dạng `tokens.json` ở hai repo, lật `single-access-token.md`, viết lại `security.md`) lớn hơn lợi ích macro nhận đúng tài khoản · rejected token theo client + `GET /api/identity` (đề xuất 2026-10-01–03) · reopen nếu connector được chia cho người khác, hoặc macro xoá/giữ nhầm connector vì không phân biệt được tài khoản.

## Việc phía AkiMCP

- [x] README/panel/snippet: tên connector `AkiMCP` (2026-10-03): `scripts/config-page.js` `MCP_NAME = 'AkiMCP'` (ô MCP Name và câu instruction), `docs/ref/chatgpt-connector.md`, `docs/research/instruction-prompt-first-principles.md` dòng 64. Tên mới chứa `akimcp`, không cần thêm vào `LEGACY`.
- [x] Giữ nguyên hình dạng `/api/security` và các file ở § Hợp đồng: comment ở mỗi chỗ ghi, `test/aiobox-contract.test.js` (2026-10-03).
- [x] Origin cho mọi mode: `instance.json` `origin`, `ingress` (2026-10-03).
- [x] ~~Identity: token theo client + `/api/identity`~~: bỏ (chủ, 2026-10-03; § Identity).
- [x] `aki__aiobox_write op=compose` gọi `live.compose(text)` khi `capabilities.compose === 2` (chỉ điền, không gửi; version khác báo lỗi rõ) và `account` (2026-10-03, `scripts/aiobox-mcp.js`, test `test/aiobox-mcp.test.js`). Lệch đề xuất: `account` trả trong `op=read` (đã evaluate trang), không trong `op=windows` (chỉ đọc `windows.json`, không CDP từng tab); usage mỗi cửa sổ chưa thêm · reopen khi một tác vụ AI thật cần usage hoặc account của nhiều cửa sổ cùng lúc. Kiểm runtime chạy sau restart AkiMCP kế tiếp.
- [x] Kiểm runtime `aki__aiobox_write op=new_window` (2026-10-03, sau restart AkiMCP): từ P1·W4 (tài khoản test) ra `P1·W5` Notion `/ai`, title có tiền tố handle; đã đóng cửa sổ thử.

## Việc phía AIObox

- [x] Macro theo tên `AkiMCP`, một cái mỗi tài khoản, xoá không hỏi, reconnect khi `broken`, Claude Free một slot (2026-10-01).
- [x] ~~Ghi `client_id` theo profile và dùng `/api/identity`~~: bỏ cùng identity (chủ, 2026-10-03).
- [x] URL connector lấy từ `instance.json` `origin` thay vì `ingress.json` (§ Hợp đồng AIObox đọc từ AkiMCP; 2026-10-03, `akimcp/files.rs::ingress`).
- [ ] Macro Notion connect nối như Claude/ChatGPT: Notion tự đăng ký (DCR), macro điền passphrase trên trang authorize, bỏ dán bearer. Decided (chủ, 2026-10-03) · because bearer dán không có refresh token nên gãy mỗi lần Roll token và hết TTL, còn passphrase đã chạy ở phía AkiMCP (PR #7, `test/notion-oauth.test.js`) · rejected giữ dán bearer. Xong thì `tokens.json` ra khỏi hợp đồng và `notionBearer` ra khỏi đề xuất `/api/aiobox`.
