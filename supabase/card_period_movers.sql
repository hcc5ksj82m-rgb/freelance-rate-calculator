-- PackEV: 1D / 7D / 30D price change for LIVE-refreshed cards from stored daily snapshots.
-- Powers the home "Latest movers" 1D / 7D / 30D tabs.
-- Only TCGPlayer-basis rows (live_api, catalog) are compared; older Cardmarket-derived
-- backfill rows (cardmarket_avg1 / cardmarket_avg7) are a different price basis and are excluded.
-- Each window reports its real baseline day so the UI can label honestly ("since 1 Oct").
-- Read-only view; security_invoker so RLS on cards / card_price_history applies.
-- Applied to the Packev Supabase project on 2026-10-08 (migration card_period_movers_view).
create or replace view public.card_period_movers with (security_invoker = true) as
with latest as (
  select max(day) d from public.card_price_history where source = 'live_api'
), t as (
  select h.card_id, h.day, h.market_price_usd now_usd
  from public.card_price_history h, latest
  where h.day = latest.d and h.source = 'live_api' and h.market_price_usd > 0
), b as (
  select h.card_id, h.day, h.market_price_usd
  from public.card_price_history h join t on t.card_id = h.card_id
  where h.day < t.day and h.day >= t.day - 30 and h.source in ('live_api','catalog') and h.market_price_usd > 0
), d1 as (
  select distinct on (card_id) card_id, day, market_price_usd from b order by card_id, day desc
), d7 as (
  select distinct on (b.card_id) b.card_id, b.day, b.market_price_usd from b join t using (card_id)
  where b.day >= t.day - 7 order by b.card_id, b.day asc
), d30 as (
  select distinct on (card_id) card_id, day, market_price_usd from b order by card_id, day asc
)
select t.card_id, c.name, c.set_id, c.set_name, c.number, c.image_small,
       t.day, t.now_usd,
       d1.day prev_day_1d, d1.market_price_usd prev_usd_1d,
       round((t.now_usd - d1.market_price_usd) / nullif(d1.market_price_usd, 0) * 100, 2) pct_1d,
       d7.day base_day_7d, d7.market_price_usd base_usd_7d,
       round((t.now_usd - d7.market_price_usd) / nullif(d7.market_price_usd, 0) * 100, 2) pct_7d,
       d30.day base_day_30d, d30.market_price_usd base_usd_30d,
       round((t.now_usd - d30.market_price_usd) / nullif(d30.market_price_usd, 0) * 100, 2) pct_30d
from t join public.cards c on c.id = t.card_id
left join d1 on d1.card_id = t.card_id
left join d7 on d7.card_id = t.card_id
left join d30 on d30.card_id = t.card_id;

grant select on public.card_period_movers to anon, authenticated;
