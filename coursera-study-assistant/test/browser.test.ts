// Runs the real in-browser extraction/capture code in headless Chrome against
// SYNTHETIC pages served via page.route (no network). This proves the code
// paths work in a browser; it does not prove Coursera's real DOM matches —
// that is what `npm run probe` is for.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadConfig } from '../src/config.ts';
import { fetchOutline } from '../src/outline.ts';
import { GuardBlockedError, captureFromPage } from '../src/capture.ts';
import type { CourseItem } from '../src/course.ts';

const config = loadConfig({ ...process.env, COURSE_SLUG: 'demo' });
const L = '/learn/demo';

const page = (body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}<script>${script}</script></body></html>`;

const li = (href: string, title: string, meta: string, hint = '') =>
  `<li><a href="${href}">${title}</a><div>${meta}</div>${hint}</li>`;

const FIXTURES: Record<string, { type: string; body: string }> = {
  [`${L}/home/module/1`]: {
    type: 'text/html',
    body: page(
      // Sidebar outside <main> lists a module-2 item: must be ignored.
      `<nav><a href="${L}/lecture/v9/sidebar-only">Sidebar only</a></nav>
       <main><h1>Module 1: What AI Transformation Advisory Is</h1><ul>
         ${li(`${L}/lecture/v1/intro`, 'Problem: The decisive work nobody scoped', 'Video • 2 min', '<svg><title>Completed</title></svg>')}
         ${li(`${L}/supplement/r1/reading-the-room`, 'Reading the room', 'Reading • 10 min')}
         ${li(`${L}/quiz/p1/check`, 'Quick check', 'Practice Assignment • 3 questions')}
         ${li(`${L}/assignment-submission/g1/module-quiz`, 'Module quiz', 'Graded Assignment • 30 min')}
         ${li(`${L}/discussionPrompt/d1/share`, 'Share your view', 'Discussion Prompt • 10 min')}
       </ul></main>`,
    ),
  },
  [`${L}/home/module/2`]: {
    type: 'text/html',
    body: page(
      `<main><h2>Mapping the Enterprise AI Capability Landscape</h2><ul>
         ${li(`${L}/lecture/v2/landscape`, 'Landscape', 'Video • 4 min')}
         ${li(`${L}/supplement/r2/vendors`, 'Vendors', 'Reading • 8 min', '<span aria-label="Locked"></span>')}
       </ul></main>`,
    ),
  },
  // Module 3 does not exist: Coursera-like redirect away from /home/module/3.
  [`${L}/home/module/3`]: {
    type: 'text/html',
    body: page('<main>Welcome</main>', `history.replaceState(null, '', '${L}/home/welcome');`),
  },
  [`${L}/lecture/v1/intro`]: {
    type: 'text/html',
    body: page(`<main><video><track kind="captions" srclang="en" src="/api/subs/v1.vtt"></video><button>Transcript</button></main>`),
  },
  '/api/subs/v1.vtt': {
    type: 'text/vtt',
    body: 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nOne plant changed its part numbering.\n\n2\n00:00:03.000 --> 00:00:06.000\nThe change never reached the feed the assistant reads.\n',
  },
  [`${L}/supplement/r1/reading-the-room`]: {
    type: 'text/html',
    body: page(
      `<main><button>Mark as completed</button><div class="rc-CML"><h2>Reading the room</h2><p>${'Stakeholders decide outcomes. '.repeat(20)}</p></div><button>Go to next item</button></main>`,
    ),
  },
  [`${L}/assignment-submission/g1/module-quiz`]: {
    type: 'text/html',
    body: page('<main><h1>Module quiz</h1><p>Question 1: secret question text</p></main>'),
  },
};

let browser: Browser | undefined;
let context: BrowserContext;
const skip = config.chromePath ? false : 'Google Chrome not found';

before(async () => {
  if (skip) return;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const fixture = url.hostname === 'www.coursera.org' ? FIXTURES[url.pathname] : undefined;
    if (fixture) await route.fulfill({ status: 200, contentType: `${fixture.type}; charset=utf-8`, body: fixture.body });
    else await route.fulfill({ status: 404, contentType: 'text/html', body: page('<main>not found</main>') });
  });
});

after(async () => {
  await browser?.close();
});

const asItem = (patch: Partial<CourseItem> & Pick<CourseItem, 'id' | 'urlPath' | 'segment' | 'kind'>): CourseItem => ({
  title: 't',
  typeLabel: null,
  minutes: null,
  module: 1,
  order: 1,
  courseraCompleted: false,
  locked: false,
  localStatus: 'new',
  sourcePath: null,
  notesPath: null,
  ...patch,
});

async function open(path: string): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`https://www.coursera.org${path}`);
  return p;
}

test('fetchOutline reads modules, types, completion and lock state, then stops at a missing module', { skip, timeout: 60_000 }, async () => {
  const result = await fetchOutline(context, config);
  assert.deepEqual(
    result.modules.map((m) => [m.number, m.title, m.itemCount]),
    [
      [1, 'What AI Transformation Advisory Is', 5],
      [2, 'Mapping the Enterprise AI Capability Landscape', 2],
    ],
  );
  const summary = result.items.map((i) => `${i.module}.${i.order} ${i.id} ${i.kind} ${i.typeLabel} ${i.minutes ?? '-'}${i.courseraCompleted ? ' done' : ''}${i.locked ? ' locked' : ''}`);
  assert.deepEqual(summary, [
    '1.1 v1 VIDEO Video 2 done',
    '1.2 r1 READING Reading 10',
    '1.3 p1 PRACTICE Practice Assignment -',
    '1.4 g1 GRADED Graded Assignment 30',
    '1.5 d1 OTHER Discussion Prompt 10',
    '2.1 v2 VIDEO Video 4',
    '2.2 r2 READING Reading 8 locked',
  ]);
  assert.equal(result.items.find((i) => i.id === 'r1')?.title, 'Reading the room');
  assert.ok(!result.items.some((i) => i.id === 'v9'), 'sidebar link outside <main> must be ignored');
});

test('captureFromPage reads a video transcript from the captions track', { skip }, async () => {
  const p = await open(`${L}/lecture/v1/intro`);
  const result = await captureFromPage(p, asItem({ id: 'v1', urlPath: `${L}/lecture/v1/intro`, segment: 'lecture', kind: 'VIDEO' }));
  assert.equal(result.method, 'video-captions-track');
  assert.equal(result.text, 'One plant changed its part numbering. The change never reached the feed the assistant reads.');
  await p.close();
});

test('captureFromPage reads reading content without UI chrome', { skip }, async () => {
  const p = await open(`${L}/supplement/r1/reading-the-room`);
  const result = await captureFromPage(p, asItem({ id: 'r1', urlPath: `${L}/supplement/r1/reading-the-room`, segment: 'supplement', kind: 'READING' }));
  assert.equal(result.method, 'reading-main-content');
  assert.match(result.text, /^Reading the room\n/);
  assert.ok(!/Mark as completed|Go to next item/.test(result.text));
  await p.close();
});

test('captureFromPage refuses to read a graded assessment page', { skip }, async () => {
  const p = await open(`${L}/assignment-submission/g1/module-quiz`);
  const graded = asItem({ id: 'g1', urlPath: `${L}/assignment-submission/g1/module-quiz`, segment: 'assignment-submission', kind: 'GRADED' });
  await assert.rejects(captureFromPage(p, graded), GuardBlockedError);
  await p.close();
});
