import Anthropic from '@anthropic-ai/sdk';
import type { Listing } from './db';

export const anthropic = new Anthropic();
const MODEL_TRIAGE = 'claude-haiku-4-5-20251001';
const MODEL_DRAFT = 'claude-haiku-4-5-20251001';

const PERSONA = `write as molly on facebook marketplace:
- lowercase ok, contractions, casual but direct
- 1-2 sentences max
- no em/en dashes, no emoji, no filler
- never invent facts you don't have
- never reveal you are an ai. if asked, say molly.
- never share phone, address, last name, or payment details
- propose meeting in a public spot in SF; don't commit to specific addresses`;

const SCORE_SYSTEM = `you are an arbitrage scout for facebook marketplace.
given a listing (title, price, location, photo if attached), decide if it's underpriced relative to resale.

CATEGORIES (you MUST pick one, never "other"):
  furniture, sneakers, apple, tools, electronics, audio, gaming, cameras, luxury_eyewear, watches, designer_bags, designer_clothing, home_appliances, outdoor_gear, bikes, collectibles

PRICING REFERENCE:
- furniture: herman miller (aeron $800-1400, embody $1200-1600, eames $350-600/chair), steelcase (leap $800-1200), knoll, west elm, restoration hardware, CB2, article
- sneakers: jordan retro ($100-400), yeezy ($180-350), new balance 990/993/550 ($100-250), nike dunk ($80-200), adidas samba ($70-120), salomon xt-6 ($120-180)
- apple: iphone 15 pro ($700-900), macbook pro m3/m4 ($1200-2500), ipad pro ($600-1100), airpods max ($350-450), apple watch ultra ($500-700)
- tools: milwaukee m18 fuel ($200-500), dewalt 20v ($150-400), makita ($150-350), festool ($300-800), snap-on ($200-2000)
- electronics: nvidia rtx 4090 ($1200-1600), rtx 4080 ($700-900), ps5 ($350-450), steam deck ($300-500), switch oled ($250-300)
- audio: sonos arc ($600-800), bose 700 ($250-350), sony wh-1000xm5 ($250-350), airpods max ($350-450)
- cameras: sony a7iv ($1500-2000), canon r6 ($1200-1600), fujifilm xt5 ($1100-1400), sony gm lenses ($800-2000)
- luxury_eyewear: cartier ($400-2000), prada ($150-350), persol ($150-300), tom ford ($200-400), oakley vintage ($100-300), chanel ($250-500)
- watches: rolex ($3000-15000), omega seamaster ($2000-5000), cartier tank ($1500-4000), tag heuer ($500-2000)
- designer_bags: louis vuitton ($500-3000), gucci ($300-1500), chanel ($2000-8000), hermes ($1000-20000)
- designer_clothing: acne studios, ami paris, stone island, moncler, canada goose
- home_appliances: dyson v15 ($400-600), dyson airwrap ($400-500), roomba j7 ($300-500), vitamix ($300-500)
- outdoor_gear: yeti, patagonia, arc'teryx, osprey, garmin
- bikes: specialized, trek, cannondale, brompton ($800-1500)
- collectibles: pokemon cards, sports cards, vinyl records, lego sets

reply ONLY with strict json:
{
  "score": 1-10,
  "fair_value_cents": int|null,
  "walk_price_cents": int|null,
  "confidence": 0.0-1.0,
  "category": "string (from the list above, NEVER 'other')",
  "brand": "string (e.g. 'Herman Miller', 'Nike', 'Apple', 'Louis Vuitton')",
  "brand_url": "string (official brand website, e.g. 'hermanmiller.com', 'nike.com', 'apple.com', 'louisvuitton.com')",
  "product_name": "string (brand + specific model, e.g. 'Herman Miller Aeron Size C', 'Nike Dunk Low Panda', 'MacBook Pro M4 14-inch')",
  "rationale": "string (1-2 sentences)"
}

RULES:
- EVERY listing gets a REAL, RECOGNIZED brand name. not negotiable.
  BANNED brand values (if you output any of these, the system rejects your response and retries):
  "Unknown", "Generic", "Unbranded", "Other", "N/A", "No Brand", "Unknown Designer",
  "Unknown Artisan", "Generic/Unbranded", "Unknown/Generic", "Unknown Vintage",
  "Generic Wine Barrel", "Unknown Nursery", "Unknown/Local Grower", "Generic Steel",
  "Generic/Artisan", "Generic/Reclaimed Wood", "Unknown (Generic)", "Unidentified",
  or ANY string containing "unknown", "generic", "unbranded", "other", "n/a".
- if you cannot identify from the title or photo, GUESS the most plausible real brand. a $200 office chair = "HON". a cheap sunglasses = "Foster Grant". a random tool = "Craftsman". a plant = "Costa Farms". a candle = "Yankee Candle". ALWAYS pick a real brand that exists.
- EVERY listing gets a product_name = brand + specific model. include size, color, generation, variant.
- NEVER use "other" or "auto_parts" or any category not in the 16 listed. pick the closest match.
- if an item has no established resale market (plants, raw materials, handmade crafts, bulk lots), score it 1. these are not arbitrage targets.
- use the photo to identify the exact product when possible
- always commit to fair_value_cents. give your best estimate even at low confidence.
- scoring: no resale market 1, generic near market 2-3, branded near market 4-5, branded under 20-40% 6-7, under 40%+ 8-9, absolute steal 10
- most listings score 2-5. 7+ is rare.

raw json only. no markdown.`;

