# Plan: Provider toolkit — gom phần quản lý, giữ bề mặt tool, mở rộng an toàn

> status: P0–P4 và P6 đã triển khai, chưa release (2026-10-02); còn kiểm tay của chủ (§ Amendments) và release `3.0.0` (thay `2.3.0`: `chrome_launch` đổi phá vỡ nên lên major) · hợp đồng đã chốt: [`docs/arch/provider-toolkit.md`](../arch/provider-toolkit.md) · nghiên cứu nền: [`docs/research/tool-surface-provider-toolkit.md`](../research/tool-surface-provider-toolkit.md) (số đo, nguồn, 9 khía cạnh suy xét)

## Kết luận

Gom phần **mã và quản lý** (một registry provider, detect, bật/tắt, một test bề mặt), **không** gom bề mặt tool hiện có. 36 tool giữ nguyên tên và schema; mỗi tool được thêm annotations. Provider mới theo hợp đồng shape cố định: `op` phẳng kiểu `aki__git`, tách tool đọc và tool ghi.

Vì sao (chi tiết trong research R1–R4):

- Định nghĩa tool hiện ~4.700 token (estimated từ 18.140 ký tự measured cho 33/34 tool), dưới ngưỡng ~10K mà Anthropic khuyên bắt đầu hoãn nạp. Gom 36 → 17 chỉ bớt ≤ ~1K token (estimated) nhưng mất required theo lệnh, mất `readOnlyHint` theo lệnh, và làm vỡ tên mà aiobox, README, quyền trên client đang dùng.
- 0/36 tool có annotations. ChatGPT coi tool thiếu `readOnlyHint` là write và đòi xác nhận → hiện mọi tool đọc cũng bị hỏi. Đây là cải thiện có bằng chứng mạnh nhất và không đổi tên nào.
- Không đăng ký provider không dùng được thì bớt nguyên khối token (Chrome ~5.050 ký tự, Postman ~1.370) mà không đổi độ chính xác của tool còn lại.
- Dạng `op` chỉ đáng dùng cho tool **mới**: không có người dùng cũ để phá, và với provider nhiều lệnh nó giữ số tool ~2 thay vì ~10.

Phiên bản: P1–P3 không breaking → `2.3.0`. Không có `3.0.0` trong plan này.

## Phạm vi

Trong phạm vi: annotations cho 36 tool; `scripts/provider-registry.js`; detect + bật/tắt provider; section Providers trên panel; `test/tool-surface.test.js`; sửa mô tả trỏ chéo; `docs/arch/provider-toolkit.md` (hợp đồng cho provider mới); provider đầu tiên theo Hợp đồng 3: `aiobox` (§ Provider `aiobox`, P6); cập nhật `docs/feat/tools.md`, README, CHANGELOG.

Ngoài phạm vi (kèm nơi sở hữu hoặc lý do):

- Đổi tên/gom tool hiện có, `{op, args}`, `op=help`, cổng meta, alias — bị loại (research § Decision).
- Dời file sang `scripts/core|ui|providers/` — `repo-architecture-subtraction-reorg.md`.
- Đổi semantics launch/attach/stop của Chrome — `IMPORTANT-shared-cdp-profiles.md`.
- Rút gọn mô tả `akidevrule_context` — `rule-context-handshake.md` / `docs/arch/rule-context-delivery.md`.
- Toolset theo client, `list_changed` động — bridge dùng phiên chung, không có kênh server → client (research R3).
- Provider Notion/GitHub/Docker cụ thể — P5, chỉ mở khi chủ xác nhận luồng dùng thật.

## Hợp đồng 1 — Annotations

Quy tắc (research K4):

- `readOnlyHint: true` chỉ khi tool **không thể ghi bằng cơ chế**. "Thường dùng để đọc" không đủ.
- Mọi tool khai báo tường minh `readOnlyHint`; tool không read-only khai báo thêm `destructiveHint`. `openWorldHint: false` cho tool chỉ chạm máy local; `true` cho tool có thể chạm trang/dịch vụ ngoài máy. `idempotentHint` chỉ khai báo khi chắc chắn.
- Annotations nằm trong lời gọi `registerTool` của chính tool đó. Hint phụ thuộc setting thì tính từ setting lúc đăng ký.
- Annotations là UX phía client, không thay allowlist/roots/SSRF guard.

Bảng đề xuất (chủ duyệt ở P1):

