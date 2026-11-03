-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): BIG BOSS. Copied from Raptor S15 (big_boss, big_boss_queue). Stephan: "for now,
-- I think like I'm the only person that can approve any changes. Later, we can like try and change that."
--
-- A TICK ON THE PROFILE, NOT A ROLE (Raptor's reasoning: a new role would touch every list of role names for one
-- person). Remus has no capability lists, so it is a column, like can_snap (0028). The screen calls it Big Boss.
--
-- WHAT IT DECIDES: approving a change request (new -> accepted), declining one, reopening a declined one (approving it
-- after all), and asking Claude to build (build_requested_at from nothing to a time). An Administrator still assigns,
-- asks, notes, sets priority and takes a request OFF the queue (stopping work is never the dangerous direction);
-- testing and "Not right yet" stay everybody's. The server (no signed-in person: Claude's own tools, the nightly
-- review) passes, as in Raptor.
--
-- ONLY A BIG BOSS MAKES ANOTHER: the profile guard RAISES for anybody else, so an Administrator cannot tick it for
-- themselves (a silent revert would read as "saved"). Stephan is the Big Boss, by his address. Additive only.
-- ============================================================================
alter table public.profiles add column if not exists is_boss boolean not null default false;

create or replace function public.is_big_boss()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Active' and is_boss);
$$;
revoke execute on function public.is_big_boss() from anon, public;
grant execute on function public.is_big_boss() to authenticated;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_boss is distinct from old.is_boss and auth.uid() is not null and not public.is_big_boss() then
    raise exception 'Only the Big Boss can make somebody Big Boss, or stop them being one.' using errcode = '42501';
  end if;
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

create or replace function public.change_request_boss_decides()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The server, Claude's own tools and the nightly review act with no signed-in person.
  if auth.uid() is null or coalesce(current_setting('role', true), '') = 'service_role' then return new; end if;
  if public.is_big_boss() then return new; end if;
  if (new.status is distinct from old.status
        and ((old.status = 'new' and new.status = 'accepted') or new.status = 'declined' or (old.status = 'declined' and new.status <> 'declined')))
     or (old.build_requested_at is null and new.build_requested_at is not null) then
    raise exception 'Only the Big Boss approves or declines what gets built in Remus.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- No DROP here (CLAUDE.md: the Supabase connector waits on a confirmation for any DROP): created only if missing.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'change_request_boss_decides') then
    create trigger change_request_boss_decides before update of status, build_requested_at on public.change_requests
      for each row execute function public.change_request_boss_decides();
  end if;
end $$;

-- STEPHAN IS THE BIG BOSS, by his address (no signed-in person here, so the guard lets it through).
update public.profiles set is_boss = true where lower(email) = 'stephan@urbanhausgroup.co.za' and not is_boss;
