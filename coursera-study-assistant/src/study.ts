// The study session: a state machine that mirrors the plan in
// docs/auto_learn_ibm_course.md.
//
//   LOGIN_CHECK ─► LOGIN_REQUIRED ─► AUTHENTICATED ─► OPEN_COURSE
//        ─► INSPECT_CURRENT_ITEM ─► AWAIT_ACTION (menu decided by guard.ts)
//              VIDEO / READING   → capture, AI notes, done, skip
//              PRACTICE / GRADED → manual completion only (done / later)
//        ─► SAVE_CHECKPOINT ─► NEXT_ITEM ─► INSPECT_CURRENT_ITEM … ─► DONE
//   [q] / Ctrl+C at any menu → SAVE_CHECKPOINT ─► PAUSED (resume with `npm run study`)
//
// The learner drives: the tool never advances without a key press, and it
// follows whatever page the learner opens in Chrome ([f]).

import type { Page } from 'playwright';
import { courseUrl, type Config } from './config.ts';
import { gotoPath, isLoggedIn, openSession, politeDelay, waitForLogin, type Session } from './browser.ts';
import { classifyItem, itemDisplayType, parseItemPath, type CourseItem } from './course.ts';
import { guardFor, type StudyAction } from './guard.ts';
import { AuditLog, ProgressStore, pickNextItem, resumeTarget } from './store.ts';
import { fetchOutline } from './outline.ts';
import {
  GuardBlockedError,
  captureFromPage,
  ensureNotesFile,
  readSourceText,
  saveSource,
  writeAiNotes,
} from './capture.ts';
import { createLlmFromEnv, type LlmClient } from './ai.ts';
import { itemNotesPrompt } from './study-ai.ts';
import { createPrompt, INTERRUPTED, type Prompt } from './prompt.ts';

export type StudyState =
  | 'LOGIN_CHECK'
  | 'LOGIN_REQUIRED'
  | 'AUTHENTICATED'
  | 'OPEN_COURSE'
  | 'INSPECT_CURRENT_ITEM'
  | 'AWAIT_ACTION'
  | 'SAVE_CHECKPOINT'
  | 'NEXT_ITEM'
  | 'PAUSED'
  | 'DONE';

const ACTIONS: Record<StudyAction, { key: string; short: string; help: string }> = {
  capture: { key: 'c', short: 'capture', help: 'lưu transcript / nội dung bài vào ghi chú local' },
  ai_notes: { key: 'a', short: 'AI notes', help: 'AI tóm tắt, giải thích khái niệm, câu hỏi tự kiểm tra (cần AI_PROVIDER)' },
  done: { key: 'd', short: 'done', help: 'mình đã học / tự hoàn thành item này → sang item tiếp theo' },
  skip: { key: 'k', short: 'skip', help: 'bỏ qua lúc này, không đánh dấu đã học' },
  later: { key: 'l', short: 'later', help: 'để tự làm sau (đánh dấu manual pending)' },
  follow: { key: 'f', short: 'follow', help: 'cập nhật theo trang bạn đang mở trên Chrome' },
  next: { key: 'n', short: 'next', help: 'mở item chưa học tiếp theo' },
  sync: { key: 's', short: 'sync', help: 'đồng bộ outline + trạng thái hoàn thành từ Coursera (tab nền)' },
  quit: { key: 'q', short: 'quit', help: 'tạm dừng, lưu checkpoint (Chrome vẫn mở)' },
};

const SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function syncOutline(session: Session, config: Config, store: ProgressStore, audit: AuditLog): Promise<boolean> {
  console.log('⟳ Đồng bộ outline từ Coursera (tab nền, có nghỉ giữa các trang)...');
  const result = await fetchOutline(session.context, config);
  if (result.items.length === 0) {
    await audit.log('sync_empty', { scannedPages: result.scans.length });
    console.log('⚠ Không đọc được item nào từ trang module. Chạy `npm run probe` rồi gửi báo cáo để chỉnh selector.');
    return false;
  }
  store.applyOutline(result.modules, result.items);
  await store.save();
  await audit.log('sync', { modules: result.modules.length, items: result.items.length });
  console.log(`✓ ${result.modules.length} module, ${result.items.length} item.`);
  return true;
}

function moduleTitle(store: ProgressStore, item: CourseItem): string | null {
  return store.data.modules.find((m) => m.number === item.module)?.title ?? null;
}

