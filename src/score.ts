import { getUnscored, updateScore } from './db';
import { scoreListing } from './llm';
import { log } from './lib';
import { colorScore, dim, gold, gray, red } from './ui';

export async function scoreUnscored(opts: { limit?: number; concurrency?: number } = {}) {
  const limit = opts.limit ?? 30;
  const concurrency = opts.concurrency ?? 3;
  const pending = getUnscored(limit);
  if (!pending.length) {
    log(gray('nothing to score'));
    return;
  }
  log(`scoring ${pending.length} listings ${dim(`(concurrency=${concurrency})`)}`);

  let done = 0;
  const queue = [...pending];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const l = queue.shift()!;
          done++;
          const prog = dim(`[${done}/${pending.length}]`);
          try {
            const s = await scoreListing(l);
            if (!s) {
              updateScore(l.id, { score: 0, rationale: 'parse-fail' });
              log(`${prog} ${red('×')} ${l.id} parse fail`);
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
            const ask = l.price_cents != null ? `$${(l.price_cents / 100).toFixed(0)}` : '?';
            const fv = s.fair_value_cents != null ? `$${(s.fair_value_cents / 100).toFixed(0)}` : '?';
            const star = s.score >= 7 ? gold('★') : gray('·');
            log(`${prog} ${star} ${colorScore(s.score)} ${ask}${dim('→')}${fv} ${dim(s.brand + ' ·')} ${s.product_name || l.title.slice(0, 50)}`);
          } catch (e: any) {
            log(`${prog} ${red('×')} ${l.id} ${e.message}`);
          }
        }
      })()
    );
  }
  await Promise.all(workers);
}
