/**
 * What Remus · Handover 8 built, each checked on the screen in a real browser.
 *
 * The tour (tour.mjs) proves every page draws without breaking. This proves five of Handover 8's pages draw the
 * THING they were built for -- the half a "no errors" check cannot see:
 *
 *   1. Returns lists a return that is waiting to go back to the store.
 *   2. Snap slip asks "What is it for?" with A job / Overheads.
 *   3. Photo of the day lays out the whole month, a card a day.
 *   4. Mail has an Archive tab, and it opens.
 *   5. A request's panel: an Administrator who is not the Big Boss sees no Approve (and is told why); the Big Boss
 *      does. Checked both ways, so the test fails if the button is missing for everybody, not only if it shows.
 *
 * Run: node scripts/qa/e2e/handover-8.mjs   (or as part of `npm run qa`)
 */
import { TINY_PNG, chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, BOSS, CHANGE_REQUEST, SLIP_RETURN, backend } from './fixtures.mjs'

const t = makeRunner('handover-8')
const { origin, stop } = await startServer()
const browser = await chromium.launch()

async function open(profile, route, extra = {}) {
  const { context, page } = await signedInPage(browser, profile, backend(profile, extra))
  const watch = watchProblems(page)
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  return { context, page, watch }
}
const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }

try {
  /* 1. Returns */
  {
    const { context, page, watch } = await open(ADMIN, '/returns', { db: { slip_returns: [SLIP_RETURN] } })
    await page.getByTestId('return-row').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('returns: one return listed', await page.getByTestId('return-row').count(), 1)
    t.ok('returns: it names the store', /Builders Warehouse/.test(await page.getByTestId('return-list').innerText().catch(() => '')))
    t.ok('returns: it can be marked Returned', await page.getByTestId('return-done').isVisible().catch(() => false))
    quiet('returns', watch)
    await context.close()
  }

  /* 2. Snap slip: a job or overheads */
  {
    const { context, page, watch } = await open(ADMIN, '/expenses/capture', { api: { '/api/receipts/extract': { configured: false, message: 'Not in the test.' } } })
    // A photo of a slip, as "Choose files" gives it. The reader is off in the test, so the form is filled by hand.
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: TINY_PNG })
    const box = page.getByTestId('job-or-overhead').first()
    await box.waitFor({ timeout: 10_000 }).catch(() => {})
    const words = await box.innerText().catch(() => '')
    t.ok('snap slip: offers "A job"', /A job/.test(words))
    t.ok('snap slip: offers "Overheads"', /Overheads/.test(words))
    await page.getByRole('button', { name: 'Overheads', exact: true }).first().click({ timeout: 5_000 }).catch(() => {})
    t.ok('snap slip: Overheads asks what kind', await page.getByText(/what kind/i).first().isVisible().catch(() => false))
    quiet('snap slip', watch)
    await context.close()
  }

  /* 3. Photo of the day, a month at a time */
  {
    const { context, page, watch } = await open(ADMIN, '/photo-days')
    await page.getByTestId('days-month').waitFor({ timeout: 10_000 }).catch(() => {})
    const month = (await page.getByTestId('days-month').innerText().catch(() => '')).trim()
    t.ok(`photo days: names the month ("${month}")`, /^[A-Z][a-z]+ 20\d\d$/.test(month))
    const cards = await page.getByTestId('day-card').count()
    t.ok(`photo days: a card for every day of the month (${cards})`, cards >= 28 && cards <= 31)
    quiet('photo days', watch)
    await context.close()
  }

  /* 4. Mail: the Archive tab */
  {
    const { context, page, watch } = await open(ADMIN, '/mail', { api: { '/api/email/mailbox': { connected: true, email: ADMIN.email } } })
    const tab = page.getByTestId('mail-tab-done')
    await tab.waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('mail: the tab is called Archive', (await tab.innerText().catch(() => '')).trim(), 'Archive')
    await tab.click({ timeout: 5_000 }).catch(() => {})
    t.check('mail: Archive opens', await tab.getAttribute('aria-pressed').catch(() => null), 'true')
    quiet('mail', watch)
    await context.close()
  }

  /* 5. Requests: only the Big Boss approves */
  for (const [who, profile, sees] of [['an Administrator', ADMIN, false], ['the Big Boss', BOSS, true]]) {
    const { context, page, watch } = await open(profile, `/requests?r=${CHANGE_REQUEST.number}`, { db: { change_requests: [CHANGE_REQUEST] } })
    await page.getByTestId('request-actions').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok(`requests (${who}): the panel is open`, await page.getByTestId('request-actions').isVisible().catch(() => false))
    t.check(`requests (${who}): Approve shown`, await page.getByTestId('request-approve').count() > 0, sees)
    t.check(`requests (${who}): Decline shown`, await page.getByTestId('request-decline').count() > 0, sees)
    t.check(`requests (${who}): told only the Big Boss approves`, await page.getByTestId('request-boss-only').count() > 0, !sees)
    quiet(`requests (${who})`, watch)
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
