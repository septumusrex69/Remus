-- ============================================================================
-- Remus · Handoff 1 (26 Oct 2026): CHANGE REQUESTS BROUGHT UP TO RAPTOR'S NEWEST.
-- Stephan: "Update the recommendations part in Remus to the newest on Raptor." Two of Raptor ·
-- Handoff 12's later migrations, as Raptor wrote them, with Remus's active-member rule kept:
--
--   * change_request_comment_by_claude: a comment with no author is the builder or the nightly review
--     writing, and is named Claude. (0017 already reached the same answer by a coalesce; this is
--     Raptor's own wording of it, so the two files read alike.)
--   * change_request_choices: A QUESTION WITH OPTIONS TO TICK. Raptor's firm: "to choose the option by
--     means of a tick. Or choose other. And then write other suggestion." A question may carry 2-6
--     `choices`; the person who asked answers with a comment whose `answers` points at it, so the
--     reply notifies the Administrators as any reply does. An answer must answer a question with
--     choices on the SAME request.
-- ============================================================================

create or replace function public.change_request_event_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.change_requests;
  v_who text;
begin
  if new.kind not in ('comment', 'question') then
    return new;
  end if;
  select * into r from public.change_requests where id = new.request_id;
  -- A comment with no author is the builder or the nightly review writing (Raptor H12).
  v_who := case when new.by_id is null then 'Claude'
                else coalesce((select name from public.profiles where id = new.by_id), 'Somebody') end;
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

alter table public.change_request_events add column if not exists choices text[];
alter table public.change_request_events add column if not exists answers uuid references public.change_request_events (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'change_request_events_choices_shape') then
    -- Choices belong to a question, two to six of them, none empty; an answer is a comment.
    alter table public.change_request_events add constraint change_request_events_choices_shape
      check (choices is null or (kind = 'question' and cardinality(choices) between 2 and 6
                                 and array_position(choices, null) is null and not ('' = any (choices))));
    alter table public.change_request_events add constraint change_request_events_answer_is_comment
      check (answers is null or kind = 'comment');
  end if;
end $$;

alter policy change_request_events_insert on public.change_request_events
  with check (
    by_id = (select auth.uid())
    and (select public.is_active_member())
    and (kind = 'comment' or (kind = 'question' and (select public.current_user_role()) = 'Administrator'))
    and ((select public.current_user_role()) = 'Administrator'
         or exists (select 1 from public.change_requests r where r.id = request_id and r.created_by = (select auth.uid())))
    and (answers is null or exists (select 1 from public.change_request_events q
                                     where q.id = change_request_events.answers and q.kind = 'question' and q.choices is not null
                                       and q.request_id = change_request_events.request_id)));

-- ----------------------------------------------------------------------------
-- WHY THE ANSWER CHECK IS A FUNCTION, NOT A SUBQUERY (Remus · Handoff 1). Raptor's policy above reads
-- change_request_events from inside change_request_events' own insert policy, and Postgres refuses
-- every insert into a table whose policy queries that same table ("infinite recursion detected in
-- policy") -- not only answers: every comment and every question. Probed in a rolled-back
-- transaction on 26 Oct, the plain insert the app sends was refused. So the same question is asked
-- by a definer function, which reads the table without RLS and so without recursion. It answers
-- only "is this a question with choices on that request", which every member can already read.
-- ----------------------------------------------------------------------------
create or replace function public.change_request_answers_ok(p_answers uuid, p_request uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_answers is null or exists (
    select 1 from public.change_request_events q
     where q.id = p_answers and q.kind = 'question' and q.choices is not null and q.request_id = p_request)
$$;
revoke all on function public.change_request_answers_ok(uuid, uuid) from public, anon;
grant execute on function public.change_request_answers_ok(uuid, uuid) to authenticated;

alter policy change_request_events_insert on public.change_request_events
  with check (
    by_id = (select auth.uid())
    and (select public.is_active_member())
    and (kind = 'comment' or (kind = 'question' and (select public.current_user_role()) = 'Administrator'))
    and ((select public.current_user_role()) = 'Administrator'
         or exists (select 1 from public.change_requests r where r.id = request_id and r.created_by = (select auth.uid())))
    and public.change_request_answers_ok(answers, request_id));
