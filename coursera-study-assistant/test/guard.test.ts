import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CourseItem, ItemKind } from '../src/course.ts';
import { guardFor, isActionAllowed } from '../src/guard.ts';
import { GuardBlockedError, assertCaptureAllowed } from '../src/capture.ts';

const KINDS: ItemKind[] = ['VIDEO', 'READING', 'PRACTICE', 'GRADED', 'OTHER'];

test('assessments and unknown items never allow capture or AI', () => {
  for (const kind of ['PRACTICE', 'GRADED', 'OTHER'] as const) {
    const decision = guardFor(kind);
    assert.equal(decision.allowCapture, false, kind);
    assert.equal(decision.allowAi, false, kind);
    assert.equal(decision.manualOnly, true, kind);
    assert.equal(isActionAllowed(kind, 'capture'), false, kind);
    assert.equal(isActionAllowed(kind, 'ai_notes'), false, kind);
    assert.equal(isActionAllowed(kind, 'skip'), false, `${kind}: assessments use "later", not "skip"`);
  }
});

test('videos and readings allow study actions', () => {
  for (const kind of ['VIDEO', 'READING'] as const) {
    assert.ok(isActionAllowed(kind, 'capture'));
    assert.ok(isActionAllowed(kind, 'ai_notes'));
    assert.equal(guardFor(kind).manualOnly, false);
  }
});

test('every kind can be paused and re-inspected', () => {
  for (const kind of KINDS) {
    for (const action of ['quit', 'follow', 'sync', 'done'] as const) {
      assert.ok(isActionAllowed(kind, action), `${kind}/${action}`);
    }
  }
});

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

test('capture is allowed only on the matching video/reading page', () => {
  assert.doesNotThrow(() => assertCaptureAllowed('https://www.coursera.org/learn/c/lecture/eiu87/x', item({})));
  assert.throws(() => assertCaptureAllowed('https://www.coursera.org/learn/c/lecture/other/y', item({})), GuardBlockedError);
  assert.throws(() => assertCaptureAllowed('https://www.coursera.org/learn/c/home/module/1', item({})), GuardBlockedError);
});

test('capture is blocked on an assessment URL even if the stored item claims VIDEO', () => {
  const tampered = item({ id: 'q1', segment: 'quiz', urlPath: '/learn/c/quiz/q1/x', typeLabel: null, kind: 'VIDEO' });
  assert.throws(() => assertCaptureAllowed('https://www.coursera.org/learn/c/quiz/q1/x', tampered), GuardBlockedError);
});

test('capture is blocked for a graded item', () => {
  const graded = item({ id: 'g1', segment: 'quiz', urlPath: '/learn/c/quiz/g1/x', typeLabel: 'Graded Assignment', kind: 'GRADED' });
  assert.throws(() => assertCaptureAllowed('https://www.coursera.org/learn/c/quiz/g1/x', graded), GuardBlockedError);
});
