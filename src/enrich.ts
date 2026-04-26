import { anthropic } from './llm';
import { db, setProductName, getProduct, upsertProduct, type Listing } from './db';
import { log } from './lib';
import { cyan, dim, green, gray, red } from './ui';

export type BrandInfo = { brand: string; image_b64: string | null; count: number; products: string[]; brand_url?: string | null };

const BRAND_MAP: Record<string, string> = {
  'herman miller': 'Herman Miller', 'steelcase': 'Steelcase', 'knoll': 'Knoll',
  'eames': 'Eames', 'prada': 'Prada', 'cartier': 'Cartier', 'oakley': 'Oakley',
  'persol': 'Persol', 'celine': 'Celine', 'tom ford': 'Tom Ford', 'gucci': 'Gucci',
  'louis vuitton': 'Louis Vuitton', 'balenciaga': 'Balenciaga', 'escada': 'Escada',
  'nike': 'Nike', 'jordan': 'Jordan', 'new balance': 'New Balance',
  'milwaukee': 'Milwaukee', 'dewalt': 'DeWalt', 'makita': 'Makita', 'apple': 'Apple',
  'chanel': 'Chanel', 'ray-ban': 'Ray-Ban', 'rayban': 'Ray-Ban', 'yeezy': 'Yeezy',
};

const BRAND_DOMAINS: Record<string, string> = {
  'Herman Miller': 'hermanmiller.com', 'Steelcase': 'steelcase.com', 'Knoll': 'knoll.com',
  'Eames': 'hermanmiller.com', 'Prada': 'prada.com', 'Cartier': 'cartier.com',
  'Oakley': 'oakley.com', 'Persol': 'persol.com', 'Celine': 'celine.com',
  'Tom Ford': 'tomford.com', 'Gucci': 'gucci.com', 'Louis Vuitton': 'louisvuitton.com',
  'Balenciaga': 'balenciaga.com', 'Escada': 'escada.com',
  'Nike': 'nike.com', 'Jordan': 'nike.com', 'New Balance': 'newbalance.com',
  'Milwaukee': 'milwaukeetool.com', 'DeWalt': 'dewalt.com', 'Makita': 'makita.com',
  'Apple': 'apple.com', 'Chanel': 'chanel.com', 'Ray-Ban': 'ray-ban.com', 'Yeezy': 'yeezy.com',
  'NVIDIA': 'nvidia.com', 'Nvidia': 'nvidia.com', 'Sony': 'sony.com', 'Canon': 'canon.com',
  'Fujifilm': 'fujifilm.com', 'Bose': 'bose.com', 'Sonos': 'sonos.com', 'Dyson': 'dyson.com',
  'Salomon': 'salomon.com', 'Hoka': 'hoka.com', 'Adidas': 'adidas.com', 'Asics': 'asics.com',
  'Pokemon': 'pokemon.com', 'The Pokémon Company': 'pokemon.com', 'LEGO': 'lego.com',
  'Roomba': 'irobot.com', 'iRobot': 'irobot.com', 'Vitamix': 'vitamix.com',
  'Specialized': 'specialized.com', 'Trek': 'trekbikes.com', 'Brompton': 'brompton.com',
  'Festool': 'festool.com', 'Hilti': 'hilti.com', 'Snap-on': 'snapon.com',
  'Moncler': 'moncler.com', 'Canada Goose': 'canadagoose.com', 'Stone Island': 'stoneisland.com',
  'Arc\'teryx': 'arcteryx.com', 'Patagonia': 'patagonia.com', 'Yeti': 'yeti.com',
  'Garmin': 'garmin.com', 'Osprey': 'osprey.com',
  'Hermes': 'hermes.com', 'Hermès': 'hermes.com', 'Dior': 'dior.com', 'Versace': 'versace.com',
  'Burberry': 'burberry.com', 'Miu Miu': 'miumiu.com', 'Chloé': 'chloe.com',
  'Tag Heuer': 'tagheuer.com', 'TAG Heuer': 'tagheuer.com', 'Omega': 'omegawatches.com',
  'Rolex': 'rolex.com', 'Swarovski': 'swarovski.com',
  'Nintendo': 'nintendo.com', 'Valve': 'steampowered.com',
  'On': 'on.com', 'On Running': 'on.com',
  'Furniture': 'westelm.com',
};

