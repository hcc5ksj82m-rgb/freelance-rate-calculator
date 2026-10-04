-- PackEV: day-over-day movers for LIVE-refreshed cards (home page "Latest movers").
-- Read-only view; security_invoker so RLS on cards / card_price_history applies.
create or replace view public.card_daily_movers with (security_invoker = true) as
with latest as (
  select max(day) d from public.card_price_history where source = 'live_api'
), t as (
  select h.card_id, h.day, h.market_price_usd now_usd
  from public.card_price_history h, latest
  where h.day = latest.d and h.source = 'live_api'
), p as (
  select distinct on (h.card_id) h.card_id, h.day prev_day, h.market_price_usd prev_usd
  from public.card_price_history h join t on t.card_id = h.card_id and h.day < t.day
  where h.day >= t.day - 7 and h.source in ('live_api','catalog')
  order by h.card_id, h.day desc
)
select t.card_id, c.name, c.set_id, c.set_name, c.number, c.image_small,
       t.day, p.prev_day, p.prev_usd, t.now_usd,
       round((t.now_usd - p.prev_usd) / nullif(p.prev_usd, 0) * 100, 2) as pct_change
from t join p on p.card_id = t.card_id join public.cards c on c.id = t.card_id
where p.prev_usd > 0 and t.now_usd <> p.prev_usd;

grant select on public.card_daily_movers to anon, authenticated;
