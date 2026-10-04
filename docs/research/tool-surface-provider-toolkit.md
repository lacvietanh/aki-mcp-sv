# Bề mặt tool và khung provider — gom thế nào để không mất độ chính xác

Status: amended 2026-10-02

## Start time

2026-10-02 (Asia/Saigon), trên `main` @ `956d337`, v2.2.0, SDK `@modelcontextprotocol/sdk` 1.30.0.

## Initial purpose

Chủ muốn tinh gọn và gom tool (git, postman, notion, …) vì sẽ phát triển nhiều provider, cả rộng lẫn sâu. Bản plan đầu (gom 36 → 17 tool bằng `op`) bị chủ hỏi lại: có hiệu quả không, description có đủ để AI gọi đúng từng lệnh như cũ không. Câu hỏi của nghiên cứu này: cấu trúc nào cho phép thêm nhiều provider mà không làm giảm tỷ lệ AI gọi đúng, không tăng số lượt xác nhận, và không phá client/aiobox đang dùng tên tool hiện tại.

Bối cảnh: single-process, một `McpServer` dùng chung mọi client qua một phiên nội bộ (`scripts/streamable-bridge.js`); client web (claude.ai, ChatGPT, Grok, Gemini) và local (Postman, Cursor, Claude Code, AGY, Codex).

## Strategy

`METHOD-deep-think.md` đủ 5 module (techbiz lens bỏ qua vì đây là công cụ cá nhân), 2–6 lượt cho mỗi khía cạnh; đo thay vì ước khi đo được; số nào ước thì ghi là ước (`proportion.A5`). Cổng thiết kế: `pattern.A1/A2/A3/A6/A8`, `pattern.B3`, `proportion.B3`.

## Checklist

