import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSESSMENT_LIKE,
  graphqlOperations,
  groupLinks,
  isLoginUrl,
  jsonShape,
  looksLikeId,
  mergeShapes,
  pathPattern,
  pickChildLinks,
  type LinkInfo,
} from '../src/inspect.ts';

const ID = 'd4d206ae-aa74-4f86-b503-d5b2fbab1a0f';
const ID2 = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';

test('pathPattern hides ids but keeps the route words', () => {
  assert.equal(pathPattern(`/program/${ID}`), '/program/:id');
  assert.equal(pathPattern(`/courses/${ID}/12`), '/courses/:id/:n');
  assert.equal(pathPattern('/content/aB3dE5fG7hJ9kL1mN'), '/content/:id');
  assert.equal(pathPattern('/home'), '/home');
});

test('looksLikeId: UUIDs and Sana ids, not words or camelCase names', () => {
  for (const id of [ID, 'iZGYCxcGVQHf', 'eVNFmFuELfeS', '8YfMYfV1Ro98', 'tbibj9Vq13JB']) assert.ok(looksLikeId(id), id);
  for (const word of ['GetLearnerProgram', 'lessonsModules', 'notifications', 'list-sidebar-teamspace-summaries', 'next', 'COMPLETED']) {
    assert.ok(!looksLikeId(word), word);
  }
});

test('pathPattern spots Sana short ids after a route word', () => {
  assert.equal(pathPattern('/s/eVNFmFuELfeS/next'), '/s/:id/next');
  assert.equal(pathPattern('/course/iZGYCxcGVQHf'), '/course/:id');
  assert.equal(pathPattern('/course/iZGYCxcGVQHf/lesson/Ab_cd-EFgh'), '/course/:id/lesson/:id');
  assert.equal(pathPattern('/graphql/operation/GetLearnerProgram'), '/graphql/operation/GetLearnerProgram');
  assert.equal(pathPattern('/discover'), '/discover');
});

test('jsonShape keeps key names and types, never values', () => {
  const shape = jsonShape({
    data: { program: { id: ID, title: 'OpenAI Technical Practitioner', progress: 0.4, done: false, owner: null } },
    viewer: { email: 'someone@example.com' },
    items: [{ name: 'Lesson 1' }, { name: 'Lesson 2' }],
  });
  assert.deepEqual(shape, {
    data: { program: { id: 'string', title: 'string', progress: 'number', done: 'boolean', owner: 'null' } },
    viewer: { email: 'string' },
    items: ['len=2', { name: 'string' }],
  });
  assert.doesNotMatch(JSON.stringify(shape), /someone@example\.com|Technical Practitioner|Lesson/);
});

test('jsonShape stops at the depth limit and caps wide objects', () => {
  assert.deepEqual(jsonShape({ a: { b: { c: 1 } } }, 2), { a: { b: '{…}' } });
  const wide = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]));
  const shape = jsonShape(wide) as Record<string, unknown>;
  assert.equal(Object.keys(shape).length, 61);
  assert.equal(shape['…'], '5 more keys');
});

test('jsonShape keeps enum values and merges every array item', () => {
  const shape = jsonShape({
    steps: [
      { __typename: 'ProgramCourseStep', id: 'iZGYCxcGVQHf', course: { title: 'Orientation' }, status: 'COMPLETED' },
      { __typename: 'ProgramCourseStep', id: 'x', course: null, status: 'LOCKED' },
      { __typename: 'ProgramExamStep', id: 'y', passScore: 80, status: 'California' },
    ],
  });
  assert.deepEqual(shape, {
    steps: [
      'len=3',
      {
        __typename: '"ProgramCourseStep" | "ProgramExamStep"',
        id: 'string',
        course: { title: 'string' },
        status: '"COMPLETED" | "LOCKED" | string',
        passScore: 'number',
      },
    ],
  });
});

test('jsonShape folds a map keyed by ids into one shape', () => {
  const shape = jsonShape({
    editions: {
      eVNFmFuELfeS: { id: 'eVNFmFuELfeS', data: { language: 'en', isDefault: true }, status: { progress: 0 } },
      '8YfMYfV1Ro98': { id: '8YfMYfV1Ro98', data: { language: 'ja', isDefault: false }, status: { progress: 0 } },
    },
  });
  assert.deepEqual(shape, {
    editions: { ':id ×2': { id: 'string', data: { language: 'string', isDefault: 'boolean' }, status: { progress: 'number' } } },
  });
});

test('mergeShapes joins differing leaves and keeps the longest array', () => {
  assert.equal(mergeShapes('string', 'number'), 'string | number');
  assert.equal(mergeShapes('null', { a: 'string' }) && JSON.stringify(mergeShapes('null', { a: 'string' })), '{"a":"string"}');
  assert.deepEqual(mergeShapes(['len=2', { a: 'string' }], ['len=5', { b: 'number' }]), ['len=5', { a: 'string', b: 'number' }]);
});

