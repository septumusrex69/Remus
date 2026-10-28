-- ============================================================================
-- Remus · Handoff 5 (28 Oct 2026): THE CLIENT PORTAL, PHASE 1 -- copied from Raptor H13's client_portal.
--
-- Stephan: "Client portal can be a good idea. To see their progresses and things." A client signs in
-- with an emailed code and sees their own projects (where each stage stands), the quotes sent to them,
-- and their invoices with what is paid and still owing. Nothing internal: no costs, no profit, no crew.
--
-- A CLIENT IS NEVER A SUPABASE USER (Raptor's rule, and Remus's for the same reason): Remus's policies
-- read "any active member" -- a client given an ordinary login would be one policy slip away from every
-- other client's quotes. So these three tables have RLS ON AND NO POLICIES: anon and authenticated can
-- neither read nor write them, and the portal's server (api/portal, the service role) is the only door.
-- Everything it returns is filtered by the client the session belongs to.
--
-- DIFFERENT FROM RAPTOR: a Remus client is a company OR a private person (a contact with no company),
-- so a portal login belongs to exactly one of the two.
-- Additive only: three new tables.
-- ============================================================================

create table if not exists public.client_portal_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  email text not null,
  name text not null default '',
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  active boolean not null default true,
  last_login_at timestamptz,
  constraint client_portal_users_one_client check ((company_id is null) <> (contact_id is null))
);
-- ONE ADDRESS, ONE CLIENT: a sign-in is "type your email", so an address on two clients would have to
-- ask which, and the answer would be the person choosing whose jobs to read.
create unique index if not exists client_portal_users_email_key on public.client_portal_users (lower(email));
create index if not exists client_portal_users_company_idx on public.client_portal_users (company_id);
create index if not exists client_portal_users_contact_idx on public.client_portal_users (contact_id);
alter table public.client_portal_users enable row level security;
comment on table public.client_portal_users is
  'Client people who may sign in to the portal (Remus H5). No policies: only api/portal (service role) reads or writes it.';

create table if not exists public.client_portal_codes (
  user_id uuid primary key references public.client_portal_users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  window_started_at timestamptz not null default now(),
  sends_in_window integer not null default 1
);
alter table public.client_portal_codes enable row level security;
comment on table public.client_portal_codes is
  'The six digits a portal sign-in emails, kept only as a keyed hash (Remus H5).';

create table if not exists public.client_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.client_portal_users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  device text not null default ''
);
create index if not exists client_portal_sessions_user_idx on public.client_portal_sessions (user_id);
alter table public.client_portal_sessions enable row level security;
comment on table public.client_portal_sessions is
  'A signed-in portal browser (Remus H5). The browser holds the token; only its keyed hash is kept.';