- [x] Đọc `scripts/tools-server.js`, `mcp-tool.js`, `git-mcp.js`, `agy-mcp.js`, `streamable-bridge.js`, `docs/feat/tools.md`, các plan đang mở liên quan.
- [x] Đếm tool đăng ký: `registerTool(` trong `scripts/` → 36.
- [x] Đo description + schema của 34 tool mà client Notion nhận (`mcp_describe_tools`, 2026-10-02).
- [x] Grep annotations: `readOnlyHint|destructiveHint|annotations` trong `scripts/` → 0 kết quả.
- [x] Xác nhận SDK 1.30.0 có `annotations` trong config `registerTool` và `RegisteredTool.enable()/disable()` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` dòng 271–277).
- [x] Grep `aki__` trong aiobox (`desktop/`, `docs/`).
- [x] Web: spec annotations, ChatGPT developer mode, Anthropic tool search, OpenAI schema root.
- [ ] Chưa làm: đo byte thật của `tools/list` phía server (P0 của plan); kiểm hành vi trên từng client.

## Result

### R1. Số đo bề mặt hiện tại

- 36 tool đăng ký, 15 module. Client Notion nhận 34 (thiếu `agy_run`, `kiro_read`); nguyên nhân chưa biết.
- 33 tool đo được: tên + description + inputSchema = **18.140 ký tự** (measured, qua client Notion, đã bỏ tiền tố `[AkiMCP MCP] ` mà client tự thêm). `sqlite_query` bị sót khi parse, ước ~500 → tổng ~18.600 ký tự, **~4.700 token** (estimated, chia 4).
- Lớn nhất: `akidevrule_context` 1.634, `git` 1.158, `run_cmd` 1.048, `devtools_eval` 1.044, `local_fetch` 903. Nhóm trình duyệt (5 `chrome_*` + 3 `devtools_*`) ~5.050; Postman (4) ~1.370.
- Tham số lặp: `port`/`host`/`targetId`/`filter` xuất hiện ở 3 `devtools_*` và 3 `chrome_*`.

### R2. Facts bên ngoài (có nguồn)

- Annotations là **hint**, không phải cơ chế bảo mật; mặc định `readOnlyHint=false`, `destructiveHint=true`, `openWorldHint=true` — modelcontextprotocol.io blog "Tool Annotations as Risk Vocabulary" (2026-03-16), đọc 2026-10-02.
- ChatGPT Developer mode: "Write actions by default require confirmation … We respect the `readOnlyHint` tool annotation … Tools without this hint are treated as write actions." — developers.openai.com/api/docs/guides/developer-mode, đọc 2026-10-02.
- Anthropic khuyên dùng Tool Search (hoãn nạp tool) khi định nghĩa tool vượt ~10K token, và nó thêm một bước tìm trước khi gọi — anthropic.com/engineering/advanced-tool-use, đọc 2026-10-02.
- OpenAI Structured Outputs: root schema phải là object và không được là `anyOf`; discriminated union của zod sinh `anyOf` ở root — platform.openai.com/docs/guides/structured-outputs/supported-schemas, đọc 2026-10-02. Chưa kiểm rằng connector MCP của ChatGPT áp đúng ràng buộc này (unverified), nhưng đủ để không chọn nó.

### R3. Facts trong repo

- **0 tool có annotations.** Theo R2, trên ChatGPT mọi tool AkiMCP, kể cả `read_text_file`, đều bị coi là write và đòi xác nhận (suy ra từ nguồn, chưa quan sát lại trên UI).
- Bridge dùng **một phiên nội bộ chung**, POST → JSON, không có kênh server → client; `notifications/tools/list_changed` không tới được client (`streamable-bridge.js`: notification từ upstream không có `id` bị `routeResponse` bỏ qua). Bật/tắt tool chỉ có hiệu lực ở lần `tools/list` kế tiếp của client.
- `tools/list` không bị cache ở bridge (chỉ `initialize` được cache), nên `RegisteredTool.disable()` trên server chung phản ánh ngay ở lần list sau.
- `aki__git` là tiền lệ duy nhất của mẫu `op`: 4 op, tham số phẳng, mô tả tham số có tiền tố `diff:`/`log:`/`tags:`, chỉ đọc.
- aiobox dùng tên tool trong prompt chính thức (`desktop/src-tauri/resources/prompts/akimcp-instruction.md`: `aki__akidevrule_context`, `aki__*`) và trong tài liệu thao tác (`aki__port_status`, `aki__devtools_*`, `aki__read_text_file`, `aki__list_allowed_directories`). Mã Rust không gọi tên tool nào (grep `aki__` trong `desktop/src-tauri/src` → 0).

### R4. Suy xét theo khía cạnh

#### K1. Mục tiêu (4 lượt)

1. Chuỗi mục tiêu: gom tool → bề mặt gọn → AI ít tốn context và chọn đúng hơn → thêm provider mà không làm hỏng phiên làm việc → **AI từ xa làm được nhiều việc local hơn, ít lượt thừa và ít sai** (mục tiêu gốc của `docs/feat/tools.md`).
2. "Gom" là phương tiện, không phải mục tiêu. Thước đo đúng: token thường trực, tỷ lệ gọi đúng lần đầu, số lượt xác nhận, chi phí thêm một provider.
3. Mâu thuẫn trong chuỗi: "ít tool" vs "gọi đúng". Ít tool nhưng mỗi tool nhiều op thì schema mất ràng buộc theo lệnh.
4. Hai thứ chủ gọi là "gom" thật ra khác nhau: gom **mã và quản lý** (một registry, một panel, một hợp đồng) và gom **bề mặt tool** (ít tên hơn). Cái thứ nhất phục vụ mục tiêu mở rộng mà không đổi gì với AI; cái thứ hai chỉ đáng làm khi R1 vượt ngưỡng.

#### K2. Độ chính xác khi AI gọi tool (6 lượt)

1. Thông tin model cần để gọi đúng = tên lệnh + tham số + ràng buộc (required, enum, min/max). Gom không xóa thông tin này mà dồn vào một schema.
2. JSON Schema phẳng không diễn đạt được "op=X thì bắt buộc Y". Cách diễn đạt được là `oneOf`/`anyOf`, nhưng ở root thì bị OpenAI cấm (R2). Vậy gom → mất required theo op (vd. `devtools_eval.expression`, `chrome_interact.action/selector`, `kill_port.port`).
3. Mất required không phải thảm họa: handler validate và trả lỗi nêu đúng trường thiếu, model tự sửa ở lượt sau. Nhưng mỗi lần như vậy tốn một round-trip, đúng thứ `tools.md` muốn tiết kiệm.
4. `{op, args}` lồng: `args` là object tự do thì model không còn mô tả cho từng tham số, chỉ còn văn trong description — tệ hơn cả schema phẳng. Loại.
5. `op=help`: thêm một lượt cho mỗi lệnh hiếm, và model phải biết là nên gọi help. Theo R2, Anthropic chỉ khuyên trả giá bước tìm này khi định nghĩa > ~10K token; ta ở ~4,7K. Loại cho tới khi vượt ngưỡng.
6. Nguồn sai thật sự hiện nay không phải số tool mà là **tool chồng chức năng không trỏ nhau**: ba cách chạy JS (`devtools_eval`, `postman_eval`, `chrome_interact`), hai cách xem git (`git`, `run_cmd git …`), hai cách chạy lệnh (`run_cmd`, `task_start`). `run_cmd` và `devtools_*` đã trỏ chéo; `devtools_eval` chưa nhắc `postman_eval`. Cách sửa rẻ và đúng: mô tả trỏ chéo đúng tên + test kiểm tên được nhắc có tồn tại.

#### K3. Chi phí token (4 lượt)

1. Gom chỉ bớt được tên, vỏ object và tham số lặp. Ước 15–25% của ~4,7K, tức ≤ ~1K token (estimated).
2. Không đăng ký provider không dùng được thì bớt nguyên khối mà không đổi gì với tool còn lại: không Postman → ~1.370 ký tự; không Chrome → ~5.050; không agy/kiro → vài trăm (measured theo R1).
3. Provider mới sâu (Notion ~8–12 lệnh, estimated) theo dạng một tool mỗi lệnh sẽ thêm ~3–5K ký tự; theo dạng `op` phẳng tách đọc/ghi thì khoảng 2 tool, bớt vỏ và tham số chung. Đây là nơi dạng `op` đáng giá: tool **mới**, không có người dùng cũ để phá.
4. Ngưỡng mở lại chiến lược hoãn nạp: `tools/list` > ~40.000 ký tự (~10K token) — đo bằng test ngân sách, không đoán.

#### K4. Quyền, xác nhận, an toàn (5 lượt)

1. Hiện 0 annotations → ChatGPT coi mọi tool là write (R2, R3). Thêm `readOnlyHint` đúng cho tool đọc là cải thiện UX có bằng chứng mạnh nhất trong toàn bộ nghiên cứu, và không đổi tên nào.
2. Proportionality (`proportion.A`): gắn sai `readOnlyHint=true` cho tool ghi → client bỏ xác nhận một hành động ghi. Reach: mọi client tôn trọng hint; capability: model tự gọi, hoặc prompt injection từ nội dung đọc được; blast radius: file/tiến trình local, có thể không hoàn tác. Vì vậy quy tắc là bảo thủ: chỉ `true` khi tool không thể ghi **bằng cơ chế** (vd. `kiro_read` khóa `fs_read`), không phải "thường dùng để đọc". `run_cmd`, `devtools_eval`, `local_fetch` ghi được → `false`.
3. `agy_run`: read-only chỉ khi `agy.allowedModes` = `['plan']`. Hint phải suy ra từ setting lúc đăng ký (SSoT `allowlist.js` `readSettings`), không viết cứng.
4. Gom đọc với ghi vào một tool → cả tool mất `readOnlyHint` → lệnh đọc cũng phải xác nhận; "always allow" một lần thì mở luôn lệnh nguy hiểm. Đây là lý do cứng để không trộn mức rủi ro trong một tool. Không trái `tools.md` ("tách đọc/ghi không phải lý do"): `tools.md` nói về *an toàn*, ở đây là *UX xác nhận của client*; an toàn vẫn nằm ở allowlist.
5. Annotations không thay allowlist/roots/SSRF guard; chúng chỉ là lớp UX phía client (`proportion.B3`: client-side là UX, không phải enforcement).

#### K5. Kiến trúc mã (5 lượt)

1. Vấn đề thật của mã: danh sách provider chỉ có trong `tools-server.js`; không nơi nào biết provider có dùng được không; panel hard-code từng phần. Cần một SSoT (`pattern.A1`) cho "server có provider nào, trạng thái ra sao".
2. Nhỏ nhất đủ dùng: mỗi module export thêm `provider = { id, title, detect?, register }`; một `provider-registry.js` chạy detect, đọc enable, gọi `register`, giữ handle `RegisteredTool` để `enable()/disable()`. Không dời file (việc dời thuộc `repo-architecture-subtraction-reorg.md`), không đổi tên tool.
3. Không dựng `defineOp`/schema tự sinh panel ngay: mới có 1 tool dạng op (`git`), chưa đủ Rule of Three (`pattern.A2`). Helper validate op dùng chung chỉ trích khi provider op thứ ba xuất hiện.
4. Annotations đặt ngay trong lời gọi `registerTool` của từng tool (SSoT cạnh hành vi), không đặt trong một bảng riêng sẽ lệch.
5. Auto-scan thư mục provider bị loại: mất SSoT tường minh và khó với gói standalone. Danh sách import tường minh ở registry.

#### K6. Mở rộng rộng và sâu (4 lượt)

1. Rộng: provider mới = một module + một dòng trong registry; panel và test bề mặt tự bao.
2. Sâu: provider mới dùng dạng `op` phẳng kiểu `git`, **tách theo mức rủi ro**: `aki__<p>` (đọc, `readOnlyHint=true`) + `aki__<p>_write` (ghi). Mỗi tool tối đa ~8 op; vượt thì tách theo miền con (vd. `aki__notion_db`), không dùng `op=help`, để mọi schema vẫn hiện cho tới ngưỡng K3.4.
3. Tham số mô tả có tiền tố op (`query: …`, `create: …`) như `git`; handler kiểm required theo op và báo lỗi nêu tên trường; schema root luôn là object phẳng, không `anyOf`.
4. Notion là ứng viên thử hợp đồng (nhiều op, cần secret, detect theo token), nhưng client web đã có connector Notion riêng; giá trị riêng chỉ là kết hợp file local và cho client local. Chưa có luồng dùng thật được ghi lại → cổng YAGNI do chủ mở.

#### K7. Tương thích và migration (3 lượt)

1. Đổi tên tool hiện có làm vỡ: prompt/tài liệu aiobox, README, CLAUDE.md, quyền "always allow" theo tên trên client, thói quen đã học của chủ. Lợi đổi lại ≤ ~1K token (K3.1). Không đáng.
2. Annotations + detect/enable không đổi tên nào → không breaking → minor `2.3.0`. Thay đổi hành vi nhìn thấy: ChatGPT bớt hỏi xác nhận cho tool đọc; tool của provider chưa cài biến mất.
3. Prompt có thể đang nhắc tool sẽ bị ẩn (vd. tài liệu aiobox dùng `aki__devtools_*` khi Chrome không phải do akimcp mở). Detect của provider trình duyệt phải là "có Chromium cài đặt", không phải "có phiên đang chạy", để không ẩn tool mà luồng attach vào Chrome của aiobox cần.

#### K8. Kiểm chứng (3 lượt)

1. Kiểm được bằng máy, miễn phí: kích thước `tools/list`, đủ annotations, độ dài description, tên trỏ chéo tồn tại, provider tắt thì tool vắng.
2. Kiểm độ chính xác của model cần chạy model thật, tốn quota → theo `agent.B3` phải hỏi chủ. Vì plan không đổi tên/shape tool cũ, không cần eval trước/sau cho tool cũ; chỉ cần cho provider mới đầu tiên (một bộ tác vụ nhỏ, chạy tay trên 2 client).
3. Hành vi client (xác nhận ChatGPT, nhóm quyền trên claude.ai, Notion ẩn agy/kiro) là quan sát thủ công, ghi vào `## Amendments` của doc này.

