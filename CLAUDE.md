# Remus — read this first

Remus is the management app for **Urban Haus Construction** (Urban Haus Group): quotes, clients,
projects, job costing, slips, bank, diary, finance, client email. Then read `HANDOVER.md` for where
the work stands today, and update it before you finish.

## Say which project and which handover, on everything

Stephan runs two projects (Raptor and Remus) and asked, 26 Oct 2026: *"for every little thing, just make
sure that ... Remus or Raptor is mentioned clearly, and then the handoff number. Remus handoff 5 or ...
Raptor handoff 6."* So every reply, commit subject (`Remus H1: ...`), branch note and handover section
carries **"Remus · Handover N"**, where N is the handover the session started from. Numbering began at
Handoff 1 on 26 Oct 2026; the number at the top of `HANDOVER.md` is the one you start from, and you
write the next one.

**"Handover", not "handoff"** (Stephan, 28 Oct, on Raptor; Remus follows from Handover 5 on). Older
sections say "Handoff" and stay as written. Commit subjects keep the short `Remus H6: ...`.

## Spelling: it is Urban **Haus** (H-A-U-S), never "House"

The owner has had to correct this more than once. Domain: `urbanhausgroup.co.za`. The owner is
**Stephan** (with "ph"); his login is `stephan@urbanhausgroup.co.za` (Administrator).

## Raptor is the template. Build it the way Raptor builds it.

The owner's standing instruction: *"when we build things, build it exactly like Raptor."* Raptor
(`septumusrex69/Sales-Raptor`) is the firm's other app and the reference for layout, look and
behaviour. Add it read-only and read its code before building anything Raptor already has.

**Use Raptor's CURRENT branch, not its default branch.** Raptor's default branch (`Main`) stopped
on 12 Sep 2026 and is missing most of what the owner uses (collapsible sidebar, the Mail page). On
22 Oct 2026 the live work was on `claude/s10-clients-and-credits`. Before copying anything, list
Raptor's branches by date and use the newest working branch:

```bash
git clone --depth 1 https://github.com/septumusrex69/sales-raptor /home/user/septumusrex69/sales-raptor
cd /home/user/septumusrex69/sales-raptor
git fetch --depth=1 origin '+refs/heads/*:refs/remotes/origin/*'
git for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short)' refs/remotes/origin | head
```

How to apply it:
- **Copy Raptor's code, then adapt.** Start from Raptor's component or page and strip what is
  debt-collection specific (accounts, charges, Annexure B tariff, debtors, leads/deals). Do not
  write a simpler version of your own.
- **Keep Remus's brand (since 24 Oct 2026):** the app is **Remus**, run by Urban Haus. The frame
  carries the REMUS wordmark; quotes, PDFs and client emails keep the company's own logo from
  Settings. Colours come from **skins** (Settings → Appearance, Raptor's skin system):
  `src/lib/themes.ts` + `src/styles/skins.css`. Never hard-code a colour in a component: use the
  tokens (`brand-*` where Raptor uses gold, `ink-950` where Raptor uses navy, `slate-*`,
  `emerald-*` for progress) so every skin follows. Default skin "Remus" is the brand board:
  graphite #454B50, oxblood #512C35, sage #78846E, stone #EEEAE4, paper #FAF9F6, Inter.
  "Urban Haus Classic" (orange #EF6723 on charcoal) is the old look, kept as a skin.
- **If you do something differently from Raptor, tell the owner why before you build it.**

## Every Raptor-style app has these. Check they're present; add them if not.

- [x] **Collapsible sidebar** (folds to an icon rail, remembered per device: Raptor's
      `src/lib/sidebarCollapsed.ts` and `components/layout/Sidebar.tsx`).
- [x] **Top bar**: page title, global search, the light bulb, the notifications bell (since Remus · Handoff 1), unread-mail envelope, "+ New" quick add
      (Raptor's `components/layout/Topbar.tsx`, `GlobalSearch`, `MessagesMenu`, `QuickAdd`).
- [x] **Mail page with an Inbox** (Raptor's `src/pages/mail/MailPage.tsx`, `lib/userMail.ts`,
      `components/email/*`): each person's mailbox inside the app, mail filed onto clients.
- [x] **Emails on every client page**, threaded, with reply and attachments.
- [x] Each person connects their own mailbox in Settings; sends go out from it with their signature.
- [x] **Settings in Raptor's layout**: tab menu on the left that folds, one tab at a time, Save per tab, `?tab=` links.
- [x] **Change requests** (the light bulb, `/requests`, the bell, the nightly review): Raptor's
      Feedback Centre, copied in Remus · Handoff 1. `.claude/skills/change-requests/SKILL.md`.
- [ ] Record pages with Raptor's hero band, cards (`CardHeader` title + subtitle) and tabs.
- [ ] Phone and iPad layouts that work (site managers use phones).

## Working rules

- **Update `HANDOVER.md` before you finish, every session**, and keep its "Start of every session:
  check Raptor first" section and the "Raptor last checked" date current. Stephan works on Raptor
  daily, so each session starts by checking what Raptor gained.
- Show the owner changes on a Vercel **preview link** before they go live; live deploys from `main`.
- The owner is not a developer: explain outcomes in plain language, no code talk.
- Never send a DROP statement through the Supabase MCP (it waits for a confirmation that never comes).
- Supabase project "Remus" `gakebvnwzxhxccgtvfuw`; Vercel project `remus` in team Team Raptor.
