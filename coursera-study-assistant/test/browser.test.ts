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
import { videoFinished } from '../src/study.ts';

const config = loadConfig({ ...process.env, COURSE_SLUG: 'demo' });
const L = '/learn/demo';

const page = (body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}<script>${script}</script></body></html>`;

const li = (href: string, title: string, meta: string, hint = '') =>
  `<li><a href="${href}">${title}</a><div>${meta}</div>${hint}</li>`;

// Real Coursera row shape (from the live probe, 2026-11): the first svg in the
// link is the item-type icon (glyph on a circle, dark) or, once the item is
// done, a green check with no circle and no text/aria.
const TYPE_ICON = '<svg aria-hidden="true" style="color: rgb(13, 15, 18)"><circle cx="10" cy="10" r="10"></circle><path fill="currentColor" d="M8.922 12.5"></path></svg>';
const DONE_ICON = '<svg aria-hidden="true" style="color: rgb(25, 125, 18)"><path fill="currentColor" d="M8.938 10.875"></path></svg>';
const row = (typeName: string, href: string, title: string, meta: string, done = false) =>
  `<li data-testid="WeekSingleItemDisplay-${typeName}"><a href="${href}" aria-label="${title}">${done ? DONE_ICON : TYPE_ICON}` +
  `<div><span data-test="rc-ItemName">${title}</span><div><span>${meta}</span></div></div></a></li>`;

function fakePlayer({ seek }: { seek: boolean }): string {
  return `
    const v = document.querySelector('video');
    let t = ${seek ? 60 : 0}, playedTo = ${seek ? 5 : 0};
    Object.defineProperty(v, 'duration', { get: () => 60 });
    Object.defineProperty(v, 'currentTime', { get: () => t });
    Object.defineProperty(v, 'ended', { get: () => t >= 60 });
    Object.defineProperty(v, 'played', { get: () => ({ length: 1, start: () => 0, end: () => playedTo }) });
    ${seek ? '' : 'setInterval(() => { t = Math.min(60, t + 10); playedTo = t; }, 50);'}`;
}

const MODULE_1_LIST = [
  '<h2>What AI Transformation Advisory Is</h2><nav><ul>',
  row('lecture', `${L}/lecture/v1/intro`, 'Problem: The decisive work nobody scoped', 'Video • 2 min', true),
  row('ungradedWidget', `${L}/ungradedWidget/w1/skill-practice-clean-the-ask`, 'Skill Practice: Clean the Ask', 'Ungraded Plugin • 10 min'),
  row('coach', `${L}/coach/c1/engage-the-sponsor`, 'Engage the Sponsor', 'Role Play • 15 min', true),
  row(
    'staffGraded',
    `${L}/assignment-submission/g1/due-diligence`,
    'Due Diligence on Claims, Vendors, and Signals',
    'Graded Assignment • Started • Grade: -- •</span><span>Status: Due, Nov 9, 11:59 PM PST</span><span>Resume',
  ),
  '</ul></nav>',
].join('');

const FIXTURES: Record<string, { type: string; body: string }> = {
  [`${L}/home/module/1`]: {
    type: 'text/html',
    body: page(
      // Sidebar module links + a nav link that exists before the list renders,
      // a timezone dialog heading, and a timeline card linking a module-2 team page.
      `<nav><a href="${L}/home/module/1">Module 1</a><a href="${L}/home/module/2">Module 2</a><a href="${L}/home/module/3">Module 3</a>
         <a href="${L}/discussions">Discussion Forums</a></nav>
       <main>
         <div role="dialog" data-testid="timezone-modal-content"><h2>Timezone mismatch</h2></div>
         <div id="list"><h2>Loading...</h2></div>
         <div data-testid="course-timeline-card"><a href="${L}/team/g2/mapping-the-landscape">Mapping the landscape</a></div>
       </main>`,
      // Item list renders late, like the real SPA.
      `setTimeout(() => { document.getElementById('list').innerHTML = ${JSON.stringify(MODULE_1_LIST)}; }, 1500);`,
    ),
  },
  // Older/fallback layout: plain item links, no data-testid.
  [`${L}/home/module/2`]: {
    type: 'text/html',
    body: page(
      `<main><h2>Mapping the Enterprise AI Capability Landscape</h2><ul>
         ${li(`${L}/lecture/v2/landscape`, 'Landscape', 'Video • 4 min')}
         ${li(`${L}/supplement/r2/vendors`, 'Vendors', 'Reading • 8 min', '<span aria-label="Locked"></span>')}
         ${li(`${L}/quiz/p1/check`, 'Quick check', 'Practice Assignment • 3 questions')}
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
  // Simulated player (no media file): 60 s video advancing 10 s every 50 ms.
  [`${L}/lecture/v9/watched`]: { type: 'text/html', body: page('<main><video></video></main>', fakePlayer({ seek: false })) },
  // Learner drags the scrubber to the end after playing only 5 s.
  [`${L}/lecture/v8/skipped`]: { type: 'text/html', body: page('<main><video></video></main>', fakePlayer({ seek: true })) },
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

