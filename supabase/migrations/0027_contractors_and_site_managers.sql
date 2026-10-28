-- ============================================================================
-- Remus · Handoff 5 (28 Oct 2026): WHO SEES THE MONEY. Stephan: "administrators can see it.
-- Contractors can't see the finances, but everything else they should know more or less ... if we're
-- working in budget ... And then you get site managers." General workers do not sign in; the contractor
-- or a site manager fills in the crew register for them.
--
-- Three kinds of login (plus Read only, unchanged):
--   Administrator  -- everything.
--   Contractor     -- the jobs, plans, crew, clients and quotes as the client sees them; each job's budget
--                     in words and percentages, never in rand. Hidden by the screens.
--   Site manager   -- the jobs, plan, schedule, crew register, diary and Snap slip; no money at all.
--                     Hidden by the screens AND refused by the database, below.
--
-- profiles.role keeps Raptor's list (its check would need a DROP to grow, and Remus never sends one
-- through the connector), so a contractor and a site manager are both role 'Sales Representative' --
-- the "team member" that can write -- told apart by the new profiles.job. job means nothing for an
-- Administrator or Read only. Existing team members become site managers: the least access, changed in
-- Settings -> Users.
-- Additive only: one column, two functions, eight restrictive policies.
-- ============================================================================

alter table public.profiles add column if not exists job text not null default 'site_manager';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_job_check') then
    alter table public.profiles add constraint profiles_job_check check (job in ('contractor', 'site_manager'));
  end if;
end $$;

-- A person may never change their own role, status, team -- nor now their own job.
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
    new.job := old.job;
  end if;
  return new;
end;
$$;

-- MAY THIS PERSON READ MONEY RECORDS? Everybody but a site manager. (A contractor may: their budget
-- warning is worked out from the same slips and invoices as the Administrator's, and the screens show
-- them percentages only.)
create or replace function public.sees_money_records()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'Active'
       and (role in ('Administrator', 'Read Only') or job <> 'site_manager')
  );
$$;
revoke execute on function public.sees_money_records() from anon, public;
grant execute on function public.sees_money_records() to authenticated;

-- RESTRICTIVE, so they narrow the "any active member" policies already there, and remove nothing.
do $$
declare t text;
begin
  foreach t in array array['invoices', 'payments', 'variations', 'bank_accounts', 'bank_statements', 'bank_transactions', 'ai_usage'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_money_select') then
      execute format('create policy remus_money_select on public.%I as restrictive for select to authenticated using ((select public.sees_money_records()))', t);
    end if;
  end loop;
  -- Slips: a site manager snaps them, so sees the ones they captured and nobody else's.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'remus_money_select') then
    create policy remus_money_select on public.expenses as restrictive for select to authenticated
      using ((select public.sees_money_records()) or created_by = (select auth.uid()));
  end if;
end $$;
