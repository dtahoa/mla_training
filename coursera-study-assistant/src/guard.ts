// Assessment Guard: the single place that decides what the assistant may do on
// an item. Everything defaults to "stop and let the human do it".
//
// Hard rules (not configurable):
//   - never answers, fills in or submits any quiz / assignment / exam
//   - never reads assessment content (so it can never reach an AI API)
//   - never clicks "Mark as completed" or fakes video progress

import type { ItemKind } from './course.ts';

export type StudyAction =
  | 'capture' // save transcript / reading text locally
  | 'ai_notes' // AI summary + key concepts from captured text
  | 'done' // learner says they studied / completed it themselves
  | 'skip' // leave it for later (not an assessment)
  | 'later' // assessment the learner will do manually later
  | 'follow' // re-read whatever page the learner navigated to
  | 'next' // go to the next open item
  | 'sync' // refresh outline + completion status
  | 'quit';

export interface GuardDecision {
  kind: ItemKind;
  /** May the assistant read this page's content (transcript / reading text)? */
  allowCapture: boolean;
  /** May captured content of this item be sent to the AI study helper? */
  allowAi: boolean;
  /** The human must complete it themselves; the assistant only waits. */
  manualOnly: boolean;
  headline: string;
  hint: string;
  actions: StudyAction[];
}

const COMMON_TAIL: StudyAction[] = ['follow', 'sync', 'quit'];

export function guardFor(kind: ItemKind): GuardDecision {
  switch (kind) {
    case 'VIDEO':
      return {
        kind,
        allowCapture: true,
        allowAi: true,
        manualOnly: false,
        headline: 'VIDEO → STUDY / TAKE NOTES',
        hint: 'Tự xem video trên Chrome. Có thể capture transcript để ghi chú và nhờ AI tóm tắt.',
        actions: ['capture', 'ai_notes', 'done', 'skip', ...COMMON_TAIL],
      };
    case 'READING':
      return {
        kind,
        allowCapture: true,
        allowAi: true,
        manualOnly: false,
        headline: 'READING → READ / SUMMARIZE',
        hint: 'Tự đọc bài. Nếu Coursera có nút "Mark as completed", hãy tự bấm sau khi đọc xong.',
        actions: ['capture', 'ai_notes', 'done', 'skip', ...COMMON_TAIL],
      };
    case 'PRACTICE':
      return {
        kind,
        allowCapture: false,
        allowAi: false,
        manualOnly: true,
        headline: 'PRACTICE → TỰ LÀM, assistant không đọc/không trả lời câu hỏi',
        hint: 'Tự làm practice quiz. Sau đó dùng `npm run quiz` để luyện thêm câu hỏi tạo từ ghi chú của bạn.',
        actions: ['done', 'later', ...COMMON_TAIL],
      };
    case 'GRADED':
      return {
        kind,
        allowCapture: false,
        allowAi: false,
        manualOnly: true,
        headline: 'ASSESSMENT → MANUAL COMPLETION',
        hint: 'Bài có chấm điểm (hoặc chưa xác định được loại). Bạn tự làm theo Honor Code; assistant dừng tại đây.',
        actions: ['done', 'later', ...COMMON_TAIL],
      };
    case 'OTHER':
      return {
        kind,
        allowCapture: false,
        allowAi: false,
        manualOnly: true,
        headline: 'OTHER → MANUAL (loại item chưa hỗ trợ)',
        hint: 'Discussion / plugin / lab: tự thực hiện trên Coursera.',
        actions: ['done', 'later', ...COMMON_TAIL],
      };
  }
}

export function isActionAllowed(kind: ItemKind, action: StudyAction): boolean {
  return guardFor(kind).actions.includes(action);
}