function resolveCurrentItem(url: string, store: ProgressStore, courseSlug: string): CourseItem | null {
  const ref = parseItemPath(url);
  if (!ref || ref.courseSlug !== courseSlug) return null;
  const known = store.find(ref.id);
  if (known) return known;
  // Not in the last sync. Classify from the URL alone: anything that is not
  // clearly a video or reading ends up GRADED/OTHER (manual only).
  return store.upsert({
    id: ref.id,
    urlPath: ref.urlPath,
    segment: ref.segment,
    title: ref.slug ?? ref.id,
    typeLabel: null,
    minutes: null,
    module: 0,
    order: 0,
    kind: classifyItem(ref.segment, null),
    courseraCompleted: false,
    locked: false,
    localStatus: 'new',
    sourcePath: null,
    notesPath: null,
  });
}

function printItem(item: CourseItem, store: ProgressStore): void {
  const decision = guardFor(item.kind);
  const inModule = store.data.items.filter((i) => i.module === item.module).length;
  const where = item.module ? `M${item.module} · ${item.order}/${inModule}` : 'ngoài outline — nên [s]ync';
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`[${where}] ${item.title}`);
  console.log(
    `${itemDisplayType(item)}${item.minutes ? ` · ${item.minutes} min` : ''} · Coursera: ${item.courseraCompleted ? '✓ completed' : 'chưa'} · Local: ${item.localStatus}${item.locked ? ' · 🔒 locked' : ''}`,
  );
  console.log(`${decision.manualOnly ? '⛔' : '▶'} ${decision.headline}`);
  console.log(`  ${decision.hint}`);
  if (item.notesPath) console.log(`  ghi chú: ${item.notesPath}`);
}

async function chooseAction(prompt: Prompt, actions: StudyAction[], manualOnly: boolean): Promise<StudyAction> {
  const label = (action: StudyAction) =>
    action === 'done' && manualOnly ? 'done (đã tự làm)' : ACTIONS[action].short;
  const menu = actions.map((action) => `[${ACTIONS[action].key}] ${label(action)}`).join('  ');
  for (;;) {
    const input = (await prompt.ask(`\n${menu}  [?] help\n> `)).toLowerCase();
    if (input === INTERRUPTED) return 'quit';
    if (input === '?' || input === 'h') {
      for (const action of actions) console.log(`  [${ACTIONS[action].key}] ${ACTIONS[action].help}`);
      continue;
    }
    const chosen = actions.find((action) => ACTIONS[action].key === input);
    if (chosen) return chosen;
    if (input) console.log('Phím không hợp lệ cho item này.');
  }
}

/** Fraction of the video played in this page session, or null when it cannot be measured. */
async function videoCoverage(page: Page): Promise<number | null> {
  return page
    .evaluate(() => {
      const video = document.querySelector('video');
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
      let played = 0;
      for (let i = 0; i < video.played.length; i++) played += video.played.end(i) - video.played.start(i);
      return Math.min(1, played / video.duration);
    })
    .catch(() => null);
}

async function confirmDone(page: Page, item: CourseItem, prompt: Prompt): Promise<boolean> {
  const decision = guardFor(item.kind);
  if (decision.manualOnly) {
    return prompt.confirm('Bạn đã tự hoàn thành bài này trên Coursera?');
  }
  if (item.kind === 'VIDEO') {
    const coverage = await videoCoverage(page);
    if (coverage !== null && coverage < 0.9) {
      return prompt.confirm(`Phiên này mới xem khoảng ${Math.round(coverage * 100)}% video. Vẫn đánh dấu đã học?`);
    }
  }
  if (item.kind === 'READING') {
    const markButton = page.getByRole('button', { name: /mark as completed/i });
    if (await markButton.count().catch(() => 0)) {
      console.log('ℹ Coursera có nút "Mark as completed" — hãy tự bấm trên Chrome nếu bạn đã đọc xong (tool không bấm hộ).');
    }
  }
  return true;
}

