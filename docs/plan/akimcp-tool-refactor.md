# Plan · AkiMCP tool refactor (v3 — challenger duyệt #15 18:51; owner cho làm 2026-10-05 — EXECUTE)
Status: owner chỉ thị (nguyên văn ở anchor chat.md "BỔ SUNG 5"): "những việc gì cần làm thì làm hết đi" → không hỏi duyệt lại; các mục "user chọn" do hội đồng tự kết luận (Decided có because/reopen trong checklist). Dừng duy nhất tại sàn escalation: push/release/publish/deploy, tiền, bảo mật — gom một lần vào báo cáo cuối.
Session: ~/.aki/agent-council/aiobox/2026.10.05-1430-akimcp-tool-refactor/ · mode audit (read-only) · lead P7·W36 · nguồn: checklist.md + 6 file seat · council_verify 7/7 PASS (18:3xZ).
Bản bền này = docs/plan/akimcp-tool-refactor.md (RULE-docs B1); bản nháp trong session là lịch sử. Decided cho các mục "user chọn" ở checklist.md § REQ-17.

## 0. Kết luận audit (đã đóng, có challenger)
- Bề mặt ĐÍCH = giữ nguyên tập hiện tại: đăng ký 38 tool (gồm kiro_read, agy_run) / 22 op; phục vụ = 38 − tool của provider detect=false (máy chủ hôm nay 37 vì kiro-cli không trên PATH, kiro-mcp.js:40) (ITEM-9; đính chính challenger #17). 0 tool xoá (ITEM-3; S1–S5 No action, mọi đề xuất bỏ đã qua Chesterton + /akithink).
- Việc thật nằm ở: chất lượng định nghĩa (annotations, lỗi có next, mô tả gọn), ranh giới AkiMCP↔AIObox (R0–R7), log mọi tool (D9), phễu nói đúng (BR-9).
- Phần AIObox trong AkiMCP = PHỄU có chủ đích (REQ-15), không phải rò; coupling kỹ thuật mới xét SRP.
- Ranh giới (ITEM-10, D13): mặc định (A) adapter hiện tại → dần về (B) AIObox giữ logic, qua R0–R7.

## 1. Thứ tự phát hành (bắt buộc)
P1. D9 log mọi tool — phát hành TRƯỚC bản gom.
P2. Việc KHÔNG đổi hash định nghĩa tool: sửa phễu/docs (F-list, README, lineage, docs AIObox) + A15 lỗi/next là OUTPUT (chrome_launch no_aiobox, notify_user). Đính chính (challenger #18): NO_SESSION_HINT cdp-mcp.js:10 chỉ nối vào description 3 tool devtools (:22,47,74), không phải lỗi → thuộc P3 (D-L2a).
P3. Bản gom MỘT LẦN mọi đổi ĐỊNH NGHĨA tool (annotations destructiveHint/readOnly, mô tả, enum, tên) — Claude "Always allow" gắn hash định nghĩa: đổi = hỏi duyệt lại mọi cửa sổ + reconnect (A12, HF-3). Đi kèm cùng lúc: dòng CHANGELOG "reconnect + Claude hỏi lại Always allow" + guide AIObox tăng version. Luật: bước R nào đổi description phải đi trong bản gom. Ví dụ sống (FACT): c0dd305..fc147b7 đổi lẻ mô tả aiobox/aiobox_write → phải reconnect mọi workspace; lượt gọi tool hành động đầu báo RULE_RECEIPT_UNKNOWN, receipt giữ nguyên (akidevrule_context trả unchanged; receipt khác nhau giữa seat là do workingPath).
P4. R0–R6 trả luật chép về AIObox (không ảnh hưởng người chưa cài AIObox). Mỗi bước R: AIObox phát hành TRƯỚC, AkiMCP SAU; qua cổng akipanel.capabilities; bước chưa qua kiểm thì không sang bước sau (aki-judge-boundary.md:359).
P5. R7 (kênh hỏi–đáp mới) — chỉ khi cổng mở, kèm câu cho chủ.

## 2. Việc theo hạng mục
### D9 · log mọi tool (user duyệt, nguyên văn ở anchor "BỔ SUNG (D9)")
- Sửa: tool-call-log.js:8-12,60-61 (bỏ regex 10 tool, bỏ xoay 1 MB); setting.json AkiMCP (userdata.js:12, mẫu roots.js:20 / panel.js:37 / config-page.js) + panel AkiMCP (không ở UI AIObox).
- Mặc định (basic): ts, tool/op, ok, ms, client, mã lỗi, agent, version, evalKind, window, headers 1 lần/phiên (tool-call-log.js:17-20). Không đối số, không nội dung.
- User duyệt (luật): log mọi tool; mặc định vừa đủ; có setting chỉnh chi tiết; dọn theo tuổi mặc định 40 ngày.
- SUGGESTED (chi tiết cài đặt, bảng aki-challenger.md:334-345): mức detail = + error text 200, from, macro, exprHash/exprLen; setting thêm trần MB + mức log; không bao giờ lưu text đối số/biểu thức.
- Báo cáo: tool-calls-report.js --days N; cửa sổ đo reopen = 30 ngày (< 40 ngày dọn).
- Mở lại sau ≥30 ngày log: clipboard_* (H3), sqlite_schema (S1), eval UNKNOWN 76.
### Phễu (BR-9 F1–F7, REQ-15) + đa nền tảng (REQ-16b)
- PITCH đúng 2 bề mặt D7 (rule-context-mcp.js:53; reason aiobox-mcp.js:1206). Thêm bề mặt PITCH = câu cho chủ.
- GUIDE_URL (cũng là phễu): 2 bề mặt D7 + fallback guide aiobox-guide.js:19 (fallback không phải pitch). Ngoại lệ có tên: AIOBOX_STEP (:28), chrome-mcp.js:64 "While AIObox runs".
- Pitch ghi "a desktop app"; tên OS chỉ khi bản đó có link tải. grep "Mac app" = 0.
- SUGGESTED: GUIDE_URL thêm ?from=akimcp chỉ trên 2 bề mặt D7.
- lineage.md:26 "not for distribution" → sửa cho khớp phễu. README "38 tools" ĐÚNG (= tên đăng ký; README:96 đã nói tool app chưa cài không phục vụ) → không sửa.
- config-page.js tab Hosted domain: giữ (phễu). Giá D12 = DEFERRED (owner hoãn, giữ nguyên).
### Lỗi & khôi phục (A15, H1/D15)
- chrome_launch chưa cài AIObox: trả sự thật (chrome-profile.js:163) + đường không cần AIObox (NO_CDP_PORT_MESSAGE :296-297). KHÔNG pitch, KHÔNG GUIDE_URL. no_profile → next.
- notify_user: ok theo kết quả thật (system-mcp.js:30,41-43,47 trả notified:true cả khi notify-send lỗi / Windows chỉ beep).
- Tên tool/op cũ: SUGGESTED trả renamed + next (provider-registry.js:2 hiện chỉ lỗi chung) — chỉ cần khi có đợt đổi tên.
### Ranh giới R0–R7 (D13)
- Bước đầu đúng dưới cả (A)/(B): bỏ kiểm trước url_allowed/workspace_flagged trong AkiMCP; 5–6 luật chép (R1–R5) trả về AIObox = đổi chủ luật, giữ hành vi, không xoá tính năng.
- R7 thêm cổng giữ F1–F3 + 2 test D7.
- D3 còn: cdp-mcp.js:10 (trỏ tool đang ẩn) (làm ở P2).
### Docs (ST-1/ST-2, P2)
- tools.md bổ sung ~25 tool thiếu; ghi rõ khi nào dùng: postman_eval vs devtools_eval, chrome_tabs vs devtools_targets, stat/port vs run_cmd.
### Việc AIObox (AB-1…AB-7)
- AB-5 rename chat Claude/GPT/Grok (C12 hiện ngoài phạm vi AkiMCP); AB-6 guide:46 "renames itself" vô điều kiện; AB-7 docs "Linux bỏ qua" (platform-unify-windows-build.md:13,111; positioning.md; CLAUDE.md:22) → đa nền tảng.

## 3. 8 điều bắt buộc (challenger #10)
1. Bản gom đổi định nghĩa tool một lần (P3) + CHANGELOG "reconnect + Always allow" + guide AIObox tăng version cùng lúc; lỗi/next là output → P2.
2. Danh sách kiểm sống (UNVERIFIED trong audit, bắt buộc trước phát hành): C25 AkiMCP một mình (akidevrule_context đúng 1 dòng pitch, aiobox* ẩn); C27 composer chết; C28 Windows; C29 Linux; V6 (4 ca); A12 client Notion/Claude/GPT (annotations, hash); F6(b) kiểm tay mỗi lần phát hành.
3. Mỗi bước R: AIObox phát hành trước, AkiMCP sau, qua cổng akipanel.capabilities; chưa qua kiểm thì không sang bước sau (P4; boundary :359).
4. Đích eval ≤5% tổng gọi aiobox_write (báo kèm mẫu số), đo trên ≥200 lượt và ≥3 provider (aiobox-control-ops.md:63). T5′: op mới khi ≥3 lượt cùng mục đích HOẶC lỗi thật từ JS tự viết.
5. Rào phễu BR-9 F1–F7, mỗi F có lệnh kiểm (aki-judge-boundary.md § 18:19); làm chặt: F7 thêm ca lỗi trên máy giả (NO_SESSION_HINT khoá là KNOWN_P3 vì nằm trong description); F6(a) test theo giá trị PITCH (import + regex \b(Mac|macOS|Windows|Linux)\b), không grep 1 dòng; F5(b) spy fetch/http + child_process (curl/open).
6. Mọi mục SUGGESTED tách riêng (§4), không coi là luật hiện hành.
7. Quyết cho user: chỉ câu qua 4 kill-test (§5).
8. Mỗi tiêu chí có lệnh kiểm (§6).

## 4. SUGGESTED (chưa phải luật)
renamed + next cho tên cũ · ?from=akimcp trên GUIDE_URL (2 bề mặt D7) · D5/D6 postman_* bỏ cờ [S] · ẩn/hiện tool theo capabilities (đổi tools/list = đổi hash → chỉ trong P3) · chi tiết log mức detail + trần MB.

## 4b. Chesterton cho mọi đề xuất bỏ (aki-challenger.md:387-394)
| bỏ gì | vì sao có | đã think/subtract | còn được? |
|---|---|---|---|
| R1 kiểm trước url_allowed | chép luật AIObox để chặn sớm | V10/V11 + deep 2; AIObox đã thực thi request.rs:141,154 | được |
| R2c/R3/R4 bản chép workspace_flagged, NEW_WINDOW_REST_MS | thiếu đường trả từ AIObox | chỉ sau AB-1..3; capability gate | được, có điều kiện |
| regex 10 tool + xoay vòng 1 MB (tool-call-log.js:8-12,60-61) | giới hạn đĩa | thay bằng log mọi tool + dọn 40 ngày (user D9) | được |
| rút mô tả akidevrule_context/receipt | mandatory block, receipt gate | A5 deep 3; pitch output không đụng | được, trong bản gom |
| P2, S1–S5, surface, ẩn chrome_launch | — | đã No action | không bỏ |

## 5. Quyết cho user
- Hiện tại: KHÔNG có câu nào (mọi câu khác đã tự trả qua kill-test; D12 owner hoãn).
- Mặc định ghi sẵn, user chỉ cần phản đối: D13 (A) dần về (B).
- Mặc định KHÔNG làm, user nói thì làm: ?from=akimcp trên GUIDE_URL; D5/D6 (postman_* bỏ cờ [S]).
- Câu chờ cổng: R7 kênh hỏi–đáp mới (sàn bảo mật) — chỉ hỏi khi tới P5.
- Duyệt plan này: có/không.

## 6. Tiêu chí ghi cứng (dự thảo cho ITEM-8b, repo aiobox)
MỖI DÒNG có lệnh kiểm riêng (read-only, chạy trên HEAD aki-mcp-sv fc147b7 / aiobox 07d7ebb). Bảng đầy đủ "tiêu chí | lệnh | kết quả hôm nay" nằm ở file seat (nguồn duy nhất, không chép đôi); tóm tắt kết quả:
| nhóm | nguồn bảng | PASS | FAIL (→ việc plan) | kiểm tay khi phát hành |
|---|---|---|---|---|
| HF-1..5 (17 dòng) | aki-judge-history-future.md § Lệnh kiểm từng tiêu chí | D7 đúng 2 bề mặt; rule-context test | chưa có akimcp-boundary.md (8b); lỗi chrome_launch chưa no_profile/NO_CDP (P2); "Mac app" aiobox-guide.js:26 (P2); CI chỉ ubuntu (C28/C29) | custom instruction các tài khoản; so bảng cũ→mới; chạy Windows/Linux |
| BR-1..8 | aki-judge-boundary.md § 18:47 | BR-1, BR-2×2, BR-3 (theo ngoại lệ có tên) | BR-4 cdp-mcp.js:10 (D3, P2); BR-5 (R5, P4); BR-7 (8b) | BR-2 helper, BR-4 ngưỡng, BR-6, BR-7 ở CI; BR-8 mốc 5 dòng .rs / 64 hằng |
| BR-9 F1–F7 | aki-judge-boundary.md § 18:19 + aki-challenger.md:416-424 | F1/F2 8 dòng, F5(a) 0, F6(a) bắt "a Mac app" | F6(a) (P2); F7 thiếu ca lỗi (thêm test) | F6(b) |
| ST-1..5 | aki-judge-subtract.md § Lệnh kiểm tiêu chí ST | ST-5 | ST-1 tools.md thiếu ~25 tool (P2 docs); ST-2 PARTIAL: postman_eval↔devtools_eval, chrome_tabs↔devtools_targets, stat/port↔run_cmd (P2 docs; mô tả → P3); ST-4 log 10 tool, không retention (P1 D9) | ST-3′ |
| T5′ T1–T9 | aki-judge-llm-ux.md § T5′ — lệnh kiểm từng dòng | 0 op qua T5′ = khớp 22 op | exprHash 0 → "cùng việc" UNKNOWN tới D9 mức detail; M4 chưa so được (openai 2 lượt) | T3b, T5, T9 |
Số liệu T5′ hôm nay (FACT, jq trên tool-calls.jsonl): eval có from 96/626; burst ≥3 = 393/626 (proxy); lỗi JS thật 18 / 11 cửa sổ; eval/write 30%.
Không FAIL mới ngoài các việc đã có trong §2. ITEM-8b chép các bảng này vào quy tắc repo aiobox kèm lệnh.
- HF-1..HF-5 (aki-judge-history-future.md): tool mới có lý do + ngày (git log -S + CHANGELOG); tên aki__* bền; đổi định nghĩa = bản gom; pitch không trong description; đa nền tảng.
- BR-1..BR-9 (aki-judge-boundary.md): nhãn {AkiMCP-lõi, AIObox-only, AIObox-qua-AkiMCP, bỏ} + hướng phụ thuộc + lệnh kiểm cấp dòng; BR-9 phễu F1–F7.
- ST-1..ST-5 (aki-judge-subtract.md): mỗi tool/op có "vì sao có / bỏ thì mất gì / ai thay"; bỏ chỉ sau Chesterton + /akithink.
- T5′ (aki-judge-llm-ux.md): ngưỡng thêm op từ eval.
- Lệnh kiểm chung: council_verify.py PASS; grep "Mac app" = 0; tools/list = 38 đăng ký − tool của provider detect=false (F7 test tính từ registry, không cứng số); F1–F7 lệnh như boundary § 18:19.

## 8. Phân việc EXECUTE (lead 2026-10-05 ~18:5xZ, sau REQ-17)
Quy ước chung checkout: git status trước khi sửa; file bẩn không phải của mình → không đụng, báo lead; commit `git commit -m "…" -- <paths của lane>`; KHÔNG git add -A, KHÔNG push/tag/release/publish/deploy; CHANGELOG chỉ sửa dòng của mình ngay trước commit; lane rủi ro → `git worktree add <repo>/.claude/worktrees/<lane> -b wt-<lane>`. Mỗi lane: Decided các mục mở trong miền mình (4 kill-test + reversibility, ghi because/reopen) → làm → test → commit → báo lead + challenger.
Sóng 1 (song song, file tách biệt):
| lane | seat | repo / file sở hữu | việc | xong khi |
|---|---|---|---|---|
| L1 D9 log (P1) | aki-hands P1·W28 | aki-mcp-sv: scripts/tool-call-log.js, scripts/tool-calls-report.js, mục log trong setting (userdata.js) + panel/config-page phần log, test log | log mọi tool; basic mặc định; setting mức + ngày giữ 40 + trần MB; dọn theo tuổi | test pass, ST-4 PASS |
| L2 lỗi/next A15 (P2) | aki-judge -llm-ux P3·W10 | aki-mcp-sv: lỗi chrome_launch (chrome-profile.js/chrome-mcp.js), notify_user (system-mcp.js), test F7 ca lỗi (NO_SESSION_HINT → P3, D-L2a) | H1/D15, notify ok thật, D3 | test pass, F7 ca lỗi PASS |
| L3 phễu chữ (P2) | aki-judge -history-future P1·W29 | aki-mcp-sv: aiobox-guide.js (PITCH "a desktop app", ?from), docs lineage.md, test F6(a) (README KHÔNG sửa — #17) | F6, HF chữ | grep "Mac app"=0, F6(a) test PASS |
| L4 docs tool (P2) | aki-judge -subtract P5·W14 | aki-mcp-sv: docs tools.md | ST-1 đủ 38 tên đăng ký, ST-2 cặp dễ nhầm | ST-1/ST-2 PASS |
| L5 ITEM-8b + AB-7 | aki-judge -boundary P4·W19 | aiobox: file quy tắc mới docs (akimcp-boundary.md) + 1 dòng trỏ trong CLAUDE.md; docs Linux (platform-unify-windows-build.md, positioning.md) | ghi cứng HF/BR/ST/T5′ + lệnh kiểm; đa nền tảng | HF "akimcp-boundary.md có" PASS |
| review | aki-challenger P8·W17 | — | tấn công từng commit + mọi Decided | mỗi lane có turn duyệt |
Sóng 2 (sau sóng 1): P3 bản gom định nghĩa tool (llm-ux chủ trì, 1 commit); P4 R0–R6 + AB-1..6 phía AIObox (phối hợp P4·W18, không phá việc dở; AIObox trước, AkiMCP sau). P5 R7 = sàn bảo mật → báo cáo cuối.
Kiểm sống (C25/C27/C28/C29/V6/A12/F6(b)): chạy được cục bộ thì chạy; cần máy Windows/Linux hoặc phát hành → báo cáo cuối.

## 7. DEFERRED / No action
D12 giá (owner hoãn) · C12 rename chat ngoài Notion (AIObox AB-5) · S1–S5 · op surface · A12 live (gộp lần phát hành).

## 9. REQ-18 (owner 2026-10-05 ~19:3xZ): đổi hẳn tên "flag" (ITEM-12) + giới hạn mỗi giờ (ITEM-13)
FACT: flag sinh ở guide v9 (d02e1d0) = bỏ qua tài khoản Interrupted khi CHỌN cửa sổ giao việc; chưa bao giờ chặn join/reconnect. guide aiobox.md:73 "never used, not even for one message" + tên "flag" (trùng nghĩa "Notion has flagged it" :59) làm AI bỏ join workspace. flags.json có 2 bên ghi không khoá (AIObox request.rs:271-284, AkiMCP aiobox-mcp.js:504-505) → paths.rs:112 "AIObox only reads it" sai, BR-2 gãy. Giới hạn request.rs:46-50 là hằng cứng, đếm chung mọi AI, 1 giờ trượt, đếm cả lượt lỗi (store.rs:251); không có setting → aio-control-gaps.md:14 "đổi được" sai. Số 04–05/10: new_window ok16/err7/bị chặn 4, handoff ok7/err15/bị chặn 2, open_url ok7/bị chặn 0.

Decided (lead, sau llm-ux, boundary, history-future, subtract, challenger #23):
- D18a Khái niệm = **chat pause** (tạm dừng giao việc chat AI). Một khái niệm lưu: {scope account|workspace, profile, provider, reason, until}; Interrupted là 1 reason; quota 95% không gộp (số đo sống). Tên: file `chat-pauses.json`; op `pause_chat` / `resume_chat`; mã từ chối `chat_paused`; trường `chatPause {reason, until} | null`; `eligible` → `canTakeChat` (giữ, gộp barred quota.rs:273). Because: động từ + tân ngữ nói đúng phạm vi (chat, không phải tài khoản), resume/until = có hạn, tách khỏi nghĩa "Notion has flagged it"; số ít theo 3/4 seat. Reopen if: log D9 thấy AI vẫn bỏ join/reconnect vì chat pause.
- D18b (B) Phạm vi ghi trong guide + akimcp-boundary.md: "A chat pause only stops new AI chat work (send, new chat, handoff) on that account or workspace. Joining it, reconnecting AkiMCP, reading usage and account admin still go ahead. It says why (reason) and ends at until or at resume_chat."
- D18c Chủ ghi = AIObox; AkiMCP gửi request pause/resume (requests/, một chiều). Because: AIObox đã ghi + là bên thi hành (D2), hết mất cập nhật, BR-2/BR-8/D13. Reopen if: cần tạm dừng khi AIObox không chạy.
- D18d Đường chuyển: (a) AIObox trước (P4): đọc mới ∪ flags.json, chỉ ghi mới, chuyển 1 lần + giữ flags.json.migrated để lùi, nhận request pause/resume, từ chối mã mới (AkiMCP hiểu cả "flagged" cũ), guide tăng version, sửa paths.rs:112 + contract; (b) AkiMCP sau, trong bản gom P3: op mới; op flag/unflag giữ hết bản major, trả renamed + next → pause_chat/resume_chat; (c) bỏ đọc flags.json khi guide mới đã ship + ≥30 ngày log D9 = 0 gọi/ghi tên cũ.
- D18e Giới hạn mỗi giờ (tên mới **hourly limit**, mã từ chối `hourly_limit` thay `budget`): mục đích = phanh khi AI chạy vòng lặp / bị prompt-injection mở cửa sổ, handoff, tab hàng loạt. Giữ 3 trần riêng. (1) Chỉ đếm lượt đã thật sự mở (bỏ lượt lỗi trước bước open) — lỗi không mở gì nên không gây hại. (2) new_window 6 → 12/giờ; handoff 12 giữ; open_url 20 giữ (URL chở dữ liệu ra ngoài). (3) Setting panel AIObox chỉ chủ đổi (1–60); AI không đổi được. (4) Từ chối + op=state trả used/limit/nextFreeAt; câu cho user: "Safety brake against a runaway AI: all AIs together may open at most N new chat windows, N handoffs and N links in any 60 minutes. Used 12 of 12 new windows; the next frees up at 14:52." (5) Sửa docs aio-control-gaps.md:14 + contract :50. Because: 6 lần bị chặn thật trong 2 ngày lúc hội đồng chạy (đội 15+ cửa sổ: 6/giờ = 3 giờ mới mở đủ), phạm vi D2 vẫn chặn (profile đăng ký, signed_in, chỉ trang chat) nên không chạm sàn; mức 12 thay 20 theo challenger #23 (nới vừa, đo tiếp). Reopen if: log D9 30 ngày thấy >1 lần hourly_limit/ngày ngoài đợt hội đồng (nâng) hoặc >10 new_window/giờ không do người khởi (hạ).
- Sàn (báo cáo cuối, không tự làm): nới open_url, bỏ phanh, hoặc cho AI tự đổi giới hạn.

Sửa theo challenger #24 (D18a/b DUYỆT; c/d/e SỬA — đè lên các dòng trên):
- D18d' Khoảng AIObox mới + AkiMCP cũ (AkiMCP cũ đọc/ghi thẳng flags.json aiobox-mcp.js:457/496-505, send đi CDP không qua AIObox): KHÔNG migrate/đổi tên .migrated tới khi AkiMCP mới đã ship; mục cũ lấy flags.json làm gốc; pause AIObox tự ghi (request.rs:271) ghi CẢ 2 file. Test: AkiMCP cũ vẫn thấy pause do AIObox mới ghi.
- D18c' pause_chat trả `queued` tới khi có dòng runs; cổng send của AkiMCP coi request pause đang chờ = đã hiệu lực (AIObox tắt vẫn không giao chat vào đó).
- D18e' (1) "đã mở" = cửa sổ/tab đã tạo, vẫn đếm dù bước sau lỗi (wait timeout); không đếm lượt lỗi trước khi tạo + test. (2) Because sửa: nguồn = bảng runs code=budget 04–05/10 (subtract § ITEM-12/13: new_window 4, handoff 2); 6→12 thuận nghịch, D2 vẫn chặn; KHÔNG phải "theo #23". Nếu seat L6 không dẫn lại được 6 dòng đó từ runs thì giữ 6, chủ nâng qua panel. (3) Setting nằm trong store AIObox (không phải JSON dưới ~/.aki/aiobox mà aki__write_file ghi được), không đổi được qua akipanel/op=eval; nếu không đạt được → KHÔNG làm setting, đưa vào sàn báo cáo cuối.
- D18b' thêm câu: "Notion flagging an account is not a chat pause."

### 9b. REQ-19 + REQ-20 (owner, mới nhất) — đè lên § 9
Nguyên văn: session chat.md anchor BỔ SUNG 7 + 8. Luật: aki-mcp-sv CLAUDE.md (9dd57a8) Stable core + Native command → guide → tool; aiobox akimcp-boundary.md §0a S-1..S-3.
- HỦY D18a ('chat pause' gọi tên hành động, owner: "quá mơ hồ và bị quá góc cạnh") và D18e (giới hạn mỗi giờ: owner không ủy quyền). D18c'/D18d' xem lại theo S-2 (AkiMCP không biết khái niệm nội bộ AIObox).
- D20a XOÁ HẲN 3 trần WINDOWS/HANDOFFS/URLS_PER_HOUR (aiobox request.rs:46-50, over_budget :300-309, test, mã 'budget', docs D4, contract, guide); phần AkiMCP map budget/next đi trong đợt 1 adapter. Because (proportion A1–A4, ước lượng): reach chỉ AI trên máy chủ; motive không; blast radius = cửa sổ/tab thừa, đóng được; lộ dữ liệu qua URL không bị trần giờ chặn → chốt thật là kiểm URL D2 (GIỮ); trần đếm lượt = guard không bảo vệ gì (B4); Chesterton: efe0988 không có because. Reopen if: log thấy RAM/máy cạn vì AI mở cửa sổ hàng loạt → phanh theo RAM thật.
- D20b Interrupted 2 lần liền → thời hạn 8h → 4h (AIObox).
- Tên thay 'flag': phải nói VẤN ĐỀ GỐC (tài khoản/workspace bị Interrupted liên tiếp / hết quota), không nói hành động; thuộc AIObox (S-2) — hội đồng đề xuất lại sau khi nạp lại akirule (pattern A7).
- ITEM-14 (đang chốt): 1 adapter `aki__aiobox` {op: string không enum, window?, from?, args} chuyển nguyên tới AIObox; op/ngữ nghĩa/mã lỗi/next thuộc AIObox; giữ tên aki__aiobox, không alias aiobox_write; ràng buộc readOnlyHint (aiobox-mcp.js:1233, rule-gate.js:47). P3 chỉ giữ việc AkiMCP tự thân; L7 cất patch, không commit.
- Challenger #25: L3 + L2 GIỮ. Nợ S-2: chrome-mcp.js:24 nêu tên op AIObox → chỉ nêu tool adapter (P3). L7 gộp vào S-2: op = chuỗi chuyển thẳng (AIObox kiểm, danh sách op trong guide); từ chối {code, why, next} do AIObox viết, AkiMCP chuyển nguyên (bỏ map mã→next aiobox-mcp.js:666); cổng send đọc 1 trường chung AIObox ghi (canTakeChat + why). Bỏ D18c' phần AkiMCP đọc requests/ (AIObox tắt = không còn cửa sổ để send; L6 kiểm); `queued` do AIObox trả. D18d' giữ. Phép kiểm S-2: tên op/file AIObox chỉ trong aiobox-mcp.js, aiobox-guide.js, panel.js + bootstrap rule-context-mcp.js:21,30.
- Tự khai P8·W15 (đã live, 'sửa AkiMCP vì AIObox'): c0dd305, ac35654, 25fd6ef, fc147b7 (next/mô tả quota/Interrupted, map budget, close_window đóng tab open_url qua aiobox-opened.json + CDP closeTab) → gỡ trong đợt 1 adapter: next do AIObox trả; đóng tab open_url thành logic AIObox.

Lane (sóng 2): L6 AIObox (P4, aiobox; boundary P4·W19 làm, báo P4·W18 trước): D18a–e phía app + guide + docs + akimcp-boundary.md BR-2. L7 AkiMCP (llm-ux trong commit P3): op/enum/mô tả mới, đọc cả file cũ, flag/unflag renamed+next, hiểu mã cũ + mới, panel-client, tools.md. Phát hành: AIObox trước, AkiMCP sau.
