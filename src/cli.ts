#!/usr/bin/env bun
import { withBrowser, isLoggedIn, log } from './lib';
import { searchListings, huntParallel } from './search';
import { scoreUnscored } from './score';
import { reachOut } from './outreach';
import { topCandidates, db, getListing, type Listing } from './db';
import { syncFromChrome, summarize, findActiveChromeProfile } from './session';
import { generateHTML } from './report';
import { enrichProducts } from './enrich';
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

const PRESETS: Record<string, string[]> = {
  furniture: [
    // herman miller — the king of office arb
    'herman miller aeron', 'herman miller embody', 'herman miller mirra',
    'herman miller sayl', 'herman miller cosm', 'herman miller celle',
    'herman miller eames', 'herman miller noguchi',
    // steelcase + knoll
    'steelcase leap', 'steelcase gesture', 'steelcase think',
    'knoll generation', 'knoll chadwick', 'knoll womb chair',
    'humanscale freedom', 'humanscale liberty',
    // mid-century (high margin, sellers rarely know value)
    'eames lounge chair', 'eames shell chair', 'eames DSW', 'eames DCW',
    'saarinen tulip table', 'saarinen womb', 'noguchi coffee table',
    'barcelona chair', 'wassily chair', 'nelson bench',
    'danish modern furniture', 'teak credenza', 'mcm sideboard',
  ],
  luxury: [
    // eyewear (huge info asymmetry)
    'cartier sunglasses', 'cartier glasses', 'cartier buffalo horn',
    'chrome hearts glasses', 'jacques marie mage',
    'chanel sunglasses', 'dior sunglasses', 'tom ford sunglasses',
    'persol sunglasses', 'prada sunglasses',
    // bags (highest absolute margins)
    'louis vuitton bag', 'louis vuitton neverfull', 'louis vuitton speedy',
    'chanel flap bag', 'chanel classic', 'hermes bag', 'hermes birkin',
    'goyard bag', 'bottega veneta bag', 'celine bag',
    // clothing (high margin per piece)
    'moncler jacket', 'canada goose jacket', 'stone island jacket',
    'acne studios', 'rick owens', 'chrome hearts jewelry',
  ],
  watches: [
    'rolex submariner', 'rolex datejust', 'rolex daytona', 'rolex gmt',
    'omega seamaster', 'omega speedmaster', 'omega aqua terra',
    'tudor black bay', 'tudor pelagos',
    'cartier santos', 'cartier tank',
    'breitling navitimer', 'breitling superocean',
    'iwc pilot', 'panerai luminor',
    'grand seiko', 'seiko presage', 'tag heuer carrera',
  ],
  audio: [
    // high-end audio (margins 40-60%, sellers don't know secondary market)
    'mcintosh amplifier', 'mcintosh receiver',
    'bowers wilkins speakers', 'b&w speakers',
    'kef ls50', 'kef r series',
    'focal speakers', 'focal utopia',
    'mark levinson', 'classe audio',
    'sonos arc', 'sonos era 300',
    'bang olufsen', 'devialet phantom',
  ],
  cameras: [
    // lenses hold value better than bodies
    'sony gm lens', 'sony 24-70 gm', 'sony 70-200 gm',
    'canon l lens', 'canon rf lens',
    'leica lens', 'leica m', 'leica q',
    'hasselblad', 'fujifilm gfx',
    'nikon z lens', 'sigma art lens',
  ],
  tools: [
    // premium tools (snap-on alone is a $1B+ resale market)
    'snap on tool box', 'snap on wrench', 'snap on ratchet',
    'festool track saw', 'festool sander', 'festool dust extractor',
    'lie nielsen plane', 'veritas plane',
    'hilti drill', 'hilti laser',
    'milwaukee m18 fuel', 'milwaukee packout',
  ],
};

function expandPreset(input: string): string[] {
  const key = (input || '').toLowerCase().trim();
  if (!key || key === 'all') return Object.values(PRESETS).flat();
  if (PRESETS[key]) return PRESETS[key];
  return [input];
}

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
    ${cyan('arb auto')} ${dim('[preset|query] [--show]')}   hunt + score + list candidates ${dim('(default: all)')}
    ${cyan('arb score')} ${dim('[--min=N] [--limit=N]')}    score unscored + show candidates
    ${cyan('arb hunt')} ${dim('<query> [--scrolls=N]')}     scrape only (no scoring)

${bold('  act')}
    ${cyan('arb reach')} ${dim('<n|id> [--dry] [--yes]')}   send opening message
    ${cyan('arb viz')} ${dim('[--min=N]')}                  photo grid report in browser

    ${dim('presets: furniture · luxury · watches · audio · cameras · tools · all')}
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
      const min = parseInt(flag('min', '6')!, 10);
      const rows = topCandidates({ minScore: min, limit: 500, includeMessaged: true });
      if (!rows.length) return console.log(gray(`no candidates >= ${min}. run arb auto first.`));
      console.log(rule('enrich products', cyan));
      const products = await enrichProducts(rows);
      const html = generateHTML(rows, products);
      const url = startServer(html);
      execSync(`open ${url}`);
      log(`${bold(String(rows.length))} candidates, ${bold(String(products.size))} brands — ctrl+c to stop`);
      await new Promise(() => {});
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
      const raw = positional.join(' ') || 'all';
      const queries = expandPreset(raw);
      const min = parseInt(flag('min', '6')!, 10);
      const scrolls = parseInt(flag('scrolls', '6')!, 10);
      const show = flag('show') === 'true';

      // start live dashboard
      const initialCandidates = topCandidates({ minScore: min, limit: 200, includeMessaged: true });
      const brands = await enrichProducts(initialCandidates).catch(() => new Map());
      const html = generateHTML(initialCandidates, brands);
      const url = startServer(html);
      execSync(`open ${url}`);

      // run hunt + score concurrently: score starts as soon as first listings land
      let huntDone = false;
      const huntPromise = (async () => {
        console.log(rule(`hunt ${gold(String(queries.length))} queries`, cyan));
        if (queries.length > 1) {
          await huntParallel(queries, { scrolls, headless: !show });
        } else {
          await searchListings(queries[0], { scrolls, headless: !show });
        }
        huntDone = true;
        log('hunt complete');
      })();

      const scorePromise = (async () => {
        // wait a few seconds for first listings to land, then score continuously
        await new Promise((r) => setTimeout(r, 8000));
        while (!huntDone || (db.prepare('SELECT COUNT(*) c FROM listings WHERE score IS NULL').get() as any).c > 0) {
          await scoreUnscored({ limit: 20 });
          if (!huntDone) await new Promise((r) => setTimeout(r, 5000));
        }
        log('scoring complete');
      })();

      await Promise.all([huntPromise, scorePromise]);

      const candidates = topCandidates({ minScore: min, limit: 30 });
      console.log(rule(`candidates  (score ≥ ${min})`, cyan));
      printCandidateList(candidates, min);
      log(`dashboard still live at ${cyan(url)} — ctrl+c to stop`);
      // keep server alive until user kills the process
      await new Promise(() => {});
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
