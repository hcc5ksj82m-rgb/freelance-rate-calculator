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

-- Activity + reply stats. Re-run this file in the SQL editor so names, counts, and deletes work.
alter table public.forum_threads
  add column if not exists reply_count integer not null default 0;
alter table public.forum_threads
  add column if not exists last_reply_at timestamptz;
alter table public.forum_replies
  add column if not exists updated_at timestamptz not null default now();

create index if not exists forum_threads_cat_updated_idx
  on public.forum_threads (category_id, updated_at desc);
create index if not exists forum_replies_thread_created_idx
  on public.forum_replies (thread_id, created_at desc);

create or replace function public.forum_refresh_thread_stats(tid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forum_threads t
  set
    reply_count = coalesce(s.n, 0),
    last_reply_at = s.last_at,
    updated_at = greatest(t.updated_at, coalesce(s.last_at, t.updated_at))
  from (
    select count(*)::integer as n, max(created_at) as last_at
    from public.forum_replies
    where thread_id = tid
  ) s
  where t.id = tid;
end;
$$;

create or replace function public.forum_replies_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  tid := coalesce(new.thread_id, old.thread_id);
  perform public.forum_refresh_thread_stats(tid);
  return null;
end;
$$;

drop trigger if exists forum_replies_stats on public.forum_replies;
create trigger forum_replies_stats
  after insert or update or delete on public.forum_replies
  for each row execute function public.forum_replies_stats_trigger();

update public.forum_threads t
set
  reply_count = sub.n,
  last_reply_at = sub.last_at,
  updated_at = greatest(t.updated_at, coalesce(sub.last_at, t.updated_at))
from (
  select thread_id, count(*)::integer as n, max(created_at) as last_at
  from public.forum_replies
  group by thread_id
) sub
where t.id = sub.thread_id;

drop policy if exists "forum_threads_delete_own" on public.forum_threads;
create policy "forum_threads_delete_own"
  on public.forum_threads for delete to authenticated
  using (auth.uid() = author_id);

drop policy if exists "forum_replies_delete_own" on public.forum_replies;
create policy "forum_replies_delete_own"
  on public.forum_replies for delete to authenticated
  using (auth.uid() = author_id);

-- Display names for the forum. Profile rows stay private; this view exposes name only.
create or replace view public.forum_authors
with (security_invoker = false) as
select id, display_name
from public.profiles
where display_name is not null
  and length(btrim(display_name)) > 0;

grant select on public.forum_authors to anon, authenticated;
