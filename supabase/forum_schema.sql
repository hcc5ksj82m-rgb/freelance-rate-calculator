-- PackEV forum tables (already applied on Packev project).
-- Anon/authenticated SELECT; authenticated INSERT/UPDATE own rows only.
-- Do NOT put service_role keys in the repo.

create table if not exists public.forum_categories (
  id text primary key,
  title text not null,
  description text,
  sort_order integer not null default 0
);

create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  category_id text not null references public.forum_categories (id),
  author_id uuid not null references auth.users (id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.forum_categories enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;

drop policy if exists "forum_categories_read" on public.forum_categories;
create policy "forum_categories_read"
  on public.forum_categories for select to anon, authenticated using (true);

drop policy if exists "forum_threads_read" on public.forum_threads;
create policy "forum_threads_read"
  on public.forum_threads for select to anon, authenticated using (true);

drop policy if exists "forum_threads_insert" on public.forum_threads;
create policy "forum_threads_insert"
  on public.forum_threads for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "forum_threads_update_own" on public.forum_threads;
create policy "forum_threads_update_own"
  on public.forum_threads for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "forum_replies_read" on public.forum_replies;
create policy "forum_replies_read"
  on public.forum_replies for select to anon, authenticated using (true);

drop policy if exists "forum_replies_insert" on public.forum_replies;
create policy "forum_replies_insert"
  on public.forum_replies for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "forum_replies_update_own" on public.forum_replies;
create policy "forum_replies_update_own"
  on public.forum_replies for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

insert into public.forum_categories (id, title, description, sort_order) values
  ('buying-selling', 'Buying & Selling', 'Trades, sales, fair prices — no scams.', 1),
  ('set-completing', 'Set Completing', 'Help finishing sets and binders.', 2),
  ('pulls-rips', 'Pulls & Rips', 'Share openings and chase hits.', 3),
  ('rules-tips', 'Rules & Tips', 'Site rules, scam warnings, collecting advice.', 4)
on conflict (id) do nothing;
