import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.chrome-profile');

chromium.use(StealthPlugin());

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export async function withBrowser<T>(
  fn: (ctx: BrowserContext, page: Page) => Promise<T>,
  opts: { headless?: boolean; viewport?: { width: number; height: number }; windowSize?: { width: number; height: number } } = {}
): Promise<T> {
  const vp = opts.viewport ?? { width: 1512, height: 900 };
  const win = opts.windowSize ?? vp;
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: opts.headless ?? true,
    viewport: vp,
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    args: ['--disable-blink-features=AutomationControlled', `--window-size=${win.width},${win.height}`, '--window-position=700,300'],
  });
  try {
    const { applyToContext } = await import('./session');
    await applyToContext(ctx);
  } catch {}
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    return await fn(ctx, page);
  } finally {
    await ctx.close();
  }
}

export async function withRealChrome<T>(
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1512, height: 900 },
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', `--window-size=${vp.width},${vp.height}`, '--window-position=700,300'],
  });
  try {
    const { applyToContext } = await import('./session');
    await applyToContext(ctx);
  } catch {}
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
    await ctx.close();
  }
}

export const jitter = (min: number, max: number) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

export function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto('https://www.facebook.com/marketplace/', { waitUntil: 'domcontentloaded' });
  await jitter(1500, 3000);
  if (/\/login|checkpoint/.test(page.url())) return false;
  return (
    (await page
      .locator('a[href*="/marketplace/profile/"], [aria-label="Marketplace"]')
      .first()
      .count()) > 0
  );
}
