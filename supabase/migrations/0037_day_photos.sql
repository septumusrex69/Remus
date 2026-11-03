-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): THE PHOTO OF THE DAY, APPROVED A MONTH AT A TIME. Copied from Raptor S16's
-- portal_day_looks. Stephan: "a photo of the day ... Like for the whole month. That's cool. I like that."
--
-- One row per day: which photograph (an id in src/lib/brandPhotos.ts), where it is framed in the dashboard band and in
-- the sign-in panel, and the line under the greeting. ONLY AN APPROVED ROW IS SHOWN (src/lib/dayPhotos.ts lookFromRow);
-- a day nobody approved shows the photographs chosen on /photos, as before. Every signed-in member may read; the
-- sign-in page reads before anybody is signed in, so anon may read APPROVED rows only; only an Administrator writes.
-- Additive only.
-- ============================================================================
create table if not exists public.day_photos (
  day date primary key,
  photo_id text not null,
  band_x numeric not null default 50 check (band_x between 0 and 100),
  band_y numeric not null default 62 check (band_y between 0 and 100),
  login_x numeric not null default 50 check (login_x between 0 and 100),
  login_y numeric not null default 50 check (login_y between 0 and 100),
  line text,
  who text,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid()
);
create index if not exists day_photos_approved_by_idx on public.day_photos (approved_by);
create index if not exists day_photos_updated_by_idx on public.day_photos (updated_by);

alter table public.day_photos enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'day_photos' and policyname = 'day_photos_read') then
    create policy day_photos_read on public.day_photos for select to authenticated
      using ((select public.is_active_member()));
    create policy day_photos_read_approved on public.day_photos for select to anon
      using (approved_at is not null);
    create policy day_photos_write on public.day_photos for all to authenticated
      using ((select public.current_user_role()) = 'Administrator' and (select public.is_active_member()))
      with check ((select public.current_user_role()) = 'Administrator' and (select public.is_active_member()));
  end if;
end $$;
grant select on public.day_photos to anon, authenticated;
grant insert, update, delete on public.day_photos to authenticated;
