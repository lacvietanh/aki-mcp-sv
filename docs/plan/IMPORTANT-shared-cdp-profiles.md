# IMPORTANT — Một thư mục CDP chung cho aiobox và akimcp

> **IMPORTANT, ràng buộc cả hai repo.** File này có bản sinh đôi ở `aiobox: docs/plan/IMPORTANT-shared-cdp-profiles.md`; hai bản giống nhau trừ dòng này, sửa một bản thì sửa luôn bản kia trong cùng phiên. Nguồn: working plan `~/.aki/mcpsv/task/cdp-unified-clone/plan.md` (port vào hai repo ngày 2026-10-01). Cùng nhóm ràng buộc: `docs/plan/IMPORTANT-akimcp-aiobox-contract.md` (id, tên, file và endpoint AkiMCP mà AIObox dùng).

Bắt đầu: 2026-09-28 · Hợp nhất + deep-think/audit: 2026-10-01 · Chat nguồn: claude.ai/chat/5c884fec-963e-4866-b416-3592d8515cfc (tab `aki-cdp`) · Trạng thái: patch aiobox và akimcp đã có trong code (§ Tiến độ aiobox, § Tiến độ akimcp; akimcp commit 2026-10-03, ra trong 3.0.0), đã dời dữ liệu 26/26 profile (2026-10-03), test chéo phía akimcp đạt trên gốc mới (§ Tiến độ akimcp), còn ca aiobox mở profile do akimcp giữ và profile 9 · Hai bản IMPORTANT trong hai repo là source of truth cho việc gom CDP (working plan cũ chỉ còn trỏ về đây); các số liệu runtime bên dưới là snapshot kiểm chứng ngày 2026-09-28 và phải được dò lại trước khi thực thi.

## Kết luận

Gom profile CDP của aiobox và akimcp vào một gốc trung lập `~/.aki/cdp/profiles/`, chỉ giữ một bản clone cho mỗi Chrome profile và chỉ để aiobox tạo/tạo lại clone. akimcp trở thành consumer: nếu profile chưa chạy thì mở từ kho chung; nếu profile đã do tool khác giữ thì đọc `DevToolsActivePort`, dò endpoint CDP rồi attach, không xóa khóa/cổng và không clone lại.

Việc đổi đường dẫn tự nó nhỏ: aiobox chủ yếu đổi một hàm gốc, akimcp chủ yếu xóa thuật toán clone trùng. Phần bắt buộc phải xử lý trước khi dùng chung là ownership/concurrency: hiện cả hai tool có đường xóa file khóa hoặc file cổng trước khi mở Chrome mà không biết tool kia đang giữ profile. Nếu đưa chúng vào cùng thư mục mà không sửa H1–H3 bên dưới, có nguy cơ hai tiến trình cùng ghi `Cookies`/LevelDB hoặc làm mất `DevToolsActivePort` của tiến trình đang sống.

## Mục tiêu và nguyên tắc đã chốt

- Mục tiêu trực tiếp: một thư mục CDP chung `~/.aki/cdp/` cho aiobox, akimcp và các consumer tương lai, thay vì mỗi tool tự clone profile và sinh dữ liệu trùng.
- Mục tiêu dài hạn: một profile clone là một nguồn dữ liệu duy nhất; tool chia sẻ quyền điều khiển qua CDP thay vì chia sẻ bằng cách nhân bản dữ liệu.
- Gốc chung: `~/.aki/cdp/`, trung lập, không mang tên tool.
- Profile: `~/.aki/cdp/profiles/<slug-browser>-<slug-profile>/`; với Chrome `Profile 6` là `chrome-profile-6`, theo quy tắc `profile_id` hiện có của aiobox.
- Chỉ aiobox tạo hoặc tạo lại clone. akimcp không giữ thuật toán clone riêng.
- Không dựng registry cổng mới, khóa profile riêng, lease riêng hay nhãn ownership mới. Source of truth cho ownership là `SingletonLock`; source of truth cho port là `DevToolsActivePort`, nhưng port chỉ được tin sau khi dò endpoint CDP thật.
- Registry và script riêng của aiobox tiếp tục ở `~/.aki/aiobox/cdp/`; chỉ thư mục `profiles/` chuyển sang gốc chung.
- Bản đầu không “nhận nuôi” một Chrome do tool khác mở vào registry trong-memory của aiobox. aiobox gặp profile đang có owner thì fail rõ; akimcp có thể attach vì bản chất nó chỉ cần một CDP endpoint.
- Không mở rộng scope sang Postman/Cursor/Electron app không dùng Chrome clone.

## Snapshot kiểm chứng ngày 2026-09-28

Đây là bằng chứng tại thời điểm research, không phải trạng thái runtime hiện tại.

### Dữ liệu trên đĩa và tiến trình

- akimcp có 5 clone ở `~/.aki/mcpsv/chrome-clones/chrome-Profile_<N>`, N = 6, 9, 10, 18, 22.
- Các Chrome của kho akimcp được xem là đã chết tại thời điểm kiểm: cổng 54714 và 63675 từ chối kết nối; 52007 và 53584 chưa dò xong.
- aiobox có khoảng 26 thư mục ở `~/.aki/aiobox/cdp/profiles/chrome-profile-<N>`, cùng `registry.json` chứa thông tin tài khoản và `shared/scripts`. Một plan cũ ghi 27; chưa xác minh nguyên nhân lệch giữa registry và đĩa.
- Bốn Chrome đang chạy khi snapshot được lấy đều do aiobox mở: profile 6 → cổng 62575, profile 8 → 54399, profile 11 → 58161, profile 18 → 56027.
- Bốn profile trùng giữa hai kho là 6, 10, 18, 22; file `Cookies` của bản aiobox mới hơn ở cả bốn cặp.
- Profile 9 chỉ có trong kho akimcp tại thời điểm snapshot.
- Cổng 61572 của Cursor chưa xác nhận là CDP; hai lần probe gặp socket hang up.
- Postman và Cursor là Electron app, không có clone Chrome theo mô hình này và nằm ngoài scope.
- Chưa thấy project khác như `groktg_bot` hoặc `cdp-postman` giữ Chrome clone; scan mới xem 20 trong 31 kết quả `Local State` dưới `~/.aki`, nên đây không phải chứng minh tuyệt đối rằng không còn consumer khác.

