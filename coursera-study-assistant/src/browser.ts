// Browser layer. The tool starts a normal Google Chrome with its own profile
// (.data/chrome-profile) and a local DevTools port, then attaches Playwright to
// it over CDP. Because Chrome is not launched by Playwright, Google/Coursera
// sign-in works like in any browser, and the window survives when the tool
// exits — you can pause and resume without logging in again.
//
// The tool never sees your password: you log in by hand in that window.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { COURSERA_ORIGIN, type Config } from './config.ts';

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Detach Playwright. Chrome (and your login) stays open. */
  disconnect(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function devtoolsAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startChrome(config: Config, startUrl: string): Promise<void> {
  if (!config.chromePath) {
    throw new Error('Không tìm thấy Google Chrome. Đặt CHROME_PATH trong .env.');
  }
  await mkdir(config.profileDir, { recursive: true });
  const child = spawn(
    config.chromePath,
    [
      `--remote-debugging-port=${config.cdpPort}`,
      `--user-data-dir=${config.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      startUrl,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  for (let i = 0; i < 75; i++) {
    if (await devtoolsAlive(config.cdpPort)) return;
    await sleep(200);
  }
  throw new Error(`Chrome không mở cổng DevTools ${config.cdpPort}. Đóng Chrome đang dùng profile .data/chrome-profile rồi thử lại.`);
}

export async function openSession(config: Config, startUrl: string): Promise<Session> {
  const alreadyRunning = await devtoolsAlive(config.cdpPort);
  if (!alreadyRunning) await startChrome(config, startUrl);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome không có browser context mặc định.');

  const pages = context.pages();
  const page =
    pages.find((candidate) => candidate.url().startsWith(COURSERA_ORIGIN)) ?? pages[0] ?? (await context.newPage());
  if (alreadyRunning && !page.url().startsWith(COURSERA_ORIGIN)) {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();

  return {
    browser,
    context,
    page,
    // On a CDP connection, Browser.close() only disconnects (verified with Chrome 156).
    disconnect: () => browser.close(),
  };
}

/** Coursera keeps the signed-in session in the CAUTH cookie. Only its presence is checked. */
export async function isLoggedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies(COURSERA_ORIGIN);
  return cookies.some((cookie) => cookie.name === 'CAUTH' && cookie.value.length > 0);
}

/** Cookie names only (never values) for the probe report. */
export async function courseraCookieNames(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies(COURSERA_ORIGIN);
  return [...new Set(cookies.map((cookie) => cookie.name))].sort();
}

export async function waitForLogin(session: Session, timeoutMs = 10 * 60_000): Promise<boolean> {
  if (await isLoggedIn(session.context)) return true;
  await session.page.goto(`${COURSERA_ORIGIN}/?authMode=login`, { waitUntil: 'domcontentloaded' });
  await session.page.bringToFront();
  console.log('\n🔐 Hãy đăng nhập Coursera trong cửa sổ Chrome vừa mở (Google / email / MFA đều được).');
  console.log('   Tool chỉ chờ cookie đăng nhập xuất hiện; không đọc mật khẩu. Ctrl+C để hủy.\n');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(session.context)) return true;
    await sleep(2000);
  }
  return false;
}

/** Human-paced delay between automated page loads. */
export function politeDelay(minMs = 1500, maxMs = 3500): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

export async function gotoPath(page: Page, urlPath: string): Promise<void> {
  await page.goto(`${COURSERA_ORIGIN}${urlPath}`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
}
