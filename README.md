# arb

FB Marketplace arbitrage scout. Scrapes listings, scores them with Claude vision, surfaces ranked candidates with a live dashboard.

## Setup

```bash
bun install
bunx playwright install chromium
arb sync-session     # pulls FB cookies from your active Chrome profile
arb whoami           # confirms session is live
```

Requires `ANTHROPIC_API_KEY` in `~/.env`.

## Use

```bash
arb auto
```

## How it works

- **search** -- playwright + stealth scrapes FB Marketplace. Auth only needed for `reach`.
- **score** -- listing photo + title go to Haiku 4.5 vision. Returns score, fair value, walk price, confidence.
- **outreach** -- Opus drafts opening message anchored at walk price. Confirms before sending.
- **session** -- cookies from Chrome via macOS Keychain + AES-128-CBC.

## Caveats

- ToS gray area. Automated outreach can flag your account.
- Vision API ~$0.001/listing.
- `xs` token expires. Re-run `arb sync-session` when `whoami` fails.
- Recon-only by default. No auto-reply, no auto-buy.
