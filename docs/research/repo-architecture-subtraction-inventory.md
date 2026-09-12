# Nghiên cứu kiến trúc, kiểm kê toàn diện & Subtraction Audit: `aki-mcp-sv`

**Thời điểm**: 2026-09-11 · Git baseline `80f1b6b` (Node 22.14.0 ESM)  
**Cơ chế kích hoạt**: Hội đồng `/akiflow` + `/akithink` 6 lượt hội tụ + `METHOD-audit-subtraction.md`  
**Hội đồng thẩm định**: `hands-inventory` (Kiểm kê chi tiết), `judge-subtraction` (Trọng tài tinh giảm), `challenger` (Phản biện độc lập)  
**Nhãn chứng cứ**: `[FACT]`, `[CONSTRAINT]`, `[ASSUMPTION]`

---

## 1. Tóm tắt điều hành & Radar bất thường (Anomaly Radar)

### Chỉ số hiện trạng kho mã nguồn
- **Tổng số file theo dõi & tài liệu nguồn**: 89 files (đã loại trừ `.git/`, `node_modules/`, `.DS_Store`).
- **Mã nguồn thực thi**: 25 files trong `scripts/` + 11 files trong `scripts/aki-pmcontrol/`.
- **Bộ kiểm thử**: 8 test suites trong `test/`.
- **Tài nguyên tĩnh & Giao diện**: 14 files + 2 thư mục con (15 hình ảnh/icon/manifest).
- **Tài liệu & Kế hoạch**: 57 markdown files (trong đó có 30 file kế hoạch đã đóng trong `docs/plan/done/`).

### Các bất thường kỹ thuật nghiêm trọng phát hiện được
1. **[FACT] Lỗ hổng script test trong `package.json`**:
   Lệnh `npm test` hiện tại chỉ chạy 4/8 test suites (`streamable-bridge.test.js`, `oauth.test.js`, `postman-mcp.test.js`, `aki-pmcontrol-copy.test.js`).
   Có 4 bài kiểm thử cực kỳ quan trọng bị bỏ quên, không được tự động chạy khi CI hoặc dev gõ `npm test`:
   - `test/roots.test.js`: Kiểm thử chống vượt quyền thư mục (path traversal, symlink escape, tilde expansion).
   - `test/shell-mcp.test.js`: Kiểm thử phân tích token lệnh shell, bóc tách quote và chặn các toán tử chaining độc hại (`|`, `$`, `&`).
   - `test/rule-context-mcp.test.js`: Kiểm thử đăng ký công cụ và giao thức bắt tay `akidevrule_context`.
   - `test/rule-context.test.js`: Kiểm thử toàn diện giải quyết đồ thị `@import`, phát hiện đệ quy lặp (cycle) và tính receipt hash SHA256.
2. **[FACT] Nhân bản mã nguồn (Code Duplication) ở trình kiểm tra cập nhật**:
   - `scripts/update-check.js` (99 dòng, ESM): Kiểm tra semver của `aki-mcp-sv` và `akidevrule` qua GitHub raw.
   - `scripts/aki-pmcontrol/scripts/update-check.js` (136 dòng, CJS): Sao chép gần như nguyên vẹn logic so sánh semver và parse changelog phục vụ riêng cho daemon Postman.
3. **[FACT] Tệp tin prompt trùng lặp 100% byte**:
   - `scripts/aki-pmcontrol/data/aki-postman-instruction.md` (236 bytes, 2 dòng) trùng khớp từng ký tự với `scripts/aki-pmcontrol/assets/prompts/postman.md`.
4. **[FACT] Ốc đảo CommonJS nằm trong dự án ESM**:
   - Gốc repo khai báo `"type": "module"`. Tuy nhiên, `scripts/aki-pmcontrol/package.json` chứa `{"type":"commonjs"}` để nạp code `chrome-remote-interface` bằng `require()`.
5. **[FACT] Tệp tin injection nguyên khối cực lớn**:
   - `scripts/aki-pmcontrol/scripts/cdp-autoclicker.js` dài 1,869 dòng (73.7 KB). File này chứa toàn bộ observer DOM, bus sự kiện, thuật toán selector, render floating UI và cơ chế tự động click trong webview Postman.
6. **[FACT] Tài liệu kế hoạch đặt sai thư mục**:
   - `dev/plan-bigidea-3-topics.md` nằm riêng lẻ trong thư mục ad-hoc `dev/` thay vì nằm trong `docs/plan/`.
