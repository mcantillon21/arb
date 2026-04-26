# arb

Facebook Marketplace arbitrage scout. Finds underpriced items, scores with Claude vision, surfaces ranked candidates with clickable links.

## Setup

```bash
bun install
bunx playwright install chromium
arb sync-session     # auto-detects your active Chrome profile, pulls FB cookies
arb whoami           # confirms session is live
```

Requires `ANTHROPIC_API_KEY` in `~/.env`.

## Use

```bash
arb                              # dashboard: status + top gems
arb auto "cartier sunglasses"    # hunt → score → list candidates
arb reach 1                      # send opening message to candidate [1]
arb reach 1 --dry                # draft only, don't send
```

`top` and `auto` print numbered candidates `[1]` `[2]` …; `reach <n>` resolves the number against the last `top` output.

## Commands

```
sync-session [--profile=N]    pull cookies from your real chrome
whoami                        verify the synced session is live
hunt <query> [--scrolls=N]    scrape listings into db
score [--limit=N]             score via claude haiku 4.5 (vision)
top [--min=N] [--limit=N]     ranked candidates (default min=6)
auto <query>                  hunt → score → top, one shot
reach <n|id> [--dry] [--yes]  send opening message (asks confirmation)
status                        counts
```

## How it works

- **search**: playwright + stealth scrapes FB Marketplace. Anonymous queries already return ~50 listings — auth becomes load-bearing only at `reach`.
- **score**: each listing's photo (downloaded as base64) + title go to Haiku 4.5. Returns 1-10 score, fair-value estimate, walk price (max we'd pay), confidence, rationale.
- **outreach**: opus 4.7 drafts the opening message in your voice. Anchored at walk price. Confirms before sending.
- **session**: cookies pulled from your real Chrome profile via macOS Keychain + AES-128-CBC. Re-sync when expired.

## Caveats

- ToS gray area. Mass automated outreach can flag your account.
- Vision API ≈ $0.001/listing. 100 listings/day = $0.10.
- `xs` token expires eventually. Re-run `arb sync-session` if `whoami` says ✗.
- Recon-only by design. No auto-reply, no auto-buy. You decide every send.

## File layout

```
src/
  cli.ts        command dispatcher + UI
  ui.ts         ANSI color helpers, prompt
  lib.ts        playwright launcher, stealth, log, jitter
  db.ts         listings + messages tables (SQLite)
  llm.ts        Anthropic client, prompts, vision
  search.ts     FB Marketplace scraper
  score.ts      parallel scoring loop
  outreach.ts   opening-message sender
  session.ts    Chrome cookie extractor + Keychain decrypt
  queries.ts    LLM-generated search query expansion
  enrich.ts     brand identification + favicon fetching
  monitor.ts    inbox polling + auto-reply negotiation
  report.ts     HTML dashboard generator
  server.ts     Bun HTTP server + deploy agent API
```
