-- ============================================================================
-- Remus · Handoff 1 (27 Oct 2026): WHAT CLAUDE COSTS, COUNTED BY REMUS.
--
-- Stephan: "if we're going to be using credits now, on the dashboard ... I want to see how many
-- credits do we have, we use and how many credits do we have left."
--
-- Anthropic does not tell an app its remaining credit (only an organisation admin key reads spend, and
-- Remus has no business holding one). So Remus counts what it spends itself: every Claude call it
-- makes -- Find prices, the slip reader -- writes one row here with its tokens, searches and dollars,
-- worked out from Anthropic's price list at the moment of the call. Stephan enters what he bought
-- (company_settings.ai_credit_usd, Settings -> Integrations); left = bought - everything recorded.
-- It is Remus's own count: the Claude Console stays the authority, and anything else on the same
-- Anthropic account (another app, the Console's own playground) is not in it.
--
-- Rows are written by the server AS THE CALLER (the functions act as the signed-in person), so the
-- insert policy is "your own row"; nobody edits or deletes a cost once recorded.
-- ============================================================================

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  feature text not null check (feature in ('find_prices', 'slip_reader')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  searches integer not null default 0 check (searches >= 0),
  usd numeric(12, 4) not null check (usd >= 0),
  note text
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_usage' and policyname = 'ai_usage_select') then
    create policy ai_usage_select on public.ai_usage for select to authenticated using ((select public.is_active_member()));
    create policy ai_usage_insert on public.ai_usage for insert to authenticated
      with check (user_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
end $$;

alter table public.company_settings add column if not exists ai_credit_usd numeric(12, 2) not null default 0 check (ai_credit_usd >= 0);
