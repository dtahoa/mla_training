import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionForKey, chooseAction, watchCardChange } from '../src/study.ts';
import { INTERRUPTED, promptFromAsk } from '../src/prompt.ts';
import { notesFile, noteSection, slugify } from '../src/notes.ts';
import { loadConfig } from '../src/config.ts';

/** Prompt that answers `input` after `afterMs`, or never (null). Abort resolves INTERRUPTED. */
function fakePrompt(input: string | null, afterMs = 0) {
  return promptFromAsk(
    (_question, signal) =>
      new Promise<string>((resolve) => {
        const timer = input === null ? null : setTimeout(() => resolve(input), afterMs);
        signal?.addEventListener('abort', () => {
          if (timer) clearTimeout(timer);
          resolve(INTERRUPTED);
        });
      }),
  );
}

const never = async () => null;

test('keys: Enter continues content/video, never an exercise; q quits; p pauses auto', () => {
  assert.equal(actionForKey('CONTENT', ''), 'continue');
  assert.equal(actionForKey('VIDEO', ''), 'continue');
  assert.equal(actionForKey('EXERCISE', ''), 'recheck');
  assert.equal(actionForKey('CONTENT', 'q'), 'quit');
  assert.equal(actionForKey('EXERCISE', INTERRUPTED), 'quit');
  assert.equal(actionForKey('CONTENT', 'p'), 'pause');
  assert.equal(actionForKey('CONTENT', 'x'), 'recheck');
});

test('manual mode waits for your key', async () => {
  assert.equal(await chooseAction('CONTENT', { prompt: fakePrompt(''), auto: false, delayMs: 5, moved: never }), 'continue');
  assert.equal(await chooseAction('CONTENT', { prompt: fakePrompt('q'), auto: false, delayMs: 5, moved: never }), 'quit');
});

test('auto mode continues a content card after the countdown', async () => {
  assert.equal(await chooseAction('CONTENT', { prompt: fakePrompt(null), auto: true, delayMs: 5, moved: never }), 'continue');
});

test('auto never applies to video or exercise cards', async () => {
  const moved = (afterMs: number) => (signal: AbortSignal) =>
    new Promise<'moved' | null>((resolve) => {
      const timer = setTimeout(() => resolve('moved'), afterMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  // The timer (5 ms) would fire first if it applied; the player moving (30 ms) wins instead.
  assert.equal(await chooseAction('VIDEO', { prompt: fakePrompt(null), auto: true, delayMs: 5, moved: moved(30) }), 'moved');
  assert.equal(await chooseAction('EXERCISE', { prompt: fakePrompt(null), auto: true, delayMs: 5, moved: moved(30) }), 'moved');
});

test('a key press beats the auto countdown', async () => {
  assert.equal(await chooseAction('CONTENT', { prompt: fakePrompt('p', 1), auto: true, delayMs: 200, moved: never }), 'pause');
});

test('watchCardChange resolves when the player shows another card', async () => {
  let url = 'https://openai-partneru.sana.ai/s/ed/file:AAAAAAAA1';
  const watch = watchCardChange({ url: () => url }, 'file:AAAAAAAA1', 1);
  const controller = new AbortController();
  const result = watch(controller.signal);
  url = 'https://openai-partneru.sana.ai/s/ed/file:BBBBBBBB2';
  assert.equal(await result, 'moved');

  const stopped = new AbortController();
  const pending = watchCardChange({ url: () => 'https://openai-partneru.sana.ai/s/ed/file:AAAAAAAA1' }, 'file:AAAAAAAA1', 1)(stopped.signal);
  stopped.abort();
  assert.equal(await pending, null);
});

test('notes go to one Markdown file per course', () => {
  const config = loadConfig({});
  assert.equal(slugify('Architecture Patterns & Solution Blueprints'), 'architecture-patterns-and-solution-blueprints');
  assert.match(notesFile(config, { index: 1, title: 'Technical Fluency Orientation' }), /notes[\\/]01-technical-fluency-orientation\.md$/);
  assert.equal(noteSection({ title: 'Introduction', position: 2, total: 37 }, 'Text\n'), '\n## Introduction (2/37)\n\nText\n');
});
