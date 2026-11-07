/**
 * NEWS (Remus · Handover 8), checked on the screen in a real browser.
 *
 * Stephan, 7 Nov: newsletters to clients "with sign-up and unsubscribe", e.g. "We've finished a job in Brooklyn".
 * What this proves, beyond the tour's "the page draws":
 *
 *   1. An Administrator has News in the sidebar under Clients; the page lists a sent newsletter with its counts,
 *      the people who signed up (with the sign-up page's link), and who is never sent news.
 *   2. Anybody else has no News in the sidebar, and /news sends them to the dashboard.
 *   3. A draft: write it, pick a site diary photo the client may see, count who gets it, send a test to myself.
 *   4. Send while the domain is not verified at Resend: the screen says so in plain words (nothing was sent).
 *   5. A sent newsletter shows what happened to it, person by person.
 *   6. The three pages outside Remus, with nobody signed in: unsubscribe, "Yes, keep me informed", sign up.
 *   7. The News page and a newsletter on a phone (390 wide): nothing scrolls sideways.
 *
 * Run: node scripts/qa/e2e/news.mjs   (or as part of `npm run qa`)
 */
import { chromium, makeRunner, settle, signedInPage, startServer, watchProblems } from './harness.mjs'
import { ADMIN, NEWS_CONFIG_READY, NEWS_DRAFT_ID, NEWS_SENT_ID, backend, newsDb } from './fixtures.mjs'

const t = makeRunner('news')
const { origin, stop } = await startServer()
const browser = await chromium.launch()

const NOT_VERIFIED = 'Newsletters cannot go out yet: urbanhausgroup.co.za is still waiting to be verified at Resend, the service that sends Remus’s email. Once the DNS records are in and Resend shows the domain as Verified, sending works. Nothing was sent.'
const api = (name) => (url) => new URL(url).pathname === `/api/portal/${name}`

/** The server's answers for an Administrator with sending set up. `seen` collects what the page asked for. */
function newsHandlers(seen) {
  return [
    [api('news-config'), () => ({ body: NEWS_CONFIG_READY })],
    [api('news-render'), (_u, req) => {
      const b = req.postDataJSON() ?? {}
      return { body: { subject: b.campaign?.subject ?? '', html: `<p>${b.campaign?.body ?? ''}</p><a>Unsubscribe from our news</a>`, text: '', unknown: [] } }
    }],
    [api('news-preview'), () => ({ body: { count: 2, sample: [{ email: 'client@example.test', firstName: null, companyName: 'Test Client (Pty) Ltd', via: 'company', basis: 'Existing client (POPIA soft opt-in)' }], excluded: { unsubscribed: 1 } } })],
    [api('news-test'), () => { seen.push('test'); return { body: { sentTo: ADMIN.email } } }],
    [api('news-queue'), () => { seen.push('queue'); return { status: 412, body: { error: NOT_VERIFIED, backToDraft: true } } }],
    /* The diary photos' short-lived links, as Supabase Storage answers a list of paths. */
    [(url, req) => req.method() === 'POST' && /\/storage\/v1\/object\/sign\/site-photos$/.test(new URL(url).pathname),
      (_u, req) => ({ body: ((req.postDataJSON() ?? {}).paths ?? []).map((p) => ({ path: p, signedURL: '/object/sign/site-photos/x.png?token=t', error: null })) })],
    [api('news-diary-photo'),() => ({ body: { url: 'https://fake.supabase.co/storage/v1/object/public/news-pictures/diary/x.jpg', caption: 'The new kitchen' } })],
  ]
}

async function open(profile, route, { width = 1280, height = 900, signedIn = true, db = {}, handlers = [] } = {}) {
  const { context, page } = await signedInPage(browser, profile, backend(profile, { db, handlers }), { width, height, signedIn })
  page.on('dialog', (d) => void d.accept())
  const watch = watchProblems(page)
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  return { context, page, watch }
}
const quiet = (label, watch) => { const p = watch.take(); t.check(`${label}: no errors on the page`, p.join(' | '), '') }
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

