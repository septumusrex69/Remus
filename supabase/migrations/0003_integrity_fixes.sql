-- Remus: data-integrity fixes found in the end-to-end review. Safe to re-run.

-- ---------- Profiles for people who existed before the signup trigger ----------
insert into public.profiles (id, name, email, role, status, avatar_color)
select u.id, coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)), u.email,
       case when not exists (select 1 from public.profiles) and u.id = (select id from auth.users order by created_at limit 1)
            then 'Administrator' else 'Sales Representative' end,
       'Active', '#355069'
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ---------- Numbering never reuses a number ----------
-- If the counter is behind (edited by hand, restored from an old copy), skip past numbers that
-- already exist instead of failing on the unique constraint.
create or replace function public.assign_quote_number()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prefix text;
  n integer;
  candidate text;
begin
  if new.number is null or new.number = '' then
    loop
      update public.company_settings
        set next_quote_number = next_quote_number + 1
        where id = true
        returning quote_prefix, next_quote_number - 1 into prefix, n;
      candidate := coalesce(prefix, 'Q') || '-' || lpad(coalesce(n, 1)::text, 4, '0');
      exit when n is null or not exists (select 1 from public.quotes where number = candidate);
    end loop;
    new.number := candidate;
  end if;
  return new;
end;
$$;

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prefix text;
  n integer;
  candidate text;
begin
  if new.number is null or new.number = '' then
    loop
      update public.company_settings
        set next_invoice_number = next_invoice_number + 1
        where id = true
        returning invoice_prefix, next_invoice_number - 1 into prefix, n;
      candidate := coalesce(prefix, 'INV') || '-' || lpad(coalesce(n, 1)::text, 4, '0');
      exit when n is null or not exists (select 1 from public.invoices where number = candidate);
    end loop;
    new.number := candidate;
  end if;
  return new;
end;
$$;
revoke execute on function public.assign_quote_number() from anon, authenticated, public;
revoke execute on function public.assign_invoice_number() from anon, authenticated, public;

-- ---------- A bank line whose linked expense/payment was deleted needs linking again ----------
create or replace function public.bank_transaction_unlink_orphan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'matched' and new.matched_expense_id is null and new.matched_payment_id is null then
    new.status := 'unmatched';
    new.match_score := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.bank_transaction_unlink_orphan() from anon, authenticated, public;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'bank_transactions_unlink_orphan') then
    create trigger bank_transactions_unlink_orphan before update on public.bank_transactions
      for each row execute function public.bank_transaction_unlink_orphan();
  end if;
end $$;

-- ---------- Deleting an imported statement removes its lines ----------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'bank_transactions_statement_id_fkey' and confdeltype <> 'c'
  ) then
    alter table public.bank_transactions drop constraint bank_transactions_statement_id_fkey;
    alter table public.bank_transactions
      add constraint bank_transactions_statement_id_fkey foreign key (statement_id)
      references public.bank_statements (id) on delete cascade;
  end if;
end $$;

-- ---------- Draft invoices are not "invoiced" yet ----------
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
  from public.invoices where project_id = p.id and status not in ('draft', 'cancelled')
) inv on true
left join lateral (
  select sum(amount) as received from public.payments where project_id = p.id
) pay on true;

-- ---------- .qfx statements ----------
update storage.buckets
set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['application/vnd.intu.qfx']))
where id = 'receipts' and not ('application/vnd.intu.qfx' = any (allowed_mime_types));
