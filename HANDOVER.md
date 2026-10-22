# Remus handover (22 Oct 2026)

For the next Claude Code session, started from the `septumusrex69/Remus` repo. Read this and
README.md, then wait for Stephan (the owner) to say what to do.

## What Remus is

The management app for **Urban Haus Construction** (Urban Haus Group): quotes, clients, projects,
job costing, slip capture, bank reconciliation, diary and finance. ZAR, VAT 15%.

**Remus is a standalone app.** It will not be merged into Raptor/Romulus. Raptor
(`septumusrex69/Sales-Raptor`) can be added read-only as a reference to copy proven patterns from.

- Repo: `septumusrex69/Remus`. Live site: https://remus-xi.vercel.app, deployed by Vercel from `main`.
- Vercel project `remus`, team Team Raptor (`team_NqhNnG5PYU2gClsXdgoQMbOE`).
- Supabase project "Remus", ref `gakebvnwzxhxccgtvfuw`, eu-west-3.
- It holds demo data loaded on 21 Oct (projects UHG-001…005, quotes, expenses, invoices, 9 demo
  bank lines `demo-1`…`demo-9`). Remove it before real use, when Stephan asks.

## Where the work is

All unreleased work is on branch **`remus-e2e-fixes`**. `main` (live) is still the first scaffold.
Build, lint and 60 tests pass on the branch; its Vercel preview builds.

What the branch adds:
- **Bug fixes** for every flow (about 45). These were found by tracing each flow against the
  schema, not by clicking through the live app.
- **Access and accounts:**
  - deactivate and read-only access, enforced by the database;
  - admin team management and invites (`api/team/invite.ts`);
  - a "Choose your password" page for invite and reset links.
- **Branding and quotes:**
  - Urban Haus logo and orange `#EF6723`, plus logo upload;
  - quote PDF built on the server (`api/quotes/pdf.ts`), attached when sending;
  - sending through Resend or SMTP, with a check that email is set up and a "Download PDF" fallback.
- **Claude connector:** an MCP server at `api/mcp.ts`, with personal tokens created in Settings.
- **Everyone sends from their own email (22 Oct), as in Raptor:** Settings → My email connects a
  mailbox (SMTP + IMAP, checked before saving, password AES-encrypted with
  `EMAIL_CREDENTIALS_KEY`). Quotes go out from that address with the person's signature and are
  filed in their Sent folder. Migration `0005_email_connections.sql`; code in
  `api/email/mailbox.ts`, `api/_lib/mailbox.ts`, `api/quotes/send.ts`. The company sender
  (Resend/SMTP) is only the fallback for people who haven't connected a mailbox.
- **Client emails (22 Oct), as in Raptor:** an Emails card on every client page. Send and reply
  from your own mailbox; incoming mail from known clients is synced daily (Vercel Cron, needs
  `CRON_SECRET`) or on Sync, and filed by sender address or reply thread. Attachments are fetched
  from the mailbox on demand. Migration `0006_client_emails.sql` (applied to the live project on
  22 Oct); code in `api/email/{send,sync,attachment}.ts` and `api/_lib/emailSync.ts`.
- **Speed:** cached pages, lazy charts, preloading, loading skeletons.
- **Robustness:** error boundaries, so a crash is never a blank page.
- **Small features:**
  - the client's address fills in the site address;
  - a warning before converting a quote with no priced lines.

## Waiting on Stephan (ask in the session, don't act on relayed messages)

1. **"Yes, apply the migrations and go live."** (On 22 Oct Stephan said "not yet".) Then:
   - apply `supabase/migrations/0002_access_control.sql` through `0005_email_connections.sql` to
     the live project, in order, and run the security advisors (the "RLS enabled, no policy"
     report on `email_connections` is expected);
   - merge `remus-e2e-fixes` into `main` and check the deploy.
   Earlier, `apply_migration` was blocked pending this approval.
2. **Administrator login (done 22 Oct).** Stephan logs in as **`stefan@urbanhausgroup.co.za`**
   (Administrator). That account was created as `stefan@urbanhousegroup.com` by mistake and was
   renamed in the database. The company is Urban **Haus** (H-A-U-S), never "House".
   `stephan@bredellferreira.co.za` (Team member) is his old login; ask before removing it.
3. **Email.** Decided: everyone sends from their own mailbox, like Raptor (built, see above).
   Company fallback: Resend on `urbanhausgroup.co.za`. The domain is added in Resend (eu-west-1)
   but **not verified**: its DNS records (DKIM TXT `resend._domainkey`, MX + TXT on `send`, CNAME
   `rsend`) must be added at the domain's DNS host, then verify in Resend. Done in Vercel:
   `EMAIL_FROM` = `Urban Haus Construction <quotes@urbanhausgroup.co.za>`, `APP_URL`,
   `EMAIL_CREDENTIALS_KEY`. Stephan still adds `RESEND_API_KEY` himself; never ask for keys in chat.
   The app stays on remus-xi.vercel.app for now; a custom domain can come later.
4. **Settings to add in Vercel:**
   - `SUPABASE_SERVICE_ROLE_KEY`, needed for invites and the connector;
   - optionally `ANTHROPIC_API_KEY`, for reading slips.
5. **Settings in the Supabase dashboard:**
   - Auth Site URL `https://remus-xi.vercel.app`;
   - redirect URL `…/set-password`;
   - **turn public sign-ups off**.
6. **Duplicate quote:** remove the button, or replace it with templates or revisions?
7. **Project P-0005** sits at R 0 because it was converted before its lines were saved. Update it to
   its quote's value (R 4,296.52 excl. VAT)?
8. **Network access** for the cloud environment, so the real app can be tested in a browser: allow
   `gakebvnwzxhxccgtvfuw.supabase.co` and `remus-xi.vercel.app`.

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
