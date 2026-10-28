-- ============================================================================
-- Remus · Handoff 1 (28 Oct 2026): THE CREW REGISTER -- who was actually on which site, each day.
--
-- Stephan: "like a certain person is at a certain site ... on a certain day. We need to keep track of
-- that." A booking (stage_bookings, 0016) is the PLAN; this is what HAPPENED. One row per person, site
-- and day: there (1 day, or 0.5 for a half day) or not there (0). Someone who came unbooked is a row
-- with no booking behind it.
--
-- `day_cost` is COPIED from the worker when the day is registered. A raise next month must not change
-- what last month's wages and job costs were.
--
-- Labour cost and the weekly wage list read this; where a booked day has no row yet, the booking still
-- counts (as "not confirmed"), so nothing drops to zero before the register is in use.
-- ============================================================================
create table if not exists public.crew_days (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  stage_id uuid references public.project_stages (id) on delete set null,
  day date not null,
  days numeric(3, 1) not null default 1 check (days in (0, 0.5, 1)),
  day_cost numeric(12, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (worker_id, project_id, day)
);
create index if not exists crew_days_day_idx on public.crew_days (day);
create index if not exists crew_days_project_idx on public.crew_days (project_id);
alter table public.crew_days enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'crew_days' and policyname = 'remus_all') then
    create policy "remus_all" on public.crew_days for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
    create policy "remus_write_insert" on public.crew_days as restrictive for insert to authenticated with check ((select public.can_write()));
    create policy "remus_write_update" on public.crew_days as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
    create policy "remus_write_delete" on public.crew_days as restrictive for delete to authenticated using ((select public.can_write()));
  end if;
end $$;
