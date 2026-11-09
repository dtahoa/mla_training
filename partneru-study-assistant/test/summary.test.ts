import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildContext, courseSummaryPrompt, coverage, listCourseNotes, parseNotes, programSummaryPrompt, runSummary } from '../src/summary.ts';
import { appendCardNote } from '../src/notes.ts';
import { loadConfig } from '../src/config.ts';
import type { CompletionRequest, LlmClient } from '../src/ai.ts';

const NOTES = `# Technical Fluency Orientation

Ghi chú tự động từ các thẻ bài học (không gồm knowledge check / exam).

## Three lenses for early technical judgment (7/37)

Workflow, data, risk.

## Introduction (2/37)

Technical fluency helps you move from product familiarity to practical solution judgment.

## Why technical fluency matters (6/37)

Ask better questions.
### Sub heading inside a card
- bullet

## Introduction (2/37)

duplicate copy

## Empty card (3/37)

`;

test('parseNotes returns cards in course order, first copy wins, empty cards dropped', () => {
  const notes = parseNotes(NOTES);
  assert.equal(notes.course, 'Technical Fluency Orientation');
  assert.deepEqual(
    notes.cards.map((c) => [c.position, c.title]),
    [
      [2, 'Introduction'],
      [6, 'Why technical fluency matters'],
      [7, 'Three lenses for early technical judgment'],
    ],
  );
  assert.equal(notes.cards[0]?.text, 'Technical fluency helps you move from product familiarity to practical solution judgment.');
  assert.equal(notes.cards[1]?.text, 'Ask better questions.\n### Sub heading inside a card\n- bullet');
  assert.deepEqual(coverage({ index: 1, file: 'x', ...notes }), { saved: 3, total: 37 });
});

test('parseNotes reads what appendCardNote writes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pu-notes-'));
  const file = path.join(dir, '01-course.md');
  const card = { editionId: 'e', cardId: 'file:A', title: 'Intro', position: 2, total: 37, courseTitle: 'Course' };
  await appendCardNote(file, 'Course', card, 'Body one');
  await appendCardNote(file, 'Course', { ...card, cardId: 'file:B', title: 'Next', position: 3 }, 'Body two');
  const notes = parseNotes(await readFile(file, 'utf8'));
  assert.deepEqual(notes, {
    course: 'Course',
    cards: [
      { title: 'Intro', position: 2, total: 37, text: 'Body one' },
      { title: 'Next', position: 3, total: 37, text: 'Body two' },
    ],
  });
});

test('buildContext cites cards and keeps the beginning of long ones', () => {
  const context = buildContext(
    [
      { title: 'Intro', position: 2, total: 37, text: 'a'.repeat(100) },
      { title: 'Lenses', position: 7, total: 37, text: 'short' },
    ],
    100,
  );
  assert.match(context, /^### \[C2\] Intro\na{50}\n\[\.\.\.truncated\]/);
  assert.match(context, /### \[C7\] Lenses\nshort$/);
});

test('summary prompts name the program and ask for the revision sections', () => {
  const course = { index: 1, file: '01-x.md', course: 'Technical Fluency Orientation', cards: parseNotes(NOTES).cards };
  const prompt = courseSummaryPrompt('OpenAI Technical Practitioner', course, 'Vietnamese');
  assert.match(prompt.system, /OpenAI Technical Practitioner/);
  for (const section of ['## Big picture', '## Key concepts', '## Frameworks & decision guides', '## Pitfalls', '## Apply it', '## Review questions']) {
    assert.ok(prompt.system.includes(section), section);
  }
  assert.match(prompt.system, /Write in Vietnamese/);
  assert.match(prompt.user, /^# Course 1: Technical Fluency Orientation/);
  assert.match(prompt.user, /\[C2\] Introduction/);

  const program = programSummaryPrompt('OpenAI Technical Practitioner', [{ index: 1, course: 'A', markdown: 'notes A' }], 'Vietnamese');
  for (const section of ['## The program in one page', '## How the courses connect', '## Cheat sheet', '## Glossary', '## Final review']) {
    assert.ok(program.system.includes(section), section);
  }
  assert.match(program.user, /# Course 1: A\nnotes A/);
});

function fakeLlm(): LlmClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    provider: 'fake',
    model: 'fake-1',
    requests,
    async complete(request) {
      requests.push(request);
      return `## Big picture\n\nsummary #${requests.length}`;
    },
  };
}

async function tempConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pu-summary-'));
  const config = {
    ...loadConfig({}),
    notesDir: path.join(dir, 'notes'),
    summariesDir: path.join(dir, 'summaries'),
    progressPath: path.join(dir, 'progress.json'),
    auditPath: path.join(dir, 'audit.jsonl'),
  };
  await mkdir(config.notesDir, { recursive: true });
  return config;
}

test('runSummary writes one summary per course and a program summary', async () => {
  const config = await tempConfig();
  await writeFile(path.join(config.notesDir, '01-technical-fluency-orientation.md'), NOTES, 'utf8');
  await writeFile(path.join(config.notesDir, '02-technical-implementation-foundations.md'), '# Foundations\n\n## APIs (1/30)\n\nText.\n', 'utf8');
  await writeFile(path.join(config.notesDir, 'readme.txt'), 'ignored', 'utf8');
  const llm = fakeLlm();
  await runSummary(config, { llm });

  assert.equal(llm.requests.length, 3);
  assert.deepEqual((await readdir(config.summariesDir)).sort(), [
    '01-technical-fluency-orientation.md',
    '02-technical-implementation-foundations.md',
    'program.md',
  ]);
  const first = await readFile(path.join(config.summariesDir, '01-technical-fluency-orientation.md'), 'utf8');
  assert.match(first, /^# Tóm tắt — Technical Fluency Orientation\n\n_Từ 3\/37 thẻ · fake\/fake-1 · /);
  assert.match(first, /summary #1/);
  assert.match(llm.requests[2]!.user, /# Course 1: Technical Fluency Orientation\n## Big picture/);
});

test('runSummary --course only summarizes that course (no program summary)', async () => {
  const config = await tempConfig();
  await writeFile(path.join(config.notesDir, '01-a.md'), NOTES, 'utf8');
  await writeFile(path.join(config.notesDir, '02-b.md'), '# B\n\n## X (1/2)\n\nText.\n', 'utf8');
  const llm = fakeLlm();
  await runSummary(config, { course: 2, llm });
  assert.equal(llm.requests.length, 1);
  assert.deepEqual(await readdir(config.summariesDir), ['02-b.md']);
  assert.equal((await listCourseNotes(config.notesDir)).length, 2);
});

test('runSummary without AI configured or without notes does nothing', async () => {
  const config = await tempConfig();
  const before = process.exitCode;
  await runSummary(config, { llm: null });
  assert.equal(process.exitCode, 1);
  process.exitCode = before;

  const llm = fakeLlm();
  await runSummary(config, { llm });
  assert.equal(llm.requests.length, 0);
});
