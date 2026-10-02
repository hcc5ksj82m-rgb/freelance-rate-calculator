-- PackEV free price history (no paid APIs)
-- Project: dubzutcfjezswyvfmizy
-- Anon/authenticated: SELECT only. Writes via service_role / MCP only.

create table if not exists public.card_price_history (
  card_id text not null references public.cards(id) on delete cascade,
  day date not null,
  market_price_usd numeric,
  source text,
  primary key (card_id, day)
);

comment on table public.card_price_history is
  'Daily card market price snapshots for PackEV charts; anon read-only via RLS.';

create index if not exists card_price_history_day_idx
  on public.card_price_history (day desc);

create index if not exists card_price_history_card_day_idx
  on public.card_price_history (card_id, day desc);

alter table public.card_price_history enable row level security;

drop policy if exists "card_price_history_select_public" on public.card_price_history;

create policy "card_price_history_select_public"
  on public.card_price_history
  for select
  to anon, authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies for anon or authenticated.

-- Optional short history anchors (see scripts/backfill-cm-history.py):
-- Cardmarket avg30/avg7/avg1 are EUR. Backfill scales them to USD via
-- market_price_usd / averageSellPrice and stores on today-30 / today-7 / today-2
-- with sources cardmarket_avg30|avg7|avg1. Outliers outside 0.25x–4x of catalog
-- USD are skipped so the chart stays coherent with catalog snapshots.