export async function runStudy(config: Config, options: { forceSync?: boolean } = {}): Promise<void> {
  const store = await ProgressStore.open(config.progressPath, config.courseSlug);
  const audit = new AuditLog(config.auditPath);
  let llm: LlmClient | null = null;
  try {
    llm = createLlmFromEnv();
  } catch (error) {
    console.log(`⚠ AI tắt: ${(error as Error).message}`);
  }

  console.log('Coursera Study Assistant — human-in-the-loop. Không tự làm/nộp bài kiểm tra, không tự đánh dấu hoàn thành.');
  console.log(`AI study helper: ${llm ? `${llm.provider}/${llm.model}` : 'tắt (xem .env.example)'}`);

  const session = await openSession(config, courseUrl(config));
  const prompt = createPrompt();
  const page = session.page;

  // `as` keeps TS from narrowing to the initial literal; `go()` reassigns it.
  let state = 'LOGIN_CHECK' as StudyState;
  let current: CourseItem | null = null;
  let afterCheckpoint: 'NEXT_ITEM' | 'PAUSED' = 'NEXT_ITEM';
  const go = async (next: StudyState) => {
    await audit.log('transition', { from: state, to: next, item: current?.id ?? null });
    state = next;
  };

  await audit.log('session_start', { ai: llm ? `${llm.provider}/${llm.model}` : null });
  try {
    while (state !== 'PAUSED' && state !== 'DONE') {
      switch (state) {
        case 'LOGIN_CHECK':
          await go((await isLoggedIn(session.context)) ? 'AUTHENTICATED' : 'LOGIN_REQUIRED');
          break;

        case 'LOGIN_REQUIRED':
          await go((await waitForLogin(session)) ? 'AUTHENTICATED' : 'PAUSED');
          break;

        case 'AUTHENTICATED': {
          const stale = !store.data.syncedAt || Date.now() - Date.parse(store.data.syncedAt) > SYNC_MAX_AGE_MS;
          if (!store.hasOutline() || stale || options.forceSync) {
            const ok = await syncOutline(session, config, store, audit);
            if (!ok && !store.hasOutline()) {
              await go('PAUSED');
              break;
            }
          }
          await go('OPEN_COURSE');
          break;
        }

        case 'OPEN_COURSE': {
          // If the learner already has an item of this course open, start there.
          const onPage = resolveCurrentItem(page.url(), store, config.courseSlug);
          current = onPage ?? resumeTarget(store.data);
          if (!current) {
            await go('DONE');
            break;
          }
          if (!onPage) await gotoPath(page, current.urlPath);
          await go('INSPECT_CURRENT_ITEM');
          break;
        }

        case 'INSPECT_CURRENT_ITEM':
          current = resolveCurrentItem(page.url(), store, config.courseSlug);
          if (current) printItem(current, store);
          else console.log(`\nTrang hiện tại không phải item của course (${page.url()}).`);
          await go('AWAIT_ACTION');
          break;

        case 'AWAIT_ACTION': {
          if (!current) {
            const action = await chooseAction(prompt, ['next', 'follow', 'sync', 'quit'], false);
            if (action === 'next') await go('NEXT_ITEM');
            else if (action === 'follow') await go('INSPECT_CURRENT_ITEM');
            else if (action === 'sync') await syncOutline(session, config, store, audit);
            else {
              afterCheckpoint = 'PAUSED';
              await go('SAVE_CHECKPOINT');
            }
            break;
          }
          const decision = guardFor(current.kind);
          const action = await chooseAction(prompt, decision.actions, decision.manualOnly);
          await audit.log('action', { item: current.id, kind: current.kind, action });
          switch (action) {
            case 'capture':
              await doCapture(page, current, config, store, audit);
              break;
            case 'ai_notes':
              await doAiNotes(page, current, config, store, audit, llm);
              break;
            case 'done':
              if (await confirmDone(page, current, prompt)) {
                store.update(current.id, { localStatus: 'studied' });
                afterCheckpoint = 'NEXT_ITEM';
                await go('SAVE_CHECKPOINT');
              }
              break;
            case 'skip':
            case 'later':
              store.update(current.id, { localStatus: action === 'skip' ? 'skipped' : 'manual_pending' });
              afterCheckpoint = 'NEXT_ITEM';
              await go('SAVE_CHECKPOINT');
              break;
            case 'follow':
              await go('INSPECT_CURRENT_ITEM');
              break;
            case 'next':
              await go('NEXT_ITEM');
              break;
            case 'sync':
              await syncOutline(session, config, store, audit);
              await go('INSPECT_CURRENT_ITEM');
              break;
            case 'quit':
              afterCheckpoint = 'PAUSED';
              await go('SAVE_CHECKPOINT');
              break;
          }
          break;
        }

        case 'SAVE_CHECKPOINT':
          store.setCheckpoint(current?.id ?? null, afterCheckpoint);
          await store.save();
          await go(afterCheckpoint);
          break;

        case 'NEXT_ITEM': {
          const next = pickNextItem(store.data.items);
          if (!next) {
            await go('DONE');
            break;
          }
          current = next;
          await politeDelay(800, 1600);
          await gotoPath(page, next.urlPath);
          await go('INSPECT_CURRENT_ITEM');
          break;
        }
      }
    }

    if (state === 'DONE') {
      const items = store.data.items;
      const pending = items.filter((i) => i.localStatus === 'manual_pending').length;
      const locked = items.filter((i) => i.locked && !i.courseraCompleted).length;
      console.log(`\n🎉 Không còn item mở. Manual pending: ${pending}, locked: ${locked}. Xem \`npm run status\`.`);
    } else {
      console.log('\n⏸ Đã lưu checkpoint. Chạy `npm run study` để học tiếp. Chrome vẫn mở và giữ đăng nhập.');
    }
  } catch (error) {
    console.error(`\n✖ Dừng do lỗi: ${(error as Error).message}`);
    await audit.log('error', { state, item: current?.id ?? null, message: (error as Error).message });
    process.exitCode = 1;
  } finally {
    store.setCheckpoint(current?.id ?? null, state);
    await store.save();
    await audit.log('session_end', { state });
    prompt.close();
    await session.disconnect().catch(() => undefined);
  }
}

