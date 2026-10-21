-- Remus: tighten access now that people are added by invite.
--
-- 0001 let every signed-in person read and write everything. This keeps that model for active
-- team members but:
--   * a profile with status 'Inactive' loses all access (deactivate someone instead of deleting),
--   * the 'Read Only' role can read but not insert, update or delete,
--   * an Administrator can edit other people's profiles (role, status, name).
--
-- Written without DROP statements (policies are altered in place, new ones are created only
-- when missing), so it is safe to re-run.

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Active');
$$;

create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'Active' and role <> 'Read Only'
  );
$$;

revoke execute on function public.is_active_member() from anon, public;
revoke execute on function public.can_write() from anon, public;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.can_write() to authenticated;

-- ---------- Company data ----------
-- "remus_all" (permissive) now requires an active member; a restrictive policy per write
-- command additionally requires write access. Restrictive policies are ANDed with permissive ones.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'contacts', 'company_settings', 'projects', 'quotes', 'quote_items', 'quote_attachments',
    'expenses', 'invoices', 'payments', 'variations', 'diary_events', 'site_diary_entries',
    'bank_accounts', 'bank_statements', 'bank_transactions'
  ] loop
    execute format(
      'alter policy "remus_all" on public.%I to authenticated using (public.is_active_member()) with check (public.is_active_member())', t
    );
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_insert') then
      execute format('create policy "remus_write_insert" on public.%I as restrictive for insert to authenticated with check (public.can_write())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_update') then
      execute format('create policy "remus_write_update" on public.%I as restrictive for update to authenticated using (public.can_write()) with check (public.can_write())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_delete') then
      execute format('create policy "remus_write_delete" on public.%I as restrictive for delete to authenticated using (public.can_write())', t);
    end if;
  end loop;
end $$;

-- ---------- Profiles ----------
-- Everyone can always read their own row (the app needs it to show "your access was removed").
alter policy "profiles_select" on public.profiles to authenticated
  using (id = auth.uid() or public.is_active_member());

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_admin') then
    create policy "profiles_update_admin" on public.profiles for update to authenticated
      using (public.current_user_role() = 'Administrator' and public.is_active_member())
      with check (public.current_user_role() = 'Administrator' and public.is_active_member());
  end if;
end $$;

-- ---------- Storage ----------
alter policy "receipts_select" on storage.objects to authenticated
  using (bucket_id = 'receipts' and public.is_active_member());
alter policy "receipts_insert" on storage.objects to authenticated
  with check (bucket_id = 'receipts' and public.can_write());
alter policy "receipts_update" on storage.objects to authenticated
  using (bucket_id = 'receipts' and public.can_write()) with check (bucket_id = 'receipts' and public.can_write());
alter policy "receipts_delete" on storage.objects to authenticated
  using (bucket_id = 'receipts' and public.can_write());

alter policy "quote_files_select" on storage.objects to authenticated
  using (bucket_id = 'quote-files' and public.is_active_member());
alter policy "quote_files_insert" on storage.objects to authenticated
  with check (bucket_id = 'quote-files' and public.can_write());
alter policy "quote_files_update" on storage.objects to authenticated
  using (bucket_id = 'quote-files' and public.can_write()) with check (bucket_id = 'quote-files' and public.can_write());
alter policy "quote_files_delete" on storage.objects to authenticated
  using (bucket_id = 'quote-files' and public.can_write());

-- Public 'branding' bucket for the company logo: it appears on printed quotes, PDFs and emails,
-- so it needs a stable public URL. Anyone can read; only team members with write access upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_insert') then
    create policy "branding_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'branding' and public.can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_update') then
    create policy "branding_update" on storage.objects for update to authenticated
      using (bucket_id = 'branding' and public.can_write()) with check (bucket_id = 'branding' and public.can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_delete') then
    create policy "branding_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'branding' and public.can_write());
  end if;
  -- Upserts read the existing object first, so writers also need select on the bucket.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_select') then
    create policy "branding_select" on storage.objects for select to authenticated
      using (bucket_id = 'branding');
  end if;
end $$;
