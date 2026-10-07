# Plan · Bàn giao Mac: AkiMCP 3.0.0 (ranh giới B1 + sửa test), chạy `/akiship` cục bộ, không push

Status: sẵn sàng bàn giao 2026-10-07. Máy dev đã xong code và docs, full `npm test` 51/51 xanh, `release_lint.py --latest` exit 0, scythe sạch trên mọi `.md` đã đổi, số mục panel trong `README.md`/`docs/index.md` khớp `scripts/config-page.js`. Chưa commit (máy dev không được commit).
Plan gốc: [akimcp-aiobox-boundary-plan.md](akimcp-aiobox-boundary-plan.md) (quyết định I1–I7 ở §4, cổng vào/ra ở §6, hoàn tác ở §9). File này chỉ xếp thứ tự việc trên Mac, không quyết lại điều gì.
Chủ máy, 2026-10-07: "máy này là máy chỉ code … làm xong hết code xong hết ở đây rồi tôi xử lý sau trong plan handoff mac" · "đề cập các akirule cần thiết, các file cần thiết, và /akiship nhưng không được push".

## Luật cho phiên Mac

- **Không push.** Không `git push`, không đẩy tag, không `npm publish`, không tạo GitHub Release. `.github/workflows/release.yml` tự tạo GitHub Release khi tag bare semver được đẩy lên, nên đẩy tag cũng là phát hành. Dừng sau commit + tag cục bộ, báo chủ máy.
- Chỉ làm trong repo này. Chủ máy, 2026-10-07: "phần của repo akimcp thì bên này làm. phần của aiobox thì bên kia làm. chỉ nhắn tin cho nhau chứ không được tự ý chạm vào sửa file của repo của nhau". Repo aiobox chỉ được đọc để kiểm cổng.
- Hợp đồng chung `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` có hai bản, mỗi repo một bản, phải giống từng byte. Bản aiobox là nguồn; bản ở đây chỉ được chép đè từ bản aiobox.
- Quyết định nào trong plan gốc không giữ được khi sửa cho test xanh: dừng và báo chủ máy.

## akirule phải nạp (đọc trọn file, trước lần sửa đầu tiên)

| File (`~/.aki/akidevrule/`) | Vì sao |
|---|---|
| `RULE-agent-behavior.md` (core, tự nạp) | phạm vi, không trailer credit (`agent.B4`), audit chỉ đọc |
| `RULE-release.md` | `/akiship` bắt buộc đọc trọn: cổng B7 S0–S8, B5 dò migration, B8 quyền chạy, B9 npm |
| `RULE-docs.md` | `/akiship` bắt buộc đọc trọn: đồng bộ docs (B7 bước 5), plan sang `done/` |
| `RULE-coding.md` + `RULE-pattern-core.md` | chỉ khi cổng phải sửa code hay test |
| `RULE-test.md` | chỉ khi sửa file test hay `test/setup.js`; `aki-route-guard` chặn lần sửa test đầu tiên nếu chưa đọc |
| `METHOD-deep-think.md` | khi có quyết định một chiều (tag cũ, xung đột 3 chiều) |

Router: `~/.claude/skills/akirule/SKILL.md`; skill: `~/.claude/skills/akiship/SKILL.md`. Dòng đầu mỗi phản hồi: `[RULES] agent (core) + release,docs (akiship)` (thêm `coding,pattern` nếu nạp).

## File cần có

| File | Là gì |
|---|---|
| `handoff/aki-mcp-sv-oct07/` (cạnh `pj/` trên máy dev) | bundle: `manifest.tsv` (trạng thái, đường dẫn, sha256), `files/`, `BASE` (19c033f), `apply.sh` gộp 3 chiều |
| `scripts/verify-boundary-b1.sh` | kiểm B1: 4 tầng tự động + in 5 mục kiểm tay |
| `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` | hợp đồng chung với AIObox, bản sao byte-identical |
| `CHANGELOG.md` khối `[Unreleased]` | mọi thay đổi 2.2.0 → 3.0.0, `/akiship` đổi thành `[3.0.0]` |
| `package.json` | `version` đã là `3.0.0`, không bump thêm |
| `test/setup.js` | cách ly test: mỗi tiến trình test có HOME và thư mục tạm riêng |
| `docs/plan/done/test-suite-fixes.md`, `docs/research/test-suite-audit-oct07.md` | lượt sửa test và kiểm toán gốc của nó |
| `docs/plan/akimcp-aiobox-boundary-plan.md` | plan gốc |