7. **[FACT] Phình to tài liệu lịch sử**:
   - `docs/plan/done/` tích lũy 30 file markdown (>4,200 dòng) từ các phiên bản cũ, gây loãng context tìm kiếm toàn dự án.

---

## 2. Kiểm kê chi tiết toàn bộ file theo 7 phân hệ logic

### Phân hệ 1: Core Server & HTTP/OAuth Bridge (13 files)
*Chịu trách nhiệm khởi động, quản lý cổng kết nối ngoài (Tailscale Funnel / Cloudflare Tunnel), cấp quyền OAuth 2.1 / DCR và multiplex HTTP stream `/mcp` vào tiến trình MCP duy nhất.*

| Đường dẫn file | Dòng | Vai trò & Mục đích cụ thể | Đối tượng gọi / Tiêu thụ chính | Nhãn chứng cứ |
|---|---|---|---|---|
| `scripts/start.js` | 159 | Điểm vào CLI (`npm start`). Điều phối Ingress theo độ ưu tiên: Cloudflare -> Public Origin -> Panel Ingress -> Tailscale Funnel. Khởi tạo gatekeeper, web panel, warm MCP server và xử lý dọn dẹp tiến trình khi thoát (`SIGINT`/`SIGTERM`/`exit`). | Người dùng terminal, PM2, daemon | [FACT] Single-process [CONSTRAINT] Foreground only |
| `scripts/gatekeeper.js` | 76 | HTTP server public (`GATEKEEPER_PORT`, 9999). Công bố OAuth metadata, tiếp nhận `/authorize`, `/token`, `/register`, phục vụ static assets và chặn Bearer token ở endpoint `/mcp`. | `scripts/start.js`, AI clients (Claude, ChatGPT, Grok, Gemini) | [FACT] Public ingress [CONSTRAINT] Mandatory bearer check |
| `scripts/streamable-bridge.js` | 168 | Cầu nối streamable HTTP cho POST `/mcp`. Duy trì duy nhất 1 phiên `InMemoryTransport` nội bộ tới `tools-server.js`. Multiplex các session ngoài, cache kết quả `initialize`, quản lý timeout. | `scripts/gatekeeper.js`, `scripts/start.js` | [FACT] Internal single session [CONSTRAINT] Re-use init cache |
| `scripts/tools-server.js` | 37 | Factory tạo thực thể `McpServer`. Đăng ký 7 miền công cụ và tự động gắn tiền tố `aki__` cho mọi công cụ nhằm tương thích ngược. | `scripts/streamable-bridge.js`, `scripts/start.js` | [FACT] SSoT tool prefix [CONSTRAINT] Đồng bộ khởi tạo |
| `scripts/oauth.js` | 373 | Máy chủ cấp quyền OAuth 2.1 thu nhỏ. Triển khai RFC 7591 DCR (cho ChatGPT/Grok), client cấu hình sẵn (Claude/Gemini), thẩm tra PKCE S256 và lưu token ra đĩa. | `gatekeeper.js`, `start.js`, `panel.js` | [FACT] File `tokens.json` [CONSTRAINT] Strict redirect allowlist |
| `scripts/userdata.js` | 28 | Nguồn chân lý duy nhất (SSoT) định nghĩa đường dẫn lưu trữ dưới `~/.aki/mcpsv/` (settings, clients, passphrase, tokens, ingress). Ép quyền bảo mật thư mục `0o700`. | `start.js`, `oauth.js`, `panel.js`, `allowlist.js` | [FACT] Enforce 0700 permission |
| `scripts/roots.js` | 89 | Ranh giới an ninh tệp tin: Chuẩn hóa đường dẫn, mở rộng dấu ngã `~`, kiểm tra `realpath` chống bypass symlink và kiểm tra quan hệ bao bọc (`overlaps`). | `filesystem-mcp.js`, `shell-mcp.js`, `search-mcp.js`, `panel.js` | [FACT] Case-insensitive Windows [CONSTRAINT] Vành đai an ninh RCE |
| `scripts/allowlist.js` | 81 | Quản lý danh sách trắng lệnh shell. Định nghĩa `DEFAULT_ALLOWLIST`, chuẩn hóa 3 đời schema settings, nạp custom trusted dirs và folder roots. | `shell-mcp.js`, `panel.js`, `roots.js`, `agy-mcp.js` | [FACT] Normalizes 3 legacy schemas [CONSTRAINT] Cấm subshell độc hại |
| `scripts/tailscale.js` | 41 | Wrapper thực thi lệnh Tailscale CLI (`status --json`, `funnel`, `up`). Đọc MagicDNS hostname và trạng thái Funnel trên port 9999. | `scripts/start.js`, `scripts/panel.js` | [FACT] Tailscale JSON CLI [CONSTRAINT] Bỏ qua nếu máy chưa cài |
| `scripts/update-check.js` | 99 | Trình kiểm tra phiên bản mới ngầm. Đọc semver của `aki-mcp-sv` và `akidevrule` từ GitHub raw không làm chậm khởi động. Dùng `node:https` để tối ưu RAM. | `scripts/start.js`, `scripts/panel.js` | [FACT] Native https, low RSS overhead |
| `scripts/http.js` | 39 | Tiện ích HTTP cốt lõi: `readBody`, helper `json()`, và `serveStatic` kèm kiểm tra chống path traversal và nhận diện MIME type. | `gatekeeper.js`, `panel.js`, `streamable-bridge.js` | [FACT] Safe static file serving |
| `scripts/log.js` | 5 | Tiện ích in nhật ký console định dạng ISO (`log`, `logErr`). | Toàn bộ core server | [FACT] Lightweight console logger |
| `scripts/open-browser.js` | 18 | Helper mở URL trên trình duyệt mặc định đa hệ điều hành (`open` trên Mac, `cmd /c start` trên Windows, `xdg-open` trên Linux). | `scripts/start.js` | [FACT] Thay thế package ngoài |