## Ràng buộc kỹ thuật đã xác lập

- Chrome không mở remote debugging trên thư mục dữ liệu mặc định; clone phải chạy qua `--user-data-dir`.
- Cookie decryption key gắn với OS user chứ không gắn với path, nên dời nguyên thư mục clone trên cùng máy/cùng user không làm mất khả năng giải mã cookie.
- Phải giữ `Local State` cạnh profile con và giữ đúng tên `Profile N`; đổi profile con thành `Default` làm mất mapping.
- Một tiến trình Chrome sở hữu một user-data-dir. Mở lần hai vào thư mục đang khóa không tạo CDP instance độc lập; lệnh thường được chuyển cho tiến trình cũ rồi tiến trình mới thoát.
- `DevToolsActivePort` có thể còn sót sau khi Chrome chết, nên không được coi file tồn tại là bằng chứng endpoint còn sống.
- Clone là snapshot theo thời điểm. Nhà cung cấp có thể xoay refresh token, vì vậy hai clone cùng đăng nhập có thể drift hoặc làm một bản hết hạn; sau khi gom còn một clone duy nhất nên rủi ro này giảm mạnh nhưng chưa có đo riêng cho claude.ai.
- `SingletonLock` trên macOS là symlink dạng `<host>-<pid>`. Nếu host trong lock không khớp máy hiện tại thì trạng thái owner không xác định được; trường hợp này phải fail closed, không xóa lock và không mở Chrome mới.

## Bản đồ mã hiện có tại thời điểm audit

### aiobox

| Việc | Nơi | Ghi chú |
|---|---|---|
| Đường dẫn profile | `desktop/src-tauri/src/paths.rs` · `profiles_root()` | Một định nghĩa duy nhất; 9 chỗ dùng đi qua hàm này, gồm `cdp/engine.rs`, `profile/clone.rs`, `profile/storage.rs`, `profile/identity.rs`. |
| Dữ liệu CDP riêng của app | `paths.rs` · `cdp_root()`, `registry_file()`, `widen_scripts_dir()`; `cdp/inject.rs` | Hiện nối từ `~/.aki/aiobox/cdp`; registry và shared scripts ở lại đây. |
| Thuật toán clone | `profile/clone.rs` | Chép theo allowlist, SQLite qua `VACUUM INTO`, verify sau chép, tráo thư mục nguyên tử bằng `.incoming` / `.prev`. |
| Mở Chrome | `cdp/engine.rs` · `launch()`, `show_or_launch()` | Trạng thái “đang chạy” nằm trong `registry()` in-memory; `MAX_CONCURRENT_PROFILES = 6`. |
| Kiểm browser còn sống | `browser/discovery.rs` · `is_browser_running` | Đọc `SingletonLock` rồi `kill(pid, 0)`; hiện áp cho Chrome gốc, chưa áp cho clone trước khi launch. |
| Đặt tên | `browser/discovery.rs` · `profile_id` | `<slug trình duyệt>-<slug thư mục>`, lowercase, ký tự lạ → `-`. |
| Metadata clone | `profile/storage.rs` | `.aiobox-clone.json` trong mỗi clone. |
| Registry có absolute profile path? | `~/.aki/aiobox/cdp/registry.json` | Audit cũ chỉ chạy `grep -c "aiobox/cdp/profiles"` và nhận exit 1/no match; đây là bằng chứng rằng chuỗi path cũ không xuất hiện, chưa phải chứng minh schema không thể chứa path ở dạng khác. Phải re-check trước migration. |

Ghi chú drift: `docs/research/desktop-user-psychology-branch-map.md` từng ghi giới hạn 10 profile đồng thời, code ghi 6; đây là lệch tài liệu độc lập, không cần chặn migration nhưng không được dùng số 10 để thiết kế concurrency.

### akimcp

| Việc | Nơi | Ghi chú |
|---|---|---|
| Đường dẫn clone | `scripts/chrome-profile.js` · `CHROME_CLONES_DIR = USER_DIR/chrome-clones` | `USER_DIR` từ `userdata.js`: prod là `~/.aki/mcpsv`, dev là `~/.aki/mcpsv-dev`; hiện dev/prod có thể tạo hai kho riêng. Gốc chung mới không được phụ thuộc `USER_DIR`. |
| Thuật toán clone | `chrome-profile.js` · `cloneProfile`, allowlist, `copyDirRecursive` | Bản JS của cùng một trách nhiệm mà aiobox đã làm tốt hơn; chỉ `launchChrome` gọi. |
| Mở/dừng Chrome | `chrome-profile.js` · `launchChrome`, `stopChrome` | Được expose qua `chrome-mcp.js` tools `chrome_launch` / `chrome_stop`. |
| Port/session | `chrome-profile.js` · `getActivePort`, `SESSION_FILE` | Một session file `USER_DIR/chrome-session.json`; audit cũ không thấy file này trên đĩa. `getActivePort` trả port đã lưu mà chưa probe endpoint. |
| Tool contract | `chrome-mcp.js` | `chrome_launch` nhận `profile`, `browser`, `refresh`, `headless`; `refresh` phải biến mất khi akimcp không còn clone. |
| Docs/tests | `README.md` khoảng dòng 231, 274; `CHANGELOG.md` khoảng dòng 86; `test/chrome-profile.test.js`; `test/chrome-mcp.test.js` | Block CHANGELOG đã phát hành không sửa; thêm thay đổi vào `[Unreleased]`. Audit cuối 2026-10-01 đã đọc hai test: `chrome-profile.test.js` chỉ kiểm browser/profile discovery, parse `DevToolsActivePort`, API active session và `stopChrome()` smoke test; `chrome-mcp.test.js` chỉ kiểm registration/handler presence, chưa có coverage cho clone/launch/attach ownership. |