#### K9. Phản biện tổng (5 lượt)

1. Steelman phương án gom mạnh (36 → 17): các client local như Cursor từng có trần số tool; một bề mặt nhỏ dễ đọc hơn cho người; đổi tên sớm rẻ hơn đổi muộn. Phản: trần số tool của Cursor là lời kể chưa kiểm (unverified) và tổng 36 hiện chưa được ghi là gây lỗi ở client nào; detect/enable cũng giải quyết trần này mà không đổi tên. Mở lại nếu có client thật báo vượt trần.
2. Tấn công phương án chọn: annotations có thể làm chủ mất một lớp xác nhận mà chủ đang dựa vào để thấy AI đọc gì. Biết bằng cách: chủ xác nhận ở P1 trên ChatGPT trước khi release. Nếu chủ muốn giữ, có thể tắt bằng setting (không làm sẵn — YAGNI cho tới khi chủ nói).
3. Inversion — làm sao đảm bảo thất bại: gắn `readOnlyHint` theo cảm tính; ẩn provider theo "đang chạy" thay vì "đã cài"; đổi tên hàng loạt mà không grep aiobox; thêm provider mới không có test bề mặt. Plan chặn cả bốn bằng: quy tắc "bằng cơ chế" + test annotations, detect theo cài đặt, không đổi tên, test bề mặt bắt buộc.
4. Pre-mortem 6 tháng: "registry thành lớp gián tiếp thừa vì chỉ có 1 provider mới" — giảm bằng cách registry chỉ là một mảng + vòng lặp, không DSL. "provider sâu vượt 8 op và mô tả phình" — chặn bằng trần độ dài description trong test.
5. Hiệu ứng bậc hai: annotations cũng được gateway/hệ thống policy khác đọc (R2, blog MCP); gắn đúng giúp các client tương lai mà không tốn thêm. Detect làm `tools/list` khác nhau giữa các máy → hướng dẫn/prompt không được giả định mọi tool luôn có.

