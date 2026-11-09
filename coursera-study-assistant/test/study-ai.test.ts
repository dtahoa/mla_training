import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, courseSummaryPrompt, groupByModule, moduleSummaryPrompt, parseQuiz, quizPrompt } from '../src/study-ai.ts';

test('parseQuiz accepts fenced JSON and drops malformed questions', () => {
  const reply = [
    'Here you go:',
    '```json',
    JSON.stringify({
      questions: [
        { question: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 2, explanation: 'because' },
        { question: 'bad answer index', options: ['a', 'b'], answer: 5, explanation: 'x' },
        { question: 'missing explanation', options: ['a', 'b'], answer: 0 },
      ],
    }),
    '```',
  ].join('\n');
  const questions = parseQuiz(reply);
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.answer, 2);
});

test('parseQuiz throws when nothing usable comes back', () => {
  assert.throws(() => parseQuiz('no json here'));
  assert.throws(() => parseQuiz('{"questions": []}'));
});

test('buildContext gives every source a share of the budget', () => {
  const context = buildContext(
    [
      { module: 1, title: 'Long', type: 'Video', text: 'x'.repeat(1000) },
      { module: 1, title: 'Short', type: 'Reading', text: 'short text' },
    ],
    200,
  );
  assert.ok(context.includes('### [M1] Long (Video)'));
  assert.ok(context.includes('[...truncated]'));
  assert.ok(context.includes('short text'));
});

test('quizPrompt asks for JSON in the configured language', () => {
  const request = quizPrompt([{ module: 1, title: 't', type: 'Video', text: 'body' }], 3, 'Vietnamese');
  assert.match(request.system, /Return JSON only/);
  assert.match(request.system, /Vietnamese/);
  assert.match(request.system, /3 questions/);
});

test('groupByModule keeps module order and item order inside each module', () => {
  const s = (module: number, title: string) => ({ module, title, type: 'Video', text: title });
  const groups = groupByModule([s(2, 'b1'), s(1, 'a1'), s(2, 'b2'), s(1, 'a2')]);
  assert.deepEqual(
    groups.map(([module, list]) => [module, list.map((x) => x.title)]),
    [
      [1, ['a1', 'a2']],
      [2, ['b1', 'b2']],
    ],
  );
});

test('moduleSummaryPrompt uses only the module transcripts, cites titles, in the configured language', () => {
  const request = moduleSummaryPrompt(3, 'Roadmaps', [{ module: 3, title: 'Sequencing bets', type: 'Video', text: 'transcript body' }], 'Vietnamese');
  assert.match(request.system, /Use only the provided sources/);
  assert.match(request.system, /Vietnamese/);
  assert.match(request.system, /## Review questions/);
  assert.match(request.user, /Module 3 — Roadmaps/);
  assert.match(request.user, /\[M3\] Sequencing bets/);
  assert.match(request.user, /transcript body/);
});

test('courseSummaryPrompt synthesizes the module summaries', () => {
  const request = courseSummaryPrompt(
    'design-ai-transformation-roadmaps',
    [
      { module: 1, title: 'Intro', markdown: '## Big picture\nM1 ideas' },
      { module: 2, title: null, markdown: '## Big picture\nM2 ideas' },
    ],
    'Vietnamese',
  );
  assert.match(request.system, /cheat sheet/i);
  assert.match(request.user, /design-ai-transformation-roadmaps/);
  assert.match(request.user, /# Module 1 — Intro[\s\S]*M1 ideas[\s\S]*# Module 2\n[\s\S]*M2 ideas/);
});
