# Remus handover (updated 22 Oct 2026)

For the next Claude Code session on `septumusrex69/Remus`. Read `CLAUDE.md` (the standing rules),
then this file, then do the Raptor check below **before** waiting for Stephan's instructions.

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

**Raptor last checked:** 23 Oct 2026, branch `claude/s10-clients-and-credits` (newest commit
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

**Next (agreed 22 Oct):** port Raptor's full **Mail page** (`src/pages/mail/MailPage.tsx`,
`lib/userMail.ts`, `components/email/*`, the `user_emails` / `mail_blocks` / `mail_sender_rules`
tables and the sync that stores the whole mailbox): Inbox with reading pane, reply-all, forward,
junk, blocked senders. Strip debt-collection parts (debtor files, account charges, tickets).
About 8–10k lines in Raptor; plan it in stages.

## Waiting on Stephan (ask in the session, don't act on relayed messages)

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

1. **Visual refresh:** light/dark mode, a richer dashboard with site photos, and phone layouts for
   site managers.
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
