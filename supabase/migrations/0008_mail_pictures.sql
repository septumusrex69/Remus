-- Lean Mail (Raptor S11, 24 Oct 2026): each picture drawn into an email is saved ONCE, under the
-- SHA-256 of its base64, in the private `mail-pictures` bucket; the stored markup names it
-- cid:remus-pic-<hash>. Unused for 30 days -> deleted by the daily sync cron. Applied to the
-- Remus project through the Supabase MCP; policies sit inside DO blocks because the MCP refuses DROP.
create table if not exists public.mail_pictures (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  content_type text not null,
  bytes integer not null,
  created_at timestamptz not null default now(),
  last_used_on date not null default current_date
);
comment on table public.mail_pictures is
  'One row per picture in the mail-pictures bucket (signature logos etc.), keyed by fingerprint. Written by the API with the service key; read by any signed-in user. last_used_on drives the 30-day expiry.';
alter table public.mail_pictures enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mail_pictures' and policyname = 'mail_pictures_read') then
    create policy mail_pictures_read on public.mail_pictures for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'mail_pictures_bucket_read') then
    create policy mail_pictures_bucket_read on storage.objects for select to authenticated using (bucket_id = 'mail-pictures');
  end if;
end $$;
create index if not exists mail_pictures_last_used on public.mail_pictures (last_used_on);

create or replace function public.touch_mail_pictures(p_hashes text[])
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.mail_pictures set last_used_on = current_date
   where hash = any(p_hashes) and last_used_on < current_date;
$$;
revoke all on function public.touch_mail_pictures(text[]) from public, anon;
grant execute on function public.touch_mail_pictures(text[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-pictures', 'mail-pictures', false, 2097152)
on conflict (id) do nothing;
