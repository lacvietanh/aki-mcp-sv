# `agy_run`: nhận biết gói tài khoản, chạy lượt dài và mặc định theo agy 1.5.13+
> Tool names below use the default prefix `aki__` (`served(...)` in code follows the configured Tool prefix).

Status: draft 2026-11-21 — chờ Challenger (`P59·W7`) phản biện và Lead (`P59·W2`) chốt trước khi triển khai. Nguồn nhiệm vụ: `.akidevsync/notes.json` (`task-1795179091165`). Baseline đo trên `aki-mcp-sv` v4.2.0, `agy` live `1.5.14`, working tree `main` sạch.

## Mục tiêu (Goal chain — `think.B1`)

- **Mục tiêu trực tiếp:** Nâng cấp `scripts/agy-capabilities.js`, `scripts/agy-mcp.js`, `docs/ref/harness-fact.md` và bộ test cô lập để `agy_run` trả kèm tài khoản/gói/quota với cache theo tài khoản, thống nhất model mặc định Flash `-high`, báo lỗi lệch gói rõ ràng, chạy được lượt nghiên cứu dài > 120 s (≥ 6 phút) mà không phải vượt rào ra shell, và cập nhật mô tả tool đúng ngân sách `test/tool-surface.test.js`.
- **Mục tiêu trung gian:** Agent gọi `agy_run` nắm rõ tài khoản, gói và quota trước khi chọn model, không dính cache chéo khi đổi tài khoản, không bị ngắt oan ở mốc 120 s và nhận lỗi hành động được khi gọi model vượt gói.
- **Mục tiêu cuối cùng:** Giữ `agy_run` là nhánh ủy thác ổn định, không ghim danh sách model ID (`D7(a)`), OS-agnostic (`CLAUDE.md`), không phải vá code mỗi khi `agy` đổi model phía server.
- **Căng thẳng cần cân bằng:** Bổ sung năng lực (account/quota, chạy nền, hướng dẫn pro-tier + `BLOCKED`) trong khi `test/tool-surface.test.js` khóa cứng trần 700 ký tự/mô tả (`aki__agy_run` hiện ở **668 / 700**, chỉ dư 32 ký tự) và không tăng số lượng tool ngoài cần thiết.

## Hiện trạng đã kiểm chứng (Verified baseline — 2026-11-21)

| Hạng mục | Thực tế quan sát (`[obs]`) | Điểm gãy (`flow.B3`) |
|---|---|---|
| Phiên bản CLI | `agy --version` → `1.5.14` (vượt mốc `1.5.13` trong note); `docs/ref/harness-fact.md` còn ghi `1.4.7` (2026-10-25) | Tài liệu nền lệch phiên bản và thiếu nhóm Gemini 4 Neon/Hydrogen/Orchestrator |
| Nhận diện tài khoản | `agy models` và `agy -p "/usage" --output-format json` đều ghi `OAuth: authenticated successfully as <email>` vào `--log-file` (xác nhận live `<account-a@example.com>`); `~/.gemini/google_accounts.json` lại đang ghi `<account-b@example.com>` (lệch!) | Không được đọc `google_accounts.json` làm chân lý cho `agy`; `agy-capabilities.js` hiện dùng 1 biến `let cache = null` không gắn account |
| Dữ liệu gói & quota | `~/.gemini/antigravity-cli/aki-plan-tier/<email>` chứa 1 dòng (`"Google AI Pro"`, `"Antigravity Starter Quota"`); `rate-limits/<email>.frame` gồm dòng 1 `{"email", "userTier": {"name"}}` và dòng 2 `command.data.groups[]`; live `agy -p "/usage" --output-format json` tốn **0 token** (`usage.total_tokens: 0`), trả `groups[]` kèm danh sách model trong từng nhóm | `list="models"`/`"capabilities"` bỏ qua hoàn toàn account, plan tier và quota |
| Model mặc định | `agy-capabilities.js` dùng `newestFlashMedium` → `gemini-3.8-flash-medium`; `akidevrule` (`harness-facts.md` § Worker invocation quick-facts) quy định `gemini-3.8-flash-high` | Hai nguồn mâu thuẫn trên cùng tier khám phá |
| Timeout lượt chạy | `agy-mcp.js:33` khóa cứng `timeout: 120_000` (2 phút); lượt thật `gemini-4-neon-high` tốn 6 phút 17 giây | Agent buộc phải chạy `agy` ngoài `agy_run`, mất rào `allowedModes` và an toàn tham số `-p` |
| Ngân sách tool surface | `node test/tool-surface.test.js` đo full 38 tools = **36,759 / 37,922** ký tự (dư **1,163**); `aki__agy_run` tổng **1,988** ký tự, `description` **668 / 700** ký tự; `test/identity-served.test.js` so khớp `test/fixtures/surface-default-optin.json` | Chỉ dư 32 ký tự trong `description`; mọi chỉnh sửa phải nén câu lặp lại input trước khi bổ sung nội dung mới |

## Phân tích luồng bản địa (`flow.C3`)

