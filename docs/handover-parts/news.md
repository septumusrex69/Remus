# News: email newsletters to clients (Remus · Handover 8 helper, 7 Nov 2026)

For the Handover 8 session to fold into `HANDOVER.md`.

## What Stephan asked for

Stephan, 7 Nov, agreeing to "News & campaigns: email newsletters to clients (with sign-up and unsubscribe), e.g.
'We've finished a job in Brooklyn'": **"we can start with pretty much all of that."**

## What was built (copied from Raptor's News, S10 21-22 Oct, branch `claude/sales-raptor-review-p1pzx2`)

- **News** in the sidebar, right under Clients (where Raptor puts it). Administrators only (`sendsNews` in
  `src/lib/access.ts`; the database holds the same rule, `news_may_send()`).
- **The News page** (`/news`): the newsletters, newest first, with Sent / Delivered / Opened counts (the history);
  "New newsletter" and "New invitation"; the people who signed up (with the public sign-up link to put on the website
  or in an email signature, and "Add somebody who said yes"); "Import a list (CSV)"; "Never sent news" (unsubscribed,
  asked us to stop, didn't arrive, marked as spam, with "Fix the address" to the client; and "Somebody asked us to stop").
- **A newsletter** (`/news?c=<id>`), Raptor's editor: the message on the left (subject, preheader, photos, words with
  `{{first_name}}` / `{{company}}`), how it reads on the right (drawn by the server with the same function that sends,
  with the company logo from Settings), who it goes to below: *All clients with an email*, *Clients we have done a job
  for*, *People who signed up*, *Clients and people who signed up*, or *An imported list*. "Count who gets it" shows the
  number, a sample, who was left out and why, and each person's POPIA basis; then "Send to N people" (with a confirm).
  "Send a test to me" sends it to the Administrator, marked [Test]. While sending, the open page sends a chunk of 100 at a
  time; "Stop what has not gone yet". Once sent it is locked and shows **what happened to it**: sent, delivered, didn't
  arrive, opened, clicked, unsubscribed, marked as spam (and "said yes" on an invitation), and each person.
- **Photos**: "From the site diary" offers only diary photos ticked "show the client"; "Upload a photo" (shrunk first).
  Either way the photo is copied into a new public store `news-pictures`, because a mail program cannot open Remus's
  private photos. Captions under each.
- **Sending**: through Resend's batch API (100 per call) from the company sender, `MARKETING_FROM` if set, else
  `EMAIL_FROM` (as quotes). Reply-To: the company email in Settings (or `MARKETING_REPLY_TO`).
- **Domain not verified yet**: Resend refuses the first chunk; the newsletter goes back to a draft (nothing half-sent)
  and the screen says: *"Newsletters cannot go out yet: urbanhausgroup.co.za is still waiting to be verified at Resend
  ... Once the DNS records are in and Resend shows the domain as Verified, sending works. Nothing was sent."* The test
  send and the sign-up confirmation say the same kind of thing.
- **No-login pages** (signed tokens, nothing stored): `/unsubscribe/<token>` (opening it unsubscribes; "That was a
  mistake" puts it right), `/opt-in/<token>` ("Yes, keep me informed": opening asks, only the Confirm press records the
  yes; "That wasn't me" undoes it), `/subscribe` (the public sign-up form). Every email carries the unsubscribe link and
  the one-click `List-Unsubscribe` header (Gmail and Yahoo require it).
- **Bounces / undelivered**: Resend's webhook (`/api/portal/news-resend-webhook`) stamps each send (delivered, opened,
  clicked ...); a hard bounce marks the address undeliverable, a spam report unsubscribes it. Never mailed again.

## POPIA

- Clients (companies and their contacts, and private clients) are sent news by default: s69(3) "soft opt-in", our own
  similar services, with an unsubscribe link in every email. Every send records its basis: *"Existing client (POPIA
  soft opt-in ...)"*.
- Anybody else needs a yes on record: `marketing_subscribers.consent_at / consent_how / consent_note / consent_by`.
  How: the sign-up page (confirmed from the email: double opt-in), the invitation's "Yes, keep me informed", an import
  where the Administrator states where they said yes, or an Administrator recording it ("Asked on site at ...").
  The send records it too: *"Consent: signed up on our news page on 3 November 2026 (...)"*.
- People imported without a yes can be sent ONE invitation, and nothing else unless they press the button.
- A "stop" is per address and final until the person themselves signs up again (`marketing_preferences`, every change
  kept in `marketing_preference_history`). It is read when the list is drawn and again as each chunk is sent.

## Files

