import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, parseQuiz, quizPrompt } from '../src/study-ai.ts';

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
