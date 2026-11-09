import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  CONTINUE_BUTTON,
  cardText,
  classifyCard,
  clickContinue,
  parseCardTitle,
  parseCardUrl,
  parseStatuses,
  type CardInfo,
  type CardSignals,
} from '../src/card.ts';

const NONE: CardSignals = { hasVideo: false, answerControls: 0, answerButtons: [], continueButton: true };
const URL1 = 'https://openai-partneru.sana.ai/s/eVNFmFuELfeS/file:JZcTPVa3dEDA';
const URL2 = 'https://openai-partneru.sana.ai/s/eVNFmFuELfeS/file:pAmFdUagjU6B';

test('parseCardUrl reads edition and card ids from the player URL', () => {
  assert.deepEqual(parseCardUrl(URL1), { editionId: 'eVNFmFuELfeS', cardId: 'file:JZcTPVa3dEDA' });
  assert.equal(parseCardUrl('https://openai-partneru.sana.ai/s/eVNFmFuELfeS/next'), null);
  assert.equal(parseCardUrl('https://openai-partneru.sana.ai/course/iZGYCxcGVQHf'), null);
  assert.equal(parseCardUrl('nope'), null);
});

test('parseCardTitle splits "card (n/total) - course | site"', () => {
  assert.deepEqual(parseCardTitle('Technical Fluency Orientation (1/37) - Technical Fluency Orientation | OpenAI PartnerU'), {
    title: 'Technical Fluency Orientation',
    position: 1,
    total: 37,
    courseTitle: 'Technical Fluency Orientation',
  });
  assert.deepEqual(parseCardTitle('APIs - what (and why) (12/37) - Course - Part 2 | OpenAI PartnerU'), {
    title: 'APIs - what (and why)',
    position: 12,
    total: 37,
    courseTitle: 'Course - Part 2',
  });
  assert.deepEqual(parseCardTitle('Loading | OpenAI PartnerU'), { title: 'Loading', position: null, total: null, courseTitle: null });
});

test('parseStatuses reads state and exercise count per card', () => {
  const statuses = parseStatuses({
    data: {
      status: {
        cardStatuses: {
          'file:JZcTPVa3dEDA': { state: 'completed', exerciseStatuses: [] },
          'file:NSXZ7wr5L7vY': { state: 'not-started', exerciseStatuses: [{ id: 'x', hasCorrectInteraction: false }] },
        },
      },
    },
  });
  assert.deepEqual(statuses.get('file:JZcTPVa3dEDA'), { state: 'completed', exercises: 0 });
  assert.deepEqual(statuses.get('file:NSXZ7wr5L7vY'), { state: 'not-started', exercises: 1 });
  assert.equal(parseStatuses({}).size, 0);
});

test('classifyCard is fail-closed: any sign of a question makes it an EXERCISE', () => {
  assert.equal(classifyCard('Introduction', { state: 'not-started', exercises: 0 }, NONE), 'CONTENT');
  assert.equal(classifyCard('Ask sharper questions early', undefined, NONE), 'CONTENT');
  assert.equal(classifyCard('Introduction', { state: null, exercises: 1 }, NONE), 'EXERCISE');
  assert.equal(classifyCard('Knowledge check', undefined, NONE), 'EXERCISE');
  assert.equal(classifyCard('Wrap-up quiz', undefined, NONE), 'EXERCISE');
  assert.equal(classifyCard('Summary', undefined, { ...NONE, answerControls: 3 }), 'EXERCISE');
  assert.equal(classifyCard('Summary', undefined, { ...NONE, answerButtons: ['Check answer'] }), 'EXERCISE');
  assert.equal(classifyCard('Demo', undefined, { ...NONE, hasVideo: true }), 'VIDEO');
  assert.equal(classifyCard('Demo', undefined, { ...NONE, hasVideo: true, answerControls: 1 }), 'EXERCISE');
});

test('cardText keeps the lesson, drops player chrome and repeats', () => {
  assert.equal(
    cardText(['## Technical Fluency Orientation', '## Technical Fluency Orientation', 'Map workflows to solution paths.', 'Continue', '14 min left', '- ChatGPT', '- API']),
    '## Technical Fluency Orientation\n\nMap workflows to solution paths.\n\n- ChatGPT\n\n- API',
  );
  assert.equal(cardText(['Continue']), '');
});

test('cardText drops headings that only repeat the card title (real title card)', () => {
  assert.equal(cardText(['## Technical Fluency Orientation', '### Technical Fluency Orientation'], 'Technical Fluency Orientation'), '');
  assert.equal(cardText(['## Introduction', '## Why it matters', 'Body.'], 'Introduction'), '## Why it matters\n\nBody.');
  assert.equal(cardText(['## Same', '### Same'], 'Other'), '## Same');
});

/**
 * Fake player page: evaluate() returns the card DOM summary; the visible next
 * control ('continue' pill, 'forward' arrow button, or none) moves to `nextUrl`.
 */
