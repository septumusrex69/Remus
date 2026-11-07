# Statement of account and Reports (Remus · Handover 8 helper)

Stephan, 7 Nov 2026: "Definitely a statement of account", and of the reports: "we can start with pretty much all of
that." Built on a helper branch from `claude/new-session-z0vgkh`; preview only, nothing live. **No migration** (the
0045 slot was not needed): everything reads tables that already exist (invoices, payments, projects, expenses,
crew_days, stage_bookings, workers, quotes, slip_returns, company_settings).

## 1. Statement of account

- **Where:** a client's page (company or private client) -> **Invoices** tab -> "Statement of account" card; the band
  has a **Statement** button that jumps there. Also **Finance -> Outstanding invoices** (a Statement button per
  row) and **Reports -> Outstanding** (per client). Money only: Administrators and Read-only see it; only an
  Administrator gets Email and WhatsApp (Read-only can preview and download).
- **Buttons:** period (Last 3 months default, this month, last month, tax year, last 12 months, Everything), then
  **Preview** (new tab), **Download PDF**, **Email** (to the client's address, editable, from the person's own
  mailbox if connected else the company sender -- the quote's send path; filed on the client's Emails tab), and
  **WhatsApp** (phone/iPad: share sheet with the PDF; computer: PDF to Downloads and WhatsApp opens on the client's
  cellphone with the message typed in -- the quote's WhatsApp pattern).
- **What is on it** (copied from Raptor S17's statement of account, `accountSummaryLetter.ts statementOfAccount`):
  the company logo from Settings top left with the company's details; "STATEMENT OF ACCOUNT" and the reference
  block on the right over a rule (Date, Account, Period); "Account holder" beside "How the balance is made up"
  (brought forward, invoiced, payments, BALANCE NOW OWING); "Every movement on the account" (DATE / DETAIL / DEBIT /
  CREDIT / BALANCE, a dash where a line has no figure, balance brought forward first); the ageing row (Current,
  1-30, 31-60, 61-90, 90+, Amount due -- Finance's buckets, as at the statement date); the AMOUNT DUE dark band;
  "How to pay" (Settings' banking details, the client's name as reference, proof of payment to the company email,
  call us); the running foot with page numbers.
- **The money rule:** debits are invoices that went out (not draft, not cancelled), incl. VAT, on the issue date;
  credits are payments against the client's invoices, or on the client's jobs with no invoice named. A payment with
  no invoice is taken off the OLDEST invoice first in the ageing, so the ageing adds up to the balance. A client who
  paid too much is shown "IN CREDIT".

## 2. Reports (`/reports`, sidebar "Reports" under Finance, money only)

Period picker (Finance's, lib/period.ts, SA tax year default), a tab per report (`?tab=`), each with **Print** and
**CSV**:

| Tab | What |
| --- | --- |
| Profit per job | invoiced in the period (excl. VAT) less the job's slips less its crew days = profit and margin; tiles add "after overheads" |
| Spending | by category, and overheads by kind (lib/overheads.ts); job costs vs overheads and overheads as % of job costs |
| Outstanding | per client, Current/30/60/90/90+ and total, as at today; a Statement button per client |
| Quotes won & lost | quotes dated in the period by status and value; win rate = won / (won + lost + expired) |
| Crew & wages | days and wages per job per month, and per person (crewDays.ts: the register, else bookings marked "not confirmed") |
| Slips by supplier | one row per store however it was spelt, excl./VAT/incl., credits from returns |
| Returns | returns marked Returned in the period: should give vs credited, short; how many still to take back |

## Files

- `api/_lib/statement.ts` (the arithmetic, pure), `api/_lib/statementPdf.ts` (loading as the caller + drawing),
  `api/_lib/statementSend.ts` (the GET PDF and POST email handlers).
- `api/quotes/pdf.ts`, `api/quotes/send.ts`: a two-line branch each (`?statement=...` / body `statement`), so no new
  Vercel function.
- `src/lib/statement.ts` (browser side), `src/components/statement/StatementActions.tsx` (buttons, email dialog,
  StatementModal), `src/lib/reports.ts`, `src/pages/build/reports/ReportsPage.tsx`.
- Shared files, small appended blocks: `ClientDetail.tsx`, `FinancePage.tsx`, `routes.tsx`, `paths.ts`,
  `Sidebar.tsx`, `AppLayout.tsx` (title).
- Tests: `src/lib/statement.test.ts` (incl. Finance's ageing words/limits agree; a 60-invoice PDF opens and runs to
  two pages), `src/lib/reports.test.ts`; browser: `scripts/qa/e2e/statement-reports.mjs` (+ fixtures INVOICE,
  PAYMENT, WORKER, CREW_DAY appended to `fixtures.mjs`).

## Different from Raptor, and why

- Raptor's statement is drawn by its letter engine (LetterDocument / letterPdf, its own fonts, firm lockup).
  Remus has no letter builder, so the statement is drawn with pdf-lib like Remus's quote PDF: same head, logo and
  colours as the quote the client already holds.
- No interest, fees, VAT split, Annexure B, trust account or "% paid" bar (debt-collection things). The ageing row
  takes the bar's place, because that is what a builder chases.
- Bank details are Settings' one free-text block, not Raptor's four fields; the payment reference is the client's
  name (Remus has no account/case number).
- Raptor's statement sits behind a Documents menu; Remus has none, so the buttons are on a card on the Invoices tab.
- Raptor's Reports are a sales firm's (leads, pipeline, deals) with no print/CSV; Remus's are a builder's, and every
  one prints and exports (Stephan's ask). Period picker is Finance's, not Raptor's sales month.

## Unfinished / for Stephan

- Not tried against live mail: the email path is the quote's, but a real send should be tried once on the preview.
- The reference on the statement is the client's name; if Stephan wants a client account number, that needs a
  column (a migration in the 0045 slot).
- The PDF accent is the Urban Haus orange like the quote PDF (a PDF cannot follow the app's skin).