- `supabase/migrations/0050_news.sql`, `0051_news_pictures.sql` (NOT applied; additive only)
- `api/_lib/newsRules.ts` (the rules, pure) + `newsRules.test.ts` (23 tests); `api/_lib/news.ts` (the actions);
  `api/_lib/portal.ts` (two lines: every `news-*` action goes to news.ts; no new Vercel function)
- `src/lib/newsApi.ts`; `src/pages/news/NewsPage.tsx`, `SubscribersCard.tsx`, `ImportListCard.tsx`,
  `UndeliveredCard.tsx`, `PublicNewsPages.tsx`
- Small additions: `src/App.tsx` (3 public routes), `src/pages/build/routes.tsx`, `paths.ts`, `Sidebar.tsx`,
  `AppLayout.tsx` (title), `src/lib/access.ts` (`sendsNews`)
- Tests: `scripts/qa/e2e/news.mjs` (48 checks), fixtures appended to `scripts/qa/e2e/fixtures.mjs`

## Migrations (summary)

- **0050_news**: `news_may_send()`; tables `marketing_lists`, `marketing_subscribers`, `marketing_campaigns`,
  `marketing_sends`, `marketing_preferences` (+ `marketing_preference_history` and its stamping trigger),
  `marketing_send_events`; policies (Administrators; anybody signed in may READ who said stop); server functions
  `marketing_claim_sends`, `marketing_record_results`, `marketing_record_event` (service role only),
  `marketing_campaign_results` (the counts). Names are Raptor's.
- **0051_news_pictures**: the public storage bucket `news-pictures` (5 MB, jpeg/png/webp) and its write policies
  (Administrators).

## What Stephan / the next session must do

1. Apply 0050 then 0051 (the connector stops on the word DROP: neither file contains it).
2. Vercel already has `RESEND_API_KEY` and `EMAIL_FROM`. Optional: `MARKETING_FROM` (e.g.
   `Urban Haus <news@urbanhausgroup.co.za>`), `MARKETING_REPLY_TO`, `PUBLIC_SITE_URL` (the live address, so links in
   emails sent from a preview still open the live site; without it the links use the address the page was opened on).
   `SUPABASE_SERVICE_ROLE_KEY` and `EMAIL_CREDENTIALS_KEY` are needed (already used by the portal). Note the
   service key is Production-only today, so News sends only on the live site.
3. Finish verifying urbanhausgroup.co.za in Resend (Stephan's DNS records); switch on open and click tracking.
4. For delivery results: a Resend webhook to `https://<live site>/api/portal/news-resend-webhook` for email.sent,
   delivered, delivery_delayed, bounced, complained, opened, clicked; its signing secret in Vercel as
   `RESEND_WEBHOOK_SECRET`.

## Different from Raptor, and why

- **Subscribers instead of leads**: Remus has no leads; people who are not clients live in `marketing_subscribers`.
- **No prospect campaigns, no warm-up, one sending domain**: Remus sends news to its own clients and to people who asked;
  Raptor's cold-list machinery (prospect domain, daily allowance) is debt-collection firm specific. Raptor refuses bulk
  mail from its main domain; Remus sends from `EMAIL_FROM` on urbanhausgroup.co.za as asked (a few hundred clients).
  If the list grows into thousands, a separate news subdomain would protect everyday mail.
- **A public sign-up page** (Raptor has none): double opt-in, a hidden robot trap, one confirmation per address per
  ten minutes, and the same answer whatever the address.
- **An import can carry consent** ("these people already said yes", with where): Raptor's imports can only ever be
  sent one introduction. Without it, Remus behaves as Raptor (one invitation).
- **Photos kept by Remus** (diary or upload, copied to a public store); Raptor takes one picture link typed by hand.
- **The preview is drawn by the server** (Remus's api and pages cannot share code), a moment after typing stops.
- **One newsletter is `/news?c=<id>`**, not `/news/:id`, so the robot's tour needs no new fixture kind.
- **The send runs while the page is open** (Raptor also has a five-minute sweep); a newsletter left half-sent carries
  on when it is opened again. Fine for Remus's list size.
- **No timeline line per client** ("Newsletter: ..."): Remus's client page shows emails as threaded mail; the record of
  what went to whom is the newsletter's own page.
- Endpoints are actions on `/api/portal/` (Vercel's function count), not Raptor's `/api/email/marketing`.

## Unfinished

- A "News" line on each client page (Raptor's NewsPreferenceCard: unsubscribed or not, history). The stop list and
  "Somebody asked us to stop" are on the News page instead.
- No automatic sweep for a half-sent newsletter whose page was closed (reopen it to carry on).
- Not tried against the real database or Resend (no access from this session): the migrations are written, not applied.
