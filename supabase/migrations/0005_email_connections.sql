-- Remus: each person sends from their own mailbox, as in Raptor. Safe to re-run.
--
-- A person connects their mailbox in Settings → My email (SMTP to send, IMAP to file a copy in
-- their Sent folder). The password is AES-256-GCM encrypted with EMAIL_CREDENTIALS_KEY before it
-- is stored (api/_lib/crypto.ts).
--
-- email_connections deliberately has RLS enabled and NO policies, so no browser can read it at
-- all; only api/email/mailbox.ts and api/quotes/send.ts, holding the service-role key, can. The
-- encryption is the second lock. Supabase's security advisor reports this as "RLS enabled, no
-- policy". That report is expected. Do not resolve it by adding a policy.
--
-- The signature columns (profiles.email_signature, …) already exist from 0001.

create table if not exists public.email_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  smtp_host text not null,
  smtp_port integer not null default 465,
  imap_host text not null,
  imap_port integer not null default 993,
  encrypted_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_connections enable row level security;
revoke all on public.email_connections from anon, authenticated;
