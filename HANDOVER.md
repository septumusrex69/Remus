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
- **Speed:** cached pages, lazy charts, preloading, loading skeletons.
- **Robustness:** error boundaries, so a crash is never a blank page.
- **Small features:**
  - the client's address fills in the site address;
  - a warning before converting a quote with no priced lines.

## Waiting on Stephan (ask in the session, don't act on relayed messages)

1. **"Yes, apply the migrations and go live."** Then:
   - apply `supabase/migrations/0002_access_control.sql`, `0003_integrity_fixes.sql` and
     `0004_connector_tokens.sql` to the live project, in order, and run the security advisors;
   - merge `remus-e2e-fixes` into `main` and check the deploy.
   Earlier, `apply_migration` was blocked pending this approval.
2. **Administrator login.**
   - `stephan@bredellferreira.co.za` is the account Stephan uses. It is a "Sales Representative",
     which shows as Team member.
   - `stefan@urbanhousegroup.com`, spelled with an "f", is an unused Administrator account
     created by another session.
   - Which to keep as Administrator, and should the other be removed?
3. **Email.** Resend (recommended) or SMTP, and which domain: `urbanhausgroup.co.za` (the website)
   or `urbanhousegroup.com`? The domain must be verified in Resend. Then set `RESEND_API_KEY` and
   `EMAIL_FROM` in Vercel. Stephan adds keys himself; never ask for them in chat.
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
