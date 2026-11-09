// Phase 1 — browser feasibility probe. Produces a report of what the tool can
// see after login (outline, item types, completion markers, video/reading
// page controls) plus a list of blockers. It opens one video and one reading
// page at most and NEVER opens practice/graded/other items.
//
// The report contains course structure and UI hints only: no cookie values,
// no account details, no captured course text (only character counts).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { courseUrl, type Config } from './config.ts';
import { courseraCookieNames, gotoPath, isLoggedIn, openSession, politeDelay, waitForLogin } from './browser.ts';
import { parseItemRow, type CourseItem, type ItemKind } from './course.ts';
import { fetchOutline } from './outline.ts';
import { captureFromPage } from './capture.ts';
import { AuditLog } from './store.ts';

interface PageInspection {
  path: string;
  hasVideo: boolean;
  trackLangs: string[];
  controls: Record<string, number>;
  cmlBlocks: number;
  capture: { method: string; chars: number } | { error: string };
}

const truncate = (text: string | null, max = 300) => (text ? text.replace(/\s+/g, ' ').trim().slice(0, max) : text);

async function pauseVideos(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('video').forEach((video) => video.pause())).catch(() => undefined);
}

async function inspectItemPage(page: Page, item: CourseItem): Promise<PageInspection> {
  const count = (locator: ReturnType<Page['locator']>) => locator.count().catch(() => -1);
  const dom = await page.evaluate(() => ({
    hasVideo: Boolean(document.querySelector('video')),
    trackLangs: [...document.querySelectorAll<HTMLTrackElement>('video track')].map((t) => `${t.kind}:${t.srclang}`),
    cmlBlocks: document.querySelectorAll('.rc-CML, [data-testid*="cml" i]').length,
  }));
  const controls = {
    transcriptButton: await count(page.getByRole('button', { name: /transcript/i })),
    notesButton: await count(page.getByRole('button', { name: /^notes$/i })),
    saveNoteButton: await count(page.getByRole('button', { name: /save note/i })),
    nextItem: await count(page.getByRole('button', { name: /go to next item/i }).or(page.getByRole('link', { name: /go to next item/i }))),
    markAsCompletedButton: await count(page.getByRole('button', { name: /mark as completed/i })),
    coachDiveDeeper: await count(page.getByText(/dive deeper on this topic/i)),
  };
  let capture: PageInspection['capture'];
  try {
    const result = await captureFromPage(page, item);
    capture = { method: result.method, chars: result.text.length };
  } catch (error) {
    capture = { error: (error as Error).message };
  }
  return { path: new URL(page.url()).pathname, ...dom, controls, capture };
}

