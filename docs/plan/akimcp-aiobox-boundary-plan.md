# Plan · Ranh giới AkiMCP ⇄ AIObox — bản chốt cuối (2026-10-07)

Status: Decided bởi hội đồng akiflow + phiên repo AIObox (`aiobox-4a`). B1 (AkiMCP) đã code xong trong working tree ngày 2026-10-07 (phòng `~/.aki/agent-council/aki-mcp-sv/2026.10.07-1549-b1-boundary-execute/`), chưa chạy test, chưa phát hành; A1 do phiên `aiobox-4a` làm. Chủ máy duyệt toàn bộ ngày 2026-10-07 ("okay. đồng ý hết"), gồm cổng R7 ở §8. Git, build Rust và phát hành làm trên Mac theo §10. Chủ máy bác bất kỳ mục nào bằng đúng một chỗ sửa ghi ở dòng "Bác bằng" của mục đó.
Session: `~/.aki/agent-council/aki-mcp-sv/2026.10.07-1452-akimcp-aiobox-boundary/` (chat.md = toàn bộ tranh luận, checklist.md = sổ yêu cầu và mục). Ghế: judge-boundary (chuẩn pattern), judge-proportion (chuẩn proportion), judge-worldview (chuẩn docs), challenger, aio (phiên repo aiobox), conduct (quy trình). Cổng `council_verify` 7/7 PASS. Chi phí (đồng hồ Claude của phiên này, gồm cả lượt rà trước hội đồng; phiên aio tính riêng): Opus 1,07M input + 27,3M cache_read + 0,39M output; Sonnet 4,46M input + 40,3M cache_read + 0,19M output; Haiku 0,04M.
Thay thế trong `docs/plan/akimcp-tool-refactor.md` (kế hoạch tái cấu trúc tool trước đó): D14a (một tool), D14c (`{protocol:n}`), D14d (stub `aiobox_write` tới 4.0), D14f (self-target/expect/handle sang AIObox). Giữ: D14b (deadline trong phong bì), D14e (eval/screenshot sang `devtools_*`), D14g (AIObox ghi `canTakeChat`).
Luật ranh giới gốc vẫn ở aiobox `docs/arch/akimcp-boundary.md` (doc ranh giới phía AIObox: S-1..S-3, BR-1..BR-9). Khi xong, các quyết định dưới đây chuyển vào doc đó và hợp đồng T1 (`docs/plan/IMPORTANT-akimcp-aiobox-contract.md`, bản chung hai repo), rồi file này sang `done/`. Repo AIObox chỉ giữ con trỏ tới file này, không chép lại.

## 1. Lời chủ máy (nguyên văn) và sổ yêu cầu

- A: "…vạch ra cho tôi biết đang có những gì bên akimcp và aiobox để định nghĩa trong luồng hiểu biết, thế giới quan của LLM khi làm việc với akimcp có aiobox và không có aiobox. tôi sẽ xác định lại ranh giới. tôi muốn akimcp một bản này chứa đầy đủ mọi thứ cốt lõi nhất khi giao tiếp với aiobox, còn những thứ có thể linh hoạt thay đổi sau này phía bên aiobox thì không buộc phải thay đổi bên akimcp…"
- B: "tôi chưa đọc hết 1 2 3 4 nhưng những đề xuất trong điều 5 tôi hoàn toàn đồng ý"
- C: "…bàn kỹ, load các akirule và method cần thiết, qua các agent cần thiết, để tự chốt với nhau, rồi cho tôi bản kế hoạch cuối cùng"
- REQ-1 file sót · REQ-2 kiểm kê hai bên · REQ-3 thế giới quan LLM có/không AIObox · REQ-4 AkiMCP một bản chứa đủ lõi · REQ-5 AIObox đổi không buộc AkiMCP đổi · REQ-6 năm đề xuất điều 5 là đầu vào cố định · REQ-7 có phiên AIObox · REQ-8 tự chốt · REQ-9 một kế hoạch cuối · REQ-10 chủ máy vẫn bác được từng ranh giới.

## 2. Đầu vào chủ máy đã duyệt (turn B — hội đồng không mở lại)

1. Hai tool `aki__aiobox` (đọc) / `aki__aiobox_write` (ghi); `op` là chuỗi tự do; bảng op do AIObox công bố quyết op thuộc tool nào.
2. Bỏ kiểm tra trước của AkiMCP (`pickProfile`, `urlNotAllowed`); AIObox kiểm.
3. AkiMCP mới gặp AIObox cũ → `version_mismatch`.
4. Đóng băng `instance.json`, `/api/security`, `/mcp`; AIObox thôi đọc thẳng `tokens.json`, lấy token qua endpoint.
5. Thêm S1/S4/S5-B vào danh sách hoàn tác (§9).

## 3. Thế giới quan LLM sau thay đổi (I5)

AkiMCP không phân biệt được AI trong cửa sổ AIObox với AI điều khiển từ ngoài (một session MCP chung), nên L0–L4 giống nhau cho cả hai; khác nhau chỉ ở L5–L7, AI tự nhận ra qua tiêu đề trang.

