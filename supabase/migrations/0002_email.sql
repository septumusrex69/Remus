-- Remus: per-person mailboxes and client email history, ported from Raptor.
--
-- Same table and column names as Raptor (email_connections, activities), created with
-- `if not exists`, so this can run against Raptor's database at merge time without changing it.
-- Safe to re-run.

-- ---------- Email connections (verbatim from Raptor) ----------
-- One mailbox per person. last_seen_uid is the INBOX IMAP UID watermark, and last_seen_uid_junk
-- the same for the Junk/Spam folder (IMAP UIDs are only unique within one folder).
--
-- RLS is enabled with NO policies on purpose: the rows hold mailbox credentials, so no browser
-- can read them at all, only the api/email/* functions holding the service-role key. The
-- passwords are AES-GCM encrypted on top of that (EMAIL_CREDENTIALS_KEY). Supabase's advisor
-- reports "RLS enabled, no policy" for this table; that is expected. Do not add a policy.
create table if not exists public.email_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  smtp_host text not null,
  smtp_port integer not null default 587,
  imap_host text not null,
  imap_port integer not null default 993,
  encrypted_password text not null,
  last_seen_uid integer,
  last_seen_uid_junk integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_connections enable row level security;

-- ---------- Activities (Raptor's columns, minus the lead/deal links Remus has no tables for) ----------
-- Remus only logs emails here for now: type = 'Email', with the subject prefixed
-- "Email sent: " or "Email received: " (see src/lib/emailActivity.ts).
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
  -- The message's Message-ID header. Synced and sent emails both record it: the unique index
  -- below stops a re-sync logging the same email twice, and a reply's In-Reply-To is matched
  -- against it to file the reply on the same client.
  email_message_id text,
  -- false for a freshly synced incoming email until someone opens it.
  is_read boolean not null default true,
  -- Attachment file names only; the files stay in the mailbox and are fetched on demand.
  attachment_names text[],
  -- Where the message lives in the mailbox, for fetching an attachment later.
  email_folder text,
  email_uid integer
);
-- Not partial, on purpose (see Raptor's schema.sql): a partial index cannot be the ON CONFLICT
-- target of the sync's upsert. NULL message ids never collide with each other.
create unique index if not exists activities_user_email_message_id_key
  on public.activities (user_id, email_message_id);
create index if not exists activities_company_id_idx on public.activities (company_id);
create index if not exists activities_contact_id_idx on public.activities (contact_id);

alter table public.activities enable row level security;
-- Same access model as the rest of Remus: every signed-in team member can read and write.
-- NOTE for the Raptor merge: Raptor has its own policies on activities; drop this one there.
drop policy if exists "remus_all" on public.activities;
create policy "remus_all" on public.activities for all to authenticated using (true) with check (true);
