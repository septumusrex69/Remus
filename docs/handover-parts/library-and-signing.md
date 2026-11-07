# Remus · Handover 8: the Library and online signing (helper session, 7 Nov 2026)

**Stephan, 7 Nov:** on Raptor's Library, "we can start with pretty much all of that." On online signing: "Online
signing, I'm not sure if that's necessary. But yeah, you can build it, and if other people are going to use it, you
can try that."

**State: built on a helper branch, preview only. Database part NOT applied:** migrations 0046 and 0047 are written,
not run. Nothing works on the live site until both are applied (the pages say "The Library is not set up in the
database yet" and the project's Documents tab shows no signing links until then).

## What was built

### 1. The Library (`/library`, sidebar "Library", copied from Raptor's `src/pages/library/*`)
- **Templates tab**: Raptor's two-column layout: the list grouped by kind on the left (Contracts, Site instructions,
  Variation orders, Completion certificates, Letters, Payment reminders), the open template on the right on the
  letterhead, Raptor's "Merge fields / Example data" switch, the "Fields used" chips (red where Remus cannot fill
  one), a pen icon on templates that can be signed online. An Administrator gets **New template** and **Edit**
  (name, kind, email subject, the words, Raptor's "put in a field" chips that insert at the cursor, "Has a place
  to sign", "In use"), and Delete.
- **Letterhead tab**: the company's details from Settings (logo, name, address, phone, email, registration and VAT
  numbers, banking details), what is missing, a link to Settings → Company, and a sample letter on the letterhead.
