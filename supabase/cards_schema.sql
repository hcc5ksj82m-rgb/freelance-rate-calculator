-- PackEV Pokemon TCG card catalog (backend store)
-- Project: dubzutcfjezswyvfmizy
-- Apply via Supabase MCP apply_migration or SQL Editor.
-- Public/anon: SELECT only. No public writes (sync uses service_role).

create table if not exists public.cards (
  id text primary key,                          -- Pokemon TCG API card id (e.g. swsh7-215)
  name text not null,
  set_id text,
  set_name text,
  number text,
  rarity text,
  images jsonb,                                 -- { small, large }
  tcgplayer jsonb,                              -- full tcgplayer block from API (prices etc.)
  cardmarket jsonb,                             -- optional Cardmarket block
  market_price_usd numeric,                     -- denormalized best market/mid for sorting
  updated_at timestamptz not null default now()
);

comment on table public.cards is
  'Full Pokemon TCG catalog synced from api.pokemontcg.io; anon read-only via RLS.';

create index if not exists cards_name_idx on public.cards using gin (to_tsvector('english', name));
create index if not exists cards_set_id_idx on public.cards (set_id);
create index if not exists cards_market_price_usd_idx on public.cards (market_price_usd desc nulls last);
create index if not exists cards_updated_at_idx on public.cards (updated_at desc);

alter table public.cards enable row level security;

-- Drop prior policies if re-applying
drop policy if exists "cards_select_public" on public.cards;
drop policy if exists "cards_select_anon" on public.cards;
drop policy if exists "cards_select_authenticated" on public.cards;

-- Anon + authenticated: SELECT only (read-public catalog)
create policy "cards_select_public"
  on public.cards
  for select
  to anon, authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies for anon or authenticated.
-- Sync script must use the service_role key (bypasses RLS) or a dedicated DB role.

-- Optional helper: touch updated_at
create or replace function public.cards_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.cards_touch_updated_at();
