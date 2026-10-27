# Remus · Handoff 2 (written 26 Oct 2026 by the Remus · Handoff 1 session)

For the next Claude Code session on `septumusrex69/Remus`. Read `CLAUDE.md` (the standing rules),
then this file, then do the Raptor check below **before** waiting for Stephan's instructions.
**You are the Remus · Handoff 2 session**: say so on every reply and commit (`Remus H2: ...`), and
write Handoff 3 at the top of this file before you finish (CLAUDE.md, "Say which project").

## Decided and paused (27 Oct 2026, Remus · Handoff 1)

- **WhatsApp a quote: option 3, the PDF file itself.** Stephan: "send the PDF file itself, that's the
  best one ... like share it" -- then "just pause this for now". So when it is picked up: a WhatsApp
  button on the quote that shares the PDF FILE through the device's share sheet (what `shareQuotePdf`
  in `src/lib/api.ts` already does), not a link to the quote and not WhatsApp's paid business API.
  Raptor's `WhatsAppButton` (opens the chat on the client's cellphone) is the model for the button.
- **Supplier prices for quotes (Stephan's "crawler" idea), under discussion:** find a material near
  the site or another point, within a radius he sets (more than one), compare prices, prefer one
  supplier where he has a discount; buying from the app is a later second part. Nothing built yet.

## Remus · Handoff 1: change requests, copied from Raptor (26 Oct 2026, branch `claude/requests`)

Stephan: *"Raptor built something in where you have like a suggestions thing from the people who's
using the app. Can we copy that exactly?"* Copied from Raptor's newest version (Raptor · Handoff 12,
the Feedback Centre and the build queue, `claude/sales-raptor-review-p1pzx2` at 0370850):
- **The light bulb** in the top bar on every page: what should change (typed or **dictated**), which
  department (Quotes, Projects, Crew & schedule, Money, Clients & mail, Whole system; suggested from
  the page), screenshots or PDFs (shrunk on the device before they are sent). It becomes **R-1, R-2...**
- **Requests** in the sidebar (`/requests`): Overview (last night's review with four tiles, new
  requests waiting), List and Board; each request opens in a **panel from the right** showing who
  asked, the review's reading, the screenshots, and the history. Stephan approves, asks Claude to
  build it, asks a question, assigns it, or declines (with a reason). The person who asked **tests**
  it once released: It works, or Not right yet (back to Approved with what is wrong).
- **The bell** (new to Remus): Raptor's notifications. New requests, decisions, questions and the
  nightly review land there; it re-reads once a minute and when the app comes back into focus.
- Database: `0017_change_requests.sql` (applied live 26 Oct; tables only added, nothing changed).
  Reading needs an active member; only an Administrator moves a request. Tested end to end in a
  rolled-back transaction (send, approve, release, test, every notification), then the number
  counter was reset so the first real request is R-1.
- **The nightly review is scheduled** (Stephan asked, 26 Oct): scheduled task "Remus · nightly
  change-request review" (`trig_013KQ3P3VwozMYLoxsFi9koA`), 01:53 Johannesburg every night, a fresh
  session that runs Job 1 of the skill on `main` (or `claude/requests` until it is live). **The
  Supabase connector has to be attached by Stephan in Scheduled -> Edit** (a session cannot attach
  one) -- without it the run stops and says so. **The builder is still not scheduled.**
- Earlier note: **Not switched on yet: the nightly review and the builder.** They are scheduled Claude sessions
  following `.claude/skills/change-requests/SKILL.md`. Remus has one database and it is live, and
  `main` is live, so the skill's builder only ever pushes a preview branch and marks a request
  "released" with the preview link; going live stays Stephan's "go live". Ask Stephan before
  creating either schedule.
- Tests: `src/lib/changeRequests.test.ts` (Raptor's check as vitest; the department list is held
  against the migration and was seen failing when broken).
- **Brought up to Raptor's newest the same day** (Stephan: "update the recommendations part in Remus to
  the newest on Raptor"; Raptor `claude/sales-raptor-review-p1pzx2` at ad9ea05): one **Open** list
  (new, approved and in development together; it opens there, All last), each row marked with its
  stage and "Needs feedback from <name>"; **questions with options to tick** (2-6, or Other in their
  own words); a note written by Claude is named Claude. `0018_change_request_choices.sql`, applied live.