## Hai thuật toán clone đang trùng như thế nào

Cả hai cùng có allowlist đại loại gồm `Preferences`, `Secure Preferences`, `Cookies`, `Web Data`, `Local Storage/leveldb`, `IndexedDB`, `Extensions`, cùng tráo thư mục và bỏ lock files. Cả hai đều không chép `Login Data`, nên câu hỏi cũ “akimcp có clone kho mật khẩu không” đã đóng: không.

| Điểm | aiobox | akimcp |
|---|---|---|
| SQLite `Cookies`, `Web Data` | `VACUUM INTO`, tạo snapshot nhất quán khi nguồn đang ghi | `copyFileSync` file đang mở, có thể lệch với WAL |
| Verify sau chép | Có `verify_clone` | Không |
| `Trust Tokens` | Có | Không |
| Quyền thư mục | 0700 | Mặc định |
| Metadata nguồn | `.aiobox-clone.json` | `.aki-clone.json`, schema khác |
| Tên thư mục | `chrome-profile-6` | `chrome-Profile_6` |
| Tắt restore session cũ / gỡ tokenizer extension | Có | Không |

Kết luận: giữ cả hai thuật toán không mang lại redundancy hữu ích; nó tạo hai cách đặt tên, hai metadata và hai chất lượng clone khác nhau. Chỉ giữ implementation aiobox.

## Hợp đồng thư mục chung

1. Vị trí canonical: `~/.aki/cdp/profiles/<slug-browser>-<slug-profile>/`; slug theo `profile_id` của aiobox: lowercase, ký tự không phải chữ/số → `-`, trim `-` hai đầu.
2. Mỗi thư mục chứa user-data-dir hoàn chỉnh cho một clone, gồm `Local State` và đúng profile con như `Profile 6`.
3. Chỉ aiobox tạo/tạo lại clone. Consumer khác chỉ mở hoặc attach; thiếu profile thì báo rõ phải tạo profile đó trong aiobox.
4. Trước khi mở, rename, xóa hoặc tráo thư mục profile, đọc `SingletonLock`:
   - owner còn sống: không dọn file, không mở Chrome thứ hai; consumer cần điều khiển thì đọc `DevToolsActivePort`, probe CDP rồi attach nếu hợp lệ;
   - pid chết hoặc không có owner: có thể dọn stale lock/port rồi mở;
   - trạng thái owner không xác định, gồm hostname lock không còn khớp: fail closed, không dọn và không mở.
5. `DevToolsActivePort` chỉ là candidate. Mỗi lần đọc phải probe endpoint CDP như `/json/version`; probe thất bại thì coi port không usable.
6. Không đổi tên/xóa/tráo một thư mục đang có owner.
7. Không cần registry hoặc lock tầng ứng dụng mới cho shared storage; filesystem lock của Chrome + live CDP probe là contract tối thiểu.
8. Dữ liệu app-specific không đi vào gốc chung: aiobox `registry.json`, shared scripts, usage state vẫn ở namespace aiobox; akimcp session/config vẫn ở namespace akimcp nếu còn cần.

## Mối nguy bắt buộc xử lý trước migration

| ID | Nơi | Hiện tượng nếu dùng chung ngay | Vì sao trước đây chưa nổ | Cách xử lý |
|---|---|---|---|---|
| H1 | aiobox `cdp/engine.rs` · `cleanup_stale_profile_locks` trong `launch` | Xóa vô điều kiện `SingletonLock`, `SingletonSocket`, `SingletonCookie`, `DevToolsActivePort`. Nếu Chrome do akimcp đang giữ, aiobox có thể mở Chrome thứ hai trên cùng data dir, dẫn tới hai process cùng ghi `Cookies`/LevelDB. | `is_running(id)` chỉ biết process do chính aiobox registry mở; kho trước đây riêng. | Trước cleanup, kiểm owner của `SingletonLock`; owner còn sống/không xác định thì không cleanup và không launch. |
| H2 | akimcp `launchChrome` | Luôn xóa `DevToolsActivePort` trước launch. Nếu profile đang chạy, file port của Chrome sống bị mất; Chrome mới chuyển lệnh cho process cũ rồi thoát, akimcp chờ tối đa 15 giây rồi timeout. | Kho akimcp trước đây không có consumer khác. | Nếu owner sống, giữ nguyên file, đọc port + probe và trả `status: attached`; nếu owner sống nhưng port thiếu/dead thì fail rõ `in use but not attachable`, không cleanup/launch; chỉ cleanup khi owner chết. |
| H3 | akimcp `cloneProfile(refresh=true)` | Rename data dir đang dùng sang `.old` rồi xóa, có thể rút thư mục khỏi dưới chân Chrome sống. | Không ai chủ động refresh lúc profile đang mở. | Xóa toàn bộ clone/refresh khỏi akimcp; ownership clone chỉ còn aiobox. |
| H4 | akimcp `getActivePort` | Trả port cache mà không biết endpoint còn sống. | Một session, ít drift. | Probe CDP trước khi trả; failure → không có active session. |
| H5 | aiobox `MAX_CONCURRENT_PROFILES` | Chỉ đếm Chrome do aiobox registry quản lý, không đếm process do tool khác mở. | Chưa có shared storage. | Chấp nhận cho phiên bản đầu; ghi rõ đây là app-local cap chứ không phải global shared-profile cap. |
| H6 | akimcp `stopChrome` + session state | Audit cuối xác nhận `stopChrome()` lấy `activeSession.pid`/`SESSION_FILE.pid` rồi `SIGTERM`. Nếu attach vào Chrome do aiobox sở hữu mà ghi pid đó như session bình thường, `chrome_stop` mặc định có thể giết process của aiobox. | Trước shared storage, mọi active session akimcp đều do chính akimcp spawn. | Session phải ghi ownership rõ (`owned: true/false` hoặc tương đương). Attach session không được trở thành killable default; `chrome_stop` không có explicit pid chỉ được terminate session do akimcp spawn. Explicit `pid` giữ semantics caller-directed hiện tại. |

