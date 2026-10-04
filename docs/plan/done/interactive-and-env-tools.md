# Interactive Process Execution & Runtime Environment Tools

> status: dropped 2026-10-04, not started
>
> Decided: drop this plan · because long-running commands are already served by `aki__task_start` / `aki__task_manage` (background process, log tail, kill) and environment facts by one `aki__run_cmd` or `aki__git op=status`, so the 5 proposed tools would add surface (each paid on every turn by every client) without a measured flow that needs a stdin-interactive REPL · rejected building `get_env_info` alone (one tool to save 1–2 calls that nobody reported) · reopen if a real task repeatedly needs to keep REPL state across calls; then follow `docs/arch/provider-toolkit.md` Contract 3 (`aki__process` + `aki__process_write`), not 5 flat tools.

## Mục tiêu & Triết lý thiết kế (Học hỏi Claude Code & DeepSeek Harness)
Bổ sung khả năng chạy tiến trình tương tác dài hạn (Node.js/Python REPL, long-running processes) và công cụ tự động phát hiện thông tin môi trường (`get_env_info`), nâng cao hiệu suất làm việc của AI qua MCP mà không phá vỡ triết lý bảo mật (allowlist strictly checked, no arbitrary `/bin/sh`, bounded concurrency, output cap).

### Bài học từ Claude Code & DeepSeek Harness (YAGNI & Native First)
- **Claude Code**: Thiết kế công cụ theo hướng Unix primitive đơn giản, rõ ràng (`Bash` có timeout/cwd/cap, `View`, `Edit`, `Grep`, `Glob`). Không bọc quá nhiều layer trung gian. Môi trường được cung cấp súc tích, đủ để AI tự định hướng.
- **DeepSeek Harness** ([deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)): Công cụ native gọn nhẹ, trực tiếp gọi API OS (`spawn`, stdio piping), kiểm soát buffer output chặt chẽ (~1MB) tránh tràn bộ nhớ context, không kill tiến trình theo idle-timeout bừa bãi khi người dùng đang debug remote.
- **YAGNI (You Aren't Gonna Need It)**: Ưu tiên công cụ có giá trị sử dụng cao và tần suất dùng lớn trước (`get_env_info` và persistent REPL). Tránh ôm đồm tạo trình quản lý tiến trình phức tạp, tránh mở quyền write shell bừa bãi khi chưa có nhu cầu thực tế.

---

## 1. Phân loại công cụ & Ưu tiên triển khai

### Phase 1: Công cụ cốt lõi (High Utility — Triển khai trước)

| Công cụ | Mô tả & Tham số | Vai trò & Giá trị sử dụng |
|---|---|---|
| `get_env_info` | Read-only, không tham số. Trả về JSON: `{ platform, arch, nodeVersion, pythonVersion, cwd, git: { branch, commit } }` | AI định hướng tức thì về môi trường máy chủ/dự án trong 1 tool call duy nhất thay vì tốn 4-5 lượt gõ shell. |
| `start_process` | `command` (khớp chính xác allowlist: `python3 -i`, `node -i`, ...) | Khởi chạy tiến trình tương tác nền, lưu PID vào `Map<pid, ChildProcess>`. |
| `interact_process`| `pid` (number), `input` (string) | Ghi stdin vào tiến trình đang chạy và flush buffer. |
| `read_process_output` | `pid` (number) | Đọc stdout/stderr mới nhất từ buffer của tiến trình đó. |
| `kill_process` | `pid` (number) | Chủ động dừng tiến trình khi hoàn thành phiên làm việc. |

### Phase 2: Đánh giá sau (Deferred / YAGNI)
- **Write-shell execution**: Mở rộng allowlist ghi (`git commit`, `npm install`...) — đã có cơ chế allowlist trong `setting.json` xử lý, không vội tích hợp cứng vào tool.
- **Process multiplexer phức tạp**: Danh sách tiến trình cây, IPC channels nâng cao — chưa cần thiết cho mô hình 1 người dùng.

---

## 2. Ràng buộc bảo mật & Quản lý tài nguyên

1. **Khởi chạy Native (`spawn`), không qua shell wrapper**: Sử dụng `child_process.spawn(bin, args)` trực tiếp, không gọi `/bin/sh -c` để ngăn chặn shell injection.
2. **Whitelist nhị phân tách biệt**: Danh sách lệnh REPL được định nghĩa riêng biệt trong code/config, không lẫn lộn với allowlist lệnh shell thông thường.
3. **Giới hạn số lượng tiến trình đồng thời (Concurrency Cap)**: Tối đa 3 tiến trình sống cùng lúc (`Map.size <= 3`). Nếu vượt quá, từ chối mở thêm với thông báo rõ ràng.
4. **Buffer Output Cap**: Giới hạn bộ đệm output tối đa ~1MB cho mỗi tiến trình. Nếu vượt quá, cắt bớt và gắn ghi chú truncation để tránh phình bộ nhớ Node.js process.
5. **Vòng đời tiến trình (Lifecycle)**: Tiến trình tồn tại cho đến khi AI/User gọi `kill_process`, hoặc toàn bộ MCP server tắt. Không tự động kill theo idle-timeout để giữ state biến/hàm trong REPL.

---

## 3. Kiến trúc tích hợp (Hướng tới v2 Single-Process)

- **Chuẩn bị module `scripts/process-mcp.js`**: Viết theo pattern chuẩn `register(server)` để có thể mount thẳng vào `scripts/tools-server.js` (in-process `McpServer` duy nhất, đã hợp nhất ở Stage 2 — `docs/plan/done/2.0.0-improve.md` §7) mà không cần tạo thêm tiến trình trung gian.
- **Context Injection qua Tool Description**: Do một số client MCP không đọc trường `instructions` khi handshake, toàn bộ hướng dẫn sử dụng và định dạng đầu vào/đầu ra sẽ được mô tả súc tích ngay trong trường `description` của từng tool.

---

## 4. Checklist triển khai
- [ ] Xây dựng `scripts/process-mcp.js` với các tools: `get_env_info`, `start_process`, `interact_process`, `read_process_output`, `kill_process`
- [ ] Cài đặt cơ chế kiểm soát bộ đệm (1MB cap) và giới hạn tiến trình (max 3)
- [ ] Đăng ký module vào server runtime (`register(server)` interface)
- [ ] Viết test nội bộ: mở `python3 -i`, gửi biểu thức tính toán, đọc kết quả; kiểm tra chặn tiến trình thứ 4; kiểm tra `kill_process`
- [ ] Kiểm thử qua client thực tế (claude.ai / ChatGPT) xác nhận tools hiển thị đúng
- [ ] Cập nhật tài liệu `README.md` & `docs/feat/tools.md`

---

## Cross-references
- `docs/plan/done/2.0.0-improve.md` — kiến trúc single process v2.0.0
- `docs/feat/tools.md` — danh mục các công cụ hiện có trong hệ thống
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — tham chiếu thiết kế harness native, tinh gọn của DeepSeek
