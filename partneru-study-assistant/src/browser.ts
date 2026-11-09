// Browser layer (same approach as the Coursera tool). The tool starts a normal
// Google Chrome with its own profile (.data/chrome-profile) and a local
// DevTools port, then attaches Playwright over CDP. You sign in to PartnerU by
// hand in that window (SSO / MFA work as usual); the tool never sees your
// password, and the window stays open with your login when the tool exits.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PARTNERU_ORIGIN, type Config } from './config.ts';
import { isLoginUrl } from './inspect.ts';

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Detach Playwright. Chrome (and your login) stays open. */
  disconnect(): Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  throw new Error(
    `Chrome không mở cổng DevTools ${config.cdpPort}. Đóng Chrome đang dùng profile partneru-study-assistant/.data/chrome-profile rồi thử lại.`,
  );
}

export async function openSession(config: Config, startUrl: string): Promise<Session> {
  const alreadyRunning = await devtoolsAlive(config.cdpPort);
  if (!alreadyRunning) await startChrome(config, startUrl);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome không có browser context mặc định.');

  const pages = context.pages();
  const page =
    pages.find((candidate) => candidate.url().startsWith(PARTNERU_ORIGIN)) ?? pages[0] ?? (await context.newPage());
  if (alreadyRunning && !page.url().startsWith(PARTNERU_ORIGIN)) {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();

  return {
    browser,
    context,
    page,
    // On a CDP connection, Browser.close() only disconnects.
    disconnect: () => browser.close(),
  };
}

/** The part of Page that isLoggedIn needs (kept small so tests can fake it). */
export interface LoginProbePage {
  url(): string;
  locator(selector: string): { first(): { isVisible(): Promise<boolean> } };
}

const visible = (page: LoginProbePage, selector: string) =>
  page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false);

/**
 * Signed in = a PartnerU page that is not a login page, shows no login form
 * and has rendered the app (main / nav). The auth cookie name of Sana is not
 * known yet, so this looks at the page; the probe reports cookie names to
 * replace it with a cookie check later.
 */
export async function isLoggedIn(page: LoginProbePage): Promise<boolean> {
  const url = page.url();
  if (!url.startsWith(PARTNERU_ORIGIN) || isLoginUrl(url)) return false;
  if (await visible(page, 'input[type="password"], input[type="email"], input[autocomplete="username"]')) return false;
  return visible(page, 'main, [role="main"], nav, [role="navigation"]');
}

/** Wait for the page to finish its first data load (SPA): network quiet, then a short pause. */
export async function settle(page: Page, quietMs = 1500): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(quietMs);
}

export async function waitForLogin(session: Session, startUrl: string, timeoutMs = 10 * 60_000): Promise<boolean> {
  const { page } = session;
  if (!page.url().startsWith(PARTNERU_ORIGIN)) await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (await isLoggedIn(page)) return true;
  await page.bringToFront();
  console.log('\n🔐 Hãy đăng nhập OpenAI PartnerU trong cửa sổ Chrome vừa mở (SSO / email / MFA đều được).');
  console.log('   Tool chỉ chờ trang chương trình hiện ra; không đọc mật khẩu. Ctrl+C để hủy.\n');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (await isLoggedIn(page)) return true;
  }
  return false;
}

/** Cookie names only (never values) for the probe report. */
export async function cookieNames(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies(PARTNERU_ORIGIN);
  return [...new Set(cookies.map((cookie) => cookie.name))].sort();
}

/** Human-paced delay between automated page loads. */
export function politeDelay(minMs = 1500, maxMs = 3500): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}
