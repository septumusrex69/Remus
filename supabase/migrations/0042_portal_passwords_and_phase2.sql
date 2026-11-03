-- ============================================================================
-- Remus · Handover 8 (3 Nov 2026): THE CLIENT PORTAL SIGNS IN WITH A PASSWORD, AND PORTAL PART 2.
--
-- Stephan: "Yeah, you can continue with the client. Login as well. The Raptor stuff, you can build in."
--
-- 1. A PORTAL LOGIN HAS A PASSWORD (copied from Raptor S16's portal_passwords, Raptor · Handover 15). The emailed
--    code proves the address ONCE, the client then chooses a password, and signs in with it from then on; the code
--    stays as the "forgot your password". Portal users are not Supabase users, so it lives on client_portal_users:
--    scrypt (salted) over the server-keyed hash of the password, written and read only by api/portal with the
--    service role -- the table still has no policies. Five wrong passwords lock the login for fifteen minutes
--    (the code still opens it, so a locked-out client is never stuck).
--
-- 2. PORTAL PART 2 (Remus's own list, HANDOVER.md "Next on the list"):
--    * a site diary day can be shown to the client (`site_diary_entries.show_client`, a tick in the diary form):
--      the client then reads that day's "Work done" as a progress note. Delays, safety notes, materials and the
--      crew count are never shown. Off unless ticked.
--    * photos already have `site_diary_photos.show_client` (0030); nothing new for them here.
--    * a sent quote can be ACCEPTED FROM THE PORTAL: who (the name they typed and their portal login) and when
--      are kept on the quote, so the office knows it was the client's own yes and not a staff click.
--
-- Additive only: new columns (if not exists) and one index. No policies change.
-- ============================================================================

alter table public.client_portal_users
  add column if not exists password_hash text,
  add column if not exists password_set_at timestamptz,
  add column if not exists password_failures integer not null default 0,
  add column if not exists password_locked_until timestamptz;
comment on column public.client_portal_users.password_hash is
  'scrypt of the keyed hash of the password, salted (Remus H8, from Raptor S16). Only api/portal (service role) reads or writes it; never sent to a browser.';

alter table public.site_diary_entries
  add column if not exists show_client boolean not null default false;
comment on column public.site_diary_entries.show_client is
  'Ticked: the client portal shows this day''s "Work done" as a progress note (Remus H8). Nothing else of the entry is shown.';

create index if not exists site_diary_entries_client_idx on public.site_diary_entries (project_id, date desc) where show_client;
create index if not exists site_diary_photos_client_idx on public.site_diary_photos (project_id, created_at desc) where show_client;

alter table public.quotes
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_via text,
  add column if not exists accepted_portal_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_accepted_portal_user_fkey') then
    alter table public.quotes
      add constraint quotes_accepted_portal_user_fkey foreign key (accepted_portal_user_id)
      references public.client_portal_users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_accepted_via_check') then
    alter table public.quotes
      add constraint quotes_accepted_via_check check (accepted_via is null or accepted_via in ('portal', 'office'));
  end if;
end $$;
comment on column public.quotes.accepted_by_name is
  'The name the client typed when accepting the quote on the portal (Remus H8).';
comment on column public.quotes.accepted_via is
  '''portal'' when the client accepted it themselves on the client portal (Remus H8).';
