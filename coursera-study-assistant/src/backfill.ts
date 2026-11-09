// Backfill: fetch the transcripts of videos you already studied, so
// `npm run summary` covers the whole course. One background tab, one video at
// a time, with a polite pause between pages, the same way `sync` reads the
// outline. It only reads the captions: the player in that tab is muted and
// paused the moment it tries to play, so nothing plays and no watch progress is
// recorded. Progress is saved after every video, so Ctrl+C loses nothing.

import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright';
import { COURSERA_ORIGIN, courseUrl, type Config } from './config.ts';
import type { CourseItem } from './course.ts';
import { isLoggedIn, openSession, politeDelay, waitForLogin } from './browser.ts';
import { AuditLog, ProgressStore, sortItems } from './store.ts';
import { GuardBlockedError, captureFromPage, ensureNotesFile, saveSource, type CaptureResult } from './capture.ts';

/** Videos with no saved transcript yet, not locked, in course order. */
export function backfillTargets(items: CourseItem[], module?: number): CourseItem[] {
  return sortItems(items).filter(
    (item) => item.kind === 'VIDEO' && !item.sourcePath && !item.locked && (module === undefined || item.module === module),
  );
}

async function quietPlayer(tab: Page): Promise<void> {
  await tab
    .evaluate(() => {
      for (const video of document.querySelectorAll('video')) {
        video.muted = true;
        video.pause();
      }
    })
    .catch(() => undefined);
}

/**
 * Capture one video's transcript, retrying while the player loads its captions.
 * A guard block (the tab is not on this item, e.g. Coursera redirected) stops at once.
 */
export async function captureVideo(
  tab: Page,
  item: CourseItem,
  { attempts = 6, waitMs = 2500, capture = captureFromPage }: { attempts?: number; waitMs?: number; capture?: typeof captureFromPage } = {},
): Promise<CaptureResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await quietPlayer(tab);
    try {
      return await capture(tab, item);
    } catch (error) {
      if (error instanceof GuardBlockedError) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(waitMs);
  }
  throw lastError;
}

export async function runBackfill(config: Config, options: { module?: number | 'all' } = {}): Promise<void> {
  const store = await ProgressStore.open(config.progressPath, config.courseSlug);
  if (!store.hasOutline()) {
    console.log(`Chưa có outline cho ${config.courseSlug}. Chạy \`npm run sync\` trước.`);
    return;
  }
  const module = typeof options.module === 'number' ? options.module : undefined;
  const targets = backfillTargets(store.data.items, module);
  const scope = `${config.courseSlug}${module ? ` · module ${module}` : ''}`;
  if (targets.length === 0) {
    console.log(`✓ Mọi video (${scope}) đã có transcript. Chạy \`npm run summary\` để tóm tắt.`);
    return;
  }
  console.log(`Backfill transcript: ${targets.length} video (${scope}).`);
  console.log('Tab nền, nghỉ 1.5–3.5 s giữa các trang, video bị tắt tiếng + dừng ngay. Ctrl+C để dừng (đã lưu sau mỗi video).');
  console.log('Đừng chạy cùng lúc với `npm run study` (hai lệnh cùng ghi progress.json).\n');

  const audit = new AuditLog(config.auditPath);
  await audit.log('backfill_start', { targets: targets.length, module: module ?? 'all' });
  let stopped = false;
  const onSigint = () => {
    stopped = true;
    console.log('\n⏸ Dừng sau video hiện tại...');
  };
  process.once('SIGINT', onSigint);

  const session = await openSession(config, courseUrl(config));
  let saved = 0;
  const failed: CourseItem[] = [];
  try {
    if (!(await isLoggedIn(session.context)) && !(await waitForLogin(session))) {
      process.exitCode = 1;
      return;
    }
    const tab = await session.context.newPage();
    // Never let a video play in this tab.
    await tab.addInitScript(() => {
      document.addEventListener(
        'play',
        (event) => {
          if (event.target instanceof HTMLMediaElement) {
            event.target.muted = true;
            event.target.pause();
          }
        },
        true,
      );
    });
    try {
      for (const [index, item] of targets.entries()) {
        if (stopped) break;
        const label = `[${index + 1}/${targets.length}] M${item.module} · ${item.title}`;
        try {
          await tab.goto(`${COURSERA_ORIGIN}${item.urlPath}`, { waitUntil: 'domcontentloaded' });
          const result = await captureVideo(tab, item);
          const sourcePath = await saveSource(config, item, result);
          const moduleTitle = store.data.modules.find((m) => m.number === item.module)?.title ?? null;
          const notesPath = await ensureNotesFile(config, item, moduleTitle);
          store.update(item.id, { sourcePath, notesPath });
          await store.save();
          await audit.log('capture', { item: item.id, kind: item.kind, method: result.method, chars: result.text.length, backfill: true });
          saved++;
          console.log(`✓ ${label} — ${result.text.length} ký tự`);
        } catch (error) {
          failed.push(item);
          console.log(`⚠ ${label} — ${(error as Error).message.split('\n')[0]}`);
        }
        if (!stopped && index < targets.length - 1) await politeDelay();
      }
    } finally {
      await tab.close().catch(() => undefined);
    }
  } finally {
    process.off('SIGINT', onSigint);
    await audit.log('backfill_end', { saved, failed: failed.length, stopped });
    await session.disconnect().catch(() => undefined);
  }

  const left = targets.length - saved - failed.length;
  console.log(`\nĐã lưu ${saved} transcript${failed.length ? `, lỗi ${failed.length}` : ''}${left ? `, còn ${left} chưa chạy` : ''}.`);
  if (failed.length || left) console.log('Chạy lại `npm run backfill` để thử tiếp các video còn thiếu.');
  if (saved) console.log('Tiếp theo: `npm run summary` để AI tóm tắt kiến thức theo module + cả course.');
}
