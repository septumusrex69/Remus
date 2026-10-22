-- Remus: client email history, ported from Raptor. Safe to re-run.
--
-- 0005 connected each person's mailbox for sending. This adds what reading it needs:
--   * sync watermarks on email_connections (which IMAP messages have already been looked at);
--   * Raptor's `activities` table, where sent and received client emails are filed.
-- The sync (api/_lib/emailSync.ts) files an incoming message on a client when the sender matches a
-- contact or company email, or when it replies to an email sent from Remus. Other mail is ignored.

-- IMAP UIDs are only unique within one folder, so Inbox and Junk each keep their own watermark.
alter table public.email_connections add column if not exists last_seen_uid integer;
alter table public.email_connections add column if not exists last_seen_uid_junk integer;
alter table public.email_connections add column if not exists last_synced_at timestamptz;

-- Raptor's columns, minus the lead/deal links Remus has no tables for. Remus only logs emails here
-- (type 'Email'); the subject starts "Email sent: " or "Email received: " (src/lib/emailActivity.ts).
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  user_id uuid not null references public.profiles (id),
  contact_id uuid references public.contacts (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  subject text not null,
  notes text,
  activity_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- The message's Message-ID header. The unique index below stops a re-sync logging the same
  -- email twice, and a reply's In-Reply-To is matched against it to file the reply on the client.
  email_message_id text,
  -- false for a freshly synced incoming email until someone opens it.
  is_read boolean not null default true,
  -- Attachment names only; the files stay in the mailbox and are fetched on demand.
  attachment_names text[],
  -- Where the message lives in the mailbox, for fetching an attachment later.
  email_folder text,
  email_uid integer
);
-- Not partial, on purpose (as in Raptor): a partial index can't be the ON CONFLICT target of the
-- sync's upsert. NULL message ids never collide with each other.
create unique index if not exists activities_user_email_message_id_key
  on public.activities (user_id, email_message_id);
create index if not exists activities_company_id_idx on public.activities (company_id);
create index if not exists activities_contact_id_idx on public.activities (contact_id);

alter table public.activities enable row level security;
grant select, insert, update, delete on public.activities to authenticated;

-- Same access model as every other table since 0002: active members read and write, and the
-- restrictive policies stop Read Only people (and deactivated ones) from changing anything.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'remus_all') then
    create policy "remus_all" on public.activities for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'remus_write_insert') then
    create policy "remus_write_insert" on public.activities as restrictive for insert to authenticated
      with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'remus_write_update') then
    create policy "remus_write_update" on public.activities as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'remus_write_delete') then
    create policy "remus_write_delete" on public.activities as restrictive for delete to authenticated
      using ((select public.can_write()));
  end if;
end $$;
