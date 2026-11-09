// Phase 1 — feasibility probe for PartnerU (Sana). After you sign in, it opens
// the program page and at most two of its course pages, and writes a report of
// what the tool can see: headings, link patterns, buttons, progress markers,
// data-testids and the API calls the app makes (key names and types only).
//
// It never clicks anything, never opens exam / quiz / certificate pages, and
// stores no cookie values, account data or API values. The report stays in
// .data/ (gitignored).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Response } from 'playwright';
import { DEFAULT_PROGRAM, PARTNERU_ORIGIN, programUrl, type Config } from './config.ts';
import { cookieNames, isLoggedIn, openSession, politeDelay, settle, waitForLogin } from './browser.ts';
import { graphqlOperations, groupLinks, jsonShape, pathPattern, pickChildLinks, type LinkInfo } from './inspect.ts';
import { AuditLog } from './audit.ts';

export interface PageInspection {
  path: string;
  pattern: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  links: LinkInfo[];
  buttons: Record<string, number>;
  progressTexts: string[];
  progressBars: Array<{ label: string; value: string | null }>;
  testIds: string[];
  iframes: string[];
  videos: number;
  /** Characters of text inside <main> (or body): is the lesson text in the page or in an iframe? */
  mainTextChars: number;
  /** Form controls by type: radios / checkboxes on a card mean a question (the tool stays out). */
  inputs: Record<string, number>;
  /** Child frames (same-origin or not) and how much text each shows. */
  frames: Array<{ origin: string; pattern: string; chars: number; buttons: string[] }>;
}

async function inspectFrames(page: Page): Promise<PageInspection['frames']> {
  const frames: PageInspection['frames'] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let origin = '(none)';
    let pattern = '';
    try {
      const url = new URL(frame.url());
      origin = url.origin;
      pattern = pathPattern(url.pathname);
    } catch {
      // about:blank / srcdoc frames
    }
    const content = await frame
      .evaluate(() => ({
        chars: document.body?.innerText.length ?? 0,
        buttons: [...document.querySelectorAll('button, [role="button"]')]
          .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 30),
      }))
      .catch(() => ({ chars: -1, buttons: [] as string[] }));
    frames.push({ origin, pattern, ...content });
  }
  return frames;
}

interface ApiCall {
  host: string;
  method: string;
  pattern: string;
  status: number;
  operations: string[];
  shape?: unknown;
}

/** Collects the app's own XHR/fetch traffic while pages load: endpoints and payload shapes, no values. */
class ApiRecorder {
  readonly calls = new Map<string, ApiCall>();
  private readonly page: Page;
  private readonly pending: Promise<void>[] = [];
  private readonly listener = (response: Response) => {
    this.pending.push(this.record(response).catch(() => undefined));
  };

  constructor(page: Page) {
    this.page = page;
    page.on('response', this.listener);
  }

  private async record(response: Response): Promise<void> {
    const request = response.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    const url = new URL(response.url());
    const operations = graphqlOperations(request.postData());
    const key = `${request.method()} ${url.host}${pathPattern(url.pathname)} ${operations.join(',')}`;
    if (this.calls.has(key) || this.calls.size >= 120) return;
    const call: ApiCall = { host: url.host, method: request.method(), pattern: pathPattern(url.pathname), status: response.status(), operations };
    this.calls.set(key, call);
    if (/json/i.test(response.headers()['content-type'] ?? '')) {
      call.shape = jsonShape(await response.json());
    }
  }

  async stop(): Promise<ApiCall[]> {
    this.page.off('response', this.listener);
    await Promise.all(this.pending);
    return [...this.calls.values()];
  }
}

const PROGRESS_TEXT =
  /\b\d{1,3}\s?%|\b(completed?|not started|in progress|locked|unlocked|required|optional|certificate|badge|due|minutes?|min|hours?|lessons?|modules?|courses?)\b/i;