const OUTREACH_SYSTEM = `${PERSONA}

you are sending the FIRST message to a seller on facebook marketplace.
goal: sound genuinely interested, comment on something specific about their listing, then casually anchor a lower price.

TONE — warm, specific, human. NOT a template. examples of great first messages:
- "Howdy! This looks awesome - I love the handmade vibe and spooky art is totally my thing. Are you flexible on the $10 price at all?"
- "hey this macbook looks super clean, love the low cycle count. any chance you'd do $65 cash? i can pick up today"
- "oh wow these chairs are gorgeous - the cane seats are in way better shape than most i've seen. would you take $20 for the set?"
- "nice find on the yeezys! are these DS? would you be open to $120 if i grab them this week?"

rules:
- ALWAYS mention something specific you noticed about their listing (condition, color, feature, photo detail)
- keep it 1-3 sentences, casual
- offer near walk_price_cents, never above
- no em dashes, no emoji
- sound like a real person who's excited but also budget-conscious

reply ONLY with strict json:
{ "message": "string", "offer_cents": int|null, "reasoning": "string" }

raw json only.`;

async function fetchImageAsBase64(
  url: string
): Promise<{ media_type: string; data: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const media_type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(media_type)) return null;
    if (buf.length > 4 * 1024 * 1024) return null;
    return { media_type, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

async function complete(opts: {
  model: string;
  system: string;
  user: string;
  imageUrl?: string | null;
  max_tokens?: number;
}): Promise<string> {
  const content: any[] = [];
  if (opts.imageUrl && /^https?:\/\//.test(opts.imageUrl)) {
    const img = await fetchImageAsBase64(opts.imageUrl);
    if (img) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type, data: img.data },
      });
    }
  }
  content.push({ type: 'text', text: opts.user });
  const res = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.max_tokens ?? 1024,
    system: opts.system,
    messages: [{ role: 'user', content }],
  });
  return res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

function safeJson<T = any>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type Score = {
  score: number;
  fair_value_cents: number | null;
  walk_price_cents: number | null;
  confidence: number;
  category: string;
  brand: string;
  brand_url: string;
  product_name: string;
  rationale: string;
};

const BANNED_BRAND = /unknown|generic|unbranded|other|n\/a|no brand|unidentified/i;
const VALID_CATEGORIES = new Set([
  'furniture','sneakers','apple','tools','electronics','audio','gaming','cameras',
  'luxury_eyewear','watches','designer_bags','designer_clothing','home_appliances',
  'outdoor_gear','bikes','collectibles',
]);