## Bước 0 — đồng bộ

Kéo bundle về Mac: `scp -r bien:/home/guest/aki/handoff/aki-mcp-sv-oct07 .`, rồi chạy `bash aki-mcp-sv-oct07/apply.sh <repo aki-mcp-sv>`. File Mac chưa đụng từ `BASE` thì lấy bản máy dev; file cả hai phía cùng đổi thì gộp 3 chiều, xung đột ghi vào `conflicts.txt`.

Ra khi: `git status` có đủ file trong `manifest.tsv`, `conflicts.txt` rỗng hoặc không có. Có xung đột thì dừng, báo, không tự chọn phía.

## Bước 1 — cổng: AIObox A1 đã cài

Chỉ kiểm, không làm việc của aiobox: AIObox bản A1 đã cài (phiên aiobox báo xong theo `docs/plan/mac-handoff.md` của repo aiobox) và `~/.aki/aiobox/akimcp-state.json` (bảng op AIObox ghi khi khởi động) tồn tại. Chưa đạt thì dừng.

## Bước 2 — kiểm trên macOS

| Việc | Lệnh | Ra khi |
|---|---|---|
| Kiểm B1 | `scripts/verify-boundary-b1.sh` (`AIOBOX_REPO=<đường dẫn>` nếu repo aiobox không nằm cạnh) | 4 tầng xanh. Máy dev: 51/51, ~22 s, `~/.aki`, `/tmp`, HOME và repo không đổi trước/sau |
| Giống CI | `npm ci && npm test` rồi `find scripts test -name '*.js' -print0 \| xargs -0 -n1 node --check` (đúng hai bước của `.github/workflows/ci.yml`) | cả hai exit 0 |
| Kiểm tay | 5 mục script in ra, AIObox A1 đã cài, AkiMCP chạy từ working tree này | cả 5 đúng |

## Bước 3 — `/akiship` 3.0.0, chỉ cục bộ

Chủ máy gõ `/akiship` (trơn, không kèm "trọn vẹn"/"push"): theo `release.B8`, lệnh trơn không có quyền push hay deploy. Trước khi chạy:

1. **Tag cũ.** Commit 2557b2b (`chore(release): 3.0.0`, 2026-10-04) mang tag cục bộ `3.0.0` chưa phát hành; máy dev không kiểm được origin (không có khoá SSH, `gh` chưa đăng nhập). Chạy `git ls-remote --tags origin 3.0.0` và `gh release view 3.0.0`. Cả hai không có thì `git tag -d 3.0.0`. Có một trong hai thì dừng, báo chủ máy: số 3.0.0 đã công khai (`release.A5`).
2. **Phiên bản.** npm mới tới 2.2.0 (`npm view @akinet/akimcp version` = `2.2.0`, kiểm 2026-10-07). Khối `[3.0.0] - 2026-10-04` cũ đã gộp vào `[Unreleased]`; manifest giữ `3.0.0`. `/akiship` phát hành đúng một bản 3.0.0 ("1 lần v3" của chủ máy): đổi `[Unreleased]` thành `[3.0.0] - <ngày chạy>`, không bump, không viết lại nội dung.

`/akiship` làm: cổng B7 S0–S8 (biên `2.2.0`, dò migration B5, `release_lint`, docs sync, build/test như bước 2), commit theo nhóm, khối CHANGELOG `[3.0.0]`, tag trần `3.0.0` cục bộ ở commit phát hành, bản release copy (B6).

`/akiship` không làm: push commit, đẩy tag, GitHub Release, `npm publish`. Báo cáo cuối phải ghi 4 việc này là "chờ chủ máy", kèm kiểm tarball đã chạy (`npm pack --dry-run`, `bin` chạy từ tarball, `release.B9`) để chủ máy chỉ còn gõ lệnh.

Ra khi: working tree sạch, `git log -1 --format=%B` không có `Co-Authored-By`/`Claude-Session`, `git tag -l 3.0.0` trỏ vào commit phát hành, `git status -sb` báo đi trước origin (chưa push).

## Sau khi chủ máy push và publish (ngoài phiên này)