- **Six seeded templates** (0046): Building contract (plain-language, JBCC Minor Works style, with a note at the top
  that **the company's lawyer must check it before first use**), Site instruction, Variation order, Practical
  completion certificate, Letter to client, Payment reminder.
- **Merge fields** (`src/lib/documentTemplates.ts`): today, your name; company name/address/phone/email/reg no/VAT
  no/banking; client name/address/email/phone; project name/code/site/start/end; quote number/title/date, contract
  sum incl./excl., VAT, deposit % and amount; variation description/amount excl./incl./date; invoice number/date/due
  date/amount/amount outstanding. A field Remus does not know is left as `__________` (highlighted) and listed, so
  it is typed in before the document goes out.
- **Markup** in the words: `# ` heading, `## ` smaller heading, `- ` bullet, `**bold**`, blank line = gap.

### 2. A project's Documents tab (`?tab=documents`, appended to the project page)
- **New document**: pick a template; where the wording asks, pick the quote / variation / invoice; a filled-in
  preview on the letterhead; "Make it". The words are a copy, so changing the template never changes it.
- **Open a document**: "On the letterhead" / "Edit the words", **PDF** (on the letterhead, built on the server),
  **Email** (PDF attached, from the person's own mailbox with their signature, else the company sender: the same
  path as quotes; logged on the client's Emails card), **WhatsApp** (the share sheet with the PDF on a phone/iPad;
  a download on a computer, as quotes do), **Send for signing**, Save, Delete. A signed document is locked.
- **Sign online** card: the project's quote(s) (draft or sent) and its unapproved variations, each with
  "Send for signing" and its status.
- **Signing links** card: every link from this job: who, sent, opened (when), signed (when, by whom, from which
  address), open until; **Signed PDF**; **Withdraw**.
- Site managers see only site instructions and completion certificates (no rand amounts), and no Sign online card.

### 3. Online signing (copied from Raptor's `SignPage.tsx`, `signing_requests`, signing emails)
- **Send for signing** (a modal): who signs, their email, how long the link works (3/7/14/30/60 days, 14 by
  default), "Email the link" (a button email from your own mailbox, Raptor's "make it like a button"), optional
  message. The link is then shown **once**: Copy, or WhatsApp to the client's cellphone with the link typed in.
- **The client** opens `/sign/<token>` with no login (phone and computer): the document on the letterhead in its
  own scrolling box, "PDF" (for a quote: the full quotation PDF), their full name, a signature drawn with finger or
  mouse (Raptor's pad), the tick "I have read this document, I agree to it...", **Sign this document**. "It can
  only be signed once." Afterwards it says it is signed and shows the signature on the document.
- **Remus keeps**: the typed name, the signature picture, the time, the internet address, the browser, and a
  SHA-256 fingerprint of the exact words. The **signed PDF** has a "Signed electronically" block: the drawing, the
  name, date and time (SAST), the address, the reference and the fingerprint.
- **After signing**: every active Administrator and the person who sent it get a **bell notification**
  ("Thandi Client (Test Client) signed Building contract ... online.") linking to the project's Documents tab; the
  document becomes "Signed"; the signer is emailed their signed copy from the sender's mailbox (best effort).
- **A signed quote is accepted** like the portal's accept: status 'accepted', `accepted_at`, `accepted_by_name`,
  and the new `accepted_signing_id` (accepted_via is left alone, see 0047). A signed variation (or a variation-order
  document tied to one) marks the variation **approved**.

## Files
- Migrations: `supabase/migrations/0046_library.sql`, `supabase/migrations/0047_online_signing.sql`.
- Server (no new Vercel function; served through `api/portal/[action].ts`): `api/_lib/signing.ts` (the 8 actions,
  added to the portal's routes in `api/_lib/portal.ts`), `api/_lib/signingRules.ts` (+ `signingRules.test.ts`),
  `api/_lib/documentPdf.ts` (PDF on the letterhead, signed block, signed page appended to a quote PDF),
  `api/_lib/officeMail.ts` (own mailbox, else Resend/SMTP: the quote's send path).
- Browser: `src/lib/documentTemplates.ts` (+test), `src/lib/signingStatus.ts` (+test), `src/lib/documentsApi.ts`,
  `src/components/documents/{DocumentSheet,DocumentsTab,SendForSigningModal}.tsx`, `src/components/ui/SignaturePad.tsx`,
  `src/pages/build/library/LibraryPage.tsx`, `src/pages/sign/SignPage.tsx`.
- Appended: `src/App.tsx` (`/sign/:token`), `routes.tsx` (`library`), `paths.ts` (`library`), `Sidebar.tsx` (Library),
  `AppLayout.tsx` (title), `ProjectDetail.tsx` (Documents tab).
- QA: `scripts/qa/e2e/fixtures.mjs` (DOC_TEMPLATE, PROJECT_DOCUMENT, SIGNING_REQUEST appended),
  `scripts/qa/e2e/library-signing.mjs` (40 checks: Library at 1280 and 390, Documents tab, signing on a phone).

## Server actions (POST /api/portal/<action>)
| Action | Who | What |
|---|---|---|
| `doc-pdf` | staff (not Read Only) | A document's PDF on the letterhead |
| `doc-send` | staff | Email it (PDF attached) |
| `sign-create` | staff | Freeze + fingerprint the words, make the link, optionally email it |
| `sign-cancel` | staff | Withdraw an unsigned link |
| `sign-signed-pdf` | staff | The signed PDF |
| `sign-open` | anybody with the token | The words, letterhead, state; records the first opening |
| `sign-submit` | anybody with the token | Sign (name + drawing + tick) |
| `sign-pdf` | anybody with the token | The PDF to read, or the signed copy |

Staff read the document/quote/variation **with their own session** (the database's rules apply); only the
signing rows are written with the service role.

## Security (Raptor's choices, and where Remus differs)
- Kept from Raptor: 32-byte random token, base64url; the link is the authority; the words frozen at send time;
  signed once (the update only lands while `state = 'sent'` and before `expires_at`); name AND drawing required;
  the anonymous visitor never touches the table (Raptor: security-definer functions; Remus: the server by token).
- **Different, and why:** only a **keyed hash** of the token is stored (as the portal's sessions are), so reading
  the table does not open a link; the office sees the link once and "sends again" for a new one. Every link
  **expires** (Raptor's may not). The **IP address is recorded** (Raptor's database function cannot see it). For a
  **quote**, the server re-makes the quote's words at signing and refuses if they changed since the link went out
  (also if the client's name was renamed in between: then send a new link).

## Differences from Raptor, and why
- One library, not two sides (collections/sales); no Workflows tab (Raptor's debt-collection timetables); no "The
  firm" tab (the company's details are already in Settings → Company).
- The letterhead is drawn from Settings (as the quote PDF draws it), not an uploaded A4 picture with margins.
- Templates are words with a small markup, not Raptor's block-by-block letter editor (`LetterPageEditor`, 1 400 lines
  of `letterDocument.ts`): a builder's documents are mostly words, and the PDF is drawn on the server.
- No blanks for the signer to fill in and no page initials (Raptor's AoD needs them; a builder's documents are filled
  in by the office before they go).
- No SMS of the link (Remus has no SMS); WhatsApp instead.
- Gaps: Raptor refuses to send a message with an unfilled field; here the gap is highlighted and listed, because a
  document is edited after it is made.

## Migrations (summary)
- **0046_library.sql**: tables `document_templates` (kind, name, subject, body, signable, active, seed_key unique)
  and `project_documents` (project/company/contact/quote/variation/invoice/template, kind, title, subject, body,
  signable, status draft/sent/signed/cancelled, sent_at/sent_to); RLS: templates read by active members, written
  only by an Administrator; documents written by `can_write()`, read restricted for site managers to
  site instructions / completion certificates / their own; six seeded templates (`on conflict (seed_key) do nothing`).
- **0047_online_signing.sql**: table `signing_requests` (token_hash, source, links, frozen title/body/body_hash,
  signer, state sent/signed/cancelled, expires_at (default 14 days), opened_at/open_count, signed_at/name/
  signature_png/ip/agent/hash, emailed_at, copy_sent_at, cancelled_at, created_by); RLS: select only (active
  members; site managers only their own); anon revoked; `quotes.accepted_signing_id` (+ FK, index).
- Both additive, guarded with `if not exists` / `do $$` catalogue checks; no destructive statements.

## Environment
Nothing new. Uses what the portal already needs: `SUPABASE_SERVICE_ROLE_KEY` (Production only today, so signing
works only on the live site, like the portal), `EMAIL_CREDENTIALS_KEY` (also the key the token is hashed with), and
for emailing either the person's connected mailbox or `RESEND_API_KEY`/`EMAIL_FROM` (or SMTP_*). `APP_URL` is used
only for the default logo when Settings has none.

## Unfinished / next
- Apply 0046 and 0047 (then try a full round on the live site: a document, a quote and a variation, signed on a phone).
- **The contract wording must be checked by Urban Haus's lawyer** before it is used (the note in it says so).
- Send-for-signing is on the project's Documents tab only: a quote with no project cannot be sent for signing yet
  (a button on the quote page would be next). No Documents tab on the client page yet.
- The signed-copy email goes from the sender's mailbox; if they have none and no company sender is set, it is not
  sent (logged).
- Documents and signing links are not in global search.