export function extractBrand(productName: string): string {
  const lower = productName.toLowerCase();
  for (const [key, brand] of Object.entries(BRAND_MAP)) {
    if (lower.startsWith(key)) return brand;
  }
  if (/chair|table|desk|sofa|bench|cabinet|shelf|dresser|hutch/i.test(productName)) return 'Furniture';
  return 'Other';
}

export async function enrichProducts(listings: Listing[]): Promise<Map<string, BrandInfo>> {
  await identifyProducts(listings);

  const freshListings = db.prepare(
    'SELECT * FROM listings WHERE id IN (' + listings.map(() => '?').join(',') + ')'
  ).all(...listings.map(l => l.id)) as Listing[];

  const brands = new Map<string, BrandInfo>();
  for (const l of freshListings) {
    const name = l.product_name || 'Other';
    const brand = (l as any).brand || extractBrand(name);
    const existing = brands.get(brand);
    if (existing) {
      existing.count++;
      if (!existing.products.includes(name)) existing.products.push(name);
      if (!existing.brand_url && (l as any).brand_url) existing.brand_url = (l as any).brand_url;
    } else {
      const cached = getProduct(brand);
      brands.set(brand, {
        brand,
        image_b64: cached?.image_b64 ?? null,
        count: 1,
        products: [name],
        brand_url: (l as any).brand_url ?? null,
      });
    }
  }

  // update listing objects for the report
  for (const l of listings) {
    const fresh = freshListings.find(f => f.id === l.id);
    if (fresh) l.product_name = fresh.product_name;
  }

  await fetchMissingBrandImages(brands);
  return brands;
}

async function identifyProducts(listings: Listing[]) {
  const needsId = listings.filter(l => !l.product_name && l.score != null);
  if (!needsId.length) return;

  log(`identifying ${cyan(String(needsId.length))} products...`);

  const batches: Listing[][] = [];
  for (let i = 0; i < needsId.length; i += 25) batches.push(needsId.slice(i, i + 25));

  for (const chunk of batches) {
    const prompt = chunk.map((l, i) => `${i + 1}. "${l.title}" (${l.rationale?.slice(0, 80) || ''})`).join('\n');
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: `extract canonical product names. output JSON array: [{"n":1,"product":"Brand Model"}]. examples: "Herman Miller Aeron", "Eames DSW", "Prada SPR 17W". generic items: "Mid-Century Dining Chair". raw json only.`,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const start = text.indexOf('['), end = text.lastIndexOf(']');
      if (start === -1 || end === -1) continue;
      const items = JSON.parse(text.slice(start, end + 1)) as { n: number; product: string }[];
      for (const item of items) {
        const listing = chunk[item.n - 1];
        if (listing && item.product) {
          setProductName(listing.id, item.product);
          listing.product_name = item.product;
        }
      }
      log(`  ${green('✓')} identified ${items.length}`);
    } catch (e: any) {
      log(`  ${red('×')} ${e.message}`);
    }
  }
}

async function fetchMissingBrandImages(brands: Map<string, BrandInfo>) {
  const missing = [...brands.entries()].filter(([, b]) => !b.image_b64 && b.brand !== 'Other');
  if (!missing.length) return;

  log(`fetching ${cyan(String(missing.length))} brand favicons...`);

  const queue = [...missing];
  const workers = Array(Math.min(5, queue.length)).fill(null).map(async () => {
    while (queue.length) {
      const [, info] = queue.shift()!;
      try {
        const b64 = await fetchFavicon(info.brand, info.brand_url);
        if (b64) {
          upsertProduct(info.brand, b64);
          info.image_b64 = b64;
          log(`  ${green('✓')} ${dim(info.brand)}`);
        } else {
          log(`  ${red('×')} ${dim(info.brand)}`);
        }
      } catch (e: any) {
        log(`  ${red('×')} ${dim(info.brand)}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
}

async function fetchFavicon(brand: string, brandUrlOverride?: string | null): Promise<string | null> {
  // prefer brand_url from Claude's score, fall back to hardcoded map
  const domain = brandUrlOverride?.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    || BRAND_DOMAINS[brand];
  if (!domain) return null;
  const url = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    return buf.toString('base64');
  } catch {
    return null;
  }
}