---

### Phân hệ 2: MCP Tool Providers (9 files)
*Triển khai các công cụ Model Context Protocol cụ thể đăng ký dưới tiền tố `aki__`.*

| Đường dẫn file | Dòng | Vai trò & Mục đích cụ thể | Đối tượng gọi / Tiêu thụ chính | Nhãn chứng cứ |
|---|---|---|---|---|
| `scripts/mcp-tool.js` | 5 | Helper chuẩn hóa format phản hồi MCP `{ content: [{ type: 'text', text }], isError }` (`ok`, `err`, `fail`). | Toàn bộ các module `*-mcp.js` | [FACT] SSoT MCP response envelope |
| `scripts/filesystem-mcp.js` | 288 | 7 công cụ thao tác file: `read_text_file`, `read_file_lines`, `write_file` (ghi nguyên tử atomic wx+temp+rename), `edit_file` (áp unified diff), `create_directory`, `move_file`, `get_file_info`. | `scripts/tools-server.js` | [FACT] Thay thế hoàn toàn server filesystem ngoài |
| `scripts/shell-mcp.js` | 173 | Công cụ thực thi lệnh `aki__run_cmd`. Tokenize bóc quotes, chặn metacharacter chưa bọc quote (`;&|$\<>`), đối chiếu allowlist và trusted directories. | `scripts/tools-server.js` | [FACT] Whitelist-only [CONSTRAINT] Chặn interpreter ngoài trusted zone |
| `scripts/search-mcp.js` | 122 | Công cụ tra cứu toàn cây trong 1 lượt: `aki__find_path` (BFS lướt cây) và `aki__search_content` (`grep -rniIE`). Loại trừ sẵn `node_modules`, `.git`. | `scripts/tools-server.js` | [FACT] Tối ưu giảm số turn chat của AI |
| `scripts/agy-mcp.js` | 72 | Công cụ `aki__agy_run` gọi Antigravity CLI. Khóa chặt các mode allowlist (mặc định: `plan`), truyền mảng tham số trực tiếp không qua shell. | `scripts/tools-server.js` | [FACT] Read-only retrieval tool [CONSTRAINT] Flag `-p` luôn ở cuối |
| `scripts/kiro-mcp.js` | 51 | Công cụ `aki__kiro_read` gọi `kiro-cli`. Khóa cố định model `claude-sonnet-4.5` và `--trust-tools=fs_read`. | `scripts/tools-server.js` | [FACT] Read-only arm [CONSTRAINT] Model và flags cố định |
| `scripts/postman-mcp.js` | 165 | Công cụ `aki__postman_status` và daemon supervisor điều khiển tiến trình con `scripts/aki-pmcontrol/` (`launchPostmanDaemon`, `killPostmanDaemon`, `requestNewWindow`). | `scripts/tools-server.js`, `scripts/panel.js` | [FACT] Không tự boot daemon [CONSTRAINT] Kích hoạt thủ công |
| `scripts/rule-context-mcp.js` | 31 | Công cụ `aki__akidevrule_context`. Trả về metadata phiên và hướng dẫn bootstrap rule cho AI client khi bắt đầu làm việc. | `scripts/tools-server.js` | [FACT] Entrypoint handshake |
| `scripts/rule-context.js` | 197 | Engine nạp quy tắc: Phân giải đồ thị `@import`, phát hiện đệ quy lặp (cycle), đối chiếu ưu tiên `CLAUDE.md`/`AGENTS.md`, cache và tính SHA256 receipt. | `scripts/rule-context-mcp.js` | [FACT] Deterministic receipt hashing |