export async function inspectPage(page: Page): Promise<PageInspection> {
  const dom = await page.evaluate(
    ({ origin, progressSource }) => {
      const clean = (text: string | null | undefined, max = 120) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
      const main = document.querySelector('main, [role="main"]');
      const progress = new RegExp(progressSource, 'i');

      const headings = [...document.querySelectorAll('h1, h2, h3, h4')]
        .map((h) => ({ level: Number(h.tagName.slice(1)), text: clean(h.textContent) }))
        .filter((h) => h.text)
        .slice(0, 60);

      const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0, 300).map((a) => {
        let linkPath: string | null = null;
        try {
          const url = new URL(a.href, location.href);
          if (url.origin === origin) linkPath = url.pathname;
        } catch {
          linkPath = null;
        }
        return { path: linkPath, text: clean(a.getAttribute('aria-label') || a.textContent), inMain: Boolean(main?.contains(a)) };
      });

      const buttons: Record<string, number> = {};
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const name = clean(el.getAttribute('aria-label') || el.textContent, 60) || '(no name)';
        buttons[name] = (buttons[name] ?? 0) + 1;
      }

      // Leaf-ish elements whose own text looks like progress / structure markers.
      const progressTexts = new Set<string>();
      for (const el of document.querySelectorAll('span, p, div, li, small, strong')) {
        if (el.children.length > 2) continue;
        const text = clean(el.textContent, 80);
        if (text && text.length <= 80 && progress.test(text)) progressTexts.add(text);
        if (progressTexts.size >= 60) break;
      }

      const progressBars = [...document.querySelectorAll('[role="progressbar"], progress')].slice(0, 30).map((el) => ({
        label: clean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.className.toString(), 60),
        value: el.getAttribute('aria-valuenow') ?? el.getAttribute('value'),
      }));

      const testIds = [...new Set([...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? ''))]
        .filter(Boolean)
        .slice(0, 150);

      const iframes = [...document.querySelectorAll<HTMLIFrameElement>('iframe')].map((frame) => {
        try {
          return new URL(frame.src, location.href).origin;
        } catch {
          return '(no src)';
        }
      });

      const inputs: Record<string, number> = {};
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea, [role="radio"], [role="checkbox"], [contenteditable="true"]')) {
        const type = el.getAttribute('role') ?? (el instanceof HTMLTextAreaElement ? 'textarea' : el.isContentEditable && !(el instanceof HTMLInputElement) ? 'contenteditable' : el.type || 'text');
        inputs[type] = (inputs[type] ?? 0) + 1;
      }

      return {
        path: location.pathname,
        title: clean(document.title),
        headings,
        links,
        buttons,
        progressTexts: [...progressTexts],
        progressBars,
        testIds,
        iframes,
        videos: document.querySelectorAll('video').length,
        mainTextChars: ((main ?? document.body) as HTMLElement).innerText.length,
        inputs,
      };
    },
    { origin: PARTNERU_ORIGIN, progressSource: PROGRESS_TEXT.source },
  );
  return { ...dom, pattern: pathPattern(dom.path), frames: await inspectFrames(page) };
}

export async function runProbe(config: Config, options: { screenshots?: boolean } = {}): Promise<string> {
  const audit = new AuditLog(config.auditPath);
  const startUrl = programUrl(config);
  const session = await openSession(config, startUrl);
  const blockers: string[] = [];
  const notes: string[] = [];
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    programId: config.programId,
    programName: config.programId === DEFAULT_PROGRAM.id ? DEFAULT_PROGRAM.name : null,
  };
  const { page } = session;

  try {
    const loggedIn = (await isLoggedIn(page)) || (await waitForLogin(session, startUrl));
    report.auth = { loggedIn, landedPattern: pathPattern(new URL(page.url()).pathname), cookieNames: await cookieNames(session.context) };
    if (!loggedIn) {
      blockers.push('Chưa đăng nhập (vẫn thấy trang/form đăng nhập sau 10 phút).');
      return await writeReport(config, report, blockers, notes);
    }

    const recorder = new ApiRecorder(page);
    const pages: PageInspection[] = [];
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
      await settle(page, 2500);
      const programPage = await inspectPage(page);
      pages.push(programPage);
      if (programPage.pattern !== '/program/:id') {
        blockers.push(`Mở link program nhưng trang chuyển sang ${programPage.pattern} — kiểm tra quyền truy cập program.`);
      }
      if (options.screenshots) await screenshot(page, config, 'program');

      // One step down per level: program → first open course → its player
      // (the course page's Start link, /s/<edition>/next, opens the next card).
      const seen = new Set([programPage.path]);
      let parent = programPage;
      for (const level of ['course', 'player'] as const) {
        const [next] = pickChildLinks(parent.links, seen, 1);
        if (!next) {
          notes.push(
            level === 'course'
              ? 'Không tìm thấy link course (trong <main>, không phải exam/quiz/feedback) để mở thử.'
              : 'Trang course không có link Start / bài học để mở player.',
          );
          break;
        }
        seen.add(next);
        await politeDelay();
        await page.goto(`${PARTNERU_ORIGIN}${next}`, { waitUntil: 'domcontentloaded' });
        await settle(page, level === 'player' ? 5000 : 2500);
        const inspection = await inspectPage(page);
        seen.add(inspection.path);
        pages.push(inspection);
        if (options.screenshots) await screenshot(page, config, level);
        parent = inspection;
      }
    } finally {
      report.api = await recorder.stop();
    }

    report.pages = pages.map((inspection) => ({ ...inspection, links: undefined, linkGroups: groupLinks(inspection.links) }));
    if (pages.every((inspection) => inspection.headings.length === 0)) {
      blockers.push('Không đọc được heading nào → trang có thể chưa render xong hoặc nằm trong iframe.');
    }
    if (pages.some((inspection) => inspection.iframes.length > 0)) {
      notes.push('Có iframe trên trang: nội dung bài học có thể nằm trong iframe (xem "iframes" theo origin).');
    }
    await audit.log('probe', { pages: pages.map((inspection) => inspection.pattern), blockers: blockers.length });
    return await writeReport(config, report, blockers, notes);
  } finally {
    await session.disconnect().catch(() => undefined);
  }
}