1. **Flow target:** Chuỗi `list="models"/"capabilities"` → chọn model/chế độ → thực thi `agy_run` (đồng bộ hoặc nền) → kiểm tra kết quả/lỗi.
2. **Breakpoints hiện tại:** Cache toàn cục mù tài khoản; không hiển thị gói/quota; lỗi lệch gói trả về thông điệp thô từ CLI; timeout cứng 120 s cắt ngang lượt nghiên cứu dài; mô tả tool không phân biệt vai trò Flash (tìm/đọc) vs Pro (cố vấn 1 lượt) và thiếu nhắc `BLOCKED` + kiểm output rỗng.
3. **Root shape problems:** (a) Gộp thông tin biến động theo tài khoản/thời gian (account + quota) chung vòng đời với danh sách capability tĩnh theo tài khoản (1 giờ); (b) chỉ có một chế độ đồng bộ chặn luồng cho mọi độ dài tác vụ; (c) lặp nội dung schema trong `description` chiếm mất trần 700 ký tự.
4. **Native-flow redesign:** Tách trạng thái nhẹ (live active account + quota từ `/usage` 0-token, fallback `.frame` ≤ 6h) khỏi cache capability nặng theo khóa `account` (TTL 1h); xác thực model lệch gói bằng 1 lần refresh live chỉ khi model vắng mặt trong cache (0 overhead trên happy path); tái sử dụng hạ tầng `task_manage` chung cho chạy nền thay vì tạo thêm tool hoặc nhân đôi vòng đời tiến trình.

## Các quyết định thiết kế (D1–D7)

### D1. Nguồn tài khoản, gói, quota và khóa cache 1 giờ theo tài khoản (`scripts/agy-capabilities.js`)

- **Decided:** Khóa cache capability bằng `Map<accountKey, entry>` (key là `email.toLowerCase()`, hoặc `"__unknown__"` khi không xác định được email), giữ TTL 1h (`TTL_MS`) và retry 1 phút (`RETRY_MS`) trên từng tài khoản. Dùng `agy --log-file <tmp> --output-format json -p /usage` (0 token, tạo thư mục tạm `0o700` qua `os.tmpdir()`, xóa trong `finally`) làm nguồn chân lý cho tài khoản đang đăng nhập (trích dòng cuối `authenticated successfully as <email>`) và quota nhóm trực tiếp (`quotaSource: "live"`).
  - **Đọc `planTier`:** Đọc tại thời điểm gọi (`os.homedir()`, không cache ở import) từ `~/.gemini/antigravity-cli/aki-plan-tier/<sanitized_email>` (ký tự ngoài `[A-Za-z0-9@._+-]` thay bằng `_`, từ chối `..`/path separator, lọc giá trị theo `/^[A-Za-z0-9._+ -]{1,80}$/`); nếu thiếu thì đọc dòng 1 `userTier.name` trong `rate-limits/<sanitized_email>.frame`; không có cả hai → `null` (không suy đoán gói từ cấu trúc bucket theo `usage-antigravity.md` § Plan tier).
  - **Đọc `quota`:** Khi `list="models"` hoặc `list="capabilities"`, chạy live `/usage` lấy đồng thời `account` hiện hành và `quota` tươi, rồi tra `cacheByAccount.get(account)` — nếu **HIT** (< 1h) thì tái sử dụng `models`/`modes`/`efforts`/`outputFormats`/`version` không cần chạy lại `agy models`/`--help`/`--version`; nếu **MISS** (đổi tài khoản, lạnh, hết hạn) thì probe đủ 3 lệnh và lưu vào key `account`. Nếu live `/usage` lỗi/timeout, fallback đọc dòng 2 `rate-limits/<sanitized_email>.frame` chỉ khi `mtime` ≤ 6 giờ (`quotaSource: "frame"`, kèm `quotaAt`), quá 6 giờ → `quota: null`.
  - **Gọi `agy_run` thường (không `list`):** Trên cache nóng dùng `lastAccount` để tra nhanh (0 spawn thừa); trên cache lạnh chạy probe đầy đủ một lần; nếu `agy` báo lỗi giá trị/gói thì `refresh()` chạy lại `/usage` + `models` để bắt kịp trường hợp đổi tài khoản tức thì.
  - **Payload trả về:** Cả `list="models"` và `list="capabilities"` đều trả thêm `account`, `planTier`, `quota` (mảng nhóm `{ name, buckets: [{ id, window, remainingFraction, resetTime }] }` hoặc `null`), `quotaSource` (`"live" | "frame" | null`), `quotaAt`, `probedAt`.
- **Because:** Kiểm chứng live chứng minh `~/.gemini/google_accounts.json` lệch tài khoản thật của `agy` (`lacvietanh` vs `ntu43433`), còn `--log-file` trên `agy /usage` tốn 0 token và cho đồng thời email đang xác thực + quota nhóm chính xác trên cả macOS/Linux/Windows.
- **Rejected:** (a) Đọc `google_accounts.json` (sai sự thật trên máy thực tế); (b) cache 1 biến toàn cục hoặc chỉ đọc `lastAccount` khi gọi `list` (đổi tài khoản vẫn dính danh sách cũ tối đa 1h); (c) chạy `agy models` mỗi lần gọi `prompt` (tốn ~3–4 s thừa trên mọi lượt); (d) quét toàn bộ `~/.gemini/antigravity-cli/log/` (nhiễu do nhiều phiên tài khoản chạy song song).
- **Attack & giảm thiểu (`think.B3`):** Nếu `agy -p /usage` bị treo khi chờ migration (như ghi chú trong `get-antigravity-usage.sh:277`), áp timeout `PROBE_TIMEOUT_MS` (15 s) kèm kill cưỡng bức (`killSignal: 'SIGKILL'`) và fallback `.frame` ≤ 6h; không bao giờ log hoặc trả nội dung thô của temp log file (`coding.C4`).
- **Reopen if:** `agy` đổi định dạng log `authenticated successfully as` hoặc thêm subcommand nhẹ `agy whoami` / cờ xuất JSON chứa sẵn `email` và `planTier`.

