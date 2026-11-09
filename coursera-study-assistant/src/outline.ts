// Reads the course outline (modules → items, completion, lock state) from the
// module pages /learn/<slug>/home/module/<n>. Runs in a separate tab so the
// learner's tab is not disturbed.
//
// Verified against the live course (2026-11): each item is rendered as
//   <li data-testid="WeekSingleItemDisplay-<typeName>"><a href="/learn/<slug>/<segment>/<id>/<slug>">
//     Title ⏎ Video • 1 min
// and the list appears 3-8 s after DOMContentLoaded. If that hook disappears,
// extraction falls back to scanning item links (URL patterns) inside <main>.

import type { BrowserContext, Page } from 'playwright';
import { courseUrl, type Config } from './config.ts';
import { NON_ITEM_SEGMENTS, classifyItem, parseItemPath, parseItemRow, type RawItemRow } from './course.ts';
import { politeDelay } from './browser.ts';
import type { ModuleInfo, OutlineItem } from './store.ts';

export const ITEM_ROW_SELECTOR = '[data-testid^="WeekSingleItemDisplay-"]';
const LIST_TIMEOUT_MS = 25_000;

export interface ModulePageScan {
  requestedUrl: string;
  finalPath: string;
  scope: 'item-testid' | 'main' | 'document';
  moduleTitle: string | null;
  headings: string[];
  moduleNumbers: number[];
  rows: RawItemRow[];
  dataTestIds: string[];
}

export interface OutlineResult {
  modules: ModuleInfo[];
  items: OutlineItem[];
  scans: ModulePageScan[];
}

