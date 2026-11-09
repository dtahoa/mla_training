// Finishes an ungraded item on Coursera for you, by one of two routes:
//   mark     — click Coursera's own "Mark as completed" button
//   dialogue — Start Dialogue / Role Play / Activity → ("Use text chat") → End
//              → pick "I don't have time to finish" (or similar)
// under three conditions checked here on every call:
//   1. you pressed [d] on this item, or you turned on AUTO_MARK_COMPLETE=1 and
//      let the countdown run out (the caller only calls this after that),
//   2. the guard allows it for both the stored and the live-URL kind
//      (readings and ungraded / OTHER items; never practice, graded or videos),
//   3. Chrome still shows this exact item.
// It only looks for controls by their exact names; it never reads, answers or
// types anything into the item.

import { setTimeout as sleep } from 'node:timers/promises';
import type { Frame, Locator, Page } from 'playwright';
import { classifyItem, parseItemPath, type CourseItem } from './course.ts';
import { guardFor } from './guard.ts';

export type Route = 'mark' | 'dialogue';

export type MarkOutcome =
  | { status: 'clicked' }
  | { status: 'not_found' }
  | { status: 'blocked'; reason: string }
  /** `controls`: names of the buttons / dropdowns seen when a step failed, to tune selectors. */
  | { status: 'failed'; reason: string; controls?: string[] };

