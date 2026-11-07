# Tasks, Calendar and Activities (Remus · Handover 8 helper)

Stephan, 7 Nov 2026: *"Tasks is a good idea ... Calendar as well. Activities, yeah."* All three copied from Raptor
(branch `claude/sales-raptor-review-p1pzx2`: `pages/tasks/TasksPage.tsx`, `components/tasks/TaskDayPicker.tsx`,
`components/ui/RescheduleTaskModal.tsx`, `pages/calendar/CalendarPage.tsx`, `pages/activities/ActivitiesPage.tsx`,
`lib/dayPlan.ts`, `lib/navCounts.ts` / `nav_counts()`, the `tasks` and `activities` tables), adapted to Remus.

**Not live. Migrations 0043 and 0044 are written, NOT applied.** Apply them (in order, both additive, no `drop`
anywhere) before this goes on a preview against the live database; until then the three pages show empty lists and
the Tasks badge stays at nought (every read is guarded).

## What was built

- **Tasks** (`/tasks`, sidebar with a count, top bar + Add -> Task). A to-do per person: title, type (To do, Call,
  Site visit, Order, Follow-up, Email, Meeting, Quote, Other), priority, due day with an optional hour ("leave it
  blank for any time that day"), whose it is, notes, and what it is about -- a job and/or a client. Raptor's page:
  four figures (Overdue, Due today, Open, Completed -- each a click into its view), the eight views (My Tasks, Team
  Tasks, Overdue, Today, Tomorrow, This Week, Next Week, Completed; Monday-Sunday weeks), "A day" with the 3-week day
  picker that shows each day's load (diary events / tasks), `?date=` in the URL, search, tick to finish, Edit,
  Reschedule, Cancel with a reason. On a one-day view the day's diary events come first, "where you have to be"
  (Raptor's meetings card). An Administrator sees everybody's tasks; everyone else their own, with Team Tasks for
  the rest. Read Only sees and changes nothing.
- **The bell**: giving somebody a task (or handing an existing one over) notifies them: "Stephan gave you a task:
  Order the tiles (due 9 Nov)", linking to that day's tasks. Written by a database trigger, like every Remus
  notification. Not when you give one to yourself.
- **Sidebar count**: Raptor's nav_counts rule -- MY open tasks due by tonight, overdue included ("not all my tasks,
  which would be a permanent number nobody could ever clear"). `lib/taskCount.ts`, same pattern as Returns.
- **Finishing or cancelling** a task that is about a job or client writes "Task completed: ..." / "Task cancelled:
  ..." (with the reason) on the Activity log -- Raptor's AppStore does this.
- **Calendar** (`/calendar`): one calendar with tasks, diary events, job stages, crew bookings and each job's start
  and finish. Month / Week / Day, back / forward / Today, Everybody / Mine / a person (starts on your own unless
  you are an Administrator), a count on each busy square, the whole square opens that day's tasks, a diary event
  opens in place (the Diary's own form), stages/crew/project items open the job's plan, tasks open their day.
  "Show" ticks for each kind. Phone: the month squares show a coloured dot per kind (no room for words); the Day view
  is the default on a phone.
- **Activities** (`/activities`, top bar + Add -> Log a call): one timeline, grouped by day, of calls, notes,
  meetings, site visits and WhatsApps people log, the client emails the mailbox files (Remus's emails were already
  rows in `activities`, as in Raptor -- so they are in the timeline, marked Sent/Received, opening the client's
  Emails tab), and tasks finished or cancelled. Filters: who, what kind, which client, which job. "Log a call / Note
  / Meeting". Your own logged rows can be deleted (an Administrator any); emails and task rows cannot.
- **Project page and client page**: two new tabs, **Tasks** (open first, then done/cancelled; "+ Task" starts one
  tied to this job/client) and **Activity** (the record's own timeline with Log a call / Note / Meeting). A client's
  Activity includes the emails filed on them and their people.

## Files

New: `src/lib/tasks.ts` (rules, Raptor's dayPlan), `src/lib/tasks.test.ts`, `src/lib/tasksApi.ts`,
`src/lib/taskCount.ts`, `src/lib/calendarItems.ts`, `src/pages/build/tasks/{TasksPage,TaskForms,TaskList,RecordTasks}.tsx`,
`src/pages/build/calendar/CalendarPage.tsx`, `src/pages/build/activities/{ActivitiesPage,ActivityTimeline,RecordActivity}.tsx`,
`supabase/migrations/0043_tasks.sql`, `supabase/migrations/0044_activities_log.sql`, `scripts/qa/e2e/tasks-calendar.mjs`.
Appended to: `paths.ts`, `routes.tsx`, `Sidebar.tsx` (NAV after Diary + the `tasks` badge), `AppLayout.tsx` TITLES,
`QuickAdd.tsx`, `ProjectDetail.tsx` and `ClientDetail.tsx` (two tabs each), `scripts/qa/e2e/fixtures.mjs`.
`lib/api.ts` and `types.ts` are untouched (the task types live in `lib/tasks.ts`).

## Migrations (summary)

- **0043_tasks.sql**: `create table if not exists public.tasks` (title, type, status Not Started/In Progress/
  Completed/Cancelled, priority Low..Urgent, owner_id -> profiles default auth.uid(), due_date timestamptz,
  project_id -> projects on delete cascade, company_id / contact_id on delete set null, related_to_label, notes,
  created_by, created_at, completed_at, cancelled_at, cancel_reason); five indexes; RLS = Remus's usual (`remus_all`
  for active members + restrictive write policies via `can_write()`); `task_notify()` security-definer trigger
  function + `create or replace trigger` on insert and on update of owner_id, inserting into `notifications`.
- **0044_activities_log.sql**: `activities` gains `project_id` (-> projects, on delete set null) and `task_id`
  (-> tasks, on delete set null), plus three indexes. Existing email rows unchanged.

## Different from Raptor, and why

- Raptor's leads / deals / tickets / synced meetings / "Prepare" / auto-rollover are left out (Remus has none).
  Remus's **diary events take the place of Raptor's meetings** on the Tasks day view, in the day picker's counts and
  on the calendar.
- Tasks gain a **job** (project_id) and **notes**; Raptor's sales task types are replaced by a builder's.
- Raptor's badge is a database function (`nav_counts`); Remus counts with one head-count query in the browser
  (`lib/taskCount.ts`, the Returns/Requests pattern) -- no new function to apply, same rule.
- The **calendar starts its weeks on Monday** (Raptor: Sunday), like Remus's Diary and SA calendars. Stages and crew
  bookings run for days (Raptor's events are all one day): the month shows a run where it **starts (▸) and ends
  (◂)**; the week and day views show every day of it ("day 3 of 5"). "Show" ticks per kind are new.
- The quick add goes to the page with `?new=1` (Remus's pattern) instead of Raptor's in-menu form.
- Colours are skin tokens (brand / ink / emerald / slate), never Raptor's fixed task-type colours.

## Unfinished / for later

- Apply 0043 and 0044 (Supabase, project "Remus"), then try it on the preview: give Stephan a task from another
  login and check his bell and badge.
- No email reminder for tasks due (Raptor has none either); no recurring tasks.
- Worker and subcontractor pages have no Tasks/Activity tab (their record pages are not rebuilt yet).
- A project's Activity tab shows what was logged against the job, not every email with its client (those are on
  the client's tab).