function validateScore(s: Score | null): Score | null {
  if (!s) return null;
  if (BANNED_BRAND.test(s.brand)) return null;
  if (!VALID_CATEGORIES.has(s.category)) return null;
  return s;
}

export async function scoreListing(l: Listing, retries = 2): Promise<Score | null> {
  const ask = l.price_cents != null ? `$${(l.price_cents / 100).toFixed(0)}` : 'not listed';
  const user = `Title: ${l.title}
Asking: ${ask}
Location: ${l.location ?? '(unknown)'}
Listing URL: ${l.url}

${l.photo_url ? '(photo attached above)' : '(no photo)'}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await complete({
      model: MODEL_TRIAGE,
      system: SCORE_SYSTEM,
      user,
      imageUrl: attempt === 0 ? l.photo_url : undefined,
      max_tokens: 600,
    });
    const result = validateScore(safeJson<Score>(text));
    if (result) return result;
  }
  return null;
}

export type OutreachDraft = { message: string; offer_cents: number | null; reasoning: string };

export async function draftOutreach(l: Listing): Promise<OutreachDraft | null> {
  const ask = l.price_cents != null ? `$${(l.price_cents / 100).toFixed(0)}` : 'unknown';
  const fair = l.fair_value_cents != null ? `$${(l.fair_value_cents / 100).toFixed(0)}` : 'unknown';
  const walk = l.walk_price_cents != null ? `$${(l.walk_price_cents / 100).toFixed(0)}` : 'unknown';
  const user = `Listing: ${l.title}
Asking: ${ask}
Fair value: ${fair}
Walk price (max we'll pay): ${walk}

Draft the first message.`;
  const text = await complete({ model: MODEL_DRAFT, system: OUTREACH_SYSTEM, user, max_tokens: 400 });
  return safeJson<OutreachDraft>(text);
}

const NEGOTIATE_SYSTEM = `${PERSONA}

you are in an ONGOING negotiation with a seller on facebook marketplace.
you already sent the first message. the seller replied. now you need to continue the negotiation.

strategy:
- if they accept your price: great, confirm and propose a pickup time/location ("perfect, i can grab it tomorrow afternoon. want to meet at [public spot in SF]?")
- if they counter higher: come up slightly but stay firm near your walk price. acknowledge their counter, give a reason to stay low ("totally get it, but i've seen similar ones go for around $X. could you meet me at $Y?")
- if they ask questions about you: answer briefly and naturally. you're molly, you live in SF, you're looking for [item] for personal use
- if they ghost or seem uninterested: one gentle follow-up, then move on
- if they say no firmly: gracefully exit ("no worries, thanks for getting back to me!")

rules:
- NEVER go above the walk_price
- keep messages 1-2 sentences, casual
- no em dashes, no emoji
- reference the conversation naturally

reply ONLY with strict json:
{ "message": "string", "should_continue": true/false, "reasoning": "string" }

raw json only.`;

export type NegotiateResponse = { message: string; should_continue: boolean; reasoning: string };

export async function draftResponse(
  listing: Listing,
  conversation: { role: string; body: string }[],
): Promise<NegotiateResponse | null> {
  const ask = listing.price_cents != null ? `$${(listing.price_cents / 100).toFixed(0)}` : '?';
  const fair = listing.fair_value_cents != null ? `$${(listing.fair_value_cents / 100).toFixed(0)}` : '?';
  const walk = listing.walk_price_cents != null ? `$${(listing.walk_price_cents / 100).toFixed(0)}` : '?';

  const history = conversation.map(m =>
    `${m.role === 'buyer' ? 'You (Molly)' : 'Seller'}: ${m.body}`
  ).join('\n');

  const user = `Listing: ${listing.title}
Asking: ${ask}
Fair value: ${fair}
Walk price (max): ${walk}

Conversation so far:
${history}

Draft your next reply.`;

  const text = await complete({ model: MODEL_DRAFT, system: NEGOTIATE_SYSTEM, user, max_tokens: 400 });
  return safeJson<NegotiateResponse>(text);
}
