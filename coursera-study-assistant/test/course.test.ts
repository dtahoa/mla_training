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

test('parseItemRow reads the real Coursera row texts seen in the live probe', () => {
  assert.deepEqual(parseItemRow(row('Engage the Sponsor\nRole Play • 15 min')), {
    title: 'Engage the Sponsor', typeLabel: 'Role Play', minutes: 15, completed: false, locked: false,
  });
  assert.equal(parseItemRow(row('The Ask Underneath the Ask\nDialogue • 15 min')).typeLabel, 'Dialogue');
  assert.equal(parseItemRow(row('Skill Practice: Clean the Ask\nUngraded Plugin • 10 min')).typeLabel, 'Ungraded Plugin');
  const graded = parseItemRow(
    row('What is Transformation Advisory?\nGraded Assignment • Started • Grade: -- •\nStatus: Due, Nov 9, 11:59 PM PST\nDue, Nov 9, 11:59 PM PST\nResume'),
  );
  assert.deepEqual(graded, { title: 'What is Transformation Advisory?', typeLabel: 'Graded Assignment', minutes: null, completed: false, locked: false });
});

test('status words inside a title are not a status (seen in the live outline)', () => {
  const locked = parseItemRow({
    ...row('Win the Role: The Locked Yardstick\nVideo • 3 min', { ariaLabel: 'Win the Role: The Locked Yardstick' }),
    nameText: 'Win the Role: The Locked Yardstick',
    completedIcon: false,
  });
  assert.equal(locked.locked, false);
  assert.equal(parseItemRow(row('Locked Scoring Criteria\nVideo • 2 min')).locked, false);
  assert.equal(parseItemRow(row('Locked Scoring Criteria\nVideo • 2 min', { ariaLabel: 'Locked Scoring Criteria, Locked' })).locked, true);

  const passed = parseItemRow({ ...row('Four views: One wrong work order passed review\nVideo • 4 min'), completedIcon: false });
  assert.equal(passed.completed, false);
  assert.equal(parseItemRow(row('Four views: One wrong work order passed review\nVideo • 4 min\nCompleted')).completed, true);
});

test('a title starting with "Due" is not mistaken for a due-date status line', () => {
  const parsed = parseItemRow(
    row('Due Diligence on Claims, Vendors, and Signals\nGraded Assignment • 30 min • Grade: -- •\nStatus: Due, Nov 25, 11:59 PM PST\nDue, Nov 25, 11:59 PM PST'),
  );
  assert.equal(parsed.title, 'Due Diligence on Claims, Vendors, and Signals');
  assert.equal(parsed.minutes, 30);
});

test('rc-ItemName text and the completed icon take precedence over text heuristics', () => {
  const parsed = parseItemRow({ ...row('Status: Due, Nov 9\nVideo • 2h 30m'), nameText: 'Real title', completedIcon: true });
  assert.deepEqual(parsed, { title: 'Real title', typeLabel: 'Video', minutes: 150, completed: true, locked: false });
  assert.equal(parseItemRow({ ...row('X\nVideo • 1 min'), completedIcon: false }).completed, false);
});

test('Coursera typeName from data-testid forces GRADED regardless of label', () => {
  assert.equal(classifyItem('assignment-submission', 'Practice Assignment', 'staffGraded'), 'GRADED');
  assert.equal(classifyItem('somethingNew', null, 'gradedLti'), 'GRADED');
  assert.equal(classifyItem('ungradedWidget', 'Ungraded Plugin', 'ungradedWidget'), 'OTHER');
  assert.equal(classifyItem('coach', 'Role Play', 'coach'), 'OTHER');
  assert.equal(classifyItem('lecture', 'Video', 'lecture'), 'VIDEO');
});

test('team/ pages are not study items', () => {
  assert.equal(parseItemPath('/learn/the-ai-transformation-advisor/team/LhWxx/what-is-transformation-advisory'), null);
});

test('detectCompleted rejects negations', () => {
  assert.equal(detectCompleted('Status: incomplete'), false);
  assert.equal(detectCompleted('Not started'), false);
  assert.equal(detectCompleted('Passed'), true);
});
