import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { CourseItem } from '../src/course.ts';
import { GuardBlockedError } from '../src/capture.ts';
import { backfillTargets, captureVideo } from '../src/backfill.ts';

const item = (patch: Partial<CourseItem>): CourseItem => ({
  id: 'v1',
  urlPath: '/learn/c/lecture/v1/x',
  segment: 'lecture',
  title: 'x',
  typeLabel: 'Video',
  minutes: 2,
  module: 1,
  order: 1,
  kind: 'VIDEO',
  courseraCompleted: false,
  locked: false,
  localStatus: 'studied',
  sourcePath: null,
  notesPath: null,
  ...patch,
});

test('backfillTargets: videos without a transcript, not locked, in course order; optional module filter', () => {
  const items = [
    item({ id: 'b', module: 2, order: 1 }),
    item({ id: 'a2', module: 1, order: 3 }),
    item({ id: 'a1', module: 1, order: 1 }),
    item({ id: 'has', module: 1, order: 2, sourcePath: 'x.txt' }),
    item({ id: 'lock', module: 1, order: 4, locked: true }),
    item({ id: 'plugin', module: 1, order: 5, kind: 'OTHER', segment: 'ungradedWidget' }),
    item({ id: 'graded', module: 1, order: 6, kind: 'GRADED', segment: 'assignment-submission' }),
  ];
  assert.deepEqual(
    backfillTargets(items).map((i) => i.id),
    ['a1', 'a2', 'b'],
  );
  assert.deepEqual(
    backfillTargets(items, 2).map((i) => i.id),
    ['b'],
  );
});

const tab = { evaluate: async () => undefined } as unknown as Page;

test('captureVideo retries while the player loads its captions', async () => {
  let calls = 0;
  const result = await captureVideo(tab, item({}), {
    attempts: 5,
    waitMs: 1,
    capture: async () => {
      calls++;
      if (calls < 3) throw new Error('Không tìm thấy transcript');
      return { method: 'video-captions-track', text: 'hello' };
    },
  });
  assert.deepEqual(result, { method: 'video-captions-track', text: 'hello' });
  assert.equal(calls, 3);
});

test('captureVideo stops at once when the guard blocks (e.g. Coursera redirected away)', async () => {
  let calls = 0;
  await assert.rejects(
    captureVideo(tab, item({}), {
      attempts: 5,
      waitMs: 1,
      capture: async () => {
        calls++;
        throw new GuardBlockedError('Trang trên Chrome không còn là item này.');
      },
    }),
    GuardBlockedError,
  );
  assert.equal(calls, 1);
});

test('captureVideo gives up after the last attempt with the last error', async () => {
  await assert.rejects(
    captureVideo(tab, item({}), {
      attempts: 2,
      waitMs: 1,
      capture: async () => {
        throw new Error('no transcript');
      },
    }),
    /no transcript/,
  );
});
