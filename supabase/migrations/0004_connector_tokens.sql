-- Remus: personal access tokens for the Claude connector (api/mcp.ts). Safe to re-run.
--
-- A person creates a token in Settings → Claude connector; only its SHA-256 hash is stored, the
-- token itself is shown once. The MCP endpoint looks the hash up with the service-role key and
-- then acts as that person, with the same active/read-only rules as the app.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null default 'Claude',
  token_hash text not null unique,
  token_hint text, -- last 4 characters, to tell tokens apart
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user_id_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;
grant select, insert, update, delete on public.api_tokens to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_tokens' and policyname = 'api_tokens_own') then
    create policy "api_tokens_own" on public.api_tokens for all to authenticated
      using (user_id = auth.uid() and public.is_active_member())
      with check (user_id = auth.uid() and public.is_active_member());
  end if;
end $$;
