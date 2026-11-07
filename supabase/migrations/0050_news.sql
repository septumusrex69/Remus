-- ============================================================================
-- Remus · Handover 8 (7 Nov 2026): NEWS -- email newsletters to clients, with sign-up and unsubscribe.
--
-- Stephan, 7 Nov, agreeing to "News & campaigns: email newsletters to clients (with sign-up and unsubscribe),
-- e.g. 'We've finished a job in Brooklyn'": "we can start with pretty much all of that."
--
-- COPIED FROM RAPTOR (supabase/schema.sql, the marketing_* tables of S10 21-22 Oct, branch
-- claude/sales-raptor-review-p1pzx2) and adapted. The table and function names are Raptor's, so the two apps can
-- be compared line by line. What is different, and why:
--   * Remus has no leads. The people who are not clients live in marketing_subscribers (Raptor keeps them as
--     leads with marketing_consent_at): signed up on the public page, imported from a list, or added by hand.
--   * A newsletter carries several photos (images, a list), not one picture link: "We've finished a job in
--     Brooklyn" is a set of site photos.
--   * Two kinds only: 'news', and 'invitation' (Raptor's 'introduction': the one email POPIA allows to somebody
--     who never said yes, asking them to). Raptor's 'prospect' kind and its warm-up are left out: Remus does not
--     market to cold lists.
--   * Every send records WHY it was allowed (basis): an existing client (POPIA s69(3), the "soft opt-in"), or a
--     person's own yes and when and how they gave it.
--   * Who may: active Administrators (news_may_send), Raptor's marketing.send capability in Remus's terms.
--
-- POPIA s69, as Raptor reads it: an existing CLIENT may be sent news of our own similar services if every message
-- offers a way out (in by default, opts out); anybody else needs CONSENT and may be asked for it ONCE; an
-- objection holds until the person withdraws it (marketing_preferences, per ADDRESS, read again at sending).
--
-- Additive only: new tables, functions and policies, each guarded so the file can run twice.
-- ============================================================================

-- WHO MAY WRITE AND SEND NEWS: an active Administrator. Definer, so policies can ask it cheaply.
create or replace function public.news_may_send()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Active' and role = 'Administrator');
$$;
revoke execute on function public.news_may_send() from anon, public;
grant execute on function public.news_may_send() to authenticated;

-- AN IMPORTED LIST: who uploaded which file, when, and what the preview counted. The file itself is never stored.
-- consent_note: where these people said yes ("signed up at our stand at the home show, March 2026"); empty means
-- nobody said yes, and they can only be sent ONE invitation.
create table if not exists public.marketing_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  file_name text,
  consent_note text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb,
  subscriber_count integer not null default 0
);

-- PEOPLE WHO ARE NOT CLIENTS: one row per address. consent_at is the POPIA "yes": when, how, and in whose words.
create table if not exists public.marketing_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  name text,
  company text,
  phone text,
  note text,
  source text not null check (source in ('sign-up page', 'imported list', 'recorded by staff')),
  list_id uuid references public.marketing_lists (id) on delete set null,
  consent_at timestamptz,
  consent_how text check (consent_how in ('sign-up page', 'opt-in link', 'imported with consent', 'recorded by staff')),
  consent_note text,
  consent_by uuid references public.profiles (id) on delete set null,
  -- A sign-up on the public page waits for the person's press on the confirmation email (double opt-in).
  confirm_sent_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint marketing_subscribers_consent_says_how check (consent_at is null or consent_how is not null)
);
create index if not exists marketing_subscribers_list_idx on public.marketing_subscribers (list_id) where list_id is not null;

-- A NEWSLETTER: what was written, to whom (a RULE over Remus's records, resolved at sending) and where it stands.
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'news' check (kind in ('news', 'invitation')),
  subject text not null default '',
  preheader text not null default '',
  body text not null default '',
  -- [{ "url": "https://...", "caption": "..." }], public copies in the news-pictures store (0051).
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  audience jsonb not null default '{"kind":"all_clients"}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'cancelled')),
  recipient_count integer,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  queued_at timestamptz,
  queued_by uuid references public.profiles (id) on delete set null,
  finished_at timestamptz
);

