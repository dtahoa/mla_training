# Coursera Study Assistant — IBM "The AI Transformation Advisor"

PoC theo plan trong [`docs/auto_learn_ibm_course.md`](../docs/auto_learn_ibm_course.md): một **AI learning assistant
human-in-the-loop** chạy local trên Windows (Node.js + Playwright), bắt đầu với Course 1.

Tool giúp bạn: điều hướng, theo dõi tiến độ, pause/resume, capture transcript/reading thành ghi chú,
AI tóm tắt + giải thích, quiz luyện tập từ ghi chú. Tool **không** học hộ.

## Guardrails (cố định trong code, không có cờ tắt)

| Không bao giờ | Ở đâu trong code |
|---|---|
| Đọc, trả lời, điền hay nộp practice/graded quiz, assignment, exam, peer review | `src/guard.ts` + `assertCaptureAllowed()` trong `src/capture.ts` |
| Gửi nội dung assessment tới AI API (vì không đọc nên không thể gửi) | `guardFor(kind).allowAi` |
| Tua/giả lập xem video | không có code nào làm việc đó |
| Hoàn thành bài trên Coursera ("Mark as completed", Start/End Dialogue) với video / practice / graded item, hoặc khi bạn chưa nhấn `d` mà cũng chưa bật `AUTO_MARK_COMPLETE`; gõ bất cứ gì vào dialogue | `allowMarkComplete` trong `src/guard.ts` + `src/complete.ts` (kiểm tra lại URL trang ngay trước khi bấm) |
| Nhập/lưu mật khẩu, bypass CAPTCHA/MFA | bạn tự login trong Chrome; tool chỉ kiểm tra cookie `CAUTH` có tồn tại |
| Commit session/cookie/nội dung khóa học | toàn bộ nằm trong `.data/` (đã gitignore) |

Phân loại theo kiểu **fail-closed**: item nào không chắc chắn là video/reading đều bị coi là `GRADED`/`OTHER`,
nên rơi vào chế độ manual (bạn tự làm, assistant đứng ngoài).

## Kiến trúc (map với plan)

| Plan | File |
|---|---|
| Node.js Controller (start/pause/resume/progress) | `src/cli.ts`, `src/study.ts` (state machine) |
| Playwright Browser Agent (session, navigation, UI state) | `src/browser.ts`, `src/outline.ts` |
| Study Assistant (tóm tắt, giải thích, practice quiz) | `src/capture.ts`, `src/ai.ts`, `src/study-ai.ts`, `src/review.ts` |
| Assessment Guard | `src/guard.ts`, `src/course.ts` (`classifyItem`) |
| Local Progress Store (JSON, checkpoint, audit log) | `src/store.ts` → `.data/courses/<slug>/` |
| Phase 1 feasibility PoC (DOM findings, blockers) | `src/probe.ts` |

Chrome được mở như trình duyệt bình thường (profile riêng `.data/chrome-profile`, cổng DevTools local 127.0.0.1:9222),
sau đó Playwright attach qua CDP. Nhờ vậy login Google/Coursera hoạt động bình thường, và khi thoát tool,
Chrome vẫn mở và giữ đăng nhập.

## Cài đặt

Cần Node.js ≥ 22.18 (chạy `.ts` trực tiếp, không cần build) và Google Chrome.

```powershell
cd coursera-study-assistant
npm install
copy .env.example .env   # tùy chọn: chỉ cần khi bật AI
```

## Quy trình sử dụng

```powershell
npm run login     # 1. Chrome mở → bạn tự đăng nhập Coursera (chỉ cần làm 1 lần)
npm run probe     # 2. Phase 1: báo cáo DOM/selector/blockers → .data/courses/<slug>/probe/probe-*.md
npm run study     # 3. Phiên học có checkpoint; Ctrl+C hoặc [q] để tạm dừng, chạy lại để học tiếp
npm run status    #    Tiến độ theo module (offline)
npm run quiz      # 4. Quiz luyện tập từ ghi chú đã capture   (-- --module 2 | --module all, --count 5)
npm run ask -- "Vendor due diligence khác technical evaluation thế nào?"
npm run backfill  # 5. Lấy transcript các video đã học trước đó (tab nền) để summary đủ cả course (-- --module 2)
npm run summary   # 6. Học xong: AI tóm tắt kiến thức theo module + cả course (-- --module 2)
```

Mọi lệnh nhận thêm `-- --course <slug>` để chạy cho course khác mà không sửa `.env`, ví dụ
`npm run backfill -- --course assess-ai-readiness` rồi `npm run summary -- --course assess-ai-readiness`.

**Bước 2 quan trọng:** selector được viết dựa trên URL pattern và ảnh chụp màn hình, chưa chạy trên tài khoản
đã login. Sau khi chạy `probe`, hãy gửi file `probe-*.md` (và `probe-*.json`) để chỉnh selector. Report không chứa
giá trị cookie hay thông tin tài khoản, cũng không chứa nội dung khóa học (chỉ có số ký tự).
Thêm `-- --screenshots` nếu muốn có ảnh trang video/reading (ảnh có thể chứa avatar của bạn, kiểm tra trước khi gửi).

