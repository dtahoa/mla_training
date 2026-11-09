import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { CourseItem } from '../src/course.ts';
import { guardFor } from '../src/guard.ts';
import { INTERRUPTED, confirmAnswer, promptFromAsk, type Prompt } from '../src/prompt.ts';
import { chooseAction, confirmDone, defaultActionFor, videoFinished } from '../src/study.ts';

const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));

/**
 * A prompt that replays scripted answers and records every question asked.
 * With no answer left, a cancellable question waits (like a learner who is
 * watching the video); an uncancellable one fails the test.
 */
function scripted(answers: string[]): Prompt & { asked: string[] } {
  const asked: string[] = [];
  const prompt = promptFromAsk(async (question, signal) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer !== undefined) return answer;
    if (!signal) throw new Error(`unexpected question: ${question}`);
    await untilAborted(signal);
    return INTERRUPTED;
  });
  return Object.assign(prompt, { asked });
}

const URL_OF = (path: string) => `https://www.coursera.org${path}`;

const item = (patch: Partial<CourseItem>): CourseItem => ({
  id: 'eiu87',
  urlPath: '/learn/c/lecture/eiu87/x',
  segment: 'lecture',
  title: 'x',
  typeLabel: 'Video',
  minutes: 2,
  module: 1,
  order: 1,
  kind: 'VIDEO',
  courseraCompleted: false,
  locked: false,
  localStatus: 'new',
  sourcePath: null,
  notesPath: null,
  ...patch,
});

const fakePage = (url: string, coverage: number | null) =>
  ({
    url: () => url,
    evaluate: async () => (coverage === null ? null : { coverage, atEnd: false }),
    frames: () => [], // no "Mark as completed" button anywhere
  }) as unknown as Page;

type State = { coverage: number; atEnd: boolean } | null;

/** A video page that reports `states` one poll at a time, then moves to `thenUrl` (if given). */
function videoPage(url: string, states: State[], thenUrl?: string): Page {
  let current = url;
  let last: State = null;
  return {
    url: () => current,
    evaluate: async () => {
      last = states.length ? (states.shift() ?? null) : last;
      if (states.length === 0 && thenUrl) current = thenUrl;
      return last;
    },
  } as unknown as Page;
}

test('confirmAnswer: Enter takes the default, Ctrl+C is always "no"', () => {
  assert.equal(confirmAnswer('', true), true);
  assert.equal(confirmAnswer('', false), false);
  assert.equal(confirmAnswer('n', true), false);
  assert.equal(confirmAnswer('không', true), false);
  assert.equal(confirmAnswer('y', false), true);
  assert.equal(confirmAnswer('có', false), true);
  assert.equal(confirmAnswer(INTERRUPTED, true), false);
});

test('Enter on a video or an OTHER item picks "done"; other kinds have no default', () => {
  assert.equal(defaultActionFor('VIDEO'), 'done');
  assert.equal(defaultActionFor('OTHER'), 'done');
  for (const kind of ['READING', 'PRACTICE', 'GRADED'] as const) assert.equal(defaultActionFor(kind), null, kind);
});

test('chooseAction on an OTHER item: Enter picks "done" and the menu labels it', async () => {
  const other = guardFor('OTHER');
  const prompt = scripted(['']);
  assert.equal(await chooseAction(prompt, other.actions, true, defaultActionFor('OTHER')), 'done');
  assert.match(prompt.asked[0] ?? '', /\[d\] done \(đã tự làm\) \(Enter\)/);
});

test('chooseAction returns the default on empty input and labels it in the menu', async () => {
  const video = guardFor('VIDEO');
  const prompt = scripted(['']);
  assert.equal(await chooseAction(prompt, video.actions, false, 'done'), 'done');
  assert.match(prompt.asked[0] ?? '', /\[d\] done \(Enter\)/);
});

test('chooseAction ignores empty input when there is no default (manual items)', async () => {
  const graded = guardFor('GRADED');
  const prompt = scripted(['', 'x', 'l']);
  assert.equal(await chooseAction(prompt, graded.actions, true, null), 'later');
  assert.equal(prompt.asked.length, 3);
  assert.ok(!/\(Enter\)/.test(prompt.asked[0] ?? ''));
});

test('chooseAction still honours explicit keys and Ctrl+C when a default exists', async () => {
  const video = guardFor('VIDEO');
  assert.equal(await chooseAction(scripted(['c']), video.actions, false, 'done'), 'capture');
  assert.equal(await chooseAction(scripted([INTERRUPTED]), video.actions, false, 'done'), 'quit');
});

test('manual items: "done" confirmation defaults to yes on Enter', async () => {
  for (const kind of ['PRACTICE', 'GRADED', 'OTHER'] as const) {
    const manual = item({ id: 'w1', segment: 'ungradedWidget', urlPath: '/learn/c/ungradedWidget/w1/x', kind });
    const yes = scripted(['']);
    assert.equal(await confirmDone(fakePage(URL_OF(manual.urlPath), null), manual, yes), true, kind);
    assert.match(yes.asked[0] ?? '', /\(Y\/n\)/);
    assert.equal(await confirmDone(fakePage(URL_OF(manual.urlPath), null), manual, scripted(['n'])), false, kind);
    assert.equal(await confirmDone(fakePage(URL_OF(manual.urlPath), null), manual, scripted([INTERRUPTED])), false, kind);
  }
});

