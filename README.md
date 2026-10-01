# PackEV

Pokemon-only: every TCG set, live price charts, pack rip EV calculator.

Live: https://hcc5ksj82m-rgb.github.io/freelance-rate-calculator/

## Prices page

- **Search:** type any card name to show matching cards with live TCGPlayer / Cardmarket prices and low/mid/market/high spark bars.
- The page makes no API requests until a card name is searched.
- **History chart:** click a search result (or a card on a set page) for a Google-style line chart with 1M / 6M / 1Y / 5Y / Max chips. 1M uses real Cardmarket avg1/avg7/avg30 when present; longer ranges are labeled DEMO (no free multi-year feed on api.pokemontcg.io).

## Full catalog (Supabase)

All cards across every set belong in Postgres, not static hosting:

1. Apply `supabase/cards_schema.sql` (RLS: anon/authenticated **SELECT only**; sync uses **service_role**).
2. Run `scripts/sync-pokemon-cards.py` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`). Use `--resume` after rate limits; optional `POKEMONTCG_API_KEY`.

## Members (Join / Log in)

Foundation: `join.html`, `login.html`, `account.html`, `js/auth.js`. See **SETUP.md** / **AUTH.md**.

## Forum

Community board at `forum.html` (thread view: `?thread=<uuid>`, category filter: `?cat=<id>`).
Uses Supabase tables `forum_categories` / `forum_threads` / `forum_replies` with RLS (anon read; authenticated insert/update own). Schema: `supabase/forum_schema.sql`.