### Phím trong `npm run study`

| Phím | Video / Reading | Practice / Graded / Other |
|---|---|---|
| `c` | capture transcript / nội dung → `.data/.../sources` + file ghi chú | — (guard chặn) |
| `a` | AI notes: tóm tắt, khái niệm chính, ví dụ áp dụng, câu hỏi tự kiểm tra | — (guard chặn) |
| `d` | đã học → item tiếp theo (reading: tool bấm "Mark as completed" nếu có nút). **Video: Enter không gõ gì = `d`.** Nếu phiên này mới xem < 90% video thì hỏi lại "(Y/n)", **Enter = có** | "đã tự làm trên Coursera? (Y/n)": **Enter = có** → item tiếp theo. **Other: Enter không gõ gì = `d`**, và tool hoàn thành bài trên Coursera nếu trang có "Mark as completed" hoặc "Start Dialogue/Role Play/Activity" |
| `k` / `l` | `k` bỏ qua tạm | `l` để tự làm sau (hiện trong `status`) |
| `f` | đọc lại trang bạn đang mở trên Chrome (tự điều hướng thoải mái) | |
| `s` | đồng bộ outline + trạng thái completed từ Coursera (tab nền) | |
| `q` | tạm dừng, lưu checkpoint | |

**Video tự chuyển bài:** khi bạn đã phát ≥ 90% video và xem tới cuối, tool tự chọn `d` và mở item tiếp theo, không cần
bấm phím. Tool chỉ đọc trạng thái của thẻ `<video>` (đã phát bao nhiêu); kéo thanh tua tới cuối không được tính. Nếu Coursera
tự mở video kế tiếp, tool tính video trước là đã xem khi lần đo cuối ≥ 90%. Muốn capture hay AI notes thì bấm `c` hoặc `a` trước
khi video hết. Video Coursera tự phát tiếp từ chỗ bạn dừng lần trước thì phiên này không đo đủ 90%: bấm Enter hai lần
(câu hỏi "vẫn đánh dấu đã học?" mặc định là có; gõ `n` nếu muốn ở lại xem tiếp).

Item OTHER (plugin, role play, dialogue, discussion): Enter trống ở menu = `d`, rồi Enter ở câu xác nhận = có.

**Hoàn thành trên Coursera:** với reading và item OTHER (ungraded), sau khi bạn bấm `d`, tool hoàn thành bài trên Coursera
theo một trong hai cách, tùy trang có gì:

- **"Mark as completed"** (tìm cả trong khung plugin): tool bấm, chờ Coursera xác nhận rồi mở bài tiếp.
- **"Start Dialogue" / "Start Role Play" / "Start Activity"**: tool bấm Start. Trang mới (cùng tab hoặc tab mới) hỏi cách tham gia thì
  tool chọn **"Use text chat"** (không bao giờ chọn voice). Tiếp theo tool chờ nút **End** ("End Dialogue" / "End Role Play"…), bấm End,
  trong popup chọn lựa chọn bắt đầu bằng **"I don't have time…"** (dropdown, radio hoặc nút), bấm xác nhận nếu có ("Submit", "End"…),
  rồi đóng tab nó đã mở. Popup không có lựa chọn đó (chờ tối đa 5 giây) thì tool bấm nút **Yes / Confirm / End / Submit** để đóng
  popup; không bao giờ bấm No / Cancel / Close. Tool không gõ gì vào dialogue.

Trang không có cả hai thì tool chỉ đánh dấu local. Một bước không thành thì tool ở lại bài đó, và ghi tên các nút nó thấy trên trang
vào `audit.jsonl` (dòng `mark_completed`) để chỉnh selector. Tool không bao giờ làm việc này trên video, practice hay graded.

**Tự động hoàn toàn:** đặt `AUTO_MARK_COMPLETE=1` trong `.env`. Khi đó, trên reading hoặc item ungraded có một trong hai nút trên,
tool đếm 3 giây rồi tự làm và mở bài tiếp, không cần nhấn phím. Trong 3 giây đó, gõ phím khác (`l`, `f`, `q`) + Enter để dừng.
Các bài liền nhau sẽ được làm lần lượt. Tool dừng lại chờ bạn ở video (tự qua khi xem xong ≥ 90%), ở bài graded, và ở bài không
có nút nào. Mỗi bài chỉ tự làm một lần: nếu không thành, tool để bạn xử lý chứ không lặp lại. Bài Coursera đã tính completed thì bỏ qua.
Mặc định tắt, nên máy nào không đặt biến này thì vẫn chạy như cũ.

Item practice / graded không có phím mặc định: Enter trống ở menu sẽ không làm gì, để một lần Enter lỡ tay không đánh dấu
bài kiểm tra là xong. Với hai loại này, `d` chỉ là trạng thái local; tool không nộp hay bấm gì trên Coursera.

