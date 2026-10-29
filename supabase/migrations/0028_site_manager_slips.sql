-- ============================================================================
-- Remus · Handoff 5 (29 Oct 2026): WHO SNAPS SLIPS. Stephan: "It's not a site manager who does purchases,
-- it's a contractor. The site manager manages the site. But it's possible to give him the authority to
-- snap a slip as well."
--
-- Administrators and contractors snap slips; a site manager only when an Administrator ticks "may snap
-- slips" for that person (profiles.can_snap). The database holds the same rule: a restrictive insert policy
-- on expenses, so the screens are not the only thing in the way. Only an Administrator may change can_snap.
-- Additive only: one column, one function, one policy, and the profile guard taught the new column.
-- ============================================================================

alter table public.profiles add column if not exists can_snap boolean not null default false;

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
    new.can_snap := old.can_snap;
  end if;
  return new;
end;
$$;

create or replace function public.may_snap_slips()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'Active'
       and (role = 'Administrator' or (role <> 'Read Only' and (job = 'contractor' or can_snap)))
  );
$$;
revoke execute on function public.may_snap_slips() from anon, public;
grant execute on function public.may_snap_slips() to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'remus_snap_insert') then
    create policy remus_snap_insert on public.expenses as restrictive for insert to authenticated
      with check ((select public.may_snap_slips()));
  end if;
end $$;
