-- ============================================================================
-- Remus · Handover 6 (31 Oct 2026): THE BUDGET ALERT IN THE BELL, GREEN TO YELLOW TO RED.
-- Stephan: "like a notification ... it should like change color ... for your budget alert when it comes
-- close to the end of the budget. Beginning with green, moving to yellow, and then red."
--
-- A job's spend is worked out in the browser (lib/projectScores.ts: slips + crew register against the
-- quoted cost), so the screen that scores a job tells the database which level it has reached:
--   yellow -- 75% of the quoted cost used (getting close)
--   red    -- 90% used (nearly at the end)
--   over   -- past 100% (over budget), red too
-- Each level is told ONCE per job (budget_alerts), never a level below one already told, and goes to
-- every active Administrator and contractor (the people who see the budget, lib/access.ts). The bell
-- shows one line per job (same link), coloured by the newest level.
-- Additive only: a table, a function. Nothing dropped or changed.
-- ============================================================================
create table if not exists public.budget_alerts (
  project_id uuid not null references public.projects (id) on delete cascade,
  level text not null check (level in ('yellow', 'red', 'over')),
  pct integer not null,
  created_at timestamptz not null default now(),
  primary key (project_id, level)
);
-- No policies: only the function below reads or writes it.
alter table public.budget_alerts enable row level security;

create or replace function public.remus_budget_alert(p_project uuid, p_level text, p_pct integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rank int := case p_level when 'yellow' then 1 when 'red' then 2 when 'over' then 3 end;
  v_name text;
  v_status text;
  v_pct int := greatest(0, least(coalesce(p_pct, 0), 999));
  v_msg text;
begin
  if v_rank is null then
    raise exception 'Unknown budget level %.', p_level using errcode = '22023';
  end if;
  if not public.is_active_member() or not public.sees_money_records() then
    raise exception 'Your access does not include budgets.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(coalesce(code, '') || ' ' || name), ''), 'A job'), status into v_name, v_status
    from public.projects where id = p_project;
  if v_status is null or v_status not in ('active', 'on_hold') then
    return false;
  end if;
  -- Never a level at or below one already told for this job.
  if exists (
    select 1 from public.budget_alerts a
     where a.project_id = p_project
       and (case a.level when 'yellow' then 1 when 'red' then 2 else 3 end) >= v_rank
  ) then
    return false;
  end if;
  insert into public.budget_alerts (project_id, level, pct) values (p_project, p_level, v_pct)
    on conflict do nothing;
  if not found then
    return false;
  end if;
  v_msg := v_name || ': ' || case p_level
    when 'yellow' then v_pct || '% of the budget used -- getting close'
    when 'red' then v_pct || '% of the budget used -- nearly at the end'
    else 'over budget (' || v_pct || '% of the budget used)'
  end;
  insert into public.notifications (user_id, type, message, link)
  select p.id, 'budget.' || p_level, v_msg, '/projects/' || p_project
    from public.profiles p
   where p.status = 'Active'
     and (p.role = 'Administrator' or (p.role <> 'Read Only' and p.job = 'contractor'));
  return true;
end
$$;
revoke execute on function public.remus_budget_alert(uuid, text, integer) from anon, public;
grant execute on function public.remus_budget_alert(uuid, text, integer) to authenticated;
