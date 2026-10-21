-- Remus: initial schema for a small construction company.
--
-- Remus is built to be merged into Raptor/Romulus later. Tables that overlap with Raptor
-- (teams, profiles, companies, contacts) use Raptor's table names, column names and types, and
-- are created with `if not exists`; the Remus-only columns on them are added with
-- `add column if not exists`. This file can therefore run against a fresh project or against
-- Raptor's existing database without breaking either.
--
-- Access model: a small team. Every signed-in person can read and write all company data.
-- Profiles: everyone can read; each person can update only their own.

create extension if not exists pgcrypto;

-- =====================================================================================
-- Shared with Raptor
-- =====================================================================================

-- ---------- Teams (verbatim from Raptor; profiles.team_id points here) ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  kind text not null default 'Sales' check (kind in ('Sales', 'Communications'))
);

-- ---------- Profiles (columns mirror Raptor's public.profiles exactly) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'Sales Representative'
    check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Team Leader', 'Pre-legal Agent', 'Read Only')),
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  phone text,
  avatar_color text not null default '#355069',
  created_at timestamptz not null default now(),
  email_signature text,
  email_signature_image_url text,
  email_signature_image_width integer,
  email_signature_image_align text not null default 'left' check (email_signature_image_align in ('left', 'center', 'right')),
  buzzbox_extension text
);

-- Same function and trigger names as Raptor, so a merge replaces rather than duplicates them.
-- First person to sign up becomes Administrator; later people default to Raptor's default role.
-- Remus itself does not gate anything on role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, name, email, role, status, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'Administrator' else 'Sales Representative' end,
    'Active',
    '#355069'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- A person may edit their own name/phone, never their own role/status/team.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role(), '') <> 'Administrator' then
    new.role := old.role;
    new.status := old.status;
    new.team_id := old.team_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.protect_profile_privileged_fields() from anon, authenticated, public;
revoke execute on function public.current_user_role() from anon, public;
grant execute on function public.current_user_role() to authenticated;

-- ---------- Companies (Raptor's core columns) ----------
-- A construction client that is a business. A private individual is a contact with no company.
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  phone text,
  email text,
  website text,
  province text,
  city text,
  address text,
  -- Raptor: not null references profiles. Remus defaults it to whoever creates the row.
  account_owner_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  parent_company_id uuid references public.companies (id) on delete set null,
  code text
);
-- Remus additions (needed on quotes and tax invoices to a business client).
alter table public.companies add column if not exists vat_no text;
alter table public.companies add column if not exists reg_no text;
alter table public.companies add column if not exists notes text;
alter table public.companies add column if not exists created_by uuid default auth.uid() references public.profiles (id) on delete set null;

