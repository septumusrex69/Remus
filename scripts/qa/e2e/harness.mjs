/**
 * Driving the real app in a real browser, with no database behind it.
 *
 * COPIED FROM RAPTOR (scripts/qa/e2e/harness.mjs, branch claude/sales-raptor-review-p1pzx2) and adapted to Remus
 * (Remus · Handover 8). Raptor's reasons hold here word for word:
 *
 * WHY STUBBED RATHER THAN POINTED AT THE LIVE DATABASE. A signed-in browser test needs three things a project cannot
 * rely on having: network access to Supabase, a live account whose password is somewhere safe, and data nobody has
 * edited this morning. Miss any one and the suite stops running, which is how test suites die. Answering the app's own
 * requests from fixtures costs none of that, and it makes what is on the screen KNOWN.
 *
 * What it does not test: that the SQL is right. That is the database's own job (the migrations, the unit tests).
 * This tests the half those cannot reach -- that the screen renders, and that it does not break on a phone.
 *
 * DIFFERENT FROM RAPTOR:
 *  - The database address is replaced on the dev server's command line (VITE_SUPABASE_URL=https://fake.supabase.co),
 *    never by writing .env.local. A real .env.local is left alone AND cannot leak into the test: environment
 *    variables already set win over Vite's .env files. So the session key is always `sb-fake-auth-token`.
 *  - One dev server for the whole run (run-all.mjs starts it and hands the address on in REMUS_E2E_ORIGIN), on a free
 *    port, rather than one per file on a fixed 5199 -- Raptor's notes record two runs colliding on that port.
 *  - PostgREST's ".single()" / ".maybeSingle()" answers are shaped here, from the same list a table returns, so a
 *    fixture is written once as rows. HEAD count requests get a content-range header.
 *  - /api/* (Vercel functions, which the dev server does not run) is answered here too.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/* The globally installed Playwright, as Raptor does: no browser download, no version in package.json to drift. */