### D2. Thống nhất model mặc định: chuyển sang Flash `-high` (`defaultFlashModel`)

- **Decided:** Đổi hàm chọn mặc định trong `scripts/agy-capabilities.js` từ `newestFlashMedium` sang `defaultFlashModel(models)` (tên theo vai trò — `pattern.A7`): chọn `gemini-<n>-flash-high` có phiên bản số lớn nhất (so sánh từng phần nguyên để `3.10 > 3.9`), fallback sang `gemini-<n>-flash-medium` chỉ khi phiên bản Flash mới không còn biến thể `-high`, cuối cùng trả `null` (bỏ `--model` để `agy` tự chọn). Ghi đè `setting.json → agy.defaultModel` vẫn ưu tiên cao nhất.
- **Because:** Khớp 100% luật owner trong `akidevrule` (`harness-facts.md` § Worker invocation quick-facts: `gemini-3.8-flash-high`), giữ một nguồn sự thật duy nhất (`pattern.A1`), chạy được trên mọi gói kể cả Free/Starter, và chỉ sửa trong 1 repo (`aki-mcp-sv`) thay vì kéo dây chuyền đổi `AkiDevRule` + cài lại mọi harness. Không còn caller ngoài nào gọi `newestFlashMedium` ngoài `agy-mcp.js` và `test/agy-capabilities.test.js`.
- **Rejected:** Giữ `flash-medium` ở AkiMCP và sửa `akidevrule` xuống `medium` (làm giảm độ chính xác thu thập của lane discovery và tạo sửa chéo 2 repo).
- **Reopen if:** Owner đổi chuẩn discovery trong `akidevrule` sang tier khác (ví dụ `flash-medium` hoặc `flash-lite`).

### D3. Phát hiện & báo lỗi lệch gói rõ ràng mà không ghim danh sách model ID

- **Decided:** Giữ nguyên nguyên tắc không ghim model ID cụ thể trong code (`D7(a)`). Dùng bảng quy tắc nhỏ theo **họ model** (family pattern, không phải exact versioned ID) trong `scripts/agy-capabilities.js` — hàm `explainMissingModel(modelId, caps)`:
  - `/carbon/i` → `['Google AI Ultra']`
  - `/gemini-4-|argon|neon|hydrogen|orchestrator/i` → `['Google AI Pro', 'Google AI Ultra']`
  - `/flash/i`, `/^claude-|^gpt-oss/i` → `['Free / Antigravity Starter Quota', 'Google AI Pro', 'Google AI Ultra']`
- **Luồng kiểm tra (`flow.B6`):**
  1. Khi caller truyền `model` tường minh và `caps.models` hiện có (nếu đã nạp) **không chứa** `model`, gọi `refresh()` 1 lần trước khi spawn (đảm bảo không từ chối oan nếu tài khoản vừa nâng gói/đổi tài khoản, đồng thời chặn ngay cả nhánh chạy nền trước khi tạo task chết!).
  2. Nếu sau `refresh()`, `caps.models` khác `null` và vẫn không chứa `model`:
     - Khi họ model khớp bảng gói (ví dụ `gemini-4-neon-high` trên `Antigravity Starter Quota`, hoặc `gemini-4-carbon-high` trên `Google AI Pro`): trả lỗi rõ: `Plan "<planTier hoặc unknown>" (account: <account>) does not include model "<model>". Available on plans: <danh sách gói>. Models available on this account now: <live model ids>. next: switch account/plan or call agy_run with list="capabilities".`
     - Khi không khớp họ gói (ví dụ gõ sai chính tả `gemini-99-foo`): trả lỗi từ chối kèm danh sách live hợp lệ như `runWithValueHelp` hiện tại.
  3. Khi `caps.models === null` (probe hỏng): pass-through thẳng sang `agy` như hiện tại; nếu `agy` trả lỗi liên quan model/gói (mở rộng `VALUE_COMPLAINT` thêm `not available|not found|plan|tier|entitlement`), `runWithValueHelp` gọi `refresh()` và áp cùng `explainMissingModel()`.
- **Because:** 0 độ trễ cộng thêm trên happy path (model nằm sẵn trong cache); 0 từ chối oan do cache cũ (luôn xác minh bằng 1 lần `refresh()` trước khi báo lỗi); báo chính xác tên gói hiện tại, model bị từ chối và các gói có hỗ trợ, áp dụng thống nhất cho cả đồng bộ lẫn chạy nền.
- **Rejected:** (a) Ghim cứng map từng model ID vào từng gói (vi phạm `D7(a)`, vỡ ngay khi `agy` đổi số phiên bản); (b) chỉ chặn trên cache cũ không refresh (chặn oan sau khi đổi tài khoản); (c) để `agy` tự chạy nền rồi mới phát hiện lỗi lệch gói sau vài giây trong log.
- **Reopen if:** `agy` tự trả cấu trúc lỗi JSON chuẩn chứa `required_tier`/`current_tier` (khi đó bỏ bảng family pattern và chuyển tiếp trực tiếp từ CLI).

### D4. Hỗ trợ lượt dài > 120 s: tái sử dụng `task_manage` cho chạy nền + `timeoutSec` cấu hình được