**Transcript video + tóm tắt kiến thức:** mỗi khi mở một video, tool tự lưu transcript (lấy từ captions, hoặc mở panel Transcript)
vào `.data/.../sources` và tạo file ghi chú cho bài đó (tắt bằng `AUTO_CAPTURE=0`). Học xong, chạy `npm run summary`: AI tóm tắt
từng module vào `notes/module-NN/00-module-summary.md` (big picture, khái niệm, framework, pitfalls, ví dụ, câu hỏi ôn tập), rồi
tổng hợp cả course vào `notes/00-course-summary.md` (cheat sheet, glossary, câu hỏi ôn tập tổng hợp). `-- --module 2` chỉ tóm tắt
một module. Chạy lại sẽ ghi đè hai loại file summary này; file ghi chú riêng của bạn không bị đụng tới.

**Backfill cho video đã học trước đó:** `npm run backfill` mở từng video chưa có transcript trong một tab nền (nghỉ 1.5–3.5 s
giữa các trang như `sync`), lấy transcript rồi chuyển bài. Video trong tab đó bị tắt tiếng và dừng ngay khi định phát, nên không
có gì được phát và không ghi tiến độ xem. Tool lưu sau mỗi video, Ctrl+C không mất gì, chạy lại sẽ làm tiếp phần còn thiếu.
Không chạy cùng lúc với `npm run study` (hai lệnh cùng ghi `progress.json`).

Ghi chú ở dạng `.data/courses/<slug>/notes/module-01/02-<title>.md`. Phần `## Ghi chú của mình` là của bạn,
còn khối AI nằm giữa `<!-- ai-notes:start/end -->` và sẽ được thay khi bạn tạo lại AI notes.

## AI (opt-in)

AI tắt mặc định. Chỉ cần có API key trong environment thì **chưa đủ** để bật; phải đặt `AI_PROVIDER` trong `.env`:

```ini
AI_PROVIDER=openai          # hoặc anthropic
AI_MODEL=<model được phép>  # bắt buộc với openai; anthropic mặc định claude-sonnet-5-5
OPENAI_API_KEY=...          # hoặc ANTHROPIC_API_KEY=...
STUDY_LANGUAGE=Vietnamese
```

Dữ liệu gửi đi chỉ gồm text bạn đã capture (transcript/reading) và câu hỏi của bạn. `OPENAI_BASE_URL` /
`ANTHROPIC_BASE_URL` dùng được cho gateway nội bộ.

## Kiểm thử

```powershell
npm test          # 58 test: unit + integration với Chrome headless trên trang fixture (không gọi mạng)
npm run typecheck
```

Integration test chứng minh code extraction/capture chạy đúng trong browser trên **HTML tự tạo**. Nó không chứng minh
DOM thật của Coursera khớp; việc đó là của `npm run probe`.

## Trạng thái PoC

Đã verify trên course thật (2026-11-06, tài khoản đã login):

- Outline: 5 module / 89 item, title module và item đúng. Mỗi item là
  `li[data-testid="WeekSingleItemDisplay-<typeName>"]`, title nằm ở `[data-test="rc-ItemName"]`, danh sách render
  sau DOMContentLoaded 3–8s.
- Loại item của course này: `lecture` (Video, 43), `ungradedWidget` (Skill Practice plugin), `coach` (Role Play /
  Dialogue), `staffGraded` (Graded Assignment, 1 bài/module). Không có reading. Plugin/coach/graded là manual.
- Completed: Coursera **thay icon loại item bằng dấu tick xanh** và không có text/aria. Tool nhận diện bằng
  "SVG không có nền tròn + màu xanh lá". Đã quan sát được icon đổi ngay khi một graded assignment được nộp.
- Locked: `aria-label="<title>, Locked"`.
- Transcript video: `<track kind="captions" srclang="en">` → `/api/subtitleAssetProxy.v1/...` (WebVTT).

Đã verify bằng test/fixture: state machine `study` (guard, checkpoint/resume), AI client (server giả).

Chưa verify: chưa chạy `npm run study` trọn một phiên trên course thật, và AI notes/quiz với API key thật.

## Lưu ý chính sách

Như plan đã nêu: Coursera Terms of Use yêu cầu xin phép trước với việc thu thập nội dung bằng công cụ tự động, và
Honor Code giới hạn AI trong assessment. Tool chỉ đọc trang bạn đang học, theo nhịp người dùng, và không đụng vào
assessment. Dù vậy, việc dùng trên tài khoản thật là quyết định của bạn. Nếu muốn an toàn tuyệt đối về chính sách,
Coursera Coach tích hợp sẵn (nút "Dive deeper on this topic" dưới mỗi video) là lựa chọn được Coursera cho phép.

## Troubleshooting

- **"Chrome không mở cổng DevTools"**: đóng mọi cửa sổ Chrome đang dùng profile `.data/chrome-profile` rồi chạy lại,
  hoặc đổi `CDP_PORT` trong `.env` nếu cổng 9222 đang bị dùng.
- **Muốn đăng xuất / xóa session**: đóng Chrome của tool rồi xóa thư mục `.data/chrome-profile`.
- **Sync báo 0 item**: chạy `npm run probe` và gửi report.
- Khi không học nữa, nên đóng cửa sổ Chrome của tool, vì cổng DevTools local cho phép tiến trình trên máy điều khiển nó.
