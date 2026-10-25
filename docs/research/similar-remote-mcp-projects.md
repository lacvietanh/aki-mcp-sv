# So sánh aki-mcp-sv với các remote MCP server / pattern tương tự

Status: amended 2026-10-25

Nguồn: web search 08/08/2026 (xem link cuối mỗi mục) + đọc trực tiếp README/CHANGELOG của aki-mcp-sv. Dùng file này làm nguồn tái sử dụng cho mọi bài viết (news, knowledge, akidev, trang `/pj/`) — không copy nguyên văn, diễn giải lại theo văn cảnh từng bài.

## Bảng tổng hợp

| Dự án | Cơ chế expose ra internet | Xác thực | Mô hình shell | Khác biệt cốt lõi với aki-mcp-sv |
|---|---|---|---|---|
| **aki-mcp-sv** | Tailscale Funnel (tự host trên máy của bạn) | OAuth 2.1 (Claude: client ID/secret dán tay; ChatGPT: DCR tự đăng ký) | Whitelist theo lệnh + subcommand, mặc định read-only | — |
| **Desktop Commander** (open source, wonderwhy-er) | Không có — chạy stdio cục bộ, spawn làm subprocess bởi Claude Desktop/Cursor/Windsurf | Không có (tin cậy tiến trình local) | Blocklist (`blockedCommands`), mặc định *cho phép* | Không thiết kế để lộ ra internet; guide chính chủ nói thẳng "never expose Desktop Commander as a remote MCP server" |
| **Desktop Commander Remote** (desktopcommander.app, sản phẩm SaaS riêng của cùng nhóm) | Dịch vụ cloud-hosted của họ, không phải tự host | OAuth qua nền tảng của họ | Kế thừa blocklist gốc, chạy trên hạ tầng của desktopcommander.app | Bạn không tự kiểm soát hạ tầng; máy chủ chạy shell không phải máy của bạn |
| **mcp-remote** (geelen, npm) | Không tự expose gì — là bridge phía **client**, chuyển tiếp stdio↔HTTP/SSE tới một remote MCP server có sẵn ở nơi khác | OAuth 2.1 + PKCE + Dynamic Client Registration (phía client) | Không cấp shell — chỉ là ống dẫn, bản thân không có filesystem/shell tool | Không phải server, không giải quyết vấn đề "làm sao mở máy cá nhân ra internet" |
| **@modelcontextprotocol/server-filesystem** (tham chiếu chính thức của Anthropic) | Không có — chạy local qua stdio hoặc Docker, `openWorldHint: false` (không bao giờ chạm mạng) | Không có | Không có shell tool nào, chỉ thao tác file trong các thư mục được liệt kê lúc khởi động (hoặc qua MCP Roots) | Chỉ filesystem, không shell, không remote; từng có báo cáo lỗ hổng path traversal khi bị prompt injection (issue #3752) |
| **ngrok + một MCP server bất kỳ** (pattern chung, không phải sản phẩm cụ thể) | ngrok tunnel | Tuỳ người dựng: có thể không có auth gì cả nếu không tự thêm | Tuỳ MCP server phía sau, không có gì mặc định | Không tích hợp OAuth/whitelist sẵn; an toàn hay không phụ thuộc hoàn toàn vào việc người dùng tự cấu hình đúng |
| **Composio / Smithery-hosted / các MCP SaaS-hosted khác** | Cloud-hosted bởi nhà cung cấp | API key hoặc OAuth quản lý tập trung qua nền tảng SaaS | Thường không có shell — làm trung gian gọi API bên thứ 3 (GitHub, Slack...) | Không truy cập filesystem/shell của máy cá nhân bạn; đây là lớp tích hợp API, khác phạm vi với aki-mcp-sv |

## Bối cảnh rủi ro chung của remote MCP

mcp.directory (bài hướng dẫn Desktop Commander, cập nhật 11/05/2026) dẫn lại một khảo sát về **200.000 MCP server bị lộ công khai ngoài ý muốn** làm ví dụ cảnh báo, và nói thẳng: một MCP server có shell + filesystem không bao giờ nên đứng sau một URL public mà không có lớp bảo vệ. Đây chính là lý do OAuth 2.1 + whitelist + `gatekeeper.js` làm cổng public duy nhất là phần cốt lõi của aki-mcp-sv, không phải chi tiết phụ.

## Ghi chú diễn giải khi đưa vào bài

- **Với bài tin tức**: chỉ cần 1-2 câu — "khác Desktop Commander (chạy local, blocklist), khác server filesystem chính thức của Anthropic (không có shell, không remote)".
- **Với bài kiến thức**: dùng cả bảng, có thể rút gọn cột, nhấn mạnh 3 nhóm: (1) MCP local không remote (Desktop Commander, server-filesystem chính thức), (2) bridge/proxy không phải server (mcp-remote, ngrok), (3) SaaS cloud-hosted không chạm máy cá nhân (Composio, Smithery). aki-mcp-sv là nhóm thứ 4: tự host, tự kiểm soát hạ tầng, nhưng vẫn remote được.
- **Với bài akidev**: dùng góc nhìn kỹ sư — nêu rõ mcp-remote KHÔNG giải quyết cùng bài toán (nó là client bridge, không phải server), tránh gây hiểu lầm là sản phẩm cạnh tranh.
- Không suy diễn số liệu người dùng/độ phổ biến của bất kỳ dự án nào nếu không có nguồn xác nhận.

## Nguồn

- Desktop Commander: github.com/wonderwhy-er/DesktopCommanderMCP, desktopcommander.app/mcp/, mcp.directory/blog/desktop-commander-mcp-complete-guide-2026 (11/05/2026)
- mcp-remote: github.com/geelen/mcp-remote, npmjs.com/package/mcp-remote, deepwiki.com/geelen/mcp-remote
- @modelcontextprotocol/server-filesystem: github.com/modelcontextprotocol/servers/tree/main/src/filesystem, github.com/modelcontextprotocol/servers/issues/3752

## Amendments

- 2026-10-25 · § Bảng tổng hợp, dòng **aki-mcp-sv**: cột "Xác thực" không còn đúng. Mọi connector web (Claude, ChatGPT, Grok, Gemini, Notion, ClickUp) tự đăng ký qua DCR (RFC 7591), người dùng chỉ dán URL + passphrase; Client ID/Secret cấp sẵn chỉ còn cho client nào muốn một client tĩnh, còn Buda dùng Bearer token (`CLAUDE.md` § Two client paths, one OAuth server). Cột "Cơ chế expose" cũng thiếu: ngoài Tailscale Funnel còn Cloudflare Tunnel (`--tunnel`) và origin công khai tự sở hữu (`PUBLIC_ORIGIN`), ưu tiên Cloudflare > `PUBLIC_ORIGIN` > Funnel (`CLAUDE.md` § RECURRING #1, dòng Bypass / Ingress precedence; `README.md` § Exposing to the internet, mục Recommended ingress: Cloudflare tunnel or your own edge); client cùng máy nối thẳng `127.0.0.1:9999` hoặc chạy tools qua stdio, không cần ingress (`README.md` § Connecting local IDEs (Cursor, Claude Code, Claude app, AGY, Codex)).