| Lớp | S0 không cài AIObox | S1 đã cài, app tắt | S2 app chạy | Chủ |
|---|---|---|---|---|
| L0 instructions server | chỉ phần gốc | + 1 dòng: "tiêu đề bắt đầu bằng handle kiểu P2·W1 = bạn ở trong cửa sổ AIObox: đọc `aki__aiobox op=state` trước" | như S1 | AkiMCP |
| L1 tool + mô tả | không có tool aiobox; `chrome_launch` mô tả chung | 2 tool, chỉ nói cơ chế (phong bì, `op=state` trước, 50 s, receipt) — không op list, không ngưỡng, không tên macro | như S1 | AkiMCP |
| L2 `akidevrule_context` | header + 1 câu pitch | header, không pitch | như S1 | AkiMCP |
| L3 `op=state` | — | `running:false` + next "nhờ chủ máy mở AIObox" + guide.md + bảng op | `running:true` + guide.md + bảng op | AIObox (nội dung) |
| L4 kết quả | — | op kênh `file` chạy được; op cần app trả `not_running` | phong bì AkiMCP + payload AIObox nguyên văn | AkiMCP phong bì, AIObox nội dung |
| L5 tiêu đề trang | — | có thể còn tiền tố cũ (Chrome sống lâu hơn app) | `P3·W2 · …` | AIObox |
| L6 tin `[auto]` | — | — | vòng lặp AIObox | AIObox |
| L7 custom instruction dán sẵn | — | nêu `aki__aiobox op=state` | như S1 | AIObox (`desktop/src-tauri/resources/prompts/akimcp-instruction.md`, prompt AIObox dán vào chat) |

- Luật: S0 chỉ thấy đúng một câu về AIObox (pitch). Mọi luật hành vi AIObox nằm ở L3: guide = luật xuyên op, `ops.<op>.help` = luật từng op. Guide chỉ được nhắc field do AIObox viết hoặc field phong bì đã đóng băng (§4 I7).
- Dòng L0 là loại "Bootstrap (S)" mà doc ranh giới cho phép (`akimcp-boundary.md:16`); ngữ pháp handle là hàng hợp đồng đóng băng, không phải luật AIObox.
- Rejected: guide chỉ phục vụ khi app chạy (judge-worldview vòng 1, aio vòng 2) — AI trong cửa sổ mồ côi khi app tắt sẽ không có gì để làm theo; profiles/runs vẫn đọc được khi app tắt.
- Reopen if: log D9 cho thấy AI lập kế hoạch sai dựa trên guide đọc lúc S1.
- Bác bằng: sửa một ô của bảng trên.

## 4. Quyết định I1–I7

**I1 · Bề mặt op và định tuyến**
- Decided — phong bì đóng. Tool đọc: `op, window?, expect?, wait?≤50, args?:record`; tool ghi: thêm `from?`, `receipt`.
- Decided — bảng op: AIObox ghi `~/.aki/aiobox/akimcp-state.json` = `{version:1, ops:{<op>:{tool:read|write, channel:window|each|request|file, file?, renamed?, args?, help?, timeoutNext?}}}`, ghi bằng tmp+rename, không bao giờ xoá khi thoát (để S1 đọc được).
- Decided — bốn kênh AkiMCP sở hữu: `window` (handle → CDP target → `akipanel.call(op,args,ctx)`); `each` (gọi `call` trên mọi tab sống trong deadline, trả kết quả theo cửa sổ; hiện chỉ `whoami`); `request` (`requests/<id>.json` + đọc dòng runs); `file` (đọc nguyên văn file dưới `~/.aki/aiobox`, `{x}` lấy từ `args.x`; file thiếu → `not_running` nếu `windows.json` cũng thiếu, ngược lại `no_file`; đọc `cdp/windows.json` đi qua cùng bước làm mới `windows.refresh` như khi định danh). `ctx = {deadlineAt, mode:read|write, expect?, from?}`. Kết quả `each` = `[{window, ok, data | code, why, next}]`. `akipanel.call` không bao giờ reject: `{ok:true,data}|{ok:false,code,why,next?}`.
- Decided — op duy nhất AkiMCP tự biết: `state` = `{running}` + guide.md + bảng op, chạy cả khi app tắt. Danh sách cửa sổ là op AIObox `windows` (kênh `file`, các dòng windows.json đúng như AIObox ghi).
- Decided — thứ tự gọi: detect → đọc state file → op không có trong bảng → `unknown_op` liệt kê tên → tool đọc gặp op `tool:write` → `wrong_tool` (fail-closed; tool ghi chuyển tiếp mọi op; AIObox kiểm lại `ctx.mode` bằng registry biên dịch sẵn) → kênh cần app mà không có `windows.json` → `not_running` → chuyển theo kênh.
- Decided — `version_mismatch` có chiều: state file thiếu/hỏng hoặc `version` thấp hơn → "cập nhật AIObox"; `version` cao hơn → "cập nhật AkiMCP". Tab có `akipanel` nhưng không có `call` → "tải lại cửa sổ hoặc cập nhật AIObox".
- Decided — mã riêng của AkiMCP (mang `by:"akimcp"`): `not_running, no_window, no_file, stale_map, wrong_window, timeout, app_not_listening, version_mismatch, unknown_op, wrong_tool, no_panel`. Mọi mã khác là của AIObox, chuyển nguyên văn; AkiMCP không switch trên mã AIObox.
- Decided — nội dung file của op kênh `file` (`runs.json` 50 lần chạy gần nhất, `profiles.json`, `archive/{chatId}.json`, `cdp/windows.json` khi qua op `windows`) là của AIObox, AkiMCP chuyển nguyên văn không parse, nên không phải hàng đóng băng; chỉ đường dẫn nằm trong bảng op. Kết quả lệnh `request` vẫn đọc từ bảng sqlite `runs` (hàng I7).
- Kết quả: op mới, đổi tên, chuyển đọc→ghi, thêm arg, mã từ chối mới, đổi ngưỡng → 0 dòng AkiMCP. Chỉ kênh mới, field phong bì mới, hoặc bump `version` mới cần AkiMCP phát hành.
- Because: enum op + arg phẳng + bảng next trong AkiMCP là ba lý do khiến mỗi thay đổi AIObox thành một bản AkiMCP hôm nay (`scripts/aiobox-mcp.js` — adapter, :1287, :1318-1336, :705-709).
- Rejected: kênh `any` (judge-boundary) — chọn một panel bất kỳ thì AIObox phải tự fan-out; `whoami` thuần AkiMCP qua chatId (aio, đã rút) — AI chưa biết chatId của mình; bỏ `each` (challenger) — whoami cần chữ trong trang, một kênh chung rẻ hơn một op viết cứng; field `acts` — tool ghi đã ngụ ý "có thể đã làm".
- Reopen if: một nhu cầu thật cần kênh thứ năm hoặc field phong bì mới.
- Bác bằng: sửa danh sách kênh hoặc phong bì ở mục này trước B1.

