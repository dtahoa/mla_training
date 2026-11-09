import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillCourses, backfillTargets } from '../src/backfill.ts';
import type { CardStatus } from '../src/card.ts';
import type { CardRecord } from '../src/store.ts';
import type { ProgramStep } from '../src/program.ts';
import { cardUrl } from '../src/player.ts';

const record = (patch: Partial<CardRecord>): CardRecord => ({
  courseId: 'iZGYCxcGVQHf',
  position: 1,
  total: 37,
  title: 't',
  kind: 'CONTENT',
  captured: false,
  completed: true,
  seenAt: '2026-11-09T00:00:00Z',
  ...patch,
});

test('backfill opens only completed, question-free cards without notes, in course order', () => {
  const statuses = new Map<string, CardStatus>([
    ['file:JZcTPVa3dEDA', { state: 'completed', exercises: 0 }], // already captured
    ['file:pAmFdUagjU6B', { state: 'completed', exercises: 0 }],
    ['file:ze96ydhaKfQu', { state: 'completed', exercises: 0 }],
    ['file:NSXZ7wr5L7vY', { state: 'completed', exercises: 1 }], // knowledge check
    ['file:K5FBKCtN2Wbg', { state: 'completed', exercises: 0 }], // seen as EXERCISE before
    ['file:A1wzBqJWEbMi', { state: 'not-started', exercises: 0 }], // opening it would mark it done
    ['file:egov2imRgHHW', { state: 'started', exercises: 0 }],
  ]);
  const cards: Record<string, CardRecord> = {
    'file:JZcTPVa3dEDA': record({ captured: true }),
    'file:K5FBKCtN2Wbg': record({ kind: 'EXERCISE' }),
  };
  assert.deepEqual(backfillTargets(statuses, { card: (id: string) => cards[id] }), ['file:pAmFdUagjU6B', 'file:ze96ydhaKfQu']);
});

test('backfill only looks at courses you have started (never exam / feedback)', () => {
  const step = (index: number, kind: ProgramStep['kind'], progress: number, startedAt: string | null = null): ProgramStep => ({
    index,
    courseId: `c${index}`,
    title: `Step ${index}`,
    duration: null,
    kind,
    progress,
    startedAt,
    passedAt: null,
    unlockOnPrevious: index > 1,
  });
  const steps = [step(1, 'COURSE', 0.2), step(2, 'COURSE', 0, '2026-11-09T00:00:00Z'), step(3, 'COURSE', 0), step(4, 'EXAM', 0.5), step(5, 'FEEDBACK', 1)];
  assert.deepEqual(backfillCourses(steps).map((s) => s.index), [1, 2]);
  assert.deepEqual(backfillCourses(steps, 2).map((s) => s.index), [2]);
  assert.deepEqual(backfillCourses(steps, 4), []);
});

test('cardUrl builds the player URL of a card', () => {
  assert.equal(cardUrl('eVNFmFuELfeS', 'file:pAmFdUagjU6B'), 'https://openai-partneru.sana.ai/s/eVNFmFuELfeS/file:pAmFdUagjU6B');
});
