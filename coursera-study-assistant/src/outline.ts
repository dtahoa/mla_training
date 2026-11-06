// Reads the course outline (modules → items, completion, lock state) from the
// module pages /learn/<slug>/home/module/<n>. Extraction keys off item links
// (URL patterns), not CSS class names, so it survives most UI restyles.
// Runs in a separate background tab so the learner's tab is not disturbed.

import type { BrowserContext, Page } from 'playwright';
import { courseUrl, type Config } from './config.ts';
import { classifyItem, parseItemPath, parseItemRow, type RawItemRow } from './course.ts';
import { politeDelay } from './browser.ts';
import type { ModuleInfo, OutlineItem } from './store.ts';

export interface ModulePageScan {
  requestedUrl: string;
  finalPath: string;
  scope: 'main' | 'document';
  moduleTitle: string | null;
  rows: RawItemRow[];
  dataTestIds: string[];
}

export interface OutlineResult {
  modules: ModuleInfo[];
  items: OutlineItem[];
  scans: ModulePageScan[];
}

/** Collect raw item-link rows from the module page currently loaded in `page`. */
export async function scanItemRows(page: Page, courseSlug: string): Promise<Omit<ModulePageScan, 'requestedUrl'>> {
  return page.evaluate((slug: string) => {
    const prefix = `/learn/${slug}/`;
    const itemPath = (href: string | null): string | null => {
      if (!href) return null;
      try {
        const pathname = new URL(href, location.href).pathname;
        if (!pathname.startsWith(prefix) || pathname.startsWith(`${prefix}home`)) return null;
        return pathname.split('/').length >= 5 ? pathname : null;
      } catch {
        return null;
      }
    };
    const itemLinks = (root: ParentNode): HTMLAnchorElement[] =>
      [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => itemPath(a.getAttribute('href')));
    const distinctItems = (el: Element): number =>
      new Set(itemLinks(el).map((a) => itemPath(a.getAttribute('href')))).size;

    const main = document.querySelector('main, [role="main"]');
    let scope: 'main' | 'document' = 'main';
    let anchors = main ? itemLinks(main) : [];
    if (anchors.length === 0) {
      scope = 'document';
      anchors = itemLinks(document);
    }

    const seen = new Set<string>();
    const rows = [];
    for (const anchor of anchors) {
      const path = itemPath(anchor.getAttribute('href'));
      if (!path || seen.has(path)) continue;
      seen.add(path);
      let row: Element = anchor.closest('li') ?? anchor.parentElement?.parentElement ?? anchor;
      if (distinctItems(row) > 1) row = anchor.parentElement ?? anchor;
      const hints = [row, ...row.querySelectorAll('[aria-label], [title], svg title')]
        .map((node) => node.getAttribute('aria-label') ?? node.getAttribute('title') ?? (node.tagName.toLowerCase() === 'title' ? node.textContent : ''))
        .filter((text): text is string => Boolean(text && text.trim()));
      rows.push({
        path,
        anchorText: (anchor as HTMLElement).innerText ?? '',
        rowText: (row as HTMLElement).innerText ?? '',
        ariaLabel: anchor.getAttribute('aria-label'),
        hintText: hints.join(' | ').slice(0, 500),
      });
    }

    const heading = [...(main ?? document).querySelectorAll('h1, h2')]
      .map((h) => (h as HTMLElement).innerText.trim())
      .find((text) => text && !/^module \d+$/i.test(text));
    const dataTestIds = [...new Set([...(main ?? document).querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? ''))]
      .filter(Boolean)
      .slice(0, 80);

    return {
      finalPath: location.pathname,
      scope,
      moduleTitle: heading ? heading.replace(/^module \d+\s*[:\-–]?\s*/i, '') : null,
      rows,
      dataTestIds,
    };
  }, courseSlug);
}

async function loadModulePage(page: Page, url: string, courseSlug: string): Promise<ModulePageScan> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Coursera is a SPA: wait until item links render, or the app redirects away
  // (module does not exist), or give up quietly after the timeout.
  await page
    .waitForFunction(
      ({ slug, expectedPath }: { slug: string; expectedPath: string }) =>
        !location.pathname.startsWith(expectedPath) ||
        [...document.querySelectorAll('a[href]')].some((a) => {
          const href = a.getAttribute('href') ?? '';
          return href.includes(`/learn/${slug}/`) && !href.includes(`/learn/${slug}/home`);
        }),
      { slug: courseSlug, expectedPath: new URL(url).pathname },
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  return { requestedUrl: url, ...(await scanItemRows(page, courseSlug)) };
}

export function rowsToItems(rows: RawItemRow[], moduleNumber: number): OutlineItem[] {
  const items: OutlineItem[] = [];
  const seenIds = new Set<string>();
  for (const row of rows) {
    const ref = parseItemPath(row.path);
    if (!ref || seenIds.has(ref.id)) continue;
    seenIds.add(ref.id);
    const parsed = parseItemRow(row);
    items.push({
      id: ref.id,
      urlPath: ref.urlPath,
      segment: ref.segment,
      title: parsed.title,
      typeLabel: parsed.typeLabel,
      minutes: parsed.minutes,
      module: moduleNumber,
      order: items.length + 1,
      kind: classifyItem(ref.segment, parsed.typeLabel),
      courseraCompleted: parsed.completed,
      locked: parsed.locked,
    });
  }
  return items;
}

export async function fetchOutline(context: BrowserContext, config: Config): Promise<OutlineResult> {
  const page = await context.newPage();
  const result: OutlineResult = { modules: [], items: [], scans: [] };
  try {
    let unit: 'module' | 'week' = 'module';
    for (let n = 1; n <= config.maxModules; n++) {
      let scan = await loadModulePage(page, courseUrl(config, `/home/${unit}/${n}`), config.courseSlug);
      if (n === 1 && scan.rows.length === 0) {
        unit = 'week'; // older Coursera layout
        scan = await loadModulePage(page, courseUrl(config, `/home/${unit}/${n}`), config.courseSlug);
      }
      result.scans.push(scan);
      const landedOnModule = scan.finalPath.replace(/\/$/, '').endsWith(`/home/${unit}/${n}`);
      if (!landedOnModule || scan.rows.length === 0) break;

      const items = rowsToItems(scan.rows, n).filter((item) => !result.items.some((known) => known.id === item.id));
      result.items.push(...items);
      result.modules.push({ number: n, title: scan.moduleTitle, itemCount: items.length });
      await politeDelay();
    }
  } finally {
    await page.close();
  }
  return result;
}
