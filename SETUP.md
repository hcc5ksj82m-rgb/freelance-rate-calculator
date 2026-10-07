# PackEV member auth — setup (Marin)

Join / Log in / Account pages are live on the static site, but **multi-user auth stays disabled** until you add your own free Supabase project keys.

## What you do (3 steps)

### 1. Create a free Supabase project
1. Go to [https://supabase.com](https://supabase.com) → New project.
2. Open **Project Settings → API**.
3. Copy **Project URL** and the **anon public** key (not the service_role key).

### 2. Paste keys into the site
Edit `js/supabase-config.js` on your machine (or in the GitHub repo):

```js
window.PACK_EV_SUPABASE = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY'
};
```

Commit and push (or edit via Netlify / gh-pages deploy).  
**Do not** put the `service_role` key in the frontend. The anon key is meant for the browser and is safe only with RLS (step 3).

### 3. Run SQL + enable Email auth
1. In Supabase → **SQL Editor** → paste and run `supabase/schema.sql`.
2. In Supabase → **Authentication → Providers** → enable **Email**.
3. Optional: turn off “Confirm email” while testing, or leave it on for production.

Reload `join.html` / `login.html`. Submit buttons unlock when URL + anon key are non-empty.

## Security reminder
- Members **never** get GitHub access.
- Members can only read/update **their own** `profiles` row (RLS). Forum display names are public via `forum_authors` after you run `supabase/forum_schema.sql`.
- Static site files are not writable from the browser. See `AUTH.md`.

## Price history

Apply `supabase/card_price_history.sql` (already applied on Packev; re-run it to add `card_sold_comps`). Grow history with `python3 scripts/snapshot-prices.py` using the service role key (never commit secrets). Charts read history with the anon key. The daily price shown on a card is the average of the last 10 recorded prices; the monthly price averages those daily figures; the 20-year range does not invent missing years. Insert real completed sales into `card_sold_comps` (service role) and the chart uses those instead of snapshots.

Re-run `supabase/forum_schema.sql` after pulling forum updates so display names, reply counts, and delete-own policies exist.