| Tool | readOnly | destructive | openWorld | Lý do ngắn |
|---|---|---|---|---|
| `akidevrule_context`, `find_path`, `search_content`, `read_text_file`, `get_file_info`, `list_allowed_directories` | true | — | false | Chỉ đọc dưới roots |
| `git` | true | — | **true** (chủ duyệt) | Chỉ đọc; `op=tags remote=` gọi `ls-remote` (mạng, không ghi) |
| `sqlite_schema`, `sqlite_query` | true | — | false | Handler từ chối write/DDL |
| `port_status`, `clipboard_read`, `postman_status`, `chrome_profiles` | true | — | false | Chỉ đọc trạng thái |
| `devtools_targets`, `devtools_screenshot` | true | — | false | Liệt kê target / chụp, không đổi trang |
| `kiro_read` | true | — | false | Khóa `--trust-tools=fs_read` |
| `agy_run` | `allowedModes` = `['plan']` | false | false | Tính từ `readSettings().agy` |
| `create_directory` | false | false (idempotent) | false | Chỉ thêm |
| `notify_user`, `clipboard_write`, `task_start`, `postman_rename_conversation`, `postman_panel_fullwidth` | false | false | false | Thay đổi nhỏ, không xóa dữ liệu |
| `chrome_launch` | false | false | true | Mở tiến trình/trang |
| `write_file`, `edit_file`, `move_file` | false | true | false | Ghi đè/đổi chỗ file |
| `kill_port`, `chrome_stop`, `task_manage` | false | true | false | Giết tiến trình / xóa bản ghi |
| `run_cmd` | false | true | false | Allowlist có thể chứa lệnh ghi (`git commit/push`) |
| `devtools_eval`, `postman_eval`, `chrome_interact`, `chrome_tabs` | false | true | true | JS/click tùy ý, đóng tab |
| `local_fetch` | false | true | true | Cho phép `POST/PUT/DELETE` tới LAN |

Kết quả mong đợi: 16 tool read-only (17 khi agy chỉ ở `plan`) thôi bị ChatGPT hỏi xác nhận; 19 tool còn lại (20 khi agy mở mode khác) vẫn hỏi.

## Hợp đồng 2 — Provider registry

Mỗi module tool export thêm một mô tả, giữ nguyên `register`:

```js
export const provider = {
  id: 'chrome',                 // khóa trong setting.json, ổn định, không đổi
  title: 'Chrome profiles & tabs',
  detect: () => listInstalledBrowsers().length ? { available: true } : { available: false, reason: 'no Chromium browser installed' },
  register,                     // hàm hiện có, không đổi
};
```

`scripts/provider-registry.js` (đặt phẳng trong `scripts/`; reorg sẽ dời sau):

1. Một mảng import tường minh các `provider` — SSoT duy nhất của "server có gì"; `tools-server.js` lặp qua mảng này thay cho danh sách `register` hiện tại.
2. Boot: chạy `detect()` một lần cho mỗi provider (đồng bộ, rẻ, không spawn tiến trình), đọc `readSettings().providers?.[id]?.enabled` (mặc định `true`).
3. Luôn gọi `register` cho mọi provider và bắt handle `RegisteredTool` qua proxy `registerTool` hiện có (`prefixedServer` trong `tools-server.js`); provider không available hoặc bị tắt thì `disable()` các handle. Lý do không bỏ qua `register`: `warmToolsServer` vẫn bắt lỗi schema của mọi tool lúc boot.
4. API cho panel: `listProviders()` → `[{ id, title, available, reason, enabled, tools: [names] }]`; `setEnabled(id, bool)` ghi `setting.json` rồi `enable()/disable()` handle trên server chung; `redetect()`.
5. Tool bị ẩn mà client vẫn gọi: SDK trả lỗi tool disabled. Không thêm guard riêng.

Nhóm provider (theo module hiện có, không tách/ghép module):

| id | Module | detect | Có tắt được |
|---|---|---|---|
| `rule` | `rule-context-mcp.js` | luôn | **không** — prompt aiobox và `WEB_PROMPT` gọi đích danh |
| `filesystem`, `search`, `shell` | `filesystem-mcp.js`, `search-mcp.js`, `shell-mcp.js` | luôn | **không** — primitive cốt lõi |
| `task`, `port`, `system`, `fetch`, `git`, `sqlite`, `cdp` | module cùng tên | luôn | có |
| `chrome` | `chrome-mcp.js` | `listInstalledBrowsers().length > 0` | có |
| `postman` | `postman/postman-mcp.js` | app Postman tồn tại theo `getPostmanPaths()` | có |
| `agy` | `agy-mcp.js` | binary `agy` có trên `PATH` | có |
| `kiro` | `kiro-mcp.js` | binary `kiro-cli` có trên `PATH` | có |
| `aiobox` | `aiobox-mcp.js` (mới, P6) | thư mục `~/.aki/aiobox/` tồn tại (AIObox đã cài), không theo `windows.json` (trạng thái chạy) | có |

Ghi chú thiết kế:

- `cdp` (`devtools_*`) luôn bật vì nó còn phục vụ Postman, VS Code và Chrome của aiobox; detect theo "có phiên đang chạy" sẽ ẩn đúng lúc attach cần nó (research K7.3).
- Tra `PATH`: một hàm dùng chung, đuôi file theo `process.platform` là bảng dữ liệu (`PATHEXT` trên win32), đúng luật OS-agnostic của `CLAUDE.md`. Không chạy `agy --version` lúc boot.
- Không tạo `defineOp`, schema tự sinh panel hay DSL: chưa đủ Rule of Three (`pattern.A2`). Registry là một mảng và một vòng lặp.

## Hợp đồng 3 — Shape cho provider mới

Áp dụng cho mọi provider thêm sau plan này (kể cả các tool trong `interactive-and-env-tools.md`). Ghi thành `docs/arch/provider-toolkit.md` ở P4.

1. **Tách theo mức rủi ro:** `aki__<p>` chỉ gồm op đọc (`readOnlyHint: true`); `aki__<p>_write` gồm op ghi. Không trộn.
2. **`op` enum + tham số phẳng**, theo `aki__git`. Mô tả tham số mở đầu bằng op dùng nó (`query: …`, `create: …`). Root schema luôn là object phẳng, không `anyOf/oneOf`, không `args` tự do.
3. **Required theo op kiểm ở handler**, lỗi nêu đúng trường thiếu và op: `rejected: op=create needs title, parent`. Helper kiểm dùng chung chỉ trích ra khi có tool op thứ ba.
4. **Tối đa ~8 op mỗi tool.** Vượt thì tách theo miền con (`aki__notion_db`), không dùng `op=help`.
5. **Description:** một câu nói tool làm gì, rồi mỗi op một mệnh đề `op=x: …`, rồi tên tool thay thế khi có chồng chức năng. Mô tả hành vi, không ra lệnh cho model (ChatGPT đã gắn cờ `Suspicious Instruction` cho mô tả dạng mệnh lệnh).
6. **Provider descriptor + detect + annotations** là bắt buộc; secret nằm dưới thư mục keys của `userdata.js`, không bao giờ vào output hay log.
7. **Cổng tồn tại:** mỗi op vẫn phải qua luật "khi nào một tool đáng tồn tại cạnh `run_cmd`" của `docs/feat/tools.md`.

## Hợp đồng 4 — Test bề mặt tool

`test/tool-surface.test.js`, thêm vào `npm test`. Dựng `createToolsServer()` + client in-memory như `test/git-mcp.test.js`, gọi `tools/list`:

1. **Ngân sách:** tổng `JSON.stringify(tools)` ≤ ngân sách. Ngân sách = baseline P0 × 1,10, ghi thành hằng số trong test kèm ngày đo; tăng ngân sách là một thay đổi có chủ đích trong diff. In bảng kích thước theo tool.
2. **Annotations:** mọi tool có `annotations.readOnlyHint` kiểu boolean; tool không read-only có `destructiveHint` boolean.
3. **Độ dài description:** ≤ 700 ký tự; ngoại lệ duy nhất `akidevrule_context` (ghi rõ lý do và trỏ tới rule-context plan).
4. **Trỏ chéo:** mọi chuỗi `aki__<name>` trong description phải là tool có trong danh sách đầy đủ (kể cả tool đang bị disable), để đổi tên về sau không để lại tham chiếu chết.
5. **Registry:** `setEnabled('postman', false)` → `postman_*` vắng ở `tools/list` kế tiếp; gọi `postman_status` → lỗi; `setEnabled` lại `true` → có lại. Provider không tắt được (`rule`, `filesystem`, `search`, `shell`) → `setEnabled` từ chối.
6. **Detect:** với `PATH` rỗng trong test, `agy_run`/`kiro_read` vắng.

## Provider `aiobox` — gọi đích danh cửa sổ AIObox (P6)

> thêm 2026-10-02 từ phiên aiobox (P8·W1) theo yêu cầu chủ; phía aiobox: `aiobox: docs/plan/akipanel.md` D7, AP11. Phiên aki-mcp-sv tự triển khai phần này.

### Bối cảnh

AIObox là app desktop điều khiển nhiều Chrome profile (Tauri + CDP). Mỗi cửa sổ có handle `P#·W#` (số profile cố định, số cửa sổ trong phiên Chrome), hiện ở tiền tố title mọi trang (`P7·W2 · lacvietanh@gmail.com · lqv1.1 · … | Notion`), trên AIOBox Panel và trong file `~/.aki/aiobox/cdp/windows.json` (luật: `aiobox: docs/feat/window-handles.md`). File đó ghi mỗi profile `{number, id, name, port, windows:[{handle, windowId, state, tabs:[{handle, targetId, url, title}]}]}`, ghi lại nguyên khối mỗi khi cửa sổ đổi, bị xoá khi AIObox thoát. Không có account, cookie hay gì mà `http://127.0.0.1:<port>/json` chưa cho.