H1–H3 và H6 là blocker. H4 là correctness bắt buộc cùng patch akimcp. H5 là giới hạn đã biết nhưng không đáng thêm shared registry chỉ để đếm.

## Patch plan — aiobox

1. `desktop/src-tauri/src/paths.rs`: thêm helper cho gốc trung lập `~/.aki/cdp` nếu cần và đổi `profiles_root()` thành `~/.aki/cdp/profiles`. Giữ nguyên `cdp_root()` = `~/.aki/aiobox/cdp` cho registry/shared scripts.
2. `desktop/src-tauri/src/browser/discovery.rs`: tách logic đọc/kiểm `SingletonLock` trong `is_browser_running` thành helper nhận data-dir bất kỳ; helper cũ tái sử dụng helper mới. Không tạo subsystem ownership mới.
3. `desktop/src-tauri/src/cdp/engine.rs` · `launch`: trước `cleanup_stale_profile_locks`, kiểm owner. Owner sống → lỗi rõ có pid, không cleanup/launch. Owner không xác định → lỗi rõ, không cleanup/launch. Owner chết/không có → cleanup stale files rồi đi flow hiện tại.
4. Bản đầu không attach một process lạ vào aiobox registry. Việc này sẽ đổi lifecycle/death detection và không cần để đạt mục tiêu shared storage.
5. Đảm bảo clone/delete/replace path của aiobox không rename/xóa một profile đang có owner theo cùng contract.
6. Cập nhật references/path trong docs và các file phụ đang ghi đường dẫn cũ: `docs/ref/cdp.md`, `docs/arch/multi-profile-cdp-sketch.md`, `docs/arch/tauri-cdp-shipment.md`, `docs/index.md`, `labs/aiobox/CDP_PLAN.md`, `labs/aiobox/cdp.js`. Bỏ qua `.claude/worktrees/*` vì là bản sao worktree cũ.
7. Trước migration, xác minh schema `registry.json` và code consumer không lưu absolute path tới `~/.aki/aiobox/cdp/profiles`; grep cũ chỉ là bằng chứng sơ bộ.
8. Sửa doc drift 10 vs 6 ở nơi phù hợp nếu file đó vẫn còn authoritative; không để task shared-CDP vô tình thay runtime cap.

### Tiến độ aiobox

- Bước 1: `paths.rs` có `shared_cdp_root()` = `~/.aki/cdp`; `profiles_root()` = `~/.aki/cdp/profiles`; `cdp_root()` giữ `~/.aki/aiobox/cdp`.
- Bước 2: helper nằm ở `platform/browser_lock.rs` (`state`, `require_free`, `guard_write`, `clear_stale`); `browser/discovery.rs` · `is_browser_running` dùng lại `state`.
- Bước 3: `cdp/engine.rs` · `launch` gọi `browser_lock::clear_stale` sau kiểm ps; `cleanup_stale_profile_locks` đã bỏ. Owner sống hoặc không xác định thì lỗi, không dọn, không launch.
- Bước 4: **Xong (2026-10-03).** `os_process::chrome_mains_under` bỏ qua mọi Chrome có `--aki-launcher=` khác `aiobox`, nên `engine::adopt`, `live_chrome_for` và trang Processes không nhận Chrome do akimcp mở (`--aki-launcher=akimcp`). AIObox mở Chrome kèm `--aki-launcher=aiobox` (`engine::build_args`). Chrome không có cờ (mở trước bản này) vẫn được adopt như cũ. Decided (trang Processes cũng ẩn Chrome của akimcp) · because Processes chỉ liệt kê thứ AIObox điều khiển được (Stop, Reconnect); hiện Chrome của akimcp ở đó mời bấm Stop/Reconnect vào tiến trình của tool khác · rejected hiện dạng hàng chỉ đọc "akimcp" (thêm UI cho tiến trình AIObox không được động vào) · reopen if chủ cần thấy Chrome nào đang giữ profile khi AIObox báo `ProfileAlreadyRunning`.
- Bước 5: `profile/clone.rs` (trước khi tráo), `profile/storage.rs` (`delete_profile_dir`, `remove_extension`), `signin_sync.rs`, `cleanup.rs` đi qua cùng contract. Trên Windows `guard_write` chưa kiểm (Chrome tự khóa file).
- Bước 6: docs và `desktop/scripts/purge-extension-from-profiles.mjs` đã trỏ gốc mới. `labs/aiobox/cdp.js` dùng thư mục Chrome mặc định nên không đổi.
- Bước 7: `registry.rs` chỉ lưu `profile_folder` tương đối; `registry.json` và `windows.json` không chứa path tuyệt đối tới profile.
- Bước 8: số 10 nằm trong tài liệu research không sửa; chỉ ghi chú ở đây, code giữ cap 6.
- Migration bước 4–5 do app tự làm (chủ gặp lỗi `No such file or directory` khi mở Facebook trên build mới chưa dời dữ liệu, 2026-10-03): `storage::move_legacy_clones` chạy lúc khởi động và trước mỗi lần mở, `rename` từng clone từ `~/.aki/aiobox/cdp/profiles` sang gốc chung; clone có Chrome sống hoặc khóa không xác định thì ở lại, trùng tên ở gốc mới thì ở lại. Mở một profile còn ở gốc cũ thì báo rõ phải thoát Chrome đó (`storage::legacy_clone_error`). Decided · because chủ không phải tự `mv`, và Chrome đang giữ thư mục không bao giờ bị dời dưới chân · rejected `profiles_root()` đọc cả hai gốc (hai nguồn sự thật), dời cả thư mục một lần (một Chrome sống chặn tất cả) · reopen if có máy mà hai gốc nằm trên hai filesystem khác nhau (`rename` lỗi, clone ở lại và log cảnh báo).
- Sự cố 2026-10-03 (P7·W1): build mới làm mọi panel offline vì `adopt` chỉ quét gốc mới, Chrome còn sống trên gốc cũ không được adopt. Đã sửa (P2·W3): `engine::live_chrome_for` quét cả gốc mới và gốc cũ (`legacy_profiles_root`), dùng cho adopt và launch; trang Processes liệt kê Chrome ở cả hai gốc; bỏ qua Chrome có `--aki-launcher=akimcp` (bước 4); AIObox mở Chrome kèm `--aki-launcher=aiobox`. Decided · because Chrome sống qua lần thoát app và build mới, nên đổi gốc vẫn phải nhận Chrome trên thư mục cũ cho tới khi clone được dời · rejected chỉ quét gốc mới (chính lỗi này), bắt chủ thoát Chrome trước khi chạy build mới · reopen if gốc cũ không còn clone nào trên mọi máy (khi đó bỏ quét gốc cũ).
- Dời dữ liệu xong 2026-10-03 12:27: chủ thoát AIObox + Chrome rồi chạy `~/.aki/move-cdp-profiles.sh`; 26/26 profile ở `~/.aki/cdp/profiles`, gốc cũ rỗng. Sự cố kèm theo: Chrome do script mở lại khi app đã chạy (`--aki-launcher=aiobox`) không được adopt, vì adopt chỉ chạy lúc khởi động, khi mở profile và khi bấm Reconnect. Đã sửa (P2·W3): `engine::spawn_adopt_all` quét mỗi 10 s (một `ps` mỗi lượt, chỉ adopt Chrome AIObox chưa có session, thuộc profile đã đăng ký); pid adopt lỗi chỉ cảnh báo một lần và nằm ở Processes dạng untracked; `launch` đánh dấu profile đang mở (`launching`) dưới cùng khóa `ADOPTING` để lượt quét không gắn session thứ hai vào Chrome vừa spawn. Decided · because Chrome AIObox mở từ ngoài app (script, lần chạy trước) phải có panel mà không cần bấm · rejected chỉ adopt lúc khởi động (chính lỗi này), quét theo từng profile đăng ký (26 lần `ps` mỗi lượt) · reopen if `ps` mỗi 10 s đo được tốn CPU đáng kể. `~/.aki/aiobox-restart.mjs` (ngoài repo, P7·W2 giữ, không thuộc patch này): khi không còn Chrome nào, dùng ảnh chụp gần nhất còn cửa sổ thay vì ghi ảnh chụp rỗng.
- Verification aiobox đã có bằng unit test: owner sống giữ nguyên file, host lạ fail closed, owner chết thì file stale bị dọn. Các ca chéo với akimcp chưa chạy.

