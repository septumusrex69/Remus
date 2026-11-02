-- ============================================================================
-- Remus · Handover 7 (2 Nov 2026): THE SLIP READER'S SIDE-BY-SIDE TEST. Applied live.
-- Stephan: slip reading "heading to about R1,000/month ... Keep accuracy the same ... Run 20 real slips ...
-- through both the old and new setup ... Only make the new setup live once I approve the results."
--
-- One row per slip read both ways at /slip-test (api/receipts/compare.ts): what the first reader (Sonnet, full
-- photo, project list) and the new one (Haiku, shrunk greyscale copy) read off it, their tokens, cost and time,
-- and -- filled in by hand when checked against the slip -- the right answers. Administrators only.
-- Both reads are also in ai_usage (feature slip_reader, note 'trial ...'), so the Claude credit counts them.
-- Additive only. Can be emptied once the test is decided.
-- ============================================================================
create table if not exists public.slip_reader_trials (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  path text not null,
  label text,
  -- The photo as stored, and the copy the new reader sent.
  bytes_in integer,
  bytes_sent integer,
  sent_width integer,
  sent_height integer,
  old_model text,
  old_result jsonb,
  old_input_tokens integer,
  old_output_tokens integer,
  old_usd numeric(12, 4),
  old_ms integer,
  new_model text,
  new_result jsonb,
  new_input_tokens integer,
  new_output_tokens integer,
  new_usd numeric(12, 4),
  new_ms integer,
  -- What is really on the slip, typed in when checked: { supplier, date, slip_number, total_incl, vat }.
  truth jsonb,
  note text
);
create index if not exists slip_reader_trials_at_idx on public.slip_reader_trials (at desc);
alter table public.slip_reader_trials enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'slip_reader_trials' and policyname = 'slip_reader_trials_admin') then
    create policy slip_reader_trials_admin on public.slip_reader_trials for all to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Administrator' and p.status = 'Active'))
      with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Administrator' and p.status = 'Active'));
  end if;
end $$;
