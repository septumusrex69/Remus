# Remus · Handover 8 helper: Raptor S18 brought over (7 Nov 2026)

Stephan, 7 Nov, on what Raptor has that Remus doesn't: *"We can like start with pretty much all of that."* Copied from
Raptor's live branch `claude/sales-raptor-review-p1pzx2` (S18, 6 Nov: aae1ef6, 727d4f5, 3effbb0, f401d23, 4ab33d3,
dda79a1) and from `claude/exciting-turing-byyd3w` (55a7520 + 0fe7651, crash emails). Migrations **0048** and **0049**
are written, **not applied** (apply both before this reaches the preview: the Requests page reads `parked_at`).

## What was built

1. **Requests can be parked** (Stephan on Raptor: *"something that is parked for now. Until I can make another
   decision"*). Not a status: `change_requests.parked_at / parked_by` over a Submitted or Approved request. The Big
   Boss parks (with an optional note) and takes it out again; any decision unparks it; parking takes it off Claude's
   queue; a **Parked** shelf on /requests; a grey Parked pill; "New requests waiting for a decision" and the sidebar
   count leave parked ones out; the nightly skill's queries too (`.claude/skills/change-requests/SKILL.md`).
   **The Big Boss may tick an answer** to a question put to somebody else (`mayAnswer`).
2. **Claude's questions go to whoever sent the request through** (*"the question should be asked rather to the
   administrator who sent it through"*): `questionFor()` -- the person who put it on Claude's queue, else who decided
   it, else who wrote it. The panel's "Needs feedback from ..." pill, who may tick, and the bell
   (`change_request_event_notify`, 0048) all name that person. A question an Administrator asks with Request info
   still goes to the person who wrote it. Also from the same Raptor commits: **Dictate** on the panel's note box and a
   question's Other box, and **one press, one answer** on a ticked question.
3. **Spell check, on by default, with a switch** (*"by default it's on, but the user can switch it off"*):
   `<html lang="en-ZA" spellcheck="true">` gives every box the browser's underlines; the email composer checks the
   subject and message against a British English Hunspell dictionary before it sends (`public/dictionaries/en-gb`,
   licence beside it; `nspell`, loaded on first send) -- suggestions to press, "Add to my words", Send again sends it
   as it is. Names, acronyms, numbers, merge fields and addresses are never checked. Settings -> Appearance has the
   switch (per device). Nothing is sent anywhere to be checked.
4. **The app no longer scrolls as a page** (Raptor's R-22: *"goes up and the grey displays at the bottom"*). Remus had
   the same shell: AppLayout is now `app-layout ... overflow-clip`, and `html:has(.app-layout)` is overflow hidden
   (src/index.css). Sign-in, the portal and print pages scroll as before.
5. **No flash of yesterday's photograph** (*"for an instant it shows the old picture"*). `src/lib/dayLookCache.ts`:
   today's answer (the day's row and the chosen photographs) is remembered on the device and painted before the first
   paint; the first visit of the day shows the band (and the sign-in panel) plain until the answer is in; four seconds
   with no answer falls back to the photographs as before. BuildContext now asks for the settings and today's photo
   together and paints once -- painting the chosen one first was itself a flash.
6. **A date in a list always names a day** (*"It says last week at 13:40 ... There's no actual date"*): the mail day
   headings (`emailDayLabel`) read Today, Yesterday, "Thursday 5 Nov", then "5 November"; "Last week" is gone.
7. **Crash emails** (Raptor 55a7520, "get told when it breaks"): a crash in somebody's browser on the live site
   (a page that breaks, or an uncaught error) is posted to **`/api/portal/report-error`** -- one more action on the
   existing portal endpoint, so **no new Vercel function**. Stored in `error_reports` (0049), one row per distinct error
   per 6 hours with a count; the first sighting is emailed through the company sender (RESEND_API_KEY + EMAIL_FROM,
   else SMTP, as api/quotes/send.ts) to every active Administrator and put on their bell -- **at most 3 alerts an hour**
   across all errors. The crash panel now says it was reported. Quiet on localhost; on previews the portal has no
   service key, so only the live site reports.

## Files

New: `src/lib/spellCheck.ts`, `src/components/SpellGate.tsx`, `public/dictionaries/en-gb/*`, `src/lib/dayLookCache.ts`,
`src/lib/errorReporter.ts`, `api/_lib/errorAlert.ts` (+ `.test.ts`), `src/lib/changeRequestsParked.test.ts`,
`src/lib/handover8Raptor.test.ts`, `scripts/qa/e2e/raptor-s18.mjs`, migrations 0048, 0049.
Changed: `src/lib/changeRequests.ts`, `changeRequestsApi.ts`, `components/requests/RequestPanel.tsx`,
`pages/requests/RequestsPage.tsx`, `components/email/ComposeEmailModal.tsx`, `pages/build/settings/AppearanceCard.tsx`,
`components/ErrorBoundary.tsx`, `main.tsx`, `index.html`, `index.css`, `components/layout/AppLayout.tsx` (one class),
`pages/build/BuildContext.tsx`, `pages/auth/LoginPage.tsx`, `lib/emailActivity.ts`, `api/_lib/portal.ts` (one route),
`scripts/qa/e2e/fixtures.mjs` (parked columns on the request fixture), the change-requests skill, package.json
(`nspell`, `@types/nspell`).

## Migrations (additive, no DROP anywhere)

- **0048_change_requests_parked.sql**: `parked_at timestamptz`, `parked_by uuid -> profiles on delete set null`;
  `change_request_boss_decides()` replaced (unpark on any status change; park only new/accepted and clear the build
  queue; parking is the Big Boss's); the trigger re-created with **`create or replace trigger`** to also watch
  `parked_at` (no drop needed -- the status check constraint could not be widened without one, which is why parked is
  two columns, as in Raptor); `nav_request_count()` leaves parked out; `change_request_event_notify()` sends Claude's
  questions to `coalesce(build_requested_by, decided_by, created_by)`.
- **0049_error_reports.sql**: `error_reports` (Raptor's columns + `alerted_at`), indexes, RLS on, Administrators read
  and mark resolved (policies created only if missing). No insert policy: only the server (service role) writes.

## Different from Raptor, and why

- Parked/questions: same rules. Remus's `mayAnswer` also lets the administrator a Claude question is FOR tick it;
  Raptor's copy turns Claude's `by_id: null` into `''`, so there that administrator cannot tick -- worth fixing in Raptor.
  The "New requests waiting for a decision" overview card leaves parked ones out (Raptor's has no such card).
- Spell check: building words in FIRM_WORDS instead of collections words; only the email composer is gated (Remus
  has no SMS boxes). Keys `remus.spellCheck*`.
- Photo flash: Remus's band is a skin's black glass, so "plain" is no photograph under the glass (Raptor paints navy);
  the chosen photographs are remembered with the day's row, since an unapproved day shows them.
- Crash emails: an action on `/api/portal/[action]` instead of Raptor's own `/api/report-error` (Vercel function limit);
  the company sender instead of a separate ERROR_ALERT_RESEND_KEY; recipients are the active Administrators from
  profiles instead of an ERROR_ALERT_EMAIL list; a bell notification too; a cap of 3 alerts an hour on top of Raptor's
  once-per-error-per-6-hours. Chunk-load errors (a new version deployed) are not reported: the boundary reloads.
  Not copied from 55a7520: its smoke tour and GitHub workflow (Remus already has `npm run qa`).

## Unfinished / to know

- **Apply 0048 and 0049** to the live project before the preview is shown (the Requests page selects `parked_at`).
  0048 uses `create or replace trigger` (Postgres 14+; Supabase is newer).
- Nothing reads `error_reports` on screen yet (Raptor has no page either): the email and the bell are the way in.
  The bell's link opens the page that broke.
- The bell's own "2d ago" times are unchanged (not a list of dates; Raptor's change was the day labels only).
- Crash emails need RESEND_API_KEY + EMAIL_FROM (or SMTP) on Production -- the same as the quote sender; Resend DNS is
  still open (Handover 9 list), so until then it may fail to send and only the bell and the table carry it.