## Patch plan — akimcp

1. `scripts/chrome-profile.js`: thay `CHROME_CLONES_DIR = USER_DIR/chrome-clones` bằng gốc độc lập `~/.aki/cdp/profiles`. Nếu cần testability có thể nhận env override, nhưng default không phụ thuộc dev/prod `USER_DIR`.
2. Xóa `cloneProfile`, allowlist clone, `copyDirRecursive`, `removeStrayLockFiles`, `pruneAndCopyLocalState`, metadata clone riêng và tham số/flow `refresh` — khoảng 150 dòng theo audit cũ. Không giữ “fallback clone” vì nó tái tạo đúng duplication đang loại bỏ.
3. Suy ra browser/profile con từ clone directory thay vì đọc metadata aiobox: profile con ưu tiên cấu trúc directory và `profile.last_used` trong `Local State` (aiobox đã cắt `Local State` về profile tương ứng); browser lấy từ slug đầu directory. Không phụ thuộc `.aiobox-clone.json` hay `registry.json`, để contract giữa tools chỉ là filesystem layout + Chrome semantics.
4. Slug/browser không hỗ trợ, caller `browser` mâu thuẫn canonical slug hoặc cấu trúc directory không hợp lệ → lỗi rõ; không đoán/fallback.
5. Thiếu canonical profile → lỗi hướng dẫn tạo profile trong aiobox; akimcp không tự clone.
6. `launchChrome`: owner sống → không xóa gì, đọc `DevToolsActivePort`, probe endpoint; port hợp lệ → tạo session `attached`/`owned:false` và trả `status: attached`; port thiếu/dead → lỗi `profile in use but not attachable`, không cleanup/launch. Owner chết/không có → cleanup stale port/lock cần thiết rồi launch như hiện tại với session `owned:true`; owner không xác định → fail closed.
7. Giữ đúng API semantics khi attach: `headless` chỉ áp dụng khi spawn process mới; nếu caller truyền `url` khi profile đã chạy thì không được silently bỏ qua — mở URL trên browser đang attach qua CDP hoặc trả lỗi/contract rõ nếu chưa hỗ trợ, rồi test hành vi đã chọn.
8. `getActivePort`: mọi port từ session/cache/file đều probe trước khi trả; failure → clear/ignore stale state theo flow hiện có.
9. `stopChrome`: mặc định chỉ `SIGTERM` khi active/persisted session có `owned:true`; attached session chỉ clear state/return not-owned, không giết owner process. Explicit `pid` tiếp tục là hành động caller-directed như tool hiện tại.
10. `chrome-mcp.js`: bỏ `refresh` khỏi schema/mô tả `chrome_launch`; cập nhật mô tả `chrome_stop` để ownership semantics không gây hiểu nhầm; giữ `profile`, `browser`, `headless` theo contract trên.
11. Cập nhật `README.md` tại các đoạn mô tả clone/launch/stop; thêm thay đổi vào `[Unreleased]` của `CHANGELOG.md`, không sửa block release cũ.
12. Cập nhật `test/chrome-profile.test.js`, `test/chrome-mcp.test.js`: hiện hai file chưa cover clone/launch/attach ownership; thêm cases canonical path, missing profile, owner-live attach, owner-live-but-unattachable, stale port probe, dead-owner cleanup, unknown-owner fail closed, attached-session stop không kill foreign pid, owned-session stop vẫn kill, và semantics `url` khi attach.

