-- ============================================================================
-- Remus · Handoff 1 (27 Oct 2026): MY STORES -- the branches Urban Haus actually shops at.
--
-- Stephan, of the Google key: "Isn't there any cheaper way to do this? ... do we really need to pay
-- for all of this stupid little things?" The free map (OpenStreetMap) finds most branches but can miss
-- one, and the branch that matters -- the one with the discount -- is one Urban Haus already knows.
-- So it is entered ONCE here, by name and address, and its point is looked up once when it is saved
-- (lat, lon). Every quote's map and Find prices then know it exactly, at no cost and with no outside
-- service between them and it. `store` is the chain (the Find prices ids: builders, cashbuild, ...)
-- or 'other' for a supplier none of the six covers.
-- ============================================================================
create table if not exists public.my_stores (
  id uuid primary key default gen_random_uuid(),
  store text not null default 'other',
  name text not null,
  address text,
  lat double precision,
  lon double precision,
  favourite boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.my_stores enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'my_stores' and policyname = 'remus_all') then
    create policy "remus_all" on public.my_stores for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
    create policy "remus_write_insert" on public.my_stores as restrictive for insert to authenticated with check ((select public.can_write()));
    create policy "remus_write_update" on public.my_stores as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
    create policy "remus_write_delete" on public.my_stores as restrictive for delete to authenticated using ((select public.can_write()));
  end if;
end $$;
