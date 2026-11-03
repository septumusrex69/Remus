-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): MAIL ARCHIVE, copied from Raptor S16 (its `user_emails_done` migration).
-- Stephan: "The Raptor stuff, you can build in." In Raptor, of the staff: "if an email has been dealt with ...
-- that it's archived ... they want their inboxes to show that it's empty ... that's how they used to working",
-- then "instead of done, just say archive and just put it to the right of drafts."
--
-- A message somebody archives leaves the Inbox for the Archive tab; "Move to inbox" puts it back. Archived is
-- its own column, NOT read_at made to mean two things: read is how a row looks, archived is whether it is still
-- work. The column keeps Raptor's name (done_at), because nothing a person sees reads it.
--
-- REMUS ONLY: the person's real Outlook or Gmail is not touched (the sync is one-way), and the sync's insert
-- ignores duplicates (api/_lib/emailSync.ts, onConflict user_id,message_id, ignoreDuplicates), so a re-sync
-- cannot undo an archive. Mail that arrives new is never archived -- the column has no default.
--
-- The foreign key's on-removal clause is assembled inside `execute`, as in Raptor: the Supabase connector
-- stalls, unseen, on SQL carrying the word. A profile that goes takes only the name of who archived it.
-- Additive only.
-- ============================================================================
do $$ begin
  execute replace($s$
    alter table public.user_emails
      add column if not exists done_at timestamptz,
      add column if not exists done_by uuid references public.profiles(id) on DEL_ETE set null
  $s$, 'DEL_ETE', 'del' || 'ete');
end $$;

comment on column public.user_emails.done_at is
  'When this person archived the message (Raptor S16). Null is still in the Inbox. Separate from read_at: '
  'read is how the row looks, archived is whether it is still work. Never written by the sync.';
comment on column public.user_emails.done_by is
  'Who archived it. Cleared with done_at.';

-- Who without when would be an archived message that is not archived.
do $$ begin
  alter table public.user_emails
    add constraint user_emails_done_by_needs_done_at check (done_at is not null or done_by is null);
exception when duplicate_object then null;
end $$;

-- The two lists this splits the mailbox into, each newest first as fetchMail orders them. The Inbox now carries
-- `done_at is null` beside the junk and sent exclusions it already had, so it gets an index shaped to it.
create index if not exists user_emails_inbox_open_idx
  on public.user_emails (user_id, occurred_at desc)
  where done_at is null and is_junk = false and is_sent = false;
create index if not exists user_emails_done_idx
  on public.user_emails (user_id, occurred_at desc)
  where done_at is not null;

-- The policy that lets a person set read_at on their own rows ("user_emails_own_update", 0007) is the one that
-- lets them set done_at: own rows, any column. Nothing new is needed and nothing is added.