---

### Phân hệ 3: Web Panel & Static UI (5 code files + 18 static assets)
*Giao diện loopback cấu hình cục bộ (`127.0.0.1:9998`) cho người dùng quản lý thư mục, allowlist, Cloudflare tunnel và Postman.*

| Đường dẫn file | Dòng | Vai trò & Mục đích cụ thể | Đối tượng gọi / Tiêu thụ chính | Nhãn chứng cứ |
|---|---|---|---|---|
| `scripts/panel.js` | 282 | HTTP server nội bộ (`PANEL_PORT`, 9998), chỉ lắng nghe loopback. Bảo vệ bằng token (`?t=...`). REST API quản lý cấu hình, allowlist, tunnel và daemon Postman. | `scripts/start.js`, browser nội bộ | [FACT] Loopback only [CONSTRAINT] Không expose ra public |
| `scripts/config-page.js` | 369 | SSR renderer sinh giao diện HTML bảng điều khiển: Tab cài đặt (Claude, ChatGPT, Gemini, Grok, Postman), clipboard blocks, SVG icons và chân trang. | `scripts/panel.js` | [FACT] Inlined template rendering |
| `scripts/html.js` | 3 | Hàm escape HTML (`esc`) chống tấn công XSS trong render panel. | `scripts/config-page.js`, `scripts/oauth.js` | [FACT] SSoT HTML sanitization |
| `public/panel-client.js` | 444 | Script frontend chạy trong trình duyệt: Quản lý spy-nav, gọi REST API bất đồng bộ, chuyển tab, clipboard feedback, polling trạng thái. | Trình duyệt người dùng (`GET /panel-client.js`) | [FACT] Vanilla JS, không bundle cồng kềnh |
| `public/panel.css` | 128 | CSS stylesheet cho web panel: Hỗ trợ dark/light theme (`prefers-color-scheme`), responsive layout, stepper cards. | Trình duyệt người dùng (`GET /panel.css`) | [FACT] Pure CSS |
| `public/favicon/*` (7 files) | - | Bộ icon đa kích thước (`favicon.ico`, `apple-touch-icon.png`, 48/96/192/512px) và `manifest.json`. | Browser tab / PWA install | [FACT] Static brand assets |
| `public/img/*` & Root `public/*` (16 files) | - | Logo các nền tảng AI (Claude, GPT, Gemini, Grok, Postman), ảnh chụp màn hình hướng dẫn và mã QR donate. | README, Panel UI | [FACT] Visual UI assets |

---

### Phân hệ 4: Postman CDP Controller (`scripts/aki-pmcontrol/`, 13 files)
*Sub-project con CommonJS chuyên tự động hóa Postman Desktop qua Chrome DevTools Protocol (CDP).*

