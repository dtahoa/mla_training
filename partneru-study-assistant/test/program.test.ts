import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStep, formatDuration, isDone, isLocked, nextStep, parseProgram, progressPercent } from '../src/program.ts';
import { formatStatus } from '../src/sync.ts';

/** GetLearnerProgram as seen by the probe (shape verified; values made up). */
function learnerProgram(progress: Array<{ p: number; passed?: string }>) {
  const titles = [
    '1. Technical Fluency Orientation',
    '2. Technical Implementation Foundations',
    '3. OpenAI Technical Practitioner - Final Exam',
    '4. OpenAI Technical Practitioner Feedback',
  ];
  const ids = ['iZGYCxcGVQHf', 'c2c2c2c2c2c2', 'eXaMeXaM1234', 'fEeDbAcK5678'];
  return {
    data: {
      program: {
        id: 'd4d206ae-aa74-4f86-b503-d5b2fbab1a0f',
        name: 'OpenAI Technical Practitioner',
        steps: [
          ...ids.map((courseId, i) => ({
            __typename: 'CourseProgramStep',
            courseId,
            schedule: { __typename: i === 0 ? 'Directly' : 'OnCompletionOfPrevious' },
            course: { courseId, title: titles[i] },
          })),
          { __typename: 'EmailProgramStep', schedule: { __typename: 'Directly' } },
        ],
      },
      me: {
        enrollment: {
          nextStep: { __typename: 'UserProgramCourseStep', courseId: ids[0] },
          progress: { progress: 0.004, passedAt: null },
          steps: ids.map((courseId, i) => ({
            __typename: 'UserProgramCourseStep',
            courseId,
            content: { title: titles[i], duration: 'PT19M4.333S' },
            progress: { progress: progress[i]?.p ?? 0, passedAt: progress[i]?.passed ?? null, startedAt: null },
          })),
        },
      },
    },
  };
}

test('parseProgram reads steps, kinds, progress and unlock rules (email steps dropped)', () => {
  const outline = parseProgram(learnerProgram([{ p: 0.032 }]));
  assert.equal(outline.name, 'OpenAI Technical Practitioner');
  assert.equal(outline.nextCourseId, 'iZGYCxcGVQHf');
  assert.deepEqual(
    outline.steps.map((s) => [s.index, s.courseId, s.kind, s.progress, s.unlockOnPrevious]),
    [
      [1, 'iZGYCxcGVQHf', 'COURSE', 0.032, false],
      [2, 'c2c2c2c2c2c2', 'COURSE', 0, true],
      [3, 'eXaMeXaM1234', 'EXAM', 0, true],
      [4, 'fEeDbAcK5678', 'FEEDBACK', 0, true],
    ],
  );
});

test('parseProgram tolerates an empty or odd response', () => {
  assert.deepEqual(parseProgram(null).steps, []);
  assert.deepEqual(parseProgram({ data: { program: { steps: 'x' } } }).steps, []);
});

test('classifyStep: only real courses are studied by the tool', () => {
  assert.equal(classifyStep('6. Security, Governance & Data'), 'COURSE');
  assert.equal(classifyStep('7. OpenAI Technical Practitioner - Final Exam'), 'EXAM');
  assert.equal(classifyStep('Certification assessment'), 'EXAM');
  assert.equal(classifyStep('8. OpenAI Technical Practitioner Feedback'), 'FEEDBACK');
});

test('progress is a 0–1 fraction; done = passed or 100%', () => {
  assert.equal(progressPercent(0.032), 3);
  assert.equal(progressPercent(1), 100);
  assert.equal(progressPercent(null), null);
  const outline = parseProgram(learnerProgram([{ p: 1 }, { p: 0.5 }]));
  assert.ok(isDone(outline.steps[0]!));
  assert.ok(!isDone(outline.steps[1]!));
  const passed = parseProgram(learnerProgram([{ p: 0.9, passed: '2026-11-09T00:00:00Z' }]));
  assert.ok(isDone(passed.steps[0]!));
});

test('nextStep / isLocked follow the program order', () => {
  const fresh = parseProgram(learnerProgram([{ p: 0.032 }]));
  assert.equal(nextStep(fresh)?.index, 1);
  assert.ok(!isLocked(fresh.steps, fresh.steps[0]!));
  assert.ok(isLocked(fresh.steps, fresh.steps[1]!));

  const twoDone = parseProgram(learnerProgram([{ p: 1 }, { p: 1 }]));
  assert.equal(nextStep(twoDone)?.kind, 'EXAM');
  assert.ok(!isLocked(twoDone.steps, twoDone.steps[2]!));
});

test('formatDuration turns ISO 8601 into minutes', () => {
  assert.equal(formatDuration('PT19M4.333S'), '19 min');
  assert.equal(formatDuration('PT25M40.832999999S'), '26 min');
  assert.equal(formatDuration('PT1H5M'), '1 h 5 min');
  assert.equal(formatDuration(null), '?');
  assert.equal(formatDuration('soon'), 'soon');
});

test('formatStatus marks done / started / locked and the steps that are yours', () => {
  const text = formatStatus(parseProgram(learnerProgram([{ p: 1 }, { p: 0.4 }])), '2026-11-09T00:00:00Z');
  assert.match(text, /✅  1\. 1\. Technical Fluency Orientation  ·  19 min  ·  100%/);
  assert.match(text, /▶️  2\. .* · {2}40%/);
  assert.match(text, /🔒  3\. .*Final Exam.*← bạn tự làm/);
  assert.match(text, /🔒  4\. .*Feedback.*← bạn tự làm/);
});
