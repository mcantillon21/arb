#!/usr/bin/env bun
import { withBrowser, isLoggedIn, log } from './lib';
import { searchListings, huntParallel } from './search';
import { scoreUnscored } from './score';
import { reachOut } from './outreach';
import { topCandidates, db, getListing, type Listing } from './db';
import { syncFromChrome, summarize, findActiveChromeProfile } from './session';
import { startServer, stopServer } from './server';
import { execSync } from 'node:child_process';
import {
  banner, bold, colorScore, colorSpread, confirm,
  cyan, dim, gold, gray, green, red, rule, yellow,
} from './ui';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib';

const fmt$ = (c: number | null) => (c != null ? `$${(c / 100).toFixed(0)}` : '?');
const LAST_TOP = path.join(ROOT, '.last-top.json');

import { generateQueries } from './queries';

function printCandidate(l: Listing, n?: number) {
  const spreadCents =
    l.fair_value_cents != null && l.price_cents != null
      ? l.fair_value_cents - l.price_cents : null;
  const num = n != null ? bold(`[${n}] `) : '';
  const star = (l.score ?? 0) >= 7 ? gold('★') : dim('·');
  const conf = l.confidence != null ? gray(` ${l.confidence.toFixed(2)}`) : '';
  const loc = l.location ? gray(` · ${l.location}`) : '';
  console.log();
  console.log(`${num}${star} ${colorScore(l.score)}${conf}  ${bold(l.title)}`);
  console.log(
    `   ${fmt$(l.price_cents)} ${dim('→')} ${fmt$(l.fair_value_cents)}   ` +
    `spread ${colorSpread(spreadCents)}   walk ${cyan(fmt$(l.walk_price_cents))}${loc}`
  );
  console.log(`   ${dim(l.url)}`);
  console.log(`   ${gray((l.rationale ?? '').slice(0, 240))}`);
  if (n != null) console.log(`   ${dim('arb reach ' + n)}`);
}

function printCandidateList(rows: Listing[], minScore: number) {
  if (!rows.length) return console.log(gray(`(no candidates score >= ${minScore})`));
  rows.forEach((l, i) => printCandidate(l, i + 1));
  writeFileSync(LAST_TOP, JSON.stringify(rows.map((r) => r.id)));
  console.log();
  console.log(rule(`${rows.length} candidate${rows.length === 1 ? '' : 's'}`));
  console.log(dim(`  arb reach <n>          send opening message`));
  console.log(dim(`  arb reach <n> --dry    draft only`));
  console.log(dim(`  arb viz                photo grid in browser`));
}

function resolveListingId(input: string): string | null {
  if (/^\d{1,3}$/.test(input) && existsSync(LAST_TOP)) {
    const ids = JSON.parse(readFileSync(LAST_TOP, 'utf8')) as string[];
    const idx = parseInt(input, 10) - 1;
    if (idx >= 0 && idx < ids.length) return ids[idx];
  }
  return input;
}

const [, , cmd, ...rest] = process.argv;
const flag = (name: string, def?: string) => {
  const f = rest.find((a) => a.startsWith(`--${name}=`));
  if (f) return f.split('=')[1];
  if (rest.includes(`--${name}`)) return 'true';
  return def;
};
const positional = rest.filter((a) => !a.startsWith('--'));

function usage() {
  banner();
  console.log(`
${bold('  setup')}
    ${cyan('arb sync-session')} ${dim('[--profile=N]')}     pull facebook cookies from chrome
    ${cyan('arb whoami')}                       verify session

${bold('  recon')}
    ${cyan('arb auto')} ${dim('[focus] [--n=100] [--show]')}  LLM generates queries, hunts, scores, shows viz
    ${cyan('arb score')} ${dim('[--min=N] [--limit=N]')}     score unscored + show candidates
    ${cyan('arb hunt')} ${dim('<query> [--scrolls=N]')}      scrape one query (no scoring)

${bold('  act')}
    ${cyan('arb reach')} ${dim('<n|id> [--dry] [--yes]')}    send opening message
    ${cyan('arb viz')} ${dim('[--min=N]')}                   photo grid report in browser

    ${dim('examples: arb auto                  (LLM picks best queries)')}
    ${dim('          arb auto "watches"         (focused on watches)')}
    ${dim('          arb auto --n=200           (200 queries)')}
`);
  process.exit(0);
}

