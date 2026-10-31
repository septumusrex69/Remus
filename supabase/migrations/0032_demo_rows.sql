-- ============================================================================
-- Remus · Handover 6 (31 Oct 2026). Applied live.
-- 1. Every row of made-up data is listed in demo_rows, so "clear the demo data" can remove exactly those rows
--    and nothing real (supabase/demo/seed.sql fills it). RLS on, no policies.
-- 2. company_settings.max_jobs: how many jobs Urban Haus can run at once (Stephan: "you should be able to set
--    that somewhere. How many jobs can you do ... at a certain time, not to overbook yourself"). The jobs
--    calendar on the Schedule page warns above it. Settings → Company.
-- ============================================================================
create table if not exists public.demo_rows (
  table_name text not null,
  row_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (table_name, row_id)
);
alter table public.demo_rows enable row level security;
alter table public.company_settings add column if not exists max_jobs integer not null default 4 check (max_jobs between 1 and 50);
