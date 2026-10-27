# Tuần 1 · Ngày 1 — Baseline phân loại Jira issue

Mục tiêu Ngày 1 là tạo baseline có thể chạy lại cho bài phân loại Jira issue của Tuần 1. Starter kit có dữ liệu Jira mẫu, bộ đánh giá gồm 20 ca đã gán nhãn và script chấm điểm. Starter kit **không có LLM client hoặc script tự gọi model**.

## Kết quả cần đạt trong Tuần 1

Xây classifier trả kết quả có cấu trúc cho mỗi issue:

```json
{
  "category": "Bug",
  "priority": "P1",
  "next_action": "Điều tra sự cố production và xác định phạm vi ảnh hưởng"
}
```

Dùng đúng một category (`Bug`, `Feature`, `Question`, `Risk`) và một priority (`P1`, `P2`, `P3`). Tạo và so sánh ba phiên bản prompt, đánh giá 20 ca, xem lại lỗi và giải thích vì sao V3 tốt hơn V1.

Tiêu chí đạt theo tài liệu thành viên:

- Category accuracy đạt ít nhất 85% trên 20 ca.
- 100% output thành công đúng JSON schema đã thống nhất.
- Tất cả critical incident trong bộ đánh giá được phân loại P1.
- Nộp các phiên bản prompt, bằng chứng đánh giá và demo ngắn.

## Các file dữ liệu trong starter kit

Chạy các lệnh bên dưới từ thư mục `AI_Engineering_Fast_Track_v12_Starter_Kit`.

| Đường dẫn | Nội dung | Cách dùng |
|---|---|---|
| `data/jira/issues.json` | 30 Jira record tổng hợp thuộc ALPHA, BETA và GAMMA | Xem các trường issue mẫu và thử prompt trên vài issue. |
| `data/evaluation/issue_classification_gold.json` | 20 issue gồm `issue_id`, `text`, `category`, `priority` | Bộ benchmark. Giữ nguyên file này và không đưa nhãn đáp án vào prompt. |
| `scripts/evaluate_issue_classifier.py` | Script chấm điểm | Chấm category/priority accuracy và liệt kê critical P1 bị bỏ sót trong CSV dự đoán. |

Starter kit không có file `data/issues.jsonl`. Trường Jira `issue_type` (ví dụ `Story`) cũng khác với category của bài tập (`Bug`, `Feature`, `Question`, `Risk`). Không dùng `issue_type` làm category đáp án.

## Các bước trong Ngày 1

### 1. Mở starter kit và đọc README

Xác nhận bạn đang ở thư mục `AI_Engineering_Fast_Track_v12_Starter_Kit`, sau đó đọc `README.md`. File này mô tả cách cài đặt, dữ liệu mẫu, mock Jira và các giới hạn an toàn. Chỉ dùng dữ liệu tổng hợp trong quá trình học.

### 2. Cài đặt Python

Starter kit cần Python 3.11+, Git và Docker. Chạy từ thư mục starter kit:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Chạy smoke test và test có sẵn

```powershell
python scripts/smoke_test.py
pytest -q tests/test_mock_jira.py
```

Kết quả mong đợi: smoke test kết thúc bằng `PASS`, pytest báo `3 passed`.

### 4. Khởi động FastAPI mock Jira

Ứng dụng có sẵn là `app.mock_jira`, không phải `app.main`. Chạy lệnh sau trong một terminal và để terminal đó hoạt động:

```powershell
uvicorn app.mock_jira:app --reload --port 8001
```

Mở `http://127.0.0.1:8001/docs`. Đây là mock chỉ đọc để luyện tập, không phải kết nối Jira production. Gửi request ví dụ từ cửa sổ PowerShell thứ hai:

```powershell
Invoke-RestMethod -Headers @{ 'X-Allowed-Project' = 'ALPHA' } `
  -Uri 'http://127.0.0.1:8001/projects/ALPHA/sprints/12/issues'
```

Ghi lại lệnh và kết quả để đưa vào bằng chứng kickoff.

### 5. Xem dữ liệu Jira mẫu

Chỉ hiển thị một số record thay vì in toàn bộ file:

```powershell
Get-Content data/jira/issues.json -Raw |
  ConvertFrom-Json |
  Select-Object -First 5 issue_key, project_id, summary, status, blocker, issue_type, priority |
  Format-Table -Wrap