const { chromium } = await import(
  process.env.REMUS_QA_PLAYWRIGHT
  ?? `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)
export { chromium }

export const ROOT = path.resolve(import.meta.dirname, '../../..')
export const OUT = process.env.REMUS_QA_OUT ?? path.join(ROOT, '.qa-screenshots')

export const FAKE_SUPABASE = 'https://fake.supabase.co'
const SESSION_KEY = 'sb-fake-auth-token'

export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/**
 * A session the client will accept. supabase-js only DECODES the token to read the expiry and the subject --
 * signatures are checked by the server, and there is no server here.
 */
export function fakeSession(userId, email, nowMs = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(nowMs / 1000) + 3600
  const token = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: userId, email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 }),
    'not-a-real-signature',
  ].join('.')
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'fake-refresh-token',
    user: {
      id: userId, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    },
  }
}

/* ---------- the dev server ---------- */

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

/**
 * The dev server, or the one run-all.mjs already started. Returns { origin, stop }. Only ever ours to stop (we
 * kill the process group WE spawned, by its pid), so nothing else on the machine is touched.
 */
export async function startServer() {
  if (process.env.REMUS_E2E_ORIGIN) return { origin: process.env.REMUS_E2E_ORIGIN, stop: () => {} }
  const port = await freePort()
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, VITE_SUPABASE_URL: FAKE_SUPABASE, VITE_SUPABASE_ANON_KEY: 'fake-anon-key-not-a-credential', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  })
  const origin = `http://127.0.0.1:${port}`
  const stop = () => { try { process.kill(-server.pid) } catch { /* already gone */ } }
  process.on('exit', stop)
  /* WAIT UNTIL IT ANSWERS (Raptor: a suite that navigates on the next line gets ERR_CONNECTION_REFUSED). */
  for (let i = 0; i < 120; i += 1) {
    try { await fetch(`${origin}/`); break } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return { origin, stop }
}

/* ---------- the stub ---------- */

/** The table (or rpc) a PostgREST request names: /rest/v1/projects?select=... -> 'projects', /rest/v1/rpc/x -> 'rpc/x'. */
export function tableOf(url) {
  const m = /\/rest\/v1\/([^?]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * Narrow a fixture table by the simple filters a request carries (`col=eq.value`, `col=in.(a,b)`), so a record
 * page asking for one id gets that row. Anything fancier (or=, ilike, gte ...) is ignored: the rows come back
 * unfiltered, which is what a page showing a list expects anyway.
 */
function filterRows(rows, url) {
  const q = new URL(url).searchParams
  let out = rows
  for (const [col, raw] of q) {
    if (['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'].includes(col)) continue
    const eq = /^eq\.(.*)$/.exec(raw)
    const inn = /^in\.\((.*)\)$/.exec(raw)
    if (eq) out = out.filter((r) => !(col in r) || String(r[col]) === eq[1])
    else if (inn) { const vals = inn[1].split(',').map((v) => v.replace(/^"|"$/g, '')); out = out.filter((r) => !(col in r) || vals.includes(String(r[col]))) }
  }
  return out
}

/**
 * Answer every request the page makes to the fake database and to /api.
 *
 * `db` is { table: rows[] } (and 'rpc/name': value). `handlers` is a list of [match(url, req), respond(url, req)]
 * that are asked first; respond returns { status?, body, headers? }. Anything unmatched is "nothing there" (an
 * empty list, or {} from /api), never a hang -- a page waiting for ever on an unstubbed request fails as a timeout
 * twenty lines from the cause (Raptor).
 */
export async function stubBackend(page, { db = {}, api = {}, handlers = [], seen = null } = {}) {
  /* Pictures from Unsplash (the photo of the day) and map tiles: a tiny picture, never the network. */
  await page.route(/https:\/\/(images\.unsplash\.com|[a-z.]*tile\.openstreetmap\.org|[a-z.]*basemaps\.cartocdn\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }))
  /* Google fonts and anything else off the machine: empty, so a missing network is not a console error. */
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))

  const fulfil = (route, r, extraHeaders = {}) => route.fulfill({
    status: r.status ?? 200,
    contentType: r.contentType ?? 'application/json',
    headers: { 'access-control-expose-headers': 'content-range, content-length', ...extraHeaders, ...(r.headers ?? {}) },
    body: typeof r.body === 'string' || Buffer.isBuffer(r.body) ? r.body : JSON.stringify(r.body ?? []),
  })

  await page.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const req = route.request()
    const url = req.url()
    seen?.push(`${req.method()} ${url.replace(FAKE_SUPABASE, '')}`)
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    for (const [match, respond] of handlers) {
      if (match(url, req)) return fulfil(route, await respond(url, req))
    }
    /* Storage: a signed URL for anything asked, a tiny picture for a download. */
    if (url.includes('/storage/v1/')) {
      if (/\/object\/sign\//.test(url)) return fulfil(route, { body: { signedURL: '/storage/v1/object/public/x.png', signedUrls: [] } })
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
      return fulfil(route, { body: { Key: 'x' } })
    }
    if (url.includes('/auth/v1/')) return fulfil(route, { body: {} })
    const table = tableOf(url)
    if (!table) return fulfil(route, { body: [] })
    if (table.startsWith('rpc/')) return fulfil(route, { body: db[table] ?? [] })
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      // A write: echo the row back, as `.select()` after an insert expects.
      let row = {}
      try { row = req.postDataJSON() ?? {} } catch { /* not json */ }
      return fulfil(route, { body: Array.isArray(row) ? row : [row] })
    }
    const rows = filterRows(db[table] ?? [], url)
    const range = { 'content-range': `${rows.length ? `0-${rows.length - 1}` : '*'}/${rows.length}` }
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-expose-headers': 'content-range', ...range }, body: '' })
    /* .single() / .maybeSingle() ask for one object (Accept: application/vnd.pgrst.object+json). */
    if ((req.headers().accept ?? '').includes('vnd.pgrst.object')) {
      if (rows.length === 1) return fulfil(route, { body: rows[0] }, range)
      return fulfil(route, { status: 406, body: { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' } })
    }
    return fulfil(route, { body: rows }, range)
  })

  /* The Vercel functions (the dev server has none): a test may answer one; otherwise an empty success. */
  await page.route(/\/api\//, async (route) => {
    const req = route.request()
    const url = req.url()
    if (!new URL(url).pathname.startsWith('/api/')) return route.fallback()
    seen?.push(`${req.method()} ${new URL(url).pathname}`)
    for (const [match, respond] of handlers) {
      if (match(url, req)) return fulfil(route, await respond(url, req))
    }
    const p = new URL(url).pathname
    return fulfil(route, { body: p in api ? api[p] : {} })
  })
}

