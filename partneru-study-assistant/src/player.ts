// Shared helpers for the Sana course player: card statuses the player loads by
// itself, waiting for a card page, and opening a course's player.

import type { Page, Response } from 'playwright';
import { PARTNERU_ORIGIN } from './config.ts';
import { settle, sleep } from './browser.ts';
import { parseCardUrl, parseStatuses, type CardStatus } from './card.ts';
import type { ProgramStep } from './program.ts';

/** Latest card statuses from the player's own /self-paced-content/status responses (in course order). */
export class StatusWatcher {
  private readonly statuses = new Map<string, CardStatus>();
  private readonly page: Page;
  private readonly listener = (response: Response) => {
    if (!response.url().includes('/self-paced-content/status')) return;
    response
      .json()
      .then((body) => {
        for (const [cardId, status] of parseStatuses(body)) this.statuses.set(cardId, status);
      })
      .catch(() => undefined);
  };

  constructor(page: Page) {
    this.page = page;
    page.on('response', this.listener);
  }

  get(cardId: string): CardStatus | undefined {
    return this.statuses.get(cardId);
  }

  all(): Map<string, CardStatus> {
    return new Map(this.statuses);
  }

  clear(): void {
    this.statuses.clear();
  }

  /** Wait until the player has reported its card statuses. */
  async ready(timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.statuses.size > 0) return true;
      await sleep(250);
    }
    return this.statuses.size > 0;
  }

  stop(): void {
    this.page.off('response', this.listener);
  }
}

export async function waitForPlayer(page: Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (parseCardUrl(page.url())) {
      await settle(page, 1500);
      return true;
    }
    await sleep(300);
  }
  return false;
}

/**
 * The course page's Start / Continue link (/s/<edition>/next). It resumes
 * where you left off. Read without following it.
 */
export async function coursePlayerLink(page: Page, step: Pick<ProgramStep, 'courseId'>): Promise<string | null> {
  await page.goto(`${PARTNERU_ORIGIN}/course/${encodeURIComponent(step.courseId)}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt) await sleep(1000);
    // Resolved href (the attribute may be absolute or relative).
    const href = await page
      .evaluate(() => {
        const main = document.querySelector('main, [role="main"]') ?? document.body;
        const link = [...main.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => new URL(a.href, location.href).pathname.startsWith('/s/'));
        return link?.href ?? null;
      })
      .catch(() => null);
    if (href) return new URL(href).origin === PARTNERU_ORIGIN ? href : null;
  }
  return null;
}

/** Course page → its Start / Continue link → the player. */
export async function openPlayer(page: Page, step: Pick<ProgramStep, 'courseId'>): Promise<boolean> {
  const href = await coursePlayerLink(page, step);
  if (!href) return false;
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  return waitForPlayer(page);
}

export function cardUrl(editionId: string, cardId: string): string {
  return `${PARTNERU_ORIGIN}/s/${encodeURIComponent(editionId)}/${cardId.split(':').map(encodeURIComponent).join(':')}`;
}