### Tiến độ akimcp

- Bước 1: `scripts/chrome-profile.js` `profilesRoot()` = `AKI_CDP_PROFILES_DIR` hoặc `~/.aki/cdp/profiles`; không phụ thuộc `USER_DIR`.
- Bước 2: bỏ `cloneProfile`, allowlist, `copyDirRecursive`, `removeStrayLockFiles`, `pruneAndCopyLocalState`, `.aki-clone.json`, `refresh`. Kho cũ `~/.aki/mcpsv/chrome-clones` không còn được đọc và đã xóa 2026-10-03 (migration bước 10).
- Bước 3–5: `resolveSharedProfile`: `Profile 14` → `chrome-profile-14`, id canonical nhận thẳng; browser lấy từ tiền tố `chrome`/`brave`/`edge`, lệch với `browser` của caller thì lỗi. Profile con = `Local State` `profile.last_used` nếu có `Preferences`, không thì thư mục con duy nhất có `Preferences`, còn lại lỗi. Thiếu clone thì lỗi bảo tạo trong aiobox.
- Bước 6: `readOwner`: unix readlink `SingletonLock` `<host>-<pid>`, host khác `os.hostname()` hoặc không parse được → không xác định; `kill(pid, 0)` (EPERM coi là sống); win32 thử xoá `lockfile`, EBUSY/EPERM = sống. Sống → đọc `DevToolsActivePort`, probe `/json/version` → `status: attached`, `owned: false`; probe hỏng → lỗi `in use but not attachable`, không dọn. Chết/không có → chỉ xoá `SingletonLock`, `SingletonSocket`, `SingletonCookie`, `DevToolsActivePort` rồi spawn, `owned: true`. Không xác định → fail closed.
- Bước 7: attach có `url` → mở tab mới qua `PUT /json/new`; `headless` chỉ áp dụng khi spawn.
- Bước 8: `getActivePort` async, probe trước khi trả, chết thì xoá session; một `resolvePort` dùng chung cho `chrome_*` và `devtools_*`.
- Bước 9: `chrome_stop` không `pid` chỉ kill khi session `owned: true`; session attached chỉ bị xoá, trả `stopped: false, owned: false`. `pid` rõ vẫn kill như cũ.
- Bước 10–12: mô tả tool, README, CHANGELOG `[Unreleased]`; `test/chrome-profile.test.js` chạy các ca canonical path, thiếu profile, host lạ, owner sống không attach được, attach + `url`, stop attached không kill, port stale, owner chết dọn + spawn (binary giả), stop owned kill; `test/chrome-mcp.test.js` kiểm schema không còn `refresh`.
- Runtime 2026-10-03 sau migration: `~/.aki/cdp/profiles` có 26 profile (thiếu profile 9), `~/.aki/aiobox/cdp/profiles` rỗng.
- Thử chéo trên gốc mới 2026-10-03 (`~/.aki/mcpsv/task/cdp-unified-clone/cross-attach-new.mjs`, `cross-spawn.mjs`): 4 Chrome aiobox (profile 8, 10, 11, 14) → `attached`, `owned: false`, `chrome_stop` không kill; profile 38 không owner → spawn headless `status: ready`, `owned: true`, CDP probe được, ps có `--aki-launcher=akimcp`, sau 9 s `windows.json` không có nó (aiobox không adopt), `chrome_stop` kill được. Ca "aiobox mở profile đang do akimcp giữ": đường code đã đúng và có unit test (`os_process.rs` lọc Chrome mang cờ akimcp khỏi adopt/`live_chrome_for`; `engine.rs` `launch` → `browser_lock::clear_stale` trả `ProfileAlreadyRunning` khi owner sống; `browser_lock.rs` test owner sống); chưa bấm thật trên app, làm khi tiện (akimcp mở `chrome-profile-38` = P26, bấm P26 trong AIObox).
- Thử chéo 2026-10-03, chỉ đọc, không dời dữ liệu (`AKI_CDP_PROFILES_DIR` = gốc cũ `~/.aki/aiobox/cdp/profiles`, script `~/.aki/mcpsv/task/cdp-unified-clone/cross-attach.mjs`): 3 Chrome aiobox đang chạy (profile 8, 10, 14) → `status: attached`, `owned: false`, port probe được; `chrome_stop` trả `stopped: false` và cả 3 pid còn sống; 23 profile còn lại `dead`/`none` nên không mở gì.
- Liên quan aiobox bước 4 (mở, việc của aiobox vì § Quyết định đã loại foreign-process adoption ở MVP): akimcp chỉ spawn khi gọi `chrome_launch` và profile không có owner, với `--user-data-dir=<clone> --remote-debugging-port=0 --aki-launcher=akimcp` (2026-10-03). Cờ `--aki-launcher=akimcp` là dấu nhận biết: aiobox gặp cờ này thì bỏ qua, không nhận vào registry (đã làm 2026-10-03, `os_process::launched_by_other_tool`). Attach không bị ảnh hưởng.
- Root sau quyết định dời dữ liệu (2026-10-03): akimcp chỉ đọc/attach/mở ở `~/.aki/cdp/profiles` (`chrome_launch`, `chrome_profiles`), không đọc gốc cũ `~/.aki/aiobox/cdp/profiles`, không tạo thư mục profile; `test/aiobox-contract.test.js` không chứa path profile. Kho `~/.aki/mcpsv/chrome-clones` đã xóa (kiểm lại 2026-10-03: không còn).

## Thứ tự triển khai và migration

Nguyên tắc: code phải hiểu path mới trước khi dữ liệu được dời; không dời profile khi bất kỳ Chrome nào còn giữ nó.