- **A fault in Raptor's version, fixed here and NOT in Raptor:** Raptor's `change_request_choices`
  policy reads `change_request_events` from inside that table's own insert policy, and Postgres
  refuses every insert into such a table ("infinite recursion detected in policy"), so on Raptor no
  note, question or answer can be added by a person. Remus asks the same question through a definer
  function, `change_request_answers_ok` (end of 0018), proved in a rolled-back transaction. Raptor's
  staging carries the faulty policy (checked read-only, 26 Oct); Stephan was told. When Raptor fixes
  it, copy whatever it does if it differs.

## Find prices, step 1: Remus's own crawler (27 Oct 2026, Remus · Handoff 1, branch `claude/price-crawler`)

Stephan: build our own crawler first, then pure Claude, then a combined version, and compare them.
Step 1 (no AI): `api/prices/search.ts` + `api/_lib/priceCrawl.ts` -- one search page per store per
press (Builders, Leroy Merlin, Cashbuild, BUCO, Plumblink, Build It), products read from JSON-LD,
embedded JSON or microdata, each store's outcome said plainly. Signed-in users POST; a build session
uses `GET ?q=...&key=PRICE_PROBE_KEY` (and `&raw=<store>` to see what a store sent), the key set on
this branch's PREVIEW only. Not yet on any screen. Steps 2 (pure Claude) and 3 (combined) need an
ANTHROPIC_API_KEY in Vercel, which Remus does not have (the slip reader needs it too).