| Đường dẫn file | Dòng | Vai trò & Mục đích cụ thể | Đối tượng gọi / Tiêu thụ chính | Nhãn chứng cứ |
|---|---|---|---|---|
| `scripts/aki-pmcontrol/package.json` | 2 | Khai báo `{"type":"commonjs"}` để Node xử lý `require()` trong toàn bộ cây con này. | Node module loader | [FACT] CJS boundary marker |
| `scripts/aki-pmcontrol/index.js` | 583 | Daemon tiến trình chủ. Kết nối CDP tới Postman qua cổng debug, quản lý multi-window, định kỳ lấy token usage và inject script. | `scripts/postman-mcp.js` | [FACT] Long-running CDP daemon process |
| `scripts/aki-pmcontrol/scripts/cdp-autoclicker.js` | 1869 | File injection nguyên khối cực lớn. Được inject vào renderer Postman qua `Runtime.evaluate`: Quan sát DOM, tự click duyệt tool, tự bấm continue loop, vẽ floating UI Aki. | `index.js` inject vào Postman DOM | [FACT] File lớn nhất repo (73.7 KB) |
| `scripts/aki-pmcontrol/scripts/cdp-probe.js` | 246 | CLI chẩn đoán độc lập. Kết nối CDP và dump cấu trúc DOM, button selector của Postman mà không chỉnh sửa trạng thái. | Developer chạy thủ công khi debug selector | [FACT] Read-only debugging probe |
| `scripts/aki-pmcontrol/scripts/cdp-usage.js` | 118 | Lấy số dư token AI trực tiếp từ gateway proxy của Postman (`bifrost-premium-https-v4...`) thông qua `x-access-token`. | `scripts/aki-pmcontrol/index.js` | [FACT] Integrates Postman billing gateway |
| `scripts/aki-pmcontrol/scripts/daemon-pid.js` | 42 | Quản lý file lock PID (`~/.aki/cdp-postman/daemon.pid`) và kiểm tra tiến trình sống/chết tránh chạy trùng lặp. | `postman-mcp.js`, `index.js` | [FACT] PID lockfile SSoT |
| `scripts/aki-pmcontrol/scripts/instruction-store.js` | 35 | Tiện ích đọc/ghi và copy file prompt mặc định mà không đè cấu hình cá nhân của người dùng. | `index.js`, `test/aki-pmcontrol-copy.test.js` | [FACT] Safe file copy helper |
| `scripts/aki-pmcontrol/scripts/postman-paths.js` | 77 | Dò tìm đường dẫn cài đặt Postman, file thực thi và `app.asar` trên macOS, Windows, Linux. | `scripts/aki-pmcontrol/scripts/postman-session.js` | [FACT] Multi-platform path resolver |
| `scripts/aki-pmcontrol/scripts/postman-session.js` | 65 | Đọc file `DevToolsActivePort`. Nếu Postman chưa chạy, tự kích hoạt Postman với flag `--remote-debugging-port`. | `index.js`, `cdp-probe.js` | [FACT] CDP port detector & launcher |
| `scripts/aki-pmcontrol/scripts/update-check.js` | 136 | Bản clone CommonJS của logic kiểm tra phiên bản rule từ `~/.aki/akidevrule/CHANGELOG.md` và GitHub. | `scripts/aki-pmcontrol/index.js` | [FACT] Duplicated logic |
| `scripts/aki-pmcontrol/assets/prompts/aki-prompt-sum-to-new-chat.md` | 21 | Prompt mẫu tóm tắt ngữ cảnh khi chuyển phiên chat mới trong Postman. | `instruction-store.js` | [FACT] Default prompt template |
| `scripts/aki-pmcontrol/assets/prompts/postman.md` | 2 | Instruction mẫu yêu cầu Postman AI gọi `aki__akidevrule_context` đầu phiên. | `instruction-store.js` | [FACT] Default Postman AI instruction |
| `scripts/aki-pmcontrol/data/aki-postman-instruction.md` | 2 | Bản sao lưu cũ trùng 100% nội dung với `postman.md`. | Fallback cũ trong `index.js` | [FACT] 100% redundant |

---

### Phân hệ 5: Test Suite (8 files)
*Bộ kiểm thử đơn vị và tích hợp chạy bằng Node test runner thuần.*