function fakePlayer(opts: {
  url: string;
  title: string;
  answerControls?: number;
  next?: 'continue' | 'forward' | 'none';
  nextUrl?: string | null;
  /** The next control (and `questionBelow`) only exists once the card is scrolled to the end. */
  needsScroll?: boolean;
  questionBelow?: boolean;
}) {
  let url = opts.url;
  let clicks = 0;
  let scrolled = false;
  const control = (visible: boolean) => {
    const button = {
      last: () => button,
      isVisible: async () => visible && (scrolled || !opts.needsScroll),
      isEnabled: async () => true,
      click: async () => {
        clicks++;
        if (opts.nextUrl) url = opts.nextUrl;
      },
    };
    return button;
  };
  const next = opts.next ?? 'continue';
  const roleQueries: Array<{ role: string; name: RegExp }> = [];
  const page = {
    url: () => url,
    evaluate: async (_fn: unknown, arg: Record<string, unknown>) => {
      if ('stepMs' in arg) {
        scrolled = true; // scrollCardToEnd
        return undefined;
      }
      return {
        documentTitle: opts.title,
        hasVideo: false,
        answerControls: (opts.answerControls ?? 0) + (opts.questionBelow && scrolled ? 2 : 0),
        answerButtons: [],
        continueButton: next !== 'none',
        blocks: ['Lesson text'],
      };
    },
    locator: (selector: string) => control(next === 'forward' && selector === '[data-testid="forward-button"]'),
    getByRole: (role: string, { name }: { name: RegExp }) => {
      roleQueries.push({ role, name });
      return control(next === 'continue');
    },
    waitForTimeout: async () => undefined,
  };
  return { page: page as unknown as Page, clicks: () => clicks, roleQueries, scrolled: () => scrolled };
}

const CARD1: CardInfo = {
  editionId: 'eVNFmFuELfeS',
  cardId: 'file:JZcTPVa3dEDA',
  title: 'Introduction',
  position: 2,
  total: 37,
  courseTitle: 'Technical Fluency Orientation',
};

const CARD1Long: CardInfo = { ...CARD1, title: 'Three lenses', position: 7 };

test('clickContinue clicks once and waits for the next card', async () => {
  const player = fakePlayer({ url: URL1, title: 'Introduction (2/37) - Course | OpenAI PartnerU', nextUrl: URL2 });
  const outcome = await clickContinue(player.page, CARD1, { timeoutMs: 1000, pollMs: 1 });
  assert.deepEqual(outcome, { status: 'moved', url: URL2 });
  assert.equal(player.clicks(), 1);
});

test('clickContinue uses the "Go to next card" arrow button when there is no Continue pill', async () => {
  const player = fakePlayer({ url: URL1, title: 'Introduction (2/37) - Course | OpenAI PartnerU', next: 'forward', nextUrl: URL2 });
  const outcome = await clickContinue(player.page, CARD1, { timeoutMs: 1000, pollMs: 1 });
  assert.deepEqual(outcome, { status: 'moved', url: URL2 });
  assert.equal(player.clicks(), 1);
});

test('clickContinue scrolls a long card to the end so its Continue button shows up', async () => {
  const player = fakePlayer({ url: URL1, title: 'Three lenses (7/37) - Course | OpenAI PartnerU', needsScroll: true, nextUrl: URL2 });
  const outcome = await clickContinue(player.page, CARD1Long, { timeoutMs: 1000, pollMs: 1, buttonWaitMs: 50 });
  assert.deepEqual(outcome, { status: 'moved', url: URL2 });
  assert.ok(player.scrolled());
  assert.equal(player.clicks(), 1);
});

test('clickContinue re-checks for a question at the end of a long card before clicking', async () => {
  const player = fakePlayer({ url: URL1, title: 'Three lenses (7/37) - Course | OpenAI PartnerU', needsScroll: true, questionBelow: true, nextUrl: URL2 });
  const outcome = await clickContinue(player.page, CARD1Long, { timeoutMs: 100, pollMs: 1, buttonWaitMs: 20 });
  assert.equal(outcome.status, 'blocked');
  assert.equal(player.clicks(), 0);
});

test('the next-card name matches Continue / Go to next card, never Go to previous card', () => {
  for (const name of ['Continue', 'Next', 'Go to next card', ' go to next card ']) assert.match(name, CONTINUE_BUTTON, name);
  for (const name of ['Go to previous card', 'Previous', 'Continue later', 'Next module overview']) assert.doesNotMatch(name, CONTINUE_BUTTON, name);
});

test('clickContinue refuses on another card or on a card with answer controls', async () => {
  const other = fakePlayer({ url: URL2, title: 'Other (3/37) - Course | OpenAI PartnerU', nextUrl: URL1 });
  assert.equal((await clickContinue(other.page, CARD1, { timeoutMs: 100, pollMs: 1 })).status, 'blocked');
  assert.equal(other.clicks(), 0);

  const question = fakePlayer({ url: URL1, title: 'Introduction (2/37) - Course | OpenAI PartnerU', answerControls: 4, nextUrl: URL2 });
  const outcome = await clickContinue(question.page, CARD1, { timeoutMs: 100, pollMs: 1 });
  assert.equal(outcome.status, 'blocked');
  assert.equal(question.clicks(), 0);
});

test('clickContinue fails (no retry) when there is no Continue or the player does not move', async () => {
  const hidden = fakePlayer({ url: URL1, title: 'Introduction (2/37) - Course | OpenAI PartnerU', next: 'none' });
  assert.deepEqual(await clickContinue(hidden.page, CARD1, { timeoutMs: 100, pollMs: 1, buttonWaitMs: 20 }), {
    status: 'failed',
    reason: 'không thấy nút Continue / Go to next card (đã cuộn xuống cuối thẻ)',
  });
  assert.equal(hidden.clicks(), 0);

  const stuck = fakePlayer({ url: URL1, title: 'Introduction (2/37) - Course | OpenAI PartnerU', nextUrl: null });
  const outcome = await clickContinue(stuck.page, CARD1, { timeoutMs: 20, pollMs: 1 });
  assert.equal(outcome.status, 'failed');
  assert.equal(stuck.clicks(), 1);
});
