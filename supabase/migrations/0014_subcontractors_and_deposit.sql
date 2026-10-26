-- Subcontractors, and a deposit on acceptance (Stephan, 26 Oct 2026).
--
-- Subcontractors: "there should be a data thing for all the subcontracts that we use... we just put
-- in the fee and this is on our side." One list of the people and firms Urban Haus hires in, with
-- their usual rate, picked on a quote's subcontractor line to fill in the cost. Who does the work
-- and what they charge stays internal: the client sees only the line's description, at our price.
--
-- Deposit: the terms say "50% deposit on acceptance". Each quote carries its own %, starting at 50;
-- accepting a quote offers to create the project and a DRAFT deposit invoice at that %.

create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text,
  contact_person text,
  phone text,
  email text,
  -- The usual fee: rate_amount per rate_unit ('day', 'job', 'hour', 'm²', 'each').
  rate_amount numeric(14,2),
  rate_unit text not null default 'job' check (rate_unit in ('day', 'job', 'hour', 'm²', 'each')),
  vat_no text,
  bank_details text,
  notes text,
  -- 1 to 5, how happy we are with them. Optional.
  rating integer check (rating is null or rating between 1 and 5),
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subcontractors_name_idx on public.subcontractors (lower(name));

alter table public.subcontractors enable row level security;
grant select, insert, update, delete on public.subcontractors to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontractors' and policyname = 'remus_all') then
    create policy "remus_all" on public.subcontractors for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontractors' and policyname = 'remus_write_insert') then
    create policy "remus_write_insert" on public.subcontractors as restrictive for insert to authenticated with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontractors' and policyname = 'remus_write_update') then
    create policy "remus_write_update" on public.subcontractors as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontractors' and policyname = 'remus_write_delete') then
    create policy "remus_write_delete" on public.subcontractors as restrictive for delete to authenticated using ((select public.can_write()));
  end if;
end $$;

-- A subcontractor line knows who it is. Internal: never printed on the quote.
alter table public.quote_items
  add column if not exists subcontractor_id uuid references public.subcontractors (id) on delete set null;

-- The deposit asked for on acceptance, as a % of the total.
alter table public.quotes
  add column if not exists deposit_pct numeric(5,2) not null default 50 check (deposit_pct between 0 and 100);
