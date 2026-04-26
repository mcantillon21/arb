# arb

## What it is

An AI agent that continuously scans Facebook Marketplace, identifies underpriced items using Claude's vision, and negotiates purchases autonomously. 107 search queries across 6 categories, 20 parallel browser tabs, vision-based scoring, and LLM-drafted outreach messages in a human voice.

Built in a day. Already finding real arbitrage: Cartier frames at $185 (worth $850), Herman Miller Aerons at $200 (worth $800), Nike SB Dunks at $97 (worth $800).

## The inspiration

**Anthropic's Project Deal (April 2026).** Anthropic ran an internal experiment where Claude agents negotiated and executed trades on behalf of 69 employees in a Slack marketplace. 186 deals, $4k transacted, zero human intervention. Key finding: model quality dominated outcomes. Opus agents extracted $2.68 more per item sold and paid $2.45 less per item bought vs Haiku agents. Aggressive prompting had no effect. The paper is at anthropic.com/features/project-deal.

Project Deal proved agent-to-agent commerce works in a closed, cooperative market. arb asks: what happens when you deploy that in an open, adversarial one?

**The bookmark signal.** A pattern emerged from analyzing a year of saved tweets: 30% AI, 18% startups, 11% design, 11% marketing. But the cross-cutting thesis was "agent-native services replacing software" (Sequoia's "$1T services" map, gregisenberg's "10,000 niches," dharmesh's "every B2B going headless"). The prediction-market bookmarks (Polymarket dataset, $24k in 15 days, autoquant) pointed to the same insight from a different angle: information asymmetry + speed of identification = money.

FB Marketplace is where both threads converge. It's the largest classified market in the world, with massive information asymmetry (sellers who don't know what they have), no public API (moat against commodity bots), and a negotiation layer that's pure natural language (exactly what LLMs are good at).

## The opportunity

The bottleneck in marketplace arbitrage has never been finding deals. It's three things:

1. **Identification speed.** A human scanning Marketplace sees maybe 50 listings per session. arb scores 2,000+ with vision in under 10 minutes. The AI sees the Cartier warranty card in the photo, knows the rimless diamond-cut style resells for $850, and flags it before a human would even register it's Cartier.

2. **Negotiation at scale.** A human can maintain maybe 5 active conversations. An LLM can draft personalized opening messages for 50 sellers simultaneously, each referencing something specific about their listing ("love the low cycle count on that macbook," "the cane seats are in way better shape than most i've seen"). Project Deal proved the negotiation quality holds.

3. **Physical execution.** This is the part AI can't do. Someone has to drive to the seller, inspect the item, hand over cash, and bring it home. This is where [rentahuman.ai](https://rentahuman.ai/) changes everything.

### rentahuman.ai + arb = fully autonomous arbitrage

RentAHuman lets AI agents hire humans for physical tasks. The integration is straightforward:

- arb identifies a 7+/10 listing (Aeron chair, $200, SF)
- arb drafts and sends the opening message, negotiates to $150
- seller agrees, provides address and pickup window
- arb dispatches a RentAHuman worker to inspect, pay cash, and deliver to a staging location
- item gets listed on eBay/Grailed at fair market value
- profit = fair value minus (purchase + RentAHuman fee + platform fees)

The AI handles everything except the 30 minutes of physical presence. The human is the hands, the AI is the brain. This is the "services is the new software" thesis made literal: a service (driving to someone's house, inspecting a chair, paying cash) being orchestrated by software.

### Why Facebook Marketplace specifically

- **Largest classified market in the world.** More listings than Craigslist, OfferUp, and Mercari combined.
- **No public API.** This is a feature, not a bug. No API means no commodity scrapers, no race-to-zero. The bot detection + Playwright stealth approach is a real technical moat.
- **Information asymmetry is structural.** Sellers are individuals clearing out closets, not professional resellers. They price by vibes, not comps. A Prada sunglasses with box and authenticity card gets listed at $60 because the seller bought them on vacation and doesn't Google resale prices.
- **Negotiation is natural language.** No structured offer/accept protocol. Just Messenger DMs. This is exactly the domain where LLMs outperform rule-based systems.
- **Local pickup eliminates shipping fraud.** Cash + in-person = no chargebacks, no shipping damage, no authentication disputes. The highest-trust transaction medium in commerce.

## What's next

1. **RentAHuman integration.** When a deal is agreed, auto-dispatch a worker for pickup. Track the item through staging to resale.
2. **Real comp data.** Replace LLM fair-value estimates with actual eBay sold listings and StockX bids. Ground truth, not vibes.
3. **Multi-city.** The same 107 queries work in any metro. Run arb in 10 cities simultaneously, dispatch local RentAHuman workers in each.
4. **Sell-side automation.** After pickup, auto-generate eBay/Grailed listings with professional photos and optimized descriptions. Close the loop from "found a deal" to "money in the bank."
5. **Category expansion.** The scorer prompt is the only thing that's category-specific. Adding a new vertical (musical instruments, vintage clothing, camera lenses) is a prompt edit, not a code change.

## The math

Conservative assumptions for a single metro (SF Bay Area):
- 107 queries, ~2000 listings per run
- 9% hit rate at score 7+ = ~180 candidates per run
- 10% conversion (seller responds + deal closes) = 18 deals per run
- Average spread after fees: $150
- One run per day = $2,700/day potential gross margin
- RentAHuman cost: ~$30/pickup = $540/day
- Net: ~$2,100/day, $63k/month from one metro

Scale to 10 metros: $630k/month. The unit economics improve with density (more listings per query, shorter pickup distances, better RentAHuman utilization).

This is not a SaaS. It's an operation. The AI is the operator.
