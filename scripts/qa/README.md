# Testing Remus

Remus · Handover 8. Copied from Raptor ("test everything with one command, tour the app with a robot, and get told
when it breaks") and adapted to Remus.

## One command

```bash
npm run qa             # everything, about 2 minutes
npm run qa -- --fast   # everything except the browser, under a minute
```

It ends with one line: **All green: N checks** or **FAILED: ...** with what broke.

What it does, in order:

| Step | What it catches |
|---|---|
| Typecheck | Code that does not fit together (the same check Vercel does before it builds) |
| Lint | Common mistakes in the code |
| Unit tests | Wrong sums, dates, VAT, who-may-see-what, mail tabs ... (the `*.test.ts` files beside the code) |
| Production build | A build that would stop Vercel from deploying |
| Browser: tour | A robot opens **every page** of Remus on a phone (390 wide) and a desk (1280 wide) and fails if a page crashes, goes blank, shows an error, has no title in the top bar, or scrolls sideways |
| Browser: handover-8 | The things Handover 8 built, checked on the screen: Returns lists a return, Snap slip asks "A job / Overheads", Photo of the day shows the month, Mail has an Archive tab, and only the Big Boss can approve a request |

## The robot uses no real data

The browser tests never touch the live database, email or Vercel. Every question the app asks the database is
answered from made-up records in `e2e/fixtures.mjs` (a test client, a kitchen job, a quote, a slip, a return, a
change request). So the tests run anywhere, cannot change anything real, and always see the same thing.

That also means they cannot tell you the database itself is right; the unit tests and the migrations do that.

## Being told when it breaks

GitHub runs the checks on every push (`.github/workflows/qa.yml`): first the fast checks, then the robot's tour.
If anything fails, GitHub emails whoever pushed and shows a red X next to the commit, before the change goes live.
When the tour fails on GitHub, the screenshots of the broken pages are attached to the run ("qa-screenshots").

## When something fails

- A failing page's screenshot is saved in `.qa-screenshots/`.
- To run only the browser part: `node scripts/qa/e2e/tour.mjs` or `node scripts/qa/e2e/handover-8.mjs`.
- `npm run qa -- --verbose` prints every step's full output.

## Adding a test

- **A new page**: nothing to do. The tour reads the list of pages from `src/pages/build/routes.tsx`. If the page has
  `:id` in its address, add the kind of record to `IDS` in `e2e/tour.mjs`.
- **A page reads a new table or column**: add it to `e2e/fixtures.mjs`, shaped like the real table.
- **A new feature**: a new `e2e/<name>.mjs` is picked up by `npm run qa` automatically. Copy `handover-8.mjs`; it
  must end by printing `N passed, 0 failed` (a file that prints no count is counted as a failure, so a test that
  quietly checked nothing cannot pass).
- **Every bug fixed**: add the check that would have caught it, so it cannot come back.

The browser part uses the Playwright already installed on the machine (`npm root -g`), as Raptor does, so nothing
is downloaded and no browser version is pinned in `package.json`.