function getStats() {
  return db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM listings) as listings,
       (SELECT COUNT(*) FROM listings WHERE score IS NOT NULL) as scored,
       (SELECT COUNT(*) FROM listings WHERE score >= 7) as gems,
       (SELECT COUNT(*) FROM listings WHERE messaged_at IS NOT NULL) as messaged`
  ).get() as any;
}

async function dashboard() {
  banner();
  const c = getStats();
  const session = summarize();
  console.log();
  console.log(`  ${dim('listings')} ${bold(String(c.listings))}    ${dim('scored')} ${bold(String(c.scored))}    ${dim('gems')} ${gold(String(c.gems))}    ${dim('messaged')} ${cyan(String(c.messaged))}`);
  console.log(`  ${dim('session')} ${session ? green('✓ synced') : red('✗ run arb sync-session')}`);
  if (c.gems > 0) {
    console.log();
    console.log(rule('top gems'));
    printCandidateList(topCandidates({ minScore: 7, limit: 5 }), 7);
  } else {
    console.log();
    if (!session) console.log(`  ${dim('next:')} ${cyan('arb sync-session')}`);
    console.log(`  ${dim('next:')} ${cyan('arb auto')}`);
  }
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();

  switch (cmd) {
    case 'sync-session': {
      const profile = flag('profile') || findActiveChromeProfile();
      log(`chrome profile: ${cyan(profile)}`);
      const cookies = syncFromChrome(profile);
      const sess = cookies.find((c) => c.name === 'xs');
      const uid = cookies.find((c) => c.name === 'c_user');
      console.log(`  ${bold(String(cookies.length))} cookies`);
      console.log(sess && uid
        ? `  ${green('✓')} c_user=${dim(uid.value)}`
        : `  ${red('!')} c_user or xs missing`);
      break;
    }

    case 'whoami': {
      const s = summarize();
      if (!s) return console.log(`  ${red('✗')} no session. run ${cyan('arb sync-session')}`);
      console.log(`  cookies: ${bold(String(s.total))}  session: ${dim(s.key_session_cookies.join(', '))}`);
      log('verifying...');
      await withBrowser(async (_ctx, page) => {
        console.log((await isLoggedIn(page))
          ? `  ${green('✓ logged in')}`
          : `  ${red('✗ not logged in')} re-run sync-session`);
      });
      break;
    }

    case 'hunt': {
      const query = positional.join(' ');
      if (!query) return console.error(red('usage: arb hunt <query>'));
      console.log(rule(`hunt "${query}"`, cyan));
      await searchListings(query, { scrolls: parseInt(flag('scrolls', '6')!, 10) });
      console.log(dim('next:') + ` ${cyan('arb score')}`);
      break;
    }

    case 'score': {
      const min = parseInt(flag('min', '6')!, 10);
      const limit = parseInt(flag('limit', '30')!, 10);
      console.log(rule('score', cyan));
      await scoreUnscored({ limit });
      console.log(rule(`candidates  (score ≥ ${min})`, cyan));
      printCandidateList(topCandidates({ minScore: min, limit: 30 }), min);
      break;
    }

    case 'view':
    case 'viz': {
      try { execSync('lsof -ti:8788 | xargs kill -9 2>/dev/null'); } catch {}
      await new Promise((r) => setTimeout(r, 500));
      const url = startServer();
      execSync(`open ${url}`);
      log(`viz live at ${cyan(url)} — ctrl+c to stop`);
      await new Promise(() => {});
      break;
    }

    case 'reach': {
      const inp = positional[0];
      if (!inp) return console.error(red('usage: arb reach <n|id>'));
      const id = resolveListingId(inp);
      if (!id) return console.error(red(`could not resolve "${inp}"`));
      const dry = flag('dry') === 'true';
      const yes = flag('yes') === 'true';
      const l = getListing(id);
      if (!l) return console.error(red(`unknown listing ${id}`));
      console.log(rule(`reach #${inp}`, cyan));
      printCandidate(l);
      if (dry) console.log(dim('\n  --dry: draft only'));
      if (!yes && !dry) {
        const ok = await confirm(`\n  send opening message?`, false);
        if (!ok) return console.log(yellow('  aborted'));
      }
      await reachOut(id, { dryRun: dry, headless: false });
      break;
    }

    case 'auto': {
      const min = parseInt(flag('min', '6')!, 10);
      const scrolls = parseInt(flag('scrolls', '6')!, 10);
      const show = flag('show') === 'true';

      const queries = [
        // furniture — broad brand searches
        'herman miller', 'herman miller chair', 'eames chair', 'eames lounge',
        'steelcase chair', 'knoll furniture', 'knoll chair',
        'danish modern', 'mid century modern furniture', 'teak credenza',
        // watches — brand level
        'audemars piguet', 'patek philippe', 'vacheron constantin',
        'rolex', 'rolex watch', 'omega watch', 'tudor watch',
        'cartier watch', 'breitling', 'jaeger lecoultre', 'panerai',
        // audio — brand level
        'devialet', 'mcintosh audio', 'mark levinson',
        'bowers wilkins', 'kef speakers', 'focal speakers',
        'bang olufsen', 'naim audio',
        // eyewear — brand level
        'cartier glasses', 'cartier sunglasses', 'chrome hearts glasses',
        'jacques marie mage', 'chanel sunglasses',
        // bags — brand level
        'hermes bag', 'hermes', 'chanel bag', 'louis vuitton',
        'goyard', 'bottega veneta', 'the row bag',
        // cameras
        'leica camera', 'leica lens', 'hasselblad',
        // designer
        'loro piana', 'moncler', 'stone island', 'rick owens',
      ];

      // verify session before wasting time
      const s = summarize();
      if (!s || !s.key_session_cookies.includes('xs')) {
        console.log(red('not logged in. run arb sync-session first.'));
        break;
      }

      // kill any existing server, start fresh dashboard immediately
      try { execSync('lsof -ti:8788 | xargs kill -9 2>/dev/null'); } catch {}
      await new Promise((r) => setTimeout(r, 500));
      const url = startServer();
      // wait until there's real data before opening the dashboard
      (async () => {
        while (true) {
          await new Promise((r) => setTimeout(r, 5000));
          const brands = db.prepare(
            `SELECT COUNT(DISTINCT brand) as n FROM listings WHERE score >= 6 AND brand IS NOT NULL`
          ).get() as any;
          if (brands.n >= 2) {
            try { execSync(`open ${url}`); } catch {}
            break;
          }
        }
      })();

      // hunt + score concurrently, browser VISIBLE, dashboard updates in real time
      let huntDone = false;
      const huntPromise = (async () => {
        console.log(rule(`hunt ${gold(String(queries.length))} queries`, cyan));
        await huntParallel(queries, { scrolls, headless: false });
        huntDone = true;
        log('hunt complete');
      })();

      const scorePromise = (async () => {
        await new Promise((r) => setTimeout(r, 8000));
        while (!huntDone || (db.prepare('SELECT COUNT(*) c FROM listings WHERE score IS NULL').get() as any).c > 0) {
          await scoreUnscored({ limit: 20 });
          if (!huntDone) await new Promise((r) => setTimeout(r, 5000));
        }
        log('scoring complete');
      })();

      await Promise.all([huntPromise, scorePromise]);
      log(`done — ${gold(String(topCandidates({ minScore: min, limit: 9999, includeMessaged: true }).length))} candidates at ${cyan(url)}`);
      await new Promise(() => {});
      break;
    }

    default:
      console.error(red(`unknown: ${cmd}`));
      usage();
  }
}

main().catch((e) => {
  console.error(red(String(e?.message ?? e)));
  process.exit(1);
});
