# Remus

Management app for Urban Haus Construction (Urban Haus Group, urbanhausgroup.co.za), a South African construction company: quotes, clients, projects, job
costing, slip capture, bank reconciliation, site diary and finance. Amounts are in rand (ZAR) with
VAT at 15% by default (configurable in Settings).

Remus is built to be merged into Raptor/Romulus later. It uses the same stack, the same Supabase
conventions, and the same table/column names wherever the two overlap (see **Merging into Raptor**).

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · react-router-dom v7 · Supabase (Postgres, Auth,
Storage) · Recharts · date-fns · lucide-react. Serverless functions in `api/` run on Vercel
(`@vercel/node`), region `cdg1`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon/publishable key
npm run dev
```

1. Create a Supabase project.
2. Run the files in `supabase/migrations/` in order in the SQL editor (or `supabase db push`).
   Each is safe to re-run.
   - `0001_init.sql`: tables, views, RLS, the signup trigger, quote/invoice numbering, and the
     private Storage buckets `receipts` and `quote-files`.
   - `0002_access_control.sql`: deactivated people lose access, "Read only" people can't change
     anything, administrators can manage the team; public `branding` bucket for the logo.
   - `0003_integrity_fixes.sql`: numbering never reuses a number, bank lines whose expense was
     deleted go back to "needs linking", deleting a statement removes its lines, draft invoices
     don't count as invoiced, profile backfill.
   - `0004_connector_tokens.sql`: personal access tokens for the Claude connector.
3. In Authentication → URL Configuration set the Site URL to the app's address and add
   `<app>/set-password` to the redirect URLs (invite and password-reset links land there).
4. Create the first user under Authentication → Users. The first person becomes Administrator
   and can invite everyone else from Settings → Team.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (app + `api/`) and build to `dist/` |
| `npm run lint` | oxlint |
| `npm test` | Vitest unit tests (bank CSV/OFX parser, reconciliation engine) |

`api/` functions only run under Vercel (`vercel dev` locally; plain `npm run dev` has no `/api`).
Without them the app still works: slip reading falls back to manual entry and "Send to client"
reports that email isn't set up.

### Environment

| Variable | Where | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser + functions | yes |
| `VITE_SUPABASE_ANON_KEY` | browser + functions | yes (anon or publishable key; `VITE_SUPABASE_PUBLISHABLE_KEY` is accepted as an alias) |
| `ANTHROPIC_API_KEY` | functions only | no: enables AI slip reading |
| `RESEND_API_KEY`, `EMAIL_FROM` | functions only | no: enables "Send to client" through Resend (simplest; `EMAIL_FROM` like `Urban Haus <quotes@urbanhausgroup.co.za>` on a domain verified in Resend) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | functions only | no: or send over SMTP instead (used only when Resend isn't set) |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | no: enables in-app invites and the Claude connector |
| `APP_URL` | functions only | no: production address for invite and connector links (default `https://remus-xi.vercel.app`) |

Most functions verify the caller's Supabase session and then query *as that user*, so RLS applies.
Only `api/team/invite.ts` (Supabase's admin invite API) and `api/mcp.ts` (which acts for the owner
of a personal access token) use the service-role key, and both check the person's role and status
themselves.

## Features

- **Dashboard**: active projects, value of quotes out, money owed, this month's income vs
  expenses, profit per active project, upcoming diary events, recent expenses, and a "needs
  linking" card for bank lines.
- **Quotes**: sections and line items with internal cost, markup and selling price, discount,
  VAT, and estimated margin. Mark a quote sent/accepted/declined, duplicate it, or convert it to a
  project (contract value = total excl. VAT, budget = estimated cost). Upload renders, photos and
  documents (drag and drop, captions, reorder). Images marked "show on quote" appear in the printable
  quote's gallery, and an uploaded PDF can be marked as the *client version*. The print view has a
  letterhead and A4 print CSS (browser Print → Save as PDF). **Send to client** emails the client
  version PDF, or the uploaded files plus a summary in the email body.
- **Clients**: companies and private individuals (Raptor `companies` + `contacts`), each with
  their quotes, projects and invoices.
- **Projects**: status, profit and budget-used bar. Detail tabs: Overview (financials, expenses by
  category), Expenses, Invoices & payments, Variations, Site diary, Schedule.
- **Expenses / Snap slip**: a large camera button on phones (and multi-file upload on desktop).
  The slip goes to private Storage. With `ANTHROPIC_API_KEY` set, Claude reads supplier, date,
  amounts, VAT, slip number and card digits, and suggests a category and project using the
  active projects and your recent supplier → project history. You confirm on a review screen
  that shows the slip beside the form.
