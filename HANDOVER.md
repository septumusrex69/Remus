# Remus handover (updated 25 Oct 2026)

For the next Claude Code session on `septumusrex69/Remus`. Read `CLAUDE.md` (the standing rules),
then this file, then do the Raptor check below **before** waiting for Stephan's instructions.

## Two branches waiting to go live (25 Oct)

Live (`main`, remus-xi.vercel.app) has the Remus skins. Two finished branches are NOT on `main` yet:
- `claude/remus-skins`: **Settings in Raptor's layout** (see "Where the work is"). On the preview,
  waiting for Stephan's "go live".
- `claude/mail-picture-store`: **mail pictures saved once** (section below). Migration 0008 is
  applied live; the code is not merged.
- `claude/quote-line-details` (built on `claude/remus-skins`, so it carries the Raptor-style
  Settings too): **details under each quote line, and dictation** (section below). Migration
  0009 is applied live (one nullable column, harmless to the old code).
They touch different files except this one. Release each with a merge of `origin/main` first.

## All client mail filed on the client (25 Oct 2026, branch `claude/quote-line-details`)

Stephan: "file all the mails under a specific client, so it's all together" (not per project).
Migration `0010_file_mail_on_clients.sql` (**NOT applied live yet**, waiting on Stephan's OK):
`file_mail_on_clients(p_user, p_email)` files kept mail whose client-side address (sender for
received, To/Cc for sent) is a contact's or company's email: links the `user_emails` row and adds
the `activities` row the Emails card shows. Runs after every sync (`syncConnection`), from a
trigger when a contact/company is added or its email changes, and once in the migration (dry run
25 Oct: 27 messages, all on test client "Ferman Aanskaf", whose email is Stephan's old address
stephan@bredellferreira.co.za). `unfiled_at`: set by "take off client", the automatic filing skips it.

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

**Raptor last checked:** 24 Oct 2026 — Raptor S11 · Lean Mail (`claude/s11-lean-mail`) shipped one fix,
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