test('fetchOutline waits for the late item list, reads real-shaped rows, falls back, and stops at a missing module', { skip, timeout: 60_000 }, async () => {
  const result = await fetchOutline(context, config);
  assert.deepEqual(
    result.scans.map((s) => [s.finalPath.split('/').pop(), s.scope, s.rows.length]),
    [
      ['1', 'item-testid', 4],
      ['2', 'main', 3],
      ['welcome', 'document', 0],
    ],
  );
  assert.deepEqual(result.scans[0]?.moduleNumbers, [1, 2, 3]);
  assert.deepEqual(
    result.modules.map((m) => [m.number, m.title, m.itemCount]),
    [
      [1, 'What AI Transformation Advisory Is', 4],
      [2, 'Mapping the Enterprise AI Capability Landscape', 3],
    ],
  );
  const summary = result.items.map(
    (i) => `${i.module}.${i.order} ${i.id} ${i.kind} ${i.typeLabel} ${i.minutes ?? '-'}${i.courseraCompleted ? ' done' : ''}${i.locked ? ' locked' : ''}`,
  );
  assert.deepEqual(summary, [
    '1.1 v1 VIDEO Video 2 done',
    '1.2 w1 OTHER Ungraded Plugin 10',
    '1.3 c1 OTHER Role Play 15 done',
    '1.4 g1 GRADED Graded Assignment -',
    '2.1 v2 VIDEO Video 4',
    '2.2 r2 READING Reading 8 locked',
    '2.3 p1 PRACTICE Practice Assignment -',
  ]);
  assert.equal(result.items.find((i) => i.id === 'g1')?.title, 'Due Diligence on Claims, Vendors, and Signals');
  assert.ok(!result.items.some((i) => i.id === 'g2'), 'team/ links from the timeline card are not items');
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

test('videoFinished reads the real <video> state in the browser: watched → done, skipped → nothing', { skip }, async () => {
  const run = async (id: string, slug: string) => {
    const p = await open(`${L}/lecture/${id}/${slug}`);
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 3000);
    try {
      return await videoFinished(p, asItem({ id, urlPath: `${L}/lecture/${id}/${slug}`, segment: 'lecture', kind: 'VIDEO' }), stop.signal, 50);
    } finally {
      clearTimeout(timer);
      await p.close();
    }
  };
  assert.equal(await run('v9', 'watched'), 'done');
  assert.equal(await run('v8', 'skipped'), null);
});

test('captureFromPage refuses to read a graded assessment page', { skip }, async () => {
  const p = await open(`${L}/assignment-submission/g1/module-quiz`);
  const graded = asItem({ id: 'g1', urlPath: `${L}/assignment-submission/g1/module-quiz`, segment: 'assignment-submission', kind: 'GRADED' });
  await assert.rejects(captureFromPage(p, graded), GuardBlockedError);
  await p.close();
});
