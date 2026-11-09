import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { CourseItem, ItemKind } from '../src/course.ts';
import { guardFor } from '../src/guard.ts';
import {
  NO_TIME_REASON,
  autoRouteReady,
  completeOnCoursera,
  detectRoute,
  endDialogueOnCoursera,
  markBlocked,
  markCompletedOnCoursera,
} from '../src/complete.ts';
import { loadConfig } from '../src/config.ts';

const URL_OF = (path: string) => `https://www.coursera.org${path}`;
const FAST = { timeoutMs: 60, pollMs: 5 };

const plugin = (patch: Partial<CourseItem> = {}): CourseItem => ({
  id: 'w1',
  urlPath: '/learn/c/ungradedWidget/w1/skill-practice',
  segment: 'ungradedWidget',
  title: 'Skill Practice: Clean the Ask',
  typeLabel: 'Ungraded Plugin',
  minutes: 10,
  module: 1,
  order: 7,
  kind: 'OTHER',
  courseraCompleted: false,
  locked: false,
  localStatus: 'new',
  sourcePath: null,
  notesPath: null,
  ...patch,
});

const coach = (patch: Partial<CourseItem> = {}) =>
  plugin({ id: 'd1', urlPath: '/learn/c/coach/d1/the-ask', segment: 'coach', typeLabel: 'Dialogue', title: 'The Ask Underneath the Ask', ...patch });

// ---------- a tiny fake DOM: elements with a role, a name and a visibility flag ----------

interface El {
  role: string;
  name?: string;
  visible?: boolean; // default true
  disabled?: boolean;
  inDialog?: boolean;
  options?: string[]; // a native <select>
  selected?: string;
  clicks?: number;
  onClick?: () => void;
  onSelect?: (label: string) => void;
}

const shown = (el: El | undefined) => Boolean(el) && el?.visible !== false;

function locator(query: () => El[], frame: El[]): unknown {
  const first = () => query()[0];
  return {
    first: () => locator(() => query().slice(0, 1), frame),
    all: async () => query().map((_, i) => locator(() => query().slice(i, i + 1), frame)),
    count: async () => query().length,
    isVisible: async () => shown(first()),
    isDisabled: async () => Boolean(first()?.disabled),
    click: async () => {
      const el = first();
      if (!shown(el)) throw new Error('element not visible');
      el!.clicks = (el!.clicks ?? 0) + 1;
      el!.onClick?.();
    },
    waitFor: async () => {
      if (shown(first())) throw new Error('Timeout exceeded');
    },
    evaluate: async (_fn: unknown, source: string) => first()?.options?.find((o) => new RegExp(source, 'i').test(o)) ?? null,
    selectOption: async ({ label }: { label: string }) => {
      const el = first()!;
      el.selected = label;
      el.onSelect?.(label);
    },
    // Scoped to an open dialog: only elements marked inDialog, and only while the dialog shows.
    getByRole: (role: string, options?: { name?: RegExp }) =>
      locator(() => (query().some(shown) ? frame.filter((e) => e.inDialog && matches(e, role, options)) : []), frame),
  };
}

const matches = (el: El, role: string, options?: { name?: RegExp }) => el.role === role && (!options?.name || options.name.test(el.name ?? ''));

interface FakeContext {
  pages: FakePage[];
}
type FakePage = Page & { closed: boolean };

function fakePage(url: string, frames: El[][], context: FakeContext = { pages: [] }): FakePage {
  const page = {
    closed: false,
    url: () => url,
    frames: () =>
      frames.map((els) => ({
        getByRole: (role: string, options?: { name?: RegExp }) => locator(() => els.filter((e) => matches(e, role, options)), els),
        evaluate: async () => els.filter(shown).map((e) => `${e.role}: ${e.name ?? ''}`),
      })),
    context: () => ({ pages: () => context.pages.filter((p) => !p.closed) }),
    isClosed: () => page.closed,
    close: async () => {
      page.closed = true;
    },
  };
  context.pages.push(page as unknown as FakePage);
  return page as unknown as FakePage;
}

const markButton = (patch: Partial<El> = {}): El => {
  const el: El = { role: 'button', name: 'Mark as completed', ...patch };
  el.onClick ??= () => (el.visible = false); // Coursera swaps it for "Completed"
  return el;
};

