-- Graded sold comps for rare-and-above cards.
-- The site averages the last 10 sales in each grade.
-- PSA 10, 9, 8; BGS black label 10, 10, 9.5, 9, 8; CGC Pristine (black label) 10, 9.5, 9, 8.
-- qualifier is '' or 'black'. A black-label 10 is not a plain 10.
-- Anon/authenticated: SELECT only. Writes via service_role.

create table if not exists public.card_grade_comps (
  id bigint generated always as identity primary key,
  card_id text not null references public.cards(id) on delete cascade,
  grader text not null,
  grade text not null,
  qualifier text not null default '',
  sold_at timestamptz not null,
  price_usd numeric not null check (price_usd > 0),
  source text not null default 'ebay_sold',
  listing_title text
);

comment on table public.card_grade_comps is
  'Completed graded sales. PackEV averages the last 10 per grader, grade, and qualifier.';

create index if not exists card_grade_comps_card_sold_idx
  on public.card_grade_comps (card_id, sold_at desc);

alter table public.card_grade_comps enable row level security;

drop policy if exists "card_grade_comps_select_public" on public.card_grade_comps;
create policy "card_grade_comps_select_public"
  on public.card_grade_comps
  for select
  to anon, authenticated
  using (true);
