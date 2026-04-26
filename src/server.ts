import { db, getListing, topCandidates } from './db';
import { draftOutreach } from './llm';
import { reachOut } from './outreach';
import { searchListings } from './search';
import { scoreUnscored } from './score';
import { log } from './lib';
import { cyan, green, red, dim } from './ui';

let server: ReturnType<typeof Bun.serve> | null = null;
const activeJobs = new Map<string, { status: string; offer_cents: number | null; message: string | null; error: string | null }>();

function getDeployStatus(id: string) {
  const job = activeJobs.get(id);
  if (job) return job;
  const l = getListing(id);
  if (!l) return null;
  if (l.messaged_at) return { status: 'sent', offer_cents: l.offer_cents, message: l.last_message, error: null };
  if (l.deploy_status === 'failed') return { status: 'failed', offer_cents: null, message: null, error: 'outreach failed' };
  return null;
}

async function deployAgent(id: string) {
  const existing = activeJobs.get(id);
  if (existing && existing.status !== 'failed') return;
  activeJobs.delete(id);
  const l = getListing(id);
  if (!l || l.messaged_at) return;
  db.prepare('UPDATE listings SET deploy_status=NULL WHERE id=?').run(id);

  activeJobs.set(id, { status: 'drafting', offer_cents: null, message: null, error: null });
  db.prepare('UPDATE listings SET deploy_status=? WHERE id=?').run('drafting', id);
  log(`${cyan('deploy')} ${dim(id)} drafting...`);

  try {
    const draft = await draftOutreach(l);
    if (!draft) throw new Error('draft failed');

    activeJobs.set(id, { status: 'sending', offer_cents: draft.offer_cents, message: draft.message, error: null });
    db.prepare('UPDATE listings SET deploy_status=?, offer_cents=? WHERE id=?').run('sending', draft.offer_cents, id);
    log(`${cyan('deploy')} ${dim(id)} sending "${ draft.message.slice(0, 60)}"`);

    await reachOut(id, { message: draft.message, dryRun: false });

    activeJobs.set(id, { status: 'sent', offer_cents: draft.offer_cents, message: draft.message, error: null });
    db.prepare('UPDATE listings SET deploy_status=? WHERE id=?').run('sent', id);
    log(`${green('✓')} ${dim(id)} sent`);
  } catch (e: any) {
    activeJobs.set(id, { status: 'failed', offer_cents: null, message: null, error: e.message });
    db.prepare('UPDATE listings SET deploy_status=? WHERE id=?').run('failed', id);
    log(`${red('×')} ${dim(id)} ${e.message}`);
  }
}

let searching = false;
async function runSearch(query: string) {
  if (searching) return;
  searching = true;
  log(`${cyan('search')} "${query}"`);
  try {
    await searchListings(query, { scrolls: 4, headless: true });
    await scoreUnscored({ limit: 30, concurrency: 3 });
    log(`${green('✓')} search done: "${query}"`);
  } catch (e: any) {
    log(`${red('×')} search: ${e.message}`);
  } finally {
    searching = false;
  }
}

export function startServer(html: string, port = 8788): string {
  const url = `http://localhost:${port}`;
  server = Bun.serve({
    port,
    async fetch(req) {
      const u = new URL(req.url);

      if (u.pathname === '/' || u.pathname === '/index.html') {
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }

      if (u.pathname === '/api/status') {
        const all: Record<string, any> = {};
        for (const [id, job] of activeJobs) all[id] = job;
        const rows = db.prepare(
          `SELECT id, deploy_status, offer_cents, messaged_at, last_message
           FROM listings WHERE deploy_status IS NOT NULL OR messaged_at IS NOT NULL`
        ).all() as any[];
        for (const r of rows) {
          if (!all[r.id]) {
            all[r.id] = {
              status: r.messaged_at ? 'sent' : (r.deploy_status || 'idle'),
              offer_cents: r.offer_cents,
              message: r.last_message,
              error: null,
            };
          }
        }
        return Response.json(all);
      }

      if (u.pathname.startsWith('/api/deploy/') && req.method === 'POST') {
        const id = u.pathname.slice('/api/deploy/'.length);
        deployAgent(id);
        return Response.json({ ok: true, id });
      }

      if (u.pathname === '/api/search' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const query = body?.query?.trim();
        if (!query) return Response.json({ error: 'query required' }, { status: 400 });
        runSearch(query);
        return Response.json({ ok: true, query });
      }

      if (u.pathname === '/api/candidates') {
        const min = parseInt(u.searchParams.get('min') || '6');
        const rows = topCandidates({ minScore: min, limit: 200, includeMessaged: true });
        return Response.json(rows);
      }

      return new Response('not found', { status: 404 });
    },
  });
  log(`server at ${cyan(url)}`);
  return url;
}

export function stopServer() {
  server?.stop();
  server = null;
}