/**
 * A browser already signed in as `profile`, with the stub in place.
 *
 * The session is seeded before any app code runs (so the login page never flashes), the sign-in opening is turned
 * off for this browser (remus.opening = 'none'), and the viewport is a phone or a desk.
 */
export async function signedInPage(browser, profile, backend, { width = 1280, height = 900, signedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 768, isMobile: false })
  const page = await context.newPage()
  await stubBackend(page, backend)
  await context.addInitScript(
    ([key, session]) => {
      try {
        window.localStorage.setItem('remus.opening', 'none')
        if (session) window.localStorage.setItem(key, session)
      } catch { /* ignore */ }
    },
    [SESSION_KEY, signedIn ? JSON.stringify(fakeSession(profile.id, profile.email)) : null],
  )
  return { context, page }
}

/**
 * What counts as broken on a page, collected as it happens: an uncaught error, a console.error (React's own
 * warnings are console.error too, which is what we want), and a request to our own /api or the database that
 * answered 5xx. Call `take()` to read and clear.
 */
export function watchProblems(page) {
  let problems = []
  page.on('pageerror', (e) => problems.push(`JS error: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // A 4xx the app handled on purpose (no row: .single() on nothing) logs as a failed resource.
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return
    // React's errors arrive as a format string ("%o\n\n%s") with the real message on a later line.
    const line = t.split('\n').map((l) => l.trim()).find((l) => l && !/^(%[sod]\s*)+$/.test(l)) ?? t
    problems.push(`console.error: ${line.slice(0, 240)}`)
  })
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} from ${r.url().replace(/\?.*/, '')}`) })
  return { take: () => { const p = [...new Set(problems)]; problems = []; return p }, peek: () => problems }
}

/** Wait for the page to finish loading what it loads, then one more render. */
export async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

/* ---------- the little test runner (Raptor's, unchanged in shape) ---------- */

export function makeRunner(name) {
  let pass = 0
  const failures = []
  const shots = []
  fs.mkdirSync(OUT, { recursive: true })
  return {
    check(label, actual, expected) {
      if (Object.is(actual, expected)) { pass += 1; return }
      failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
    },
    ok(label, actual) { this.check(label, Boolean(actual), true) },
    fail(label, detail) { failures.push(`${label}${detail ? `\n    ${detail}` : ''}`) },
    async shot(page, file) {
      const p = path.join(OUT, `${file}.png`)
      try { await page.screenshot({ path: p, fullPage: true }); shots.push(p) } catch { /* page gone */ }
    },
    finish(note) {
      if (failures.length) {
        console.log(`\n${failures.length} FAILED in ${name}:\n`)
        for (const f of failures) console.log('  x ' + f + '\n')
      } else {
        console.log(`${pass} passed, 0 failed`)
        if (note) console.log(`\n${note}`)
      }
      if (shots.length) console.log(`\n${shots.length} screenshots in ${OUT}`)
      return failures.length === 0
    },
  }
}