// ---------- guard + config ----------

test('guard: Coursera may only be touched on readings and OTHER (ungraded) items', () => {
  const allowed: Record<ItemKind, boolean> = { VIDEO: false, READING: true, PRACTICE: false, GRADED: false, OTHER: true };
  for (const [kind, expected] of Object.entries(allowed) as Array<[ItemKind, boolean]>) {
    assert.equal(guardFor(kind).allowMarkComplete, expected, kind);
  }
});

test('AUTO_MARK_COMPLETE is off unless set to 1/true/yes/on; AUTO_CAPTURE is on unless 0/false/no/off', () => {
  assert.equal(loadConfig({}).autoMarkComplete, false);
  assert.equal(loadConfig({ AUTO_MARK_COMPLETE: '0' }).autoMarkComplete, false);
  for (const value of ['1', 'true', 'YES', ' on ']) assert.equal(loadConfig({ AUTO_MARK_COMPLETE: value }).autoMarkComplete, true, value);
  assert.equal(loadConfig({}).autoCapture, true);
  for (const value of ['0', 'false', 'off']) assert.equal(loadConfig({ AUTO_CAPTURE: value }).autoCapture, false, value);
});

// ---------- route: Mark as completed ----------

test('mark: clicks the button on the ungraded item page and reports it confirmed', async () => {
  const item = plugin();
  const button = markButton();
  assert.deepEqual(await completeOnCoursera(fakePage(URL_OF(item.urlPath), [[button]]), item, FAST), { route: 'mark', outcome: { status: 'clicked' } });
  assert.equal(button.clicks, 1);
});

test('mark: only the exact name counts ("Mark as incomplete" is never clicked)', async () => {
  const item = plugin();
  const wrong = markButton({ name: 'Mark as incomplete' });
  assert.deepEqual(await markCompletedOnCoursera(fakePage(URL_OF(item.urlPath), [[wrong]]), item), { status: 'not_found' });
  assert.equal(wrong.clicks, undefined);
});

test('mark: finds the button inside a plugin frame when the main page has none', async () => {
  const item = plugin();
  const inFrame = markButton();
  assert.equal((await markCompletedOnCoursera(fakePage(URL_OF(item.urlPath), [[], [inFrame]]), item)).status, 'clicked');
  assert.equal(inFrame.clicks, 1);
});

test('never acts on practice / graded items or videos, even if the buttons are there', async () => {
  for (const [kind, segment] of [
    ['GRADED', 'assignment-submission'],
    ['PRACTICE', 'quiz'],
    ['VIDEO', 'lecture'],
  ] as const) {
    const item = plugin({ kind, segment, urlPath: `/learn/c/${segment}/w1/x`, typeLabel: null });
    const mark = markButton();
    const start: El = { role: 'button', name: 'Start Dialogue' };
    const page = fakePage(URL_OF(item.urlPath), [[mark, start]]);
    assert.equal((await completeOnCoursera(page, item, FAST)).outcome.status, 'blocked', kind);
    assert.equal(await detectRoute(page, item), null, kind);
    assert.equal(mark.clicks ?? 0, 0, kind);
    assert.equal(start.clicks ?? 0, 0, kind);
  }
});

test('the live URL is re-checked: a stored OTHER item now on a graded URL is blocked', async () => {
  const item = plugin({ urlPath: '/learn/c/assignment-submission/w1/x' });
  assert.match(markBlocked(URL_OF(item.urlPath), item) ?? '', /Guard/);
  const button = markButton();
  assert.equal((await markCompletedOnCoursera(fakePage(URL_OF(item.urlPath), [[button]]), item)).status, 'blocked');
  assert.equal(button.clicks, undefined);
});

test('never acts when Chrome shows another item', async () => {
  const item = plugin();
  const button = markButton();
  assert.equal((await completeOnCoursera(fakePage(URL_OF('/learn/c/ungradedWidget/zz9/other'), [[button]]), item, FAST)).outcome.status, 'blocked');
  assert.equal(button.clicks, undefined);
});

