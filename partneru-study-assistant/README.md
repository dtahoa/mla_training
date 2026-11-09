# PartnerU Study Assistant — OpenAI Technical Practitioner

Tool cùng kiểu với [`coursera-study-assistant`](../coursera-study-assistant/README.md), dành cho
**OpenAI PartnerU** (nền tảng Sana, `openai-partneru.sana.ai`). Program làm trước:
**OpenAI Technical Practitioner**
(`/program/d4d206ae-aa74-4f86-b503-d5b2fbab1a0f`).

Đây là **AI learning assistant human-in-the-loop** chạy local (Node.js + Playwright). Tool lo điều hướng,
tiến độ, ghi chú và bấm Continue qua các thẻ nội dung. Knowledge check, Final Exam và Feedback do **bạn** tự làm.

## Program trông thế nào (từ probe)

- 8 bước, phải xong bước trước mới mở bước sau:

  | Bước | Nội dung | Ai làm |
  |---|---|---|
  | 1–6 | Course (19–27 phút mỗi course) | tool dẫn bạn đi từng thẻ |
  | 7 | Final Exam | bạn |
  | 8 | Feedback | bạn |

- Danh sách bước và tiến độ có trong dữ liệu GraphQL `GetLearnerProgram` mà trang program tự tải.
  Tiến độ là tỉ lệ 0–1.
- Trang course `/course/<id>` chỉ là trang giới thiệu có nút Start. Bài học nằm trong **player**
  `/s/<edition>/file:<card>`.
  - Một course gồm nhiều module, mỗi module gồm nhiều **thẻ**. Course 1 có 37 thẻ.
  - Thẻ cuộn bên trong khung `#self-paced-content-renderer`. Nút sang thẻ tiếp là **Continue**, hoặc nút mũi tên
    **Go to next card** (`data-testid="forward-button"`). Thẻ dài chỉ hiện nút khi đã cuộn xuống cuối, nên tool
    tự cuộn xuống cuối, kiểm tra lại xem cuối thẻ có câu hỏi không, rồi mới bấm.
  - Mở một thẻ là Sana đánh dấu thẻ đó hoàn thành.
  - Mỗi module có thẻ **Knowledge check**. Trong dữ liệu tiến độ `/self-paced-content/status`, các thẻ này có
    `exerciseStatuses`.

## Guardrails

| Không bao giờ | Ở đâu |
|---|---|
| Đọc, lưu, trả lời hay bỏ qua knowledge check / quiz | `classifyCard()` trong `src/card.ts`. Thẻ là EXERCISE nếu: Sana báo có exercise, **hoặc** tiêu đề có chữ knowledge check / quiz / exam, **hoặc** trên trang có ô trả lời / nút Check, Submit. Với thẻ này tool chỉ chờ bạn tự làm |
| Bấm Continue trên thẻ có câu hỏi, hoặc khi trang đã sang thẻ khác | `clickContinue()` đọc lại thẻ ngay trước khi bấm |
| Tự Continue thẻ video | video luôn chờ bạn nhấn Enter |
| Mở hay làm Final Exam, điền Feedback | `study` dừng ở bước EXAM / FEEDBACK; probe bỏ qua các link đó |
| Giả lập xem video | không có code nào làm việc đó |
| Nhập/lưu mật khẩu, bypass SSO/MFA | bạn tự đăng nhập trong Chrome |
| Gọi API riêng của Sana | tool chỉ đọc các response mà trang tự tải |
| Commit session, cookie hay nội dung khóa học | tất cả nằm trong `.data/` (đã gitignore) |

## Cài đặt

Cần Node.js ≥ 22.18 và Google Chrome.

```powershell
cd partneru-study-assistant
npm install
copy .env.example .env   # tùy chọn: AUTO_ADVANCE, program khác
```

Chrome của tool này dùng profile riêng `partneru-study-assistant/.data/chrome-profile` và cổng DevTools **9223**.
Vì vậy nó có thể mở cùng lúc với Chrome của tool Coursera (cổng 9222).

## Chạy

```powershell
npm run login     # lần đầu: mở Chrome, bạn tự đăng nhập PartnerU (SSO/MFA)
npm run sync      # lấy 8 bước + tiến độ, in bảng
npm run status    # xem lại bảng (offline)
npm run study     # học: đi từng thẻ, lưu ghi chú, Continue
```

