import { getUnscored, updateScore } from './db';
import { scoreListing } from './llm';
import { log } from './lib';
import { gold, dim } from './ui';

export async function scoreUnscored(opts: { limit?: number; concurrency?: number; quiet?: boolean } = {}) {
  const limit = opts.limit ?? 30;
  const concurrency = opts.concurrency ?? 3;
  const quiet = opts.quiet ?? false;
  const pending = getUnscored(limit);
  if (!pending.length) return;
  if (!quiet) log(`scoring ${pending.length} listings`);

  let done = 0;
  let gems = 0;
  const queue = [...pending];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const l = queue.shift()!;
          done++;
          try {
            const s = await scoreListing(l);
            if (!s) {
              updateScore(l.id, { score: 0, rationale: 'parse-fail' });
              continue;
            }
            updateScore(l.id, {
              score: s.score,
              fair_value_cents: s.fair_value_cents,
              walk_price_cents: s.walk_price_cents,
              confidence: s.confidence,
              rationale: s.rationale,
              product_name: s.product_name || null,
              brand: s.brand || null,
              brand_url: s.brand_url || null,
              category: s.category || null,
            });
            if (s.score >= 7) {
              gems++;
              if (!quiet) {
                const ask = l.price_cents != null ? `$${(l.price_cents / 100).toFixed(0)}` : '?';
                const fv = s.fair_value_cents != null ? `$${(s.fair_value_cents / 100).toFixed(0)}` : '?';
                log(`${gold('★')} ${ask}${dim('→')}${fv} ${dim(s.brand + ' ·')} ${s.product_name || l.title.slice(0, 50)}`);
              }
            }
          } catch {}
        }
      })()
    );
  }
  await Promise.all(workers);
  if (!quiet) log(`scored ${done}, ${gold(String(gems))} gems`);
}