// Exact names only, so "Mark as incomplete" / "Unmark as completed" never match.
const MARK_BUTTON = /^\s*mark as completed?\s*$/i;
const START_DIALOGUE = /^\s*start (dialogue|role[- ]?play|activity)\s*$/i;
/** Some activities first ask how to take part; text needs no microphone. */
const USE_TEXT_CHAT = /^\s*use text( chat)?\s*$/i;
const END_DIALOGUE = /^\s*end (dialogue|role[- ]?play|activity|conversation|chat)\s*$/i;
/** "I don't have time to finish", "I dont have time right now", "I do not have enough time"... */
export const NO_TIME_REASON = /^\s*i (?:don['’]?t|do not) have (?:the |enough )?time\b/i;
/** Confirm button inside the end-of-dialogue popup, if it has one. */
/** Never "No", "Cancel" or "Close": those keep the activity open instead of ending it. */
const CONFIRM_END = /^\s*(yes\b.*|end( dialogue| role[- ]?play| activity| conversation| chat)?|submit|confirm|done|continue|ok)\s*$/i;
/** How long to look for the "I don't have time…" choice before falling back to the confirm button. */
const REASON_WAIT_MS = 5000;

/** Why acting is not allowed on this page for this item, or null when it is. */
export function markBlocked(pageUrl: string, item: CourseItem): string | null {
  const ref = parseItemPath(pageUrl);
  if (!ref || ref.id !== item.id) return 'Trang trên Chrome không còn là item này.';
  // Same rule as capture: re-derive the kind from the live URL; the stricter one wins.
  const liveKind = classifyItem(ref.segment, item.typeLabel);
  if (!guardFor(liveKind).allowMarkComplete || !guardFor(item.kind).allowMarkComplete) {
    return `Guard: không bấm "Mark as completed" cho loại ${item.kind === liveKind ? item.kind : `${item.kind}/${liveKind}`}.`;
  }
  return null;
}

/** First visible control with this role (or roles) + name, on the page itself or inside a frame. */
async function findVisible(page: Page, role: 'button' | Array<'button' | 'link'>, name: RegExp): Promise<Locator | null> {
  for (const frame of page.frames()) {
    for (const r of Array.isArray(role) ? role : [role]) {
      const control = frame.getByRole(r, { name }).first();
      if (await control.isVisible().catch(() => false)) return control;
    }
  }
  return null;
}

/** Which route this item's page offers right now, or null (none, or not allowed). */
export async function detectRoute(page: Page, item: CourseItem): Promise<Route | null> {
  if (markBlocked(page.url(), item)) return null;
  if (await findVisible(page, 'button', MARK_BUTTON)) return 'mark';
  if (await findVisible(page, 'button', START_DIALOGUE)) return 'dialogue';
  return null;
}

/** Seconds you get to type a key before AUTO_MARK_COMPLETE acts. */
export const AUTO_MARK_DELAY_MS = 3000;

const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

/**
 * AUTO_MARK_COMPLETE watcher (races the keyboard in chooseAction). Resolves
 * 'done' once this item's page offers a route (the guard is checked on every
 * poll) and `delayMs` has passed since it started. It never clicks itself; the
 * normal [d] path does. With no route after `waitMs`, or when `signal` aborts
 * (you typed something), it stays pending until the abort and resolves null.
 */
export async function autoRouteReady(
  page: Page,
  item: CourseItem,
  signal: AbortSignal,
  { delayMs = AUTO_MARK_DELAY_MS, waitMs = 20_000, pollMs = 500 } = {},
): Promise<'done' | null> {
  const started = Date.now();
  while (!signal.aborted && Date.now() - started < waitMs) {
    if (await detectRoute(page, item)) {
      const left = delayMs - (Date.now() - started);
      if (left > 0) await sleep(left, undefined, { signal }).catch(() => undefined);
      if (signal.aborted) break;
      return 'done';
    }
    await sleep(pollMs, undefined, { signal }).catch(() => undefined);
  }
  await untilAborted(signal);
  return null;
}

export interface StepTiming {
  /** How long to wait for each control to show up. */
  timeoutMs?: number;
  pollMs?: number;
}

export async function completeOnCoursera(page: Page, item: CourseItem, timing: StepTiming = {}): Promise<{ route: Route | null; outcome: MarkOutcome }> {
  const blocked = markBlocked(page.url(), item);
  if (blocked) return { route: null, outcome: { status: 'blocked', reason: blocked } };
  const route = await detectRoute(page, item);
  if (route === 'mark') return { route, outcome: await markCompletedOnCoursera(page, item, timing.timeoutMs) };
  if (route === 'dialogue') return { route, outcome: await endDialogueOnCoursera(page, item, timing) };
  return { route: null, outcome: { status: 'not_found' } };
}

export async function markCompletedOnCoursera(page: Page, item: CourseItem, timeoutMs = 5000): Promise<MarkOutcome> {
  const blocked = markBlocked(page.url(), item);
  if (blocked) return { status: 'blocked', reason: blocked };
  const button = await findVisible(page, 'button', MARK_BUTTON);
  if (!button) return { status: 'not_found' };
  if (await button.isDisabled().catch(() => true)) {
    return { status: 'failed', reason: 'nút "Mark as completed" đang bị khoá (có thể cần làm xong một bước trước)' };
  }
  try {
    await button.click({ timeout: timeoutMs });
  } catch (error) {
    return { status: 'failed', reason: `không bấm được nút: ${firstLine(error)}` };
  }
  // Coursera swaps the button for a "Completed" state once it has recorded it.
  const confirmed = await button.waitFor({ state: 'hidden', timeout: timeoutMs }).then(
    () => true,
    () => false,
  );
  return confirmed ? { status: 'clicked' } : { status: 'failed', reason: 'đã bấm nhưng chưa thấy Coursera xác nhận' };
}

/**
 * Start Dialogue / Role Play / Activity → (same tab or a new tab) "Use text
 * chat" if the activity asks → End → in the popup pick "I don't have time…" →
 * confirm. Nothing is typed into the dialogue. A tab the tool opened is closed
 * again on success.
 */
export async function endDialogueOnCoursera(page: Page, item: CourseItem, { timeoutMs = 20_000, pollMs = 300 }: StepTiming = {}): Promise<MarkOutcome> {
  const blocked = markBlocked(page.url(), item);
  if (blocked) return { status: 'blocked', reason: blocked };
  const start = await findVisible(page, 'button', START_DIALOGUE);
  if (!start) return { status: 'not_found' };

  const before = new Set(page.context().pages());
  try {
    await start.click({ timeout: timeoutMs });
  } catch (error) {
    return { status: 'failed', reason: `không bấm được "Start Dialogue": ${firstLine(error)}` };
  }

  // 1. The activity opens in a new tab or replaces this page. Wait for End
  //    there; if it first asks how to take part, pick "Use text chat" (once).
  const scan = async (allowTextChat: boolean) => {
    const opened = page.context().pages().filter((p) => !before.has(p));
    for (const target of [...opened, page]) {
      const end = await findVisible(target, 'button', END_DIALOGUE);
      if (end) return { target, control: end, step: 'end' as const };
      const textChat = allowTextChat ? await findVisible(target, ['button', 'link'], USE_TEXT_CHAT) : null;
      if (textChat) return { target, control: textChat, step: 'text_chat' as const };
    }
    return null;
  };
  let found = await poll(timeoutMs, pollMs, () => scan(true));
  if (found?.step === 'text_chat') {
    const chatPage = found.target;
    try {
      await found.control.click({ timeout: timeoutMs });
    } catch (error) {
      return failed(chatPage, `không bấm được "Use text chat": ${firstLine(error)}`);
    }
    found = await poll(timeoutMs, pollMs, () => scan(false));
    if (!found) return failed(chatPage, 'không thấy nút "End" sau khi chọn "Use text chat"');
  }
  if (!found) return failed(page, 'không thấy nút "End" (hay "Use text chat") sau khi Start');
  const { target, control: end } = found;
  const newTab = target !== page;

  try {
    await end.click({ timeout: timeoutMs });
  } catch (error) {
    return failed(target, `không bấm được nút "End": ${firstLine(error)}`);
  }

  // 2. The popup: pick the reason (native <select>, custom dropdown, radio or button).
  //    Only wait a little: a plain "Are you sure? Yes / No" popup has no reason.
  const reasonChosen = await chooseNoTimeReason(target, Math.min(timeoutMs, REASON_WAIT_MS), pollMs);

  // 3. Confirm ("Submit", "End", "Yes"...). Optional after a reason; without
  //    one, the confirm button is what closes the popup, so wait for it.
  await sleep(pollMs);
  const confirm = reasonChosen
    ? await findInDialog(target, CONFIRM_END)
    : await poll(timeoutMs, pollMs, () => findInDialog(target, CONFIRM_END));
  if (!reasonChosen && !confirm) {
    return failed(target, 'popup không có lựa chọn "I don\'t have time…" và cũng không có nút Yes / Confirm / End');
  }
  if (confirm) await confirm.click({ timeout: timeoutMs }).catch(() => undefined);
  const closed = await poll(timeoutMs, pollMs, async () => ((await dialogOpen(target)) ? null : true));
  if (!closed) return failed(target, 'popup kết thúc chưa đóng (có thể cần bấm xác nhận khác)');

  if (newTab) await target.close().catch(() => undefined);
  return { status: 'clicked' };
}

async function chooseNoTimeReason(target: Page, timeoutMs: number, pollMs: number): Promise<boolean> {
  const opened = new Set<Frame>();
  const chosen = await poll(timeoutMs, pollMs, async () => {
    for (const frame of target.frames()) {
      // Native <select>: choose the option by its exact text.
      for (const combo of await frame.getByRole('combobox').all().catch(() => [] as Locator[])) {
        const label = await combo
          .evaluate(
            (el, source) =>
              el instanceof HTMLSelectElement ? ([...el.options].find((o) => new RegExp(source, 'i').test(o.text))?.text ?? null) : null,
            NO_TIME_REASON.source,
          )
          .catch(() => null);
        if (label) {
          await combo.selectOption({ label });
          return true;
        }
      }
      // Custom dropdown already open, or radio / plain buttons.
      for (const role of ['option', 'menuitemradio', 'menuitem', 'radio', 'button'] as const) {
        const choice = frame.getByRole(role, { name: NO_TIME_REASON }).first();
        if (await choice.isVisible().catch(() => false)) {
          await choice.click();
          return true;
        }
      }
      // Closed custom dropdown: open it once, the next poll picks the option.
      if (!opened.has(frame)) {
        const combo = frame.getByRole('combobox').first();
        if (await combo.isVisible().catch(() => false)) {
          opened.add(frame);
          await combo.click().catch(() => undefined);
        }
      }
    }
    return null;
  });
  return chosen === true;
}

const DIALOG_ROLES = ['dialog', 'alertdialog'] as const;

async function findInDialog(target: Page, name: RegExp): Promise<Locator | null> {
  for (const frame of target.frames()) {
    for (const role of DIALOG_ROLES) {
      const button = frame.getByRole(role).getByRole('button', { name }).first();
      if ((await button.isVisible().catch(() => false)) && !(await button.isDisabled().catch(() => true))) return button;
    }
  }
  return null;
}

async function dialogOpen(target: Page): Promise<boolean> {
  if (target.isClosed?.()) return false;
  for (const frame of target.frames()) {
    for (const role of DIALOG_ROLES) {
      if (await frame.getByRole(role).first().isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

/** Names of the buttons, dropdowns and options on the page (UI labels only, no course text). */
async function listControls(target: Page): Promise<string[]> {
  const names: string[] = [];
  for (const frame of target.frames()) {
    const found = await frame
      .evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, select, option, [role="button"], [role="combobox"], [role="option"], [role="radio"], [role="dialog"]')]
          .filter((el) => el.offsetParent !== null || el.tagName === 'OPTION')
          .map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()}: ${(el.getAttribute('aria-label') ?? el.innerText ?? el.textContent ?? '').trim().slice(0, 60)}`)
          .slice(0, 80),
      )
      .catch(() => [] as string[]);
    names.push(...found);
  }
  return [...new Set(names)];
}

async function failed(target: Page, reason: string): Promise<MarkOutcome> {
  return { status: 'failed', reason, controls: await listControls(target) };
}

async function poll<T>(timeoutMs: number, pollMs: number, check: () => Promise<T | null>): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}

const firstLine = (error: unknown) => (error as Error).message.split('\n')[0];