test('graphqlOperations reads single and batched GraphQL bodies only', () => {
  assert.deepEqual(graphqlOperations(JSON.stringify({ operationName: 'GetProgram', query: '…' })), ['GetProgram']);
  assert.deepEqual(graphqlOperations(JSON.stringify([{ operationName: 'A' }, { operationName: 'B' }])), ['A', 'B']);
  assert.deepEqual(graphqlOperations('not json'), []);
  assert.deepEqual(graphqlOperations(null), []);
});

test('isLoginUrl spots login / SSO pages', () => {
  assert.ok(isLoginUrl('https://openai-partneru.sana.ai/login?redirect=%2Fprogram'));
  assert.ok(isLoginUrl('https://openai-partneru.sana.ai/sso/okta'));
  assert.ok(isLoginUrl('https://openai-partneru.sana.ai/auth/callback'));
  assert.ok(!isLoginUrl(`https://openai-partneru.sana.ai/program/${ID}`));
  assert.ok(!isLoginUrl('not a url'));
});

test('ASSESSMENT_LIKE covers exams, quizzes and the certificate', () => {
  for (const text of ['Final exam', 'Knowledge check quiz', 'Certification assessment', 'Get your certificate', 'Practice test', 'Submit']) {
    assert.match(text, ASSESSMENT_LIKE, text);
  }
  for (const text of ['Prompt engineering basics', 'Building with the Responses API', 'Testing strategies']) {
    assert.doesNotMatch(text, ASSESSMENT_LIKE, text);
  }
});

test('pickChildLinks opens course pages only, never exams, feedback or account pages', () => {
  const links: LinkInfo[] = [
    { path: '/home', text: 'Home', inMain: false },
    { path: `/courses/${ID2}`, text: 'Sidebar course', inMain: false },
    { path: `/program/${ID}`, text: 'This program', inMain: true },
    { path: `/courses/${ID}`, text: 'Final exam', inMain: true },
    { path: '/course/fEeDbAcKxYz1', text: '8. OpenAI Technical Practitioner Feedback', inMain: true },
    { path: `/certificate/${ID}`, text: 'Download', inMain: true },
    { path: '/settings/profile', text: 'Profile', inMain: true },
    { path: '/about', text: 'About', inMain: true },
    { path: null, text: 'External docs', inMain: true },
    { path: `/courses/${ID2}`, text: 'Intro to the OpenAI platform', inMain: true },
    { path: `/courses/${ID2}`, text: 'Intro to the OpenAI platform (again)', inMain: true },
    { path: `/courses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, text: 'Agents', inMain: true },
    { path: `/courses/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, text: 'Evals', inMain: true },
  ];
  assert.deepEqual(pickChildLinks(links, [`/program/${ID}`]), [
    `/courses/${ID2}`,
    '/courses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ]);
  // Pages already opened (the program, the course itself) are never picked again.
  assert.deepEqual(pickChildLinks(links, [`/program/${ID}`, `/courses/${ID2}`], 1), ['/courses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
});

test('pickChildLinks finds the Sana course link the first probe missed', () => {
  const links: LinkInfo[] = [
    { path: `/program/${ID}`, text: 'Skip to main content', inMain: false },
    { path: '/discover', text: 'Discover', inMain: false },
    { path: '/course/iZGYCxcGVQHf', text: '1. Technical Fluency Orientation', inMain: true },
  ];
  assert.deepEqual(pickChildLinks(links, [`/program/${ID}`], 1), ['/course/iZGYCxcGVQHf']);
});

test('pickChildLinks follows the course Start link into the player', () => {
  const links: LinkInfo[] = [
    { path: '/course/iZGYCxcGVQHf', text: 'Skip to main content', inMain: false },
    { path: '/learn', text: 'My library', inMain: false },
    { path: '/s/eVNFmFuELfeS/next', text: 'Start', inMain: true },
  ];
  assert.deepEqual(pickChildLinks(links, [`/program/${ID}`, '/course/iZGYCxcGVQHf'], 1), ['/s/eVNFmFuELfeS/next']);
});

test('pickChildLinks uses every link when the page has no <main>', () => {
  const links: LinkInfo[] = [{ path: `/courses/${ID2}`, text: 'Course', inMain: false }];
  assert.deepEqual(pickChildLinks(links, [`/program/${ID}`]), [`/courses/${ID2}`]);
});

test('groupLinks groups by pattern with a few sample texts', () => {
  const groups = groupLinks([
    { path: `/courses/${ID}`, text: 'A', inMain: true },
    { path: `/courses/${ID2}`, text: 'B', inMain: false },
    { path: '/home', text: 'Home', inMain: false },
    { path: null, text: 'external', inMain: true },
  ]);
  assert.deepEqual(groups, [
    { pattern: '/courses/:id', count: 2, inMain: 1, texts: ['A', 'B'] },
    { pattern: '/home', count: 1, inMain: 0, texts: ['Home'] },
  ]);
});
