-- Remus · Handover 8: TASKS, copied from Raptor's `tasks` table (supabase/schema.sql, "---------- Tasks ----------").
--
-- Stephan, 7 Nov 2026: "Tasks is a good idea ... Calendar as well. Activities, yeah."
--
-- A to-do for one person: given to somebody (owner_id), due on a day (and an hour, if one was chosen), done or
-- not. It can be about a project and/or a client, so it shows on that project's and that client's page too.
--
-- DIFFERENT FROM RAPTOR: Raptor's lead_id / deal_id are left out (Remus has no leads or deals) and project_id is
-- added (Remus's work is jobs). Raptor's cancel reason and cancelled_at live in its app types; here they are
-- columns, so a cancelled task says why. `notes` is new: a site job often needs a line more than the title.
--
-- Additive and safe to re-run: every create is guarded, nothing existing is changed.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  type text not null default 'To do',
  status text not null default 'Not Started'
    check (status in ('Not Started', 'In Progress', 'Completed', 'Cancelled')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  -- Whose task it is (Raptor: owner). Defaults to the person typing it.
  owner_id uuid not null default auth.uid() references public.profiles (id),
  -- Midnight local time means "any time that day" (Raptor's dayPlan.taskTime rule).
  due_date timestamptz not null,
  -- A task about a job is that job's: it goes when the job goes.
  project_id uuid references public.projects (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  -- The client's or project's name at the time, for lists that do not load every client (Raptor's column).
  related_to_label text,
  notes text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text
);

create index if not exists tasks_owner_due_idx on public.tasks (owner_id, due_date);
create index if not exists tasks_due_idx on public.tasks (due_date);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_company_idx on public.tasks (company_id);
create index if not exists tasks_contact_idx on public.tasks (contact_id);

-- Access: the same rules as every other company table (0002): active members read and write; Read Only and
-- deactivated people change nothing. Tasks hold no money, so site managers see them like everybody else.
alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'remus_all') then
    create policy "remus_all" on public.tasks for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'remus_write_insert') then
    create policy "remus_write_insert" on public.tasks as restrictive for insert to authenticated
      with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'remus_write_update') then
    create policy "remus_write_update" on public.tasks as restrictive for update to authenticated
      using ((select public.can_write())) with check ((select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'remus_write_delete') then
    create policy "remus_write_delete" on public.tasks as restrictive for delete to authenticated
      using ((select public.can_write()));
  end if;
end $$;

-- THE BELL WHEN SOMEBODY GIVES YOU A TASK. Written by the database, like every other Remus notification (0017),
-- because a person may only write their own notifications. Not when you give one to yourself: you know.
create or replace function public.task_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who text;
  v_by uuid;
begin
  v_by := coalesce(auth.uid(), new.created_by);
  if new.owner_id is null or new.owner_id is not distinct from v_by then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;
  if new.status in ('Completed', 'Cancelled') then
    return new;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Somebody') into v_who from public.profiles where id = v_by;
  insert into public.notifications (user_id, type, message, link)
  values (
    new.owner_id,
    'task.assigned',
    coalesce(v_who, 'Somebody') || ' gave you a task: ' || left(btrim(new.title), 90)
      || case when length(btrim(new.title)) > 90 then '…' else '' end
      || ' (due ' || to_char(new.due_date at time zone 'Africa/Johannesburg', 'FMDD Mon') || ')',
    '/tasks?date=' || to_char(new.due_date at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')
  );
  return new;
end
$$;
revoke all on function public.task_notify() from public, anon, authenticated;
create or replace trigger task_notify_insert after insert on public.tasks
  for each row execute function public.task_notify();
create or replace trigger task_notify_update after update of owner_id on public.tasks
  for each row execute function public.task_notify();