export async function runProbe(config: Config, options: { screenshots?: boolean } = {}): Promise<string> {
  const audit = new AuditLog(config.auditPath);
  const session = await openSession(config, courseUrl(config));
  const blockers: string[] = [];
  const notes: string[] = [];
  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), courseSlug: config.courseSlug };
  let page: Page | null = null;

  try {
    const loggedIn = (await isLoggedIn(session.context)) || (await waitForLogin(session));
    report.auth = { loggedIn, authCookie: 'CAUTH', courseraCookieNames: await courseraCookieNames(session.context) };
    if (!loggedIn) {
      blockers.push('Chưa đăng nhập (không thấy cookie CAUTH).');
      return await writeReport(config, report, blockers, notes);
    }

    const outline = await fetchOutline(session.context, config);
    report.modulePages = outline.scans.map((scan) => ({
      requestedUrl: scan.requestedUrl,
      finalPath: scan.finalPath,
      scope: scan.scope,
      moduleTitle: scan.moduleTitle,
      headings: scan.headings,
      moduleNumbers: scan.moduleNumbers,
      itemLinks: scan.rows.length,
      typeNames: [...new Set(scan.rows.map((row) => row.typeName))],
      sampleRows: scan.rows.slice(0, 4).map((row) => ({
        path: row.path,
        typeName: row.typeName,
        nameText: row.nameText,
        completedIcon: row.completedIcon,
        anchorText: truncate(row.anchorText),
        rowText: truncate(row.rowText),
        ariaLabel: truncate(row.ariaLabel),
        hintText: truncate(row.hintText),
        parsed: parseItemRow(row),
      })),
      dataTestIds: scan.dataTestIds,
    }));
    report.modules = outline.modules;
    report.items = outline.items.map((i) => ({
      m: i.module,
      n: i.order,
      id: i.id,
      segment: i.segment,
      kind: i.kind,
      typeLabel: i.typeLabel,
      minutes: i.minutes,
      completed: i.courseraCompleted,
      locked: i.locked,
      title: i.title,
    }));
    const byKind: Partial<Record<ItemKind, number>> = {};
    for (const item of outline.items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    report.itemsByKind = byKind;
    report.segments = [...new Set(outline.items.map((i) => i.segment))];

    if (outline.items.length === 0) blockers.push('Không tìm thấy link item nào trên trang module → cần chỉnh scanItemRows().');
    if (outline.items.length > 0 && outline.items.every((i) => !i.typeLabel)) {
      blockers.push('Không parse được type label (Video/Reading/...) → xem sampleRows để chỉnh parseItemRow().');
    }
    const otherSegments = [...new Set(outline.items.filter((i) => i.kind === 'OTHER').map((i) => i.segment))];
    if (otherSegments.length) {
      notes.push(`Item OTHER (manual — plugin/role play/dialogue...) theo segment: ${otherSegments.join(', ')}.`);
    }
    report.completedCount = outline.items.filter((i) => i.courseraCompleted).length;
    if (outline.items.length > 0 && !outline.items.some((i) => i.courseraCompleted)) {
      notes.push('Không phát hiện item nào "completed". Đúng nếu bạn chưa hoàn thành item nào; nếu không thì cần chỉnh detectCompleted().');
    }

    page = await session.context.newPage();
    for (const kind of ['VIDEO', 'READING'] as const) {
      const sample = outline.items.find((i) => i.kind === kind && !i.locked);
      if (!sample) {
        notes.push(`Không có item ${kind} (chưa khóa) để kiểm tra.`);
        continue;
      }
      await politeDelay();
      await gotoPath(page, sample.urlPath);
      // The probe must not add watch progress you did not make: pause any
      // autoplaying video as soon as it exists, and again after rendering.
      await page.waitForSelector('video', { timeout: 15_000 }).catch(() => undefined);
      await pauseVideos(page);
      await page.waitForTimeout(3000); // let the SPA and player render
      await pauseVideos(page);
      const item: CourseItem = { ...sample, localStatus: 'new', sourcePath: null, notesPath: null };
      const inspection = await inspectItemPage(page, item);
      report[kind === 'VIDEO' ? 'videoPage' : 'readingPage'] = inspection;
      if ('error' in inspection.capture) blockers.push(`${kind}: capture thất bại — ${inspection.capture.error}`);
      if (options.screenshots) {
        await mkdir(config.probeDir, { recursive: true });
        await page.screenshot({ path: path.join(config.probeDir, `${kind.toLowerCase()}-page.png`) });
      }
    }
    await audit.log('probe', { items: outline.items.length, blockers: blockers.length });
    return await writeReport(config, report, blockers, notes);
  } finally {
    await page?.close().catch(() => undefined);
    await session.disconnect().catch(() => undefined);
  }
}

async function writeReport(config: Config, report: Record<string, unknown>, blockers: string[], notes: string[]): Promise<string> {
  report.blockers = blockers;
  report.notes = notes;
  await mkdir(config.probeDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(config.probeDir, `probe-${stamp}.json`);
  const mdPath = path.join(config.probeDir, `probe-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdown(report, blockers, notes, path.basename(jsonPath)), 'utf8');
  return mdPath;
}

function renderMarkdown(report: Record<string, unknown>, blockers: string[], notes: string[], jsonName: string): string {
  const items = (report.items as Array<Record<string, unknown>> | undefined) ?? [];
  const lines = [
    `# Probe report — ${report.courseSlug}`,
    '',
    `Generated: ${report.generatedAt} · Full data: \`${jsonName}\``,
    '',
    '## Auth',
    '```json',
    JSON.stringify(report.auth ?? null, null, 2),
    '```',
    '',
    `## Outline (${items.length} items)`,
    '',
    `By kind: \`${JSON.stringify(report.itemsByKind ?? {})}\` · URL segments: \`${JSON.stringify(report.segments ?? [])}\``,
    '',
    '| M | # | kind | label | min | done | lock | title |',
    '|---|---|------|-------|-----|------|------|-------|',
    ...items.map(
      (i) =>
        `| ${i.m} | ${i.n} | ${i.kind} | ${i.typeLabel ?? '—'} | ${i.minutes ?? '—'} | ${i.completed ? '✓' : ''} | ${i.locked ? '🔒' : ''} | ${String(i.title).replace(/\|/g, '\\|')} |`,
    ),
    '',
    '## Video page',
    '```json',
    JSON.stringify(report.videoPage ?? null, null, 2),
    '```',
    '',
    '## Reading page',
    '```json',
    JSON.stringify(report.readingPage ?? null, null, 2),
    '```',
    '',
    '## Blockers',
    ...(blockers.length ? blockers.map((b) => `- ${b}`) : ['- (none)']),
    '',
    '## Notes',
    ...(notes.length ? notes.map((n) => `- ${n}`) : ['- (none)']),
    '',
    'Module-page samples (raw row text, parse result, data-testid list) are in the JSON file — share it to tune selectors.',
    '',
  ];
  return lines.join('\n');
}
