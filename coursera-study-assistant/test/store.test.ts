import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CourseItem } from '../src/course.ts';
import { ProgressStore, emptyProgress, mergeOutline, pickNextItem, resumeTarget, type OutlineItem } from '../src/store.ts';

const outline = (id: string, module: number, order: number, patch: Partial<OutlineItem> = {}): OutlineItem => ({
  id,
  urlPath: `/learn/c/lecture/${id}/x`,
  segment: 'lecture',
  title: id,
  typeLabel: 'Video',
  minutes: 2,
  module,
  order,
  kind: 'VIDEO',
  courseraCompleted: false,
  locked: false,
  ...patch,
});

const full = (o: OutlineItem, patch: Partial<CourseItem> = {}): CourseItem => ({
  ...o,
  localStatus: 'new',
  sourcePath: null,
  notesPath: null,
  ...patch,
});

test('mergeOutline keeps local study data and takes Coursera fields from the fresh sync', () => {
  const existing = [full(outline('a', 1, 1), { localStatus: 'studied', sourcePath: 's.txt', notesPath: 'n.md' })];
  const fresh = outline('a', 1, 2, { courseraCompleted: true, title: 'renamed' });
  const merged = mergeOutline(existing, [fresh, outline('b', 1, 3)]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { ...fresh, localStatus: 'studied', sourcePath: 's.txt', notesPath: 'n.md' });
  assert.equal(merged[1]?.localStatus, 'new');
});

test('pickNextItem follows module/order and skips done, locked, skipped and pending items', () => {
  const items = [
    full(outline('m2a', 2, 1)),
    full(outline('m1c', 1, 3)),
    full(outline('m1a', 1, 1), { courseraCompleted: true }),
    full(outline('m1b', 1, 2), { localStatus: 'manual_pending' }),
    full(outline('m1d', 1, 4, { locked: true })),
  ];
  assert.equal(pickNextItem(items)?.id, 'm1c');
  assert.equal(pickNextItem([full(outline('x', 1, 1), { localStatus: 'skipped' })]), null);
});

test('resumeTarget prefers the open checkpoint item, else the next open item', () => {
  const progress = emptyProgress('c');
  progress.items = [full(outline('a', 1, 1)), full(outline('b', 1, 2))];
  progress.checkpoint = { itemId: 'b', state: 'PAUSED', at: '' };
  assert.equal(resumeTarget(progress)?.id, 'b');
  progress.items[1]!.localStatus = 'studied';
  assert.equal(resumeTarget(progress)?.id, 'a');
});

test('ProgressStore saves and reloads, and rejects another course file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'csa-'));
  try {
    const file = path.join(dir, 'nested', 'progress.json');
    const store = await ProgressStore.open(file, 'c');
    assert.equal(store.hasOutline(), false);
    store.applyOutline([{ number: 1, title: 'M1', itemCount: 1 }], [outline('a', 1, 1)]);
    store.update('a', { localStatus: 'studied' });
    store.setCheckpoint('a', 'PAUSED');
    await store.save();
    await store.save(); // second save must replace the file (Windows rename-over-existing)

    const reloaded = await ProgressStore.open(file, 'c');
    assert.equal(reloaded.find('a')?.localStatus, 'studied');
    assert.equal(reloaded.data.checkpoint?.itemId, 'a');
    await assert.rejects(ProgressStore.open(file, 'other-course'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