`npm run study`:

1. Sync tiến độ, chọn bước đầu tiên chưa xong. Nếu bước đó là Final Exam / Feedback thì tool dừng để bạn tự làm.
2. Mở player của course. Link Start / Continue luôn mở thẻ chưa xong kế tiếp, nên dừng giữa chừng không sao.
3. Với mỗi thẻ:

   | Thẻ | Tool làm gì | Bạn làm gì |
   |---|---|---|
   | 📄 Nội dung | lưu chữ vào ghi chú; bấm Continue khi bạn nhấn **Enter** (hoặc tự bấm sau 3 giây nếu `AUTO_ADVANCE=1`) | đọc |
   | 🎬 Video | lưu chữ trên thẻ; bấm Continue khi bạn nhấn **Enter** | xem video |
   | 🧩 Knowledge check | không đọc, không lưu, không bấm gì; chờ trang sang thẻ khác | tự trả lời rồi bấm Continue |

4. Hết course thì sync lại và sang course tiếp theo.

Phím: **Enter** Continue · **p** tắt tự động trong phiên này · **q** dừng (Ctrl+C cũng được).

Ghi chú nằm ở `.data/programs/<id>/notes/01-technical-fluency-orientation.md`… (mỗi course một file Markdown).

### Tự động (`AUTO_ADVANCE=1`)

Thêm vào `.env`:

```
AUTO_ADVANCE=1
AUTO_ADVANCE_DELAY=3   # giây đếm ngược trước mỗi lần Continue
```

Tool tự Continue các thẻ nội dung. Video và knowledge check vẫn chờ bạn.

## Ghi chú, backfill và tóm tắt

```powershell
npm run backfill                 # lưu ghi chú cho thẻ bạn đã học ngoài tool   [-- --course 2]
npm run summary                  # AI tóm tắt từng course + cả program        [-- --course 1]
```

- **Ghi chú:** `npm run study` lưu chữ của mỗi thẻ nội dung / video vào
  `.data/programs/<id>/notes/<NN>-<course>.md`. Knowledge check không bao giờ được lưu.
- **`backfill`:** dành cho thẻ bạn đọc thẳng trên trình duyệt. Lệnh chạy trong **tab nền**, tab của bạn giữ nguyên.
  Vì Sana tính là đã học ngay khi mở thẻ, backfill **chỉ mở thẻ Sana đã báo `completed`**. Nó bỏ qua thẻ có
  exercise và thẻ đã có ghi chú, và chỉ xét các course đã bắt đầu.
- **`summary`:** đọc ghi chú (tự xếp lại theo thứ tự thẻ), gửi cho AI rồi ghi vào
  `.data/programs/<id>/summaries/`:
  - mỗi course một file: Big picture, Key concepts, Frameworks & decision guides, Pitfalls, Apply it,
    Review questions;
  - `program.md` khi có từ 2 course: tổng quan, các course nối với nhau thế nào, cheat sheet, glossary,
    câu hỏi ôn tập.

  Cần `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY` trong `.env` (xem `.env.example`). Chỉ chữ trong ghi chú được
  gửi đi. `STUDY_LANGUAGE` (mặc định Vietnamese) chọn ngôn ngữ; tên sản phẩm OpenAI và thuật ngữ giữ tiếng Anh.

Chưa lưu được: chữ nằm trong hình, và transcript video (chưa gặp thẻ video thật).

## Program khác

Lấy id trong URL `/program/<id>`, rồi chạy kèm `-- --program <id>`, hoặc đặt `PROGRAM_ID=<id>` trong `.env`.
Dữ liệu mỗi program nằm riêng trong `.data/programs/<id>/`. Phiên đăng nhập Chrome dùng chung.

## Probe (khi PartnerU đổi giao diện)

```powershell
npm run probe -- --screenshots
```

Probe đi program → course đầu → player. Nó ghi heading, link theo pattern, nút, ô nhập, iframe và các API call
của app vào `.data/programs/<id>/probe/`. Với response API, report chỉ ghi tên key và kiểu, giữ giá trị cho các
trường enum như `"completed"`. Probe không bấm nút nào và không mở exam / quiz / feedback.

## Phát triển

```powershell
npm test           # node --test
npm run typecheck  # tsc --noEmit
```