test('mark: a disabled button is not clicked; an unconfirmed click is reported as failed', async () => {
  const item = plugin();
  const disabled = markButton({ disabled: true });
  assert.equal((await markCompletedOnCoursera(fakePage(URL_OF(item.urlPath), [[disabled]]), item)).status, 'failed');
  assert.equal(disabled.clicks, undefined);
  const stays = markButton({ onClick: () => undefined });
  assert.equal((await markCompletedOnCoursera(fakePage(URL_OF(item.urlPath), [[stays]]), item, 10)).status, 'failed');
  assert.equal(stays.clicks, 1);
});

test('nothing to do → not_found', async () => {
  const item = plugin();
  assert.deepEqual(await completeOnCoursera(fakePage(URL_OF(item.urlPath), [[{ role: 'button', name: 'Like' }]]), item, FAST), {
    route: null,
    outcome: { status: 'not_found' },
  });
});

// ---------- route: dialogue ----------

const NO_TIME = "I don't have time to finish";

/** Same tab: Start → End → popup with a custom dropdown → option → "End Dialogue" confirm. */
function sameTabDialogue() {
  const start: El = { role: 'button', name: 'Start Dialogue' };
  const end: El = { role: 'button', name: 'End Dialogue', visible: false };
  const dialog: El = { role: 'dialog', visible: false };
  const combo: El = { role: 'combobox', name: 'Why are you ending?', visible: false, inDialog: true };
  const other: El = { role: 'option', name: 'I finished the conversation', visible: false, inDialog: true };
  const noTime: El = { role: 'option', name: NO_TIME, visible: false, inDialog: true };
  const confirm: El = { role: 'button', name: 'End Dialogue', visible: false, inDialog: true };
  start.onClick = () => {
    start.visible = false;
    end.visible = true;
  };
  end.onClick = () => {
    dialog.visible = combo.visible = confirm.visible = true;
  };
  combo.onClick = () => (other.visible = noTime.visible = true);
  noTime.onClick = () => (other.visible = noTime.visible = false);
  confirm.onClick = () => (dialog.visible = combo.visible = confirm.visible = end.visible = false);
  return { els: [start, end, dialog, combo, other, noTime, confirm], start, noTime, other, confirm };
}

test('dialogue (same tab): Start → End → choose "I don\'t have time to finish" → confirm', async () => {
  const item = coach();
  const flow = sameTabDialogue();
  const page = fakePage(URL_OF(item.urlPath), [flow.els]);
  assert.equal(await detectRoute(page, item), 'dialogue');
  assert.deepEqual(await completeOnCoursera(page, item, FAST), { route: 'dialogue', outcome: { status: 'clicked' } });
  assert.equal(flow.start.clicks, 1);
  assert.equal(flow.noTime.clicks, 1);
  assert.equal(flow.other.clicks, undefined);
  assert.equal(flow.confirm.clicks, 1);
});

test('dialogue (new tab, native <select>): the reason is selected and the tab is closed', async () => {
  const item = coach();
  const context: FakeContext = { pages: [] };
  const start: El = { role: 'button', name: 'Start Dialogue' };
  const page = fakePage(URL_OF(item.urlPath), [[start]], context);
  let dialoguePage: FakePage | undefined;
  const select: El = { role: 'combobox', name: 'Reason', options: ['Choose one', 'I finished', NO_TIME], visible: false, inDialog: true };
  const dialog: El = { role: 'dialog', visible: false };
  const end: El = { role: 'button', name: 'End Dialogue', onClick: () => (dialog.visible = select.visible = true) };
  select.onSelect = () => (dialog.visible = select.visible = false); // choosing ends it, no confirm button
  start.onClick = () => {
    dialoguePage = fakePage(URL_OF('/learn/c/coach/d1/the-ask/dialogue'), [[end, dialog, select]], context);
  };
  assert.deepEqual(await endDialogueOnCoursera(page, item, FAST), { status: 'clicked' });
  assert.equal(select.selected, NO_TIME);
  assert.equal(dialoguePage?.closed, true);
  assert.equal(page.closed, false);
});