1. Dò lại runtime hiện tại: process/lock/port cho tất cả canonical candidates; không dùng các port snapshot 2026-09-28 như trạng thái hiện tại.
2. Xác minh registry/path assumptions của aiobox; dùng baseline test đã đọc ngày 2026-10-01 để bổ sung coverage ownership/attach trước khi đổi behavior.
3. Patch + verify aiobox cho path mới và H1/ownership handling trước. Chưa dời dữ liệu nếu app build đang dùng vẫn trỏ path cũ.
4. Tắt app aiobox và mọi Chrome đang dùng các clone cần dời. Trước `mv`, xác minh từng `SingletonLock` không còn owner sống; trạng thái không xác định thì dừng migration thay vì xóa lock.
5. Tạo `~/.aki/cdp/` nếu cần rồi move nguyên thư mục `~/.aki/aiobox/cdp/profiles` → `~/.aki/cdp/profiles`. Cùng filesystem nên đây là rename nguyên tử ở mức filesystem, rẻ và có rollback bằng move ngược; không đụng `registry.json` hay `shared/`.
6. Mở build aiobox mới, kiểm registry/account mapping và mở vài profile đại diện để xác nhận login còn nguyên, CDP lên, metadata còn hợp lệ.
7. Patch + verify akimcp theo plan trên, trỏ đúng canonical root và attach vào owner-live thay vì clone.
8. Chạy test chéo hai chiều trên một profile không quan trọng theo matrix bên dưới.
9. Chrome `Profile 9` ("vams main"): không thuộc migration. Kiểm 2026-10-03: không có trong `registry.json` và không có clone, tức chưa từng được thêm vào AIObox (clone akimcp cũ đã mất trước khi xóa kho); Chrome thật còn nguyên. Khi cần điều khiển qua CDP thì thêm vào AIObox như mọi profile. Lưu ý: số `P#` của AIObox là `number` trong registry, không phải số thư mục Chrome (P9 = `chrome-profile-18`).
10. Xóa thẳng kho cũ `~/.aki/mcpsv/chrome-clones` (và `~/.aki/mcpsv-dev/chrome-clones` nếu có), không archive, không chờ chu kỳ, không chọn theo freshness: clone aiobox là chuẩn (chủ chốt 2026-10-03). Trước khi xóa, từng clone phải không còn Chrome sống giữ (`SingletonLock` + ps); sống hoặc không xác định thì bỏ qua clone đó. Đã làm 2026-10-03: chỉ còn `chrome-Profile_14` (lock → pid 83367 đã chết, không process nào dùng path) và đã xóa; `mcpsv-dev` không có kho.
11. Chỉ sau khi verification hoàn tất mới coi migration xong; nếu cần rollback, đóng Chrome và move `~/.aki/cdp/profiles` ngược về `~/.aki/aiobox/cdp/profiles`, rồi dùng build aiobox cũ.

## Verification matrix

| Ca | Kết quả mong đợi |
|---|---|
| akimcp mở canonical profile chưa chạy | Chrome lên một lần, CDP probe thành công, trả `status: ready`. |
| aiobox mở profile đang do akimcp giữ | Lỗi rõ có owner/pid; không có Chrome thứ hai; `SingletonLock` và `DevToolsActivePort` không bị xóa. |
| akimcp mở profile đang do aiobox giữ | Không launch process mới; đọc + probe port rồi trả `status: attached`, session đánh dấu `owned:false`. |
| Owner sống nhưng `DevToolsActivePort` thiếu hoặc endpoint chết | akimcp báo profile đang được giữ nhưng không attach được; không xóa lock/port, không launch Chrome thứ hai. |
| Gọi `chrome_stop` sau khi akimcp attach Chrome của aiobox | Không `SIGTERM` foreign owner; chỉ clear attached-session state hoặc trả `not-owned`. |
| Gọi `chrome_stop` trên Chrome do akimcp tự launch | Vẫn terminate đúng owned pid và clear session state. |
| `chrome_launch` có `url` khi profile đã do tool khác giữ | Hành vi phải được định nghĩa và test: URL được mở trên attached browser qua CDP hoặc trả lỗi rõ; không silently ignore. |
| Hai bên cùng điều khiển một tab, ví dụ usage watcher aiobox + `devtools_eval` akimcp | Chưa từng test ở audit cũ; cần xác nhận cả hai CDP clients coexist mà không phá session/target state và ghi kết quả vào tài liệu runtime/CDP phù hợp. |
| Kill Chrome đột ngột rồi mở lại từ mỗi bên | Stale owner/port được nhận diện; cleanup chỉ xảy ra sau khi chứng minh owner đã chết; launch lại được. |
| `DevToolsActivePort` còn file nhưng endpoint chết | Không attach; file bị coi stale và đi flow cleanup/launch phù hợp. |
| `SingletonLock` trỏ host không xác định | Fail closed; không xóa lock, không launch. |
| Canonical profile không tồn tại trong akimcp | Lỗi hướng dẫn tạo profile qua aiobox; không clone ngầm. |
| Dời profiles root xong | aiobox vẫn map đúng account/profile, login còn dùng được, registry/shared scripts không bị dời. |
| Profile 9 | Được aiobox clone mới từ Chrome source, xuất hiện đúng canonical id/metadata rồi akimcp dùng được. |

Verification khi triển khai phải theo rung nhỏ nhất: static read/typecheck/unit liên quan trước; build khi batch code hoàn tất; runtime cross-tool chỉ cho những tính chất thực sự phụ thuộc Chrome/CDP concurrency.

## Các giả định và điểm phải re-check trước khi code/migrate

