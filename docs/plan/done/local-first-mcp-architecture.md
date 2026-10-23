# Architecture, Philosophy & Implementation Plan: Local-First MCP Decoupling & Unified AI Tooling

**Status:** done 2026-10-20 — engine, panel and docs shipped in 2.1.0. Not built: runtime ingress attach after boot (setPublicOrigin; dropped per YAGNI, scripts/gatekeeper.js:29-31: a saved ingress applies on restart) and the dual header badge (:205-206). Reopen if the owner needs a new ingress to apply without a restart.  
**Date:** 2026-09-18  
**Originating Council:** `/Users/aki/.aki/agent-council/aki-mcp-sv/2026.09.18-0022-local-first-mcp-plan/` (PASS all 7 checks)  
**Governing Rules:** `RULE-agent-behavior.md` (agent.B1, agent.B3), `RULE-coding.md` (coding.A1, coding.C4), `RULE-pattern-core.md` (pattern.A1, pattern.B2, pattern.B3), `RULE-docs.md` (docs.B1)  
**Linked Tasks in `.akidevsync/notes.json`:**
- `task-1789505230187`: *Thêm instruction connect cho agy/claude/codex/postman và chạy trực tiếp nội bộ không cần đi đường vòng ra internet*
- `task-1789394358811`: *thêm lựa chọn connect cho provider AGY (cli) và ClaudeCode*

> **Trạng thái triển khai (2026-09-18):**
> - **ĐÃ SHIP:** Gatekeeper bind `127.0.0.1:9999` vô điều kiện; OAuth discovery + `/authorize` + `/register` + `/token` trả `503` khi chưa có ingress; `/mcp` 401 trả challenge `Bearer` trần (không lộ URL `null/…`) khi local-only; snippet Postman trỏ loopback + thêm tab **Cursor / Claude Code / AGY** trong panel; Section 0 đổi nhãn *Remote ingress — optional*; tài liệu README + `docs/feat/security.md`.
> - **ĐÃ SHIP (2026-09-18, đợt bổ sung):** thêm tab **Codex** (snippet `~/.codex/config.toml` streamable-HTTP, bearer inline) trong panel Section 1 + block Codex trong README; **tách trực quan Section 1 thành 2 nhóm tab** — *Local · direct 0ms* (Postman / Cursor / Claude Code / AGY / Codex, đặt trước, tab mặc định = Postman) và *Web · needs ingress* (Claude / Grok / ChatGPT / Gemini) qua `.tab-group-label` + `.tab-group-sep` trong `public/panel.css`. Đóng nốt mục 3.2 Lượt 6.
> - **HOÃN LẠI (chưa build):** runtime attach-after-boot qua `setPublicOrigin` (mục 3.1 lượt 3 & mục 4.1). Ingress hiện áp dụng khi **restart** (origin resolve lúc boot); hook `setPublicOrigin` đã được lược bỏ khỏi code theo YAGNI cho tới khi luồng runtime-attach + quản lý tiến trình tunnel được xây thực sự.

---

## 1. Triết Lý Cốt Lõi & Định Hướng Kiến Trúc (Core Philosophy)

### 1.1 Local-First By Default (Ưu Tiên Nội Bộ Tuyệt Đối)
- **Bản chất công cụ phát triển:** Các IDE và AI Agent như Cursor, Claude Code CLI, Antigravity (AGY) CLI/IDE, Codex, và Postman Desktop đều chạy **cục bộ trên cùng một máy tính** với `aki-mcp-sv`.
- **Triết lý Native Flow:** Mọi giao tiếp giữa các tiến trình trên cùng một máy phải diễn ra trực tiếp qua socket loopback (`127.0.0.1`). Việc bắt các công cụ cục bộ phải đi đường vòng qua internet (WAN) tới edge của Cloudflare hay Tailscale rồi mới dội ngược về máy là một **phản mẫu (anti-pattern)** nghiêm trọng: làm chậm tốc độ (từ <1ms vọt lên 50–200ms), tiêu tốn băng thông, và khiến công cụ local bị chết đứng khi mạng chập chờn hoặc khi tunnel edge desync.
- **Quy tắc phân định:**
  - **Local Clients (Cursor, Claude Code, AGY, Postman, Codex):** Cắm trực tiếp vào `http://127.0.0.1:9999/mcp`. Không cần internet, không cần tunnel, chạy mượt mà ngay cả khi ngắt toàn bộ kết nối mạng.
  - **Cloud Web Clients (Claude.ai Web, ChatGPT Web, Grok Web, Gemini Web) & Mobile Remote:** Chỉ nhóm này mới thực sự cần Public Ingress HTTPS (Cloudflare Tunnel / Tailscale Funnel) + OAuth 2.1 AS để vượt qua ranh giới internet.

