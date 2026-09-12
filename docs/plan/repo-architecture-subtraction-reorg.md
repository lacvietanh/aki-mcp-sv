# Plan: Tái cấu trúc kho mã nguồn khoa học, tinh gọn & thực thi Subtraction Audit

> **Tài liệu nghiên cứu cơ sở**: [`docs/research/repo-architecture-subtraction-inventory.md`](file:///Volumes/DEV/pj/aki-mcp-sv/docs/research/repo-architecture-subtraction-inventory.md)  
> **Trạng thái**: Bản kế hoạch đề xuất (Pending User Authorization per `agent.B5` / `agent.B3`).  
> **Cam kết**: Giữ vững nguyên tắc single-process, bảo toàn tính tương thích ngược tuyệt đối với mọi AI client và prompt có sẵn.

---

## 1. Mục tiêu

1. **Vá ngay lỗ hổng kiểm thử**: Đưa đầy đủ 8/8 bài kiểm thử vào lệnh `npm test` trong `package.json` (hiện chỉ chạy 4/8).
2. **Loại bỏ trùng lặp & file đặt sai vị trí**: Xóa file prompt trùng lặp 100% byte trong `scripts/aki-pmcontrol/data/`, đưa `dev/plan-bigidea-3-topics.md` về đúng `docs/plan/` và dọn sạch thư mục `dev/`.
3. **Tổ chức không gian thư mục `scripts/` theo miền (Domain Grouping)**: Chấm dứt tình trạng 25 file nằm phẳng lẫn lộn; phân tách tường minh thành `scripts/core/`, `scripts/tools/`, `scripts/ui/`, `scripts/postman/`.
4. **Chuẩn hóa trạng thái Git**: Commit sạch sẽ các file untracked load-bearing (`rule-context` stack và `cdp-probe.js`).

---

## 2. So sánh Trước → Sau (BEFORE vs AFTER)

| Thành phần | Trước (Hiện tại) | Sau (Đề xuất) |
|---|---|---|
| **Lệnh `npm test`** | Chạy 4 file test thiếu sót | Chạy trọn vẹn 8/8 test suites (bổ sung `roots`, `shell-mcp`, `rule-context-mcp`, `rule-context`) |
| **Cấu trúc `scripts/`** | 25 file nằm phẳng lẫn lộn core, tool, UI | Phân 4 miền chuyên biệt: `scripts/core/`, `scripts/tools/`, `scripts/ui/`, `scripts/postman/` |
| **Thư mục `dev/`** | Tồn tại ad-hoc chứa 1 file plan | Xóa bỏ thư mục `dev/`; file plan được chuyển vào `docs/plan/` |
| **Dữ liệu prompt Postman** | Tồn tại `scripts/aki-pmcontrol/data/aki-postman-instruction.md` trùng lặp | Xóa bỏ file trùng lặp; fallback đọc trực tiếp từ `assets/prompts/postman.md` |
| **Trạng thái Git** | 11 file untracked chưa được đóng gói | Toàn bộ tính năng `rule-context` và test suites được commit rõ ràng theo conventional commits |

---

## 3. Ranh giới ảnh hưởng & Ánh xạ đường dẫn (Blast Radius)

### Bảng di chuyển file dự kiến trong `scripts/`

```
scripts/
├── core/
│   ├── start.js             (Entrypoint)
│   ├── gatekeeper.js        (Public HTTP & OAuth 2.1 gateway)
│   ├── streamable-bridge.js (Streamable HTTP MCP bridge)
│   ├── tools-server.js      (McpServer factory & tool aggregator)
│   ├── oauth.js             (OAuth 2.1 authorization server)
│   ├── userdata.js          (Storage paths SSoT)
│   ├── roots.js             (Path containment & security)
│   ├── allowlist.js         (Shell allowlist & settings)
│   ├── tailscale.js         (Tailscale CLI integration)
│   ├── update-check.js      (Background updater)
│   ├── http.js              (HTTP utilities)
│   ├── log.js               (Console logger)
│   └── open-browser.js      (Cross-platform browser launcher)
├── tools/
│   ├── mcp-tool.js          (Standard MCP response helper)
│   ├── filesystem-mcp.js    (Filesystem tools)
│   ├── shell-mcp.js         (Shell command runner)
│   ├── search-mcp.js        (Tree search & grep)
│   ├── agy-mcp.js           (Antigravity CLI runner)
│   ├── kiro-mcp.js          (Kiro CLI runner)
│   ├── postman-mcp.js       (Postman daemon supervisor)
│   ├── rule-context-mcp.js  (Context handshake tool)
│   └── rule-context.js      (Context graph engine)
├── ui/
│   ├── panel.js             (Loopback panel server & REST API)
│   ├── config-page.js       (SSR HTML renderer)
│   └── html.js              (HTML escaping helper)
└── postman/                 (Đổi tên từ scripts/aki-pmcontrol/)
    ├── index.js
    ├── package.json
    ├── assets/
    └── scripts/
```

### Các điểm import cần cập nhật đồng bộ (Call Sites)
1. **`package.json`**:
   - `"main": "scripts/core/start.js"`
   - `"scripts": { "start": "node scripts/core/start.js", ... }`
2. **`scripts/core/start.js`**:
   - Cập nhật import `gatekeeper.js`, `panel.js`, `streamable-bridge.js`, `tailscale.js`, `update-check.js`, `userdata.js`, `open-browser.js`.
3. **`scripts/core/streamable-bridge.js`**:
   - Cập nhật import `tools-server.js`.
4. **`scripts/core/tools-server.js`**:
   - Cập nhật import 7 tool arms từ `../tools/*.js`.
5. **`scripts/ui/panel.js`**:
   - Cập nhật import `config-page.js`, `html.js`, `../core/userdata.js`, `../core/allowlist.js`, `../tools/postman-mcp.js`.
6. **`test/*.test.js`**:
   - Cập nhật đường dẫn import module tương ứng từ `../scripts/core/` và `../scripts/tools/`.

---

## 4. Các giai đoạn triển khai chi tiết

### Giai đoạn 1: Vá lỗ hổng kiểm thử trong `package.json` (Thực hiện ngay, 0 rủi ro)
Cập nhật thuộc tính `"test"` trong `package.json`:
```json
"test": "node ./test/streamable-bridge.test.js && node ./test/oauth.test.js && node ./test/postman-mcp.test.js && node ./test/aki-pmcontrol-copy.test.js && node ./test/roots.test.js && node ./test/shell-mcp.test.js && node ./test/rule-context-mcp.test.js && node ./test/rule-context.test.js"
```
Chạy `npm test` để xác minh toàn bộ 8 bài test đều PASS.

### Giai đoạn 2: Xử lý tệp tin dư thừa & tệp tin đặt sai vị trí
1. Xóa bỏ `scripts/aki-pmcontrol/data/aki-postman-instruction.md`.
2. Kiểm tra `scripts/aki-pmcontrol/index.js` đảm bảo fallback chain trỏ thẳng vào `scripts/aki-pmcontrol/assets/prompts/postman.md`.
3. Di chuyển `dev/plan-bigidea-3-topics.md` vào `docs/plan/plan-bigidea-3-topics.md`.
4. Xóa thư mục rỗng `dev/`.

### Giai đoạn 3: Tái cấu trúc thư mục `scripts/` theo miền logic
1. Tạo các thư mục con: `scripts/core/`, `scripts/tools/`, `scripts/ui/`.
2. Di chuyển các file mã nguồn vào đúng miền chức năng tương ứng.
3. Cập nhật đường dẫn `import` trong toàn bộ các file mã nguồn và bộ test trong `test/`.
4. Cập nhật `package.json` entrypoint.

### Giai đoạn 4: Đóng gói commit sạch sẽ cho tính năng `rule-context`
Gom nhóm và commit các file tính năng đã hoàn thiện và kiểm thử thành công:
- `docs/arch/rule-context-delivery.md`
- `docs/plan/rule-context-handshake.md`
- `scripts/tools/rule-context.js`
- `scripts/tools/rule-context-mcp.js`
- `test/rule-context.test.js`
- `test/rule-context-mcp.test.js`

### Giai đoạn 5: Quy chuẩn lưu trữ tài liệu lịch sử `docs/plan/done/`
- Đề xuất bổ sung phụ lục vào `RULE-docs.md`: Cho phép nén hoặc gom các plan đã hoàn thành quá 30 ngày vào 1 file mục lục lịch sử duy nhất `docs/plan/history.md`, tránh phân mảnh 30 file gây loãng context tìm kiếm của agent.

---

## 5. Tiêu chuẩn nghiệm thu (Verification Gate)

1. **Unit & Integration Tests**: `npm test` chạy thành công toàn bộ 8 suites với mã thoát 0.
2. **Syntax Smoke Test**: Chạy `node --check` trên toàn bộ các file JS trong `scripts/core/`, `scripts/tools/`, `scripts/ui/`, `scripts/postman/`.
3. **Runtime Handshake**: Khởi động server ở chế độ dry-run / warm-up, kiểm tra endpoint `/mcp` khởi tạo và phản hồi danh sách 7 tool domains bình thường.
4. **Git Tree Hygiene**: Thư mục `dev/` biến mất, không còn file rác untracked ngoài ý muốn.
