// Study session for a PartnerU program. Walks the steps in order:
//   COURSE  → open its player (/s/<edition>/next resumes where you left off)
//             and go card by card: save the card text to notes, then Continue.
//   EXAM / FEEDBACK → stop. The final exam and the survey are yours.
//
// Per card:
//   CONTENT  → [Enter] Continue (or by itself with AUTO_ADVANCE=1)
//   VIDEO    → watch it; [Enter] and the tool clicks Continue (never automatic)
//   EXERCISE → knowledge check / quiz: you answer and click Continue yourself;
//              the tool only waits for the player to move on.

import type { Page } from 'playwright';
import { programUrl, type Config } from './config.ts';
import { openSession, sleep } from './browser.ts';
import { cardText, classifyCard, clickContinue, parseCardUrl, readCard } from './card.ts';
import { isLocked, nextStep, progressPercent, type ProgramStep } from './program.ts';
import { ProgressStore, type CardKind } from './store.ts';
import { AuditLog } from './audit.ts';
import { appendCardNote, notesFile } from './notes.ts';
import { createPrompt, INTERRUPTED, type Prompt } from './prompt.ts';
import { syncProgram } from './sync.ts';
import { openPlayer, StatusWatcher, waitForPlayer } from './player.ts';

export type CardAction = 'continue' | 'moved' | 'recheck' | 'pause' | 'quit';

export interface ChooseOptions {
  prompt: Prompt;
  /** Auto-continue this card after `delayMs` (content cards with AUTO_ADVANCE=1 only). */
  auto: boolean;
  delayMs: number;
  /** Resolves when the player leaves this card by itself (you clicked Continue). */
  moved: (signal: AbortSignal) => Promise<'moved' | null>;
}

const QUESTION: Record<CardKind, string> = {
  CONTENT: '   [Enter] Continue · [q] dừng ',
  VIDEO: '   Xem xong video thì [Enter] để Continue · [q] dừng ',
  EXERCISE: '   Bạn tự trả lời trên trang rồi bấm Continue · [Enter] kiểm tra lại · [q] dừng ',
};

export function actionForKey(kind: CardKind, input: string): CardAction {
  if (input === INTERRUPTED || /^q/i.test(input)) return 'quit';
  if (/^p/i.test(input)) return 'pause';
  if (input === '' && kind !== 'EXERCISE') return 'continue';
  return 'recheck';
}

/** Keyboard vs. "player moved on" vs. auto timer; first one wins. */
export async function chooseAction(kind: CardKind, options: ChooseOptions): Promise<CardAction> {
  const controller = new AbortController();
  const auto = options.auto && kind === 'CONTENT';
  const question = auto ? `   ⏩ Tự Continue sau ${options.delayMs / 1000}s · [Enter] ngay · [p] tắt tự động · [q] dừng ` : QUESTION[kind];
  const racers: Array<Promise<CardAction | null>> = [
    options.prompt.ask(question, controller.signal).then((input) => (controller.signal.aborted ? null : actionForKey(kind, input))),
    options.moved(controller.signal),
  ];
  if (auto) {
    racers.push(
      new Promise<CardAction | null>((resolve) => {
        const timer = setTimeout(() => resolve('continue'), options.delayMs);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve(null);
        });
      }),
    );
  }
  try {
    // A racer that resolves null lost to an abort; wait for a real answer.
    return await Promise.race(racers.map((racer) => racer.then((value) => value ?? new Promise<never>(() => undefined))));
  } finally {
    controller.abort();
  }
}

/** Poll the page URL until the player shows another card (or leaves the player). */
export function watchCardChange(page: Pick<Page, 'url'>, cardId: string, pollMs = 1000) {
  return async (signal: AbortSignal): Promise<'moved' | null> => {
    while (!signal.aborted) {
      await sleep(pollMs);
      if (signal.aborted) return null;
      if (parseCardUrl(page.url())?.cardId !== cardId) return 'moved';
    }
    return null;
  };
}

const ICON: Record<CardKind, string> = { CONTENT: '📄', VIDEO: '🎬', EXERCISE: '🧩' };
const HINT: Record<CardKind, string> = {
  CONTENT: '',
  VIDEO: ' — video: xem trên trang',
  EXERCISE: ' — câu hỏi: bạn tự làm, tool không đọc / không trả lời',
};

interface Context {
  config: Config;
  store: ProgressStore;
  audit: AuditLog;
  prompt: Prompt;
  statuses: StatusWatcher;
  auto: { on: boolean };
}

type CourseResult = 'left-player' | 'quit' | 'stuck';