- Hai test akimcp chưa được đọc trong audit 2026-09-28 đã được đọc ở audit cuối 2026-10-01: hiện chỉ là smoke/basic registration coverage, chưa kiểm clone/launch/attach/ownership; patch phải bổ sung coverage nêu trên.
- `registry.json` không chứa chuỗi path cũ theo grep, nhưng cần xác minh schema/code path consumer trước khi move.
- Số lượng 26 vs 27 profile giữa đĩa và plan/registry cũ chưa được giải thích.
- Hai port akimcp cũ 52007 và 53584 chưa được probe trong snapshot; không còn ý nghĩa để quyết định migration hiện tại, nhưng là bằng chứng audit chưa hoàn tất 100% runtime sweep.
- Scan consumer khác mới xem 20/31 `Local State`. Trước khi xóa kho cũ (2026-10-03) đã grep lại `/Volumes/DEV/pj` và `~/.aki/**/*.json` cho `chrome-clones`: không còn code/config nào tham chiếu, chỉ docs/CHANGELOG mô tả lịch sử.
- Hai clone cùng login có làm refresh token invalidation hay không chưa đo; sau migration mỗi profile chỉ còn một clone nên câu hỏi không còn là blocker, nhưng vẫn có thể giải thích session drift lịch sử.
- Cổng Cursor 61572 chưa xác nhận CDP; ngoài scope.
- `SingletonLock` hostname có thể đổi theo môi trường mạng; unknown-owner phải fail closed.
- Cách `cdp/engine.rs` dựng launch args như `--app` chưa được đọc trong audit cũ; không thay đổi quyết định shared root nhưng cần giữ nguyên semantics khi patch launch.
- Runtime cap aiobox = 6 là app-local theo code audit; consumer ngoài aiobox không được tính vào cap này trong phiên bản đầu.
- Dependency “chỉ aiobox tạo clone” nghĩa là máy chỉ cài akimcp sẽ không tự tạo canonical profile. Đây là tradeoff có chủ ý để xóa implementation clone yếu hơn; reopen nếu akimcp thực sự phải hoạt động độc lập mà không có aiobox.

## Deep-think decision record

### Goal chain

Một working plan duy nhất → một source of truth cho shared-CDP → một canonical clone cho mỗi browser profile → giảm dữ liệu trùng/drift và loại bỏ hai thuật toán clone → mọi tool điều khiển cùng browser state an toàn qua contract tối thiểu của Chrome thay vì ownership system riêng.

### Facts, constraints, assumptions

- Fact: hai tool có clone logic trùng trách nhiệm nhưng khác chất lượng và naming.
- Fact: shared directory làm lộ H1–H3 vốn được che bởi việc mỗi tool có kho riêng.
- Constraint: không được làm hai Chrome cùng ghi một user-data-dir.
- Constraint: live owner/port phải lấy từ Chrome state và probe, không từ một registry mới có thể drift.
- Constraint: migration phải giữ login hiện có.
- Assumption cần theo dõi: aiobox registry không phụ thuộc absolute profile path; re-check trước move.
- Assumption được chấp nhận: aiobox là clone authority; akimcp phụ thuộc profile đã được provision.

### Critique và phương án bị loại

- Giữ hai file plan + audit có ưu điểm tách “kết luận” khỏi “evidence”, nhưng trong task này cả hai cùng mô tả một migration chưa triển khai và đã trùng nhiều phần; hai source dễ drift hơn giá trị lịch sử chúng đem lại. File hợp nhất giữ snapshot/evidence thành section riêng nên không mất provenance.
- Để cả aiobox và akimcp cùng biết clone nghe có vẻ resilient hơn, nhưng thực tế giữ hai implementations, hai metadata, hai quality levels và H3. Bị loại.
- Tạo một daemon/shared registry quản lý ownership có thể cho global cap/lease sạch hơn, nhưng thêm state thứ ba ngoài `SingletonLock` và `DevToolsActivePort`, trái mục tiêu giảm complexity. Bị loại cho phiên bản đầu.
- Cho aiobox tự attach mọi Chrome lạ thay vì fail khi profile có owner sẽ cho UX đẹp hơn, nhưng kéo foreign process vào lifecycle registry/death detection của aiobox và mở scope lớn. Bị loại khỏi MVP; akimcp attach là đủ để chứng minh shared root.
- Chỉ đổi path mà không sửa lock/port flow là cách bảo đảm migration thất bại: H1–H3 có thể gây duplicate process, timeout giả hoặc corruption.
- Pre-mortem chính: sáu tháng sau shared root bị coi là “không ổn định” vì một consumer xóa lock/port của consumer khác, hoặc registry aiobox âm thầm phụ thuộc path cũ. Hai failure mode này được chặn bằng ownership contract + pre-migration schema verification.
- Second-order effect: tool tương lai có thể dùng cùng storage mà không biết internals aiobox nếu contract chỉ dựa vào canonical naming, Chrome lock và CDP probe; đó là lý do không cho akimcp đọc `.aiobox-clone.json`/registry.
- Audit hậu kỳ phát hiện ownership không chỉ ảnh hưởng launch mà còn ảnh hưởng stop: attach mà không phân biệt `owned` sẽ biến `chrome_stop` thành đường giết process của tool khác. Vì vậy ownership bit trong session là phần của contract, không phải implementation detail tùy chọn.

### Quyết định

Decided: một canonical `~/.aki/cdp/profiles`, chỉ aiobox provision clone, consumer dùng lock + verified port để mở/attach và session phải phân biệt process mình spawn với process chỉ attach · because đây là thay đổi nhỏ nhất vừa xóa duplication vừa làm ownership tự nhiên theo semantics Chrome mà không tạo đường stop nhầm foreign process · rejected hai clone implementations, shared registry mới, và aiobox foreign-process adoption ở MVP · reopen nếu akimcp cần provision profile độc lập, nếu Chrome lock semantics không đủ trên môi trường mục tiêu, hoặc nếu consumer thứ ba cần lifecycle/global concurrency mà contract hiện tại không diễn đạt được.

## Ranh giới hiện tại

- Patch aiobox và akimcp đã có trong code; profile đã dời sang `~/.aki/cdp/profiles` (2026-10-03, chủ chạy script), chưa sửa shared rules.
- Các path/port/process trong snapshot phải được re-check trước execution; không dùng chúng như live state.
- `registry.json` của aiobox chứa thông tin tài khoản; không trích nội dung nhạy cảm vào plan.
- Khi task được triển khai xong và verification đạt, plan này mới chuyển sang trạng thái done; cho tới lúc đó nó là working execution source of truth.
