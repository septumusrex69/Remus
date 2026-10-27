-- ============================================================================
-- Remus · Handoff 1 (26 Oct 2026): CHANGE REQUESTS -- "REQUEST A CHANGE" FROM INSIDE REMUS, AND A
-- NOTIFICATIONS BELL TO TELL PEOPLE ABOUT THEM.
--
-- STEPHAN: "Raptor built something in where you have like a suggestions thing from the people who's
-- using the app. Can we copy that exactly?" So this is Raptor's change_requests (Raptor · Handoff 12:
-- the migrations change_requests, change_request_pane_and_department, change_request_tested,
-- feedback_centre and change_request_build_queue), folded into one because Remus takes their final
-- shape in one go. Read Raptor's schema.sql for the reasoning behind each piece; what follows says
-- only where Remus differs.
--
--   * NOTIFICATIONS. Raptor's table, column for column. Remus had none, and a request nobody is told
--     about is a request nobody reads ("it would flag on my side").
--   * DEPARTMENTS are Urban Haus's, not the debt collector's: Quotes, Projects, Crew & schedule,
--     Money, Clients & mail, Whole system (src/lib/changeRequests.ts holds the same list).
--   * READING needs an ACTIVE member (Remus's rule since 0002), where Raptor lets any signed-in
--     person read. Writing keeps Raptor's rules: anybody active sends; only an Administrator moves
--     one along; the sender may withdraw it while it is still Submitted.
--   * The nightly review and the builder are Claude sessions on a schedule, writing as the database
--     owner -- .claude/skills/change-requests/SKILL.md says how.
-- ============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  message text not null,
  -- App-relative path to open when clicked, e.g. "/requests?r=3".
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'notifications_select') then
    create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
    create policy notifications_update on public.notifications for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  description text not null check (length(btrim(description)) > 0),
  page_path text,
  page_title text,
  pane text,
  department text check (department is null or department in ('Quotes', 'Projects', 'Crew & schedule', 'Money', 'Clients & mail', 'Whole system')),
  status text not null default 'new' check (status in ('new', 'accepted', 'building', 'done', 'declined')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  admin_note text,
  -- What a Claude session built for it, e.g. "Remus H2, commit 1a2b3c4" -- written when it is released.
  done_in text,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  tested_ok boolean,
  tested_note text,
  tested_at timestamptz,
  tested_by uuid references public.profiles (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  review_title text,
  review_verdict text check (review_verdict is null or review_verdict in ('ready', 'decision', 'blocked')),
  review_size text check (review_size is null or review_size in ('small', 'medium', 'large')),
  review_summary text,
  review_questions text[] not null default '{}',
  reviewed_at timestamptz,
  build_requested_at timestamptz,
  build_requested_by uuid references public.profiles (id) on delete set null,
  -- A decline says why: the person who asked is told, and "no" with no reason reads as "ignored".
  constraint change_requests_decline_says_why check (status <> 'declined' or length(btrim(coalesce(admin_note, ''))) > 0)
);
create index if not exists change_requests_status_idx on public.change_requests (status, created_at desc);
create index if not exists change_requests_build_queue_idx on public.change_requests (build_requested_at) where build_requested_at is not null;
alter table public.change_requests enable row level security;

-- Pictures and PDFs in the database, small and not for ever: a Claude session reads them through SQL.
create table if not exists public.change_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.change_requests (id) on delete cascade,
  name text not null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes integer not null check (bytes > 0 and bytes <= 5242880),
  -- Base64. Null once purged (30 days after the request closed); the row stays, saying it was there.
  data text check (data is null or length(data) <= 7000000),
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index if not exists change_request_files_request_idx on public.change_request_files (request_id);
alter table public.change_request_files enable row level security;

create table if not exists public.change_request_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  summary text not null,
  -- [{ "title": "...", "request_numbers": [12, 15], "what": "...", "questions": ["..."], "size": "small|medium|large" }]
  groups jsonb not null default '[]'::jsonb check (jsonb_typeof(groups) = 'array'),
  request_ids uuid[] not null default '{}'
);
alter table public.change_request_reviews enable row level security;