Chủ chạy cùng lúc 5–10 cửa sổ chat AI (Notion AI, ChatGPT, Claude…) trên nhiều tài khoản, và thường nhắc cửa sổ này về cửa sổ kia: "đọc câu trả lời cuối ở P7·W2", "chụp P1·W2", "so P7·W2 với P1·W2", "eval cái này trong P2·W1". AI nhận lệnh chạy ở phía provider, chỉ thấy tool AkiMCP, không thấy `window.akipanel` trong trang.

### Vấn đề (đo trên máy chủ, 2026-10-02)

- `devtools_eval/_screenshot/_targets` không biết handle: chỉ nhận `port`, `targetId`, `filter`; port mặc định là phiên `chrome_launch` đang active, không phải Chrome của AIObox. Mô tả còn hướng AI đi `aki__port_status` trước (`NO_SESSION_HINT`, `cdp-mcp.js`), là đường sai cho cửa sổ AIObox.
- Một câu "P7·W2" vì vậy thành 3–4 lần gọi tool (đọc `windows.json` → tìm profile/port → tìm targetId → eval), và chủ phải dạy lại chuỗi đó trong prompt mỗi lần. Đó là cái "prompt khá dài" chủ đang phải viết.
- Đọc nội dung bằng `innerText` của `main` chạy được nhưng lẫn rác: đọc thử P2·W1 (Notion) ra cả `Thought`, `AkiMCP / Read Text File`, `Skip all approvals`, `Add to chat`. Tách đúng tin người dùng / tin trả lời là kiến thức DOM riêng từng provider.
- AI không biết mình là cửa sổ nào. Riêng Notion AI biết id chat của chính nó, và id đó nằm trong URL tab (`app.notion.com/chat?t=<id>`): phiên P8·W1 tự tìm ra mình bằng cách này. ChatGPT/Claude không thấy id hội thoại của mình.

### Mục tiêu

Chủ gõ một câu kiểu "tóm tắt câu trả lời cuối ở P7·W2, so với P1·W2" trong một chat mới, không kèm hướng dẫn; AI làm đúng ngay lần đầu với ≤ 3 lần gọi tool. Cái "biết" về cửa sổ AIObox nằm trong mô tả tool (luôn ở context của AI), không nằm trong prompt.

### Quyết định

| # | Quyết định | Vì | Bỏ | Mở lại nếu |
|---|---|---|---|---|
| X1 | Provider riêng `aiobox` (`scripts/aiobox-mcp.js`) theo Hợp đồng 3, dựng trên `cdp-engine.js` như `postman-mcp.js` dựng trên nó | Kiến thức riêng app nằm ở module của app (tiền lệ Postman); `devtools_*` giữ app-agnostic và giữ schema (§ Kết luận) | Thêm `window:` vào `devtools_*` (đổi schema 3 tool đang dùng, trộn kiến thức AIObox vào tool chung); để AI tự đọc `windows.json` (hiện trạng, chính là vấn đề) | — |
| X2 | Nội dung chat đọc qua `akipanel.live.chat()` trong trang (aiobox sở hữu DOM từng provider, capability chuẩn `chat` 1, aiobox `docs/arch/provider-capabilities.md`); AkiMCP chỉ gọi khi `akipanel.capabilities.chat === 1`, trang không có thì trả `innerText` và ghi `source: 'raw'` | aiobox đã giữ kiến thức DOM provider (macro, provider module), cập nhật cùng build panel; AkiMCP không phải theo DOM 5 provider | Selector provider trong AkiMCP (lặp kiến thức ở 2 repo, hỏng 2 chỗ khi DOM đổi) | AIObox bỏ panel, hoặc cần đọc chat ở Chrome không do AIObox mở |
| X3 | Địa chỉ = handle (mọi dạng gõ `P7·W2`, `p7w2`, `P7.W2`, `P7-W2`, `P7 W2`) hoặc targetId; đọc `windows.json` mỗi lần gọi | File nhỏ, ghi nguyên khối; đọc lại thì không bao giờ dùng bản cũ | Cache trong AkiMCP (lệch khi cửa sổ đóng/mở) | Đo được đọc file là nút cổ chai |
| X4 | Không có op gửi prompt sang cửa sổ khác trong P6 | Chưa có luồng thật cần; aiobox đã bỏ AP10 (listener nhận lệnh trong trang) | `op=prompt` ngay | Chủ cần "bảo P7·W1 hỏi X" lặp lại; khi đó thêm `op=prompt` vào `aki__aiobox_write`, làm qua CDP, kèm selector từ aiobox |
| X5 | Không thêm quyền: tool chỉ chạm cửa sổ có trong `windows.json` | Cỡ đe dọa: client AkiMCP vốn đã có `devtools_eval` với port bất kỳ; provider này chỉ đổi cách gọi tên | Allowlist cửa sổ/tài khoản | Có client AkiMCP mà chủ không muốn cho đọc chat các tài khoản khác |