| Đường dẫn file | Dòng | Vai trò & Mục đích cụ thể | Trạng thái trong `npm test` | Nhãn chứng cứ |
|---|---|---|---|---|
| `test/streamable-bridge.test.js` | 110 | Tạo HTTP server loopback, test bắt tay POST `/mcp` `initialize`, multiplex session và instruction. | Đang chạy trong `npm test` | [FACT] Active integration test |
| `test/oauth.test.js` | 86 | Test cấp token, tái sử dụng token, xác thực Bearer và render panel kèm OAuth token. | Đang chạy trong `npm test` | [FACT] Active unit test |
| `test/postman-mcp.test.js` | 56 | Test công cụ `aki__postman_status` và endpoint start/kill daemon với mock child process. | Đang chạy trong `npm test` | [FACT] Active unit test |
| `test/aki-pmcontrol-copy.test.js` | 113 | Test nạp file instruction, fallback resolution, và assert regex cấu trúc của `index.js`, `cdp-autoclicker.js`. | Đang chạy trong `npm test` | [FACT] Active regression test |
| `test/roots.test.js` | 40 | Test mở rộng dấu ngã `~`, kiểm tra containment, chặn escape path traversal. | **BỊ BỎ QUÊN KHỎI `npm test`!** | [FACT] Test hổng |
| `test/shell-mcp.test.js` | 46 | Test tokenize lệnh shell, bóc tách quote, chặn toán tử nguy hiểm (`|`, `$`). | **BỊ BỎ QUÊN KHỎI `npm test`!** | [FACT] Test hổng |
| `test/rule-context-mcp.test.js` | 29 | Test đăng ký tool metadata, format provenance và bắt lỗi của `akidevrule_context`. | **BỊ BỎ QUÊN KHỎI `npm test`!** | [FACT] Test hổng |
| `test/rule-context.test.js` | 73 | Test toàn diện đồ thị `@import`, phát hiện đệ quy lặp, vô hiệu cache và tính SHA256 receipt. | **BỊ BỎ QUÊN KHỎI `npm test`!** | [FACT] Test hổng |

---