-- ONE ROW PER ADDRESS PER NEWSLETTER: "each person once" is a constraint, not a hope.
create table if not exists public.marketing_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns (id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  first_name text,
  company_name text,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  subscriber_id uuid references public.marketing_subscribers (id) on delete set null,
  -- Why this person may be sent it, in words, at the moment the list was drawn (POPIA's record).
  basis text,
  first_approach boolean not null default false,
  state text not null default 'queued'
    check (state in ('queued', 'sending', 'sent', 'failed', 'skipped', 'bounced', 'complained')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  delayed_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  first_opened_at timestamptz,
  open_count integer not null default 0,
  first_clicked_at timestamptz,
  click_count integer not null default 0,
  unsubscribed_at timestamptz,
  opted_in_at timestamptz,
  unique (campaign_id, email)
);
create index if not exists marketing_sends_state_idx on public.marketing_sends (state, campaign_id);
create index if not exists marketing_sends_resend_idx on public.marketing_sends (resend_id);
create index if not exists marketing_sends_email_sent_idx on public.marketing_sends (email, sent_at);
create index if not exists marketing_sends_approach_idx on public.marketing_sends (subscriber_id) where first_approach;

-- PER ADDRESS, NOT PER RECORD (Raptor's rule): the same person is a contact and a subscriber; a "stop" through
-- one holds through the other. campaign_id carries no foreign key on purpose: an unsubscribe is the person's.
create table if not exists public.marketing_preferences (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  status text not null check (status in ('subscribed', 'unsubscribed', 'undeliverable')),
  how text not null check (how in ('unsubscribe link', 'one-click header', 'recorded by staff', 'complaint', 'hard bounce',
                                   're-subscribed from the link', 'opt-in link', 'sign-up page')),
  reason text,
  campaign_id uuid,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id) on delete set null,
  -- A RE-SUBSCRIPTION A PERSON AT URBAN HAUS RECORDS SAYS WHY: overriding somebody's objection is the one write
  -- here POPIA would ask about.
  constraint marketing_preferences_resubscribe_says_why
    check (status <> 'subscribed' or how <> 'recorded by staff' or length(btrim(coalesce(reason, ''))) > 0)
);

-- EVERY CHANGE, KEPT. Written only by the trigger below.
create table if not exists public.marketing_preference_history (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null,
  how text not null,
  reason text,
  campaign_id uuid,
  changed_at timestamptz not null,
  changed_by uuid references public.profiles (id) on delete set null
);
create index if not exists marketing_preference_history_email_idx on public.marketing_preference_history (email, changed_at);

-- When and who are stamped, not typed, and every change lands in the history. Definer: the history has no write
-- policy at all, so nobody can write it except this trigger.
create or replace function public.marketing_preferences_stamp()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.changed_at := now();
  new.changed_by := auth.uid();
  insert into public.marketing_preference_history (email, status, how, reason, campaign_id, changed_at, changed_by)
  values (new.email, new.status, new.how, new.reason, new.campaign_id, new.changed_at, new.changed_by);
  return new;
end $$;
revoke all on function public.marketing_preferences_stamp() from public, anon;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'marketing_preferences_stamp' and tgrelid = 'public.marketing_preferences'::regclass) then
    create trigger marketing_preferences_stamp
      before insert or update on public.marketing_preferences
      for each row execute function public.marketing_preferences_stamp();
  end if;
end $$;

-- EVERY WEBHOOK DELIVERY, ONCE (Resend retries with the same svix-id).
create table if not exists public.marketing_send_events (
  event_id text primary key,
  send_id uuid references public.marketing_sends (id) on delete cascade,
  resend_id text,
  type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  note text
);
create index if not exists marketing_send_events_send_idx on public.marketing_send_events (send_id);

-- ---------------------------------------------------------------- access

alter table public.marketing_lists enable row level security;
alter table public.marketing_subscribers enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_sends enable row level security;
alter table public.marketing_preferences enable row level security;
alter table public.marketing_preference_history enable row level security;
alter table public.marketing_send_events enable row level security;

revoke all on public.marketing_lists, public.marketing_subscribers, public.marketing_campaigns, public.marketing_sends,
  public.marketing_preferences, public.marketing_preference_history, public.marketing_send_events from anon;
grant select on public.marketing_lists, public.marketing_sends, public.marketing_preference_history,
  public.marketing_send_events to authenticated;
grant select, insert, update, delete on public.marketing_subscribers, public.marketing_campaigns to authenticated;
grant select, insert, update on public.marketing_preferences to authenticated;

do $$
begin
  -- Lists: read by Administrators; written only by the server (the plan and its rows go in together).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_lists' and policyname = 'marketing_lists_select') then
    create policy marketing_lists_select on public.marketing_lists for select to authenticated
      using ((select public.news_may_send()));
  end if;

  -- Subscribers: Administrators read and keep them. A yes typed in by staff is recorded as staff's.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_subscribers' and policyname = 'marketing_subscribers_select') then
    create policy marketing_subscribers_select on public.marketing_subscribers for select to authenticated
      using ((select public.news_may_send()));
    create policy marketing_subscribers_insert on public.marketing_subscribers for insert to authenticated
      with check ((select public.news_may_send()) and source = 'recorded by staff'
                  and (consent_how is null or consent_how = 'recorded by staff'));
    create policy marketing_subscribers_update on public.marketing_subscribers for update to authenticated
      using ((select public.news_may_send()))
      with check ((select public.news_may_send()) and (consent_how is null or consent_how in ('recorded by staff', 'sign-up page', 'opt-in link', 'imported with consent')));
    -- POPIA's right to be forgotten: an Administrator may take a person off altogether.
    create policy marketing_subscribers_delete on public.marketing_subscribers for delete to authenticated
      using ((select public.news_may_send()));
  end if;

  -- Newsletters: a draft is editable; one that has gone is a record of what was sent.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_campaigns' and policyname = 'marketing_campaigns_select') then
    create policy marketing_campaigns_select on public.marketing_campaigns for select to authenticated
      using ((select public.news_may_send()));
    create policy marketing_campaigns_insert on public.marketing_campaigns for insert to authenticated
      with check ((select public.news_may_send()) and status = 'draft');
    create policy marketing_campaigns_update on public.marketing_campaigns for update to authenticated
      using ((select public.news_may_send()) and status = 'draft')
      with check ((select public.news_may_send()) and status = 'draft');
    create policy marketing_campaigns_delete on public.marketing_campaigns for delete to authenticated
      using ((select public.news_may_send()) and status = 'draft');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_sends' and policyname = 'marketing_sends_select') then
    create policy marketing_sends_select on public.marketing_sends for select to authenticated
      using ((select public.news_may_send()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_send_events' and policyname = 'marketing_send_events_select') then
    create policy marketing_send_events_select on public.marketing_send_events for select to authenticated
      using ((select public.news_may_send()));
  end if;

  -- WHO HAS SAID STOP is shown to anybody signed in (so a client page can say it); an Administrator may record
  -- what a person said on the telephone -- as staff, never as the link.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_preferences' and policyname = 'marketing_preferences_select') then
    create policy marketing_preferences_select on public.marketing_preferences for select to authenticated
      using ((select public.is_active_member()));
    create policy marketing_preferences_insert on public.marketing_preferences for insert to authenticated
      with check ((select public.news_may_send()) and how = 'recorded by staff');
    create policy marketing_preferences_update on public.marketing_preferences for update to authenticated
      using ((select public.news_may_send())) with check ((select public.news_may_send()) and how = 'recorded by staff');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_preference_history' and policyname = 'marketing_preference_history_select') then
    create policy marketing_preference_history_select on public.marketing_preference_history for select to authenticated
      using ((select public.is_active_member()));
  end if;
end $$;

-- ---------------------------------------------------------------- the server's functions (Raptor's, unchanged in shape)

-- THE NEXT CHUNK, CLAIMED SO TWO DRAINS NEVER SEND ONE ROW TWICE. A row left 'sending' by a run that died is taken
-- again after fifteen minutes; Resend's idempotency key stops that retry becoming a second email.
create or replace function public.marketing_claim_sends(p_limit integer, p_campaign uuid default null)
returns setof public.marketing_sends
language sql security invoker set search_path to 'public' as $$
  update public.marketing_sends s
     set state = 'sending', claimed_at = now(), attempts = s.attempts + 1, updated_at = now()
   where s.id in (
     select x.id from public.marketing_sends x
       join public.marketing_campaigns c on c.id = x.campaign_id and c.status = 'sending'
      where (p_campaign is null or x.campaign_id = p_campaign)
        and (x.state = 'queued' or (x.state = 'sending' and x.claimed_at < now() - interval '15 minutes'))
      order by x.created_at, x.id
      limit greatest(1, least(coalesce(p_limit, 100), 100))
      for update of x skip locked)
  returning s.*;
$$;
revoke all on function public.marketing_claim_sends(integer, uuid) from public, anon, authenticated;
grant execute on function public.marketing_claim_sends(integer, uuid) to service_role;

-- WHAT HAPPENED TO A CHUNK, in one statement; a newsletter with nothing left to send is finished.
create or replace function public.marketing_record_results(p_results jsonb)
returns integer
language plpgsql security invoker set search_path to 'public' as $$
declare v integer;
begin
  update public.marketing_sends s
     set state = r.state,
         resend_id = coalesce(r.resend_id, s.resend_id),
         error = r.error,
         sent_at = case when r.state = 'sent' then now() else s.sent_at end,
         claimed_at = case when r.state = 'queued' then null else s.claimed_at end,
         updated_at = now()
    from jsonb_to_recordset(p_results) as r(id uuid, state text, resend_id text, error text)
   where s.id = r.id;
  get diagnostics v = row_count;
  update public.marketing_campaigns c
     set status = 'sent', finished_at = now(), updated_at = now()
   where c.status = 'sending'
     and not exists (select 1 from public.marketing_sends x
                      where x.campaign_id = c.id and x.state in ('queued', 'sending'));
  return v;
end $$;
revoke all on function public.marketing_record_results(jsonb) from public, anon, authenticated;
grant execute on function public.marketing_record_results(jsonb) to service_role;

-- WHAT ONE RESEND EVENT DOES TO ITS SEND, under the event's own key. Opened or clicked also means it arrived.
create or replace function public.marketing_record_event(
  p_event_id text, p_resend_id text, p_type text, p_at timestamptz, p_note text, p_count_click boolean default true)
returns jsonb
language plpgsql security invoker set search_path to 'public' as $$
declare
  v_send public.marketing_sends%rowtype;
  v_at timestamptz := coalesce(p_at, now());
begin
  select * into v_send from public.marketing_sends where resend_id = p_resend_id limit 1;
  insert into public.marketing_send_events (event_id, send_id, resend_id, type, occurred_at, note)
  values (p_event_id, v_send.id, p_resend_id, p_type, v_at, left(p_note, 500))
  on conflict (event_id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if v_send.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  update public.marketing_sends s set
    sent_at = case when p_type = 'email.sent' then coalesce(s.sent_at, v_at) else s.sent_at end,
    delivered_at = case when p_type in ('email.delivered', 'email.opened', 'email.clicked')
                        then least(coalesce(s.delivered_at, v_at), v_at) else s.delivered_at end,
    delayed_at = case when p_type = 'email.delivery_delayed' then coalesce(s.delayed_at, v_at) else s.delayed_at end,
    bounced_at = case when p_type = 'email.bounced' then coalesce(s.bounced_at, v_at) else s.bounced_at end,
    complained_at = case when p_type = 'email.complained' then coalesce(s.complained_at, v_at) else s.complained_at end,
    first_opened_at = case when p_type = 'email.opened' then least(coalesce(s.first_opened_at, v_at), v_at) else s.first_opened_at end,
    open_count = s.open_count + case when p_type = 'email.opened' then 1 else 0 end,
    first_clicked_at = case when p_type = 'email.clicked' and p_count_click
                            then least(coalesce(s.first_clicked_at, v_at), v_at) else s.first_clicked_at end,
    click_count = s.click_count + case when p_type = 'email.clicked' and p_count_click then 1 else 0 end,
    state = case when p_type = 'email.bounced' then 'bounced'
                 when p_type = 'email.complained' then 'complained' else s.state end,
    error = case when p_type in ('email.bounced', 'email.complained', 'email.delivery_delayed') then left(p_note, 500) else s.error end,
    updated_at = now()
  where s.id = v_send.id;
  return jsonb_build_object('status', 'recorded', 'send_id', v_send.id, 'campaign_id', v_send.campaign_id, 'email', v_send.email);
end $$;
revoke all on function public.marketing_record_event(text, text, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.marketing_record_event(text, text, text, timestamptz, text, boolean) to service_role;

-- THE COUNTS ON THE SCREEN, per newsletter. Invoker: the sends' policy decides who sees them.
create or replace function public.marketing_campaign_results()
returns table (campaign_id uuid, total integer, queued integer, accepted integer, failed integer, skipped integer,
               delivered integer, delayed integer, bounced integer, complained integer, opened integer,
               clicked integer, unsubscribed integer, opted_in integer)
language sql stable security invoker set search_path to 'public' as $$
  select s.campaign_id, count(*)::int,
         count(*) filter (where s.state in ('queued', 'sending'))::int,
         count(*) filter (where s.resend_id is not null and s.state in ('sent', 'bounced', 'complained'))::int,
         count(*) filter (where s.state = 'failed')::int,
         count(*) filter (where s.state = 'skipped')::int,
         count(*) filter (where s.delivered_at is not null and s.state <> 'bounced')::int,
         count(*) filter (where s.delayed_at is not null and s.delivered_at is null and s.state = 'sent')::int,
         count(*) filter (where s.state = 'bounced')::int,
         count(*) filter (where s.state = 'complained')::int,
         count(*) filter (where s.first_opened_at is not null)::int,
         count(*) filter (where s.first_clicked_at is not null)::int,
         count(*) filter (where s.unsubscribed_at is not null)::int,
         count(*) filter (where s.opted_in_at is not null)::int
    from public.marketing_sends s
   group by s.campaign_id
$$;
revoke all on function public.marketing_campaign_results() from public, anon;
grant execute on function public.marketing_campaign_results() to authenticated, service_role;