### Bề mặt tool (2 tool)

`aki__aiobox` — đọc, `readOnlyHint: true`, `openWorldHint: false` (như `devtools_screenshot`). Code JS chạy trong trang do tool cố định, không nhận expression, nên read-only bằng cơ chế.

| op | Tham số | Trả về |
|---|---|---|
| `windows` | — | mỗi tab có handle: `{handle, provider, profile, title, url}` (title đã bỏ tiền tố handle); `provider` suy từ host như aiobox (`app.notion.com` → notion, `chatgpt.com`, `claude.ai`, `grok.com`, `gemini.google.com`) |
| `read` | `window`, `last` (số tin cuối, mặc định 1) | `{source: 'provider', busy, messages: [{role, text}]}` từ `data` của `akipanel.live.chat()` (`ok: false` → lỗi mang `error` nguyên văn); trang không có capability `chat` thì `{source: 'raw', text}` (`document.body.innerText`, Notion không có `main`; cắt theo codepoint, trần ký tự cố định) |
| `text` | `window`, `selector` | `[{text, ariaLabel}]` của phần tử khớp, có trần số phần tử |
| `screenshot` | `window` | ảnh, như `devtools_screenshot` |

`aki__aiobox_write` — ghi, `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true` (như `devtools_eval`).

| op | Tham số | Trả về |
|---|---|---|
| `eval` | `window`, `expression`, `awaitPromise` | như `devtools_eval` |

Mô tả (Hợp đồng 3.5, mô tả hành vi, không ra lệnh), phải chứa đủ 3 ý, ≤ 700 ký tự: (1) cửa sổ AIObox được gọi bằng handle `P#·W#`, cũng là tiền tố title của trang; (2) URL của tab mang id chat của nó (Notion `?t=<id>`, ChatGPT `/c/<id>`), nên một chat tìm được cửa sổ của chính mình trong `op=windows`; (3) không có `windows.json` nghĩa là AIObox không chạy. Mô tả `devtools_*` thêm một mệnh đề trỏ chéo: cửa sổ AIObox gọi bằng handle qua `aki__aiobox`.

Lỗi (Hợp đồng 3.3, nêu đúng thứ thiếu):

- Không có file: `AIObox is not running (no ~/.aki/aiobox/cdp/windows.json)`.
- Không có handle: `no window 'P9·W9'; open: P1·W1, P1·W2, P7·W1, …` (kèm danh sách để AI tự sửa trong một lượt).
- Thiếu tham số: `rejected: op=read needs window`.
- Kiểm chéo: title của target sống phải bắt đầu bằng handle; lệch thì báo `window map is stale`, không chạy.

### Hợp đồng với aiobox (thêm vào `IMPORTANT-akimcp-aiobox-contract.md`, cả hai bản)

| Thứ | Hình dạng | Ai sở hữu |
|---|---|---|
| `~/.aki/aiobox/cdp/windows.json` | như § Bối cảnh, `version: 1` | aiobox ghi, AkiMCP đọc |
| Dạng handle | `P<n>·W<n>[·T<n>]`, các dạng gõ ở X3 | aiobox `cdp/handle.rs::parse_handle`; AkiMCP giữ một bản parse cùng luật + test cùng bộ ví dụ |
| `window.akipanel.capabilities` | `{chat?: 1, usage?: 1}` (đọc qua `JSON.stringify`: `akipanel` là readonly Proxy, `returnByValue` ra `{}`) | aiobox core; AkiMCP chỉ gọi `live.chat()` khi `chat === 1` |
| `window.akipanel.live.chat()` | `→ {ok: true, data: {messages: [{role: 'user'\|'assistant', text}], busy: boolean}} \| {ok: false, error}` (đồng bộ, chỉ đọc, không throw) | aiobox provider adapter (AP11, Notion xong 2026-10-02; ChatGPT/Claude AP12); AkiMCP chỉ gọi |

### Kiểm

- `test/aiobox-mcp.test.js`: `HOME` tạm với `windows.json` mẫu; parse mọi dạng handle; thiếu file / sai handle / thiếu tham số ra đúng thông điệp; `op=windows` bỏ tiền tố title; `read` chọn `provider` khi `akipanel.capabilities.chat === 1`, `raw` khi không, `ok: false` ra lỗi mang `error` (engine giả).
- `test/tool-surface.test.js`: ngân sách tăng có chủ đích (ghi số); annotations; trỏ chéo `aki__aiobox` hợp lệ.
- Runtime trên máy chủ: `op=windows` khớp `windows.json`; `read` P2·W1 (Notion) ra `raw` trước AP11, `provider` sau AP11; `screenshot` một cửa sổ ChatGPT; sai handle ra danh sách. Bài kiểm mục tiêu: một chat mới, câu "tóm tắt câu trả lời cuối ở P7·W2, so với P1·W2", ≤ 3 lần gọi tool, đúng lần đầu; ghi số lần gọi vào Amendments.