- **Decided:** Không tạo tool mới (`aki__agy_task`). Mở rộng `agy_run` với đúng **2 tham số tùy chọn**:
  1. `background?: boolean` (mặc định `false`): chạy `agy` tách tiến trình nền (`detached: true`, `windowsHide: true`, dùng trực tiếp mảng `args` không qua `Shell.parse` để giữ nguyên bảo vệ trích dẫn `-p` và allowlist `allowedModes`). Mặc định ép `outputFormat = 'json'` khi caller không truyền `outputFormat` để kết quả nền luôn có `usage`, `duration_seconds`, `num_turns`, `status`.
     - **Tách luồng stdout/stderr:** Ghi stdout vào `task-logs/<taskId>.log` và stderr vào `task-logs/<taskId>.err.log` để dòng tiến trình trên stderr (`"Fetching available models..."`, cảnh báo CLI) không làm hỏng payload JSON trên stdout.
     - **Dùng chung sổ task (`tasks.json`):** Tách phần lưu trữ/vòng đời tiến trình nền dùng chung (export helper sạch từ `scripts/task-mcp.js` hoặc `scripts/task-store.js`) để `agy_run` đăng ký bản ghi `kind: 'agy'` (kèm `model`, `mode`, `errLogFile`). Khi tiến trình `agy` thoát (`exit`), handler đọc giới hạn `<taskId>.log`: nếu stdout rỗng với exit 0 thì đánh dấu `status: 'failed'` + `emptyOutput: true` (bảo toàn bất biến chống silent-denial!); nếu là JSON hợp lệ thì trích tóm tắt `agySummary: { status, durationSeconds, numTurns, usage, responseChars }` lưu vào bản ghi task.
     - **Theo dõi qua `aki__task_manage`:** Caller dùng `task_manage` sẵn có (`status` trả kèm `agySummary` + `emptyOutput` + `errLogSize`; `tail_logs` đọc sạch stdout JSON tối đa 1 MB; `stop` dừng cả cây tiến trình đa nền tảng; `list`/`delete` dọn cả `.log` và `.err.log`). Nếu provider `task` đang bị tắt trong `setting.json`, `background: true` từ chối rõ ngay trước khi spawn (`"rejected: background mode requires the task provider (task_manage) to be enabled"`).
     - **Phản hồi khi khởi chạy:** Trả JSON `{ taskId, pid, status: "running", model, mode, outputFormat, cwd, logFile, errLogFile, next: "poll with aki__task_manage action=status/tail_logs/stop" }`.
  2. `timeoutSec?: number` (số nguyên `10..600`, mặc định `120`): cho phép caller tăng timeout đồng bộ lên tối đa 600 s (khớp trần `MCP_REQUEST_TIMEOUT_MS` 10 phút); vượt 600 s bị schema từ chối và chỉ dẫn dùng `background: true`.
- **Because:**
  - Client MCP web/HTTP thường cắt kết nối đồng bộ ở 60–180 s, nên chỉ tăng `timeoutSec` không giải quyết được lượt 6 phút 17 giây; `background: true` là bắt buộc.
  - Tái sử dụng `task_manage` tránh nhân đôi máy trạng thái `status`/`tail`/`stop`/`delete` (`pattern.A1/A5`), giữ nguyên `readOnlyHint: true` của `agy_run` khi `allowedModes = ['plan']` (vì `stop`/`delete` vẫn nằm sau cổng `receipt` của `task_manage`, bảo toàn `test/tool-surface.test.js:78`), không đổi số tool 38 trên `README.md` (`D7(b)`), và tiết kiệm ~900 ký tự trên `tools/list`.
  - Refactor `killProcessGroup` trong `task-mcp.js` thành bảng dữ liệu theo `process.platform` (`KILL_PROCESS_GROUP`) để tuân thủ tuyệt đối quy tắc OS-agnostic của `CLAUDE.md`.
- **Rejected:** (a) Thêm tool mới `aki__agy_task` (tăng ~1,000 ký tự sát trần budget, phá số lượng 38 tools, trùng chức năng `task_manage`); (b) nhồi `taskAction: status|tail|stop|delete` vào `agy_run` (phá `readOnlyHint: true` và phân mảnh 2 kho task); (c) trộn stdout + stderr chung một file log (làm hỏng `JSON.parse` trên kết quả `--output-format json`).
- **Second-order effect (`think.B3`):** Khi server AkiMCP khởi động lại giữa lúc task `agy` chạy nền đã kết thúc, `exit` listener không chạy nên `agySummary` chưa được trích sẵn — khắc phục bằng cách để `task_manage action="status"` khi phát hiện bản ghi `kind: 'agy'` vừa chuyển `running → exited` (PID không còn sống) tự trích `agySummary` / `emptyOutput` lười một lần từ `logFile` rồi lưu lại!
- **Reopen if:** `agy` bổ sung hỗ trợ resume/stream MCP native hoặc `task` provider bị tách khỏi mặc định.

### D5. Mô tả tool `agy_run`, ngân sách `test/tool-surface.test.js` và tác động reconnect

