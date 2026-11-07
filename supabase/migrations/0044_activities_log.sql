-- Remus · Handover 8: ACTIVITIES, the log of calls, notes, meetings and emails with clients (Raptor's
-- `activities` table and its Activities page).
--
-- Stephan, 7 Nov 2026: "Tasks is a good idea ... Calendar as well. Activities, yeah."
--
-- Remus has had Raptor's `activities` table since 0006, but only for client emails (type 'Email', filed by the
-- mailbox sync and by 0010's file_mail_on_clients). Those stay exactly as they are, and they now show in the one
-- timeline beside the calls, notes and meetings people log by hand -- which is what Raptor does: its emails are
-- activities too.
--
-- What this adds, all additive and safe to re-run:
--   * project_id: an activity can be about a job as well as (or instead of) a client, so a call about the kitchen
--     shows on the kitchen job's Activity tab. Set to null if the job is deleted: the client's history keeps it.
--   * task_id: "Task completed: ..." / "Task cancelled: ..." rows point back at their task (Raptor writes those).
--   * an index for the timeline's order and the project tab.

alter table public.activities add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.activities add column if not exists task_id uuid references public.tasks (id) on delete set null;

create index if not exists activities_project_id_idx on public.activities (project_id);
create index if not exists activities_activity_date_idx on public.activities (activity_date desc);
create index if not exists activities_task_id_idx on public.activities (task_id);