create table if not exists public.change_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.change_requests (id) on delete cascade,
  kind text not null check (kind in ('sent', 'reviewed', 'status', 'tested', 'assigned', 'comment', 'question')),
  body text,
  from_status text,
  to_status text,
  by_id uuid default auth.uid() references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  constraint change_request_events_words check (kind not in ('comment', 'question') or length(btrim(coalesce(body, ''))) > 0)
);
create index if not exists change_request_events_request_idx on public.change_request_events (request_id, at);
alter table public.change_request_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'change_requests' and policyname = 'change_requests_select') then
    create policy change_requests_select on public.change_requests for select to authenticated using ((select public.is_active_member()));
    create policy change_requests_insert on public.change_requests for insert to authenticated
      with check ((select public.is_active_member()) and created_by = (select auth.uid()) and status = 'new' and decided_by is null and done_in is null);
    create policy change_requests_update on public.change_requests for update to authenticated
      using ((select public.current_user_role()) = 'Administrator' and (select public.is_active_member()))
      with check ((select public.current_user_role()) = 'Administrator' and (select public.is_active_member()));
    create policy change_requests_withdraw on public.change_requests for delete to authenticated
      using (created_by = (select auth.uid()) and status = 'new');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'change_request_files' and policyname = 'change_request_files_select') then
    create policy change_request_files_select on public.change_request_files for select to authenticated using ((select public.is_active_member()));
    create policy change_request_files_insert on public.change_request_files for insert to authenticated
      with check (exists (select 1 from public.change_requests r
                           where r.id = request_id and r.created_by = (select auth.uid()) and r.status = 'new'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'change_request_reviews' and policyname = 'change_request_reviews_select') then
    create policy change_request_reviews_select on public.change_request_reviews for select to authenticated using ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'change_request_events' and policyname = 'change_request_events_select') then
    create policy change_request_events_select on public.change_request_events for select to authenticated using ((select public.is_active_member()));
    -- Comments and questions only, as themselves, on their own request -- or any request if they are an
    -- Administrator; only an Administrator asks a question.
    create policy change_request_events_insert on public.change_request_events for insert to authenticated
      with check (
        by_id = (select auth.uid())
        and (select public.is_active_member())
        and (kind = 'comment' or (kind = 'question' and (select public.current_user_role()) = 'Administrator'))
        and ((select public.current_user_role()) = 'Administrator'
             or exists (select 1 from public.change_requests r where r.id = request_id and r.created_by = (select auth.uid()))));
  end if;
end $$;

-- WHO IS TOLD (Raptor's final change_request_notify, the firm's workflow words).
create or replace function public.change_request_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who text;
  v_word text;
begin
  if tg_op = 'INSERT' then
    select coalesce(name, 'Somebody') into v_who from public.profiles where id = new.created_by;
    insert into public.notifications (user_id, type, message, link)
    select p.id, 'change_request.new',
           v_who || ' asked for a change (R-' || new.number
             || coalesce(', ' || new.department, '') || coalesce(' · ' || new.pane, '') || '): '
             || left(btrim(new.description), 90)
             || case when length(btrim(new.description)) > 90 then '…' else '' end,
           '/requests?r=' || new.number
      from public.profiles p
     where p.role = 'Administrator' and p.status = 'Active' and p.id <> new.created_by;
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
    new.closed_at := case when new.status in ('done', 'declined') then coalesce(old.closed_at, now()) else null end;
    if new.created_by is distinct from auth.uid() then
      v_word := case new.status when 'accepted' then 'was approved' when 'building' then 'is in development'
                                when 'done' then 'is released — please test it' when 'declined' then 'was declined: ' || coalesce(new.admin_note, '')
                                else 'is back to Submitted' end;
      insert into public.notifications (user_id, type, message, link)
      values (new.created_by, 'change_request.status', 'Your request R-' || new.number || ' ' || v_word, '/requests?r=' || new.number);
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.change_request_notify() from public, anon, authenticated;
create or replace trigger change_request_notify_insert after insert on public.change_requests
  for each row execute function public.change_request_notify();
create or replace trigger change_request_notify_update before update on public.change_requests
  for each row execute function public.change_request_notify();

create or replace function public.change_request_review_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.notifications (user_id, type, message, link)
  select p.id, 'change_request.review',
         'Last night''s review of the change requests is ready: ' || jsonb_array_length(new.groups) || ' group'
           || case when jsonb_array_length(new.groups) = 1 then '' else 's' end || '.',
         '/requests'
    from public.profiles p
   where p.role = 'Administrator' and p.status = 'Active';
  return new;
end
$$;
revoke all on function public.change_request_review_notify() from public, anon, authenticated;
create or replace trigger change_request_review_notify after insert on public.change_request_reviews
  for each row execute function public.change_request_review_notify();

-- THE PURGE, 30 days after a request closed. The nightly review runs it.
create or replace function public.purge_closed_request_files()
returns integer
language sql
security invoker
set search_path to 'public'
as $$
  with gone as (
    update public.change_request_files f
       set data = null, purged_at = now()
      from public.change_requests r
     where r.id = f.request_id and f.data is not null
       and r.status in ('done', 'declined') and r.closed_at < now() - interval '30 days'
    returning f.id)
  select count(*)::int from gone
