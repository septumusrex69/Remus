/**
 * What Remus · Handover 8 copied from Raptor S18 and 55a7520 (7 Nov; Stephan: "We can like start with pretty much all
 * of that"), each checked on the screen in a real browser:
 *
 *   1. Requests: a Parked shelf; a parked request sits on it with a Parked pill, and the Big Boss can take it out; a
 *      Submitted one offers the Big Boss Park, and an Administrator who is not the Big Boss no Park.
 *   2. A question from Claude names the administrator who sent the request through, and they can tick it.
 *   3. Spell check: on by default (<html spellcheck="true">), and the switch on Settings -> Appearance turns it off.
 *   4. The app shell cannot be scrolled as a page (Raptor's R-22: "goes up and the grey displays at the bottom").
 *   5. No flash of yesterday's photograph: with today's look remembered the band wears it before the database answers;
 *      the first visit of the day shows the band plain until it does.
 *
 * Run: node scripts/qa/e2e/raptor-s18.mjs   (or as part of `npm run qa`)
 */
import { chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, BOSS, BOSS_ID, CHANGE_REQUEST, backend } from './fixtures.mjs'

const t = makeRunner('raptor-s18')
const { origin, stop } = await startServer()
const browser = await chromium.launch()

async function open(profile, route, extra = {}, init = null) {
  const { context, page } = await signedInPage(browser, profile, backend(profile, extra))
  if (init) await context.addInitScript(init.fn, init.arg)
  const watch = watchProblems(page)
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  return { context, page, watch }
}
const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }
const PARKED = { ...CHANGE_REQUEST, id: '88888888-8888-4888-8888-888888888889', number: 2, description: 'A darker band on the dashboard.', parked_at: '2026-11-06T08:00:00Z', parked_by: BOSS_ID }

