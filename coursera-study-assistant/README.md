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
| Tự bấm "Mark as completed" hoặc tua/giả lập xem video | không có code nào click hai thứ đó |
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
```

**Bước 2 quan trọng:** selector được viết dựa trên URL pattern và ảnh chụp màn hình, chưa chạy trên tài khoản
đã login. Sau khi chạy `probe`, hãy gửi file `probe-*.md` (và `probe-*.json`) để chỉnh selector. Report không chứa
giá trị cookie hay thông tin tài khoản, cũng không chứa nội dung khóa học (chỉ có số ký tự).
Thêm `-- --screenshots` nếu muốn có ảnh trang video/reading (ảnh có thể chứa avatar của bạn, kiểm tra trước khi gửi).

### Phím trong `npm run study`

| Phím | Video / Reading | Practice / Graded / Other |
|---|---|---|
| `c` | capture transcript / nội dung → `.data/.../sources` + file ghi chú | — (guard chặn) |
| `a` | AI notes: tóm tắt, khái niệm chính, ví dụ áp dụng, câu hỏi tự kiểm tra | — (guard chặn) |
| `d` | đã học → item tiếp theo (cảnh báo nếu video mới xem < 90%) | "đã tự làm trên Coursera?" → item tiếp theo |
| `k` / `l` | `k` bỏ qua tạm | `l` để tự làm sau (hiện trong `status`) |
| `f` | đọc lại trang bạn đang mở trên Chrome (tự điều hướng thoải mái) | |
| `s` | đồng bộ outline + trạng thái completed từ Coursera (tab nền) | |
| `q` | tạm dừng, lưu checkpoint | |

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
npm test          # 36 test: unit + integration với Chrome headless trên trang fixture (không gọi mạng)
npm run typecheck
```

Integration test chứng minh code extraction/capture chạy đúng trong browser trên **HTML tự tạo**. Nó không chứng minh
DOM thật của Coursera khớp; việc đó là của `npm run probe`.

## Trạng thái PoC

- ✅ Đã verify: spawn Chrome + attach CDP, nhận diện trạng thái chưa login trên coursera.org thật, toàn bộ state machine
  `study` (E2E với fixture: guard, checkpoint/resume, status), capture transcript/reading, AI client (server giả).
- ⏳ Chưa verify (cần tài khoản của bạn): selector trang module sau login (type label, completed, locked), transcript
  thật (`<track>` hoặc panel), nội dung reading. Chạy `npm run probe` để kiểm tra.

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