async function doCapture(page: Page, item: CourseItem, config: Config, store: ProgressStore, audit: AuditLog): Promise<boolean> {
  try {
    const result = await captureFromPage(page, item);
    const sourcePath = await saveSource(config, item, result);
    const notesPath = await ensureNotesFile(config, item, moduleTitle(store, item));
    store.update(item.id, { sourcePath, notesPath });
    await store.save();
    await audit.log('capture', { item: item.id, kind: item.kind, method: result.method, chars: result.text.length });
    console.log(`✓ Đã lưu ${result.text.length} ký tự (${result.method})`);
    console.log(`  nguồn:   ${sourcePath}\n  ghi chú: ${notesPath}`);
    return true;
  } catch (error) {
    if (error instanceof GuardBlockedError) {
      await audit.log('guard_block', { item: item.id, kind: item.kind, action: 'capture' });
      console.log(`⛔ ${error.message}`);
    } else {
      console.log(`⚠ ${(error as Error).message}`);
    }
    return false;
  }
}

async function doAiNotes(
  page: Page,
  item: CourseItem,
  config: Config,
  store: ProgressStore,
  audit: AuditLog,
  llm: LlmClient | null,
): Promise<void> {
  if (!guardFor(item.kind).allowAi) {
    await audit.log('guard_block', { item: item.id, kind: item.kind, action: 'ai_notes' });
    console.log('⛔ Guard: không dùng AI cho loại item này.');
    return;
  }
  if (!llm) {
    console.log('AI chưa bật. Đặt AI_PROVIDER + API key trong .env (xem .env.example).');
    return;
  }
  if (!item.sourcePath && !(await doCapture(page, item, config, store, audit))) return;
  const sourcePath = store.find(item.id)?.sourcePath;
  if (!sourcePath) return;

  const text = await readSourceText(sourcePath);
  console.log(`… gửi ${text.length} ký tự nội dung đã capture tới ${llm.provider}/${llm.model}`);
  try {
    const reply = await llm.complete(
      itemNotesPrompt({ module: item.module, title: item.title, type: itemDisplayType(item), text }, config.studyLanguage),
    );
    const notesPath = await ensureNotesFile(config, item, moduleTitle(store, item));
    await writeAiNotes(notesPath, `## AI study notes (${llm.provider}/${llm.model}, ${new Date().toISOString().slice(0, 10)})\n\n${reply}`);
    store.update(item.id, { notesPath });
    await store.save();
    await audit.log('ai_notes', { item: item.id, provider: llm.provider, model: llm.model, inputChars: text.length });
    console.log(`\n${reply}\n\n✓ Đã ghi vào ${notesPath}`);
  } catch (error) {
    console.log(`⚠ AI lỗi: ${(error as Error).message}`);
  }
}
