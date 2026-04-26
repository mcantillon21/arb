import { Database } from 'bun:sqlite';
import path from 'node:path';
import { ROOT } from './lib';

export const db = new Database(path.join(ROOT, 'state.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    price_cents INTEGER,
    location TEXT,
    photo_url TEXT,
    scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
    score INTEGER,
    fair_value_cents INTEGER,
    walk_price_cents INTEGER,
    confidence REAL,
    rationale TEXT,
    messaged_at TEXT,
    last_message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_listings_score ON listings(score DESC);
`);

// migrate older schemas; ALTERs throw if column exists, ignore.
db.exec(`CREATE TABLE IF NOT EXISTS products (
  name TEXT PRIMARY KEY,
  image_b64 TEXT,
  fetched_at TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  ts TEXT DEFAULT CURRENT_TIMESTAMP
)`);

for (const sql of [
  'ALTER TABLE listings ADD COLUMN messaged_at TEXT',
  'ALTER TABLE listings ADD COLUMN last_message TEXT',
  'ALTER TABLE listings ADD COLUMN product_name TEXT',
  'ALTER TABLE listings ADD COLUMN brand TEXT',
  'ALTER TABLE listings ADD COLUMN brand_url TEXT',
  'ALTER TABLE listings ADD COLUMN category TEXT',
  'ALTER TABLE listings ADD COLUMN deploy_status TEXT',
  'ALTER TABLE listings ADD COLUMN offer_cents INTEGER',
  'DROP TABLE IF EXISTS threads',
  'DROP TABLE IF EXISTS deals',
]) {
  try {
    db.exec(sql);
  } catch {}
}

export type Listing = {
  id: string;
  url: string;
  title: string;
  price_cents: number | null;
  location: string | null;
  photo_url: string | null;
  scraped_at: string;
  score: number | null;
  fair_value_cents: number | null;
  walk_price_cents: number | null;
  confidence: number | null;
  rationale: string | null;
  messaged_at: string | null;
  last_message: string | null;
  product_name: string | null;
  deploy_status: string | null;
  offer_cents: number | null;
};

export function upsertListing(l: {
  id: string;
  url: string;
  title: string;
  price_cents?: number | null;
  location?: string | null;
  photo_url?: string | null;
}) {
  db.prepare(
    `INSERT INTO listings (id, url, title, price_cents, location, photo_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       price_cents = COALESCE(excluded.price_cents, listings.price_cents),
       location = COALESCE(excluded.location, listings.location),
       photo_url = COALESCE(excluded.photo_url, listings.photo_url)`
  ).run(l.id, l.url, l.title, l.price_cents ?? null, l.location ?? null, l.photo_url ?? null);
}

export function getUnscored(limit = 30): Listing[] {
  return db.prepare(`SELECT * FROM listings WHERE score IS NULL LIMIT ?`).all(limit) as Listing[];
}

export function getListing(id: string): Listing | null {
  return db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as Listing | null;
}

export function updateScore(
  id: string,
  fields: {
    score: number;
    fair_value_cents?: number | null;
    walk_price_cents?: number | null;
    confidence?: number | null;
    rationale?: string | null;
    product_name?: string | null;
    brand?: string | null;
    brand_url?: string | null;
    category?: string | null;
  }
) {
  db.prepare(
    `UPDATE listings SET score=?, fair_value_cents=?, walk_price_cents=?, confidence=?, rationale=?, product_name=?, brand=?, brand_url=?, category=? WHERE id=?`
  ).run(
    fields.score,
    fields.fair_value_cents ?? null,
    fields.walk_price_cents ?? null,
    fields.confidence ?? null,
    fields.rationale ?? null,
    fields.product_name ?? null,
    fields.brand ?? null,
    fields.brand_url ?? null,
    fields.category ?? null,
    id
  );
}

export function setProductName(id: string, name: string) {
  db.prepare('UPDATE listings SET product_name=? WHERE id=?').run(name, id);
}

export function getProduct(name: string): { image_b64: string } | null {
  return db.prepare('SELECT image_b64 FROM products WHERE name=?').get(name) as any;
}

export function upsertProduct(name: string, image_b64: string) {
  db.prepare(
    `INSERT INTO products (name, image_b64, fetched_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET image_b64=excluded.image_b64, fetched_at=CURRENT_TIMESTAMP`
  ).run(name, image_b64);
}

export function recordMessage(id: string, body: string) {
  db.prepare(
    `UPDATE listings SET messaged_at = CURRENT_TIMESTAMP, last_message = ? WHERE id = ?`
  ).run(body, id);
}

export function addMessage(listingId: string, role: 'buyer' | 'seller', body: string) {
  db.prepare('INSERT INTO messages (listing_id, role, body) VALUES (?, ?, ?)').run(listingId, role, body);
}

export function getConversation(listingId: string): { role: string; body: string; ts: string }[] {
  return db.prepare('SELECT role, body, ts FROM messages WHERE listing_id=? ORDER BY ts ASC').all(listingId) as any[];
}

export function getActiveConversations(): { id: string; title: string; url: string; product_name: string | null }[] {
  return db.prepare(
    `SELECT id, title, url, product_name FROM listings
     WHERE messaged_at IS NOT NULL AND deploy_status = 'sent'`
  ).all() as any[];
}

// only these brands surface as candidates. everything else is noise.
const APPROVED_BRANDS = new Set([
  // furniture
  'Herman Miller', 'Steelcase', 'Knoll', 'Humanscale', 'Vitra', 'Fritz Hansen',
  'Cassina', 'B&B Italia', 'Poltrona Frau', 'Eames', 'Hans Wegner', 'Arne Jacobsen',
  'Saarinen', 'Noguchi', 'Finn Juhl', 'Eero Aarnio', 'Naughtone', 'Coalesse',
  'Stickley', 'Heywood-Wakefield', 'Drexel', 'Dunbar', 'American of Martinsville',
  // watches
  'Audemars Piguet', 'Patek Philippe', 'Rolex', 'Omega', 'Tudor', 'Cartier',
  'Breitling', 'IWC', 'Panerai', 'Grand Seiko', 'Jaeger-LeCoultre', 'Jaeger LeCoultre',
  'Vacheron Constantin', 'A. Lange & Söhne', 'A Lange Sohne', 'FP Journe', 'Breguet',
  'TAG Heuer', 'Tag Heuer',
  // audio
  'Devialet', 'McIntosh', 'Mark Levinson', 'Bowers & Wilkins', 'Bowers Wilkins', 'B&W',
  'KEF', 'Focal', 'Bang & Olufsen', 'Bang Olufsen', 'Naim', 'Burmester', 'Pass Labs',
  'Classe', 'Parasound',
  // eyewear
  'Cartier', 'Chrome Hearts', 'Jacques Marie Mage', 'Chanel', 'Dior', 'Tom Ford',
  'Persol', 'Prada', 'Gucci', 'Saint Laurent', 'Gentle Monster', 'Maybach',
  'Victoria Beckham', 'Oliver Peoples',
  // bags + accessories
  'Hermès', 'Hermes', 'Louis Vuitton', 'Goyard', 'Bottega Veneta', 'Celine', 'Céline',
  'The Row', 'Moynat', 'Loewe', 'Fendi',
  // clothing
  'Moncler', 'Canada Goose', 'Stone Island', 'Rick Owens', 'Loro Piana',
  'Acne Studios', 'Ami Paris', 'Alexander McQueen', 'Burberry',
  // cameras
  'Leica', 'Hasselblad', 'Sony', 'Canon',
  // tools
  'Snap-On', 'Snap On', 'Festool', 'Lie-Nielsen', 'Lie Nielsen', 'Hilti',
  // lighting
  'Louis Poulsen', 'Flos', 'Artemide',
]);

function isApprovedBrand(brand: string | null): boolean {
  if (!brand) return false;
  if (APPROVED_BRANDS.has(brand)) return true;
  // fuzzy: check if any approved brand is a substring
  const lower = brand.toLowerCase();
  for (const ab of APPROVED_BRANDS) {
    if (lower.includes(ab.toLowerCase()) || ab.toLowerCase().includes(lower)) return true;
  }
  return false;
}

export function topCandidates(opts: { minScore?: number; limit?: number; includeMessaged?: boolean; minBrandCount?: number } = {}): Listing[] {
  const min = opts.minScore ?? 6;
  const limit = opts.limit ?? 15;
  const minCount = opts.minBrandCount ?? 2;
  const where = opts.includeMessaged
    ? `WHERE score IS NOT NULL AND score >= ?`
    : `WHERE score IS NOT NULL AND score >= ? AND messaged_at IS NULL`;

  const all = db
    .prepare(`SELECT * FROM listings ${where} ORDER BY score DESC, scraped_at DESC LIMIT ?`)
    .all(min, limit * 5) as Listing[];
  const approved = all.filter((l) => isApprovedBrand((l as any).brand));

  // count how many candidates per brand
  const brandCounts = new Map<string, number>();
  for (const l of approved) {
    const b = (l as any).brand;
    brandCounts.set(b, (brandCounts.get(b) || 0) + 1);
  }
  return approved.filter((l) => (brandCounts.get((l as any).brand) || 0) >= minCount).slice(0, limit);
}
