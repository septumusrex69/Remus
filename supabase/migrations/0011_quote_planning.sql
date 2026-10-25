-- Planning and pricing a job from the quote (Stephan, 25 Oct 2026). Step 1 of 2: the quote side.
--
--   * Each line is a material, labour or subcontractor cost. Labour is priced per worker per day,
--     senior or junior, at day rates kept in Settings.
--   * Each section of the quote is a stage of the work: how many days, and when it starts (at the
--     beginning, together with another stage, or after another stage finishes, plus or minus days).
--     The quote shows the stages on a timeline and the job's total length.
--   * A management fee (%) on the job, shown to the client as its own line.
--   * An internal approval: a quote is sent only once approved, at the total it was approved at.
--
-- Step 2 (later): the accepted quote's stages become dated project tasks with workers booked.

-- ---------- Settings: rates and defaults ----------
alter table public.company_settings
  add column if not exists labour_day_rate_senior numeric(14,2) not null default 0,
  add column if not exists labour_day_rate_junior numeric(14,2) not null default 0,
  add column if not exists markup_material numeric(7,2) not null default 20,
  add column if not exists markup_labour numeric(7,2) not null default 20,
  add column if not exists markup_subcontractor numeric(7,2) not null default 10,
  add column if not exists management_fee_pct numeric(5,2) not null default 0;

-- ---------- Quotes: management fee and approval ----------
alter table public.quotes
  add column if not exists management_fee_pct numeric(5,2) not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null,
  -- The total excl. VAT it was approved at. A later price change needs approving again.
  add column if not exists approved_total numeric(14,2);

-- ---------- Lines: what kind of cost ----------
alter table public.quote_items
  add column if not exists kind text not null default 'material',
  add column if not exists labour_grade text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_kind_check') then
    alter table public.quote_items add constraint quote_items_kind_check
      check (kind in ('material', 'labour', 'subcontractor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_labour_grade_check') then
    alter table public.quote_items add constraint quote_items_labour_grade_check
      check (labour_grade is null or labour_grade in ('senior', 'junior'));
  end if;
end $$;

-- Labour is counted in days. The unit list gains 'day'.
alter table public.quote_items drop constraint if exists quote_items_unit_check;
alter table public.quote_items add constraint quote_items_unit_check
  check (unit in ('m²', 'm³', 'm', 'each', 'hours', 'day', 'sum'));

-- ---------- Stages: one per section of the quote ----------
create table if not exists public.quote_stages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  -- The section's name; '' is the unnamed first group ("General").
  name text not null default '',
  sort_order integer not null default 0,
  duration_days integer not null default 1 check (duration_days between 0 and 999),
  -- 'start': on day 1. 'with': when start_ref starts. 'after': when start_ref finishes.
  start_mode text not null default 'after' check (start_mode in ('start', 'with', 'after')),
  -- The stage it hangs off (by name); null = the stage before it.
  start_ref text,
  -- Days later (or, negative, earlier) than that: "1 day after the bathroom starts".
  lag_days integer not null default 0 check (lag_days between -999 and 999),
  unique (quote_id, name)
);
create index if not exists quote_stages_quote_id_idx on public.quote_stages (quote_id, sort_order);

alter table public.quote_stages enable row level security;
grant select, insert, update, delete on public.quote_stages to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_stages' and policyname = 'remus_all') then
    create policy "remus_all" on public.quote_stages for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_stages' and policyname = 'remus_write_insert') then
    create policy "remus_write_insert" on public.quote_stages as restrictive for insert to authenticated with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_stages' and policyname = 'remus_write_update') then
    create policy "remus_write_update" on public.quote_stages as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_stages' and policyname = 'remus_write_delete') then
    create policy "remus_write_delete" on public.quote_stages as restrictive for delete to authenticated using ((select public.can_write()));
  end if;
end $$;

-- ---------- Totals: the management fee is part of the price ----------
-- Same columns in the same order (create or replace view can only add at the end), plus the fee.
-- The fee is rounded to cents first, so subtotal + fee - discount = total excl. VAT exactly, as on
-- the quote.
create or replace view public.quote_totals
with (security_invoker = true) as
select
  t.quote_id,
  t.raw_subtotal::numeric(14,2) as subtotal,
  t.estimated_cost,
  t.discount,
  (t.raw_subtotal + t.fee - t.discount)::numeric(14,2) as total_excl,
  round((t.raw_subtotal + t.fee - t.discount) * t.vat_rate / 100, 2) as vat,
  round((t.raw_subtotal + t.fee - t.discount) * (1 + t.vat_rate / 100), 2) as total_incl,
  t.fee as management_fee
from (
  select
    q.id as quote_id,
    coalesce(sum(i.quantity * i.unit_price), 0) as raw_subtotal,
    coalesce(sum(i.quantity * i.unit_cost), 0)::numeric(14,2) as estimated_cost,
    q.discount,
    q.vat_rate,
    round(coalesce(sum(i.quantity * i.unit_price), 0) * q.management_fee_pct / 100, 2) as fee
  from public.quotes q
  left join public.quote_items i on i.quote_id = q.id
  group by q.id
) t;