**I2 · Tách từng ký hiệu trong `scripts/aiobox-mcp.js` (adapter) và file lõi**
- KEEP: parseHandle/formatHandle (ngữ pháp handle — hàng T3); readMap/refreshMap/freshMap (bỏ nhánh `run`/epoch-null); resolveTab tra thẳng `retired[].end` và field `chatId` theo tab; liveTarget/`stale_map`; checkExpect/`wrong_window` (so chuỗi chung trên target sống: targetId/url/title, không cần biết provider); callDeadline/CALL_WAIT_MAX_S/inTime/OutOfTime/withinCall; outOfTime (`timeoutNext` của AIObox, không có thì text chung); Refusal; sendRequest (+`deadline`, tự xoá file khi bỏ cuộc); awaitRequestRun; requestOutcome (chỉ chuyển tiếp); usedTab rút còn `{window,targetId,resolvedFrom}`; detect/aioboxDir/aioboxInstalled/AIOBOX_PITCH/GUIDE_URL; đọc guide thành đọc `file` nguyên văn.
- MOVE sang AIObox: chatIdOf; PROVIDER_BY_HOST/providerOf/CHAT_PROVIDERS/tabRow/probeTabs/PROBE_JS/hereOf (thành op AIObox `windows` và `whoami`); `self_target` (5 bản ở :1088/:1111/:1156/:1198/:1208 → một chỗ trong dispatcher AIObox + `request.rs`, qua `from`); READ_JS/TEXT_JS/SEND_JS/COMPOSE_JS/MACRO_JS/NEW_CHAT_JS/PLACE_LIKE_JS/WORKSPACES_JS/SWITCH_WORKSPACE_JS/NEW_WINDOW_JS và mọi hằng chờ (SWITCH_WAIT_MS, NEW_WINDOW_*, MACRO_*, atNotionAiHome) — newChat/switchWorkspace thay trang nên phải là op `request` hoặc trả trước khi điều hướng; archive (op `file` `archive/{chatId}.json`); profiles (op `file` profiles.json); lọc runs; open_url bookkeeping + đóng tab + `aiobox-opened.json`; OPEN_RULE/PAUSE_SCOPE/DRAFT_WARNING/WAIT_AGAIN (vào `why`/`next`/`help` của op tương ứng hoặc guide).
- DELETE: successorOf/writtenHandle/`retired_loop` (AIObox ghi sẵn `end`); observe/aiobox-seen.json/renumbered warning; readPauses/pendingPauses/inForce/targetKey/workspacePaused/accountPause/pauseOf; canTakeChat tự tính, pickProfile, registeredProfile, urlNotAllowed, URL_MAX_BYTES, HANDOFF_TEXT_MAX_BYTES; INTERRUPTED_HANDOFF, bảng next theo mã, đổi tên budget/flagged; DELIVERED_JS/DELIVERED_MATCH/SEND_DELIVERED_MS; SUBMIT_SELECTORS và mọi nhánh send v1, cổng CHAT/COMPOSE/SEND_VERSION, RUN_EXTRA_COLUMNS; NEW_WINDOW_REST_MS; MACRO_ENDED (bỏ hàng T7); stub flag/unflag; `z.enum`/opsList; mô tả :1285; GUIDE_FALLBACK/GUIDE_HEAD (còn một dòng "guide thiếu: cập nhật AIObox" + URL); REQUEST_MAX_BYTES (sau K3); eval/screenshot (sang `devtools_*`, D14e).
- File lõi: `scripts/chrome-mcp.js` (tool mở Chrome) bỏ import OPEN_RULE và tên op, chỉ nêu tool `aki__aiobox`; `scripts/rule-context-mcp.js:21-22` (đoạn SHARED_WORK phục vụ mọi người dùng) bỏ `~/.aki/aiobox/` và `desktop/CHANGELOG.md`; `:30` AIOBOX_STEP còn đúng dòng L0 ở §3; `scripts/chrome-profile.js:166` (lỗi `no_profile`) không mở đầu bằng AIObox; `scripts/tools-server.js`, `scripts/tool-calls-report.js`, comment contract-gate giữ nguyên.
- Mô tả tool (tĩnh, đúng trên mọi máy — BR-3): đọc: "AIObox windows. Call op=state first: it returns the guide and every op with its args. window = handle, chatId or targetId; expect = text the target chat's url or title must contain; args as the guide says. Each op's help in op=state overrides the guide. Reads only; to act use aki__aiobox_write." (câu "help … overrides the guide" thêm 2026-10-07 lúc thực thi: guide v44 sai ba chỗ từ khi cài B1 tới A3, help từng op của A1 sửa đúng ba chỗ đó) Ghi: cùng phong bì + `receipt`; "from = your own window, so AIObox can refuse acting on yourself"; giới hạn 50 s một lần gọi.
- Because: KEEP chỉ còn phong bì, định danh, vận chuyển; mọi thứ AkiMCP đọc từ AIObox là hàng FORWARD FROZEN (§4 I7), không phải luật AIObox.
- Rejected: chuyển `wrong_window` sang AIObox (aio, judge-proportion vòng 2) — kiểm chung trên target sống chặn trước mọi lần ghi, kể cả kênh request; một fact một chỗ kiểm, nên AIObox không kiểm lại `expect`. Giữ `self_target` ở AkiMCP (judge-proportion vòng 1) — op nào cấm tự nhắm là luật từng op.
- Reopen if: log D9 có một lần làm trên nhầm chat mà vẫn qua `wrong_window` của AkiMCP.
- Bác bằng: dời một ký hiệu giữa ba cột KEEP/MOVE/DELETE.

