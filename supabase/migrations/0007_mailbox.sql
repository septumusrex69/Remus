-- Remus: each person's whole mailbox inside the app, ported from Raptor (user_emails, mail_blocks).
-- Safe to re-run.
--
-- 0006 filed only mail from known clients (activities). This keeps every message the sync reads
-- (Inbox, Junk and Sent), so the Mail page is the person's mailbox, not just client mail. A
-- message from a known client is still filed on that client automatically, as before.
--
-- Unlike Raptor, the body is kept too (capped): Remus is one small firm, not 50 agents on 3 750
-- messages a day, and keeping it means a message opens instantly instead of a round trip to the
-- mail server. Raptor's size caps apply (text 100 000 chars, HTML 1 MB).

create table if not exists public.user_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Where to find the message again in the mailbox (attachments are fetched from there).
  folder text not null,
  uid bigint not null,
  -- Always set by the sync; a synthetic "user:folder:uid" when the message carries none.
  message_id text,

  from_address text not null,
  from_name text,
  subject text,
  -- The first couple of hundred characters, for the list.
  snippet text,
  attachment_names text[] not null default '{}',
  -- Arrived in the Junk folder, or marked junk in Remus. Hidden from All, shown under Junk.
  is_junk boolean not null default false,

  -- Read off the Sent folder: mail sent from Remus, Outlook or a phone alike.
  is_sent boolean not null default false,
  to_address text,
  to_name text,
  -- Everyone on the message, as [{ "name": ..., "address": ... }], so Reply all reaches them.
  to_recipients jsonb not null default '[]'::jsonb,
  cc_recipients jsonb not null default '[]'::jsonb,

  occurred_at timestamptz not null,
  read_at timestamptz,

  -- The client this message is filed on: by the sync (sender matches a contact or company, or a
  -- reply to mail sent from Remus) or by someone pressing "File on a client".
  linked_company_id uuid references public.companies (id) on delete set null,
  linked_contact_id uuid references public.contacts (id) on delete set null,
  linked_at timestamptz,
  linked_by uuid references public.profiles (id) on delete set null,

  body_text text,
  body_html text,
  body_cached_at timestamptz,

  created_at timestamptz not null default now()
);

-- One row per message per mailbox, however often the sync re-reads it.
create unique index if not exists user_emails_message_idx on public.user_emails (user_id, message_id);
create index if not exists user_emails_inbox_idx on public.user_emails (user_id, occurred_at desc);
create index if not exists user_emails_unread_idx
  on public.user_emails (user_id, occurred_at desc)
  where read_at is null and is_sent = false and is_junk = false;

alter table public.user_emails enable row level security;
grant select, update, delete on public.user_emails to authenticated;

-- Your own mailbox only, enforced here and not by the page, as in Raptor: not even an
-- administrator reads a colleague's inbox. Rows are written by the sync with the service key.
-- (Mail filed on a client is still visible to the team, through the client's Emails card.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_emails' and policyname = 'user_emails_own_select') then
    create policy "user_emails_own_select" on public.user_emails for select to authenticated
      using (user_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_emails' and policyname = 'user_emails_own_update') then
    create policy "user_emails_own_update" on public.user_emails for update to authenticated
      using (user_id = (select auth.uid()) and (select public.is_active_member()))
      with check (user_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_emails' and policyname = 'user_emails_own_delete') then
    create policy "user_emails_own_delete" on public.user_emails for delete to authenticated
      using (user_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
end $$;

-- Senders whose mail never reaches Remus (Raptor's mail_blocks). Per person.
create table if not exists public.mail_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pattern text not null,
  kind text not null check (kind in ('address', 'domain')),
  label text,
  created_at timestamptz not null default now()
);
create unique index if not exists mail_blocks_pattern_idx on public.mail_blocks (user_id, pattern);
alter table public.mail_blocks enable row level security;
grant select, insert, update, delete on public.mail_blocks to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mail_blocks' and policyname = 'mail_blocks_own') then
    create policy "mail_blocks_own" on public.mail_blocks for all to authenticated
      using (user_id = (select auth.uid()) and (select public.is_active_member()))
      with check (user_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
end $$;

-- The Sent folder gets its own watermark (IMAP UIDs are per folder).
alter table public.email_connections add column if not exists last_seen_uid_sent integer;

-- Mailboxes connected before this migration only ever stored client mail. Start their Inbox and
-- Junk again from the latest messages so the Mail page isn't empty; client mail already filed is
-- not filed twice (activities are unique per mailbox and Message-ID).
update public.email_connections
  set last_seen_uid = null, last_seen_uid_junk = null
  where not exists (select 1 from public.user_emails e where e.user_id = email_connections.user_id);
