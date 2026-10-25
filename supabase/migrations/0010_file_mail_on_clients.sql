-- Every email with a client, filed on that client (Stephan, 25 Oct 2026: "file all the mails under
-- a specific client, so it's all together").
--
-- Until now the sync filed only NEW incoming mail, and only at the moment it arrived. So mail that
-- came in before the client was captured, and mail sent to the client from Outlook or a phone,
-- never reached the client's Emails card. This files, from what is already kept in `user_emails`:
--   * received mail whose sender is a client's (contact's or company's) address;
--   * sent mail with a client among the To/Cc recipients.
-- It runs after every sync, when a client is added or their email changes, and once below.
--
-- A message somebody took off a client by hand (`unfiled_at`) is never filed again automatically.

alter table public.user_emails add column if not exists unfiled_at timestamptz;

create or replace function public.file_mail_on_clients(p_user uuid default null, p_email text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  filed integer;
begin
  with candidates as (
    select ue.*, m.company_id as m_company, m.contact_id as m_contact
    from public.user_emails ue
    cross join lateral (
      -- The addresses on the client's side of the message.
      select array_agg(distinct a) as addrs
      from unnest(
        case when ue.is_sent
          then array[lower(trim(ue.to_address))]
               || array(select lower(trim(r ->> 'address')) from jsonb_array_elements(ue.to_recipients || ue.cc_recipients) r)
          else array[lower(trim(ue.from_address))]
        end
      ) a
      where a is not null and a <> ''
    ) x
    cross join lateral (
      -- A contact (and their company) first, else a company's own address. Same order as the sync.
      select * from (
        select c.company_id, c.id as contact_id, 0 as rank
        from public.contacts c
        where c.email is not null and lower(trim(c.email)) = any (x.addrs)
        union all
        select co.id, null::uuid, 1
        from public.companies co
        where co.email is not null and lower(trim(co.email)) = any (x.addrs)
      ) found
      order by rank
      limit 1
    ) m
    where ue.linked_at is null
      and ue.unfiled_at is null
      and (p_user is null or ue.user_id = p_user)
      and (p_email is null or lower(trim(p_email)) = any (x.addrs))
  ),
  linked as (
    update public.user_emails ue
    set linked_company_id = c.m_company, linked_contact_id = c.m_contact, linked_at = now()
    from candidates c
    where ue.id = c.id
    returning c.*
  )
  insert into public.activities
    (type, user_id, company_id, contact_id, subject, notes, activity_date, email_message_id, is_read,
     attachment_names, email_folder, email_uid)
  select
    'Email', l.user_id, l.m_company, l.m_contact,
    case
      when l.is_sent then 'Email sent: '
      when l.is_junk then 'Email received (was in Spam/Junk): '
      else 'Email received: '
    end || coalesce(nullif(l.subject, ''), '(no subject)'),
    left(coalesce(l.body_text, l.snippet, ''), 20000),
    l.occurred_at, l.message_id, l.is_sent or l.read_at is not null,
    l.attachment_names, l.folder, l.uid::integer
  from linked l
  -- Already on the card (sent from Remus, or filed by the sync): leave it as it is.
  on conflict (user_id, email_message_id) do nothing;

  get diagnostics filed = row_count;
  return filed;
end;
$$;

revoke all on function public.file_mail_on_clients(uuid, text) from public, anon, authenticated;
grant execute on function public.file_mail_on_clients(uuid, text) to service_role;

-- A client captured (or their email corrected) picks up the mail already in everyone's mailbox.
create or replace function public.file_mail_for_client_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and trim(new.email) <> ''
     and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    perform public.file_mail_on_clients(null, new.email);
  end if;
  return new;
end;
$$;

revoke all on function public.file_mail_for_client_email() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'contacts_file_mail') then
    create trigger contacts_file_mail after insert or update of email on public.contacts
      for each row execute function public.file_mail_for_client_email();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'companies_file_mail') then
    create trigger companies_file_mail after insert or update of email on public.companies
      for each row execute function public.file_mail_for_client_email();
  end if;
end $$;

-- Everything already kept, once.
select public.file_mail_on_clients();