**I3 · Điều kiện tiên quyết phía AIObox (aio xác nhận khả thi theo code)**
- Decided — `akipanel.call(op,args,ctx)`: bảng dispatch TS trên các method có sẵn (`desktop/panel/akipanel.ts`, API trong trang của AIObox); Rust đã kiểm lại mọi thay đổi qua `PanelCall` (`desktop/src-tauri/src/cdp/panel.rs`); op bọc lại không cần sửa Rust. Mọi field `akipanel` cũ giữ cho macro và AI trong trang; hợp đồng T1 co lại còn `call`.
- Decided — `akimcp-state.json` ghi lúc khởi động cạnh bước công bố guide (`desktop/src-tauri/src/lib.rs` gọi hàm trong `akimcp_ops.rs`); nội dung tĩnh theo bản build nên không ghi lại khi đổi cài đặt handoff.
- Decided — `windows.json`: thêm `provider`, `chatId` mỗi tab (`Provider::from_url`, `chat_id_of` có sẵn); `port` đã có theo profile; mỗi mục `retired` thêm `end` (`successor_of` có sẵn).
- Decided — payload: AIObox tự viết các field guide đang nhắc (`usageWhy`, `chatPauses`, `loading`, …) dưới đúng tên mà AkiMCP cũ đang tổng hợp, để guide v44 đúng với cả AkiMCP cũ lẫn mới tới A3.
- Decided — `desktop/src-tauri/src/automation/request.rs` (bộ nhận lệnh `requests/`): phong bì v2 (lỗi dạng JSON `{code,why,next}`, `deadline` kiểm trước mỗi bước hành động, `mode`), nhận cả v1 và v2 tới A3; file quá cỡ/không phải JSON được trả lời bằng dòng runs theo tên file khi stem qua `valid_id`; ghi pause trước khi spawn (đóng race :492-493); `self_target` qua `from` (chỉ phong bì v2).
- Decided — kiểm thử phải xanh trước khi B1 phát hành: handle sống qua restart trên đường adopt (`cdp/windows.rs`; bản ở tầng store đã có tại `handle_store.rs:255`); file 17 KiB → dòng runs `invalid`; `from` trỏ chính mình → bị từ chối ở mọi op hành động; mọi op `tool:read` không có tác dụng phụ.
- Because: mỗi điều kiện trên là thứ AkiMCP mới cần để xoá phần tương ứng ở I2; thiếu cái nào thì AkiMCP phải giữ bản sao.
- Rejected: guide v45 rút gọn ngay ở A1 (bản nháp đầu) — AkiMCP cũ không đọc được `ops.help`, nên rút gọn dời sang A3 (aio #56).
- Reopen if: một điều kiện không làm được trong AIObox mà không sửa Rust ngoài dự kiến.
- Bác bằng: bỏ một điều kiện ở đây, đồng thời dời ký hiệu I2 tương ứng từ DELETE/MOVE về KEEP.

**I4 · Lớp chặn và bảo mật (judge-proportion)**
- Decided — AkiMCP giữ (bảo vệ người gọi): detect, `not_running`, `no_window`, `stale_map`, `wrong_window`, deadline 50 s, receipt gate, kiểm hình dạng op, dựng biểu thức CDP chỉ qua `JSON.stringify` (coding.C4), `wrong_tool` fail-closed thay enum.
- Decided — bỏ (AIObox giữ): `pickProfile` + bản sao pause, `urlNotAllowed`, `same_window`, trần 8 KiB text, danh sách `need()` từng op, trần 16 KiB file lệnh (sau khi AIObox trả lời theo stem). Gộp mọi lỗi version rời rạc về một `version_mismatch`.
- Decided — endpoint token: `GET /api/access-token` → `{accessToken}`, gác bằng `x-panel-token` hiện có, chỉ nghe 127.0.0.1, không CORS — y như `/api/security`. Lấy token qua `getOrIssueAccessToken` nên luôn còn hạn. Sửa: AkiMCP `scripts/panel.js` (bảng ROUTES), `docs/feat/security.md` (:126, :174), comment `scripts/oauth.js:102`, test hợp đồng; AIObox `akimcp/files.rs:88-102` (bỏ đọc file), `connect.rs:94` và `readiness.rs:115` (hai chỗ đang đọc token).
- Because: mọi chặn bỏ đi đều đã được AIObox kiểm lại với cùng ý nghĩa (`request.rs:188-205`, `:239-253`); endpoint không thêm năng lực nào — ai có panel token đã xem được cả passphrase lẫn token qua `GET /?t=` (`panel.js:337`); mục tiêu là AkiMCP được tự do đổi kho token.
- Rejected: endpoint gộp `{origin, ingress, passphrase, clients, callers, token}` (judge-proportion vòng 2) — trùng `/api/security` vốn đã đóng băng; đóng băng `tokens.json` (challenger) — chủ máy đã chọn endpoint; đề xuất D14b "file tool cấm ghi vào `requests/`" — AI có `write_file` đã sửa được allowlist shell (`security.md:178`).
- Accepted risk: dời `self_target` làm `close_window` qua request bị từ chối sau ~0,5 s và có dòng runs, thay vì trước khi ghi — `from` vốn chỉ là dây an toàn. Token 1 năm đọc được bởi tiến trình cùng user đọc được instance.json, như hôm nay.
- Reopen if: có người dùng thứ hai của endpoint, token theo từng client, hoặc bind ngoài loopback.
- Bác bằng: chuyển một dòng giữa "giữ" và "bỏ", hoặc đổi tên/kiểu endpoint.

**I5 · Thế giới quan** — Decided ở §3 (bảng, luật, rejected, reopen, bác bằng nằm ở đó).

**I6 · File sót và lệch docs**
- Decided ở §7: mọi phát hiện của bản rà trước CONFIRMED (judge-worldview, có file:line), trừ "guide không đọc được khi app tắt" — thành quyết định K4; quét bổ sung trên danh sách khoá (AkiMCP README, docs/**, scripts/*.js; AIObox CLAUDE.md, docs/**, shared/guide/**, resources/prompts/**) thêm 12 mục.
- Because: docs chỉ sửa được khi biết đúng bước — sửa sớm câu mô tả hành vi chưa đổi thì docs lại sai; nên docs-only đi P0, docs đi kèm code đi cùng B1/A3.
- Rejected: sửa toàn bộ docs một lần sau khi xong (lệch kéo dài suốt A1–A3); coi "guide khi app tắt" là lỗi (judge-worldview tự rút ở vòng 2).
- Reopen if: một lần quét lại trên cùng danh sách khoá tìm ra mục mới.
- Bác bằng: dời một dòng giữa các bước ở §7.

**I7 · Hàng đóng băng hai chiều**
- Decided — FORWARD FROZEN (AkiMCP đọc từ AIObox): `windows.json` `version:1`, `profiles[].{number,id,port,windows}`, `windows[].{handle,state,tabs}`, `tabs[].{handle,targetId,url,title,chatId,provider}`, `retired[].{handle,successor,at,end}`, `generation`, `answered`; `windows.refresh`; phong bì `requests/` v2 `{version,id,op,args,at,deadline,mode,window?,from?}` (`deadline` epoch ms; `window` = targetId đã định danh khi lời gọi nêu cửa sổ; `from` cho `self_target`; `args` chuyển nguyên) và cột runs `request, outcome, detail, started_at, id` (`request` = id file lệnh; nhiều dòng cùng `request` thì lấy dòng mới nhất theo `started_at DESC, id DESC`); `akimcp-state.json` `version:1` với các key ở I1; ngữ pháp handle (T3) và tiền tố tiêu đề trang `P#·W# · ` mà dòng L0 nhắc; `akipanel.call(op,args,ctx)` với `ctx` ở I1 và kết quả của nó; dạng kết quả kênh `each`. Thêm ba giới hạn của chính AkiMCP mà tên op/file của AIObox phải vừa: op `^[a-z][a-z0-9_]{0,63}$`, id file `^[A-Za-z0-9_-]{1,128}$` (không `..`), trần đọc file 4 MiB.
- Decided — REVERSE FROZEN (AIObox đọc từ AkiMCP): `~/.aki/mcpsv/instance.json` {panelPort, gatePort, token, origin, ingress, pid, startedAt (ISO)} (hình dạng đầy đủ ở hợp đồng T1, dòng `instance.json`; cổng gateway đọc từ `gatePort`, không giả định 9999 vì `--port`, `GATEKEEPER_PORT` và `.env` đổi được nó); `akimcp` và `akimcp --no-browser [--port <n>]` chạy gateway ở foreground (`bin/akimcp.js:2-4`, `scripts/start.js:14-16`), `--port` thắng `GATEKEEPER_PORT` và `.env` (`scripts/start.js:55`); một AkiMCP cùng phiên bản đang chạy thì được dùng lại và `--port` bị bỏ qua (`scripts/start.js:38-47`), nên cổng thật luôn là `gatePort`; SIGTERM/SIGINT thoát sạch: xoá instance.json, dừng cloudflared và Postman daemon (`scripts/start.js:202-214`); trang panel `GET /?t=<panel token>` (`scripts/panel.js:333`) — bốn hàng này thêm 2026-10-07 cho trang quản lý AkiMCP của AIObox (aiobox `docs/plan/akimcp-page-managed.md`), chỉ ghi lại hành vi đã có, không sửa code; `passphrase.txt`; `GET /api/security`; `GET /api/access-token`; `/mcp` initialize + tools/list; `akimcp --version`; gói npm `@akinet/akimcp`; tên connector "AkiMCP"; DOM trang đồng ý OAuth (`input[name=passphrase]` + nút khớp /Approve/ — macro connect-akimcp của AIObox điền vào); `~/.aki/cdp/profiles`; cờ `--aki-launcher=akimcp`; tên tool `aki__aiobox`, `aki__aiobox_write`, `aki__chrome_launch`; tên op `state`.
- Decided — REPLACED: `tokens.json` — AIObox thôi đọc ở A2 (cả hai chỗ, giữ fallback tới A3); sau A3 AkiMCP được đổi định dạng trong bất kỳ bản nào.
- Luật: hai bên chỉ được THÊM field. Bump `version` của một file/phong bì là thay đổi phá vỡ, cần một bản AkiMCP có chủ đích.
- Because: đây là toàn bộ chỗ hai repo chạm nhau; liệt kê đủ thì "AIObox đổi gì không buộc AkiMCP đổi" kiểm được bằng danh sách này.
- Rejected: chỉ đóng băng chiều ngược (bản nháp đầu) — challenger #44 chỉ ra chiều xuôi cũng là chỗ AkiMCP phải sửa nếu AIObox đổi.
- Reopen if: một bên cần đổi/xoá một hàng — khi đó đó là thay đổi phá vỡ, đi qua cả hai repo.
- Bác bằng: thêm/bớt một hàng.

## 5. Sổ xung đột K1–K8 (lead chốt vòng 2)

| K | Kết quả | Ghế phản đối |
|---|---|---|
| K1 phán xét cửa sổ | `wrong_window` ở AkiMCP; `self_target` sang AIObox | aio (đã chấp nhận ở #56) |
| K2 observe/aiobox-seen | xoá; A1 thêm kiểm thử handle sống qua restart trên đường adopt | — |
| K3 trần 16 KiB | AIObox trả lời theo stem → AkiMCP bỏ trần | — |
| K4 guide khi app tắt | phục vụ, mở đầu `running:false` | aio (đã chấp nhận ở #56) |
| K5 kênh | `window|each|request|file`; không `acts`; `timeoutNext` tuỳ chọn; help/args trong bảng op | judge-boundary (`any`), challenger (bỏ `each`) |
| K6 endpoint token | `GET /api/access-token` → `{accessToken}`; đóng băng passphrase.txt | judge-proportion vòng 2 (endpoint gộp) |
| K7 request.rs | lỗi JSON qua phong bì v2, deadline, pause trước spawn, kiểm `ctx.mode` | — |
| K8 eval/screenshot | sang `devtools_*`; dùng `port` theo profile | — |

Bác bằng: đổi cột "Kết quả" của một dòng; mục I tương ứng ở §4 đổi theo.

## 6. Các bước, theo repo — không có trạng thái nửa vời

Luật: mỗi bước AIObox chỉ THÊM cho tới khi B1 chạy; AkiMCP chỉ có MỘT bản phát hành (B1), và không phát hành khi A1 chưa cài trên mọi máy chủ máy hỗ trợ.

| Bước | Repo | Nội dung | Cổng vào → ra |
|---|---|---|---|
| P0 | cả hai | sửa docs §7 phần "P0" (chỉ docs) | vào: ngay → ra: không đổi hành vi |
| A1 | AIObox | `akipanel.call`, `akimcp-state.json`, `chatId`/`provider` theo tab, `retired.end`, payload field cùng tên, `ops.help` (guide v44 giữ nguyên), request v2 + stem + race + `self_target` + `ctx.mode`, op `windows` và `whoami`, kiểm thử I3 | vào: P0 đã bàn giao Mac → ra: kiểm thử I3 xanh trên Mac; AkiMCP cũ chạy y nguyên |
| B1 | AkiMCP | bản duy nhất: phong bì + định tuyến I1, tách I2, I4 (gồm `GET /api/access-token`), L0–L4 ở §3, hoàn tác §9, eval/screenshot sang `devtools_*`, docs §7 phần B1 | vào: A1 đã cài → ra: một lần đổi hash định nghĩa tool |
| A2 | AIObox | đọc token qua endpoint ở `connect.rs:94` và `readiness.rs:115`, giữ fallback `tokens.json` | vào: B1 đã cài |
| A3 | AIObox | guide v45 (rút còn luật xuyên op, luật từng op ở `ops.help`); bỏ phong bì v1 — file v1 nhận dòng runs `invalid` với "Next: update AkiMCP"; bỏ fallback `tokens.json`; hợp đồng T1 rút còn §4 I7; đo lại doc ranh giới | vào: mọi máy chủ máy hỗ trợ đã chạy B1 |
| sau A3 | AkiMCP | được đổi định dạng `tokens.json` trong bất kỳ bản nào sau; plan này sang `done/` | không phải một bản phát hành riêng |

Bác bằng: đổi cổng vào/ra của một bước.

## 7. Sửa docs (I6)

- Wrong (P0): câu "AkiMCP ghi `flags.json` qua `op=flag`" trong hai bản hợp đồng T1 (:39/:46/:47/:54/:94), doc ranh giới aiobox (:46/:122/:215), aiobox `docs/arch/automation-scheduler.md:116` (doc bộ lập lịch automation), comment aiobox `desktop/src-tauri/src/paths.rs:118` (bảng đường dẫn dữ liệu), aiobox `docs/plan/aio-loop-automation.md:70` (plan vòng lặp) — thực tế AIObox là bên ghi duy nhất (`chat_cutoff.rs:3`). AkiMCP `docs/feat/security.md:130` (doc bảo mật) và `README.md:286` (README) ghi log "browser/AIObox, 1 MB" — thực tế log mọi tool `aki__`, 40 ngày, 16 MB. Hợp đồng T1 :52/:54 ghi "≥ 95%" — thực tế `full_pct` chủ máy chỉnh, mặc định 87.
- Wrong (B1): mô tả tool `scripts/aiobox-mcp.js:1285` "Quota ≥95% or Interrupted twice" — bị xoá cùng mô tả mới.
- P0 (docs, cả hai repo): `README.md` :109/:249/:302 danh sách op cũ; `docs/feat/security.md` thêm `aiobox-opened.json`, `requests/`, `windows.refresh` (những gì AkiMCP ghi); `docs/arch/provider-toolkit.md:46` (doc kiến trúc provider) danh sách op + Contract 3 ghi ngoại lệ; gộp hai bản hợp đồng T1 (thiếu: archive, switchWorkspace, failed, `state===null` = đang tải, `opening`, `capabilities.readiness`, `delivered:false`, chat-cutoffs.json, close_window/pause_chat/resume_chat, `chat_paused`/`hourly_limit`, `chatPause`/`canTakeChat`); câu "một tool (hôm nay hai)" ở `CLAUDE.md` hai repo + doc ranh giới :30 → "hai tool, op tự do"; D14a/c/d/f trong `docs/plan/akimcp-tool-refactor.md` ghi "thay bởi plan này"; số dòng trôi + mốc BR-8 6/65 trong doc ranh giới; mục index cho doc ranh giới (aiobox `docs/index.md`) và cho `akimcp-tool-refactor.md` (AkiMCP `docs/index.md`); test `guide.rs:160` ghi "version 43" trong khi guide là 44.
- B1 (AkiMCP): `aioboxWarning` trong `scripts/chrome-mcp.js` chỉ hiện khi provider aiobox bật; ghi rõ trong `docs/arch/provider-toolkit.md` rằng L0 (instructions) cố định lúc boot, mô tả L1 tĩnh và giống nhau trên mọi máy, danh sách tool đổi theo `redetect` không cần khởi động lại, còn L2 xét mỗi lần gọi; `scripts/chrome-profile.js:166`; bốn bản OPEN_RULE còn một (ở op/guide AIObox); `docs/feat/tools.md:28` (một dòng 12 KB lặp lại hợp đồng, guide và mô tả) và README rút còn cơ chế + trỏ `op=state`.
- Mức độ (docs.C4): Wrong 5 cụm, Stale 6, Incomplete 5, Cosmetic 2.

## 8. Cửa một chiều và cổng R7 (chờ chủ máy)

- R7 = "kênh truy vấn mới AkiMCP⇄AIObox là bề mặt tấn công mới, chủ máy quyết khi nào mở" (doc ranh giới :20).
- `GET /api/access-token`: chủ máy đã mở bằng turn B (điều 5 dòng 4).
- `akipanel.call`: hội đồng xếp KHÔNG phải R7 — nó chạy trên đường CDP eval mà AkiMCP đang dùng để gọi `akipanel.live.send` và các field khác hôm nay, không thêm listener hay cổng, và hẹp hơn (một hàm thay vì đọc tự do). Chủ máy xác nhận cách xếp này ngày 2026-10-07. Bác bằng: xếp lại là R7 thì A1 chờ chủ máy mở cổng.
- Đổi hash định nghĩa tool (B1): mọi cửa sổ hỏi lại "Always allow" một lần; gộp mọi đổi định nghĩa vào đúng B1. Tên tool không đổi (HF-3).
- `version_mismatch` cắt AIObox cũ: chỉ máy chủ máy + bản build tặng bạn bè (installer chưa phát hành — aiobox `CLAUDE.md` §5); giá = cài lại AIObox. Reopen theo tần suất `version_mismatch` trong log D9.

## 9. Danh sách hoàn tác (trong B1)

D14 đã ghi: c0dd305, ac35654, 25fd6ef, fc147b7 (next/mô tả quota/Interrupted, map budget, đóng tab open_url qua aiobox-opened.json). Thêm: 140635a + 19c033f (S1: send báo Notion rejected/failed), 83f1fb2 (S4: deadline 50 s toàn đường — giữ phần deadline chung, bỏ phần riêng AIObox), 4cdb81e (S5-B: gửi vào cửa sổ vừa mở giữ `loading`). Hoàn tác nghĩa là phần logic AIObox trong các commit này chuyển sang AIObox theo I2, không phải `git revert`.

## 10. Git, build và phát hành — chỉ trên Mac

Chủ máy, 2026-10-07, nguyên văn: "máy này là máy chỉ code. git acc này khác với git acc trên máy mac của tôi. nếu thực sự việc về git đủ lớn thì cần làm trên máy mac (bây giờ luôn rồi sync lại) hoặc làm xong hết code xong hết ở đây rồi tôi xử lý sau trong plan handoff mac".

- Decided: code và docs làm hết trên máy dev; commit, tag, phát hành npm/GitHub và build Rust/Tauri làm trên Mac qua bàn giao. Không bước nào cần thao tác git trước khi code.
- Because: không bước nào của plan đụng lịch sử git. "Hoàn tác" ở §9 là sửa code, không phải `git revert`. Việc thật sự cần Mac là build Rust (A1, A2, A3 sửa `request.rs`, `guide.rs`, bản đồ cửa sổ) và phát hành B1.
- Rejected: làm git trên Mac ngay rồi sync (chủ máy nêu làm phương án một) — không có việc git nào để làm trước.
- Mỗi repo do phiên của chính nó làm. Chủ máy, 2026-10-07: "phần của repo akimcp thì bên này làm. phần của aiobox thì bên kia làm. chỉ nhắn tin cho nhau chứ không được tự ý chạm vào sửa file của repo của nhau". Thứ tự việc trên Mac cho phần repo này (B1): [boundary-handoff-mac.md](boundary-handoff-mac.md); P0 và A1 phía aiobox: `docs/plan/mac-handoff.md` của repo aiobox.
- Điểm bàn giao (mỗi bước một lần, vì bước sau cần bước trước đã build và cài):

| Sau bước | Mac làm |
|---|---|
| P0 | commit docs ở cả hai repo, gồm file plan này và mục index (`docs/index.md:79`) |
| A1 | build AIObox, chạy kiểm thử I3, commit, cài lên mọi máy chủ máy dùng |
| B1 | commit AkiMCP, bump version, CHANGELOG, tag semver trần `3.0.0` (3.0.0 chưa từng lên npm, nên mọi thay đổi từ 2.2.0, gồm cả B1, ra chung một bản theo `release.A5`), phát hành npm + GitHub Release (RULE-release, mục Release process trong `CLAUDE.md` của repo này) |
| A2, A3 | build AIObox, commit, cài |

- Rủi ro: thay đổi chưa commit trên máy dev có thể bị ghi đè khi Mac sync về, nên bàn giao từng bước, không dồn tới cuối.
- Reopen if: một bước cần sửa lịch sử git (rebase, tách commit cũ); khi đó làm trên Mac trước rồi sync.