## Các giai đoạn

| # | Việc | File chạm | Breaking | Cổng nghiệm thu |
|---|---|---|---|---|
| P0 | Viết test bề mặt phần 1 (ngân sách, chỉ in bảng + ghi baseline) và 4 (trỏ chéo). Ghi số byte server vào `## Amendments` của research | `test/tool-surface.test.js`, `package.json`, research doc | không | `npm test` xanh; baseline có trong test và research |
| P1 | Annotations cho 36 tool theo bảng đã duyệt; `agy_run` tính từ setting; bật test phần 2 | 15 module tool | không (hành vi xác nhận đổi) | `npm test` xanh. Chủ kiểm tay trên ChatGPT: `read_text_file` không hỏi xác nhận, `write_file` vẫn hỏi; ghi quan sát vào Amendments |
| P2 | `provider-registry.js`; `provider` descriptor cho 15 module; hàm tra `PATH`; `tools-server.js` dùng registry; key `providers` trong `setting.json`; test phần 5–6 | `scripts/provider-registry.js`, `tools-server.js`, 15 module, `allowlist.js` (đọc/ghi setting) | không | Máy đủ cài đặt: `tools/list` sau P2 giống hệt sau P1 (so JSON). Gỡ `agy` khỏi PATH → `agy_run` vắng sau restart |
| P3 | Panel section "Providers": trạng thái detect + lý do, công tắc, nút detect lại; API `GET/POST /api/providers` (cùng `x-panel-token`); sửa mô tả trỏ chéo: `devtools_eval` nhắc `aki__postman_eval` cho Postman, `run_cmd` nhắc `aki__task_start` cho lệnh chạy lâu | `panel.js`, `config-page.js`, `public/panel.css`, `cdp-mcp.js`, `shell-mcp.js` | không | Tắt Postman trên panel → lần `tools/list` kế của claude.ai không còn `postman_*` (kiểm tay, ghi Amendments); ngân sách không vượt |
| P4 | Viết `docs/arch/provider-toolkit.md` (Hợp đồng 2–4, có stamp); cập nhật `docs/feat/tools.md` (mục Annotations, Providers), README (bật/tắt provider), `CHANGELOG.md` `[Unreleased]`; release `2.3.0` theo quy trình release | docs, CHANGELOG | không | Docs khớp code (đọc chéo); index cập nhật |
| P6 | Provider `aiobox` (§ Provider `aiobox`): `scripts/aiobox-mcp.js` (đọc `windows.json`, parse handle, `aki__aiobox` + `aki__aiobox_write`), descriptor + detect, trỏ chéo trong `cdp-mcp.js`, thêm 3 dòng vào `IMPORTANT-akimcp-aiobox-contract.md` (cả hai bản), `docs/feat/tools.md` | `scripts/aiobox-mcp.js`, `tools-server.js` (hoặc registry nếu P2 đã xong), `cdp-mcp.js`, test, docs | không | `npm test` xanh; runtime + bài kiểm mục tiêu ở § Kiểm. Chạy được sau P1; không chờ P2 (P2 xong thì thêm descriptor) |
| P5 | Provider sâu đầu tiên theo Hợp đồng 3, khi chủ chọn và có luồng dùng thật; plan riêng | module provider mới + 1 dòng registry | không | Chỉ chạm module mới + registry; ≤ 2 tool mới; test bề mặt xanh; bộ ~10 tác vụ mẫu chạy tay trên claude.ai + một client local, ghi tỷ lệ gọi đúng lần đầu |

Thứ tự có lý do: P0 trước để mọi bước sau có số để so; P1 độc lập và có giá trị ngay, ship riêng được; P2 trước P3 vì panel cần API của registry.

Rủi ro theo bước và cách lùi:

- P1 gắn sai `readOnlyHint` → một hành động ghi không bị hỏi. Chặn bằng quy tắc "bằng cơ chế" + chủ duyệt bảng. Lùi: đặt lại `false`, không ảnh hưởng gì khác.
- P2 detect sai → ẩn tool đang cần. Chặn bằng detect theo cài đặt (không theo trạng thái chạy) và lý do hiển thị trên panel. Lùi: `providers.<id>.enabled` không cứu được provider detect sai, nên panel có nút detect lại; nếu vẫn sai thì sửa hàm detect.
- P3 client không list lại sau khi đổi → thay đổi có hiệu lực ở phiên mới. Panel ghi rõ điều này cạnh công tắc.

## Việc cần chủ quyết

