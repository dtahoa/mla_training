import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyItem, detectCompleted, parseItemPath, parseItemRow } from '../src/course.ts';

const row = (rowText: string, extra: Partial<{ anchorText: string; ariaLabel: string | null; hintText: string }> = {}) => ({
  anchorText: extra.anchorText ?? rowText.split('\n')[0] ?? '',
  rowText,
  ariaLabel: extra.ariaLabel ?? null,
  hintText: extra.hintText ?? '',
});

test('parseItemPath reads the lecture URL from the screenshot', () => {
  const ref = parseItemPath(
    'https://www.coursera.org/learn/the-ai-transformation-advisor/lecture/eiu87/problem-the-decisive-work-nobody-scoped?x=1#t',
  );
  assert.deepEqual(ref, {
    courseSlug: 'the-ai-transformation-advisor',
    segment: 'lecture',
    id: 'eiu87',
    slug: 'problem-the-decisive-work-nobody-scoped',
    urlPath: '/learn/the-ai-transformation-advisor/lecture/eiu87/problem-the-decisive-work-nobody-scoped',
  });
});

test('parseItemPath ignores non-item pages', () => {
  assert.equal(parseItemPath('/learn/the-ai-transformation-advisor/home/module/1'), null);
  assert.equal(parseItemPath('/learn/the-ai-transformation-advisor'), null);
  assert.equal(parseItemPath('https://www.coursera.org/professional-certificates/x'), null);
});

test('classifyItem is fail-closed for assessments and unknown types', () => {
  assert.equal(classifyItem('lecture', 'Video'), 'VIDEO');
  assert.equal(classifyItem('supplement', 'Reading'), 'READING');
  assert.equal(classifyItem('quiz', 'Practice Assignment'), 'PRACTICE');
  assert.equal(classifyItem('quiz', 'Graded Assignment'), 'GRADED');
  assert.equal(classifyItem('quiz', null), 'GRADED', 'unlabelled quiz must be treated as graded');
  assert.equal(classifyItem('assignment-submission', 'Practice Assignment'), 'PRACTICE');
  assert.equal(classifyItem('exam', 'Practice Assignment'), 'GRADED', 'exam is always graded');
  assert.equal(classifyItem('peer', null), 'GRADED');
  assert.equal(classifyItem('discussionPrompt', 'Discussion Prompt'), 'OTHER');
  assert.equal(classifyItem('ungradedWidget', 'Ungraded Plugin'), 'OTHER');
  assert.equal(classifyItem('somethingNew', 'Graded Assignment'), 'GRADED');
  assert.equal(classifyItem('somethingNew', null), 'OTHER');
});

test('parseItemRow handles "Type • duration" rows', () => {
  const parsed = parseItemRow(row('Problem: The decisive work nobody scoped\nVideo • 2 min\nCompleted'));
  assert.deepEqual(parsed, {
    title: 'Problem: The decisive work nobody scoped',
    typeLabel: 'Video',
    minutes: 2,
    completed: true,
    locked: false,
  });
});

test('parseItemRow does not mistake a title starting with "Reading" for a label', () => {
  const parsed = parseItemRow(row('Reading the signals behind vendor claims\nReading · 10 min'));
  assert.equal(parsed.title, 'Reading the signals behind vendor claims');
  assert.equal(parsed.typeLabel, 'Reading');
  assert.equal(parsed.minutes, 10);
  assert.equal(parsed.completed, false);
});

test('parseItemRow accepts other separators after the type label', () => {
  assert.equal(parseItemRow(row('Intro\nVideo | 3 min')).typeLabel, 'Video');
  assert.equal(parseItemRow(row('Intro\nVideo — 3 min')).minutes, 3);
  assert.equal(parseItemRow(row('Intro\nReading (5 min)')).typeLabel, 'Reading');
  assert.equal(parseItemRow(row('Video killed the radio star\nReading')).title, 'Video killed the radio star');
});

test('parseItemRow handles aria-label style "Type: Title" and hours', () => {
  const parsed = parseItemRow(row('Graded Assignment: Module 1 quiz\n1 h 15 min'));
  assert.equal(parsed.title, 'Module 1 quiz');
  assert.equal(parsed.typeLabel, 'Graded Assignment');
  assert.equal(parsed.minutes, 75);
});

test('parseItemRow reads completion and lock hints from icons', () => {
  assert.equal(parseItemRow(row('Intro\nVideo • 3 min', { hintText: 'Completed' })).completed, true);
  assert.equal(parseItemRow(row('Intro\nVideo • 3 min', { hintText: 'Not completed' })).completed, false);
  assert.equal(parseItemRow(row('Scoping\nReading • 5 min', { hintText: 'Locked' })).locked, true);
  assert.equal(parseItemRow(row('Practice quiz\nPractice Assignment • 3 questions')).typeLabel, 'Practice Assignment');
});

test('detectCompleted rejects negations', () => {
  assert.equal(detectCompleted('Status: incomplete'), false);
  assert.equal(detectCompleted('Not started'), false);
  assert.equal(detectCompleted('Passed'), true);
});
