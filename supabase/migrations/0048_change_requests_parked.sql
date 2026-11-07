-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): A REQUEST CAN BE PARKED, AND CLAUDE'S QUESTIONS GO TO WHOEVER SENT IT THROUGH.
-- Copied from Raptor S18 (6 Nov; migrations s18_requests_can_be_parked and s18_claude_questions_go_to_who_sent_it_through).
-- Stephan, 7 Nov, on what Raptor has that Remus does not: "We can like start with pretty much all of that."
--
-- 1. PARKED. Stephan, on Raptor: "Put one folder where I can just say like parked. So something that is parked for
--    now. Until I can make another decision." PARKED IS NOT A STATUS -- the status check constraint could only be
--    widened by removing it first, and this file is additive -- and Raptor made the same choice for a better reason:
--    it is "not now" laid over a request that is still Submitted or Approved, so the status, its policies, its
--    triggers and the history keep meaning what they meant, and unparking puts it back exactly where it was.
--    Two columns, and three rules held here rather than only in the browser:
--      * parking and unparking are the Big Boss's (0038) -- putting a decision off is part of making it;
--      * only a request still waiting on a decision may be parked (Submitted or Approved), and parking one that is on
--        Claude's queue takes it off the queue: a parked request is one nobody builds;
--      * any decision (approved, declined, reopened, built) unparks it, so a parked flag never outlives the question.
--    The sidebar count leaves parked requests out: a count is what one person can clear today.
--
-- 2. CLAUDE'S QUESTIONS GO TO THE ADMINISTRATOR WHO SENT THE REQUEST THROUGH. Stephan, on Raptor's R-26: "the question
--    should be asked rather to the administrator who sent it through." A question with no author (by_id null: the
--    builder or the nightly review) notifies whoever put the request on Claude's queue, else whoever decided it, else
--    -- nobody has yet -- the person who wrote it. The browser's questionFor() (changeRequests.ts) names the same
--    person on the panel. A question an Administrator asks with Request info, and every comment, still go to the
--    person who wrote the request, as before (0018).
--
-- Additive only: two columns, three functions replaced, and the Big Boss trigger re-created in place with one more
-- column to watch (create or replace trigger, so nothing is removed first).
-- ============================================================================
alter table public.change_requests add column if not exists parked_at timestamptz;
alter table public.change_requests add column if not exists parked_by uuid references public.profiles (id) on delete set null;

create or replace function public.change_request_boss_decides()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Any decision unparks it (Raptor S18).
  if new.status is distinct from old.status then
    new.parked_at := null;
    new.parked_by := null;
  end if;
  -- Only a request still waiting on a decision may be parked; parking takes it off Claude's queue.
  if new.parked_at is not null and old.parked_at is null then
    if new.status not in ('new', 'accepted') then
      raise exception 'Only a request still waiting on a decision can be parked.' using errcode = '22023';
    end if;
    new.build_requested_at := null;
    new.build_requested_by := null;
  end if;
  -- The server, Claude's own tools and the nightly review act with no signed-in person.
  if auth.uid() is null or coalesce(current_setting('role', true), '') = 'service_role' then return new; end if;
  if public.is_big_boss() then return new; end if;
  if (new.status is distinct from old.status
        and ((old.status = 'new' and new.status = 'accepted') or new.status = 'declined' or (old.status = 'declined' and new.status <> 'declined')))
     or (old.build_requested_at is null and new.build_requested_at is not null)
     or (new.parked_at is distinct from old.parked_at) then
    raise exception 'Only the Big Boss approves, declines or parks what gets built in Remus.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The same trigger (0038), now also watching parked_at. Re-created in place; nothing is removed first.
create or replace trigger change_request_boss_decides before update of status, build_requested_at, parked_at on public.change_requests
  for each row execute function public.change_request_boss_decides();

-- The sidebar's Requests count (0025): a parked request is not one to clear today.
create or replace function public.nav_request_count()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $$
  select (
    (select count(*) from public.change_requests
      where status = 'new' and parked_at is null and coalesce(public.current_user_role(), '') = 'Administrator')
    + (select count(*) from public.change_requests
      where created_by = auth.uid() and status = 'done' and tested_ok is null)
  )::integer
$$;
grant execute on function public.nav_request_count() to authenticated;

-- Who is told about a question or a comment (0018), with Claude's questions going to whoever sent it through.
create or replace function public.change_request_event_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.change_requests;
  v_who text;
  v_for uuid;
begin
  if new.kind not in ('comment', 'question') then
    return new;
  end if;
  select * into r from public.change_requests where id = new.request_id;
  -- A comment with no author is the builder or the nightly review writing (Raptor H12).
  v_who := case when new.by_id is null then 'Claude'
                else coalesce((select name from public.profiles where id = new.by_id), 'Somebody') end;
  if new.kind = 'question' and new.by_id is null then
    v_for := coalesce(r.build_requested_by, r.decided_by, r.created_by);
    insert into public.notifications (user_id, type, message, link)
    values (v_for, 'change_request.question',
            'Claude has a question about R-' || r.number || case when v_for = r.created_by then ', your request' else '' end
            || ': ' || left(btrim(new.body), 120),
            '/requests?r=' || r.number);
    return new;
  end if;
  if new.by_id is distinct from r.created_by then
    insert into public.notifications (user_id, type, message, link)
    values (r.created_by, 'change_request.' || new.kind,
            case when new.kind = 'question' then v_who || ' has a question about your request R-' || r.number || ': '
                 else v_who || ' wrote on your request R-' || r.number || ': ' end || left(btrim(new.body), 120),
            '/requests?r=' || r.number);
  else
    insert into public.notifications (user_id, type, message, link)
    select p.id, 'change_request.reply', v_who || ' replied on R-' || r.number || ': ' || left(btrim(new.body), 120), '/requests?r=' || r.number
      from public.profiles p
     where p.role = 'Administrator' and p.status = 'Active' and p.id is distinct from new.by_id;
  end if;
  return new;
end
$$;
revoke all on function public.change_request_event_notify() from public, anon, authenticated;