test('OTHER item with a "Mark as completed" button: the question says the tool will click it (Enter = yes)', async () => {
  const other = item({ id: 'w1', segment: 'ungradedWidget', urlPath: '/learn/c/ungradedWidget/w1/x', kind: 'OTHER', typeLabel: 'Ungraded Plugin' });
  const button = { first: () => button, isVisible: async () => true };
  const page = { url: () => URL_OF(other.urlPath), frames: () => [{ getByRole: () => button }] } as unknown as Page;
  const prompt = scripted(['']);
  assert.equal(await confirmDone(page, other, prompt), true);
  assert.match(prompt.asked[0] ?? '', /Mark as completed.*\(Y\/n\)/);
  // Graded items never get that question, even with a button on the page.
  const graded = { ...other, kind: 'GRADED' as const };
  const gradedPrompt = scripted(['']);
  await confirmDone(page, graded, gradedPrompt);
  assert.match(gradedPrompt.asked[0] ?? '', /Bạn đã tự hoàn thành/);
});

test('video watched >= 90% is marked done without a question', async () => {
  const video = item({});
  assert.equal(await confirmDone(fakePage(URL_OF(video.urlPath), 0.95), video, scripted([])), true);
});

test('video watched < 90% still asks, and Enter means "yes"', async () => {
  const video = item({});
  const prompt = scripted(['']);
  assert.equal(await confirmDone(fakePage(URL_OF(video.urlPath), 0.3), video, prompt), true);
  assert.match(prompt.asked[0] ?? '', /30% video.*\(Y\/n\)/);
  assert.equal(await confirmDone(fakePage(URL_OF(video.urlPath), 0.3), video, scripted(['n'])), false);
  assert.equal(await confirmDone(fakePage(URL_OF(video.urlPath), 0.3), video, scripted([INTERRUPTED])), false);
});

test('coverage is not measured on another item (e.g. Coursera auto-advanced to the next video)', async () => {
  const video = item({});
  const next = fakePage(URL_OF('/learn/c/lecture/zzz99/next-video'), 0);
  assert.equal(await confirmDone(next, video, scripted([])), true);
});

const NEXT_URL = URL_OF('/learn/c/lecture/zzz99/next-video');

/** Run the watcher; give up (abort) after `ms` and report null. */
async function watch(page: Page, ms = 300): Promise<'done' | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    return await videoFinished(page, item({}), stop.signal, 1);
  } finally {
    clearTimeout(timer);
  }
}

test('videoFinished fires once the video was played >= 90% to the end', async () => {
  const page = videoPage(URL_OF(item({}).urlPath), [null, { coverage: 0.4, atEnd: false }, { coverage: 0.93, atEnd: true }]);
  assert.equal(await watch(page), 'done');
});

test('videoFinished does not fire when you skip to the end without watching', async () => {
  const page = videoPage(URL_OF(item({}).urlPath), [{ coverage: 0.2, atEnd: true }]);
  assert.equal(await watch(page), null);
});

test('videoFinished does not fire at 90% before the end (still playing)', async () => {
  const page = videoPage(URL_OF(item({}).urlPath), [{ coverage: 0.92, atEnd: false }]);
  assert.equal(await watch(page), null);
});

test('videoFinished counts a Coursera auto-advance only after the video was watched', async () => {
  const watched = videoPage(URL_OF(item({}).urlPath), [{ coverage: 0.5, atEnd: false }, { coverage: 0.96, atEnd: false }], NEXT_URL);
  assert.equal(await watch(watched), 'done');
  const leftEarly = videoPage(URL_OF(item({}).urlPath), [{ coverage: 0.3, atEnd: false }], NEXT_URL);
  assert.equal(await watch(leftEarly), null);
});

test('chooseAction: a finished video picks "done" with no key press', async () => {
  const prompt = scripted([]);
  const action = await chooseAction(prompt, guardFor('VIDEO').actions, false, 'done', async () => 'done');
  assert.equal(action, 'done');
  assert.equal(prompt.asked.length, 1);
});

test('chooseAction: a key press wins over the watcher and stops it', async () => {
  let watcherSignal: AbortSignal | undefined;
  const action = await chooseAction(scripted(['c']), guardFor('VIDEO').actions, false, 'done', async (signal) => {
    watcherSignal = signal;
    await untilAborted(signal);
    return null;
  });
  assert.equal(action, 'capture');
  assert.equal(watcherSignal?.aborted, true);
});

test('chooseAction ignores an auto action that the item does not allow', async () => {
  const action = await chooseAction(scripted(['l']), guardFor('GRADED').actions, true, null, async () => 'capture');
  assert.equal(action, 'later');
});