- **Bank**: import CSV (FNB, ABSA, Standard Bank, Nedbank, Capitec, …) or OFX statements, with
  column mapping that's auto-detected and remembered per account, and duplicates skipped. The
  matching engine auto-links certain matches, suggests plausible ones, and leaves the rest for you
  to link to an expense, turn into a new expense, or ignore with a reason. It also lists slips that
  aren't on a statement yet.
- **Diary**: month/week/agenda calendar of site visits, meetings, inspections and deliveries, plus
  a site diary across all projects.
- **Finance**: period selector (including the SA tax year), income, expenses incl. overheads,
  net cash, profit per project, expenses by category, monthly income vs expenses, outstanding
  invoices with ageing, and a CSV export of expenses.
- **Settings**: letterhead details and logo upload, VAT rate, quote/invoice numbering, default
  terms, bank details, your profile, the team (invite, change access, deactivate), and the Claude
  connector.
- **Quote PDF**: `GET /api/quotes/pdf?id=…` builds an A4 PDF on the server (pdf-lib). "Send to
  client" attaches it when no client-version PDF was uploaded.
- **Access**: Administrator, Team member (Raptor's `Sales Representative`), Read only. Deactivated
  people are locked out by RLS, not just by the UI.

## Claude connector

`api/mcp.ts` is a remote MCP server, so each person can connect their own Claude to Remus. In
Settings → Claude connector, create a connection: it shows a URL with a personal access token
(only its hash is stored). Paste the URL in Claude → Settings → Connectors → Add custom connector,
or use the `claude mcp add` line shown for Claude Code.

Tools: `search_clients`, `list_projects`, `get_project`, `list_quotes`, `get_quote`,
`finance_summary`, `list_unlinked_bank_lines`, `add_expense` (with the slip image attached),
`create_quote_draft`, `add_site_diary_entry`, `add_diary_event`. Claude acts as the token's owner:
read-only people can look but not change, and a deactivated person's tokens stop working.
Revoke a connection in Settings at any time.

## Live bank feed

Not built. A live feed needs a South African aggregator account (e.g. Stitch) with its client
credentials and a signed agreement, so it can't be added from code alone. The seam is
`src/lib/bankFeed.ts` plus `bank_accounts.feed_provider` / `feed_external_id`; statement import
(CSV/OFX) covers reconciliation until then.

## Layout

```
api/                      Vercel functions: receipts/extract.ts, quotes/send.ts, quotes/pdf.ts,
                          team/invite.ts, mcp.ts; _lib/ (auth, quotePdf, mcpTools)
supabase/migrations/      0001_init.sql … 0004_connector_tokens.sql
src/lib/                  api.ts (typed data access), reconcile.ts, bankCsv.ts, quoteMath.ts, …
src/types.ts              Row types (column names = database names)
src/store/AuthContext.tsx Same shape as Raptor's
src/pages/auth/           Login
src/pages/build/          The whole construction section, liftable into Raptor
  routes.tsx              <Route> fragment with relative paths
  paths.ts                BUILD_BASE + link helpers
  BuildContext.tsx        Company settings + bank badge count
```

## Merging into Raptor

- Copy `src/pages/build/`, the `src/lib/` files it imports, and the Remus types. Set
  `BUILD_BASE = '/build'` in `paths.ts` and mount
  `<Route path="/build" element={<BuildProvider><Outlet/></BuildProvider>}>{buildRoutes}</Route>`
  inside Raptor's authenticated layout.
- The migration uses `create table if not exists` for `teams`, `profiles`, `companies` and
  `contacts`, and adds the Remus-only columns with `add column if not exists`, so it can run
  against Raptor's database. Before running it there, drop the `remus_all` policies on
  `companies` and `contacts` from the script so Raptor's narrower policies stay in force.
- `diary_events` uses Raptor's relationship column names (`owner_id`, `company_id`,
  `contact_id`), so a merged calendar can union diary events with Raptor's `tasks`.

## Hosting

- **Supabase:** project "Remus" (`gakebvnwzxhxccgtvfuw`, eu-west-3) in the Team Raptor org.
  Migrations 0001–0004 must all be applied to it (see Getting started).
- **Vercel:** project `remus` in the Team Raptor team, linked to this repo. Every push to
  `main` deploys to production; other branches get preview deployments.
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set there. `ANTHROPIC_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` and the `SMTP_*` variables are optional.
- **Sign-ups:** turn off public sign-ups in Supabase (Authentication → Sign In / Providers →
  "Allow new users to sign up") and add staff from the dashboard instead, because every
  signed-in user can see all company data.