try {
  /* 1. The News page, for an Administrator */
  {
    const seen = []
    const { context, page, watch } = await open(ADMIN, '/news', { db: newsDb(), handlers: newsHandlers(seen) })
    await page.getByTestId('news-row').first().waitFor({ timeout: 10_000 }).catch(() => {})
    const nav = page.locator('aside nav a, aside a').filter({ hasText: /^\s*News\s*$/ })
    t.ok('news: the sidebar has News', await nav.count() > 0)
    const order = await page.locator('aside a').allInnerTexts()
    const iClients = order.findIndex((x) => x.trim() === 'Clients')
    t.check('news: News sits right under Clients, as in Raptor', order[iClients + 1]?.trim(), 'News')
    t.check('news: the top bar says News', (await page.locator('header h1').first().innerText().catch(() => '')).trim(), 'News')
    t.check('news: both newsletters listed', await page.getByTestId('news-row').count(), 2)
    const list = await page.getByTestId('news-list').innerText().catch(() => '')
    t.ok('news: the sent one has its subject', /finished a job in Brooklyn/.test(list))
    t.ok('news: and its counts (2 of 2 sent, 1 opened)', /2 of 2/.test(list) && /1 \(50%\)/.test(list))
    t.ok('news: sending set up, so no setup steps', !(await page.getByTestId('news-sender-setup').isVisible().catch(() => false)))
    t.ok('news: the people who signed up', /People who signed up \(1\)/.test(await page.getByTestId('news-home').innerText()))
    t.ok('news: the sign-up page link', /\/subscribe$/.test((await page.getByTestId('news-signup-link').innerText().catch(() => '')).trim()))
    await page.getByTestId('undelivered-toggle').click({ timeout: 5_000 }).catch(() => {})
    t.ok('news: a bounced address is listed with why', /No such user/.test(await page.getByTestId('undelivered-list').innerText().catch(() => '')))
    quiet('news page', watch)
    await context.close()
  }

  /* 2. Anybody else: no News */
  {
    const contractor = { ...ADMIN, role: 'Sales Representative', job: 'contractor' }
    const { context, page, watch } = await open(contractor, '/news', { db: newsDb() })
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 10_000 }).catch(() => {})
    t.check('news: a contractor is sent to the dashboard', new URL(page.url()).pathname, '/')
    const texts = (await page.locator('aside a').allInnerTexts()).map((x) => x.trim())
    t.ok('news: a contractor has no News in the sidebar', !texts.includes('News') && texts.includes('Clients'))
    quiet('news for a contractor', watch)
    await context.close()
  }

  /* 3 and 4. A draft: photo, count, test, then send into an unverified domain */
  {
    const seen = []
    const { context, page, watch } = await open(ADMIN, `/news?c=${NEWS_DRAFT_ID}`, { db: newsDb(), handlers: newsHandlers(seen) })
    await page.getByTestId('news-editor').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('draft: the editor opens', await page.getByTestId('news-editor').isVisible().catch(() => false))
    await page.getByTestId('news-subject').fill('We’ve finished a job in Brooklyn')
    await page.getByTestId('news-body').fill('Hello {{first_name}},\n\nA new kitchen, done on time.')
    await page.waitForTimeout(900)
    t.check('draft: the preview shows the subject', (await page.getByTestId('news-preview-subject').innerText().catch(() => '')).trim(), 'We’ve finished a job in Brooklyn')

    await page.getByTestId('news-photos-diary').click()
    await page.getByTestId('news-diary-photos').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('draft: the diary offers the photo the client may see', await page.getByTestId('news-diary-photos').locator('button').count(), 1)
    await page.getByTestId('news-diary-photos').locator('button').first().click()
    await page.getByTestId('news-photo').first().waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('draft: the photo is in the newsletter', await page.getByTestId('news-photo').count(), 1)

    t.check('draft: Send waits for a count', await page.getByTestId('news-send').isDisabled(), true)
    await page.getByTestId('news-count-button').click()
    await page.getByTestId('news-count').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('draft: the count', (await page.getByTestId('news-count').innerText().catch(() => '')).trim(), '2')
    t.ok('draft: who was left out, and why', /1 unsubscribed/.test(await page.getByTestId('news-excluded').innerText().catch(() => '')))
    t.ok('draft: each person’s POPIA basis is shown', /soft opt-in/.test(await page.getByTestId('news-preview-list').innerText().catch(() => '')))

    await page.getByTestId('news-test').click()
    await page.getByTestId('news-message').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('draft: a test goes to me', /A test went to admin@urbanhaus\.test/.test(await page.getByTestId('news-message').innerText().catch(() => '')))

    t.check('draft: Send says how many', (await page.getByTestId('news-send').innerText()).trim(), 'Send to 2 people')
    await page.getByTestId('news-send').click()
    await page.getByTestId('news-error').waitFor({ timeout: 10_000 }).catch(() => {})
    const err = await page.getByTestId('news-error').innerText().catch(() => '')
    t.ok('send: asked the server to send', seen.includes('queue'))
    t.ok('send: domain not verified, said in plain words', /still waiting to be verified at Resend/.test(err) && /Nothing was sent/.test(err))
    /* The server's 412 is the expected answer here, not a broken page. */
    const problems = watch.take().filter((p) => !/412|Precondition/.test(p))
    t.check('draft: no errors on the page', problems.join(' | '), '')
    await context.close()
  }

  /* 5. A sent newsletter: what happened to it */
  {
    const { context, page, watch } = await open(ADMIN, `/news?c=${NEWS_SENT_ID}`, { db: newsDb(), handlers: newsHandlers([]) })
    await page.getByTestId('news-results').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('sent: it cannot be changed', /cannot be changed/.test(await page.getByTestId('news-locked').innerText().catch(() => '')))
    const res = await page.getByTestId('news-results').innerText().catch(() => '')
    t.ok('sent: delivered 2 of 2', /Delivered\s*2\s*100% of sent/.test(res))
    t.ok('sent: one opened', /Opened\s*1\s*50% of delivered/.test(res))
    t.check('sent: each person listed', await page.getByTestId('news-recipients').locator('li').count(), 2)
    t.check('sent: no Send button', await page.getByTestId('news-send').count(), 0)
    quiet('sent newsletter', watch)
    await context.close()
  }

  /* 6. The pages outside Remus, nobody signed in */
  {
    const handlers = [
      [api('brand'), () => ({ body: { name: 'Urban Haus Construction', logoUrl: null } })],
      [api('news-unsubscribe'), (_u, req) => ({ body: { email: 'th••••@example.test', status: (req.postDataJSON() ?? {}).step === 'resubscribe' ? 'subscribed' : 'unsubscribed', changedAt: null } })],
      [api('news-opt-in'), (_u, req) => ({ body: { email: 'an••@sub.test', optedIn: (req.postDataJSON() ?? {}).step === 'yes' } })],
      [api('news-sign-up'), (_u, req) => (req.postDataJSON()?.agree === true
        ? { body: { message: 'Thank you. We have sent you an email: press the button in it to confirm, and you are on our list.' } }
        : { status: 400, body: { error: 'Tick the box.' } })],
    ]
    const { context, page, watch } = await open(ADMIN, '/unsubscribe/abc.0123456789abcdef0123456789abcdef', { signedIn: false, handlers })
    await page.getByTestId('unsubscribe-heading').waitFor({ timeout: 10_000 }).catch(() => {})
    t.check('unsubscribe: opening the link unsubscribes', (await page.getByTestId('unsubscribe-heading').innerText().catch(() => '')).trim(), 'You will not receive our news any more')
    await page.getByTestId('unsubscribe-resubscribe').click()
    await page.waitForTimeout(400)
    t.check('unsubscribe: a mistake is put right with one press', (await page.getByTestId('unsubscribe-heading').innerText().catch(() => '')).trim(), 'You will receive our news again')

    await page.goto(`${origin}/opt-in/abc.0123456789abcdef0123456789abcdef`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    t.ok('opt-in: opening asks, it records nothing', /^Keep .* informed\?$/.test((await page.getByTestId('opt-in-heading').innerText().catch(() => '')).trim()))
    await page.getByTestId('opt-in-confirm').click()
    await page.waitForTimeout(400)
    t.check('opt-in: the press records the yes', (await page.getByTestId('opt-in-heading').innerText().catch(() => '')).trim(), 'Thank you: you’ll hear from us')
    t.ok('opt-in: "that wasn’t me" is offered', await page.getByTestId('opt-in-withdraw').isVisible())

    await page.goto(`${origin}/subscribe`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    t.ok('sign up: the page opens without signing in', await page.getByTestId('sign-up-page').isVisible().catch(() => false))
    await page.getByTestId('sign-up-email').fill('new@person.test')
    t.check('sign up: nothing without the tick', await page.getByTestId('sign-up-submit').isDisabled(), true)
    await page.getByTestId('sign-up-agree').check()
    await page.getByTestId('sign-up-submit').click()
    await page.getByTestId('sign-up-done').waitFor({ timeout: 10_000 }).catch(() => {})
    t.ok('sign up: asked to confirm from the email', /press the button in it to confirm/.test(await page.getByTestId('sign-up-done').innerText().catch(() => '')))
    quiet('public pages', watch)
    await context.close()
  }

  /* 7. On a phone */
  for (const route of ['/news', `/news?c=${NEWS_DRAFT_ID}`, `/news?c=${NEWS_SENT_ID}`]) {
    const { context, page, watch } = await open(ADMIN, route, { width: 390, height: 844, db: newsDb(), handlers: newsHandlers([]) })
    await page.waitForTimeout(600)
    t.check(`phone ${route}: no sideways scroll`, await sideways(page) <= 1, true)
    quiet(`phone ${route}`, watch)
    if (await sideways(page) > 1) await t.shot(page, `news-phone-${route.replace(/[^a-z0-9]+/gi, '-')}`)
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

process.exit(t.finish() ? 0 : 1)
