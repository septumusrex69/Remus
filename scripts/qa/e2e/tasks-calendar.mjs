/**
 * Tasks, the Calendar and Activities (Remus · Handover 8, from Raptor), each checked on the screen in a real browser.
 *
 * Stephan, 7 Nov 2026: "Tasks is a good idea ... Calendar as well. Activities, yeah."
 *
 * The tour (tour.mjs) proves the three pages draw without breaking. This proves they draw the THING they were built for:
 *   1. Tasks lists today's task, counts it as due today, and "Add task" opens the box with the day picker.
 *   2. The top bar's + Add -> Task lands on the box (?new=1).
 *   3. The sidebar's Tasks wears the count of my tasks due by tonight.
 *   4. The Calendar puts the task and the job stage on today's square, and the Day view lists them.
 *   5. Activities shows a logged call and a filed email in one timeline, and "Log a call" opens the form.
 *   6. A project's Tasks and Activity tabs, and a client's Activity tab, show their own.
 *
 * Run: node scripts/qa/e2e/tasks-calendar.mjs   (or as part of `npm run qa`)
 */
import { chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ACTIVITY_CALL, ACTIVITY_EMAIL, ADMIN, COMPANY_ID, PROJECT_ID, STAGE, TASK, backend } from './fixtures.mjs'

const t = makeRunner('tasks-calendar')
const { origin, stop } = await startServer()
const browser = await chromium.launch()
const db = { tasks: [TASK], activities: [ACTIVITY_CALL, ACTIVITY_EMAIL], project_stages: [STAGE] }

async function open(route, size) {
  const { context, page } = await signedInPage(browser, ADMIN, backend(ADMIN, { db }), size)
  const watch = watchProblems(page)
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  return { context, page, watch }
}
const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }
const text = async (loc) => (await loc.innerText().catch(() => '')) ?? ''

try {
  /* 1 + 3. Tasks, and the sidebar's count */
  {
    const { context, page, watch } = await open('/tasks')
    await page.getByTestId('task-row').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('tasks: the task is listed under My Tasks', await page.getByTestId('task-row').count(), 1)
    t.ok('tasks: it names the job', /Kitchen at 2 Client Road/.test(await text(page.getByTestId('task-list'))))
    t.check('tasks: counted as due today', (await text(page.getByTestId('task-figure-due-today'))).replace(/\D+/g, ''), '1')
    const nav = page.locator('aside a[href="/tasks"]').first()
    await page.waitForFunction(() => /\d/.test(document.querySelector('aside a[href="/tasks"]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {})
    t.ok(`sidebar: Tasks wears a count ("${(await text(nav)).replace(/\s+/g, ' ').trim()}")`, /Tasks\s*1/.test(await text(nav)))
    t.ok('sidebar: Calendar is there', await page.locator('aside a[href="/calendar"]').count() > 0)
    t.ok('sidebar: Activities is there', await page.locator('aside a[href="/activities"]').count() > 0)
    await page.getByTestId('task-add').click({ timeout: 5_000 }).catch(() => {})
    t.ok('tasks: Add task opens the box', await page.getByTestId('task-form').isVisible({ timeout: 5_000 }).catch(() => false))
    t.ok('tasks: the box shows the day picker', await page.getByTestId('task-day-picker').isVisible().catch(() => false))
    quiet('tasks', watch)
    await context.close()
  }

  /* 2. + Add -> Task */
  {
    const { context, page, watch } = await open('/tasks?new=1')
    await page.getByTestId('task-form').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('quick add: ?new=1 opens the task box', await page.getByTestId('task-form').isVisible().catch(() => false))
    quiet('quick add', watch)
    await context.close()
  }

  /* 4. The calendar */
  {
    const { context, page, watch } = await open('/calendar', { width: 1280, height: 900 })
    await page.getByTestId('calendar-month').waitFor({ timeout: 10_000 }).catch(() => {})
    const month = await text(page.getByTestId('calendar-month'))
    t.ok('calendar: the task is on the month', /Order the tiles/.test(month))
    t.ok('calendar: the job stage is on the month', /Tiling/.test(month))
    await page.getByTestId('calendar-view-day').click({ timeout: 5_000 }).catch(() => {})
    const day = await text(page.getByTestId('calendar-dayview'))
    t.ok('calendar: the Day view lists the task and the stage', /Order the tiles/.test(day) && /Tiling/.test(day))
    quiet('calendar', watch)
    await context.close()
  }

  /* 5. Activities */
  {
    const { context, page, watch } = await open('/activities')
    await page.getByTestId('activity-row').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('activities: the call and the email in one timeline', await page.getByTestId('activity-row').count(), 2)
    const all = await text(page.getByTestId('activity-timeline'))
    t.ok('activities: the email reads as Received, with its own subject', /Received\s*Tile samples/i.test(all))
    await page.getByTestId('activity-log-call').click({ timeout: 5_000 }).catch(() => {})
    t.ok('activities: Log a call opens the form', await page.getByTestId('activity-form').isVisible({ timeout: 5_000 }).catch(() => false))
    quiet('activities', watch)
    await context.close()
  }

  /* 6. The record pages' tabs */
  for (const [label, route, testid, want] of [
    ['project Tasks tab', `/projects/${PROJECT_ID}?tab=tasks`, 'record-tasks', /Order the tiles/],
    ['project Activity tab', `/projects/${PROJECT_ID}?tab=activity`, 'record-activity', /Called about the tile colour/],
    ['client Activity tab', `/clients/company/${COMPANY_ID}?tab=activity`, 'record-activity', /Tile samples/],
  ]) {
    const { context, page, watch } = await open(route, { width: 390, height: 844 })
    await page.getByTestId(testid).waitFor({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(300)
    t.ok(`${label}: shows its own`, want.test(await text(page.getByTestId(testid))))
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    t.ok(`${label}: no sideways scroll on a phone (${wide}px over)`, wide <= 1)
    quiet(label, watch)
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