- **Decided:** Viết lại `describe(modes)` trong `scripts/agy-mcp.js` súc tích hơn (cắt phần lặp lại tham số `inputSchema`), đạt đủ 4 yêu cầu của hạng mục (4), giữ tuyệt đối `D7(a)` (không tên model ID), không vượt trần 700 ký tự và không cần tăng `BUDGET_CHARS`:
  - Bản nháp `describe(['plan'])` (**573 ký tự**, giảm **95 ký tự** so với 668 hiện tại; dư **127 ký tự** dưới trần 700):
    ````text
    Delegate to local agy CLI. Flash tier (default: newest Flash high, override agy.defaultModel): retrieval/reading only, never judgment. Pro-tier models: single-turn advisory with mode="plan" when the active plan includes them (verify via list="capabilities", which returns account/tier/quota). Default mode: "plan" (read-only by mechanism). Include a BLOCKED-on-tool-failure clause in prompt and treat empty output as silent denial. Long runs (>2m): set background=true and track via aki__task_manage. Name exact paths (agy resolves outside cwd); prompt is one verbatim arg.
    ````
  - Kiểm tra quy tắc tự động của `test/tool-surface.test.js`:
    - Regex `MODEL_ID_SHAPE = /gemini-\d|claude-(sonnet|opus|haiku)-\d|gpt-oss/i`: **0 khớp** (đạt `D7(a)`).
    - Tham chiếu `served('task_manage')` → `aki__task_manage`: tool có đăng ký (đạt cross-ref check).
    - Khi `allowedModes` mở rộng (ví dụ `['plan', 'accept-edits']`), `modeClause` dài hơn ~32 ký tự → tổng ~605 ký tự, vẫn dưới 700.
- **Tính toán chênh lệch ký tự trên `tools/list` (so với baseline 2026-11-21):**

| Thành phần | Hiện tại (ký tự) | Dự kiến sau đổi (ký tự) | Chênh lệch |
|---|---:|---:|---:|
| `aki__agy_run.description` | 668 | ~573 | -95 |
| `list` param description (thêm account/tier/quota) | 66 | ~90 | +24 |
| `background` param mới (schema + description) | 0 | ~145 | +145 |
| `timeoutSec` param mới (schema + description) | 0 | ~162 | +162 |
| **Tổng `aki__agy_run` JSON** | **1,988** | **~2,224** | **+236** |
| **Full surface (38 tools) vs `BUDGET_CHARS` (37,922)** | **36,759 (dư 1,163)** | **~36,995 (dư ~927)** | **+236 (không cần tăng budget)** |

- **Tác động reconnect & fixture (`CHANGELOG` convention):**
  - **Tool definition CÓ thay đổi** đối với riêng `aki__agy_run` (đổi `description`, thêm 2 param tùy chọn `background`, `timeoutSec`). Client đang bật provider `agy` cần làm mới danh sách tool (reconnect / Refresh) để thấy tham số mới và mô tả mới; client áp Always-Allow theo hash schema có thể cần duyệt lại riêng `aki__agy_run`.
  - 37 tool còn lại **không đổi byte nào** (`test/fixtures/surface-default.json` và `surface-default-aiobox.json` giữ nguyên vì `agy` là opt-in). Riêng `test/fixtures/surface-default-optin.json` phải chạy lại `node test/fixtures/record-surface.js --opt-in` để khớp `test/identity-served.test.js`.

### D6. Cập nhật `docs/ref/harness-fact.md` và đồng bộ `docs/feat/tools.md`

- **Decided:** Cập nhật `docs/ref/harness-fact.md` (đổi tem `> updated 2026-11-21 · v4.2.0` theo `docs.A4`):
  - Nâng tiêu đề mục từ `agy 1.4.7` lên `agy 1.5.13+` (ghi rõ snapshot kiểm chứng live trên `agy 1.5.14`, 2026-11-21).
  - Bổ sung các hàng hành vi ổn định mới: nhận diện email từ `--log-file` (và ghi chú cảnh báo `google_accounts.json` không đáng tin cho `agy`), nguồn `aki-plan-tier` / `.frame`, `agy -p "/usage" --output-format json` 0-token, cache theo tài khoản, mặc định Flash `-high`, chạy nền tách stdout/stderr qua `task_manage`, kiểm lệch gói theo họ model, và nhắc clause `BLOCKED`.
  - Thêm bảng **Gói ↔ Họ model & Nhóm quota** (tính tới 2026-11-21, tham chiếu chéo `Aki-Dev-Sync/docs/ref/fact-antigravity-quota-tiers.md`, ghi rõ nhãn `[obs]` cho Starter/Pro và `[owner]` cho Ultra/Carbon vì chưa probe trực tiếp tài khoản Ultra), kèm lưu ý giữ nguyên nguyên tắc **không ghim danh sách model ID trong code tool**.
  - Cập nhật khối *Probe example* sang snapshot live `agy 1.5.14` (22 model trên Pro + các cờ mới trong `agy --help`).
  - Đồng bộ hàng `agy_run` trong `docs/feat/tools.md` (`docs.B3`) và cập nhật mục trong `docs/index.md` ở P4.

### D7. Rủi ro, đánh giá tỷ lệ (`proportion.A–C`) và biên giới kiểm thử (`test.A–C`)

