// One card of the Sana course player (/s/<edition>/file:<card>): what it is,
// what it says, and the single action the tool may take on it — clicking
// "Continue" on a card that has no question.
//
// Guard (fail-closed): a card counts as an EXERCISE (knowledge check, quiz)
// when Sana's status lists exercises for it, OR its title says so, OR the page
// shows any answer control (radio, checkbox, text box, Check/Submit button).
// The tool never reads, saves, answers or skips an exercise card.

import type { Page } from 'playwright';
import type { CardKind } from './store.ts';

export interface CardInfo {
  editionId: string;
  /** "file:JZcTPVa3dEDA" — the same key Sana uses in its card statuses. */
  cardId: string;
  title: string;
  position: number | null;
  total: number | null;
  courseTitle: string | null;
}

export interface CardSignals {
  hasVideo: boolean;
  /** Radios, checkboxes, text boxes, options… anything you could answer with. */
  answerControls: number;
  /** Buttons such as Check / Submit / Show answer. */
  answerButtons: string[];
  continueButton: boolean;
}

export interface CardStatus {
  state: string | null;
  exercises: number;
}

const CARD_PATH = /^\/s\/([^/]+)\/(file:[^/?#]+)/;

export function parseCardUrl(url: string): { editionId: string; cardId: string } | null {
  try {
    const match = CARD_PATH.exec(new URL(url).pathname);
    return match ? { editionId: decodeURIComponent(match[1] as string), cardId: decodeURIComponent(match[2] as string) } : null;
  } catch {
    return null;
  }
}

/** "Introduction (2/37) - Technical Fluency Orientation | OpenAI PartnerU" → title, 2, 37, course. */
export function parseCardTitle(documentTitle: string): Pick<CardInfo, 'title' | 'position' | 'total' | 'courseTitle'> {
  const withoutSite = documentTitle.replace(/\s+\|\s+[^|]*$/, '');
  const match = /^(.*?)\s+\((\d+)\/(\d+)\)\s+-\s+(.*)$/.exec(withoutSite);
  if (!match) return { title: withoutSite.trim(), position: null, total: null, courseTitle: null };
  return {
    title: (match[1] as string).trim(),
    position: Number(match[2]),
    total: Number(match[3]),
    courseTitle: (match[4] as string).trim(),
  };
}

/** Card statuses from Sana's own /self-paced-content/status response. */
export function parseStatuses(body: unknown): Map<string, CardStatus> {
  const statuses = new Map<string, CardStatus>();
  const root = body as { data?: { status?: { cardStatuses?: Record<string, unknown> } } } | null;
  const cards = root?.data?.status?.cardStatuses;
  if (!cards || typeof cards !== 'object') return statuses;
  for (const [cardId, raw] of Object.entries(cards)) {
    const status = (raw ?? {}) as { state?: unknown; exerciseStatuses?: unknown };
    statuses.set(cardId, {
      state: typeof status.state === 'string' ? status.state : null,
      exercises: Array.isArray(status.exerciseStatuses) ? status.exerciseStatuses.length : 0,
    });
  }
  return statuses;
}

// Not "questions": content cards here teach "asking sharper questions".
const QUESTION_TITLE = /\b(knowledge check|check your (understanding|knowledge)|quiz(zes)?|exams?|assessments?|tests?|certification)\b/i;

export function classifyCard(title: string, status: CardStatus | undefined, signals: CardSignals): CardKind {
  if ((status?.exercises ?? 0) > 0) return 'EXERCISE';
  if (QUESTION_TITLE.test(title)) return 'EXERCISE';
  if (signals.answerControls > 0 || signals.answerButtons.length > 0) return 'EXERCISE';
  if (signals.hasVideo) return 'VIDEO';
  return 'CONTENT';
}

/**
 * Moves to the next card: the "Continue" pill on title cards, or the arrow
 * icon button (aria-label "Go to next card", data-testid "forward-button") on
 * the others. Anchored, so "Go to previous card" never matches.
 */
export const CONTINUE_BUTTON = /^\s*(continue|next|next card|go to next card)\s*$/i;
const FORWARD_BUTTON = '[data-testid="forward-button"]';
const ANSWER_BUTTON = /^\s*(check( answer)?|submit( answer)?|show answer|reveal( answer)?|try again|retry)\s*$/i;
const VIDEO_FRAME = /youtube|youtu\.be|vimeo|wistia|vidyard|loom|mux|brightcove|jwplayer/i;

/** Reads the open card. Returns null when the page is not a player card. */
export async function readCard(page: Page): Promise<{ info: CardInfo; signals: CardSignals; blocks: string[] } | null> {
  const ids = parseCardUrl(page.url());
  if (!ids) return null;
  const dom = await page.evaluate(
    ({ answerSource, continueSource, videoSource }) => {
      const main = document.querySelector('main, [role="main"]') ?? document.body;
      const answer = new RegExp(answerSource, 'i');
      const next = new RegExp(continueSource, 'i');
      const video = new RegExp(videoSource, 'i');
      const visible = (el: Element) => {
        const box = (el as HTMLElement).getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();

      const controls = [
        ...main.querySelectorAll(
          'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="radio"], [role="checkbox"], [role="option"], [role="textbox"], [role="listbox"], [role="slider"]',
        ),
      ].filter(visible);
      const buttons = [...main.querySelectorAll('button, [role="button"]')].filter(visible).map(name);

      // Leaf text blocks in reading order; skip anything inside buttons/navigation.
      const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, td, th';
      const blocks: string[] = [];
      for (const el of main.querySelectorAll<HTMLElement>(BLOCKS)) {
        if (el.closest('button, nav, aside, [role="navigation"], [role="button"]')) continue;
        if (el.querySelector(BLOCKS)) continue;
        const text = el.innerText.replace(/[ \t]+/g, ' ').trim();
        if (!text) continue;
        const tag = el.tagName.toLowerCase();
        blocks.push(tag.startsWith('h') ? `${'#'.repeat(Math.min(6, Number(tag[1]) + 1))} ${text}` : tag === 'li' ? `- ${text}` : text);
      }
      if (blocks.length === 0 && (main as HTMLElement).innerText.trim()) blocks.push((main as HTMLElement).innerText.trim());

      return {
        documentTitle: document.title,
        hasVideo:
          main.querySelector('video') !== null ||
          [...main.querySelectorAll<HTMLIFrameElement>('iframe')].some((frame) => video.test(frame.src)),
        answerControls: controls.length,
        answerButtons: buttons.filter((b) => answer.test(b)),
        continueButton: buttons.some((b) => next.test(b)),
        blocks,
      };
    },
    { answerSource: ANSWER_BUTTON.source, continueSource: CONTINUE_BUTTON.source, videoSource: VIDEO_FRAME.source },
  );
  return {
    info: { ...ids, ...parseCardTitle(dom.documentTitle) },
    signals: {
      hasVideo: dom.hasVideo,
      answerControls: dom.answerControls,
      answerButtons: dom.answerButtons,
      continueButton: dom.continueButton,
    },
    blocks: dom.blocks,
  };
}

/**
 * Card text for notes: drop the player chrome ("Continue", "14 min left"),
 * headings that only repeat the card title (the note section already has it)
 * and repeated lines.
 */
export function cardText(blocks: string[], title = ''): string {
  const bare = (line: string) => line.replace(/^(#+|-)\s+/, '').trim().toLowerCase();
  const out: string[] = [];
  for (const block of blocks) {
    const line = block.trim();
    if (!line || CONTINUE_BUTTON.test(line) || /^\d+\s*min(utes)? left$/i.test(line)) continue;
    if (line.startsWith('#') && title && bare(line) === title.trim().toLowerCase()) continue;
    if (out.length && bare(out.at(-1) as string) === bare(line)) continue;
    out.push(line);
  }
  return out.join('\n\n');
}

/** The visible "next card" control: the forward arrow button first, then a Continue / Next button. */
async function findNextButton(page: Page) {
  for (const candidate of [page.locator(FORWARD_BUTTON), page.getByRole('button', { name: CONTINUE_BUTTON })]) {
    const button = candidate.last();
    if (await button.isVisible().catch(() => false)) return button;
  }
  return null;
}

/**
 * Long cards show their Continue button only once the card is scrolled to the
 * end. The card scrolls inside #self-paced-content-renderer (verified), so
 * scroll that (or any scrollable box in <main>) down step by step — lazy
 * images can make it grow — until it stops at the bottom.
 */
export async function scrollCardToEnd(page: Page, { stepMs = 120, maxSteps = 80 } = {}): Promise<void> {
  await page
    .evaluate(
      async ({ stepMs, maxSteps }) => {
        const main = document.querySelector('main, [role="main"]') ?? document.body;
        const scrollable = (el: Element | null): el is HTMLElement =>
          el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
        const renderer = document.getElementById('self-paced-content-renderer');
        const boxes: HTMLElement[] = scrollable(renderer) ? [renderer] : [...main.querySelectorAll('*')].filter(scrollable);
        if (document.scrollingElement instanceof HTMLElement) boxes.push(document.scrollingElement);
        const wait = () => new Promise((resolve) => setTimeout(resolve, stepMs));
        for (const box of boxes) {
          for (let step = 0; step < maxSteps; step++) {
            if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break;
            box.scrollTop += Math.max(200, box.clientHeight * 0.9);
            await wait();
          }
        }
      },
      { stepMs, maxSteps },
    )
    .catch(() => undefined);
}

export type ContinueOutcome =
  | { status: 'moved'; url: string }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Click "Continue" on the card `expected`, then wait until the player shows
 * another card or leaves the player (end of course). Refuses on a different
 * card or when the card looks like a question — checked again after
 * scrolling, since the end of a long card may hold a question.
 */
export async function clickContinue(
  page: Page,
  expected: CardInfo,
  { timeoutMs = 15_000, pollMs = 300, buttonWaitMs = 5000 } = {},
): Promise<ContinueOutcome> {
  const onCard = (card: Awaited<ReturnType<typeof readCard>>) => card !== null && card.info.cardId === expected.cardId;
  if (!onCard(await readCard(page))) return { status: 'blocked', reason: 'trang đã chuyển sang thẻ khác, không bấm' };

  await scrollCardToEnd(page);
  const current = await readCard(page);
  if (!current || !onCard(current)) return { status: 'blocked', reason: 'trang đã chuyển sang thẻ khác, không bấm' };
  if (classifyCard(current.info.title, undefined, current.signals) === 'EXERCISE') {
    return { status: 'blocked', reason: 'thẻ có câu hỏi — bạn tự làm rồi bấm Continue' };
  }

  // The button can take a moment to appear after reaching the bottom.
  let button = await findNextButton(page);
  for (const deadline = Date.now() + buttonWaitMs; !button && Date.now() < deadline; ) {
    await page.waitForTimeout(pollMs);
    await scrollCardToEnd(page);
    button = await findNextButton(page);
  }
  if (!button) return { status: 'failed', reason: 'không thấy nút Continue / Go to next card (đã cuộn xuống cuối thẻ)' };
  if (!(await button.isEnabled().catch(() => false))) return { status: 'failed', reason: 'nút sang thẻ tiếp đang bị khóa' };
  await button.click({ timeout: timeoutMs });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = parseCardUrl(page.url());
    if (!ids || ids.cardId !== expected.cardId) return { status: 'moved', url: page.url() };
    await page.waitForTimeout(pollMs);
  }
  return { status: 'failed', reason: 'đã bấm Continue nhưng player không chuyển thẻ' };
}
