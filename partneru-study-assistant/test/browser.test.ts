import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoggedIn, type LoginProbePage } from '../src/browser.ts';

const PROGRAM = 'https://openai-partneru.sana.ai/program/d4d206ae-aa74-4f86-b503-d5b2fbab1a0f';

/** Fake page: `shown` lists the selectors that have a visible match. */
function fakePage(url: string, shown: string[]): LoginProbePage {
  return {
    url: () => url,
    locator: (selector: string) => ({
      first: () => ({ isVisible: async () => shown.some((s) => selector.split(', ').includes(s)) }),
    }),
  };
}

test('signed in: program page with the app rendered and no login form', async () => {
  assert.equal(await isLoggedIn(fakePage(PROGRAM, ['main'])), true);
  assert.equal(await isLoggedIn(fakePage(PROGRAM, ['nav'])), true);
});

test('not signed in: login URL, login form, other site or nothing rendered yet', async () => {
  assert.equal(await isLoggedIn(fakePage('https://openai-partneru.sana.ai/login', ['main'])), false);
  assert.equal(await isLoggedIn(fakePage(PROGRAM, ['main', 'input[type="email"]'])), false);
  assert.equal(await isLoggedIn(fakePage(PROGRAM, ['main', 'input[type="password"]'])), false);
  assert.equal(await isLoggedIn(fakePage('https://accounts.google.com/signin', ['main'])), false);
  assert.equal(await isLoggedIn(fakePage(PROGRAM, [])), false);
});

test('a page that throws while checking counts as not signed in', async () => {
  const page: LoginProbePage = {
    url: () => PROGRAM,
    locator: () => ({ first: () => ({ isVisible: () => Promise.reject(new Error('detached')) }) }),
  };
  assert.equal(await isLoggedIn(page), false);
});
