# PackEV

Pokemon-only: every TCG set, live price charts, pack rip EV calculator.

Live: https://hcc5ksj82m-rgb.github.io/freelance-rate-calculator/

## Prices page

- **Search:** type any card name to show matching cards with live TCGPlayer / Cardmarket prices and low/mid/market/high spark bars.
- The page makes no API requests until a card name is searched.
- **History chart:** click a search result (or a card on a set page) for the price chart. The **daily price** is the average of the last 10 recorded sales (completed sales in `public.card_sold_comps` when that table has rows, otherwise catalog snapshots). The **monthly price** is the average of those daily prices. **1M–20Y / Max** plot only stored points — years with no sales stay empty. Search bars use the same last-10 daily average when history exists.
- **$0 history:** daily snapshots of `cards.market_price_usd`. One-time Cardmarket avg1/avg7/avg30 backfill (~1/7/30 days ago) only for cards **without** TCGPlayer prices (avoids mixing USD/EUR on one chart). No paid APIs. Daily routine: after catalog sync run `scripts/snapshot-prices.py` or `sync-pokemon-cards.py --snapshot-history` / `--snapshot-only`.
- **Latest movers (home):** `public.card_daily_movers` view (security_invoker, anon SELECT) compares each LIVE-refreshed card's newest `live_api` price with its previous snapshot. The daily routine refreshes the ~150 most valuable catalog cards plus chase cards from the Pokemon TCG API (`source='live_api'`), then snapshots everything else as `catalog`. If the API drops a card's priced variant (e.g. reverse holo gone, only normal left), keep the previous price instead of logging a fake crash.

## Pack rip

`rip.html` prices a pack as bulk plus one hit slot. Commons and uncommons use the non-reverse print; the reverse slot uses the reverse-holo market when that print exists. Each hit rarity is the average of the priced cards in it, at an era estimate (official odds are unpublished). Chase cards prefer a last-10 sold average, then a live TCGPlayer market, then catalog history. Paste an eBay sold pack price to compare profit. Release MSRP is not the market cost.


## Full catalog (Supabase)

All cards across every set belong in Postgres, not static hosting:

1. Apply `supabase/cards_schema.sql` and `supabase/card_price_history.sql` (RLS: anon/authenticated **SELECT only**; sync/snapshot uses **service_role**).
2. Run `scripts/sync-pokemon-cards.py` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`). Use `--resume` after rate limits; optional `POKEMONTCG_API_KEY`.

## Members (Join / Log in)

Foundation: `join.html`, `login.html`, `account.html`, `js/auth.js`. See **SETUP.md** / **AUTH.md**.

## Forum

Community board at `forum.html` (thread view: `?thread=<uuid>`, category filter: `?cat=<id>`, search: `?q=`, sort: `?sort=active|new|replies`).
Uses Supabase tables `forum_categories` / `forum_threads` / `forum_replies` with RLS (anon read; authenticated insert/update/delete own). Display names come from `forum_authors` (name only). Re-run `supabase/forum_schema.sql` so reply counts, last-activity, deletes, and names are available. Until that SQL is applied, the board still reads and posts with the original columns.