test('dialogue: a popup without the "no time" reason is closed with its confirm button', async () => {
  const item = coach();
  const flow = sameTabDialogue();
  flow.noTime.name = 'Something else';
  assert.deepEqual(await endDialogueOnCoursera(fakePage(URL_OF(item.urlPath), [flow.els]), item, FAST), { status: 'clicked' });
  assert.equal(flow.confirm.clicks, 1);
  assert.equal(flow.noTime.clicks, undefined, 'no other reason is picked instead');
  assert.equal(flow.other.clicks, undefined);
});

test('dialogue: "Are you sure? Yes / No" popup → Yes, never No or Cancel', async () => {
  const item = coach();
  const start: El = { role: 'button', name: 'Start Role Play' };
  const end: El = { role: 'button', name: 'End Role Play', visible: false };
  const dialog: El = { role: 'dialog', visible: false };
  const no: El = { role: 'button', name: 'No', visible: false, inDialog: true };
  const cancel: El = { role: 'button', name: 'Cancel', visible: false, inDialog: true };
  const yes: El = { role: 'button', name: 'Yes, end it', visible: false, inDialog: true };
  start.onClick = () => (end.visible = true);
  end.onClick = () => (dialog.visible = no.visible = cancel.visible = yes.visible = true);
  yes.onClick = () => (dialog.visible = no.visible = cancel.visible = yes.visible = false);
  assert.deepEqual(await endDialogueOnCoursera(fakePage(URL_OF(item.urlPath), [[start, end, dialog, no, cancel, yes]]), item, FAST), {
    status: 'clicked',
  });
  assert.equal(yes.clicks, 1);
  assert.equal(no.clicks, undefined);
  assert.equal(cancel.clicks, undefined);
});

test('dialogue: a popup with neither the reason nor a confirm button fails and lists the controls it saw', async () => {
  const item = coach();
  const flow = sameTabDialogue();
  flow.noTime.name = 'Something else';
  flow.confirm.name = 'Cancel';
  const outcome = await endDialogueOnCoursera(fakePage(URL_OF(item.urlPath), [flow.els]), item, FAST);
  assert.equal(outcome.status, 'failed');
  assert.ok(outcome.status === 'failed' && outcome.controls?.some((c) => /combobox/.test(c)), JSON.stringify(outcome));
  assert.equal(flow.confirm.clicks, undefined, 'Cancel is never clicked');
});

test('dialogue: no End button after Start → failed (nothing typed, nothing else clicked)', async () => {
  const item = coach();
  const start: El = { role: 'button', name: 'Start Dialogue' };
  const outcome = await endDialogueOnCoursera(fakePage(URL_OF(item.urlPath), [[start]]), item, FAST);
  assert.equal(outcome.status, 'failed');
  assert.equal(start.clicks, 1);
});

test('reason: any "I don\'t have time…" wording counts, nothing else does', () => {
  for (const ok of [
    "I don't have time to finish",
    "I don't have enough time to finish",
    "I don't have time to finish right now",
    'I dont have time',
    'I don’t have time right now',
    'I do not have enough time',
  ]) {
    assert.ok(NO_TIME_REASON.test(ok), ok);
  }
  for (const bad of ['I have time', 'I finished the conversation', 'Time to finish', "I don't want to continue"]) {
    assert.ok(!NO_TIME_REASON.test(bad), bad);
  }
});

/** Start Activity → new tab "Use text chat" → End Role Play → radio "I don't have time right now" → Submit. */
function activityFlow(context: FakeContext) {
  const start: El = { role: 'button', name: 'Start Activity' };
  const voice: El = { role: 'button', name: 'Use voice' };
  const textChat: El = { role: 'button', name: 'Use text chat' };
  const end: El = { role: 'button', name: 'End Role Play', visible: false };
  const dialog: El = { role: 'dialog', visible: false };
  const finished: El = { role: 'radio', name: 'I completed the role play', visible: false, inDialog: true };
  const noTime: El = { role: 'radio', name: "I don't have time right now", visible: false, inDialog: true };
  const submit: El = { role: 'button', name: 'Submit', visible: false, inDialog: true };
  textChat.onClick = () => {
    voice.visible = textChat.visible = false; // the chat page loads
    end.visible = true;
  };
  end.onClick = () => (dialog.visible = finished.visible = noTime.visible = submit.visible = true);
  submit.onClick = () => (dialog.visible = finished.visible = noTime.visible = submit.visible = false);
  let activityPage: FakePage | undefined;
  start.onClick = () => {
    activityPage = fakePage(URL_OF('/learn/c/ungradedWidget/w1/activity'), [[voice, textChat, end, dialog, finished, noTime, submit]], context);
  };
  return { start, voice, textChat, end, finished, noTime, submit, activityPage: () => activityPage };
}

