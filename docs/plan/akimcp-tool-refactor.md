# Plan · AkiMCP tool refactor (v3 — challenger duyệt #15 18:51; owner cho làm 2026-10-05 — EXECUTE)
Status: owner chỉ thị (nguyên văn ở anchor chat.md "BỔ SUNG 5"): "những việc gì cần làm thì làm hết đi" → không hỏi duyệt lại; các mục "user chọn" do hội đồng tự kết luận (Decided có because/reopen trong checklist). Dừng duy nhất tại sàn escalation: push/release/publish/deploy, tiền, bảo mật — gom một lần vào báo cáo cuối.
Session: ~/.aki/agent-council/aiobox/2026.10.05-1430-akimcp-tool-refactor/ · mode audit (read-only) · lead P7·W36 · nguồn: checklist.md + 6 file seat · council_verify 7/7 PASS (18:3xZ).
Bản bền này = docs/plan/akimcp-tool-refactor.md (RULE-docs B1); bản nháp trong session là lịch sử. Decided cho các mục "user chọn" ở checklist.md § REQ-17.

## 0. Kết luận audit (đã đóng, có challenger)
- Bề mặt ĐÍCH = 37 tool / 22 op, giữ nguyên tập hiện tại (ITEM-9). 0 tool xoá (ITEM-3; S1–S5 No action, mọi đề xuất bỏ đã qua Chesterton + /akithink).
- Việc thật nằm ở: chất lượng định nghĩa (annotations, lỗi có next, mô tả gọn), ranh giới AkiMCP↔AIObox (R0–R7), log mọi tool (D9), phễu nói đúng (BR-9).
- Phần AIObox trong AkiMCP = PHỄU có chủ đích (REQ-15), không phải rò; coupling kỹ thuật mới xét SRP.
- Ranh giới (ITEM-10, D13): mặc định (A) adapter hiện tại → dần về (B) AIObox giữ logic, qua R0–R7.

## 1. Thứ tự phát hành (bắt buộc)
P1. D9 log mọi tool — phát hành TRƯỚC bản gom.
P2. Việc KHÔNG đổi hash định nghĩa tool: sửa phễu/docs (F-list, README, lineage, docs AIObox) + A15 lỗi/next là OUTPUT (chrome_launch no_aiobox, notify_user, NO_SESSION_HINT cdp-mcp.js:10).
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
- lineage.md:26 "not for distribution" → sửa cho khớp phễu. README "38 tools" → 37.
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
5. Rào phễu BR-9 F1–F7, mỗi F có lệnh kiểm (aki-judge-boundary.md § 18:19); làm chặt: F7 thêm ca lỗi trên máy giả (bắt NO_SESSION_HINT cdp-mcp.js:10); F6(a) test theo giá trị PITCH (import + regex \b(Mac|macOS|Windows|Linux)\b), không grep 1 dòng; F5(b) spy fetch/http + child_process (curl/open).
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
- Lệnh kiểm chung: council_verify.py PASS; grep "Mac app" = 0; tools/list = 37 tool khi có AIObox, 35 khi chưa cài (aiobox* ẩn); F1–F7 lệnh như boundary § 18:19.

## 8. Phân việc EXECUTE (lead 2026-10-05 ~18:5xZ, sau REQ-17)
Quy ước chung checkout: git status trước khi sửa; file bẩn không phải của mình → không đụng, báo lead; commit `git commit -m "…" -- <paths của lane>`; KHÔNG git add -A, KHÔNG push/tag/release/publish/deploy; CHANGELOG chỉ sửa dòng của mình ngay trước commit; lane rủi ro → `git worktree add <repo>/.claude/worktrees/<lane> -b wt-<lane>`. Mỗi lane: Decided các mục mở trong miền mình (4 kill-test + reversibility, ghi because/reopen) → làm → test → commit → báo lead + challenger.
Sóng 1 (song song, file tách biệt):
| lane | seat | repo / file sở hữu | việc | xong khi |
|---|---|---|---|---|
| L1 D9 log (P1) | aki-hands P1·W28 | aki-mcp-sv: scripts/tool-call-log.js, scripts/tool-calls-report.js, mục log trong setting (userdata.js) + panel/config-page phần log, test log | log mọi tool; basic mặc định; setting mức + ngày giữ 40 + trần MB; dọn theo tuổi | test pass, ST-4 PASS |
| L2 lỗi/next A15 (P2) | aki-judge -llm-ux P3·W10 | aki-mcp-sv: lỗi chrome_launch (chrome-profile.js/chrome-mcp.js), notify_user (system-mcp.js), NO_SESSION_HINT cdp-mcp.js:10, test F7 ca lỗi | H1/D15, notify ok thật, D3 | test pass, F7 ca lỗi PASS |
| L3 phễu chữ (P2) | aki-judge -history-future P1·W29 | aki-mcp-sv: aiobox-guide.js (PITCH "a desktop app", ?from), docs lineage.md, README (37 tool), test F6(a) | F6, HF chữ | grep "Mac app"=0, F6(a) test PASS |
| L4 docs tool (P2) | aki-judge -subtract P5·W14 | aki-mcp-sv: docs tools.md | ST-1 đủ 37 tool, ST-2 cặp dễ nhầm | ST-1/ST-2 PASS |
| L5 ITEM-8b + AB-7 | aki-judge -boundary P4·W19 | aiobox: file quy tắc mới docs (akimcp-boundary.md) + 1 dòng trỏ trong CLAUDE.md; docs Linux (platform-unify-windows-build.md, positioning.md) | ghi cứng HF/BR/ST/T5′ + lệnh kiểm; đa nền tảng | HF "akimcp-boundary.md có" PASS |
| review | aki-challenger P8·W17 | — | tấn công từng commit + mọi Decided | mỗi lane có turn duyệt |
Sóng 2 (sau sóng 1): P3 bản gom định nghĩa tool (llm-ux chủ trì, 1 commit); P4 R0–R6 + AB-1..6 phía AIObox (phối hợp P4·W18, không phá việc dở; AIObox trước, AkiMCP sau). P5 R7 = sàn bảo mật → báo cáo cuối.
Kiểm sống (C25/C27/C28/C29/V6/A12/F6(b)): chạy được cục bộ thì chạy; cần máy Windows/Linux hoặc phát hành → báo cáo cuối.

## 7. DEFERRED / No action
D12 giá (owner hoãn) · C12 rename chat ngoài Notion (AIObox AB-5) · S1–S5 · op surface · A12 live (gộp lần phát hành).
