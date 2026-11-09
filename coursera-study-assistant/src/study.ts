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
// The learner drives: the tool advances on a key press, or by itself only when
// a video was actually played >= 90 % to its end. It follows whatever page the
// learner opens in Chrome ([f]).

import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright';
import { courseUrl, type Config } from './config.ts';
import { gotoPath, isLoggedIn, openSession, politeDelay, waitForLogin, type Session } from './browser.ts';
import { classifyItem, itemDisplayType, parseItemPath, type CourseItem, type ItemKind } from './course.ts';
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
import { AUTO_MARK_DELAY_MS, autoRouteReady, completeOnCoursera, detectRoute, type Route } from './complete.ts';

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
  done: {
    key: 'd',
    short: 'done',
    help: 'mình đã học / xong item này → (reading, ungraded) tool bấm "Mark as completed" trên Coursera nếu có nút → item tiếp theo',
  },
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
  if (item.kind === 'VIDEO') {
    console.log(`  Xem hết video (≥ ${WATCHED_COVERAGE * 100}%) → tool tự đánh dấu done và mở bài tiếp, không cần bấm phím.`);
    console.log('  Muốn capture / AI notes thì bấm c / a trước khi video hết. Enter = done ngay.');
  }
  if (item.notesPath) console.log(`  ghi chú: ${item.notesPath}`);
}

/**
 * What Enter with no input does on an item. Videos and OTHER items (plugin,
 * role play, discussion…) → "done"; confirmDone still asks afterwards (video
 * < 90 % coverage, manual "đã tự làm?"). Practice / graded items have no
 * default, so a stray Enter never starts marking an assessment as done.
 */
export function defaultActionFor(kind: ItemKind): StudyAction | null {
  return kind === 'VIDEO' || kind === 'OTHER' ? 'done' : null;
}

const NEVER = new Promise<never>(() => undefined);

/**
 * Show the menu and wait for a key. If `auto` is given, it races the keyboard:
 * when it resolves to an allowed action first, the pending question is
 * cancelled and that action is returned (used for "video finished → done").
 */
export async function chooseAction(
  prompt: Prompt,
  actions: StudyAction[],
  manualOnly: boolean,
  defaultAction: StudyAction | null = null,
  auto?: (signal: AbortSignal) => Promise<StudyAction | null>,
): Promise<StudyAction> {
  const fallback = defaultAction && actions.includes(defaultAction) ? defaultAction : null;
  const label = (action: StudyAction) =>
    `${action === 'done' && manualOnly ? 'done (đã tự làm)' : ACTIONS[action].short}${action === fallback ? ' (Enter)' : ''}`;
  const menu = actions.map((action) => `[${ACTIONS[action].key}] ${label(action)}`).join('  ');
  for (;;) {
    const stop = new AbortController();
    let input: string;
    try {
      const fired = auto
        ? auto(stop.signal)
            .then((action) => (action && actions.includes(action) ? action : NEVER))
            .catch(() => NEVER)
        : NEVER;
      const result = await Promise.race([
        prompt.ask(`\n${menu}  [?] help\n> `, stop.signal).then((text) => ({ text })),
        fired.then((action) => ({ action })),
      ]);
      if ('action' in result) return result.action;
      input = result.text.toLowerCase();
    } finally {
      stop.abort(); // cancel whichever side lost the race
    }
    if (input === INTERRUPTED) return 'quit';
    if (input === '?' || input === 'h') {
      for (const action of actions) console.log(`  [${ACTIONS[action].key}] ${ACTIONS[action].help}`);
      if (fallback) console.log(`  [Enter] = ${ACTIONS[fallback].short}`);
      continue;
    }
    if (!input && fallback) return fallback;
    const chosen = actions.find((action) => ACTIONS[action].key === input);
    if (chosen) return chosen;
    if (input) console.log('Phím không hợp lệ cho item này.');
  }
}

/** Share of a video that must actually be played (not skipped) to count as watched. */
export const WATCHED_COVERAGE = 0.9;

interface VideoState {
  /** Fraction of the video played in this page session (seeking does not count). */
  coverage: number;
  /** Playback is at (or within 1.5 s of) the end. */
  atEnd: boolean;
}

async function readVideoState(page: Page): Promise<VideoState | null> {
  return page
    .evaluate(() => {
      const video = document.querySelector('video');
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
      let played = 0;
      for (let i = 0; i < video.played.length; i++) played += video.played.end(i) - video.played.start(i);
      return { coverage: Math.min(1, played / video.duration), atEnd: video.ended || video.currentTime >= video.duration - 1.5 };
    })
    .catch(() => null);
}

/**
 * Fraction of the video played in this page session, or null when it cannot
 * be measured — including when Chrome has already moved on to another item
 * (Coursera can auto-advance at the end of a video).
 */
