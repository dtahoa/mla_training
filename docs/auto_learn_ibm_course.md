# Investigation: Automation Coursera + AI Learning Assistant

Khả thi về kỹ thuật, nhưng có giới hạn chính sách

Mình đã kiểm tra chương trình IBM Enterprise AI Transformation and Consulting Professional Certificate và các quy định hiện hành của Coursera.

Kết luận ban đầu: Có thể xây dựng một AI Learning Automation Agent bằng Playwright + Node.js + AI API, nhưng nên phân biệt giữa việc tự động hỗ trợ học tập và tự động hoàn thành khóa học để lấy chứng chỉ.

- Tự đăng nhập, điều hướng, quản lý tiến độ: Khả thi về kỹ thuật.
- Tự đánh dấu hoàn thành các bài đọc/video: Có thể thao tác qua browser nếu giao diện hỗ trợ, nhưng không nên đánh dấu khi chưa thực sự học.
- Tự chụp màn hình, phân tích nội dung bằng AI: Khả thi về kỹ thuật, với điều kiện được phép sử dụng nội dung theo chính sách Coursera.
- AI giải thích câu hỏi, tạo bài luyện tập, hỗ trợ ôn tập: Khả thi và hữu ích.
- AI tự chọn đáp án và nộp graded assessment: Có thể lập trình được, nhưng không nên triển khai mặc định vì có nguy cơ vi phạm Honor Code.

