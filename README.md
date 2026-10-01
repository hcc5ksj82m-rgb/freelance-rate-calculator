# PackEV

Pokemon-only: every TCG set, live chase price charts, pack rip EV calculator.

Live: https://hcc5ksj82m-rgb.github.io/freelance-rate-calculator/

## Prices page

- **Base load:** rotating **20** of ~**top 100** chase cards (by market price), refreshed live from the Pokemon TCG API (TCGPlayer / Cardmarket). Not a full catalog dump (too large for GitHub Pages).
- **Search:** type a card name to show matching cards with live prices + low/mid/market/high spark bars.
- Seed IDs: `data/chase-pool.json`. Logic: `js/prices.js`.

## Full catalog (Supabase)

All cards across every set belong in Postgres, not static hosting:

1. Apply `supabase/cards_schema.sql` (RLS: anon/authenticated **SELECT only**; sync uses **service_role**).
2. Run `scripts/sync-pokemon-cards.py` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`). Use `--resume` after rate limits; optional `POKEMONTCG_API_KEY`.

## Members (Join / Log in)

Foundation: `join.html`, `login.html`, `account.html`, `js/auth.js`. See **SETUP.md** / **AUTH.md**.

## Forum

Community board at `forum.html` (thread view: `?thread=<uuid>`, category filter: `?cat=<id>`).
Uses Supabase tables `forum_categories` / `forum_threads` / `forum_replies` with RLS (anon read; authenticated insert/update own). Schema: `supabase/forum_schema.sql`.

