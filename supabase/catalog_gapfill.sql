-- PackEV catalog gap fill (run via Supabase SQL editor or MCP execute_sql; no service_role key needed).
--
-- Use when a set in public.cards has fewer rows than the Pokemon TCG API's set total
-- (flaky public API 500s during earlier syncs left gaps). Inserts missing cards only
-- (ON CONFLICT DO NOTHING), so existing prices / live history are untouched.
--
-- Notes learned 2026-10-07:
--   * Use pageSize=250 WITHOUT orderBy=number: ordered 100-card pages from the API
--     overlapped and silently skipped cards for some new sets (me3/me4/me5/me55/me2pt5).
--   * The API often returns 500/502 or an HTML error page; the helper retries each page.
--   * Market price uses the same variant order as scripts/sync-pokemon-cards.py.
--   * Remove the helper + http extension afterwards (step 4) so nothing stays exposed.

-- 1) Temporary prerequisites
create extension if not exists http with schema extensions;
create schema if not exists packev_private;
revoke all on schema packev_private from public, anon, authenticated;

-- 2) Helper
create or replace function packev_private.gapfill(sets text[]) returns text language plpgsql as $fn$
declare
  sid text; pg int; att int; r record; body jsonb; c jsonb; pr jsonb; k text; keys text[]; p numeric; ins int := 0; got int; fails text := '';
  ord text[] := array['holofoil','reverseHolofoil','normal','1stEditionHolofoil','1stEditionNormal'];
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','120');
  foreach sid in array sets loop
    pg := 1;
    loop
      body := null;
      for att in 1..14 loop
        begin
          select status, content into r from extensions.http_get('https://api.pokemontcg.io/v2/cards?q=set.id:' || sid || '&page=' || pg || '&pageSize=250&select=id,name,number,rarity,artist,images,tcgplayer,cardmarket,set');
          if r.status = 200 then body := r.content::jsonb; exit when jsonb_array_length(coalesce(body->'data','[]'::jsonb)) > 0 or (pg - 1) * 250 >= coalesce((body->>'totalCount')::int, 0); body := null; end if;
        exception when others then null;
        end;
        perform pg_sleep(least(12, 1.5 * att));
      end loop;
      if body is null then fails := fails || sid || ':p' || pg || ' '; exit; end if;
      got := 0;
      for c in select * from jsonb_array_elements(body->'data') loop
        got := got + 1;
        p := null;
        pr := c->'tcgplayer'->'prices';
        if pr is not null and jsonb_typeof(pr) = 'object' then
          keys := ord || array(select x from jsonb_object_keys(pr) x where x <> all(ord));
          foreach k in array keys loop
            if pr ? k then
              p := coalesce(nullif(pr->k->>'market','')::numeric, nullif(pr->k->>'mid','')::numeric);
              exit when p is not null;
            end if;
          end loop;
        end if;
        if p is null then
          p := coalesce(nullif(c->'cardmarket'->'prices'->>'averageSellPrice','')::numeric, nullif(c->'cardmarket'->'prices'->>'trendPrice','')::numeric);
        end if;
        insert into public.cards(id,name,set_id,set_name,set_series,number,rarity,artist,image_small,image_large,tcgplayer,cardmarket,market_price_usd,updated_at)
        values (c->>'id', coalesce(c->>'name',''), c->'set'->>'id', c->'set'->>'name', c->'set'->>'series', c->>'number', c->>'rarity', c->>'artist',
                c->'images'->>'small', c->'images'->>'large', c->'tcgplayer', c->'cardmarket', p, now())
        on conflict (id) do nothing;
        if found then ins := ins + 1; end if;
      end loop;
      exit when got < 250;
      pg := pg + 1;
      perform pg_sleep(0.3);
    end loop;
  end loop;
  return 'inserted ' || ins || ' fails: ' || fails;
end $fn$;
revoke all on function packev_private.gapfill(text[]) from public, anon, authenticated;

-- 3) Run per batch of set ids (a few sets per call keeps each statement short), e.g.
--    select packev_private.gapfill(array['sv10','g1','xy7']);
--    Then snapshot new priced cards into today's history (UTC day, catalog source):
--    insert into public.card_price_history(card_id,day,market_price_usd,source)
--    select id, (now() at time zone 'utc')::date, market_price_usd, 'catalog'
--    from public.cards where market_price_usd > 0
--    on conflict (card_id, day) do nothing;

-- 4) Cleanup
-- drop function if exists packev_private.gapfill(text[]);
-- drop schema if exists packev_private;
-- drop extension if exists http;