test('activity: Start Activity → Use text chat → End Role Play → "I don\'t have time…" → Submit', async () => {
  const item = plugin();
  const context: FakeContext = { pages: [] };
  const flow = activityFlow(context);
  const page = fakePage(URL_OF(item.urlPath), [[flow.start]], context);
  assert.equal(await detectRoute(page, item), 'dialogue');
  assert.deepEqual(await completeOnCoursera(page, item, FAST), { route: 'dialogue', outcome: { status: 'clicked' } });
  assert.equal(flow.start.clicks, 1);
  assert.equal(flow.textChat.clicks, 1);
  assert.equal(flow.voice.clicks, undefined, 'never picks voice');
  assert.equal(flow.end.clicks, 1);
  assert.equal(flow.noTime.clicks, 1);
  assert.equal(flow.finished.clicks, undefined);
  assert.equal(flow.submit.clicks, 1);
  assert.equal(flow.activityPage()?.closed, true);
});

test('activity: no End button after "Use text chat" → failed, and the controls are listed', async () => {
  const item = plugin();
  const context: FakeContext = { pages: [] };
  const flow = activityFlow(context);
  flow.textChat.onClick = () => undefined; // the chat page never shows End
  const outcome = await endDialogueOnCoursera(fakePage(URL_OF(item.urlPath), [[flow.start]], context), item, FAST);
  assert.equal(outcome.status, 'failed');
  assert.ok(outcome.status === 'failed' && /End/.test(outcome.reason) && outcome.controls?.some((c) => /Use text chat/.test(c)));
  assert.equal(flow.textChat.clicks, 1, 'text chat is clicked only once');
});

test('route: "Mark as completed" wins over a dialogue when both are offered', async () => {
  const item = coach();
  const page = fakePage(URL_OF(item.urlPath), [[markButton(), { role: 'button', name: 'Start Dialogue' }]]);
  assert.equal(await detectRoute(page, item), 'mark');
});

// ---------- auto watcher ----------

async function auto(page: Page, item: CourseItem, ms = 200): Promise<'done' | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    return await autoRouteReady(page, item, stop.signal, { delayMs: 20, waitMs: 100, pollMs: 5 });
  } finally {
    clearTimeout(timer);
  }
}

test('auto: fires "done" once the page offers a route and the countdown has passed', async () => {
  const item = plugin();
  const button = markButton({ visible: false });
  setTimeout(() => (button.visible = true), 30); // plugin frame loads a bit later
  const started = Date.now();
  assert.equal(await auto(fakePage(URL_OF(item.urlPath), [[button]]), item), 'done');
  assert.ok(Date.now() - started >= 20, 'waits at least the countdown');
  assert.equal(button.clicks, undefined, 'the watcher itself never clicks');
});

test('auto: fires for a dialogue too', async () => {
  const item = coach();
  assert.equal(await auto(fakePage(URL_OF(item.urlPath), [sameTabDialogue().els]), item), 'done');
});

test('auto: nothing on the page within the wait → stays pending (menu waits for you)', async () => {
  const item = plugin();
  assert.equal(await auto(fakePage(URL_OF(item.urlPath), [[markButton({ visible: false })]]), item), null);
});

test('auto: never fires on graded / practice items or videos', async () => {
  for (const kind of ['GRADED', 'PRACTICE', 'VIDEO'] as const) {
    const item = plugin({ kind });
    assert.equal(await auto(fakePage(URL_OF(item.urlPath), [[markButton()]]), item), null, kind);
  }
});

test('auto: a key press during the countdown (abort) wins', async () => {
  const item = plugin();
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 10);
  const result = await autoRouteReady(fakePage(URL_OF(item.urlPath), [[markButton()]]), item, stop.signal, { delayMs: 200, waitMs: 500, pollMs: 5 });
  assert.equal(result, null);
});