| Rủi ro / Bảo vệ | Reach · Capability · Motive · Blast radius (tagged) | Bậc kiểm soát (`proportion.B3`) | Reopen trigger |
|---|---|---|---|
| Lộ log OAuth thô từ `--log-file` | Local MCP caller · đọc output tool · thấp · **rò rỉ thông tin phiên/tài khoản (không đảo ngược)** *(estimated)* | **Rung 2 (security floor `coding.C4`):** temp dir `0o700`, chỉ trích regex email hợp lệ, xóa file trong `finally`, không bao giờ trả log thô | `agy` đổi nơi ghi log hoặc cơ chế auth |
| Path traversal khi ghép tên file `<email>` vào `aki-plan-tier/` hoặc `rate-limits/` | Log CLI bị biến dạng/nhiễu · thấp · thấp · đọc nhầm file ngoài thư mục *(estimated)* | **Rung 1 (impossible by shape):** chỉ giữ `[A-Za-z0-9@._+-]` và kiểm `path.resolve` nằm trong thư mục đích | Thay đổi cấu trúc lưu trữ của `aki-plan-tier` |
| Treo vô hạn khi caller truyền `timeoutSec` quá lớn hoặc `agy /usage` treo migration | Caller hợp lệ / lỗi cấu hình · thường · không · giữ tiến trình & RAM *(estimated)* | **Rung 2:** Zod khóa `timeoutSec` `10..600`; probe `/usage` có timeout 15 s + `SIGKILL` | `MCP_REQUEST_TIMEOUT_MS` đổi trần |
| Lỗi `JSON.parse` khi `agy` in tiến trình ra stderr trong chế độ chạy nền | Mọi lượt `background=true` *(measured: `agy models` in stderr)* · thường · không · hỏng đọc `usage`/`response` | **Rung 1 (impossible by shape):** tách riêng `<taskId>.log` (stdout) và `<taskId>.err.log` (stderr) | `agy` đổi kênh xuất JSON |
| Test chạm `~/.gemini` thật hoặc gọi `agy` thật | Mọi lần chạy `npm test` *(measured)* · tự động · không · làm bẩn dữ liệu chủ máy hoặc tốn quota | **Rung 1 (`test.B1/B2`):** `import './setup.js'` đầu tiên ở mọi file test; mọi đọc `~/.gemini` tính từ `os.homedir()` tại call time; fake `spawn` / node stub cô lập, dọn sạch trong `finally` | Thêm test file mới không import `setup.js` |

## Các pha triển khai (Phases P1–P5)

- [x] **P1 — Capability, Account/Tier/Quota & Cache theo tài khoản (`scripts/agy-capabilities.js`):**
  - Bổ sung `parseAuthEmail`, `parseUsageJson`, `readLocalPlanTier`, `readLocalQuotaFrame`, `defaultFlashModel` (Flash `-high`, fallback `-medium`), `explainMissingModel` (bảng họ model ↔ gói).
  - Chuyển cache sang `Map<accountKey, entry>` (TTL 1h, retry 1 phút), tích hợp probe `agy --log-file <tmp> --output-format json -p /usage` với dọn temp dir trong `finally` và fallback `.frame` ≤ 6h.
  - Tiêu chí xong: hàm thuần + cache theo account vượt toàn bộ test đơn vị cô lập (không chạm `~/.gemini` thật, không gọi `agy` thật).

- [x] **P2 — Hạ tầng chạy nền dùng chung & OS-agnostic (`scripts/task-mcp.js` + helper dùng chung nếu gọn):**
  - Chuyển `killProcessGroup` sang bảng map theo `process.platform` (xóa nhánh `if (win32)` nghiệp vụ theo `CLAUDE.md`).
  - Export hàm khởi chạy/ghi nhận tiến trình nền hỗ trợ tách `logFile` (stdout) + `errLogFile` (stderr), hook `onExit` trích `agySummary`/`emptyOutput`, và lazy-extract trong `task_manage action="status"` khi server restart sau lúc tiến trình đã thoát; `delete` dọn cả `.err.log`.
  - Tiêu chí xong: `node test/task-mcp.test.js` và `node test/trusted-zone.test.js` giữ nguyên xanh 100%.

- [x] **P3 — Nâng cấp `scripts/agy-mcp.js` (mô tả mới, kiểm lỗi gói, `background`, `timeoutSec`):**
  - Cập nhật `resolveModel` sang `defaultFlashModel`, bổ sung kiểm lệch gói (1 lần `refresh()` khi model tường minh vắng mặt) cho cả đồng bộ và chạy nền, mở rộng `VALUE_COMPLAINT`.
  - Thêm `background` (mặc định `outputFormat: 'json'`, kiểm `providerServed('task')`) và `timeoutSec` (`10..600`, mặc định `120`).
  - Cập nhật `describe(modes)` (~573 ký tự, không model ID, nhắc Flash tìm/đọc + Pro cố vấn 1 lượt `--mode plan` + điều kiện gói + `BLOCKED` + kiểm output rỗng + hướng dẫn `background`/`task_manage`).
  - Tiêu chí xong: `list="models"/"capabilities"` trả đủ `account`, `planTier`, `quota`; chạy đồng bộ và chạy nền cùng bảo toàn ràng buộc `-p` cuối cùng và `allowedModes`.

- [x] **P4 — Tài liệu & Surface fixtures (`docs/ref/harness-fact.md`, `docs/feat/tools.md`, `docs/index.md`, `test/fixtures/surface-default-optin.json`):**
  - Cập nhật `docs/ref/harness-fact.md` lên `agy 1.5.13+` (probe live `1.5.14`) + bảng gói ↔ họ model (tem `updated 2026-11-21 · v4.2.0`).
  - Đồng bộ hàng `agy_run` trong `docs/feat/tools.md` và mục plan trong `docs/index.md`.
  - Chạy `node test/fixtures/record-surface.js --opt-in` để cập nhật `surface-default-optin.json`; kiểm chứng `surface-default.json` và `surface-default-aiobox.json` không đổi.

