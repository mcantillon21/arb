import { withBrowser, log } from './lib';
import { getListing, recordMessage } from './db';
import { draftOutreach } from './llm';
import { execSync } from 'node:child_process';
import type { Page } from 'playwright';

export async function reachOut(listingId: string, opts: { dryRun?: boolean; message?: string } = {}) {
  const l = getListing(listingId);
  if (!l) throw new Error(`unknown listing ${listingId}`);
  if (l.messaged_at) {
    log(`skip ${listingId}: already messaged`);
    return;
  }

  let message = opts.message;
  let draft: any = null;
  if (!message) {
    draft = await draftOutreach(l);
    if (!draft) { log(`× draft failed for ${listingId}`); return; }
    message = draft.message;
    log(`outreach: "${message}"`);
  }

  if (opts.dryRun) { log('dry-run'); return draft; }

  await withBrowser(async (_ctx, page) => {
    await sendMessage(page, l.url, message!);
  }, { headless: false, windowSize: { width: 756, height: 450 } });

  recordMessage(listingId, message!);
  log(`✓ sent to ${l.title.slice(0, 40)}`);
  return draft;
}

async function sendMessage(page: Page, url: string, message: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  try { execSync(`osascript -e 'tell application "Google Chrome for Testing" to activate'`); } catch {}

  const ta = page.locator('textarea').last();
  await ta.waitFor({ state: 'attached', timeout: 8000 });

  // Scroll the textarea into view by finding its scrollable parent
  await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea');
    const t = textareas[textareas.length - 1];
    if (!t) return;
    t.scrollIntoView({ behavior: 'instant', block: 'center' });
    // Also scroll all ancestor scrollable containers
    let el: HTMLElement | null = t.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      el = el.parentElement;
    }
  });
  await page.waitForTimeout(500);
  await ta.click({ force: true, timeout: 3000 });
  await ta.fill(message, { force: true, timeout: 3000 });

  const sendLocs = [
    page.locator('[aria-label="Send" i]').last(),
    page.getByRole('button', { name: /^send$/i }).last(),
    page.locator('button:has-text("Send"), div[role="button"]:has-text("Send")').last(),
  ];
  for (const loc of sendLocs) {
    try {
      if (await loc.isVisible({ timeout: 500 })) { await loc.click(); break; }
    } catch {}
  }

  await page.waitForTimeout(5000);
}
