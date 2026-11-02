-- ============================================================================
-- Remus · Handover 8 (2 Nov 2026): RETURNS. Stephan: "for the slips, you should be able to return purchases.
-- So for example, you've bought ten paint strippers and you only used 5. Then the other 5 should be returned.
-- So we should have something for returning products as well."
--
-- A return starts on the slip the goods were bought on: which items go back and how many (5 of the 10 paint
-- strippers), and what the store should credit. It waits on the "To take back" list until someone takes the
-- goods to the store. Marked "Returned" (date, credit-note number, the amount the store actually gave back, a
-- photo of the credit note), Remus writes a CREDIT: an expense with negative amounts on the same job, stage and
-- kind as the slip, so the job's cost, the stage's actual and the money pages all drop by what came back.
-- Nothing is credited before that, because the money is not back yet.
--
-- Who: the people who snap slips (may_snap_slips, 0028) log and close returns; like slips (0027), a site
-- manager sees the returns they logged and nobody else's. Additive only.
-- ============================================================================
create table if not exists public.slip_returns (
  id uuid primary key default gen_random_uuid(),
  -- The slip the goods were bought on (null: logged without a slip in Remus).
  expense_id uuid references public.expenses (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  stage_id uuid references public.project_stages (id) on delete set null,
  category text not null default 'materials'
    check (category in ('materials', 'labour', 'subcontractor', 'plant_hire', 'transport', 'permits', 'overheads', 'other')),
  supplier text,
  -- The slip's own number: the store asks for it at the returns counter.
  receipt_number text,
  bought_on date,
  -- What goes back: [{ "description": "Paint stripper 5L", "quantity": 5, "unit_price": 189.90, "amount": 949.50 }]
  items jsonb not null default '[]'::jsonb,
  -- What the store should give back, incl. VAT.
  amount_incl numeric(14,2) not null default 0 check (amount_incl >= 0),
  status text not null default 'to_return' check (status in ('to_return', 'returned', 'cancelled')),
  returned_on date,
  credit_number text,
  -- What the store actually gave back, incl. VAT (it can be less: a restocking fee, a damaged tin).
  credit_amount_incl numeric(14,2) check (credit_amount_incl is null or credit_amount_incl >= 0),
  -- Photo of the credit note / return slip, in the private 'receipts' bucket.
  credit_path text,
  -- The credit written when it was returned (an expense with negative amounts).
  credit_expense_id uuid references public.expenses (id) on delete set null,
  note text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists slip_returns_status_idx on public.slip_returns (status, created_at desc);
create index if not exists slip_returns_expense_idx on public.slip_returns (expense_id);
create index if not exists slip_returns_project_idx on public.slip_returns (project_id);
create index if not exists slip_returns_created_by_idx on public.slip_returns (created_by);
create index if not exists slip_returns_credit_expense_idx on public.slip_returns (credit_expense_id);

alter table public.slip_returns enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'slip_returns' and policyname = 'remus_all') then
    create policy "remus_all" on public.slip_returns for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
    -- Seen by those who see the money, and by whoever logged it (a site manager sees their own, as with slips).
    create policy "remus_money_select" on public.slip_returns as restrictive for select to authenticated
      using ((select public.sees_money_records()) or created_by = (select auth.uid()));
    -- Logged and closed by the people who snap slips.
    create policy "remus_snap_insert" on public.slip_returns as restrictive for insert to authenticated
      with check ((select public.may_snap_slips()));
    create policy "remus_snap_update" on public.slip_returns as restrictive for update to authenticated
      using ((select public.may_snap_slips()) and ((select public.sees_money_records()) or created_by = (select auth.uid())))
      with check ((select public.may_snap_slips()));
    create policy "remus_snap_delete" on public.slip_returns as restrictive for delete to authenticated
      using ((select public.may_snap_slips()) and ((select public.sees_money_records()) or created_by = (select auth.uid())));
  end if;
end $$;