try {
  /* 1. Parked */
  {
    const { context, page, watch } = await open(BOSS, `/requests?r=${PARKED.number}`, { db: { change_requests: [CHANGE_REQUEST, PARKED] } })
    const shelf = page.getByTestId('requests-shelf')
    await shelf.waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('parked: the shelf says "Parked (1)"', /Parked \(1\)/.test(await shelf.innerText().catch(() => '')))
    t.ok('parked: "Needs a decision" leaves it out (1, not 2)', /Needs a decision \(1\)/.test(await shelf.innerText().catch(() => '')))
    t.ok('parked: the panel says since when', await page.getByTestId('request-parked').isVisible().catch(() => false))
    t.ok('parked: the pill', await page.getByTestId('request-parked-pill').first().isVisible().catch(() => false))
    t.ok('parked: the Big Boss can take it out', await page.getByTestId('request-unpark').isVisible().catch(() => false))
    quiet('parked', watch)
    await context.close()
  }
  for (const [who, profile, sees] of [['an Administrator', ADMIN, false], ['the Big Boss', BOSS, true]]) {
    const { context, page, watch } = await open(profile, `/requests?r=${CHANGE_REQUEST.number}`, { db: { change_requests: [CHANGE_REQUEST] } })
    await page.getByTestId('request-actions').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check(`park (${who}): Park shown`, await page.getByTestId('request-park').count() > 0, sees)
    if (sees) {
      await page.getByTestId('request-park').click({ timeout: 5_000 }).catch(() => {})
      t.ok('park: a note is optional, Park it can be pressed at once',
        await page.getByTestId('request-compose-send').isEnabled().catch(() => false))
    }
    quiet(`park (${who})`, watch)
    await context.close()
  }

  /* 2. Claude's question goes to whoever sent it through */
  {
    // Written by somebody else, approved and queued by the Administrator: Claude's question is the Administrator's.
    const writer = { ...ADMIN, id: '11111111-1111-4111-8111-1111111111cc', name: 'Sipho Writer', email: 'sipho@urbanhaus.test', role: 'Read Only', job: 'site_manager' }
    const queued = { ...CHANGE_REQUEST, status: 'accepted', decided_by: ADMIN.id, build_requested_by: ADMIN.id, created_by: writer.id }
    const question = { id: '99999999-9999-4999-8999-999999999999', request_id: queued.id, kind: 'question', body: 'Bigger, or further apart?',
      from_status: null, to_status: null, by_id: null, at: '2026-11-06T09:00:00Z', choices: ['Bigger', 'Further apart'], answers: null }
    const { context, page, watch } = await open(ADMIN, `/requests?r=${queued.number}`, { db: { profiles: [ADMIN, BOSS, writer], change_requests: [queued], change_request_events: [question] } })
    await page.getByTestId('request-choices').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('question: the administrator who sent it through can tick it', await page.getByTestId('request-choice').first().isEnabled().catch(() => false))
    t.ok('question: it waits on them by name', /Needs feedback from Test/.test(await page.getByTestId('request-feedback').first().innerText().catch(() => '')))
    quiet('question', watch)
    await context.close()
  }

  /* 3. Spell check */
  {
    const { context, page, watch } = await open(ADMIN, '/settings?tab=Appearance')
    t.check('spell check: on by default', await page.evaluate(() => document.documentElement.getAttribute('spellcheck')), 'true')
    const sw = page.getByTestId('spell-check-switch')
    await sw.waitFor({ timeout: 10_000 }).catch(() => {})
    await sw.click({ timeout: 5_000 }).catch(() => {})
    t.check('spell check: the switch turns it off', await page.evaluate(() => document.documentElement.getAttribute('spellcheck')), 'false')
    t.check('spell check: and says so', (await sw.innerText().catch(() => '')).trim(), 'Spell check off')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    t.check('spell check: off stays off on this device', await page.evaluate(() => document.documentElement.getAttribute('spellcheck')), 'false')
    quiet('spell check', watch)
    await context.close()
  }

  /* 4. The app shell never scrolls as a page (Raptor's app-shell-scroll.mjs) */
  {
    const { context, page, watch } = await open(ADMIN, '/')
    await page.locator('.app-layout').waitFor({ timeout: 10_000 }).catch(() => {})
    const r = await page.evaluate(() => {
      const shell = document.querySelector('.app-layout')
      const before = shell.scrollTop
      const stray = document.createElement('button')
      stray.textContent = 'stray'
      stray.style.cssText = 'position:absolute;left:0;top:2400px;width:80px;height:30px'
      shell.appendChild(stray)
      stray.focus()
      stray.scrollIntoView()
      shell.scrollTop = 500
      const after = shell.scrollTop
      const doc = document.documentElement.scrollTop
      stray.remove()
      return { before, after, doc, h: shell.clientHeight, win: window.innerHeight }
    }).catch(() => ({}))
    t.check('shell: exactly the window tall', r.h, r.win)
    t.check('shell: cannot be scrolled, whoever asks', r.after, 0)
    t.check('shell: the page behind it has not scrolled either', r.doc, 0)
    quiet('shell', watch)
    await context.close()
  }

  /* 5. No flash of yesterday's photograph */
  {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    // The database answers today's photograph slowly, so what the band wears before the answer can be read.
    const slow = [(u) => /\/rest\/v1\/day_photos/.test(u), async () => { await new Promise((r) => setTimeout(r, 2500)); return { body: [] } }]
    const platinum = () => { try { window.localStorage.setItem('remus.theme', 'platinum') } catch { /* */ } }
    const band = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--skin-photo-band'))

    const first = await open(ADMIN, '/', { handlers: [slow] }, { fn: platinum, arg: null })
    // settle() waits for the network, so read straight after the first paint on a fresh load instead -- having
    // forgotten the answer the first load just remembered, so this is still the first visit of the day.
    await first.page.evaluate(() => window.localStorage.removeItem('remus.dayLook'))
    await first.page.reload({ waitUntil: 'domcontentloaded' })
    await first.page.locator('.app-layout').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('photo: the first visit of the day shows the band plain while it asks', await band(first.page), 'none')
    await first.context.close()

    const row = { day: today, photo_id: 'ZhGGLxPcO_M', band_x: 40, band_y: 30, login_x: 50, login_y: 50, line: 'Proud work, every day.', who: null, approved_at: '2026-11-01T00:00:00Z' }
    const remembered = { fn: ([d, r]) => { try { window.localStorage.setItem('remus.theme', 'platinum'); window.localStorage.setItem('remus.dayLook', JSON.stringify({ day: d, row: r, choice: {} })) } catch { /* */ } }, arg: [today, row] }
    const again = await open(ADMIN, '/', { handlers: [slow] }, remembered)
    await again.page.reload({ waitUntil: 'domcontentloaded' })
    await again.page.locator('.app-layout').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('photo: the second visit wears today\'s photograph before the answer', /photo-1499424401353-9b68ae399f0c/.test(await band(again.page)))
    quiet('photo', again.watch)
    await again.context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