### Verification

- R1 measured qua client Notion, không phải byte server; R1 sẽ được thay bằng số đo server ở P0 (ghi vào Amendments).
- R2 có nguồn và ngày đọc; riêng ràng buộc root `anyOf` trên connector MCP của ChatGPT là unverified.
- R3 kiểm bằng grep/đọc mã tại `956d337`.
- Các tỷ lệ tiết kiệm khi gom (K3.1) là estimated.

### Corroborating links

- `docs/feat/tools.md` § When a tool earns its place, § Anchor
- `docs/plan/done/bridge-session-churn.md` (phiên chung)
- `docs/plan/IMPORTANT-shared-cdp-profiles.md`, `docs/plan/IMPORTANT-akimcp-aiobox-contract.md`
- aiobox `docs/plan/done/gpt-akimcp-connect-macro.md` dòng 120 (ChatGPT gắn cờ `Suspicious Instruction` cho `akidevrule_context`)

## Decision

- **Action:** [`docs/plan/done/provider-toolkit-architecture.md`](../plan/done/provider-toolkit-architecture.md) — giữ nguyên tên và shape của 36 tool; thêm annotations cho mọi tool; thêm provider registry với detect + bật/tắt; test bề mặt tool; hợp đồng shape cho provider mới (op phẳng, tách đọc/ghi).
- **Rejected/closed:** gom 36 → 17 bằng đổi tên; `{op, args}` lồng; `op=help`; cổng meta `aki__call`; alias tên cũ; auto-scan provider.
- **No action (kèm lý do):** rút gọn description `akidevrule_context` (lớn nhất, 1.634 ký tự) — load-bearing cho rule delivery, thuộc `docs/plan/rule-context-handshake.md` / `docs/arch/rule-context-delivery.md`; toolset theo client — bridge dùng phiên chung, chưa có nhu cầu đo được.
- **Reopen nếu:** `tools/list` đo được > ~40.000 ký tự; một client thật báo vượt trần số tool; quan sát được model chọn sai tool lặp lại; bridge có kênh server → client và client nghe `list_changed`.
- **Cross-references:** `docs/plan/repo-architecture-subtraction-reorg.md` (dời file), `docs/plan/done/interactive-and-env-tools.md` (đã bỏ 2026-10-04; tool mới đề xuất phải theo hợp đồng shape ở plan), `docs/feat/tools.md` (cần thêm mục annotations + providers khi ship).

## Amendments

- 2026-10-02 · P0 — số đo server thay R1: `JSON.stringify(tools/list .tools).length` = **27.207 ký tự** cho 36 tool (measured, `test/tool-surface.test.js`, trước annotations; gồm title, inputSchema đầy đủ với `$schema`/`additionalProperties`, nên lớn hơn 18.140 đo qua client Notion). Ước ~6.800 token (estimated, ~4 ký tự/token), vẫn dưới ngưỡng ~10K. Ngân sách test = 27.207 × 1,10 = 29.928. Lớn nhất: `akidevrule_context` 1.818, `agy_run` 1.566, `git` 1.322, `devtools_eval` 1.216, `run_cmd` 1.210. Chỉ `run_cmd` (description 905 ký tự) vượt trần 700 của Hợp đồng 4.3, ngoài `akidevrule_context` (1.273).