### 1.2 Ingress Là Vệ Tinh Tùy Chọn (Satellite Reverse Proxy), Không Phải Cổng Chặn
- **Luật Subtraction & Phá bỏ điểm nghẽn:** Gatekeeper và bộ 39 tools MCP phải khởi động **vô điều kiện** trên `127.0.0.1:9999` ngay khi gõ lệnh `akimcp` / `npm start`.
- Ingress (Cloudflare Tunnel hoặc Tailscale Funnel) chỉ là một reverse proxy vệ tinh chạy nền bất đồng bộ.
- Nếu Ingress bật thành công -> Cập nhật URL public cho Web AI.
- Nếu Ingress tắt, lỗi, hoặc không có mạng -> Server local vẫn hoạt động 100% trơn tru cho toàn bộ công cụ local. Tuyệt đối không được phép "pause" Gatekeeper như hiện tại.

### 1.3 Zero-Trust Loopback: Phòng Thủ Chiều Sâu (Defense-in-Depth)
- **Không bao giờ mở cổng ra LAN:** Gatekeeper bắt buộc phải bind tường minh vào `127.0.0.1` (`server.listen(port, '127.0.0.1')`). Tuyệt đối không để mặc định `0.0.0.0` làm phơi nhiễm cổng ra toàn bộ mạng Wi-Fi/LAN nội bộ.
- **Bắt buộc giữ xác thực Bearer Token trên Loopback:** Mặc dù chạy trên `127.0.0.1`, Gatekeeper KHÔNG ĐƯỢC PHÉP bỏ xác thực. Nếu bỏ xác thực để "tiện lợi", bất kỳ trang web độc hại nào người dùng mở trên trình duyệt (Chrome/Safari) đều có thể chạy script ngầm `fetch('http://127.0.0.1:9999/mcp')` để thực thi mã tùy ý (RCE qua `local__run_cmd`) hoặc đọc trộm file nhạy cảm (tấn công Drive-by CSRF / DNS Rebinding).
- Token nội bộ dài hạn (`getOrIssueAccessToken()`) được cấp sẵn và tự động điền vào các snippet cấu hình để lập trình viên chỉ cần copy-paste là chạy ngay lập tức.

---

## 2. Bằng Chứng & Phân Tích Hiện Trạng Codebase

