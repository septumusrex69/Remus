-- ============================================================================
-- Remus · Handoff 1 (27 Oct 2026): FIND PRICES REMEMBERS FOR A WEEK.
--
-- Stephan, of a R7 search: "find a better alternative ... reduce this price." The cheapest search is
-- the one not run: a toilet, a 20 mm galvanised pipe, a bag of cement come up on quote after quote.
-- So a search's answer is kept for 7 days, for everybody at Urban Haus, keyed on the way of searching,
-- the words (lower-cased, spaces squeezed) and the stores chosen; the same search inside the week
-- comes back from here, free and at once. A week is short enough that a price on the screen is never
-- older than the "searched on" date it shows.
-- ============================================================================
create table if not exists public.price_cache (
  key text primary key,
  query text not null,
  engine text not null check (engine in ('crawler', 'combined', 'claude')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null
);
create index if not exists price_cache_created_idx on public.price_cache (created_at);
alter table public.price_cache enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'price_cache' and policyname = 'price_cache_select') then
    create policy price_cache_select on public.price_cache for select to authenticated using ((select public.is_active_member()));
    create policy price_cache_insert on public.price_cache for insert to authenticated with check ((select public.is_active_member()));
    create policy price_cache_update on public.price_cache for update to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
end $$;
