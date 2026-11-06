/**
 * The robot's tour: every page of Remus, on a phone and on a desk, and it shouts if anything breaks.
 *
 * Raptor's smoke.mjs (55a7520, "tour the app with a robot"), adapted to Remus · Handover 8. What counts as broken --
 * each is a bug somebody would otherwise have had to notice and report:
 *   - the page crashed (the "Something went wrong" box) or went blank
 *   - a JavaScript error, uncaught or logged with console.error
 *   - the top bar has no title (Handover 8's phone check found five pages like that)
 *   - the page scrolls sideways (wider than the screen: the phone check's other finding)
 *
 * DIFFERENT FROM RAPTOR: Raptor's tour signs in as a real person against a real database and skips itself without
 * a password. This one answers the database from fixtures (harness.mjs), so it always runs -- here, in CI, anywhere.
 * And the list of pages is READ from src/pages/build/routes.tsx, so a new page is toured the day it is added.
 *
 * Run: node scripts/qa/e2e/tour.mjs        (or as part of `npm run qa`)
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, COMPANY_ID, CONTACT_ID, PROJECT_ID, QUOTE_ID, backend } from './fixtures.mjs'

const t = makeRunner('tour')

/* Every route in the app, read from the source. `:id` becomes the fixture record of that kind. */
/* Only the routes themselves: the file's comments show how Raptor would mount it ("/build"), which is not a page. */
const src = fs.readFileSync(path.join(ROOT, 'src/pages/build/routes.tsx'), 'utf8').split('export const buildRoutes')[1]
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const IDS = { quotes: QUOTE_ID, projects: PROJECT_ID, company: COMPANY_ID, contact: CONTACT_ID }
const routes = ['/']
for (const [, p] of src.matchAll(/<Route\s+path="([^"]+)"/g)) {
  const parts = p.split('/')
  const filled = parts.map((seg, i) => (seg === ':id' ? IDS[parts[i - 1]] : seg))
  if (filled.includes(undefined)) { t.fail(`route ${p}`, 'has an :id the tour does not know a fixture for (add it to IDS)'); continue }
  routes.push(`/${filled.join('/')}`)
}
t.ok('routes.tsx lists at least twenty pages', routes.length >= 20)

const SIGNED_OUT = ['/login', '/portal']
const WIDTHS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desk', width: 1280, height: 900 }]

const { origin, stop } = await startServer()
const browser = await chromium.launch()
let pages = 0
try {
  /* The phone and the desk side by side, each in its own browser window: half the wait. */
  await Promise.all(WIDTHS.map(async (w) => {
    for (const signedIn of [false, true]) {
      const { context, page } = await signedInPage(browser, ADMIN, backend(ADMIN), { width: w.width, height: w.height, signedIn })
      const watch = watchProblems(page)
      for (const route of signedIn ? routes : SIGNED_OUT) {
        const name = `${w.name} ${route}`
        try {
          await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
          await settle(page)
          if (signedIn && !route.endsWith('/print')) await page.locator('header h1').first().waitFor({ timeout: 10_000 }).catch(() => {})
          const look = await page.evaluate(() => ({
            path: location.pathname,
            text: (document.body.innerText ?? '').trim().length,
            crashed: /Something went wrong/.test(document.body.innerText ?? ''),
            title: (document.querySelector('header h1')?.textContent ?? '').trim(),
            hasTopbar: Boolean(document.querySelector('header h1')),
            scrollW: document.documentElement.scrollWidth,
            viewW: document.documentElement.clientWidth,
          }))
          const problems = watch.take()
          if (look.crashed) problems.push('the page crashed ("Something went wrong")')
          if (look.text < 20) problems.push('the page is blank')
          if (signedIn && look.path !== route) problems.push(`landed on ${look.path} instead`)
          if (signedIn && !route.endsWith('/print') && !look.title) problems.push('the top bar has no title')
          if (look.scrollW > look.viewW + 1) problems.push(`scrolls sideways: ${look.scrollW}px wide on a ${look.viewW}px screen`)
          if (problems.length) {
            t.fail(name, problems.join('\n    '))
            await t.shot(page, `tour-${w.name}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}`)
          } else t.ok(name, true)
          pages += 1
        } catch (e) {
          t.fail(name, `step failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
        }
      }
      await context.close()
    }
  }))
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish(`${pages} page visits (${routes.length} signed-in routes + ${SIGNED_OUT.length} signed-out, at 390 and 1280 wide).`) ? 0 : 1)
