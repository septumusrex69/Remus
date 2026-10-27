-- Workers, the project plan, and quoted vs actual (Stephan, 26 Oct 2026). Step 2 of planning.
--
--   * workers: the people on site. Separate from logins (Raptor's People are staff with logins and
--     salaries; most of Urban Haus's workers never sign in and are paid by the day).
--   * project_stages: an accepted quote's stages with real dates, and what each was quoted at
--     (sell, and cost by kind) so the project can show quoted against actual per stage.
--   * stage_bookings: who works on a stage, and when. The same worker on two overlapping bookings
--     is a double booking; the app warns, it does not forbid (a half day here and there is real).
--   * expenses.stage_id: a slip filed against a stage, for the actual cost per stage.

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text,
  grade text not null default 'senior' check (grade in ('senior', 'junior')),
  -- What a day of this person costs Urban Haus.
  day_cost numeric(14,2) not null default 0 check (day_cost >= 0),
  phone text,
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default '',
  sort_order integer not null default 0,
  start_date date,
  -- The last working day of the stage (inclusive).
  end_date date,
  -- From the quote, excl. VAT: what the client pays for this stage, and what it should cost us.
  quoted_sell numeric(14,2) not null default 0,
  quoted_material numeric(14,2) not null default 0,
  quoted_labour numeric(14,2) not null default 0,
  quoted_subcontractor numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists project_stages_project_idx on public.project_stages (project_id, sort_order);

create table if not exists public.stage_bookings (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.project_stages (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (stage_id, worker_id)
);
create index if not exists stage_bookings_worker_idx on public.stage_bookings (worker_id, start_date);
create index if not exists stage_bookings_stage_idx on public.stage_bookings (stage_id);

alter table public.expenses
  add column if not exists stage_id uuid references public.project_stages (id) on delete set null;
create index if not exists expenses_stage_idx on public.expenses (stage_id);

-- Access: the same rules as every other company table.
do $$
declare
  t text;
begin
  foreach t in array array['workers', 'project_stages', 'stage_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_all') then
      execute format('create policy "remus_all" on public.%I for all to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_insert') then
      execute format('create policy "remus_write_insert" on public.%I as restrictive for insert to authenticated with check ((select public.can_write()))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_update') then
      execute format('create policy "remus_write_update" on public.%I as restrictive for update to authenticated using ((select public.can_write())) with check ((select public.can_write()))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'remus_write_delete') then
      execute format('create policy "remus_write_delete" on public.%I as restrictive for delete to authenticated using ((select public.can_write()))', t);
    end if;
  end loop;
end $$;
