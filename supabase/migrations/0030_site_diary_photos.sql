-- ============================================================================
-- Remus · Handover 5 (29 Oct 2026): PHOTOS IN THE SITE DIARY. Site managers live on their phones; the diary
-- had words only. Each day's entry can now carry photos taken from the phone's camera, shrunk on the phone
-- before they are sent (lib/image.ts). `show_client` is for the client portal's phase 2 (photos the client
-- may see); nothing reads it yet, and it starts off.
--
-- Same access as the diary itself: any active member reads, anybody who may write adds or removes. The files
-- live in a private bucket, opened with short-lived signed links.
-- Additive only: one table, one bucket, their policies.
-- ============================================================================

create table if not exists public.site_diary_photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.site_diary_entries (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  path text not null,
  caption text,
  show_client boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists site_diary_photos_entry_idx on public.site_diary_photos (entry_id);
create index if not exists site_diary_photos_project_idx on public.site_diary_photos (project_id);
alter table public.site_diary_photos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_diary_photos' and policyname = 'remus_all') then
    create policy remus_all on public.site_diary_photos for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
    create policy remus_write_insert on public.site_diary_photos as restrictive for insert to authenticated
      with check ((select public.can_write()));
    create policy remus_write_update on public.site_diary_photos as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
    create policy remus_write_delete on public.site_diary_photos as restrictive for delete to authenticated
      using ((select public.can_write()));
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site_photos_select') then
    create policy "site_photos_select" on storage.objects for select to authenticated
      using (bucket_id = 'site-photos' and (select public.is_active_member()));
    create policy "site_photos_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'site-photos' and (select public.can_write()));
    create policy "site_photos_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'site-photos' and (select public.can_write()));
  end if;
end $$;
