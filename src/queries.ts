import { anthropic } from './llm';
import { db } from './db';
import { log } from './lib';
import { cyan, dim, gold, green } from './ui';

function getContext(): string {
  const topBrands = db.prepare(`
    SELECT brand, category, AVG(score) as avg_score, COUNT(*) as cnt,
           AVG(CASE WHEN fair_value_cents > 0 AND price_cents > 0
               THEN (fair_value_cents - price_cents) * 1.0 / fair_value_cents ELSE 0 END) as avg_margin
    FROM listings WHERE score >= 6 AND brand IS NOT NULL
    GROUP BY brand ORDER BY avg_score DESC LIMIT 30
  `).all() as any[];

  const categories = db.prepare(`
    SELECT category, COUNT(*) as cnt, AVG(score) as avg
    FROM listings WHERE score IS NOT NULL AND category IS NOT NULL
    GROUP BY category ORDER BY avg DESC
  `).all() as any[];

  const existing = db.prepare(`SELECT DISTINCT title FROM listings LIMIT 500`).all() as any[];

  let ctx = '';
  if (topBrands.length) {
    ctx += 'brands scoring well so far:\n';
    for (const b of topBrands) {
      ctx += `  ${b.brand} (${b.category}) avg_score=${b.avg_score?.toFixed(1)} margin=${(b.avg_margin * 100)?.toFixed(0)}% count=${b.cnt}\n`;
    }
  }
  if (categories.length) {
    ctx += '\ncategory breakdown:\n';
    for (const c of categories) ctx += `  ${c.category}: ${c.cnt} listings, avg ${c.avg?.toFixed(1)}\n`;
  }
  ctx += `\ntotal listings in db: ${existing.length}`;
  return ctx;
}

export async function generateQueries(opts: {
  focus?: string;
  count?: number;
  location?: string;
}): Promise<string[]> {
  const count = opts.count ?? 100;
  const location = opts.location ?? process.env.ARB_LOCATION ?? 'SF Bay Area';
  const context = getContext();

  const system = `you generate facebook marketplace search queries for an arbitrage bot.
the bot finds underpriced items from people who don't know what they have, then resells at fair market.

the BEST categories for marketplace arbitrage (in order of margin × volume × identifiability):
1. premium office furniture (herman miller, steelcase, knoll, humanscale) — office liquidations, people don't know aeron is $1400 new
2. mid-century modern (eames, knoll, saarinen, danish modern) — inherited, value unknown
3. luxury eyewear (cartier, chrome hearts, JMM) — huge info gap
4. watches (rolex, omega, tudor, cartier) — fat spreads
5. designer bags (LV, chanel, hermes, goyard) — highest absolute margins
6. high-end audio (mcintosh, B&W, kef, focal) — 40-60% margins, niche
7. camera lenses (sony GM, canon L, leica) — hold value, sellers don't check comps
8. premium tools (snap-on, festool, lie-nielsen) — own resale economy

for each brand, generate SPECIFIC search queries:
- include model names, sizes, variants (not just "herman miller" but "herman miller aeron size b", "herman miller embody gaming")
- go deep on brands that are scoring well (see context below)
- skip brands/categories that are saturated or low-margin in the context
- each query should be something a real person would type into FB marketplace search

output: one query per line, nothing else. no numbers, no bullets, no explanations.`;

  const user = `generate ${count} facebook marketplace search queries for ${location}.
${opts.focus ? `focus on: ${opts.focus}` : 'cover all high-margin categories.'}
go DEEP on each brand — specific models, sizes, variants, colorways.

${context ? 'here is what the bot has found so far (use this to decide where to go deeper):\n' + context : '(first run, no data yet)'}`;

  log(`generating ${gold(String(count))} queries${opts.focus ? ` (focus: ${cyan(opts.focus)})` : ''}...`);

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  const queries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !l.startsWith('#') && !l.startsWith('-') && !l.match(/^\d+\./));

  log(`${green(String(queries.length))} queries generated`);
  return queries;
}