async function videoCoverage(page: Page, item: CourseItem): Promise<number | null> {
  if (parseItemPath(page.url())?.id !== item.id) return null;
  return (await readVideoState(page))?.coverage ?? null;
}

const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

/**
 * Resolves 'done' once you have played >= 90 % of this video and reached its
 * end. Skipping to the end does not count (coverage is what was played). If
 * Coursera auto-advances, the last reading taken on the video page decides.
 * Otherwise it stays pending until `signal` aborts, then resolves null.
 */
export async function videoFinished(page: Page, item: CourseItem, signal: AbortSignal, pollMs = 1000): Promise<'done' | null> {
  let lastCoverage = 0;
  while (!signal.aborted) {
    if (parseItemPath(page.url())?.id !== item.id) {
      if (lastCoverage >= WATCHED_COVERAGE) return 'done';
      break; // you navigated away mid-video: just wait for a key
    }
    const state = await readVideoState(page);
    if (state) {
      lastCoverage = state.coverage;
      if (state.atEnd && state.coverage >= WATCHED_COVERAGE) return 'done';
    }
    await sleep(pollMs, undefined, { signal }).catch(() => undefined);
  }
  await untilAborted(signal);
  return null;
}

export async function confirmDone(page: Page, item: CourseItem, prompt: Prompt): Promise<boolean> {
  const decision = guardFor(item.kind);
  if (decision.manualOnly) {
    // You already pressed [d] on purpose, so Enter confirms. When the page
    // offers a way to finish it on Coursera (ungraded items only), say what the
    // tool is about to do; otherwise this is a local status only.
    const route = decision.allowMarkComplete ? await detectRoute(page, item) : null;
    return prompt.confirm(route ? ROUTE_QUESTION[route] : 'Bạn đã tự hoàn thành bài này trên Coursera?', true);
  }
  if (item.kind === 'VIDEO') {
    const coverage = await videoCoverage(page, item);
    if (coverage !== null && coverage < WATCHED_COVERAGE) {
      // Coverage only counts this page session (Coursera resumes where you
      // left off), so Enter = yes; type n to stay on the video.
      return prompt.confirm(`Phiên này mới xem khoảng ${Math.round(coverage * 100)}% video. Vẫn đánh dấu đã học?`, true);
    }
  }
  return true;
}

const ROUTE_QUESTION: Record<Route, string> = {
  mark: 'Bấm "Mark as completed" trên Coursera cho bài này rồi sang bài tiếp?',
  dialogue: 'Start rồi End hoạt động trên Coursera (text chat, chọn "I don\'t have time…") rồi sang bài tiếp?',
};

const ROUTE_DONE: Record<Route, string> = {
  mark: '✓ Đã bấm "Mark as completed" trên Coursera.',
  dialogue: '✓ Đã Start → End hoạt động ("I don\'t have time…") trên Coursera.',
};

/**
 * After a confirmed [d]: finish the item on Coursera ("Mark as completed" or
 * Start → End Dialogue) where the guard allows it. Returns false to stay on
 * the item (it did not go through).
 */