- [x] **P5 — Bộ test cô lập & Kiểm chứng cuối (`test/agy-capabilities.test.js`, `test/agy-mcp.test.js`, `test/tool-surface.test.js`):**
  - Mở rộng `test/agy-capabilities.test.js` (Flash `-high` + fallback `-medium`, parse email/usage, đọc `aki-plan-tier`/`.frame` trong `HOME` cô lập, TTL 6h của `.frame`, cô lập cache giữa 2 tài khoản, `explainMissingModel` cho Starter/Pro/typo).
  - Thêm `test/agy-mcp.test.js` (dòng đầu `import './setup.js'`): dùng fake `agy` stub qua `process.execPath` (chạy được trên mọi OS) kiểm `list`, báo lỗi lệch gói, `timeoutSec`, `background=true` → `task_manage` `status` (có `usage` + `durationSeconds`), `tail_logs` (JSON sạch không dính stderr), silent-denial `emptyOutput: true`, và `stop` không sót tiến trình.
  - Chạy kiểm chứng toàn bộ: `node test/agy-capabilities.test.js`, `node test/agy-mcp.test.js`, `node test/tool-surface.test.js`, `node test/identity-served.test.js`, `node test/surface-no-aiobox.test.js`, `node test/task-mcp.test.js`, rồi `npm test` + kiểm tra `git status --porcelain` sạch file rác sau test (`test.B3`).
  - Kiểm chứng live không tốn quota (rung 5): gọi `agy_run list="capabilities"` trên máy thật xác nhận trả đúng `account`, `planTier`, `quota` nhóm thực tế.

## Câu hỏi / điểm mở cần Challenger (`P59·W7`) soi kỹ

1. **Tái sử dụng `task_manage` (D4) vs tham số poll riêng trên `agy_run`:** Nếu một máy chủ cố tình tắt provider `task` nhưng bật `agy`, từ chối rõ `background=true` yêu cầu bật `task` có chấp nhận được không, hay nên cho phép poll đọc-only riêng trong `agy_run`?
2. **Chi phí 1 lệnh `agy /usage` (~2–4 s, 0 token) mỗi lần gọi `list="models"/"capabilities"` (D1):** Có nên đặt thêm micro-TTL ngắn (ví dụ 30 s) cho `/usage` hay luôn đọc tươi khi caller chủ động gọi `list`?
3. **Thống nhất Flash `-high` (D2):** Xác nhận hoàn toàn không cần giữ alias tương thích `newestFlashMedium` vì toàn repo không còn chỗ nào gọi.

---

## Chốt phản biện Pre-Implementation Audit (Challenger `P59·W7` + Lead `P59·W2`, 2026-11-21)

Trạng thái: **PASS WITH FIXES — đã phê duyệt triển khai P1–P5** với toàn bộ chốt điểm mở (Q1–Q3), 5 bản vá Blocking (B1–B5) và 5 Nit (N1–N5) sau đây (ưu tiên cao hơn mọi mô tả nháp ở mục D1–D7 phía trên khi có khác biệt):

### Chốt 3 điểm mở (Q1–Q3)
- **Q1 (Provider `task` bị tắt khi gọi `background: true`):** Từ chối ngay trước khi spawn thông qua dynamic import `(await import('./provider-registry.js')).providerServed('task')`, hướng dẫn bật provider `task` ở Control Panel mục 4 hoặc dùng chế độ đồng bộ với `timeoutSec` (≤ 600 s). **Không** thêm nhánh poll trong `agy_run`.
- **Q2 (Độ tươi `agy /usage`):** Áp dụng micro-TTL **30 giây** (`USAGE_TTL_MS = 30_000`) cho kết quả probe `/usage`, và **bỏ qua micro-TTL** khi gọi `refresh()` sau lỗi hoặc khi ép làm mới.
- **Q3 (`newestFlashMedium`):** **Bỏ sạch** export `newestFlashMedium`, không giữ alias tương thích ngược; cập nhật toàn bộ caller nội bộ (`scripts/agy-mcp.js`), test (`test/agy-capabilities.test.js`) và `docs/ref/harness-fact.md` sang `defaultFlashModel`.

### 5 bản vá Blocking (B1–B5)
- **B1 (`VALUE_COMPLAINT` trong `scripts/agy-mcp.js`):** Không thêm từ trần `plan` hay `not found` (tránh bắt nhầm `Command failed: agy --mode plan ...` ở `test/agy-capabilities.test.js:90`). Neo chặt ngữ cảnh model/gói:
  `/invalid (?:model|effort|output)|not a valid|unsupported|conflicts with --|unknown (?:model|effort|output|option|flag)|model.{0,40}(?:not available|not found|requires|plan|tier|entitlement)|(?:plan|tier|entitlement).{0,40}model/i`.
  Bắt buộc có test xác nhận chuỗi chứa `--mode plan` cho kết quả `false` và lỗi lệch gói thật cho kết quả `true`.
