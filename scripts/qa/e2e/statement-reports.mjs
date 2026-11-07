/**
 * The statement of account and the Reports page (Remus · Handover 8), checked on the screen in a real browser.
 *
 * Stephan, 7 Nov: "Definitely a statement of account", and of the reports: "we can start with pretty much all of
 * that." The tour (tour.mjs) proves /reports draws; this proves the THINGS:
 *
 *   1. A client's Invoices tab has the statement: Preview, Download PDF, Email, WhatsApp. Download asks the server
 *      for THIS client's statement; Email sends it through the quote's send path, to the client's address.
 *   2. Read-only sees the money but sends nothing: no Email, no WhatsApp.
 *   3. Finance's outstanding list opens the same statement for the client on the invoice.
 *   4. Every report tab draws its report with the fixture's figures, and a CSV comes down.
 *   5. A contractor gets no Reports: not in the sidebar, not at the address.
 *
 * Run: node scripts/qa/e2e/statement-reports.mjs   (or as part of `npm run qa`)
 */
import { chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, COMPANY_ID, CREW_DAY, INVOICE, PAYMENT, WORKER, backend } from './fixtures.mjs'

const t = makeRunner('statement-reports')
const { origin, stop } = await startServer()
const browser = await chromium.launch()

const MONEY_DB = { invoices: [INVOICE], payments: [PAYMENT], workers: [WORKER], crew_days: [CREW_DAY] }
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

async function open(profile, route, { width = 1280, handlers = [] } = {}) {
  const { context, page } = await signedInPage(browser, profile, backend(profile, { db: MONEY_DB, handlers }), { width, height: 900 })
  const watch = watchProblems(page)
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  return { context, page, watch }
}
const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }

try {
  /* 1. The client's statement */
  {
    const asked = []
    const handlers = [
      [(url) => url.includes('/api/quotes/pdf'), (url) => { asked.push(url); return { body: PDF, contentType: 'application/pdf', headers: { 'content-disposition': 'inline; filename="Statement-Test.pdf"' } } }],
      [(url, req) => url.includes('/api/quotes/send') && req.method() === 'POST', (_url, req) => { asked.push(req.postDataJSON()); return { body: { ok: true } } }],
    ]
    const { context, page, watch } = await open(ADMIN, `/clients/company/${COMPANY_ID}?tab=invoices`, { handlers })
    const box = page.getByTestId('statement-actions')
    await box.waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('client: the statement card is on the Invoices tab', await box.isVisible().catch(() => false))
    for (const b of ['statement-preview', 'statement-download', 'statement-email', 'statement-whatsapp']) {
      t.ok(`client: ${b.replace('statement-', '')} button`, await page.getByTestId(b).isVisible().catch(() => false))
    }
    const download = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
    await page.getByTestId('statement-download').click()
    const file = await download
    t.check('client: Download PDF saves the statement', file?.suggestedFilename() ?? null, 'Statement-Test.pdf')
    const pdfUrl = new URL(String(asked.find((a) => typeof a === 'string') ?? 'http://x/'))
    t.check('client: it asks for a company statement', pdfUrl.searchParams.get('statement'), 'company')
    t.check('client: ... of this client', pdfUrl.searchParams.get('client'), COMPANY_ID)
    t.ok('client: ... for a period', /^\d{4}-\d{2}-\d{2}$/.test(pdfUrl.searchParams.get('to') ?? ''))

    await page.getByTestId('statement-email').click()
    const to = page.getByRole('dialog').locator('input').first()
    await to.waitFor({ timeout: 5_000 }).catch(() => {})
    t.check('email: to the client\'s address', await to.inputValue().catch(() => ''), 'client@example.test')
    await page.getByTestId('statement-send').click()
    await page.getByText(/Statement sent to/).waitFor({ timeout: 5_000 }).catch(() => {})
    const sent = asked.find((a) => typeof a === 'object')
    t.check('email: goes through the quote send path with the statement', sent?.statement?.kind ?? null, 'company')
    t.ok('email: says it went', await page.getByText(/Statement sent to client@example.test/).isVisible().catch(() => false))
    quiet('client statement', watch)
    await context.close()
  }

  /* 2. Read-only: download yes, send no */
  {
    const { context, page, watch } = await open({ ...ADMIN, role: 'Read Only' }, `/clients/company/${COMPANY_ID}?tab=invoices`)
    await page.getByTestId('statement-actions').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('read-only: may download', await page.getByTestId('statement-download').isVisible().catch(() => false))
    t.check('read-only: no Email', await page.getByTestId('statement-email').count(), 0)
    t.check('read-only: no WhatsApp', await page.getByTestId('statement-whatsapp').count(), 0)
    quiet('read-only statement', watch)
    await context.close()
  }

  /* 3. Finance's outstanding list */
  {
    const { context, page, watch } = await open(ADMIN, '/finance')
    const btn = page.getByTestId('finance-statement').first()
    await btn.waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('finance: a Statement button on the outstanding invoice', await page.getByTestId('finance-statement').count(), 1)
    await btn.click().catch(() => {})
    t.ok('finance: it opens the statement for that client', await page.getByRole('dialog').getByText('Statement: Test Client (Pty) Ltd').isVisible().catch(() => false))
    t.ok('finance: with the buttons', await page.getByRole('dialog').getByTestId('statement-download').isVisible().catch(() => false))
    quiet('finance statement', watch)
    await context.close()
  }

  /* 4. Every report, on a desk and on a phone */
  const REPORTS = [
    ['profit', /Kitchen at 2 Client Road/],
    ['spending', /Materials/],
    ['outstanding', /Test Client \(Pty\) Ltd/],
    ['quotes', /Kitchen renovation/],
    ['crew', /Sipho Builder/],
    ['suppliers', /Builders Warehouse/],
    ['returns', /Nothing went back in this period|Returns credited/],
  ]
  for (const width of [1280, 390]) {
    const { context, page, watch } = await open(ADMIN, '/reports', { width })
    for (const [tab, words] of REPORTS) {
      await page.goto(`${origin}/reports?tab=${tab}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      const body = page.getByTestId(`report-${tab}`)
      await body.waitFor({ timeout: 10_000 }).catch(() => {})
      t.ok(`reports @${width} ${tab}: shows what it is for`, words.test(await body.innerText().catch(() => '')))
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      t.check(`reports @${width} ${tab}: no sideways scroll`, sideways, false)
    }
    if (width === 1280) {
      await page.goto(`${origin}/reports?tab=outstanding`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      const outstanding = await page.getByTestId('report-outstanding').innerText().catch(() => '')
      t.ok('reports: outstanding owes R 65 000 (R 115 000 less R 50 000)', /R\s?65\s000/.test(outstanding))
      const csv = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
      await page.getByTestId('csv-outstanding-by-client').click().catch(() => {})
      const f = await csv
      t.ok('reports: the CSV comes down', /^outstanding-by-client-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(f?.suggestedFilename() ?? ''))
    }
    quiet(`reports @${width}`, watch)
    await context.close()
  }

  /* 5. A contractor: no Reports */
  {
    const contractor = { ...ADMIN, role: 'Sales Representative', job: 'contractor' }
    const { context, page, watch } = await open(contractor, '/reports')
    t.check('contractor: no report shown', await page.getByTestId('report-profit').count(), 0)
    t.check('contractor: no Reports in the sidebar', await page.locator('nav a[href="/reports"]').count(), 0)
    quiet('contractor reports', watch)
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