1. Duyệt bảng annotations (đặc biệt: `git` có `openWorld: true` vì `ls-remote`; `chrome_tabs` destructive vì có `close`; `clipboard_write` không destructive).
2. P5: provider sâu đầu tiên và luồng dùng thật của nó (Notion: đẩy/kéo `docs/` ↔ database? hay GitHub qua `gh`?).

## Ngưỡng mở lại quyết định "không gom bề mặt"

- Test ngân sách cho thấy `tools/list` > ~40.000 ký tự (~10K token).
- Một client thật báo vượt trần số tool.
- Quan sát được model chọn sai tool lặp lại mà mô tả trỏ chéo không sửa được.
- Bridge có kênh server → client và client lớn nghe `list_changed` (lúc đó nạp provider động theo phiên rẻ hơn gom).

## Amendments

- 2026-10-02 P0: baseline `tools/list` = 27.207 ký tự, 36 tool (trước annotations); ngân sách 29.928. Số đo chi tiết trong research § Amendments.
- 2026-10-02 P1: annotations theo bảng (git `openWorld: true`), `run_cmd` rút còn 690 ký tự và trỏ `aki__task_start`, `devtools_eval` trỏ `aki__postman_eval`. Bề mặt: 36 tool, 29.658 ký tự, sha256 `2125b8fb409bb25a`.
- 2026-10-02 P2: sau registry, sha256 bề mặt giống hệt P1 (`2125b8fb409bb25a`), đạt cổng. Lệch so với bản kế hoạch: detect Postman có thể chạy `which`/`where` một lần khi Postman không ở đường dẫn chuẩn (`getPostmanPaths()`), không phải "không spawn" tuyệt đối. Test bề mặt kiểm annotations / độ dài / trỏ chéo trên mọi tool đã đăng ký (kể cả tool bị disable), vì CI Ubuntu không có agy/Chrome/Postman.
- 2026-10-02 P3: panel section 8 "Tool providers", `GET/POST /api/providers`; test gọi thẳng `ROUTES`.
- 2026-10-02 P6: `aki__aiobox` + `aki__aiobox_write`. Ngân sách tăng có chủ đích +2.687 ký tự (`RAISES` trong test) → 32.615; đo được 38 tool, 32.345 ký tự, sha256 `b32c63db5fd2f95a`. Lệch so với bản kế hoạch: id provider theo AIObox (`gpt`, không phải `chatgpt`); `profile` trong `op=windows` là tên profile; kiểm chéo title nhận trang chưa có tiêu đề hoặc không có tiền tố handle, chỉ từ chối khi title mang một handle khác (title trang mới mở chưa kịp được AIObox gắn tiền tố). 3 dòng hợp đồng đã vào cả hai bản `IMPORTANT-akimcp-aiobox-contract.md`.
- 2026-10-02 P6 (sau): `read` theo hợp đồng chat v1 (`capabilities.chat === 1`, `{ok, data}`, `ok: false` thành lỗi nguyên văn, raw từ `document.body`); đo thật P1·W1 `/chat` 13 tin, P4·W1 `/ai` 0 tin. Thêm `aiobox_write op=new_window` qua `akipanel.newWindow()` theo yêu cầu chủ (mở một phần X4: mở cửa sổ, chưa gửi prompt; gửi prompt cần capability chuẩn phía aiobox). Bề mặt 32.540 ký tự, vẫn trong ngân sách.
- Chờ chủ kiểm tay: (1) ChatGPT: `read_text_file` không hỏi xác nhận, `write_file` vẫn hỏi; (2) tắt Postman trên panel → lần `tools/list` kế của claude.ai không còn `postman_*`; (3) AIObox runtime: `op=windows` khớp `windows.json`, `read` P2·W1 ra `raw`, `screenshot` một cửa sổ ChatGPT, sai handle ra danh sách, bài kiểm mục tiêu ≤ 3 lần gọi tool (ghi số vào đây).
- 2026-10-02 · (1) ĐẠT: ChatGPT lacvietanh (dev-mode app AkiMCP, quyền tạm đặt "Allow read-only tools"): `aki__read_text_file` chạy không hỏi, `aki__write_file` hiện hộp "Allow ChatGPT to use AkiMCP?" → Deny, không ghi. Đã trả quyền về "Allow all tools" như cũ; đóng các tab thử. Lưu ý: ở "Allow all tools" ChatGPT không hỏi gì nên annotation chỉ có tác dụng khi chủ dùng mức read-only/low-risk.
- 2026-10-02 · (2) ĐẠT: `POST /api/providers {id:'postman', enabled:false}` → chat Notion mới (P4, wepro000) `mcp_list_tools` không còn tool nào chứa `postman`, `aki__aiobox` có; bật lại sau ~64 s. Thử trên Notion thay claude.ai (cùng đường `tools/list`).
- 2026-10-02 · (3) ĐẠT (process đang chạy, chưa có `op=new_window`): chat Notion mới P4·W4 gọi `aki__aiobox` 4 lần cho 4 bước: `op=windows` 10 tab khớp `windows.json`; `read` P8·W1 ra tin cuối (chat v1); `screenshot` P8·W1 ra PNG (cửa sổ Notion, không phải ChatGPT); `read` P9·W9 → `no window 'P9·W9'; open: …`. Bài mục tiêu "đọc một cửa sổ" = 1 lần gọi (≤ 3). Còn lại sau restart: `aiobox_write op=new_window`.
- 2026-10-03 · sau restart AkiMCP: `aiobox_write op=new_window window=P1·W4` → `P1·W5` (Notion `/ai`, tiền tố handle đã gắn); đóng bằng `/json/close`. Mục "Còn lại sau restart" đã xong.
- 2026-10-03 · `aiobox_write op=compose` (akipanel compose v2, không gửi) và `account` trong `op=read`; ngân sách +214 ký tự (`RAISES`), bề mặt 38 tool, 32.828 ký tự. Phần gửi prompt của X4 vẫn không làm: compose chỉ điền, người gửi.