```

Xác định trường nào giúp phân loại issue. Ba mươi Jira record này là dữ liệu mẫu; evaluator có sẵn dùng riêng bộ benchmark 20 ca ở phần dưới.

### 6. Ghi lại quy tắc phân loại ban đầu

Bắt đầu bằng rubric đơn giản, dễ kiểm tra. Sau đó điều chỉnh dựa trên lỗi:

| Nhãn | Quy tắc ban đầu |
|---|---|
| `Bug` | Hành vi hiện có bị lỗi hoặc không hoạt động như mong đợi. |
| `Feature` | Có yêu cầu thêm khả năng mới hoặc thay đổi khả năng hiện có. |
| `Question` | Mục đích chính là hỏi thông tin. |
| `Risk` | Một sự kiện có thể xảy ra trong tương lai và gây hại cho tiến độ, bảo mật, độ tin cậy hoặc tuân thủ. |

Gán priority dựa trên mức ảnh hưởng và tính khẩn cấp. Xem sự cố production nghiêm trọng hoặc critical incident khác là P1. Accuracy tổng thể không thay thế việc kiểm tra riêng từng ca nghiêm trọng.

### 7. Tạo `prompts/v1.md`

Tạo thư mục `prompts` nếu chưa có. Lưu prompt baseline đầu tiên vào `prompts/v1.md`. Nêu rõ các nhãn hợp lệ, quy tắc ban đầu và JSON cần trả về. Ví dụ, yêu cầu các trường `category`, `priority`, `next_action` và không cho phép văn bản ngoài JSON object.

Không đưa nhãn đáp án từ benchmark vào prompt. Giữ nguyên V1 sau lần chạy baseline để có thể so sánh công bằng với các phiên bản sau.

### 8. Thử V1 trên 3–5 Jira issue mẫu

Dùng một vài record trong `data/jira/issues.json`. Kiểm tra mỗi phản hồi có:

- Category và priority nằm trong danh sách được phép.
- JSON hợp lệ, có đủ trường và đúng kiểu dữ liệu đã thống nhất.
- Next action phù hợp với issue.
- Gán P1 cho sự cố rõ ràng là nghiêm trọng.

Các ví dụ này dùng để kiểm tra prompt ban đầu, không phải điểm số benchmark 20 ca.

### 9. Chạy baseline trên toàn bộ 20 ca đánh giá

Starter kit không có `run_eval.py` và không tự gọi LLM. Chạy prompt trên `issue_id` và `text` của từng ca trong `data/evaluation/issue_classification_gold.json`, sau đó chỉ lưu dự đoán vào `evidence/w1_predictions.csv` với header chính xác như sau:

```csv
issue_id,predicted_category,predicted_priority
CASE-01,Bug,P1
CASE-02,Feature,P3
```

Thêm đủ 20 ID (`CASE-01` đến `CASE-20`), mỗi ID đúng một lần. Không chép `category` hoặc `priority` từ file benchmark sang phần dự đoán. Evaluator kiểm tra CSV có đúng tập ID cần thiết.

Chạy bộ chấm điểm:

```powershell
python scripts/evaluate_issue_classifier.py evidence/w1_predictions.csv
```

Script báo category accuracy, priority accuracy và ID của các ca critical P1 bị bỏ sót. Script **không** kiểm tra JSON, không chấm `next_action` và không gọi model. Hãy tự kiểm tra schema của các phản hồi hoặc viết thêm validation code.

### 10. Xem các ca sai và ghi baseline

Với mỗi lỗi, đối chiếu nội dung issue, dự đoán và nhãn đánh giá. Ghi ngắn gọn mẫu lỗi và giả thuyết cần kiểm tra ở prompt tiếp theo. Không sửa benchmark để làm kết quả trông tốt hơn.

Lưu baseline vào `evidence/w1_baseline.md`, ví dụ:

```markdown
# W1 baseline — Prompt V1

- Prompt: prompts/v1.md
- Predictions: evidence/w1_predictions.csv
- Category accuracy: __ / 20
- Priority accuracy: __ / 20
- Critical P1 misses: [các ID từ kết quả evaluator]
- Phản hồi đúng schema: __ / __ (kiểm tra riêng)
- Các mẫu lỗi chính:
  - ...
- Giả thuyết cho V2:
  - ...
```

Dùng cùng bộ ca và cấu hình khi so sánh V1, V2, V3. Baseline thấp vẫn có ích nếu có thể chạy lại và giúp giải thích thay đổi của bạn.

## Checklist Ngày 1

- [x] Đã đọc README và cài môi trường Python.
- [x] `smoke_test.py` pass, mock Jira tests báo `3 passed`.
- [x] Mock Jira chạy tại `http://127.0.0.1:8001/docs`.
- [x] Đã xem dữ liệu mẫu `data/jira/issues.json`.
- [x] Đã ghi quy tắc category và priority ban đầu.
- [x] Đã tạo `prompts/v1.md` và thử trên 3–5 ví dụ.
- [x] Đã lưu dự đoán cho đủ 20 ca vào `evidence/w1_predictions.csv`.
- [x] Đã chạy evaluator và ghi kết quả vào `evidence/w1_baseline.md`.
- [ ] Đã ghi các ca sai và một giả thuyết cụ thể cho V2.

Dùng mẫu nộp hàng tuần tại `evidence/weekly_pr_template.md` cho PR thứ Sáu. Chỉ kết luận bài đạt khi bằng chứng đáp ứng tiêu chí và mentor đã review.