### Phân hệ 6 & 7: Documentation, Plans & Repository Meta (36+ files)
- **Tài liệu cốt lõi**: `README.md` (611 dòng, hướng dẫn sử dụng), `CHANGELOG.md` (1,390 dòng, lịch sử phiên bản chuẩn Keep a Changelog), `CLAUDE.md` (51 dòng, ràng buộc cho AI agent), `LICENSE` (MIT), `docs/index.md` (305 dòng, mục lục tài liệu).
- **Kiến trúc & Tham chiếu**: `docs/arch/rule-context-delivery.md` (378 dòng, đặc tả rule context), `docs/feat/tools.md` (158 dòng, danh mục công cụ), `docs/ref/` (6 files: setup ChatGPT, Claude, security model, harness facts).
- **Kế hoạch phát triển**: 7 kế hoạch đang mở trong `docs/plan/` (`chrome-tampermonkey-autosetup.md`, `context-circle-newchat-signal.md`, `interactive-and-env-tools.md`, `manus-connect.md`, `postman-panel-auto-controls.md`, `rule-context-handshake.md`, `unify-datadir-drop-legacy.md`) và 1 kế hoạch bị đặt sai thư mục tại `dev/plan-bigidea-3-topics.md`.
- **Tài liệu đã đóng**: 30 file trong `docs/plan/done/` (>4,200 dòng markdown).
- **Cấu hình Repo & CI**: `package.json` (Node 22.14.0 ESM), `package-lock.json`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.akidevsync/notes.json`.

---

## 3. Kết quả phân tích sâu `/akithink` (6 vòng)

### Vòng 1: Đào sâu mục tiêu gốc (Goal Excavation)
- **Mục tiêu tối hậu của repo**: Cung cấp một cổng giao tiếp Model Context Protocol (MCP) an toàn, hiệu năng cao, chạy trực tiếp trên máy cục bộ của người dùng để kết nối với các AI trên đám mây (Claude.ai, ChatGPT, Grok, Gemini) và desktop client (Postman).
- **Nguyên nhân gốc rễ của sự cồng kềnh**: Không phải do dư thừa tính năng vô bổ, mà do cách tổ chức vật lý phẳng (`scripts/` chứa chung cả server core, UI backend, 7 MCP tool arms và helper), kết hợp với sự tồn tại của sub-project con CommonJS `aki-pmcontrol`.

### Vòng 2: Sự thật & Ràng buộc cứng (First-Principles & Hard Constraints)
- **[FACT]**: Toàn bộ hệ thống MCP server chỉ chạy trên **đúng 1 tiến trình Node.js duy nhất** (`start.js`).
- **[CONSTRAINT]**: Phiên Claude.ai re-initialize liên tục mỗi 10 giây. Cầu nối `streamable-bridge.js` bắt buộc phải duy trì 1 phiên `InMemoryTransport` nội bộ và cache phản hồi khởi tạo để không làm rớt kết nối.
- **[CONSTRAINT]**: Mã nguồn Postman CDP bắt buộc phải là CommonJS vì thư viện `chrome-remote-interface` và các file injection vào webview Postman phụ thuộc vào format này.
- **[ASSUMPTION sai lầm]**: Gom gộp các tool `*-mcp.js` vào một file nguyên khối sẽ làm repo gọn gàng hơn. Thực tế, điều này vi phạm nghiêm trọng Single Responsibility Principle (SRP) và làm tăng rủi ro hồi quy khi chỉnh sửa.

### Vòng 3: Phản biện đối xứng (Steelman vs Inversion)
- **Steelman (Bảo vệ cấu trúc hiện tại)**: Việc tách nhỏ mỗi tool thành 1 file độc lập giúp kiểm thử và bảo trì từng công cụ tách biệt hoàn toàn. An ninh shell được cô lập trong `shell-mcp.js`, thao tác file cô lập trong `filesystem-mcp.js`.
- **Inversion (Tấn công cấu trúc hiện tại)**: 25 file nằm phẳng trong `scripts/` tạo áp lực nhận thức quá lớn. Người phát triển mới mở repo không thể phân biệt đâu là entrypoint, đâu là UI, đâu là MCP tool. Thư mục `aki-pmcontrol` chứa các file clone duplicate không cần thiết.

### Vòng 4: Kiểm định Subtraction & Hàng rào Chesterton
- Toàn bộ các file trong `scripts/` đều có ít nhất một caller rõ ràng.
- Các file chưa commit (`rule-context*.js`, `cdp-probe.js`) là thành phần đang triển khai dở của kế hoạch `docs/plan/rule-context-handshake.md`, không phải rác hay mã chết.

### Vòng 5: Kỷ luật Điều phối (Conductor Discipline)
- Không đập đi xây lại; giải quyết sự lộn xộn bằng cách phân nhóm thư mục theo đúng miền logic (Domain-Driven Grouping) mà không tạo thêm các lớp bọc (wrapper) hay indirection thừa thãi.

### Vòng 6: Quyết định hội tụ (Decision Convergence)
1. Giữ nguyên ranh giới file của các tool MCP.
2. Gom nhóm vật lý `scripts/` thành các miền: `scripts/core/`, `scripts/tools/`, `scripts/ui/`, `scripts/postman/`.
3. Vá ngay 4 bài test bị bỏ sót trong `package.json`.
4. Xóa các tệp tin duplicate trong `aki-pmcontrol` và chuyển `dev/plan-bigidea-3-topics.md` về `docs/plan/`.

---

## 4. Bảng phân loại Subtraction Audit (5 mức độ)

Căn cứ quy định tại `METHOD-audit-subtraction.md`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MA TRẬN PHÂN LOẠI SUBTRACTION AUDIT                     │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ 1. DEAD (Chết, không gọi) │ • Không có file code nào chết hoàn toàn.         │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 2. REDUNDANT (Trùng lặp) │ • scripts/aki-pmcontrol/data/aki-postman-        │
│                          │   instruction.md (trùng 100% với postman.md).    │
│                          │ • scripts/aki-pmcontrol/scripts/update-check.js  │
│                          │   (sao chép 136 LOC từ scripts/update-check.js). │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 3. OVERSIZED (Quá khổ)   │ • scripts/aki-pmcontrol/scripts/                 │
│                          │   cdp-autoclicker.js (1,869 LOC, file injection  │
│                          │   nguyên khối lớn nhất repo).                    │
│                          │ • docs/plan/done/ (30 file kế hoạch cũ, >4,200   │
│                          │   dòng text lịch sử gây loãng tìm kiếm).         │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 4. UNJUSTIFIED (Sai chỗ) │ • dev/plan-bigidea-3-topics.md (kế hoạch nằm lạc │
│                          │   trong thư mục ad-hoc `dev/`).                  │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 5. LOAD-BEARING BUT UGLY │ • Proxy `prefixedServer` trong tools-server.js:  │
│   (Xấu nhưng có lý do    │   Bảo toàn tiền tố `aki__` cho AI prompt cũ.   │
│    sống còn, giữ lại)    │ • docs/plan/done/*: Được bảo vệ bởi RULE-docs    │
│                          │   (bản ghi lịch sử bất biến và link chéo).       │
│                          │ • chrome-remote-interface: Bị depcheck báo thừa  │
│                          │   nhưng thực tế daemon CDP bắt buộc phải dùng.   │
└──────────────────────────┴──────────────────────────────────────────────────┘
```