async function screenshot(page: Page, config: Config, name: string): Promise<void> {
  await mkdir(config.probeDir, { recursive: true });
  await page.screenshot({ path: path.join(config.probeDir, `${name}.png`), fullPage: true }).catch(() => undefined);
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

type ReportPage = Omit<PageInspection, 'links'> & { linkGroups: ReturnType<typeof groupLinks> };

export function renderMarkdown(report: Record<string, unknown>, blockers: string[], notes: string[], jsonName: string): string {
  const pages = (report.pages as ReportPage[] | undefined) ?? [];
  const api = (report.api as ApiCall[] | undefined) ?? [];
  const cell = (text: string) => text.replace(/\|/g, '\\|');
  const lines = [
    `# Probe report — ${report.programName ?? report.programId}`,
    '',
    `Generated: ${report.generatedAt} · Program: \`${report.programId}\` · Full data: \`${jsonName}\``,
    '',
    '## Auth',
    '```json',
    JSON.stringify(report.auth ?? null, null, 2),
    '```',
  ];
  for (const inspection of pages) {
    lines.push(
      '',
      `## Page \`${inspection.pattern}\` — ${inspection.title}`,
      '',
      `Videos: ${inspection.videos} · iframes: ${JSON.stringify(inspection.iframes)} · progress bars: ${JSON.stringify(inspection.progressBars)}`,
      '',
      `Main text: ${inspection.mainTextChars} chars · inputs: ${JSON.stringify(inspection.inputs)}`,
      '',
      `Frames: ${JSON.stringify(inspection.frames)}`,
      '',
      '**Headings**',
      ...inspection.headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- h${h.level}: ${h.text}`),
      '',
      '**Links by pattern**',
      '',
      '| pattern | count | in main | sample texts |',
      '|---|---|---|---|',
      ...inspection.linkGroups.map((g) => `| \`${g.pattern}\` | ${g.count} | ${g.inMain} | ${cell(g.texts.join(' · '))} |`),
      '',
      '**Buttons**',
      '',
      ...Object.entries(inspection.buttons).map(([name, count]) => `- ${name}${count > 1 ? ` ×${count}` : ''}`),
      '',
      '**Progress / structure texts**',
      '',
      ...inspection.progressTexts.map((text) => `- ${text}`),
    );
  }
  lines.push(
    '',
    `## API calls (${api.length})`,
    '',
    '| method | host | pattern | status | operations |',
    '|---|---|---|---|---|',
    ...api.map((call) => `| ${call.method} | ${call.host} | \`${call.pattern}\` | ${call.status} | ${call.operations.join(', ')} |`),
    '',
    'Response shapes (key names and types only) are in the JSON file.',
    '',
    '## Blockers',
    ...(blockers.length ? blockers.map((b) => `- ${b}`) : ['- (none)']),
    '',
    '## Notes',
    ...(notes.length ? notes.map((n) => `- ${n}`) : ['- (none)']),
    '',
  );
  return lines.join('\n');
}