/** Collect raw item rows from the module page currently loaded in `page`. */
export async function scanItemRows(page: Page, courseSlug: string): Promise<Omit<ModulePageScan, 'requestedUrl'>> {
  return page.evaluate(
    ({ slug, rowSelector, nonItem }: { slug: string; rowSelector: string; nonItem: string[] }) => {
      const prefix = `/learn/${slug}/`;
      const itemPath = (href: string | null): string | null => {
        if (!href) return null;
        try {
          const pathname = new URL(href, location.href).pathname;
          const parts = pathname.split('/'); // ['', 'learn', slug, segment, id, ...]
          if (!pathname.startsWith(prefix) || parts.length < 5 || nonItem.includes(parts[3] ?? '')) return null;
          return pathname;
        } catch {
          return null;
        }
      };
      const itemLinks = (root: ParentNode): HTMLAnchorElement[] =>
        [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => itemPath(a.getAttribute('href')));
      const distinctItems = (el: Element): number =>
        new Set(itemLinks(el).map((a) => itemPath(a.getAttribute('href')))).size;
      const hintsOf = (row: Element): string =>
        [row, ...row.querySelectorAll('[aria-label], [title], svg title')]
          .map((node) =>
            node.getAttribute('aria-label') ?? node.getAttribute('title') ?? (node.tagName.toLowerCase() === 'title' ? node.textContent : ''),
          )
          .filter((text): text is string => Boolean(text && text.trim()))
          .join(' | ')
          .slice(0, 500);

      // Done items show a green check instead of the item-type icon (a glyph on
      // a circle). The check has no text/aria, so detect it by shape + colour
      // rather than by hashed class names.
      const isCompletedIcon = (row: Element): boolean => {
        const icon = row.querySelector('a svg');
        if (!icon || icon.querySelector('circle')) return false;
        const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(icon).color);
        if (!rgb) return false;
        const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        return g >= 80 && g > r * 1.6 && g > b * 1.6;
      };

      const main = document.querySelector('main, [role="main"]');
      const rows: Array<{
        path: string;
        anchorText: string;
        rowText: string;
        ariaLabel: string | null;
        hintText: string;
        typeName: string | null;
        nameText: string | null;
        completedIcon: boolean;
      }> = [];
      const seen = new Set<string>();
      let scope: 'item-testid' | 'main' | 'document' = 'item-testid';

      // 1) Coursera's item rows (verified hook).
      for (const row of document.querySelectorAll(rowSelector)) {
        const anchor = row.querySelector<HTMLAnchorElement>('a[href]') ?? row.closest<HTMLAnchorElement>('a[href]');
        const path = itemPath(anchor?.getAttribute('href') ?? null);
        if (!anchor || !path || seen.has(path)) continue;
        seen.add(path);
        rows.push({
          path,
          anchorText: anchor.innerText ?? '',
          rowText: (row as HTMLElement).innerText ?? '',
          ariaLabel: anchor.getAttribute('aria-label'),
          hintText: hintsOf(row),
          typeName: (row.getAttribute('data-testid') ?? '').replace(/^WeekSingleItemDisplay-/, '') || null,
          nameText: row.querySelector<HTMLElement>('[data-test="rc-ItemName"]')?.innerText ?? null,
          completedIcon: isCompletedIcon(row),
        });
      }

      // 2) Fallback: any item link inside <main> (then the whole document).
      if (rows.length === 0) {
        scope = 'main';
        let anchors = main ? itemLinks(main) : [];
        if (anchors.length === 0) {
          scope = 'document';
          anchors = itemLinks(document);
        }
        for (const anchor of anchors) {
          const path = itemPath(anchor.getAttribute('href'));
          if (!path || seen.has(path)) continue;
          seen.add(path);
          let row: Element = anchor.closest('li') ?? anchor.parentElement?.parentElement ?? anchor;
          if (distinctItems(row) > 1) row = anchor.parentElement ?? anchor;
          rows.push({
            path,
            anchorText: anchor.innerText ?? '',
            rowText: (row as HTMLElement).innerText ?? '',
            ariaLabel: anchor.getAttribute('aria-label'),
            hintText: hintsOf(row),
            typeName: null,
            nameText: null,
            completedIcon: false,
          });
        }
      }

      // Module title: first heading in <main> that is not part of a dialog (e.g. the timezone modal).
      const headings = [...(main ?? document).querySelectorAll<HTMLElement>('h1, h2, h3')]
        .filter((h) => !h.closest('[role="dialog"], [aria-modal="true"], [data-testid*="modal" i]'))
        .map((h) => h.innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const title = headings.find((text) => !/^module \d+$/i.test(text));

      const moduleNumbers = [
        ...new Set(
          [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
            .map((a) => new RegExp(`^${prefix}home/(?:module|week)/(\\d+)/?$`).exec(new URL(a.href, location.href).pathname)?.[1])
            .filter((n): n is string => Boolean(n))
            .map(Number),
        ),
      ].sort((a, b) => a - b);

      const dataTestIds = [...new Set([...(main ?? document).querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? ''))]
        .filter(Boolean)
        .slice(0, 80);

      return {
        finalPath: location.pathname,
        scope,
        moduleTitle: title ? title.replace(/^module \d+\s*[:\-–]?\s*/i, '') : null,
        headings: headings.slice(0, 8),
        moduleNumbers,
        rows,
        dataTestIds,
      };
    },
    { slug: courseSlug, rowSelector: ITEM_ROW_SELECTOR, nonItem: [...NON_ITEM_SEGMENTS] },
  );
}

/**
 * Wait until real item rows render. Navigation links such as /discussions are
 * present long before the item list, so they must not count as "loaded".
 */
async function waitForItemList(page: Page, url: string, courseSlug: string): Promise<void> {
  await page
    .waitForFunction(
      ({ slug, expectedPath, rowSelector, nonItem }: { slug: string; expectedPath: string; rowSelector: string; nonItem: string[] }) => {
        if (!location.pathname.startsWith(expectedPath)) return true; // redirected away: module does not exist
        if (document.querySelector(rowSelector)) return true;
        // Fallback layout: a real item link (not /home, /discussions, /team, ...) inside <main>.
        const main = document.querySelector('main, [role="main"]');
        return [...(main?.querySelectorAll('a[href]') ?? [])].some((a) => {
          const parts = new URL(a.getAttribute('href') ?? '', location.href).pathname.split('/');
          return parts[1] === 'learn' && parts[2] === slug && parts.length >= 5 && !nonItem.includes(parts[3] ?? '');
        });
      },
      { slug: courseSlug, expectedPath: new URL(url).pathname, rowSelector: ITEM_ROW_SELECTOR, nonItem: [...NON_ITEM_SEGMENTS] },
      { timeout: LIST_TIMEOUT_MS, polling: 500 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(800); // let the rest of the list finish rendering
}

async function loadModulePage(page: Page, url: string, courseSlug: string): Promise<ModulePageScan> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForItemList(page, url, courseSlug);
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
      kind: classifyItem(ref.segment, parsed.typeLabel, row.typeName),
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
    let lastModule = config.maxModules;
    for (let n = 1; n <= lastModule; n++) {
      let scan = await loadModulePage(page, courseUrl(config, `/home/${unit}/${n}`), config.courseSlug);
      if (n === 1 && scan.rows.length === 0) {
        result.scans.push(scan);
        unit = 'week'; // older Coursera layout
        scan = await loadModulePage(page, courseUrl(config, `/home/${unit}/${n}`), config.courseSlug);
      }
      result.scans.push(scan);
      // The course sidebar links every module: use it as the real module count.
      if (n === 1 && scan.moduleNumbers.length > 0) lastModule = Math.min(config.maxModules, Math.max(...scan.moduleNumbers));

      const landedOnModule = scan.finalPath.replace(/\/$/, '').endsWith(`/home/${unit}/${n}`);
      if (!landedOnModule) break;

      const items = rowsToItems(scan.rows, n).filter((item) => !result.items.some((known) => known.id === item.id));
      result.items.push(...items);
      result.modules.push({ number: n, title: scan.moduleTitle, itemCount: items.length });
      // A known-to-exist module with no rows (e.g. locked) does not end the scan.
      if (items.length === 0 && scan.moduleNumbers.length === 0) break;
      if (n < lastModule) await politeDelay();
    }
  } finally {
    await page.close();
  }
  return result;
}