- **B2 (Đổi tài khoản Pro → Starter trong cửa sổ cache 1 giờ):** Khi gọi `background: true` kèm `model` tường minh, bắt buộc xác minh tài khoản đang sống qua `probeUsage` (dùng micro-TTL 30 s nên tốn 0 s nếu vừa gọi `list`) trước khi tra cache theo tài khoản; nếu `model` không có trong danh sách của tài khoản sống thì `refresh()` 1 lần và chặn ngay trước khi spawn tiến trình nền.
- **B3 (`explainMissingModel`):** Cắt bỏ dòng 3 (`/flash/i`, `/^claude-|^gpt-oss/i`), chỉ giữ các họ model bị khóa theo gói (`carbon` → `Google AI Ultra`; `^gemini-4-|argon|neon|hydrogen|orchestrator` → `Google AI Pro`, `Google AI Ultra`). Chỉ phát thông báo lệch gói khi `planTier === null` hoặc `planTier` **không thuộc** mảng `plans` yêu cầu; nếu gói hiện tại đã thuộc `plans` (vd Pro nhưng gõ nhầm tên model) thì rơi về báo sai tên model kèm danh sách `caps.models` live.
- **B4 (Vòng đời `background: true` × `task_manage` × `readOnlyHint: true`):**
  - **(4a) Idempotent lazy-extract:** Điều kiện trích `agySummary` là `(task.kind === 'agy' && !alive && !task.agySummaryExtracted)` — không bám cạnh chuyển `running → exited` (vì `task_manage action="list"` có thể đổi `status` sang `exited` trước khi gọi `status`). Chỉ `JSON.parse` khi `task.outputFormat === 'json'` và kích thước log stdout `<= 4 MB` (`4 * 1024 * 1024` byte); ghi `agySummaryExtracted: true` sau khi xử lý.
  - **(4b) Timeout nền, trần đồng thời & ngoại lệ `readOnlyHint: true`:** `background: true` luôn truyền `--print-timeout <sec>` (mặc định `1800` s; cho phép `timeoutSec` tối đa `1800` s khi đi kèm `background: true`, từ chối rõ nếu vượt trần `600` s ở đồng bộ hoặc `1800` s ở chạy nền). Áp trần tối đa **4 task `kind: 'agy'` chạy nền đồng thời**. Ngoại lệ `readOnlyHint: true` (chỉ ghi tệp bookkeeping/log trong `USER_DIR`, tuyệt đối không ghi vào repo khi `mode="plan"`) được ghi rõ trong tài liệu kế hoạch này và trong `docs/feat/tools.md`.
  - **(4c) `errTail` và mô tả `task_manage`:** Trong `task_manage action="status"`, khi `errLogSize > 0` trả kèm `errTail` (≤ 2 KB cuối của `.err.log`, đi qua `redactText` / `redactResult`). Đồng bộ mô tả `task_manage` ở `scripts/task-mcp.js` và tái tạo các snapshot bề mặt tương ứng (`surface-default.json`, `surface-default-aiobox.json`, `surface-default-optin.json`); ghi rõ trong `CHANGELOG.md` ảnh hưởng reconnect cho cả `task_manage` và opt-in `agy_run`.
- **B5 (Probe `/usage` & khóa schema thực tế):**
  - **(5a) Không double-spawn ở lệnh `list`:** Truyền thẳng `caps` đã probe vào `resolveModel(explicit, cwd, caps)` để `list="models"`/`"capabilities"` gọi `capabilities()` đúng 1 lần.
  - **(5b) Chạy `/usage` an toàn & OS-agnostic:** Dùng `spawn` với `cwd: os.tmpdir()`, `stdio: ['ignore', outFd, 'ignore']` ghi vào file trong thư mục tạm `0o700`, `detached: true` trên POSIX (bỏ qua trên Windows bằng bảng nền tảng, không rẽ nhánh nghiệp vụ), và dừng cả process group khi quá `PROBE_TIMEOUT_MS` (15 s) qua helper `killProcessGroup` dùng chung; bọc `try/catch` quanh `fs.rmSync(tmpDir, { recursive: true, force: true })` trong `finally`.
  - **(5c) Schema JSON live đã xác minh (0 token, `agy 1.5.14`, 2026-11-21):**
    - Live `agy -p "/usage" --output-format json`: `parsed.command.data.groups[]` gồm `{ name, description?, buckets: [{ id, name?, description?, window, remaining_fraction, reset_time }] }`, chuẩn hóa sang `{ name, buckets: [{ id, name?, window, remainingFraction, resetTime }] }`.
    - File local `~/.gemini/antigravity-cli/rate-limits/<email>.frame`: dòng 1 `{"email":"...","userTier":{"name":"..."}}`, dòng 2 `{"command":{"name":"usage","data":{"groups":[...]}}}` (cùng cấu trúc `buckets` với `remaining_fraction` và `reset_time`).
    - File local `~/.gemini/antigravity-cli/aki-plan-tier/<email>`: 1 dòng văn bản thuần (vd `Google AI Pro`, `Antigravity Starter Quota`).

### 5 Nit (N1–N5)
- **N1:** Dùng dynamic import `providerServed('task')` tránh circular import; dùng `served('task_manage')` / `served('agy_run')` từ `./mcp-name.js` trong mọi mô tả và câu gợi ý runtime (không viết cứng `aki__`).
- **N2:** Không lưu toàn bộ prompt dài vào `tasks.json`; chỉ lưu chuỗi tóm tắt ngắn `agy --mode <mode> [--model <id>] (prompt: <N> chars)`.
- **N3:** Đọc file `aki-plan-tier/<email>` và `rate-limits/<email>.frame` theo cách OS-agnostic: thử nguyên chữ hoa/thường của email trước rồi fallback `.toLowerCase()`, kiểm biên bằng `containedIn` từ `scripts/roots.js`, kiểm giới hạn dung lượng trước `readFileSync` (`.frame <= 256 KB`, file tier `<= 4 KB`).
- **N4:** Đồng bộ cả 2 hàng `agy_run` và `task` trong `docs/feat/tools.md`, cập nhật `docs/ref/harness-fact.md` (không ghim model ID trong code), `docs/index.md`, và mục `[Unreleased]` trong `CHANGELOG.md`.
- **N5:** Lưu ý vận hành: thay đổi `agy.allowedModes` trong `setting.json` vẫn cần khởi động lại AkiMCP để vẽ lại mô tả và `readOnlyHint` của `agy_run` (`scripts/agy-mcp.js:83`).