async function markOnCoursera(page: Page, item: CourseItem, store: ProgressStore, audit: AuditLog): Promise<boolean> {
  if (!guardFor(item.kind).allowMarkComplete) return true;
  const { route, outcome } = await completeOnCoursera(page, item);
  await audit.log('mark_completed', { item: item.id, kind: item.kind, route, ...outcome });
  switch (outcome.status) {
    case 'clicked':
      store.update(item.id, { courseraCompleted: true });
      console.log(route ? ROUTE_DONE[route] : '✓ Xong trên Coursera.');
      return true;
    case 'not_found':
      console.log('ℹ Trang không có "Mark as completed" hay "Start Dialogue/Role Play/Activity" (Coursera có thể đã tính completed) → chỉ đánh dấu local.');
      return true;
    case 'blocked':
      console.log(`ℹ ${outcome.reason} Không bấm gì trên Coursera, chỉ đánh dấu local.`);
      return true;
    case 'failed':
      console.log(`⚠ ${outcome.reason}. Tự làm nốt trên Chrome rồi bấm [d] lại, hoặc [l] để làm sau.`);
      if (outcome.controls?.length) {
        console.log('  Tên các nút trên trang đã được ghi vào audit.jsonl (dòng mark_completed). Gửi dòng đó để chỉnh selector.');
      }
      return false;
  }
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

  console.log(
    'Coursera Study Assistant — human-in-the-loop. Không tự làm/nộp bài kiểm tra; "Mark as completed" chỉ bấm trên reading / ungraded item.',
  );
  console.log(`AI study helper: ${llm ? `${llm.provider}/${llm.model}` : 'tắt (xem .env.example)'}`);
  if (config.autoMarkComplete) {
    console.log('AUTO_MARK_COMPLETE: bật — reading / ungraded item có "Mark as completed" hoặc "Start Dialogue/Role Play/Activity" sẽ được tự làm xong rồi mở bài tiếp.');
  }

  const session = await openSession(config, courseUrl(config));
  const prompt = createPrompt();
  const page = session.page;

  // `as` keeps TS from narrowing to the initial literal; `go()` reassigns it.
  let state = 'LOGIN_CHECK' as StudyState;
  let current: CourseItem | null = null;
  let afterCheckpoint: 'NEXT_ITEM' | 'PAUSED' = 'NEXT_ITEM';
  // AUTO_MARK_COMPLETE fires at most once per item, so a click Coursera does
  // not confirm leaves you at the menu instead of retrying in a loop.
  const autoTried = new Set<string>();
  const captureTried = new Set<string>();
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
          const watching = current;
          // AUTO_CAPTURE: save each video's transcript once, as soon as it is opened.
          if (config.autoCapture && current.kind === 'VIDEO' && !current.sourcePath && !captureTried.has(current.id)) {
            captureTried.add(current.id);
            await doCapture(page, current, config, store, audit, { auto: true });
          }
          let autoDone = false;
          const autoMark =
            config.autoMarkComplete && decision.allowMarkComplete && !watching.courseraCompleted && !autoTried.has(watching.id);
          const auto =
            watching.kind === 'VIDEO'
              ? async (signal: AbortSignal) => {
                  const result = await videoFinished(page, watching, signal);
                  if (result) {
                    autoDone = true;
                    console.log(`\n✓ Đã xem hết video (≥ ${WATCHED_COVERAGE * 100}%) → tự đánh dấu done.`);
                  }
                  return result;
                }
              : autoMark
                ? async (signal: AbortSignal) => {
                    const result = await autoRouteReady(page, watching, signal);
                    if (result) {
                      autoDone = true;
                      autoTried.add(watching.id);
                      console.log('\n→ AUTO: hoàn thành bài này trên Coursera...');
                    }
                    return result;
                  }
                : undefined;
          if (autoMark) {
            console.log(
              `  AUTO: trang có "Mark as completed" / "Start Dialogue/Activity" thì tool tự làm sau ${AUTO_MARK_DELAY_MS / 1000}s rồi mở bài tiếp. Gõ phím khác (vd l, f, q) + Enter để dừng.`,
            );
          }
          const action = await chooseAction(prompt, decision.actions, decision.manualOnly, defaultActionFor(current.kind), auto);
          await audit.log('action', { item: current.id, kind: current.kind, action, auto: autoDone });
          switch (action) {
            case 'capture':
              await doCapture(page, current, config, store, audit);
              break;
            case 'ai_notes':
              await doAiNotes(page, current, config, store, audit, llm);
              break;
            case 'done':
              // An auto "done" (video watched >= 90 %, or AUTO_MARK_COMPLETE) needs no question.
              if ((autoDone || (await confirmDone(page, current, prompt))) && (await markOnCoursera(page, current, store, audit))) {
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
          // Coursera may already have auto-advanced to exactly this item.
          if (parseItemPath(page.url())?.id !== next.id) {
            await politeDelay(800, 1600);
            await gotoPath(page, next.urlPath);
          }
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
      const captured = items.filter((i) => i.sourcePath).length;
      if (captured) console.log(`📚 Đã có transcript của ${captured} bài. Chạy \`npm run summary\` để AI tóm tắt kiến thức theo module + cả course.`);
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

/**
 * Capture the item's transcript / text into local notes. `auto` (AUTO_CAPTURE
 * on a video you just opened) retries while the player loads its captions and
 * prints a single line.
 */
async function doCapture(
  page: Page,
  item: CourseItem,
  config: Config,
  store: ProgressStore,
  audit: AuditLog,
  { auto = false } = {},
): Promise<boolean> {
  const attempts = auto ? 4 : 1;
  const tag = auto ? '📝 Auto capture: ' : '';
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await captureFromPage(page, item);
      const sourcePath = await saveSource(config, item, result);
      const notesPath = await ensureNotesFile(config, item, moduleTitle(store, item));
      store.update(item.id, { sourcePath, notesPath });
      await store.save();
      await audit.log('capture', { item: item.id, kind: item.kind, method: result.method, chars: result.text.length, auto });
      console.log(`${auto ? tag : '✓ '}Đã lưu ${result.text.length} ký tự transcript (${result.method})`);
      if (!auto) console.log(`  nguồn:   ${sourcePath}\n  ghi chú: ${notesPath}`);
      return true;
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        await audit.log('guard_block', { item: item.id, kind: item.kind, action: 'capture' });
        if (!auto) console.log(`⛔ ${error.message}`);
        return false;
      }
      if (attempt < attempts) {
        await sleep(2000);
        continue;
      }
      console.log(`⚠ ${tag}${(error as Error).message}`);
      return false;
    }
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
