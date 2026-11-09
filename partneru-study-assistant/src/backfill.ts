// npm run backfill — save notes for cards you already finished without the
// tool (read straight in the browser). Works in a background tab, so your
// own tab stays where it is.
//
// Opening a card is what makes Sana count it as done, so backfill opens ONLY
// cards Sana already reports as completed, and never exercise cards. It enters
// the player at a card it already knows you finished, or else through the
// course's Start / Continue link, which resumes where you left off.

import type { Page } from 'playwright';
import { programUrl, type Config } from './config.ts';
import { isLoggedIn, openSession, politeDelay, settle } from './browser.ts';
import { cardText, classifyCard, parseCardUrl, readCard, type CardStatus } from './card.ts';
import { loadProgram, type ProgramStep } from './program.ts';
import { ProgressStore } from './store.ts';
import { AuditLog } from './audit.ts';
import { appendCardNote, notesFile } from './notes.ts';
import { cardUrl, coursePlayerLink, StatusWatcher, waitForPlayer } from './player.ts';

/** Completed, question-free cards without notes yet, in course order. */
export function backfillTargets(statuses: Map<string, CardStatus>, store: Pick<ProgressStore, 'card'>): string[] {
  return [...statuses]
    .filter(([cardId, status]) => {
      const saved = store.card(cardId);
      return status.state === 'completed' && status.exercises === 0 && !saved?.captured && saved?.kind !== 'EXERCISE';
    })
    .map(([cardId]) => cardId);
}

/** Courses worth backfilling: real courses you have started. */
export function backfillCourses(steps: ProgramStep[], course?: number): ProgramStep[] {
  return steps.filter(
    (step) => step.kind === 'COURSE' && (course === undefined || step.index === course) && ((step.progress ?? 0) > 0 || step.startedAt !== null),
  );
}

/** A card of this course you already finished, to enter the player without moving your resume point. */
function knownFinishedCard(store: ProgressStore, courseId: string): string | null {
  for (const [cardId, card] of Object.entries(store.data.cards)) {
    if (card.courseId === courseId && card.editionId && card.completed) return cardUrl(card.editionId, cardId);
  }
  return null;
}

async function enterPlayer(tab: Page, store: ProgressStore, step: ProgramStep): Promise<boolean> {
  const url = knownFinishedCard(store, step.courseId) ?? (await coursePlayerLink(tab, step));
  if (!url) return false;
  await tab.goto(url, { waitUntil: 'domcontentloaded' });
  return waitForPlayer(tab);
}

export async function runBackfill(config: Config, options: { course?: number } = {}): Promise<void> {
  const store = await ProgressStore.open(config.progressPath, config.programId);
  const audit = new AuditLog(config.auditPath);
  const session = await openSession(config, programUrl(config));
  const tab = await session.context.newPage();
  let stop = false;
  const onSigint = () => {
    stop = true;
    console.log('\n⏸ Dừng sau thẻ đang lưu…');
  };
  process.once('SIGINT', onSigint);
  let saved = 0;

  try {
    const outline = await loadProgram(tab, programUrl(config)).catch(() => null);
    await settle(tab);
    if (!outline || !(await isLoggedIn(tab)) || outline.steps.length === 0) {
      console.log('✖ Chưa đăng nhập PartnerU. Chạy `npm run login` trước.');
      process.exitCode = 1;
      return;
    }
    store.setOutline(outline);
    await store.save();

    const courses = backfillCourses(outline.steps, options.course);
    if (courses.length === 0) {
      console.log('Không có course nào đã bắt đầu để lấy lại ghi chú.');
      return;
    }

    const statuses = new StatusWatcher(tab);
    try {
      for (const step of courses) {
        if (stop) break;
        console.log(`\n📘 Bước ${step.index}: ${step.title}`);
        statuses.clear();
        if (!(await enterPlayer(tab, store, step)) || !(await statuses.ready())) {
          console.log('   ✖ Không mở được player / không đọc được trạng thái thẻ.');
          continue;
        }
        const editionId = parseCardUrl(tab.url())?.editionId;
        const targets = editionId ? backfillTargets(statuses.all(), store) : [];
        console.log(`   ${targets.length} thẻ đã học chưa có ghi chú.`);

        for (const cardId of targets) {
          if (stop || !editionId) break;
          await politeDelay(1000, 2000);
          await tab.goto(cardUrl(editionId, cardId), { waitUntil: 'domcontentloaded' });
          if (!(await waitForPlayer(tab))) continue;
          const card = await readCard(tab);
          if (!card || card.info.cardId !== cardId) {
            console.log(`   ⚠ ${cardId}: trang chuyển sang thẻ khác, bỏ qua.`);
            continue;
          }
          const kind = classifyCard(card.info.title, statuses.get(cardId), card.signals);
          store.upsertCard(cardId, {
            courseId: step.courseId,
            editionId,
            position: card.info.position,
            total: card.info.total,
            title: card.info.title,
            kind,
            completed: true,
          });
          const text = kind === 'EXERCISE' ? '' : cardText(card.blocks, card.info.title);
          if (text) {
            await appendCardNote(notesFile(config, step), card.info.courseTitle ?? step.title, card.info, text);
            store.upsertCard(cardId, { ...store.card(cardId)!, captured: true });
            saved++;
          }
          await store.save();
          await audit.log('backfill', { courseId: step.courseId, cardId, kind, chars: text.length });
          console.log(
            `   ${kind === 'EXERCISE' ? '🧩' : '📝'} [${card.info.position ?? '?'}/${card.info.total ?? '?'}] ${card.info.title}${text ? ` · ${text.length} ký tự` : kind === 'EXERCISE' ? ' — câu hỏi, không lưu' : ' — không có chữ'}`,
          );
        }
      }
    } finally {
      statuses.stop();
    }
    console.log(`\n✓ Đã lưu thêm ${saved} thẻ vào ${config.notesDir}${saved ? '. Chạy `npm run summary` để AI tóm tắt.' : '.'}`);
  } finally {
    process.off('SIGINT', onSigint);
    await store.save();
    await tab.close().catch(() => undefined);
    await session.disconnect().catch(() => undefined);
  }
}