Điểm quan trọng mình xác minh được: [Coursera Terms of Use](https://www.coursera.org/about/terms?utm_source=chatgpt.com) hiện yêu cầu có sự đồng ý trước bằng văn bản đối với việc scraping bằng công cụ tự động. Honor Code cũng hạn chế sử dụng AI bên ngoài trong assessment nếu hoạt động đó không được cho phép rõ ràng. Vi phạm có thể ảnh hưởng đến tài khoản và chứng chỉ.

Coursera+1



Vì vậy, mình đề xuất hướng AI-assisted learning có kiểm soát (human-in-the-loop), thay vì một bot tự động vượt qua toàn bộ khóa học.

## 1. Chương trình IBM này có gì cần tự động hóa?

Trang Coursera hiện công bố chương trình gồm 7 courses, trong đó course cuối là Capstone Project.

Coursera




| #   | Course                                           | Nội dung chính                     |
| --- | ------------------------------------------------ | ---------------------------------- |
| 1   | The AI Transformation Advisor                    | Tư vấn AI, đánh giá vendor         |
| 2   | Identify and Prioritize AI Opportunities         | Phân tích và xếp hạng AI use cases |
| 3   | Assess AI Readiness                              | Đánh giá mức độ sẵn sàng           |
| 4   | Design AI Transformation Roadmaps                | Xây dựng roadmap                   |
| 5   | AI Business Cases and ROI Models                 | ROI, business case                 |
| 6   | AI Governance, Risk, and Executive Communication | Quản trị AI, rủi ro                |
| 7   | AI Transformation Advisory Package               | Capstone, tổng hợp chiến lược      |


Đây không chỉ là chương trình xem video rồi làm quiz. Coursera mô tả các bài thực hành và sản phẩm phải hoàn thành ở từng course, bao gồm báo cáo, roadmap, business case, governance plan và capstone.

Do chưa đăng nhập vào tài khoản đã enroll, mình chưa thể xác minh số lượng video, reading, practice quiz, graded quiz và nút Complete thực tế của từng module.

## 2. Đánh giá chi tiết từng chức năng automation


| Chức năng                   | Khả thi kỹ thuật | Nhận xét                               |
| --------------------------- | ---------------- | -------------------------------------- |
| Mở Coursera                 | Cao              | Playwright                             |
| Login bằng Google/email     | Cao              | Đăng nhập thủ công lần đầu; MFA nếu có |
| Tái sử dụng login session   | Cao              | Persistent browser state               |
| Điều hướng course/module    | Cao              | Cần kiểm tra DOM sau login             |
| Xác định item đã hoàn thành | Cao              | Nếu trạng thái được hiển thị trên UI   |
| Mở video và hỗ trợ ghi chú  | Cao              | Không giả lập việc đã học              |
| Tự mark reading complete    | Có điều kiện     | Phụ thuộc UI và quyền được phép        |
| Capture nội dung màn hình   | Cao              | Cần được phép thu thập nội dung        |
| AI giải thích kiến thức     | Cao              | Dùng nội dung được phép                |
| AI tạo bài luyện tập        | Cao              | Từ kiến thức đã học                    |
| AI giải graded assessment   | Hạn chế          | Chỉ khi quy định cho phép              |
| AI tự submit graded quiz    | Không đề xuất    | Rủi ro Honor Code                      |


Lưu ý: Khả thi kỹ thuật không đồng nghĩa được Coursera cho phép. Việc điều khiển browser, ghi lại nội dung và đánh dấu completion phải được kiểm tra với chính sách trước khi triển khai trên tài khoản thật.

## 3. Architecture mình đề xuất

Windows 11 – Node.js Controller

Start / Pause / Resume / Progress Tracking

Playwright Browser Agent

Authenticated session · Navigation · UI state

Coursera Learning UI

Courses · Video · Reading · Practice · Assessment

Study Assistant

Tóm tắt, giải thích, tạo practice quiz

Assessment Guard

Kiểm tra loại assessment, dừng khi cần bạn thao tác

Local Progress Store

SQLite/JSON · Checkpoints · Audit logs

Mình chọn Playwright + TypeScript thay cho Selenium hay Python để tận dụng Node.js, khả năng điều khiển Chromium và session management. Playwright có hỗ trợ lưu trạng thái đăng nhập và chụp ảnh màn hình.

Playwright+2



Workflow nên chạy theo một state machine:

```
LOGIN_REQUIRED
    ↓
AUTHENTICATED
    ↓
OPEN_COURSE
    ↓
INSPECT_CURRENT_ITEM
    ├── VIDEO       → STUDY / TAKE NOTES
    ├── READING     → READ / SUMMARIZE
    ├── PRACTICE    → PRACTICE ASSISTANT
    └── ASSESSMENT  → CHECK PERMISSION
                           ├── Permitted AI help
                           │     → EXPLAIN / REVIEW
                           └── Not permitted
                                 → MANUAL COMPLETION
    ↓
SAVE_CHECKPOINT
    ↓
NEXT_ITEM
```

Đặc biệt, khi AI không chắc loại bài kiểm tra hoặc không xác minh được quyền sử dụng AI, workflow sẽ dừng thay vì tự động thao tác.

## 4. Kế hoạch triển khai PoC

Mình đề xuất chia thành ba giai đoạn.

Phase 1 — Browser feasibility PoC

Kiểm tra Playwright mở website, login thủ công, khôi phục session và xác định cấu trúc module. Chỉ triển khai thao tác đọc/navigation được Coursera cho phép.

Output: DOM findings, khả năng selector, authentication flow và danh sách blockers.

Phase 2 — Learning Workflow

Tạo progress tracker, cơ chế pause/resume, learning notes, giải thích kiến thức và quiz luyện tập. Không tự xác nhận completion khi chưa học.

Output: Local learning dashboard và progress checkpoints.

Phase 3 — AI Assessment Assistant

Phân loại practice/graded/capstone, xác minh quy định AI. Với hoạt động cho phép, AI có thể cung cấp giải thích và phản hồi. Với graded assessment không cho phép AI, bạn tự hoàn thành.

Output: Human-in-the-loop assessment workflow.

## 5. Những điểm cần xác minh trước khi code

Có ba yếu tố quyết định:

1. Chính sách: Coursera có cấp quyền cho loại browser automation và thu thập nội dung này không? Đặc biệt cần xin phép trước đối với scraping, và kiểm tra AI policy của từng assessment.
2. Giao diện sau đăng nhập: Cần xem thực tế nút completion, video progress, lesson navigation, quiz types và trạng thái đã hoàn thành.
3. Bảo mật: Không đưa password vào source code, không commit cookies/session lên GitHub, không bypass CAPTCHA/MFA và không gửi dữ liệu tài khoản vào AI API.

Với giao diện sau login, mình chưa thực hiện end-to-end test trên tài khoản Coursera của bạn, nên các mức khả thi phía trên là đánh giá công nghệ, chưa phải kết quả chạy thử thành công.

## Đề xuất bước tiếp theo

Mình nghiêng về một local AI Learning Assistant chạy trên Windows, dùng Playwright làm browser controller và AI để hỗ trợ học nhanh, hiểu bài, theo dõi tiến độ.

Trước khi đầu tư xây toàn bộ hệ thống, nên làm PoC nhỏ với Course 1 — The AI Transformation Advisor, bắt đầu bằng kiểm tra session và cấu trúc giao diện, sau khi xác nhận phạm vi automation được phép.

Nếu bạn đã enroll khóa học này, bước hữu ích nhất tiếp theo là xem một ảnh màn hình trang lesson bên trong Course 1 (ẩn thông tin cá nhân). Từ đó mình có thể xác định cụ thể từng loại item và thiết kế script, thay vì phải giả định cấu trúc giao diện Coursera.