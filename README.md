# PackEV

Pokemon-only: every TCG set, live price charts, pack rip EV calculator.

Live: https://hcc5ksj82m-rgb.github.io/freelance-rate-calculator/

## Prices page

- **Search:** type any card name to show matching cards with live TCGPlayer / Cardmarket prices and low/mid/market/high spark bars.
- The page makes no API requests until a card name is searched.
- **History chart:** click a search result (or a card on a set page) for a clean line chart. Data comes from `public.card_price_history` (anon read). Range chips that lack enough points are hidden; tip: “More history builds daily.”
- **$0 history:** daily snapshots of `cards.market_price_usd`. One-time Cardmarket avg1/avg7/avg30 backfill (~1/7/30 days ago) only for cards **without** TCGPlayer prices (avoids mixing USD/EUR on one chart). No paid APIs. Daily routine: after catalog sync run `scripts/snapshot-prices.py` or `sync-pokemon-cards.py --snapshot-history` / `--snapshot-only`.
- **Latest movers (home):** `public.card_daily_movers` view (security_invoker, anon SELECT) compares each LIVE-refreshed card's newest `live_api` price with its previous snapshot. The daily routine refreshes the ~150 most valuable catalog cards plus chase cards from the Pokemon TCG API (`source='live_api'`), then snapshots everything else as `catalog`. If the API drops a card's priced variant (e.g. reverse holo gone, only normal left), keep the previous price instead of logging a fake crash.


## Full catalog (Supabase)

All cards across every set belong in Postgres, not static hosting:

1. Apply `supabase/cards_schema.sql` and `supabase/card_price_history.sql` (RLS: anon/authenticated **SELECT only**; sync/snapshot uses **service_role**).
2. Run `scripts/sync-pokemon-cards.py` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`). Use `--resume` after rate limits; optional `POKEMONTCG_API_KEY`.

## Members (Join / Log in)

Foundation: `join.html`, `login.html`, `account.html`, `js/auth.js`. See **SETUP.md** / **AUTH.md**.

## Forum

Community board at `forum.html` (thread view: `?thread=<uuid>`, category filter: `?cat=<id>`).
Uses Supabase tables `forum_categories` / `forum_threads` / `forum_replies` with RLS (anon read; authenticated insert/update own). Schema: `supabase/forum_schema.sql`.

