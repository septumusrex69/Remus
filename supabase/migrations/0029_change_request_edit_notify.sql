-- ============================================================================
-- Remus · Handover 5 (29 Oct 2026): A REWORDED REQUEST TELLS ITS SENDER (Raptor H14's
-- change_request_edit_notify). Stephan, of Raptor's R-13: edit before approving, dictate it, and the person
-- who asked is notified with the new wording, so they test it against what will actually be built.
-- Same function as 0025, plus the notification when the one correcting is not the one who asked.
-- ============================================================================
create or replace function public.change_request_edit(p_number bigint, p_description text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.change_requests;
  v_new text := btrim(coalesce(p_description, ''));
  v_who text;
begin
  select * into r from public.change_requests where number = p_number;
  if r.id is null then
    raise exception 'There is no request R-%.', p_number using errcode = '22023';
  end if;
  if not public.is_active_member() then
    raise exception 'Your access to Remus has been removed.' using errcode = '42501';
  end if;
  if auth.uid() is distinct from r.created_by and coalesce(public.current_user_role(), '') <> 'Administrator' then
    raise exception 'Only the person who sent R-%, or an Administrator, may correct it.', p_number using errcode = '42501';
  end if;
  if r.status not in ('new', 'accepted') then
    raise exception 'Claude has started on R-% (or it is finished), so its words are the record now. Add a comment instead.', p_number using errcode = '22023';
  end if;
  if v_new = '' then
    raise exception 'A request needs words.' using errcode = '22023';
  end if;
  if v_new = btrim(r.description) then
    return;
  end if;
  update public.change_requests set description = v_new where id = r.id;
  insert into public.change_request_edits (request_id, old_description, by_id) values (r.id, r.description, auth.uid());
  if r.created_by is not null and auth.uid() is distinct from r.created_by then
    select coalesce(name, 'Somebody') into v_who from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, type, message, link)
    values (r.created_by, 'change_request.edited',
            v_who || ' reworded your request R-' || p_number || ': ' || left(v_new, 120),
            '/requests?r=' || p_number);
  end if;
end
$$;
revoke all on function public.change_request_edit(bigint, text) from public, anon;
grant execute on function public.change_request_edit(bigint, text) to authenticated;
