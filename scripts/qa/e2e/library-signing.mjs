/**
 * The Library and online signing (Remus · Handover 8), checked on the screen in a real browser.
 *
 * Stephan, 7 Nov: the Library -- "we can start with pretty much all of that" -- and online signing -- "you can
 * build it, and if other people are going to use it, you can try that."
 *
 *   1. The Library lists its templates by kind, opens one on the letterhead with the example data filled in, and
 *      offers an Administrator "New template" and "Edit".
 *   2. A project's Documents tab lists the document made for it and the signing link, with where it stands
 *      ("Opened"), and "New document" opens the template picker with the filled-in preview.
 *   3. The signing page, signed out, at phone width: the document on the letterhead, the name, a signature drawn
 *      with the mouse, the tick, Sign -- and the server is sent exactly that; then the page says it is signed.
 *      It refuses without the tick first (the server never sees that try).
 *
 * Run: node scripts/qa/e2e/library-signing.mjs   (or as part of `npm run qa`)
 */
import { chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, DOC_TEMPLATE, PROJECT_DOCUMENT, PROJECT_ID, SETTINGS, SIGNING_REQUEST, backend } from './fixtures.mjs'

const t = makeRunner('library-signing')
const { origin, stop } = await startServer()
const browser = await chromium.launch()

const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }
const noSideways = async (label, page) => {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, v: document.documentElement.clientWidth }))
  t.ok(`${label}: no sideways scroll (${w.s} on ${w.v})`, w.s <= w.v + 1)
}

const LIBRARY_DB = { db: { document_templates: [DOC_TEMPLATE, { ...DOC_TEMPLATE, id: '99999999-9999-4999-8999-999999999994', kind: 'letter', name: 'Letter to client', seed_key: 'letter-client', signable: false, body: 'Dear {{client_name}},\n\nWrite here.' }] } }