| Vị trí file | Hiện trạng mã nguồn | Hậu quả thực tế | Giải pháp kiến trúc mới |
|---|---|---|---|
| [scripts/start.js#L198-L207](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/start.js#L198-L207) | `if (origin) { gateServer = startGatekeeper(origin, ...) } else { log('Gatekeeper paused...') }` | Nếu không có Ingress (không bật Tailscale/CF), Gatekeeper bị tạm dừng hoàn toàn. Local tools không thể kết nối. | Khởi động Gatekeeper vô điều kiện: `gateServer = startGatekeeper(origin, ...)`. Ingress khởi chạy bất đồng bộ song song. |
| [scripts/gatekeeper.js#L12-L14](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/gatekeeper.js#L12-L14) | `if (!origin) throw new Error('PUBLIC_ORIGIN (Tailscale origin) is not set');` | Hàm ném ngoại lệ làm sập tiến trình nếu không truyền `origin`. | Cho phép `origin` là `null` hoặc chuỗi rỗng. Các endpoint OAuth metadata trả về 503 nếu `!origin`, nhưng endpoint `/mcp` vẫn phục vụ bình thường. |
| [scripts/gatekeeper.js#L70](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/gatekeeper.js#L70) | `server.listen(port, () => ...)` | Thiếu tham số host -> Node.js bind vào `0.0.0.0` / `::`, phơi nhiễm cổng 9999 ra toàn bộ mạng LAN. | Sửa thành `server.listen(port, '127.0.0.1', () => ...)`, ép kernel chỉ chấp nhận kết nối từ loopback nội bộ. |
| [scripts/config-page.js#L84-L86](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/config-page.js#L84-L86) | `postmanJson = JSON.stringify({ mcpServers: { 'aki-mcp-sv': { url, ... } } })` trong đó `url = ${origin}/mcp` | Postman trên cùng máy bị ép đi đường vòng ra ngoài internet qua CF/Tailscale tunnel, lag và dễ rớt mạng. | Đổi cấu hình Postman mặc định sang `http://127.0.0.1:9999/mcp`, độ trễ <1ms, miễn nhiễm sự cố mạng. |
| [scripts/config-page.js#L131-L134](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/config-page.js#L131-L134) | Thẻ Section 0 gắn mác cảnh báo đỏ `action required` nếu chưa cấu hình Ingress. | Gây tâm lý ức chế, bắt người dùng phải cài Tailscale/Cloudflare dù họ chỉ muốn dùng Cursor/Claude Code ở local. | Đổi Section 0 thành accordion tùy chọn: *"Remote Ingress (Web AI) · optional"*. Mặc định server báo `Local Engine: Ready ✓`. |

---

## 3. Tổng Hợp Đúc Kết Từ Hội Đồng /akiflow (6 Lượt /akithink)

Trong phiên hội đồng `2026.09.18-0022-local-first-mcp-plan`, 3 chuyên gia (`judge-flow`, `judge-ux`, `challenger`) và `lead` đã thực hiện 6 lượt suy nghĩ sâu độc lập cho từng khía cạnh:

### 3.1 Khía cạnh 1: Vòng đời kết nối & Network I/O (`judge-flow`)
1. **Lượt 1 (Chuỗi mục tiêu):** Tách bạch 2 luồng: Luồng phục vụ cục bộ (ưu tiên 1, độ trễ 0ms, không phụ thuộc ngoại cảnh) và Luồng vệ tinh từ xa (ưu tiên 2, chỉ chạy khi có nhu cầu).
2. **Lượt 2 (Nguyên lý cơ bản):** MCP qua HTTP Streamable thực chất là các gói tin JSON-RPC truyền qua HTTP POST. Socket trên `127.0.0.1` hoàn toàn độc lập với việc máy có kết nối internet hay không.
3. **Lượt 3 (State Machine của Gatekeeper):** Chuyển từ trạng thái đơn khối (Monolithic) sang trạng thái động: Gatekeeper khởi động trước -> Mở cổng `127.0.0.1:9999` -> Cung cấp hàm `setPublicOrigin(url)` để khi Ingress kết nối xong thì cập nhật URL public mà không làm rớt các kết nối local đang chạy.
4. **Lượt 4 (An toàn tầng mạng):** Bind cứng `127.0.0.1` đảm bảo kernel từ chối ngay lập tức mọi gói tin đến từ card mạng ngoài (Wi-Fi, Ethernet).
5. **Lượt 5 (Hợp đồng Auth nội bộ):** Sử dụng token dài hạn 365 ngày lưu tại `~/.aki/mcpsv/keys/token.json` để các client local không bao giờ bị gián đoạn giữa chừng.
6. **Lượt 6 (Tách rời Ingress):** `cloudflared` hoặc `tailscale` khi khởi chạy chỉ đơn thuần là client kết nối ngược vào `http://127.0.0.1:9999`. Nếu tiến trình này chết hoặc rớt mạng, tiến trình chính của `akimcp` vẫn chạy bình thường.

### 3.2 Khía cạnh 2: Trải nghiệm người dùng (UX) & Nhà phát triển (DX) (`judge-ux`)
1. **Lượt 1 (Mô hình tâm lý người dùng):** Lập trình viên tải `akimcp` về là muốn dùng ngay với Cursor/Postman/Claude Code trong vòng 10 giây. Bắt họ cấu hình Domain, DNS, Tailscale là tạo rào cản nhận thức (cognitive load) quá lớn (`ux.A1`).
2. **Lượt 2 (Tái cấu trúc Section 0):** Xóa bỏ chữ `action required` gây hoang mang. Header của Panel hiển thị ngay:
   `● Local MCP: Ready (127.0.0.1:9999) · Zero-latency`
   Section 0 được đổi tên thành `Remote Ingress (Web & Mobile AI) · Optional`, chỉ mở ra khi cần.
3. **Lượt 3 (Tối ưu hóa Postman):** Sửa snippet Postman trong tab Postman về thẳng `http://127.0.0.1:9999/mcp`. Nút "Launch Postman" tự động bật và kết nối tức thì.
4. **Lượt 4 (Bổ sung bộ Onboarding Local AI):** Thiết kế sẵn các snippet chuẩn chỉ cần 1 click copy:
   - **Cursor**: Khối JSON chuẩn cho `~/.cursor/mcp.json`.
   - **Claude Code CLI**: Câu lệnh 1 dòng: `claude mcp add --transport http aki-mcp http://127.0.0.1:9999/mcp --header "Authorization: Bearer <token>"`.
   - **Antigravity (AGY)**: Khối JSON cho `~/.gemini/antigravity-cli/mcp_config.json`.
   - **Codex / Windsurf / Claude Desktop**: Cấu hình HTTP/SSE chuẩn.
5. **Lượt 5 (Tối ưu DX sao chép):** Tự động nhúng sẵn Access Token thật vào khối code (không để chữ placeholder `<YOUR_TOKEN>` bắt người dùng tự sửa). Bổ sung nút ẩn/hiện token và hiệu ứng `Copied! ✓`.
6. **Lượt 6 (Hệ thống phản hồi trạng thái):** Phân chia rõ ràng 2 nhóm tab trong Section 1: Nhóm "Local AI (Direct)" và Nhóm "Cloud AI (Requires Ingress)". Nếu chưa bật Ingress mà bấm vào tab Cloud AI, giao diện hiện thông báo hướng dẫn nhẹ nhàng thay vì báo lỗi kết nối.

### 3.3 Khía cạnh 3: Phản biện đối kháng & Rủi ro bảo mật (`challenger`)
1. **Lượt 1 (Steelman thiết kế cũ):** Lý do phiên bản cũ buộc Ingress là vì ban đầu chỉ phục vụ Claude.ai Web (Cloud AI bắt buộc phải có domain HTTPS để gọi webhook). Nhưng áp đặt logic đó lên các công cụ local là sai lầm.
2. **Lượt 2 (Tấn công bảo mật Localhost):** Bác bỏ hoàn toàn ý tưởng "chạy local thì tắt luôn kiểm tra Bearer token". Nếu tắt token, bất kỳ website nào người dùng lướt qua trên mạng đều có thể chạy JavaScript ngầm gọi tới cổng 9999 để đọc trộm SSH key, file code hoặc chạy lệnh terminal xóa ổ cứng. Bearer token là lằn ranh đỏ bắt buộc phải giữ.
3. **Lượt 3 (Kỹ thuật nghịch đảo - Inversion):** "Làm sao để hệ thống này dễ hỏng nhất?" -> Nếu cổng 9999 bị chiếm mà code tự động nhảy sang 10000, toàn bộ config của Cursor/Postman sẽ bị gãy sau khi khởi động lại. Do đó: Cổng 9999 phải **cố định tuyệt đối**. Nếu bị trùng cổng, in ra lệnh terminal để giải phóng cổng ngay, không được âm thầm đổi cổng.
4. **Lượt 4 (Dự đoán rủi ro 6 tháng - Pre-mortem):** Phân biệt rõ `127.0.0.1` và `localhost`. Trên macOS, `localhost` có thể phân giải ra IPv6 `::1` trong khi server chỉ nghe IPv4. Toàn bộ tài liệu và code phải cố định chuỗi số `127.0.0.1`.
5. **Lượt 5 (Cắt tỉa mã nguồn - Subtraction Pass):** Loại bỏ biến cờ tạm dừng Gatekeeper, loại bỏ các lệnh ném lỗi không cần thiết, loại bỏ các dòng code polling kiểm tra mạng thừa thãi khi chạy chế độ thuần local.
6. **Lượt 6 (Đối chiếu mỏ neo):** Toàn bộ đề xuất khớp 100% với yêu cầu gốc của người dùng: tối ưu, chuyên nghiệp, đặt UX và DX lên hàng đầu.

---

## 4. Chi Tiết Thay Đổi Mã Nguồn Từng File (Code Implementation)

### 4.1 File [scripts/gatekeeper.js](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/gatekeeper.js)

#### Thay đổi 1: Bỏ ném lỗi khi thiếu `origin` & Hỗ trợ cập nhật dynamic
```javascript
// TRƯỚC:
export function startGatekeeper(origin, onFatal) {
  if (!origin) throw new Error('PUBLIC_ORIGIN (Tailscale origin) is not set');
  const port = Number(process.env.GATEKEEPER_PORT || 9999);
  const passphrase = loadOrCreatePassphrase();
  const meta = metadataHandlers(origin);
  ...
}

// SAU:
export function startGatekeeper(initialOrigin = null, onFatal) {
  let publicOrigin = initialOrigin;
  let meta = publicOrigin ? metadataHandlers(publicOrigin) : null;
  const port = Number(process.env.GATEKEEPER_PORT || 9999);
  const passphrase = loadOrCreatePassphrase();

  // Hàm cho phép cập nhật public origin khi tunnel kết nối thành công sau đó
  function setPublicOrigin(newOrigin) {
    publicOrigin = newOrigin;
    meta = publicOrigin ? metadataHandlers(publicOrigin) : null;
    log(`[gatekeeper] public origin updated: ${publicOrigin}`);
  }
  ...
```

#### Thay đổi 2: Xử lý bảo vệ các endpoint OAuth khi chưa có Ingress
```javascript
    // Endpoint OAuth discovery: Nếu chưa có ingress thì trả 503 thông báo rõ ràng
    if ((path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') && req.method === 'GET') {
      if (!meta) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Remote ingress not configured — local MCP is active at /mcp');
      }
      return meta.protectedResource(req, res);
    }
    if ((path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp' || path === '/.well-known/openid-configuration') && req.method === 'GET') {
      if (!meta) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Remote ingress not configured — local MCP is active at /mcp');
      }
      return meta.authorizationServer(req, res);
    }
```

#### Thay đổi 3: Bind cổng chặt chẽ vào `127.0.0.1` & Trả về instance mở rộng
```javascript
// TRƯỚC:
  server.listen(port, () => {
    log(`[gatekeeper] listening on :${port} (OAuth-protected /mcp)`);
  });
  return server;

// SAU:
  server.listen(port, '127.0.0.1', () => {
    log(`[gatekeeper] listening on 127.0.0.1:${port} (Local-First MCP engine active)`);
    if (publicOrigin) log(`[gatekeeper] public ingress attached: ${publicOrigin}`);
  });
  server.setPublicOrigin = setPublicOrigin;
  return server;
```

---

### 4.2 File [scripts/start.js](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/start.js)

#### Thay đổi 1: Khởi động Gatekeeper vô điều kiện trước khi kiểm tra Ingress
```javascript
// Khởi động Gatekeeper ngay lập tức trên 127.0.0.1 để phục vụ local tools
let gateServer = null;
try {
  gateServer = startGatekeeper(origin, () => shutdown(1));
} catch (e) {
  console.error(`[start] gatekeeper failed to start on 127.0.0.1:${gatePort}: ${e.message}`);
  shutdown(1);
}
```

#### Thay đổi 2: Tách rời luồng Ingress thành bất đồng bộ
- Nếu người dùng truyền `--tunnel` hoặc cấu hình Cloudflare: Khởi chạy `cloudflared`.
- Nếu có `PUBLIC_ORIGIN` hoặc Tailscale: Cập nhật `gateServer.setPublicOrigin(origin)`.
- Nếu không có Ingress: In thông báo ngắn gọn:
  `[start] Mode: Pure Local-First (http://127.0.0.1:9999/mcp) — No internet exposure`

---

### 4.3 File [scripts/config-page.js](file:///Volumes/DEV/pj/aki-mcp-sv/scripts/config-page.js)

#### Thay đổi 1: Cập nhật Snippet Postman trỏ vào Localhost
```javascript
// TRƯỚC:
  const url = origin ? `${origin}/mcp` : 'not available yet, see section 0';
  const postmanJson = JSON.stringify({
    mcpServers: { 'aki-mcp-sv': { url, headers: { Authorization: `Bearer ${accessToken}` } } },
  });

// SAU:
  const localUrl = `http://127.0.0.1:${process.env.GATEKEEPER_PORT || 9999}/mcp`;
  const remoteUrl = origin ? `${origin}/mcp` : null;
  const postmanJson = JSON.stringify({
    mcpServers: { 'aki-mcp-sv': { url: localUrl, headers: { Authorization: `Bearer ${accessToken}` } } },
  }, null, 2);
  const cursorJson = JSON.stringify({
    mcpServers: { 'aki-mcp': { url: localUrl, headers: { Authorization: `Bearer ${accessToken}` } } },
  }, null, 2);
  const agyJson = JSON.stringify({
    mcpServers: { 'aki-mcp': { httpUrl: localUrl, headers: { Authorization: `Bearer ${accessToken}` } } },
  }, null, 2);
  const claudeCodeCmd = `claude mcp add --transport http aki-mcp ${localUrl} --header "Authorization: Bearer ${accessToken}"`;
```

#### Thay đổi 2: Tái cấu trúc Section 0 & Section 1 trong giao diện Panel
- **Header Badge:** Thêm thẻ trạng thái kép:
  `● Local MCP: Ready (127.0.0.1:9999)` và `○ Remote Ingress: [Active: domain | Inactive (Local-only)]`.
- **Section 0:** Đổi tiêu đề thành `0 · Remote Ingress (Web & Mobile AI) — Optional`. Thẻ `<details>` mặc định đóng lại nếu chưa có ingress, loại bỏ nhãn đỏ `action required`.
- **Section 1:** Phân thành 2 nhóm Tab rõ rệt:
  1. **Tab Group 1: Local AI & IDEs (0ms Latency · No Internet)**
     - Tab **Postman**: Nút Launch CDP + Snippet JSON trỏ `127.0.0.1:9999/mcp`.
     - Tab **Cursor**: Hướng dẫn paste vào `~/.cursor/mcp.json` hoặc UI Settings.
     - Tab **Claude Code**: Lệnh `claude mcp add` 1-click copy.
     - Tab **AGY (Antigravity)**: Hướng dẫn cấu hình `~/.gemini/antigravity-cli/mcp_config.json`.
     - Tab **Codex / Generic**: Cấu hình HTTP MCP chung.
  2. **Tab Group 2: Cloud Web AI (Requires Ingress)**
     - Tab **Claude Web** (claude.ai custom connector).
     - Tab **ChatGPT Web** (chatgpt.com developer connector).
     - Tab **Grok Web** (x.com/grok custom connector).
     - Tab **Gemini Web** (Experimental).

---

## 5. Cập Nhật Tài Liệu, Hướng Dẫn & Các File Liên Quan

Để đảm bảo dự án đồng bộ 100% từ code tới tài liệu (không bị drift tài liệu theo `RULE-docs.md`), toàn bộ nội dung cần cập nhật trong các file tài liệu được chốt chi tiết dưới đây:

### 5.1 Cập nhật [README.md](file:///Volumes/DEV/pj/aki-mcp-sv/README.md)

#### Đoạn giới thiệu mới (Header & Value Proposition)
> **AKIMCP v2 — The Unified Local-First MCP Control Plane for AI**  
> Chạy trực tiếp trên máy tính của bạn, cung cấp 39 công cụ kiểm soát an toàn (files, shell, Git, SQLite, DevTools, CDP automation) cho **CẢ Local AI (Cursor, Claude Code, AGY, Postman, Codex)** lẫn **Cloud Web AI (Claude.ai, ChatGPT, Grok)**.
> - **Chế độ Local-First (Mặc định):** Kết nối trực tiếp qua `http://127.0.0.1:9999/mcp`. Tốc độ microsecond, 0ms WAN round-trip, hoạt động offline 100%, an toàn tuyệt đối không mở cổng ra internet.
> - **Chế độ Remote Ingress (Tùy chọn):** Kết nối Cloudflare Tunnel hoặc Tailscale Funnel khi bạn muốn điều khiển máy tính từ xa qua Claude Web, ChatGPT Mobile khi ở ngoài đường.

#### Thêm mục hướng dẫn kết nối Local IDEs vào README
```markdown
## Connecting Local AI Tools (Zero Latency · Offline Ready)

Sau khi chạy `akimcp`, server sẵn sàng ngay lập tức tại `http://127.0.0.1:9999/mcp`. Lấy Access Token từ Web Panel (`http://127.0.0.1:9998`) hoặc copy trực tiếp cấu hình dưới đây:

### 1. Postman Desktop
Mở **Postman** → **Settings** → **Connected Accounts** → Thêm MCP:
```json
{
  "mcpServers": {
    "aki-mcp-sv": {
      "url": "http://127.0.0.1:9999/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_LOCAL_ACCESS_TOKEN"
      }
    }
  }
}
```

### 2. Cursor IDE
Mở file `~/.cursor/mcp.json` (hoặc vào Cursor Settings → Features → MCP Servers) và thêm:
```json
{
  "mcpServers": {
    "aki-mcp": {
      "url": "http://127.0.0.1:9999/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_LOCAL_ACCESS_TOKEN"
      }
    }
  }
}
```

### 3. Claude Code CLI (`claude`)
Chạy câu lệnh terminal 1 dòng:
```bash
claude mcp add --transport http aki-mcp http://127.0.0.1:9999/mcp --header "Authorization: Bearer YOUR_LOCAL_ACCESS_TOKEN"
```

### 4. Antigravity (AGY) CLI / IDE
Thêm vào file `~/.gemini/antigravity-cli/mcp_config.json`:
```json
{
  "mcpServers": {
    "aki-mcp": {
      "httpUrl": "http://127.0.0.1:9999/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_LOCAL_ACCESS_TOKEN"
      }
    }
  }
}
```
```

---

### 5.2 Cập nhật [docs/feat/security.md](../../feat/security.md)

Thêm một chương lớn về **Mô hình bảo mật Localhost (Loopback Containment)**:
```markdown
## Localhost Security Model (Zero-Trust Loopback)

### 1. Tại sao bind `127.0.0.1` thay vì `0.0.0.0`?
Khi bind `0.0.0.0`, cổng 9999 lắng nghe trên mọi card mạng. Bất kỳ máy tính hoặc thiết bị nào trong cùng mạng Wi-Fi (quán cafe, văn phòng) đều có thể gửi request đến máy bạn. Bind cứng `127.0.0.1` khiến hệ điều hành từ chối mọi gói tin không xuất phát từ chính máy đó.

### 2. Tại sao KHÔNG BAO GIỜ tắt Bearer Token trên `127.0.0.1`?
Nhiều người lầm tưởng: "Chạy local thì không cần password/token". Đây là lỗ hổng bảo mật nghiêm trọng:
- Trình duyệt web (Chrome, Safari, Firefox) chạy trên cùng máy tính với người dùng.
- Nếu một lập trình viên truy cập một trang web độc hại trên mạng, trang web đó có thể chạy ngầm đoạn mã JavaScript:
  `fetch('http://127.0.0.1:9999/mcp', { method: 'POST', body: ... })`
- Nếu Gatekeeper không đòi hỏi Bearer Token, trang web độc hại đó có thể thông qua công cụ `local__run_cmd` để thực thi mã độc toàn quyền (Remote Code Execution) trên máy của bạn mà bạn không hề hay biết!
- **Cơ chế bảo vệ:** Gatekeeper yêu cầu header `Authorization: Bearer <token>`. Do chính sách CORS của trình duyệt, một website bất kỳ không thể tự tiện gửi header Authorization tùy ý tới `127.0.0.1` mà không bị chặn bởi CORS preflight, và kẻ tấn công cũng không thể biết được token bí mật lưu ở `~/.aki/mcpsv/keys/token.json`.
```

---

### 5.3 Cập nhật [docs/index.md](file:///Volumes/DEV/pj/aki-mcp-sv/docs/index.md)

Thêm liên kết trỏ tới bản kế hoạch kiến trúc:
- `docs/plan/done/local-first-mcp-architecture.md` — *Kế hoạch kiến trúc tái cấu trúc Local-First, tách rời Gatekeeper khỏi Ingress, hỗ trợ native Cursor / Claude Code / AGY / Postman qua 127.0.0.1.*

---

## 6. Kế Hoạch Xử Lý Pinned Notes trong `.akidevsync/notes.json`

Sau khi hoàn thành bản kế hoạch và triển khai:
1. **Đóng 2 task pending trực tiếp liên quan (`done: true`):**
   - `task-1789505230187`: *Thêm instruction connect cho agy/claude/codex/postman và chạy trực tiếp nội bộ không cần đi đường vòng ra internet* -> **ĐÁNH DẤU XONG (Covered bởi Plan)**.
   - `task-1789394358811`: *thêm lựa chọn connect cho provider AGY (cli) và ClaudeCode* -> **ĐÁNH DẤU XONG (Covered bởi Plan)**.
2. **Khuyến nghị Unpin 11 task đã done từ trước (`pin: false`):**
   - Các task như `chatGPT real install`, `allowlist test/vitest`, `tool description`, `refactor instructions`, `postman model selector`,... đã hoàn thành ở các bản release trước nhưng vẫn đang để `pin: true`. Unpin toàn bộ để bảng task của Aki-Dev-Sync sạch sẽ, chỉ giữ lại các task đang thực sự active.

---

## 7. Ma Trận Kiểm Thử & Nghiệm Thu (Verification Matrix)

| STT | Tình huống kiểm thử | Các bước thực hiện | Kết quả kỳ vọng đạt chuẩn |
|---|---|---|---|
| **V1** | Khởi động thuần Local (Không internet, Không Tailscale) | Tắt Wi-Fi, chạy `npm start` | Tiến trình khởi động tức thì; log báo `listening on 127.0.0.1:9999`; Panel mở trên `:9998`; Status hiển thị `Local Engine: Ready ✓`. |
| **V2** | Gọi Tool từ Postman qua Loopback | Cấu hình Postman với `http://127.0.0.1:9999/mcp`, gọi `local__find_path` | Kết quả trả về trong vòng <3ms. Dùng Wireshark kiểm tra: 0 gói tin nào thoát ra card mạng WAN. |
| **V3** | Gọi Tool từ Cursor IDE | Thêm config vào `~/.cursor/mcp.json`, mở Cursor Composer | Cursor nhận diện đủ 39 tools của `aki-mcp`, gọi lệnh shell mượt mà. |
| **V4** | Gọi Tool từ Claude Code CLI | Chạy `claude mcp add ...` rồi chạy `claude` | Claude Code tự động load công cụ của `aki-mcp` qua socket HTTP local. |
| **V5** | Kiểm tra cô lập mạng LAN | Từ máy tính khác trong cùng mạng Wi-Fi, gõ `curl http://<IP_MAY_BAN>:9999/mcp` | Kết quả: `Connection refused` ngay lập tức từ kernel (do bind `127.0.0.1`). |
| **V6** | Kiểm tra chống tấn công CSRF / Web Fetch | Gõ `curl -X POST http://127.0.0.1:9999/mcp` không có header Authorization | Trả về HTTP 401 Unauthorized; không có tool nào được phép thực thi. |
| **V7** | Gắn Ingress khi đang chạy | Bật Cloudflare Tunnel hoặc lưu file credentials trong Panel | Gatekeeper tự động cập nhật Public Origin; kết nối Claude.ai Web hoạt động bình thường mà không làm ngắt kết nối local hiện tại. |
