-- Remus · Handoff 2 (28 Oct 2026): two things copied from Raptor · Handoff 14's change requests.
-- Additive only: one new table and two functions; nothing existing is changed or removed.

-- 1. CORRECT THE WORDING (Raptor's change_request_edit + change_request_edit_until_built). Stephan, on
-- Raptor: edit a request "just to correct spelling, mistakes". The sender or an Administrator may correct
-- a request's words until Claude starts building it (New or Approved, the build queue included); once it
-- is In development, released or declined, the words are the record. The words it replaced are kept.
--
-- Different from Raptor, on purpose: Raptor keeps the old words as a change_request_events row of a new
-- kind 'edited', which means replacing that table's kind check (removing the old one first). Remus keeps them in
-- their own table instead, so nothing existing is touched; the panel's history shows them as 'edited'.
create table if not exists public.change_request_edits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.change_requests (id) on delete cascade,
  old_description text not null,
  by_id uuid default auth.uid() references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists change_request_edits_request_idx on public.change_request_edits (request_id, at);
alter table public.change_request_edits enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'change_request_edits' and policyname = 'change_request_edits_select') then
    -- Read like the rest of a request's history; written only by change_request_edit below.
    create policy change_request_edits_select on public.change_request_edits for select to authenticated
      using ((select public.is_active_member()));
  end if;
end $$;

-- SECURITY DEFINER because change_requests_update is Administrators' only: this changes one column, under
-- the conditions below, and nothing else. No notification: a spelling fix is not news.
create or replace function public.change_request_edit(p_number bigint, p_description text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  r public.change_requests;
  v_new text := btrim(coalesce(p_description, ''));
begin
  select * into r from public.change_requests where number = p_number;
  if r.id is null then raise exception 'There is no request R-%.', p_number using errcode = '22023'; end if;
  if not public.is_active_member() then raise exception 'Your access to Remus has been removed.' using errcode = '42501'; end if;
  if auth.uid() is distinct from r.created_by and coalesce(public.current_user_role(), '') <> 'Administrator' then
    raise exception 'Only the person who sent R-%, or an Administrator, may correct it.', p_number using errcode = '42501';
  end if;
  if r.status not in ('new', 'accepted') then
    raise exception 'Claude has started on R-% (or it is finished), so its words are the record now. Add a comment instead.', p_number using errcode = '22023';
  end if;
  if v_new = '' then raise exception 'A request needs words.' using errcode = '22023'; end if;
  if v_new = btrim(r.description) then return; end if;
  update public.change_requests set description = v_new where id = r.id;
  insert into public.change_request_edits (request_id, old_description, by_id) values (r.id, r.description, auth.uid());
end $$;
revoke all on function public.change_request_edit(bigint, text) from public, anon;
grant execute on function public.change_request_edit(bigint, text) to authenticated;

-- 2. A COUNT ON REQUESTS IN THE SIDEBAR, LIKE MAIL'S (Raptor's nav_request_count). Stephan, on Raptor:
-- "if I have a new suggestion from the light bulb, show me how many there are ... on the sidebar". Kept to
-- what one person can clear: for an Administrator, every request still waiting for a decision (New); for
-- anybody, their own released requests still waiting for their test.
create or replace function public.nav_request_count()
returns integer language sql stable security invoker set search_path to 'public' as $$
  select (
    (select count(*) from public.change_requests
      where status = 'new' and coalesce(public.current_user_role(), '') = 'Administrator')
    + (select count(*) from public.change_requests
      where created_by = auth.uid() and status = 'done' and tested_ok is null)
  )::integer
$$;
revoke all on function public.nav_request_count() from public, anon;
grant execute on function public.nav_request_count() to authenticated;
