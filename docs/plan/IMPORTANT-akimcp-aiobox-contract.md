# IMPORTANT — Hợp đồng AkiMCP ↔ AIObox: id, tên, file, endpoint

> **IMPORTANT, ràng buộc cả hai repo.** Bản sinh đôi: `aiobox: docs/plan/IMPORTANT-akimcp-aiobox-contract.md`; hai bản giống nhau trừ dòng này, sửa một bản thì sửa luôn bản kia trong cùng phiên. Cùng nhóm: `docs/plan/IMPORTANT-shared-cdp-profiles.md` (một thư mục CDP profile chung).

Trạng thái: phần AIObox của luật đặt tên đã triển khai (2026-10-01); phần AkiMCP (§ Việc phía AkiMCP) chưa làm · Luật macro: aiobox `docs/feat/akimcp-connect.md`.

## Vì sao IMPORTANT

AIObox dựng connector AkiMCP trên Claude, Grok và ChatGPT bằng macro, và macro dựa vào những thứ AkiMCP sở hữu: file trong `~/.aki/mcpsv/`, panel loopback, trang authorize, tên hiển thị. Đổi một thứ ở AkiMCP mà không đổi AIObox (hoặc ngược lại) là macro hỏng âm thầm: xoá nhầm, không nhận ra connector của mình, hoặc treo ở trang authorize. Mọi thay đổi chạm vào § Hợp đồng phải sửa cả hai repo trong cùng phiên và cập nhật file này ở cả hai bản.

## Id và tên

- Tên connector/app macro tạo trên provider luôn là **`AkiMCP`**, đúng chữ đó. Macro nhận connector của mình bằng tên, không bằng host hay URL: tên viết thường, bỏ khoảng trắng mà chứa `akimcp` (`AkiMCP`, `Aki MCP Server`, `Aki MCP Server from local Shell & FileSystem`, `AkiMCPSV`), hoặc là tên cũ `Aki Mac MCPSV Shell & Filesystem` (danh sách `LEGACY` trong macro). Mọi tên AkiMCP từng gợi ý đều là của macro.
- Mỗi tài khoản provider chỉ có một `AkiMCP`. Một `AkiMCP` trỏ URL khác (máy khác, domain ingress cũ, path cũ) bị macro xoá không hỏi; máy chạy macro sau cùng thắng. Một tài khoản dùng nhiều máy cùng lúc: không hỗ trợ.
- Tên ngoài luật trên không bao giờ bị macro đụng tới. Mọi hướng dẫn phía AkiMCP (README, panel, snippet copy cho Claude/ChatGPT/Grok) phải bảo đặt tên `AkiMCP`, không gợi ý tên khác; một tên gợi ý mới không chứa `akimcp` thì phải thêm vào `LEGACY` của cả ba macro trong cùng phiên.
- URL connector = `origin` của `ingress.json` + `/mcp`. Đổi domain ingress nghĩa là `AkiMCP` cũ thành sai URL và bị thay.

## Hợp đồng AIObox đọc từ AkiMCP

| Thứ | Hình dạng AIObox dựa vào | Ai đọc, đi đâu |
|---|---|---|
| `~/.aki/mcpsv/ingress.json` | `{ "origin": "https://<host>" }` | Rust `provider/akimcp.rs`; `origin + /mcp` là URL macro tạo và so; thiếu file thì run báo lỗi nêu tên file |
| `~/.aki/mcpsv/passphrase.txt` | một dòng, trim | chỉ đưa vào trang trên host ingress |
| `~/.aki/mcpsv/instance.json` | `{ panelPort, token }` | token chỉ dùng trong Rust gọi panel loopback, không bao giờ vào trang |
| Panel `GET http://127.0.0.1:<panelPort>/api/security`, header `x-panel-token` | `clients[]: { redirectHost, signedIn, tokenAt }`, `callers[]: { agent, lastSeen }` | timeout 2 s; lỗi thì macro chỉ dựa vào URL |
| Redirect host của client DCR | `claude.ai`, `chatgpt.com`, `grok.com` | phân biệt provider |
| User agent gọi `/mcp` | `Claude-User`, `openai-mcp`, `grok-connectors-manager` (tiền tố) | `lastCallAt` |
| Trang authorize | `input[name=passphrase]` + nút có chữ `Approve` | macro điền passphrase và bấm |
| DCR | mở, provider tự đăng ký client | Claude `Register automatically`, ChatGPT/Grok tự làm |

Đổi bất kỳ dòng nào: sửa `provider/akimcp.rs` hoặc macro, test (`cargo test --lib`, `node --test src-tauri/src/provider/macros.test.mjs`) và file này ở cả hai repo.

## Identity — việc chủ máy cần (chưa làm)

Hiện AkiMCP cấp **một access token chung** cho mọi client và chỉ phân biệt client theo redirect host. Hệ quả: `signedIn` là theo provider chứ không theo tài khoản. Hai tài khoản ChatGPT trên hai profile đọc như nhau; một profile đã đăng nhập làm profile kia trông như ổn. Vì vậy macro chỉ dùng tín hiệu này để reconnect một lần, không bao giờ để xoá.

Mục tiêu: AIObox biết chắc "connector `AkiMCP` của tài khoản X trên profile Y còn token AkiMCP hợp lệ không".

Đề xuất (chưa chốt chi tiết):

1. **AkiMCP: token theo client.** Mỗi client DCR có access/refresh token riêng; log và revoke theo `client_id`.
2. **AkiMCP: endpoint identity.** `GET /api/identity?client_id=<id>` (panel loopback, cùng `x-panel-token`) → `{ clientId, clientName, redirectHost, registeredAt, signedIn, tokenAt, lastCallAt, revoked }`. Không trả token.
3. **AIObox: ghi `client_id` theo profile.** Runner đã theo dõi tab authorize (`cdp::inject::follow_loads`) nên thấy URL `/authorize?client_id=…`; ghi `client_id` vào `registry.json` của profile, theo provider. Lần chạy sau, runner hỏi `/api/identity` bằng `client_id` đó thay vì đoán theo redirect host.
4. **Macro:** `client` trở thành theo tài khoản; lúc đó `broken` mới đủ chắc để tự xoá và tạo lại.

Mở: ChatGPT/Grok có đổi `client_id` khi tạo lại app không (gần như chắc có, vì DCR mới); client cũ có cần AkiMCP dọn không; giới hạn số client DCR.

## Việc phía AkiMCP

- [ ] README/panel/snippet: tên connector `AkiMCP`, một cái mỗi tài khoản; bỏ mọi tên gợi ý khác. Chỗ đã thấy: `scripts/config-page.js` `MCP_NAME = 'Aki MCP Server from local Shell & FileSystem'` (panel gợi ý tên này), `docs/research/instruction-prompt-first-principles.md` dòng 64.
- [ ] Giữ nguyên hình dạng `/api/security` và các file ở § Hợp đồng; đổi thì theo quy trình ở trên.
- [ ] Identity: token theo client + `/api/identity` (§ Identity 1–2).

## Việc phía AIObox

- [x] Macro theo tên `AkiMCP`, một cái mỗi tài khoản, xoá không hỏi, reconnect khi `broken`, Claude Free một slot (2026-10-01).
- [ ] Ghi `client_id` theo profile và dùng `/api/identity` khi AkiMCP có (§ Identity 3–4).