**What the stores said, 27 Oct (from Remus's server in Paris, cdg1):**
- **Cashbuild: works.** `/search?search_query=` (its own JSON-LD names it; `/catalogsearch` is a 404),
  products read as product cards (`data-price` + `product-title`): "close coupled toilet" 7 products,
  "galvanised pipe" 12. **Its prices are per store** and the page defaulted to "Musina | P&L
  Hardware" -- choosing the store (near the site) is still to do.
- **Builders: no.** A React shell behind PerimeterX bot protection; products come from a hidden service.
- **Plumblink: no.** An Angular shell; products come from `api.esolve.co.za` after a session is opened.
- **Build It: no prices online at all.**
- **Leroy Merlin: 403. BUCO: robot check.** Worth one retry from a South African server region
  (Vercel `cpt1`) before giving up -- a foreign address may be part of why.

## Released 26 Oct, and what is still waiting

**Second release, 26 Oct (Stephan's second "go live"):** everything listed below under "After the
release" up to Remus as a phone app is now on `main` too (scope of work, section cards, simpler
line items, subcontractors, deposit on acceptance, timeline on the quote, number boxes, PDF menu,
the new dashboard, installable phone app). Migrations up to 0015 applied live.

**Live on `main` (26 Oct, Stephan's "go live"):** branch `claude/quote-line-details`, which carries
`claude/remus-skins` too. So these are all live: Settings in Raptor's layout; details under quote
lines with dictation; unit price locked to cost × markup; faster quote sending (photos shrunk);
Print/PDF save first; all client mail filed on the client; planning and profit on the quote
(stages, timeline, labour, management fee, approval); the "Registered for VAT" switch. Migrations
0009–0012 are applied live.

**After the release (26 Oct, on `claude/quote-line-details`, preview first):** section names are
an always-visible box with a pencil (a tap used to open a rename prompt by surprise; renaming onto
an existing section's name is refused, not merged); the line rows lay out by the card's width
(`@container`), so on an iPad the description gets its own row instead of being squeezed to
nothing; and a **Scope of work** summary above the line items (`quotes.scope`, migration 0013,
applied live) with Dictate, printed above the lines on the print view and PDF.

**Simpler line items (26 Oct, same branch):** Stephan: "this all looks very confusing and like a
lot". Line items are pricing only: column titles once; the price per unit sits under the line
total (no Unit price column); move/delete in a ⋯ menu (`RowMenu`); one "+ Add line" (the MAT/LAB/SUB
tag changes the kind). Stage days and start moved into the Plan card beside the timeline
(`QuotePlan.tsx`); the "+ N days" box only shows once a stage hangs off another.

**Subcontractors, deposit on acceptance, hideable details (26 Oct, same branch):** migration
`0014_subcontractors_and_deposit.sql` (applied live). `subcontractors` table + page (menu item and
"+ Add", `subcontractors/SubcontractorsPage.tsx`: name, trade, contacts, usual rate per
day/job/hour/m²/each, VAT no., bank details, notes, 1–5 rating, "no longer used"). A SUB line has
"Done by [subcontractor]" (`quote_items.subcontractor_id`), which fills the cost and unit from
their rate; internal, never printed (the client sees only the description at our price).
`quotes.deposit_pct` (default 50, in Totals). **Accepted** opens `AcceptQuoteModal`: create the
project and/or a DRAFT deposit invoice (deposit % of total excl., VAT at the quote's rate), then
opens the project's Invoices tab. Line details: empty box can be **Hidden**; typed details stay
(Remove asks first).

**Estimated timeline on the quote (26 Oct, same branch):** Stephan wants the plan on the quotation,
always with a clause that it is only an estimate (weather and the like can change it). Migration
`0015_plan_on_quote.sql` (applied live): `quotes.show_plan` (default on; switch in the Plan card)
and `company_settings.plan_disclaimer` (editable in Settings → Quotes & Invoices). Print view
(`PlanBars`) and PDF draw "Estimated timeline" + the clause above Notes/Terms. The PDF has its own
copy of the arithmetic (`api/_lib/quoteSchedule.ts`, since api/ can't import src/);
`src/lib/quoteSchedule.test.ts` holds it equal to `scheduleStages` (checked to fail when broken).

**Dashboard: "what do we have to do?" (26 Oct, same branch):** Stephan wants today, tomorrow,
the next job, open quotes, money in the bank and spending up front. `DashboardPage.tsx` now: a
hero band (greeting, date, jobs on site today, open quotes, next start); Raptor's **Needs
attention** (overdue invoices, expired sent quotes, quotes waiting for approval, expiring this
week, sent a week ago with no answer, draft invoices, bank lines to link, unread mail; late items
first); money tiles (In the bank from the newest statement line with a balance, `loadBankBalances`
in api.ts; owed to us; open quotes = draft + sent not expired; this month); Today / Tomorrow cards
(jobs on site, diary events, project starts and finishes, quotes expiring, invoices due); Next job
to start; later this fortnight; then profit per project, active projects, recent spending. The
live bank account's imported statement has no balance column, so "In the bank" shows a hint.
Restyled the same day after Stephan's "it looks weird": unread email removed from Needs attention;
attention items are tinted tiles (red = late, amber = waiting) with the number, one line, and the
action under it; section headings (What is happening / Money / How the jobs are doing); Today and
Tomorrow cards with a coloured band and coloured time tags by kind; Next job card with its own
band; money tiles with coloured icons, each a link.

**Number boxes (26 Oct, same branch):** `components/ui/NumInput.tsx` replaces `<input type="number">`
on the quote screen and Plan card: it keeps its own text so a leading 0 is dropped as you type
(Stephan got "032"), selects the number on tap so typing replaces it, and draws "R" / "%" inside
the box. The Plan's "+ days" box uses the text keyboard because the iPad number pad has no minus.
26 Oct, Stephan: "throughout the whole application". Every number box now uses `NumInput` (slips,
expenses, project and invoice/payment forms, site diary, Settings, subcontractor rate, mailbox
ports); `allowEmpty` keeps "empty means work it out" where that matters (a slip's VAT, a
subcontractor's rate). Only chart axes still say type="number". Use NumInput for any new box.
Totals rows are label | box | amount so the deposit no longer wraps.

**Sections as cards (26 Oct, same branch):** Stephan couldn't tell sections apart. Each section of
the line items is now its own bordered card with a fold arrow; folded, it shows one summary line
(name, lines, working days, labour/subcontractor, total). "Fold all / Open all" in the card
header. Column titles sit inside each open card. (Delete a line: the line's ⋯ menu.)

**PDF menu (26 Oct, same branch):** the quote's PDF button is a menu (`quotes/PdfMenu.tsx`):
Preview (new tab, as before), Download (`downloadQuotePdf`: an `<a download>` with the server's
file name, so an iPad asks "Download?" and saves to Files → Downloads), and, where the device can
share files, Share or save to Files (`shareQuotePdf`: the share sheet; falls back to a download if
the browser refuses because the PDF took long to build). All three save the quote first.

**Remus as a phone app (26 Oct, same branch):** Stephan asked for Remus on a phone. Not in Raptor;
done as an installable web app (no App Store): `public/manifest.webmanifest` (name, icons,
shortcuts to Snap slip and New quote), iOS meta tags in `index.html`, `public/sw.js` (caches NO app
code, only `offline.html` for a "No connection" page), `vercel.json` rewrites/headers for them
(index.html and sw.js not cached). Chrome reports no installability errors.
`components/layout/UpdateBanner.tsx`: compares the running build's script name with the server's
(on focus and every 5 min) and shows "Remus has been updated · Reload"; also registers the SW.
Phone fixes after checking every main page at 390 px: Settings menu is a dropdown on phones, card
headers wrap, quote line boxes are labelled on phones, Snap slip floats as a round camera button,
Needs attention is two tiles per row, room for the iPhone home bar.
A real App Store / Play Store app (Capacitor wrapper) is possible later; it needs an Apple developer
account (USD 99/yr) and store review.

**Still NOT on `main`:** `claude/mail-picture-store` (mail pictures saved once, Outlook-style;
section below). Migration 0008 is applied live; the code is not merged. It touches different files
except this one. Release with a merge of `origin/main` first, when Stephan says so.

**Next (step 2 of planning):** workers (senior/junior, day cost), accepted quote → dated project
stages from a start date, booking workers on stages, company schedule with double-booking
warnings, Diary entries, project profitability (quoted vs actual per stage).

## All client mail filed on the client (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: "file all the mails under a specific client, so it's all together" (not per project).
Migration `0010_file_mail_on_clients.sql` (applied live 26 Oct after Stephan confirmed all clients are test data; it filed 27 messages):
`file_mail_on_clients(p_user, p_email)` files kept mail whose client-side address (sender for
received, To/Cc for sent) is a contact's or company's email: links the `user_emails` row and adds
the `activities` row the Emails card shows. Runs after every sync (`syncConnection`), from a
trigger when a contact/company is added or its email changes, and once in the migration (dry run
25 Oct: 27 messages, all on test client "Ferman Aanskaf", whose email is Stephan's old address
stephan@bredellferreira.co.za). `unfiled_at`: set by "take off client", the automatic filing skips it.

## Not registered for VAT (26 Oct 2026, branch `claude/quote-line-details`)

Stephan: Urban Haus is not VAT-registered yet, and that "should be there in the settings".
Migration `0012_vat_registered.sql` (applied live; set to false for Urban Haus):
`company_settings.vat_registered`, a tick box in Settings → Quotes & Invoices. When off,
`useVatRate()` returns 0, so new quotes and invoices charge no VAT and slips / bank expenses are
costed at the full amount (unclaimable VAT is cost; the slip reader's VAT figure is ignored). The
connector does the same. A quote at 0% shows a plain Total (no "excl. VAT" / VAT rows) on print,
PDF and email; the editor warns when a quote charges VAT while the company is not registered.
Existing test quotes Q-0001…0005 still carry 15% (test data; Stephan can switch each).

## Planning and profit from the quote, step 1 (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: plan the job from the quote (each part takes N days, starts after/with another, overlaps),
see how long the job takes, price labour, add a management fee, and see the estimated profit
internally before approving the quote. His answers: management fee as its own line on the quote;
labour per worker per day, senior or junior; workers are individuals (step 2).
Migration `0011_quote_planning.sql` (applied live 25 Oct; fee defaults to 0 so live totals are
unchanged, checked on every quote):
- `quote_items.kind` (material/labour/subcontractor), `labour_grade`, unit `day`.
- `quote_stages`: one per section (name '' = General): `duration_days`, `start_mode`
  (start/with/after), `start_ref`, `lag_days`. `scheduleStages` in `src/lib/quoteMath.ts`.
- `quotes.management_fee_pct`, `approved_at/by/total`; `quote_totals` view includes the fee.
- `company_settings`: senior/junior day rates, default markup per kind, default fee.
Screens: each section heading has "Takes N working days · Starts … + N days"; line tag
MAT/LAB/SUB (tap to change); labour lines pick Senior/Junior (sets the day rate); "+ Material /
+ Labour / + Subcontractor"; Plan card (timeline, `QuotePlan.tsx`); Totals card has the fee and an
internal panel (cost by kind, markup, fee, estimated profit, job length, profit per day) and
**Approve** (Administrators). Send / Mark sent need a current approval; `api/quotes/send.ts`
refuses (409) otherwise. Fee shows as "Project management (N%)" on print, PDF and email.
Also: Print and PDF now save first (Stephan's Toilet/Basin were missing from a PDF made before
saving).

**Step 2, next:** workers (senior/junior, day cost), converting an accepted quote into dated
project stages from a start date, booking workers on stages, company schedule with
double-booking warnings, Diary entries, and project profitability (quoted vs actual per stage).

## "Urban House" spelling cleaned out (25 Oct 2026)

Stephan asked for every "Urban House" to become "Urban Haus". The code on every branch already
had none. In the database it was only Settings → Company: name was "Urban House Group" and email
"stephn@urbanhousegroup.com"; changed (with his instruction) to "Urban Haus Group" and
stephan@urbanhausgroup.co.za. Every text column in public and auth was searched; no other
hits. Vercel env EMAIL_FROM is already "Urban Haus Construction <quotes@urbanhausgroup.co.za>".

## Faster quote sending (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: "sending a quote takes super long". Q-0006 had three iPhone photos (7 MB): downloaded
twice, sent twice (in the PDF and attached), uploaded twice (SMTP send + copy to Sent): ~40 MB.
`api/_lib/quoteFiles.ts`: each file downloaded once per request, in parallel, shared by the PDF
and the attachments; JPEG/PNG shrunk with `sharp` to 1800 px on the long side (and turned upright
from the iPhone rotation flag). Originals in Storage untouched; an uploaded client PDF goes as is.

## Unit price locked to cost × markup (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: unit cost and markup are typed, unit price is never typed (0% markup sells at cost).
`applyLineEdit` in `src/lib/quoteMath.ts` always sets price = cost × (1 + markup); the editor
shows the price as text. Old lines priced by hand with no cost open as cost = that price at 0%
(`lockedPriceLine`), so their price doesn't change. The connector's `create_quote` follows the rule.

## Quote line details + dictation (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: on a quote line like "Toilet" he wants to write out what's included ("installation of the
toilet, this, that"), and to talk instead of type, "like in Raptor".
- `quote_items.details` (migration `0009_quote_item_details.sql`): optional longer text. In the
  editor a list-plus icon in the description box opens it; it shows under the line. Printed in
  small grey under the description on the print view, the PDF (`api/_lib/quotePdf.ts`) and
  returned/accepted by the Claude connector (`get_quote`, `create_quote`).
- Dictation copied from Raptor: `src/lib/dictation.ts`, `src/components/ui/Dictate.tsx` (browser
  speech recognition, free, en-ZA / Afrikaans / en-GB, keeps listening through pauses). On every
  line's details box and on the quote Notes.

## Lean Mail (24 Oct 2026) — mail pictures saved once, Outlook-style

Stephan saw Raptor Mail taking up Supabase space. Cause, in both apps: the mail parser turns every
signature logo into base64 inside the stored HTML (Remus: 59 messages = 19 MB). Morning fix (PR #7,
live): pictures taken out of stored mail. Afternoon, Stephan: "save one image somewhere and then always
go and check it and take it back, like Microsoft, and then delete it after 30 days." So (branch
`claude/mail-picture-store`, ported from Raptor S11):
- `api/_lib/mailPictures.ts`: each picture fingerprinted (SHA-256), saved ONCE in the private
  `mail-pictures` bucket + a `mail_pictures` row; stored markup says `cid:remus-pic-<hash>`.
  Saved at sync and when the Mail page asks the mailbox for pictures (which also rewrites the row).
- `src/lib/mailPictures.ts` `fillStoredPictures`: the Mail page draws the logos from the store (kept in
  memory for the visit) and goes to the mailbox only for one the store lacks.
- `expireMailPictures` in the daily sync cron: unused 30 days → deleted; a later open re-saves it.
- Migration `0008_mail_pictures.sql`, applied. Rows cleaned in the morning carry
  `cid:remus-picture-not-kept`; they heal the first time each is opened.
Check it: `select count(*), pg_size_pretty(sum(bytes)) from mail_pictures;`

## Start of every session: check Raptor first (keep this section in every update)

Stephan works on Raptor (`septumusrex69/Sales-Raptor`) every day, and Raptor is the template for
Remus: *"when we build things, build it exactly like Raptor."* So each session starts by seeing
what Raptor gained since the last one:

1. Clone Raptor read-only and list its branches newest first (commands in `CLAUDE.md`). **The
   default branch `Main` is stale (12 Sep 2026); never copy from it.** On 22 Oct the live branch
   was `claude/s10-clients-and-credits`.
2. On the newest branch, read Raptor's `HANDOFF.md` and `git log --since="<date of this file>"`
   to see what shipped.
3. Tell Stephan, in plain language, which new Raptor features would make sense in Remus, and
   which are debt-collection only and don't apply. Build only what he picks.
4. Tick off the Raptor checklist in `CLAUDE.md` as features land, and update the "Raptor last
   checked" line below.

**Raptor last checked:** 26 Oct 2026 (Remus · Handoff 1) — branch `claude/sales-raptor-review-p1pzx2`
at 0370850 (Raptor · Handoff 12). Copied: change requests, the Feedback Centre, the bell. Raptor's
own rule now is to say "Raptor · Handoff N" / "Remus · Handoff N" on everything (CLAUDE.md here too).
Not for Remus: debtor campaigns from a central mailbox, written-off accounts.

Earlier: 24 Oct 2026 — Raptor S11 · Lean Mail (`claude/s11-lean-mail`) shipped one fix,
already ported here (see "Lean Mail" below). Before that: 23 Oct 2026, branch `claude/s10-clients-and-credits` (newest commit
22 Oct 15:37, "Merge People: employee profiles, pay statements…"). New since 22 Oct:
- **People: employee profiles and pay statements.** Relevant to Remus's planned Workforce phase
  (workers, weekly pay runs, payslips): copy Raptor's People screens when that phase starts.
- Not for Remus: campaign results under Reports, news/marketing opt-in replies, write-off
  reasons, GitHub code-owner rules (debt-collection or marketing specific).

## What Remus is

The management app for **Urban Haus Construction** (Urban **Haus**, never "House"): quotes,
clients, projects, job costing, slip capture, bank reconciliation, diary, finance and client mail.
ZAR, VAT 15%. **Standalone:** it will not be merged into Raptor; it copies Raptor's patterns.

- Repo: `septumusrex69/Remus`. Live: https://remus-xi.vercel.app, deployed by Vercel from `main`.
- Vercel project `remus`, team Team Raptor (`team_NqhNnG5PYU2gClsXdgoQMbOE`).
- Supabase project "Remus", ref `gakebvnwzxhxccgtvfuw`, eu-west-3. Migrations 0001–0006 applied.
- Demo data from 21 Oct (projects UHG-001…005, quotes, expenses, invoices, bank lines `demo-1`…
  `demo-9`). Remove it before real use, when Stephan asks.
- Stephan logs in as `stephan@urbanhausgroup.co.za` (Administrator). His old login
  `stephan@bredellferreira.co.za` (Team member) still exists; ask before removing it.

## Where the work is

**Live on `main`:** everything from the old `remus-e2e-fixes` branch (bug fixes, access control,
invites, branding, quote PDF, Claude connector, speed) plus, from Raptor:
- each person sends from their own mailbox (Settings → My email);
- client emails: an Emails card on every client page, send/reply, daily sync (Vercel Cron
  04:00 UTC, `CRON_SECRET` set) and on Sync, attachments fetched from the mailbox on demand
  (`api/email/{send,sync,attachment}.ts`, `api/_lib/emailSync.ts`, migration 0006).

**Released 23 Oct with Stephan's OK** (branch `claude/laughing-ritchie-bd167j`, preview
https://remus-git-claude-laughing-ritchie-bd167j-team-raptor.vercel.app):
- Raptor's frame in Urban Haus colours: folding sidebar, top bar (search, unread-mail envelope,
  "+ Add"), Raptor's card/button/figure styles and Inter;
- a **Mail** page listing every client email (Inbox / Unread / Sent / All, search, my mailbox or
  the whole team). Email buttons don't work on previews because `SUPABASE_SERVICE_ROLE_KEY` is
  set for Production only.

**Mail page, Raptor's full mailbox (23 Oct):** ported from Raptor's `src/pages/mail/MailPage.tsx`.
- Every message in Inbox, Junk and Sent is kept in `user_emails` (migration 0007, applied live),
  body included (capped at Raptor's limits), visible only to its owner. Blocked senders
  (`mail_blocks`) never become rows.
- Screen: All / Junk / Sent / Blocked tabs with unread counts, search over the whole mailbox,
  Unread only, page sizes, Select for bulk read/unread/junk/delete, list or reading-pane view,
  Raptor's floating action bar (Mark unread, Reply all, Forward, Open client, more…, Reply).
  "File on a client" puts a message on the client's Emails card; mail from known clients is filed
  automatically by the sync. The envelope and the Mail badge now count the whole mailbox.
- Left out on purpose (debt collection only): debtor files, fees, tickets, leads. Not yet ported:
  calendar invites, pictures embedded by cid (signature images), forwarding attachments,
  moving messages between server folders (Junk is a flag in Remus, not a server move).
- Code: `src/pages/build/mail/MailPage.tsx`, `src/lib/mailbox.ts`, `src/lib/emailHtml.ts`,
  `src/components/email/{ReadingPane,EmailViewSwitcher}.tsx`, `src/components/ui/RowMenu.tsx`,
  `api/_lib/emailSync.ts`, `api/email/{send,attachment}.ts`.
- **Read status follows the mailbox (23 Oct):** new mail arrives read if it was already read in
  Outlook or on a phone, and every sync asks the server about messages Remus still shows unread and
  marks read any it has seen (`catchUpReadState` in `api/_lib/emailSync.ts`). One way only.
- **Sync failures are shown, not swallowed (23 Oct):** a red line on the Mail page, and every
  refusal is logged by `api/email/sync`. Check Vercel runtime logs for `[email/sync]` / `[emailSync]`.
- **Use the live link only:** https://remus-xi.vercel.app. On 23 Oct Stephan was on an old
  preview link (`remus-git-…`), where email can't work (the service key is Production only).
  Never send him a preview link without saying clearly that email won't work on it.
- First real sync (23 Oct): Inbox 40, Sent 19, Junk ("INBOX.spambucket" on his server) empty.


**Remus brand and skins (24 Oct, live with Stephan's OK; built on branch `claude/remus-skins`):**
Stephan's brief: "we're operating as Urban Haus, but the app's name is Remus", make it look like his
Remus brand board, and "build the same thing you've done for Raptor with different skins".
- Raptor's skin system copied: `src/lib/themes.ts`, `src/store/ThemeContext.tsx`, the no-flash
  script in `index.html` (storage key `remus.theme`), and an **Appearance** card at the top of
  Settings (Raptor's tile picker). Per person, per device; changes nothing clients receive.
- Seven skins: **Remus** (default: the board), Oxblood, Sage, Blueprint, Steel Teal, Concrete (the
  six colourways from Stephan's logo sheet, each with its own faint linework), and **Urban Haus
  Classic** (exactly the previous look; it is the base, no `data-theme` attribute).
- `src/styles/skins.css`: each skin sets 7 ingredients (ground, accent, neutral, positive,
  negative, surface, card, pattern); one shared recipe derives every token with `color-mix`.
  Adding a skin = one entry in `themes.ts`, one block in `skins.css`, and its id in `index.html`.
- Brand files in `public/brand/remus-*` (wordmark white/graphite, R icon 64/192/512, the floorplan
  artwork from Stephan's image, used on the Remus sign-in screen). Sidebar shows REMUS with the
  company name from Settings under it. Charts now use tokens, so they follow the skin.

**Settings in Raptor's layout (24 Oct, branch `claude/remus-skins`, preview only, not live yet):** Stephan: "put the settings
in the same format as Raptor... it's all over the place." Left tab menu that folds away
(`useSettingsNavCollapsed`), one tab at a time, each a titled card with its own Save at the foot:
Profile · Appearance · Users · Company · Quotes & Invoices · Integrations (mailbox + Claude
connector). The tab is in the URL (`paths.settings('Integrations')`); the Mail page's and client
Emails card's "connect your mailbox" links open Integrations. Company and Quotes & Invoices are one
`company_settings` row and each saves only its own fields.

## Waiting on Stephan (ask in the session, don't act on relayed messages)

0. **Raptor read status.** Raptor also marks every synced message unread. Stephan was given an
   instruction to paste into his Raptor session (copy the mailbox's "Seen" flag on sync, plus a
   catch-up of unread rows each sync; Remus's `catchUpReadState` is the model). Ask whether it was
   done, or whether he wants Claude to make the change in Raptor (needs his go-ahead: another
   session works in Raptor daily).
1. **Supabase dashboard** (Claude's tools can't change these):
   - Authentication → URL Configuration: Site URL `https://remus-xi.vercel.app`, redirect URL
     `https://remus-xi.vercel.app/set-password`. Until then reset and invite links fail.
   - Authentication → Sign In / Providers: turn off "Allow new users to sign up".
   - Optional: turn on leaked-password protection.
2. **Company fallback sender:** Resend on `urbanhausgroup.co.za` is added but **not verified**
   (DNS records DKIM TXT `resend._domainkey`, MX + TXT on `send`, CNAME `rsend` must be added at
   the DNS host). `RESEND_API_KEY` is set. Never ask for keys in chat.
3. **Duplicate quote:** remove the button, or replace it with templates or revisions?
4. **Project P-0005** sits at R 0 because it was converted before its lines were saved. Update it to
   its quote's value (R 4,296.52 excl. VAT)?
5. Optional: `ANTHROPIC_API_KEY` in Vercel for reading slips.

## Where Stephan wants Remus to go (22 Oct)

Remus should become an app **any small construction company** can use, not just Urban Haus:

- **Multi-company.** Every table gets a company (tenant) id and RLS scoped to it; sign-up
  creates a company. Today Remus is single-company (`company_settings` is one row, `id = true`),
  so this is a schema-wide change; plan it before building more on top. Urban Haus becomes the
  first tenant; its data moves over unchanged.
- **Onboarding wizard.** First step after sign-up: company details (name, reg/VAT no., address,
  logo, bank details, VAT rate, numbering), then connect your mailbox, then invite your team.
- **Each company links its own email** (built per person, see above) and anything else it needs,
  so nothing is hard-wired to Urban Haus (the Urban Haus logo default in `quotePdf.ts`, the
  brand colour, `APP_URL`, the README's company name).
- **Supplier prices for quotes (the biggest pain: quoting takes too long).** Look up material
  prices from local suppliers (Builders Warehouse, Cashbuild, BUCO, Leroy Merlin…), keep a price
  list per company, and fill quote lines from it. Check each supplier's terms first: prefer
  official feeds/APIs or supplier price lists (CSV/PDF the company uploads), and only crawl where
  that's allowed; cache prices with the date and source so a quote shows how fresh each price is.
- **Later: AI buying.** From an accepted quote, build the order per supplier, and eventually
  place it online with a person's approval on every order.

## Next phases (planned, not started; confirm order with Stephan)

1. **Visual refresh (skins done 24 Oct):** still to do from the board: project cards with site photos
   and progress on the dashboard and Projects list, a project workspace hero (photo, phase,
   progress, milestones), and a dark mode.
2. **Workforce:**
   - workers (separate from logins), teams, and scheduling with clash warnings;
   - daily site check-in and attendance, with an audit log;
   - a Site Manager role that can't see money;
   - weekly pay runs: UIF, advances, payslips, bank CSV, and labour booked to projects without
     double-booking.
3. **Project planning** in the style of the Smartsheet templates Stephan shared:
   - per-project plan with WBS phases and tasks, coloured phase bands and a Gantt (drag to
     reschedule), from a construction starter template or the quote's sections;
   - company-wide Gantt with a "Now" panel;
   - dashboard toggled between whole company and one project.

## Notes

- Never send a DROP statement through the Supabase MCP: it waits for a confirmation that never arrives.
- `useLoad(loader, deps, cacheKey)` caches per key. Pass a key for list and detail pages.
- Charts: put new ones in `src/pages/build/components/charts.tsx` and load them through `LazyCharts.tsx`.