try {
  /* 1. The Library */
  for (const width of [1280, 390]) {
    const { context, page } = await signedInPage(browser, ADMIN, backend(ADMIN, LIBRARY_DB), { width, height: 900 })
    const watch = watchProblems(page)
    await page.goto(`${origin}/library`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByTestId('library-row').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.check(`library ${width}: both templates listed`, await page.getByTestId('library-row').count(), 2)
    const list = await page.getByTestId('library-list').innerText().catch(() => '')
    t.ok(`library ${width}: grouped by kind (Contracts, Letters)`, /CONTRACTS/i.test(list) && /LETTERS/i.test(list))
    const sheet = await page.getByTestId('document-sheet').first().innerText().catch(() => '')
    t.ok(`library ${width}: the open template is on the letterhead`, sheet.includes(SETTINGS.name) && sheet.includes('BUILDING CONTRACT'))
    t.ok(`library ${width}: example data fills the fields`, sheet.includes('R 345 000.00') && !sheet.includes('{{'))
    t.ok(`library ${width}: an Administrator may add a template`, await page.getByTestId('new-template').isVisible().catch(() => false))
    t.check(`library ${width}: the top bar says Library`, (await page.locator('header h1').first().innerText().catch(() => '')).trim(), 'Library')
    await noSideways(`library ${width}`, page)
    await page.goto(`${origin}/library?tab=letterhead`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    t.ok(`library ${width}: the Letterhead tab shows the sheet`, (await page.getByTestId('letterhead-preview').innerText().catch(() => '')).includes(SETTINGS.address))
    await noSideways(`letterhead ${width}`, page)
    quiet(`library ${width}`, watch)
    await context.close()
  }

  /* 2. The project's Documents tab */
  {
    const { context, page } = await signedInPage(browser, ADMIN, backend(ADMIN, {
      db: { ...LIBRARY_DB.db, project_documents: [PROJECT_DOCUMENT], signing_requests: [SIGNING_REQUEST] },
    }), { width: 390, height: 844 })
    const watch = watchProblems(page)
    await page.goto(`${origin}/projects/${PROJECT_ID}?tab=documents`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByTestId('documents-tab').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('documents: the document is listed', await page.getByTestId('document-row').count(), 1)
    t.check('documents: the signing link is listed', await page.getByTestId('signing-row').count(), 1)
    t.ok('documents: it says the client opened it', (await page.getByTestId('signing-list').innerText().catch(() => '')).includes('Opened'))
    await noSideways('documents 390', page)
    await page.getByTestId('new-document').click({ timeout: 5_000 }).catch(() => {})
    await page.getByTestId('template-pick').waitFor({ timeout: 5_000 }).catch(() => {})
    const preview = await page.locator('[role=dialog] [data-testid=document-sheet]').first().innerText().catch(() => '')
    t.ok('new document: filled from the job (the client)', preview.includes('Test Client (Pty) Ltd'))
    await page.keyboard.press('Escape')
    await page.getByTestId('document-row').first().click({ timeout: 5_000 }).catch(() => {})
    t.ok('documents: a document opens with its actions', await page.getByTestId('document-editor').isVisible().catch(() => false))
    quiet('documents', watch)
    await context.close()
  }

  /* 3. Signing, signed out, on a phone */
  {
    const TOKEN = 'A'.repeat(43)
    let signed = null
    const sent = []
    const doc = () => ({
      title: 'Building contract: Kitchen at 2 Client Road', body: '# BUILDING CONTRACT\n\n**The client:** Thandi Client\n\nThe price is R 345 000.00.',
      source: 'document', signerName: 'Thandi Client', state: signed ? 'signed' : 'sent', expiresAt: '2099-01-01T00:00:00Z',
      closed: signed ? 'This document has already been signed. Nothing further is needed from you.' : null,
      signedAt: signed?.at ?? null, signedName: signed?.name ?? null, signaturePng: signed?.signature ?? null,
      company: { name: SETTINGS.name, address: SETTINGS.address, phone: null, email: SETTINGS.email, regNo: null, vatNo: null, logoUrl: null },
    })
    const handlers = [
      [(url) => url.endsWith('/api/portal/sign-open'), () => ({ body: doc() })],
      [(url) => url.endsWith('/api/portal/sign-submit'), (_url, req) => {
        const b = req.postDataJSON()
        sent.push(b)
        signed = { at: '2026-11-07T10:00:00Z', name: b.name, signature: b.signature }
        return { body: { ok: true, signedAt: signed.at } }
      }],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, { db: {}, api: {}, handlers }, { width: 390, height: 844, signedIn: false })
    const watch = watchProblems(page)
    await page.goto(`${origin}/sign/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByTestId('sign-form').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('sign: the document is shown on the letterhead', (await page.getByTestId('sign-document').innerText().catch(() => '')).includes('BUILDING CONTRACT'))
    t.check('sign: the name it was made out to is filled in', await page.getByTestId('sign-name').inputValue().catch(() => ''), 'Thandi Client')
    await noSideways('sign 390', page)

    const pad = await page.getByTestId('signature-pad').boundingBox()
    if (pad) {
      await page.mouse.move(pad.x + 30, pad.y + 60)
      await page.mouse.down()
      for (let i = 1; i <= 12; i += 1) await page.mouse.move(pad.x + 30 + i * 15, pad.y + 60 + (i % 2 ? 25 : -20))
      await page.mouse.up()
    } else t.fail('sign: the signature pad is on the page')

    await page.getByTestId('sign-submit').click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(300)
    t.check('sign: without the tick nothing is sent', sent.length, 0)
    t.ok('sign: and it says to tick the box', /Tick the box/.test(await page.getByRole('alert').innerText().catch(() => '')))

    await page.getByTestId('sign-agree').check({ timeout: 5_000 }).catch(() => {})
    await page.getByTestId('sign-submit').click({ timeout: 5_000 }).catch(() => {})
    await page.getByTestId('sign-closed').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('sign: one signature sent', sent.length, 1)
    t.check('sign: with the typed name', sent[0]?.name, 'Thandi Client')
    t.ok('sign: with the drawing as a PNG', /^data:image\/png;base64,/.test(sent[0]?.signature ?? ''))
    t.check('sign: with the tick', sent[0]?.agreed, true)
    t.check('sign: with the token from the link', sent[0]?.token, TOKEN)
    t.ok('sign: then it says it is signed', /already been signed/.test(await page.getByTestId('sign-closed').innerText().catch(() => '')))
    t.ok('sign: and shows the signature on the document', await page.getByTestId('sheet-signed').isVisible().catch(() => false))
    quiet('sign', watch)
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