async function studyCourse(page: Page, step: ProgramStep, ctx: Context): Promise<CourseResult> {
  console.log(`\n📘 Bước ${step.index}: ${step.title} (${progressPercent(step.progress) ?? 0}%)`);
  if (!(await openPlayer(page, step))) {
    console.log('✖ Không mở được player của course (không thấy nút Start / Continue trên trang course).');
    return 'stuck';
  }
  const notes = notesFile(ctx.config, step);
  const noAuto = new Set<string>();

  for (;;) {
    const card = await readCard(page);
    if (!card) return 'left-player';
    const { info } = card;
    const status = ctx.statuses.get(info.cardId);
    const kind = classifyCard(info.title, status, card.signals);
    const saved = ctx.store.card(info.cardId);
    ctx.store.upsertCard(info.cardId, {
      courseId: step.courseId,
      editionId: info.editionId,
      position: info.position,
      total: info.total,
      title: info.title,
      kind,
      completed: status?.state === 'completed' || Boolean(saved?.completed),
    });

    let captured = '';
    if (kind !== 'EXERCISE' && !saved?.captured) {
      const text = cardText(card.blocks, info.title);
      if (text) {
        await appendCardNote(notes, info.courseTitle ?? step.title, info, text);
        ctx.store.upsertCard(info.cardId, { ...ctx.store.card(info.cardId)!, captured: true });
        captured = ` · 📝 ${text.length} ký tự`;
      }
    }
    await ctx.store.save();
    console.log(`${ICON[kind]} [${info.position ?? '?'}/${info.total ?? '?'}] ${info.title}${HINT[kind]}${captured}`);

    const auto = ctx.auto.on && kind === 'CONTENT' && !noAuto.has(info.cardId);
    const action = await chooseAction(kind, {
      prompt: ctx.prompt,
      auto,
      delayMs: ctx.config.autoDelayMs,
      moved: watchCardChange(page, info.cardId),
    });
    await ctx.audit.log('card', { courseId: step.courseId, cardId: info.cardId, kind, action, auto });

    switch (action) {
      case 'quit':
        return 'quit';
      case 'pause':
        ctx.auto.on = false;
        console.log('   ⏸ Đã tắt tự động cho phiên này.');
        continue;
      case 'moved':
        await waitForPlayer(page, 5000);
        continue;
      case 'recheck':
        continue;
      case 'continue': {
        const outcome = await clickContinue(page, info);
        await ctx.audit.log('continue', { cardId: info.cardId, ...outcome });
        if (outcome.status === 'moved') {
          await waitForPlayer(page, 5000);
          continue;
        }
        // Do not retry by itself: the next prompt for this card waits for you.
        noAuto.add(info.cardId);
        console.log(`   ⚠ ${outcome.reason}`);
        continue;
      }
    }
  }
}

export async function runStudy(config: Config): Promise<void> {
  const audit = new AuditLog(config.auditPath);
  const store = await ProgressStore.open(config.progressPath, config.programId);
  const session = await openSession(config, programUrl(config));
  const prompt = createPrompt();
  const statuses = new StatusWatcher(session.page);
  const ctx: Context = { config, store, audit, prompt, statuses, auto: { on: config.autoAdvance } };

  console.log(
    config.autoAdvance
      ? `▶ Phiên học — AUTO_ADVANCE bật: thẻ nội dung tự Continue sau ${config.autoDelayMs / 1000}s; video và câu hỏi chờ bạn.`
      : '▶ Phiên học — [Enter] để Continue từng thẻ. Bật AUTO_ADVANCE=1 trong .env để tool tự Continue thẻ nội dung.',
  );

  try {
    let lastStep: { courseId: string; progress: number | null } | null = null;
    for (;;) {
      const outline = await syncProgram(session, config, store, audit);
      if (!outline) return;
      const step = nextStep(outline);
      if (!step) {
        console.log('\n🎉 Đã hoàn thành tất cả các bước của program.');
        return;
      }
      if (step.kind !== 'COURSE') {
        console.log(`\n🛑 Bước ${step.index}: ${step.title} — phần này bạn tự làm trên PartnerU. Tool dừng ở đây.`);
        console.log(`   Ghi chú các course đã học: ${config.notesDir}`);
        await session.page.goto(programUrl(config), { waitUntil: 'domcontentloaded' });
        return;
      }
      if (isLocked(outline.steps, step)) {
        console.log(`\n🔒 Bước ${step.index}: ${step.title} còn khóa trên PartnerU.`);
        return;
      }
      // Came back to the same course without progress: something needs you (e.g. a skipped knowledge check).
      if (lastStep && lastStep.courseId === step.courseId && lastStep.progress === step.progress) {
        console.log(`\n⚠ Course "${step.title}" chưa tăng tiến độ sau khi rời player. Mở PartnerU kiểm tra thẻ còn thiếu, rồi chạy lại.`);
        return;
      }
      lastStep = { courseId: step.courseId, progress: step.progress };

      const result = await studyCourse(session.page, step, ctx);
      if (result === 'quit') {
        console.log('\n⏸ Đã dừng. Chạy lại `npm run study` để học tiếp từ thẻ chưa xong.');
        return;
      }
      if (result === 'stuck') return;
    }
  } finally {
    statuses.stop();
    prompt.close();
    await store.save();
    await session.disconnect().catch(() => undefined);
  }
}
