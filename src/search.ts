import { withBrowser, jitter, log } from './lib';
import { upsertListing } from './db';
import { gold, dim, cyan, green } from './ui';
import type { Page } from 'playwright';

export type ScrapedListing = {
  id: string;
  url: string;
  title: string;
  price_cents: number | null;
  location: string | null;
  photo_url: string | null;
};

function buildUrl(query: string, location: string): string {
  return `https://www.facebook.com/marketplace/${location}/search?query=${encodeURIComponent(
    query
  )}&exact=false&sortBy=creation_time_descend`;
}

async function extractFromPage(page: Page): Promise<ScrapedListing[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    const seen = new Set<string>();
    for (const t of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const a = t as HTMLAnchorElement;
      const m = a.href.match(/\/marketplace\/item\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const text = (a.innerText || a.textContent || '').trim();
      const junk = /^(just listed|listed .* ago|pending|sold|free shipping|local pickup|new listing|sponsored|suggested for you)$/i;
      const lines = text.split(/\n+/).map((s) => s.trim()).filter((s) => s && !junk.test(s));

      let price: number | null = null;
      for (const line of lines) {
        const pm = line.match(/^\$([\d,]+)/);
        if (pm) { price = Math.round(parseFloat(pm[1].replace(/,/g, '')) * 100); break; }
        if (/^free$/i.test(line)) { price = 0; break; }
      }

      const title = (
        lines.find(
          (l) => !l.startsWith('$') && !/^\d+\s*(mi|mile|miles|km)/i.test(l) && !/^free$/i.test(l) && l.length > 4
        ) ?? lines[0] ?? ''
      ).replace(/^(just listed|new listing)\s*[-–—:]?\s*/i, '');

      const loc = lines.find((l) => /^[A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}$/.test(l)) ?? null;
      const img = a.querySelector('img') as HTMLImageElement | null;

      out.push({
        id,
        url: `https://www.facebook.com/marketplace/item/${id}`,
        title,
        price_cents: price,
        location: loc,
        photo_url: img?.src ?? null,
      });
    }
    return out;
  });
}

async function dismissOverlays(page: Page) {
  for (const label of ['Allow all cookies', 'Decline optional cookies', 'Not Now', 'Close', 'Dismiss']) {
    try {
      const btn = page.getByRole('button', { name: label, exact: false }).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 1000 });
        await jitter(400, 900);
      }
    } catch {}
  }
}

async function scrollAndScrape(page: Page, scrolls: number): Promise<ScrapedListing[]> {
  await dismissOverlays(page);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 4000);
    await jitter(1200, 2500);
  }
  return extractFromPage(page);
}

// single query, own browser instance
export async function searchListings(
  query: string,
  opts: { location?: string; scrolls?: number; headless?: boolean } = {}
): Promise<ScrapedListing[]> {
  const location = opts.location ?? process.env.ARB_LOCATION ?? 'sf';
  return withBrowser(
    async (_ctx, page) => {
      log(`hunt: ${cyan(query)}`);
      await page.goto(buildUrl(query, location), { waitUntil: 'domcontentloaded' });
      await jitter(2500, 4500);
      const listings = await scrollAndScrape(page, opts.scrolls ?? 4);
      log(`  ${green(String(listings.length))} listings`);
      for (const l of listings) upsertListing(l);
      return listings;
    },
    { headless: opts.headless ?? true }
  );
}

// Worker-pool pattern: K tabs process N queries. As one tab finishes, it picks up the next.
export async function huntParallel(
  queries: string[],
  opts: { location?: string; scrolls?: number; headless?: boolean; concurrency?: number } = {}
): Promise<ScrapedListing[]> {
  const location = opts.location ?? process.env.ARB_LOCATION ?? 'sf';
  const scrolls = opts.scrolls ?? 6;
  const poolSize = Math.min(opts.concurrency ?? 20, queries.length);

  return withBrowser(
    async (ctx, _firstPage) => {
      log(`${gold(String(queries.length))} queries, ${cyan(String(poolSize))} tabs`);

      const queue = [...queries];
      let done = 0;
      const all: ScrapedListing[] = [];

      async function worker(page: Page) {
        while (queue.length) {
          const q = queue.shift()!;
          done++;
          const tag = dim(`[${done}/${queries.length}]`);
          try {
            await page.goto(buildUrl(q, location), { waitUntil: 'domcontentloaded' });
            await jitter(1500, 3000);
            const listings = await scrollAndScrape(page, scrolls);
            for (const l of listings) upsertListing(l);
            all.push(...listings);
            log(`${tag} ${cyan(q)}: ${green(String(listings.length))}`);
          } catch (e: any) {
            log(`${tag} ${cyan(q)}: ${red(e.message)}`);
          }
          await jitter(800, 2000);
        }
      }

      const pages = await Promise.all(
        Array.from({ length: poolSize }, () => ctx.newPage())
      );
      await Promise.all(pages.map((p) => worker(p)));

      log(`total: ${gold(String(all.length))} listings across ${queries.length} queries`);
      return all;
    },
    { headless: opts.headless ?? false }
  );
}