- Ngày trong `[3.0.0]` là ngày phát hành thật: push khác ngày chạy `/akiship` thì sửa ngày trước khi push.
- Dấu trạng thái trong hợp đồng ("A1, chưa cài", "Boundary v3 … chưa ship") do phiên aiobox đổi trong bản của nó (`## 7. T1 lúc phát hành`, `docs/plan/mac-handoff.md` repo aiobox). Sau đó chép đè sang đây, chạy lại tầng 1 của `scripts/verify-boundary-b1.sh`; sha khác nhau thì chưa xong.
- Mọi cửa sổ AI hỏi lại "Always allow" một lần vì định nghĩa tool đổi hash (plan gốc §8). Không phải lỗi.
- Site akimcp.top 1.14.0: chỉ sau khi 3.0.0 có trên GitHub `main` và npm, theo mục "Mac" trong `docs/plan/whats-new-3-0-0-sync.md` của repo site (bundle `handoff/akimcp.top-oct07/`). Build của Cloudflare kéo panel từ `main`, nên site push trước là site lệch.

## Dọn rác test trên máy dev (từ Mac, qua `ssh bien`)

Bản test cũ, trước khi có `test/setup.js`, đã để lại trên máy dev: 6 thư mục rỗng `/tmp/akimcp-stdio-*` (bản cũ của `test/registry-listing.test.js` tạo, 2026-10-07 18:04–18:30) và `~/.aki/mcpsv/tasks.json` = `{}` cùng thư mục `task-logs/` rỗng (bản cũ của `test/task-mcp.test.js` ghi vào thư mục dữ liệu thật lúc 18:18). `scripts/task-mcp.js` đọc file thiếu thành `{}`, nên xoá không đổi hành vi. Lệnh chỉ xoá khi vẫn rỗng, nên không đụng dữ liệu thật nếu server đã ghi task mới từ đó:

```bash
ssh bien 'f=~/.aki/mcpsv/tasks.json; [ "$(cat "$f" 2>/dev/null)" = "{}" ] && rm "$f"; rmdir ~/.aki/mcpsv/task-logs /tmp/akimcp-stdio-* 2>/dev/null; ls -d ~/.aki/mcpsv/tasks.json ~/.aki/mcpsv/task-logs /tmp/akimcp-stdio-* 2>&1'
```

Ra khi: dòng `ls` cuối báo không còn file nào. Còn file nào thì nó không rỗng: để nguyên, báo chủ máy.

## Để sau, không thuộc lần bàn giao này

- `test_lint.py` (`RULE-test.md` mới, bộ dò `test.D1`) chạy trên suite 2026-10-07: 0 lỗi chắc chắn. 4 dòng `[EXIT]` là báo nhầm: `process.exit` nằm trong chuỗi script con mà test chạy thử (`test/shell-mcp.test.js:66,69`, `test/trusted-zone.test.js:38`, `test/aiobox-mcp.test.js:256`). Còn 40 dòng gợi ý để người xem xét (`[CLEANUP-FINALLY]` 18, thư mục tạm của chúng nằm trong TMPDIR riêng mà `test/setup.js` xoá khi tiến trình thoát; `[VACUOUS]` 8; `[SRCPIN]` 5, là các ghim Postman đã giữ có lý do trong `docs/plan/done/test-suite-fixes.md`; `[HISTORY]` 4; `[AMBIENT]` 3; `[SLEEP]` 2). Không chặn 3.0.0; xét lại là một lượt kiểm toán riêng theo `test.D`, không sửa trong lần này.

- Nhãn client cấp sẵn trong panel vẫn là "Claude (pre-registered)" (`scripts/oauth.js` `STATIC_CLIENT_NAME`, `public/panel-client.js` `CLIENT_KIND_LABEL`), dù Claude giờ tự đăng ký qua DCR và client này dùng cho Gemini. Mục này báo `redirectHost` `claude.ai` mà AIObox đọc qua `GET /api/security` (hợp đồng chung), nên đổi cần chủ máy quyết cùng phía aiobox.
- A2 và A3 là việc của repo aiobox (plan gốc §6). Phía này chỉ còn chép đè hợp đồng khi A3 rút gọn nó; sau A3, plan gốc và file này sang `done/`.

## Báo cáo của phiên Mac

Mỗi bước: đạt hay không, kèm output; receipt S0–S8 của `/akiship`; commit (hash + tiêu đề); tag; những gì phải sửa so với code máy dev và vì sao; 4 việc chờ chủ máy (push, đẩy tag, GitHub Release, npm publish) kèm đúng lệnh.
