import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/probe.ts';

test('the markdown report lists pages, link patterns, API calls and blockers', () => {
  const md = renderMarkdown(
    {
      generatedAt: '2026-11-09T00:00:00.000Z',
      programId: 'd4d206ae-aa74-4f86-b503-d5b2fbab1a0f',
      programName: 'OpenAI Technical Practitioner',
      auth: { loggedIn: true, cookieNames: ['session'] },
      pages: [
        {
          path: '/program/d4d206ae-aa74-4f86-b503-d5b2fbab1a0f',
          pattern: '/program/:id',
          title: "OpenAI's PartnerU",
          headings: [
            { level: 1, text: 'OpenAI Technical Practitioner' },
            { level: 2, text: 'Courses' },
          ],
          linkGroups: [{ pattern: '/courses/:id', count: 3, inMain: 3, texts: ['Intro | basics', 'Agents'] }],
          buttons: { Continue: 1, 'Open menu': 2 },
          progressTexts: ['3 courses', '40%'],
          progressBars: [{ label: 'Program progress', value: '40' }],
          testIds: [],
          iframes: [],
          videos: 0,
          mainTextChars: 1200,
          inputs: { radio: 4 },
          frames: [{ origin: 'https://openai-partneru.sana.ai', pattern: '/frame', chars: 0, buttons: [] }],
        },
      ],
      api: [{ host: 'openai-partneru.sana.ai', method: 'POST', pattern: '/api/graphql', status: 200, operations: ['GetProgram'] }],
    },
    [],
    ['note one'],
    'probe.json',
  );
  assert.match(md, /^# Probe report — OpenAI Technical Practitioner/);
  assert.match(md, /## Page `\/program\/:id`/);
  assert.match(md, /  - h2: Courses/);
  assert.match(md, /Main text: 1200 chars · inputs: \{"radio":4\}/);
  assert.match(md, /Frames: \[\{"origin":"https:\/\/openai-partneru\.sana\.ai","pattern":"\/frame"/);
  assert.match(md, /\| `\/courses\/:id` \| 3 \| 3 \| Intro \\\| basics · Agents \|/);
  assert.match(md, /- Open menu ×2/);
  assert.match(md, /\| POST \| openai-partneru\.sana\.ai \| `\/api\/graphql` \| 200 \| GetProgram \|/);
  assert.match(md, /## Blockers\n- \(none\)/);
  assert.match(md, /## Notes\n- note one/);
});
