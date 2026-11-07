-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): CRASH REPORTS. Copied from Raptor 55a7520 (4 Nov, "get told when it breaks") and
-- its error_reports table. Stephan, 7 Nov, on what Raptor has that Remus does not: "We can like start with pretty much
-- all of that."
--
-- Every crash the app hits in somebody's browser on the live site, so a bug is known before somebody has to mention
-- it. Written ONLY by the server (api/portal/report-error, with the service role, which passes row-level security):
-- one row per distinct error per 6 hours, `occurrences` counting repeats. The first sighting is emailed to the active
-- Administrators and put on their bell -- at most three alerts an hour across all errors (`alerted_at` is how the
-- server counts them), so a bad deploy is three emails, not three hundred. See api/_lib/errorAlert.ts.
--
-- DIFFERENT FROM RAPTOR: `alerted_at` (Raptor deduplicates per error only; Remus also caps the hour, as asked), and
-- the policies are created only when missing instead of being replaced. Additive only.
-- ============================================================================
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  message text not null,
  stack text,
  component_stack text,
  source text not null,
  first_url text,
  last_url text,
  user_agent text,
  build text,
  user_id uuid references public.profiles (id) on delete set null,
  user_email text,
  occurrences integer not null default 1,
  resolved boolean not null default false,
  alerted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists error_reports_fingerprint_idx on public.error_reports (fingerprint, last_seen_at desc);
create index if not exists error_reports_recent_idx on public.error_reports (last_seen_at desc);
create index if not exists error_reports_alerted_idx on public.error_reports (alerted_at desc) where alerted_at is not null;
create index if not exists error_reports_user_idx on public.error_reports (user_id);

alter table public.error_reports enable row level security;

-- Administrators read them and mark them resolved. Nobody writes from the browser: reports go through the server,
-- which checks and caps every field.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'error_reports' and policyname = 'error_reports_admin_read') then
    create policy error_reports_admin_read on public.error_reports for select to authenticated
      using ((select public.current_user_role()) = 'Administrator');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'error_reports' and policyname = 'error_reports_admin_resolve') then
    create policy error_reports_admin_resolve on public.error_reports for update to authenticated
      using ((select public.current_user_role()) = 'Administrator')
      with check ((select public.current_user_role()) = 'Administrator');
  end if;
end $$;
