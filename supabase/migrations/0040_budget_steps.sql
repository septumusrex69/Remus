-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): BUDGET WARNINGS IN THE BELL AT 50%, 75%, 90% AND 100%. Stephan: "Budget warnings,
-- I think, should be by the bell, and intervals ... 50%, 75%, 90%, and then 100%."
--
-- 0031 told the bell at 75% (yellow), 90% (red) and past 100% (over). Its table only knows those three words and
-- widening its check would need a DROP (CLAUDE.md: never through the connector), so the steps get their own table,
-- by number, seeded from what 0031 already told so nothing is said twice. remus_budget_step replaces
-- remus_budget_alert for the app (the old one stays, unused). Each step is told ONCE per job, never a step at or
-- below one already told; 100% now means "the whole budget is used", not "past it".
-- Notification types: budget.half (50), budget.yellow (75), budget.red (90), budget.over (100) -- the bell's dots.
-- Additive only.
-- ============================================================================
create table if not exists public.budget_alert_steps (
  project_id uuid not null references public.projects (id) on delete cascade,
  step integer not null check (step in (50, 75, 90, 100)),
  pct integer not null,
  told_at timestamptz not null default now(),
  primary key (project_id, step)
);
alter table public.budget_alert_steps enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'budget_alert_steps' and policyname = 'budget_alert_steps_read') then
    create policy budget_alert_steps_read on public.budget_alert_steps for select to authenticated
      using ((select public.is_active_member()) and (select public.sees_money_records()));
  end if;
end $$;

-- What 0031 already told counts as told.
insert into public.budget_alert_steps (project_id, step, pct, told_at)
select project_id, case level when 'yellow' then 75 when 'red' then 90 else 100 end, pct, coalesce(created_at, now())
  from public.budget_alerts
on conflict do nothing;

create or replace function public.remus_budget_step(p_project uuid, p_step integer, p_pct integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text;
  v_status text;
  v_pct int := greatest(0, least(coalesce(p_pct, 0), 999));
  v_msg text;
begin
  if p_step not in (50, 75, 90, 100) then
    raise exception 'Unknown budget step %.', p_step using errcode = '22023';
  end if;
  if not public.is_active_member() or not public.sees_money_records() then
    raise exception 'Your access does not include budgets.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(coalesce(code, '') || ' ' || name), ''), 'A job'), status into v_name, v_status
    from public.projects where id = p_project;
  if v_status is null or v_status not in ('active', 'on_hold') then
    return false;
  end if;
  if exists (select 1 from public.budget_alert_steps s where s.project_id = p_project and s.step >= p_step) then
    return false;
  end if;
  insert into public.budget_alert_steps (project_id, step, pct) values (p_project, p_step, v_pct) on conflict do nothing;
  if not found then
    return false;
  end if;
  v_msg := v_name || ': ' || case p_step
    when 50 then v_pct || '% of the budget used · half way'
    when 75 then v_pct || '% of the budget used · getting close'
    when 90 then v_pct || '% of the budget used · nearly at the end'
    else v_pct || '% of the budget used · the whole budget is spent'
  end;
  insert into public.notifications (user_id, type, message, link)
  select p.id, 'budget.' || case p_step when 50 then 'half' when 75 then 'yellow' when 90 then 'red' else 'over' end, v_msg, '/projects/' || p_project
    from public.profiles p
   where p.status = 'Active'
     and (p.role = 'Administrator' or (p.role <> 'Read Only' and p.job = 'contractor'));
  return true;
end
$$;
revoke execute on function public.remus_budget_step(uuid, integer, integer) from anon, public;
grant execute on function public.remus_budget_step(uuid, integer, integer) to authenticated;
