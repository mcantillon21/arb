import { withBrowser, log } from './lib';
import { db, getListing, getActiveConversations, addMessage, getConversation } from './db';
import { draftResponse } from './llm';
import { execSync } from 'node:child_process';
import { cyan, green, red, dim, yellow } from './ui';
import type { Page } from 'playwright';

let running = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startMonitor(intervalMs = 30000) {
  if (pollInterval) return;
  log(`${cyan('monitor')} started — polling every ${intervalMs / 1000}s`);
  pollInterval = setInterval(() => checkInbox(), intervalMs);
  checkInbox();
}

export function stopMonitor() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function checkInbox() {
  if (running) return;
  const active = getActiveConversations();
  if (!active.length) return;

  running = true;
  log(`${cyan('monitor')} checking ${active.length} active conversations...`);

  try {
    await withBrowser(async (_ctx, page) => {
      await page.goto('https://www.facebook.com/marketplace/inbox/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(3000);

      const unread = await findUnreadConversations(page);
      if (!unread.length) {
        log(`${cyan('monitor')} no new replies`);
        return;
      }

      log(`${cyan('monitor')} ${green(String(unread.length))} new replies`);

      for (const conv of unread) {
        const listing = active.find(a =>
          conv.title.toLowerCase().includes(a.title.slice(0, 20).toLowerCase()) ||
          (a.product_name && conv.title.toLowerCase().includes(a.product_name.slice(0, 20).toLowerCase()))
        );
        if (!listing) continue;

        try {
          await handleReply(page, listing, conv);
        } catch (e: any) {
          log(`${red('×')} reply to ${dim(listing.id)}: ${e.message}`);
        }
      }
    }, { headless: false, windowSize: { width: 756, height: 450 } });
  } catch (e: any) {
    log(`${red('×')} monitor: ${e.message}`);
  } finally {
    running = false;
  }
}

type InboxConv = { title: string; lastMessage: string; isUnread: boolean; index: number };

async function findUnreadConversations(page: Page): Promise<InboxConv[]> {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('[role="row"], [data-testid*="conversation"], a[href*="/marketplace/t/"]');
    const results: { title: string; lastMessage: string; isUnread: boolean; index: number }[] = [];

    rows.forEach((row, i) => {
      const el = row as HTMLElement;
      const text = el.innerText || '';
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return;

      const hasUnread = el.querySelector('[aria-label*="unread" i], [class*="unread"]') !== null
        || window.getComputedStyle(el).fontWeight === '700'
        || el.innerHTML.includes('font-weight: 700')
        || el.innerHTML.includes('font-weight:700');

      if (hasUnread || lines.length >= 2) {
        results.push({
          title: lines[0]?.trim() || '',
          lastMessage: lines[lines.length - 1]?.trim() || '',
          isUnread: hasUnread,
          index: i,
        });
      }
    });

    return results.filter(r => r.isUnread);
  });
}

async function handleReply(
  page: Page,
  listing: { id: string; title: string; url: string; product_name: string | null },
  conv: InboxConv,
) {
  const l = getListing(listing.id);
  if (!l) return;

  log(`${yellow('reply')} from seller on "${listing.title.slice(0, 40)}": "${conv.lastMessage.slice(0, 60)}"`);

  addMessage(listing.id, 'seller', conv.lastMessage);

  const conversation = getConversation(listing.id);
  const response = await draftResponse(l, conversation);
  if (!response) {
    log(`${red('×')} draft response failed for ${listing.id}`);
    return;
  }

  log(`${cyan('respond')} "${response.message.slice(0, 60)}" (continue: ${response.should_continue})`);

  // Navigate to the conversation and send the response
  // Click the conversation row in the inbox
  const rows = page.locator('[role="row"], a[href*="/marketplace/t/"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText().catch(() => '');
    if (text.includes(conv.title.slice(0, 20))) {
      await row.click();
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Find the message composer and type the response
  const composer = page.locator('[contenteditable="true"][role="textbox"]').last();
  try {
    await composer.waitFor({ state: 'visible', timeout: 5000 });
    await composer.click();
    await composer.fill(response.message);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    addMessage(listing.id, 'buyer', response.message);
    db.prepare('UPDATE listings SET last_message=? WHERE id=?').run(response.message, listing.id);
    log(`${green('✓')} responded to ${dim(listing.title.slice(0, 40))}`);

    if (!response.should_continue) {
      db.prepare('UPDATE listings SET deploy_status=? WHERE id=?').run('done', listing.id);
      log(`${dim('conversation ended for')} ${listing.id}`);
    }
  } catch (e: any) {
    log(`${red('×')} send response failed: ${e.message}`);
  }
}