-- ---------- Contacts (Raptor's columns) ----------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  job_title text,
  company_id uuid references public.companies (id) on delete set null,
  email text,
  phone text,
  mobile text,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  last_contact_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
-- Remus additions: a private client's own address and ID/VAT number for quotes.
alter table public.contacts add column if not exists address text;
alter table public.contacts add column if not exists id_number text;
alter table public.contacts add column if not exists created_by uuid default auth.uid() references public.profiles (id) on delete set null;

create index if not exists contacts_company_id_idx on public.contacts (company_id);
create index if not exists companies_account_owner_id_idx on public.companies (account_owner_id);
create index if not exists contacts_owner_id_idx on public.contacts (owner_id);

-- =====================================================================================
-- Remus (construction) tables
-- =====================================================================================

-- ---------- Company settings (single row) ----------
create table if not exists public.company_settings (
  id boolean primary key default true check (id), -- enforces a single row
  name text not null default 'My Construction Co',
  reg_no text,
  vat_no text,
  address text,
  phone text,
  email text,
  logo_url text,
  vat_rate numeric(5,2) not null default 15,
  quote_terms text,
  bank_details text,
  quote_prefix text not null default 'Q',
  next_quote_number integer not null default 1,
  invoice_prefix text not null default 'INV',
  next_invoice_number integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values (true) on conflict (id) do nothing;

-- ---------- Projects (created before quotes so quotes.project_id can reference it) ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  quote_id uuid, -- FK added after quotes exists
  site_address text,
  status text not null default 'planned'
    check (status in ('lead', 'planned', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date date,
  end_date date,
  contract_value numeric(14,2) not null default 0,
  budget numeric(14,2) not null default 0,
  notes text,
  owner_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Quotes ----------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text unique, -- filled from company_settings by trigger when left null
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  title text not null default '',
  site_address text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  issue_date date not null default current_date,
  valid_until date,
  notes text,
  terms text,
  discount numeric(14,2) not null default 0, -- rand amount, excl VAT
  vat_rate numeric(5,2) not null default 15,
  -- Sending: when it last went out and to whom (comma-separated addresses).
  sent_at timestamptz,
  sent_to text,
  owner_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_quote_id_fkey') then
    alter table public.projects
      add constraint projects_quote_id_fkey foreign key (quote_id) references public.quotes (id) on delete set null;
  end if;
end $$;

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  sort_order integer not null default 0,
  section text,
  description text not null default '',
  unit text not null default 'each' check (unit in ('m²', 'm³', 'm', 'each', 'hours', 'sum')),
  quantity numeric(14,3) not null default 1,
  unit_cost numeric(14,2) not null default 0,   -- internal cost
  markup_pct numeric(7,2) not null default 0,
  unit_price numeric(14,2) not null default 0,  -- selling price, excl VAT
  created_at timestamptz not null default now()
);

-- Files designed outside the app (renders, site photos, a polished client PDF of the quote).
-- Stored in the private 'quote-files' bucket. A 'client_pdf' is sent instead of the generated view.
create table if not exists public.quote_attachments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text,
  kind text not null default 'document' check (kind in ('render', 'photo', 'document', 'client_pdf')),
  caption text,
  sort_order integer not null default 0,
  show_on_quote boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Quote numbering: Q-0001, Q-0002, ... taken from company_settings under a row lock.
create or replace function public.assign_quote_number()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prefix text;
  n integer;
begin
  if new.number is null or new.number = '' then
    update public.company_settings
      set next_quote_number = next_quote_number + 1
      where id = true
      returning quote_prefix, next_quote_number - 1 into prefix, n;
    new.number := coalesce(prefix, 'Q') || '-' || lpad(coalesce(n, 1)::text, 4, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists quotes_assign_number on public.quotes;
create trigger quotes_assign_number before insert on public.quotes
  for each row execute function public.assign_quote_number();
revoke execute on function public.assign_quote_number() from anon, authenticated, public;

-- ---------- Expenses ----------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null, -- null = company overhead
  date date not null default current_date,
  category text not null default 'materials'
    check (category in ('materials', 'labour', 'subcontractor', 'plant_hire', 'transport', 'permits', 'overheads', 'other')),
  supplier text,
  description text,
  amount_excl numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  receipt_url text,   -- external link, if the slip lives somewhere else
  paid boolean not null default true,
  -- Slip capture: object path inside the private 'receipts' Storage bucket, the number printed
  -- on the slip, what the AI read off it, and what it suggested (kept for audit).
  receipt_path text,
  receipt_number text,
  ai_extracted jsonb,
  ai_suggestion jsonb,
  source text not null default 'manual' check (source in ('manual', 'receipt', 'bank')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Invoices & payments ----------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  number text unique,
  issue_date date not null default current_date,
  due_date date,
  description text,
  amount_excl numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prefix text;
  n integer;
begin
  if new.number is null or new.number = '' then
    update public.company_settings
      set next_invoice_number = next_invoice_number + 1
      where id = true
      returning invoice_prefix, next_invoice_number - 1 into prefix, n;
    new.number := coalesce(prefix, 'INV') || '-' || lpad(coalesce(n, 1)::text, 4, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_assign_number on public.invoices;
create trigger invoices_assign_number before insert on public.invoices
  for each row execute function public.assign_invoice_number();
revoke execute on function public.assign_invoice_number() from anon, authenticated, public;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  date date not null default current_date,
  amount numeric(14,2) not null default 0, -- incl VAT, as received in the bank
  method text check (method in ('eft', 'cash', 'card', 'cheque', 'other')),
  reference text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Variations ----------
create table if not exists public.variations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  description text not null,
  amount_excl numeric(14,2) not null default 0,
  approved boolean not null default false,
  date date not null default current_date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Diary events (calendar) ----------
-- Raptor's calendar is derived from public.tasks (a single due_date, a status, an owner), which
-- cannot express a timed site visit with an end time and a location. Diary events are a
-- separate table, but use Raptor's relationship column names (owner_id, company_id,
-- contact_id) so a merged calendar can union the two.
create table if not exists public.diary_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  project_id uuid references public.projects (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  location text,
  type text not null default 'other'
    check (type in ('site_visit', 'meeting', 'inspection', 'delivery', 'quote_appointment', 'other')),
  notes text,
  owner_id uuid references public.profiles (id) on delete set null, -- the person assigned
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Site diary ----------
create table if not exists public.site_diary_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null default current_date,
  weather text,
  workers_on_site integer,
  work_done text,
  materials_delivered text,
  delays text,
  safety_notes text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, date)
);

-- ---------- Bank accounts, statements, transactions (reconciliation) ----------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank text check (bank in ('fnb', 'absa', 'standard_bank', 'nedbank', 'capitec', 'investec', 'other')),
  account_number_last4 text,
  -- The CSV column mapping last used for this account, so the next import is one click.
  csv_mapping jsonb,
  -- Seam for a live bank feed (e.g. an aggregator such as Stitch). Not implemented: 'csv' only.
  feed_provider text not null default 'csv',
  feed_external_id text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  period_start date,
  period_end date,
  file_path text,  -- original file in the 'receipts' bucket under statements/
  file_name text,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  imported_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null
);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  statement_id uuid references public.bank_statements (id) on delete set null,
  date date not null,
  description text not null default '',
  amount numeric(14,2) not null, -- negative = money out
  balance numeric(14,2),
  reference text,
  -- Dedupe key: hash of date + amount + normalised description (or the feed's own id).
  external_id text not null,
  status text not null default 'unmatched' check (status in ('unmatched', 'suggested', 'matched', 'ignored')),
  matched_expense_id uuid references public.expenses (id) on delete set null,
  matched_payment_id uuid references public.payments (id) on delete set null,
  match_score numeric(5,2),
  ignore_reason text,
  created_at timestamptz not null default now(),
  unique (bank_account_id, external_id)
);

-- ---------- Indexes on foreign keys ----------
create index if not exists bank_statements_bank_account_id_idx on public.bank_statements (bank_account_id);
create index if not exists bank_transactions_statement_id_idx on public.bank_transactions (statement_id);
create index if not exists bank_transactions_status_idx on public.bank_transactions (status, date);
create index if not exists bank_transactions_matched_expense_id_idx on public.bank_transactions (matched_expense_id);
create index if not exists bank_transactions_matched_payment_id_idx on public.bank_transactions (matched_payment_id);
create index if not exists bank_accounts_created_by_idx on public.bank_accounts (created_by);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists projects_company_id_idx on public.projects (company_id);
create index if not exists projects_contact_id_idx on public.projects (contact_id);
create index if not exists projects_quote_id_idx on public.projects (quote_id);
create index if not exists projects_owner_id_idx on public.projects (owner_id);
create index if not exists quotes_company_id_idx on public.quotes (company_id);
create index if not exists quotes_contact_id_idx on public.quotes (contact_id);
create index if not exists quotes_project_id_idx on public.quotes (project_id);
create index if not exists quotes_owner_id_idx on public.quotes (owner_id);
create index if not exists quote_attachments_quote_id_idx on public.quote_attachments (quote_id, sort_order);
create index if not exists quote_items_quote_id_idx on public.quote_items (quote_id, sort_order);
create index if not exists expenses_project_id_idx on public.expenses (project_id);
create index if not exists expenses_date_idx on public.expenses (date);
create index if not exists invoices_project_id_idx on public.invoices (project_id);
create index if not exists invoices_company_id_idx on public.invoices (company_id);
create index if not exists invoices_contact_id_idx on public.invoices (contact_id);
create index if not exists payments_invoice_id_idx on public.payments (invoice_id);
create index if not exists payments_project_id_idx on public.payments (project_id);
create index if not exists payments_date_idx on public.payments (date);
create index if not exists variations_project_id_idx on public.variations (project_id);
create index if not exists diary_events_start_at_idx on public.diary_events (start_at);
create index if not exists diary_events_project_id_idx on public.diary_events (project_id);
create index if not exists diary_events_company_id_idx on public.diary_events (company_id);
create index if not exists diary_events_contact_id_idx on public.diary_events (contact_id);
create index if not exists diary_events_owner_id_idx on public.diary_events (owner_id);
create index if not exists site_diary_entries_project_id_idx on public.site_diary_entries (project_id, date);

-- =====================================================================================
-- Views
-- =====================================================================================

-- Quote totals, so lists and the dashboard do not need every line item.
create or replace view public.quote_totals
with (security_invoker = true) as
select
  q.id as quote_id,
  coalesce(sum(i.quantity * i.unit_price), 0)::numeric(14,2) as subtotal,
  coalesce(sum(i.quantity * i.unit_cost), 0)::numeric(14,2) as estimated_cost,
  q.discount,
  (coalesce(sum(i.quantity * i.unit_price), 0) - q.discount)::numeric(14,2) as total_excl,
  round((coalesce(sum(i.quantity * i.unit_price), 0) - q.discount) * q.vat_rate / 100, 2) as vat,
  round((coalesce(sum(i.quantity * i.unit_price), 0) - q.discount) * (1 + q.vat_rate / 100), 2) as total_incl
from public.quotes q
left join public.quote_items i on i.quote_id = q.id
group by q.id;

-- Per-project financials. All amounts excl VAT except `received`, which is cash in the bank.
create or replace view public.project_financials
with (security_invoker = true) as
select
  p.id as project_id,
  p.contract_value,
  coalesce(v.approved_variations, 0) as approved_variations,
  p.contract_value + coalesce(v.approved_variations, 0) as revised_contract,
  p.budget,
  coalesce(e.total, 0) as expenses_total,
  coalesce(e.materials, 0) as expenses_materials,
  coalesce(e.labour, 0) as expenses_labour,
  coalesce(e.subcontractor, 0) as expenses_subcontractor,
  coalesce(e.plant_hire, 0) as expenses_plant_hire,
  coalesce(e.transport, 0) as expenses_transport,
  coalesce(e.permits, 0) as expenses_permits,
  coalesce(e.overheads, 0) as expenses_overheads,
  coalesce(e.other, 0) as expenses_other,
  coalesce(inv.invoiced_excl, 0) as invoiced,
  coalesce(inv.invoiced_incl, 0) as invoiced_incl,
  coalesce(pay.received, 0) as received,
  p.contract_value + coalesce(v.approved_variations, 0) - coalesce(e.total, 0) as gross_profit,
  case when p.contract_value + coalesce(v.approved_variations, 0) = 0 then null
       else round((p.contract_value + coalesce(v.approved_variations, 0) - coalesce(e.total, 0))
                  / (p.contract_value + coalesce(v.approved_variations, 0)) * 100, 1)
  end as margin_pct,
  p.budget - coalesce(e.total, 0) as budget_remaining
from public.projects p
left join lateral (
  select sum(amount_excl) as approved_variations
  from public.variations where project_id = p.id and approved
) v on true
left join lateral (
  select
    sum(amount_excl) as total,
    sum(amount_excl) filter (where category = 'materials') as materials,
    sum(amount_excl) filter (where category = 'labour') as labour,
    sum(amount_excl) filter (where category = 'subcontractor') as subcontractor,
    sum(amount_excl) filter (where category = 'plant_hire') as plant_hire,
    sum(amount_excl) filter (where category = 'transport') as transport,
    sum(amount_excl) filter (where category = 'permits') as permits,
    sum(amount_excl) filter (where category = 'overheads') as overheads,
    sum(amount_excl) filter (where category = 'other') as other
  from public.expenses where project_id = p.id
) e on true
left join lateral (
  select sum(amount_excl) as invoiced_excl, sum(amount_excl + vat) as invoiced_incl
  from public.invoices where project_id = p.id and status <> 'cancelled'
) inv on true
left join lateral (
  select sum(amount) as received from public.payments where project_id = p.id
) pay on true;

-- =====================================================================================
-- Grants & Row Level Security
-- =====================================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.company_settings enable row level security;
alter table public.projects enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_attachments enable row level security;
alter table public.expenses enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.variations enable row level security;
alter table public.diary_events enable row level security;
alter table public.site_diary_entries enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_transactions enable row level security;

-- Teams and profiles: read all; update own profile only. (Insert happens via the signup trigger.)
drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams for select to authenticated using (true);

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Everything else: any signed-in team member can read and write.
-- NOTE for the Raptor merge: Raptor has its own, narrower policies on companies/contacts.
-- Drop the two "remus_all" policies below when merging and let Raptor's rules apply.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'contacts', 'company_settings', 'projects', 'quotes', 'quote_items', 'quote_attachments',
    'expenses', 'invoices', 'payments', 'variations', 'diary_events', 'site_diary_entries',
    'bank_accounts', 'bank_statements', 'bank_transactions'
  ] loop
    execute format('drop policy if exists "remus_all" on public.%I', t);
    execute format(
      'create policy "remus_all" on public.%I for all to authenticated using (true) with check (true)', t
    );
  end loop;
end $$;

-- =====================================================================================
-- Storage: private 'receipts' bucket (slips under receipts/, bank statements under statements/)
-- =====================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
        'text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/x-ofx', 'application/octet-stream']
)
on conflict (id) do update set public = false;

drop policy if exists "receipts_select" on storage.objects;
create policy "receipts_select" on storage.objects for select to authenticated
  using (bucket_id = 'receipts');
drop policy if exists "receipts_insert" on storage.objects;
create policy "receipts_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts');
drop policy if exists "receipts_update" on storage.objects;
create policy "receipts_update" on storage.objects for update to authenticated
  using (bucket_id = 'receipts') with check (bucket_id = 'receipts');
drop policy if exists "receipts_delete" on storage.objects;
create policy "receipts_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts');

-- Private 'quote-files' bucket for quote renders, photos and client PDFs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-files', 'quote-files', false, 26214400)
on conflict (id) do update set public = false;

drop policy if exists "quote_files_select" on storage.objects;
create policy "quote_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'quote-files');
drop policy if exists "quote_files_insert" on storage.objects;
create policy "quote_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-files');
drop policy if exists "quote_files_update" on storage.objects;
create policy "quote_files_update" on storage.objects for update to authenticated
  using (bucket_id = 'quote-files') with check (bucket_id = 'quote-files');
drop policy if exists "quote_files_delete" on storage.objects;
create policy "quote_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quote-files');
