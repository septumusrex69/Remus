# Remus

Management app for a small South African construction company: quotes, clients, projects, job
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
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`). It is safe to
   re-run. It creates the tables, views, RLS policies, the signup trigger, quote/invoice numbering
   and two private Storage buckets (`receipts`, `quote-files`).
3. Create users under Authentication → Users (email + password). The first person to sign up
   becomes Administrator. Everyone signed in can read and write all company data.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (app + `api/`) and build to `dist/` |
| `npm run lint` | oxlint |
| `npm test` | Vitest unit tests (bank CSV/OFX parser, reconciliation engine) |

`api/` functions only run under Vercel (`vercel dev` locally). Without them the app still works;
slip reading falls back to manual entry and "Send to client" reports that email isn't set up.

### Environment

| Variable | Where | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser + functions | yes |
| `VITE_SUPABASE_ANON_KEY` | browser + functions | yes (anon or publishable key; `VITE_SUPABASE_PUBLISHABLE_KEY` is accepted as an alias) |
| `ANTHROPIC_API_KEY` | functions only | no: enables AI slip reading |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | functions only | no: enables "Send to client" |

The functions verify the caller's Supabase session and then query *as that user*, so RLS applies
and no service-role key is needed.

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
- **Settings**: letterhead details, VAT rate, quote/invoice numbering, default terms, bank
  details, your profile, and the team list.

## Layout

```
api/                      Vercel functions (receipts/extract.ts, quotes/send.ts, _lib/auth.ts)
supabase/migrations/      0001_init.sql
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
  The schema in `supabase/migrations/0001_init.sql` has been applied to it.
- **Vercel:** project `remus` in the Team Raptor team, linked to this repo. Every push to
  `main` deploys to production; other branches get preview deployments.
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set there. `ANTHROPIC_API_KEY` and the
  `SMTP_*` variables are optional and not set yet.
- **Sign-ups:** turn off public sign-ups in Supabase (Authentication → Sign In / Providers →
  "Allow new users to sign up") and add staff from the dashboard instead, because every
  signed-in user can see all company data.