## Bàn giao (2026-10-02, P2·W1 → P2·W2)

Trạng thái: P0–P4, P6 xong và đã kiểm thật (Amendments ở trên). `main` đi trước origin 7 commit (kể cả commit bàn giao này), chưa push; cây sạch; `npm run test` qua ở lần đổi code cuối. Bề mặt 38 tool, 32.540 ký tự (ngân sách 32.615).

Còn tồn, theo thứ tự:
1. **Restart AkiMCP** (chỉ khi chủ cho; nhiều phiên đang chạy, restart cắt mọi lần gọi MCP dang dở). Kiểm trước bằng `~/.aki/mcpsv/task/aiobox-sessions.mjs` (tab nào `busy`). Process hiện tại đã có `aki__aiobox` nhưng chưa có `aiobox_write op=new_window`.
2. Sau restart: chat mới gọi `aki__aiobox_write op=new_window window=<handle>` trên một cửa sổ rảnh → ra handle mới; đóng cửa sổ đó sau; ghi kết quả vào Amendments.
3. **Push / release 2.3.0 chỉ khi chủ ra lệnh**: cổng B7, bump version, stamp `> updated YYYY-MM-DD · v2.3.0`, CHANGELOG, dời plan sang `docs/plan/done/`.
4. **P5**: chờ chủ chọn provider.
5. Phụ thuộc repo aiobox (phiên aiobox làm, không commit hộ, không `git add -A` bên đó): bản hợp đồng `IMPORTANT-akimcp-aiobox-contract.md` có dòng `newWindow()/online` chưa commit; ghi chú "Open" phím icon pill trong `docs/feat/window-panel.md` § Brand; X4 gửi prompt cần capability chuẩn phía aiobox (Notion có `compose` v1 nhưng không gửi). Hai bản hợp đồng phải giống nhau trừ dòng 3.
6. Dọn tuỳ chủ: 2 chat thử trong Notion wepro000 ("Tool availability check", "AkiMCP read window P8·W1"), 1 chat thử ChatGPT lacvietanh ("AkiMCP file operations").

Lưu ý làm việc: mở tab thử bằng `PUT http://127.0.0.1:<port>/json/new?<url>` và đóng ngay bằng `/json/close/<id>`; mỗi bài một tab. Đổi cài đặt dùng chung (provider trên panel, quyền app ChatGPT) thì trả về như cũ ngay sau khi thử.

## Liên quan

- `docs/plan/repo-architecture-subtraction-reorg.md` — khi dời file, `provider-registry.js` và các module đi cùng một đợt.
- `docs/plan/interactive-and-env-tools.md` — 5 tool đề xuất ở đó phải theo Hợp đồng 3 (vd. `aki__process` đọc + `aki__process_write`), không thêm 5 tool phẳng.
- `docs/plan/IMPORTANT-shared-cdp-profiles.md` — không đổi; khi patch H1–H6 xong, cập nhật mô tả `chrome_launch` ("purges locks") và annotations nếu semantics đổi.
- `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` — P1–P5 không chạm (không đổi tên tool nào); P6 thêm dòng hợp đồng (`windows.json`, dạng handle, `akipanel.capabilities`, `akipanel.live.chat()`, `akipanel.account`, đọc Proxy qua CDP) vào cả hai bản (đã ghi 2026-10-02).
- `aiobox: docs/plan/akipanel.md` (D7, AP11 `live.chat()`), `aiobox: docs/feat/window-handles.md` (handle, `windows.json`), `aiobox: docs/feat/window-panel.md` rule 20–24, `aiobox: docs/arch/provider-capabilities.md`.