$$;
revoke all on function public.purge_closed_request_files() from public, anon, authenticated;

-- THE PERSON WHO ASKED TESTS IT. Definer: the asker may change exactly these columns of their own request.
create or replace function public.change_request_tested(p_number bigint, p_ok boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.change_requests;
  v_who text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.change_requests where number = p_number;
  if r.id is null then
    raise exception 'There is no request R-%.', p_number;
  end if;
  if not public.is_active_member() then
    raise exception 'Your access to Remus has been removed.';
  end if;
  if auth.uid() is distinct from r.created_by and coalesce(public.current_user_role(), '') <> 'Administrator' then
    raise exception 'Only the person who asked for R-% can say whether it works.', p_number;
  end if;
  if r.status <> 'done' then
    raise exception 'R-% is not released yet, so there is nothing to test.', p_number;
  end if;
  if not p_ok and v_note is null then
    raise exception 'Say what is still not right, so it can be fixed.';
  end if;
  select coalesce(name, 'Somebody') into v_who from public.profiles where id = auth.uid();

  if p_ok then
    update public.change_requests
       set tested_ok = true, tested_note = v_note, tested_at = now(), tested_by = auth.uid()
     where id = r.id;
  else
    update public.change_requests
       set status = 'accepted', tested_ok = false, tested_note = v_note, tested_at = now(), tested_by = auth.uid()
     where id = r.id;
  end if;

  insert into public.notifications (user_id, type, message, link)
  select p.id, 'change_request.tested',
         case when p_ok then v_who || ' tested R-' || p_number || ' and it works' || coalesce(': ' || v_note, '.')
              else v_who || ' tested R-' || p_number || ' and it is not right yet: ' || v_note end,
         '/requests?r=' || p_number
    from public.profiles p
   where p.role = 'Administrator' and p.status = 'Active' and p.id is distinct from auth.uid();
end
$$;
revoke all on function public.change_request_tested(bigint, boolean, text) from public, anon;
grant execute on function public.change_request_tested(bigint, boolean, text) to authenticated;

-- THE HISTORY WRITES ITSELF for what happens to a request.
create or replace function public.change_request_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.change_request_events (request_id, kind, by_id, at) values (new.id, 'sent', new.created_by, new.created_at);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.change_request_events (request_id, kind, from_status, to_status, body, by_id)
    values (new.id, 'status', old.status, new.status,
            case when new.status in ('declined', 'done') then nullif(btrim(coalesce(new.admin_note, '')), '') end, auth.uid());
  end if;
  if new.reviewed_at is distinct from old.reviewed_at and new.reviewed_at is not null then
    insert into public.change_request_events (request_id, kind, body, by_id, at)
    values (new.id, 'reviewed', new.review_summary, null, new.reviewed_at);
  end if;
  if new.tested_at is distinct from old.tested_at and new.tested_at is not null then
    insert into public.change_request_events (request_id, kind, body, by_id, at)
    values (new.id, 'tested', case when new.tested_ok then 'It works' else 'Not right yet' end
                              || coalesce(': ' || nullif(btrim(coalesce(new.tested_note, '')), ''), ''), new.tested_by, new.tested_at);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.change_request_events (request_id, kind, body, by_id)
    values (new.id, 'assigned', (select name from public.profiles where id = new.assigned_to), auth.uid());
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      insert into public.notifications (user_id, type, message, link)
      values (new.assigned_to, 'change_request.assigned', 'R-' || new.number || ' was given to you: ' || coalesce(new.review_title, left(btrim(new.description), 90)),
              '/requests?r=' || new.number);
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.change_request_history() from public, anon, authenticated;
create or replace trigger change_request_history_insert after insert on public.change_requests
  for each row execute function public.change_request_history();
create or replace trigger change_request_history_update after update on public.change_requests
  for each row execute function public.change_request_history();

-- A QUESTION GOES TO THE PERSON WHO ASKED; their reply goes to the Administrators.
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
  select coalesce(name, 'Somebody') into v_who from public.profiles where id = new.by_id;
  if new.by_id is distinct from r.created_by then
    insert into public.notifications (user_id, type, message, link)
    values (r.created_by, 'change_request.' || new.kind,
            case when new.kind = 'question' then coalesce(v_who, 'Claude') || ' has a question about your request R-' || r.number || ': '
                 else coalesce(v_who, 'Claude') || ' wrote on your request R-' || r.number || ': ' end || left(btrim(new.body), 120),
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
create or replace trigger change_request_event_notify after insert on public.change_request_events
  for each row execute function public.change_request_event_notify();
