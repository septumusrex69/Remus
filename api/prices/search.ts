import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { BROWSER_HEADERS, STORES, crawlAll } from '../_lib/priceCrawl.js'
import { claudeSearch, MODEL } from '../_lib/priceClaude.js'
import { recordUsage } from '../_lib/aiUsage.js'

/**
 * FIND PRICES -- step one, Remus's own crawler (Remus · Handoff 1; the reasoning is in
 * api/_lib/priceCrawl.ts).
 *
 *   POST { query, stores?, engine? } -> for a signed-in Remus user. engine 'crawler' (the default):
 *       { query, results: StoreResult[] }; engine 'claude': { query, claude: ClaudeRun } (priceClaude.ts);
 *       engine 'combined': { query, results, claude } -- the crawler first, then Claude for ONLY the
 *       stores the crawler could not read. Stephan, 27 Oct: three choices, "the cheapest one, and then
 *       the other ones, which are less cheap, and then the most expensive one would be Claude".
 *   GET  ?q=toilet&key=...   -> the same, for the build session testing it on the preview
 *   GET  ?q=toilet&key=...&raw=builders -> what that store sent back, cut short, so its reader can
 *                                          be written against the real page rather than a guess
 *
 * The test key is PRICE_PROBE_KEY, set on PREVIEW deployments only: it lets a Claude session that
 * cannot sign in to Remus see what each store sends Remus's server. It reads public store pages and
 * nothing of Urban Haus's, and live Remus has no key, so there it answers only to a signed-in person.
 */

const MAX_QUERY = 80

function probeOk(req: VercelRequest): boolean {
  const key = process.env.PRICE_PROBE_KEY
  const given = typeof req.query.key === 'string' ? req.query.key : req.headers['x-probe-key']
  return !!key && key.length >= 16 && given === key
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const probe = req.method === 'GET' && probeOk(req)
  const caller = probe ? null : await requireCaller(req)
  if (!probe) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
    if (!caller) return res.status(401).json({ error: 'Sign in again.' })
  }

  const body = (req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {}) as { query?: unknown; stores?: unknown; engine?: unknown }
  const raw = probe ? req.query.q : body.query
  const query = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUERY) : ''
  if (query.length < 2) return res.status(400).json({ error: 'Say what to look for, e.g. "close coupled toilet".' })

  /*
   * LOOK INSIDE A STORE'S OWN FILES (probe only): `url` on one of the stores' hosts or a service their
   * pages name, and `find` -- the places it appears, a few hundred characters around each. This is
   * how a shop front drawn by script gives up where its products come from.
   */
  if (probe && typeof req.query.url === 'string') {
    let target: URL
    try { target = new URL(req.query.url) } catch { return res.status(400).json({ error: 'Not an address.' }) }
    const hosts = [...STORES.map((s) => new URL(s.searchUrl('x')).hostname), 'api.esolve.co.za']
    if (!hosts.includes(target.hostname)) return res.status(400).json({ error: 'Only the stores themselves.', hosts })
    try {
      const r = await fetch(target, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12_000) })
      const text = await r.text()
      const find = typeof req.query.find === 'string' ? req.query.find : ''
      const hits: string[] = []
      if (find) {
        let at = text.indexOf(find)
        while (at >= 0 && hits.length < 12) {
          hits.push(text.slice(Math.max(0, at - 250), at + 350))
          at = text.indexOf(find, at + find.length)
        }
      }
      return res.status(200).json({ status: r.status, type: r.headers.get('content-type'), bytes: text.length, hits, start: find ? undefined : text.slice(0, 4000) })
    } catch (e) {
      return res.status(200).json({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  if (probe && typeof req.query.raw === 'string') {
    const store = STORES.find((s) => s.id === req.query.raw)
    if (!store) return res.status(400).json({ error: `No store ${req.query.raw}.`, stores: STORES.map((s) => s.id) })
    try {
      const r = await fetch(store.searchUrl(query), { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12_000) })
      const html = await r.text()
      const scripts = [...html.matchAll(/<script([^>]*)>/gi)].map((m) => m[1].trim()).filter(Boolean).slice(0, 40)
      const at = Math.max(0, html.search(/R\s?\d[\d\s,]*[.,]\d{2}/))
      return res.status(200).json({
        status: r.status, finalUrl: r.url, bytes: html.length, headers: Object.fromEntries([...r.headers].filter(([k]) => !/cookie/i.test(k))),
        scripts, firstPriceAt: at, aroundFirstPrice: html.slice(Math.max(0, at - 1500), at + 1500), head: html.slice(0, 3000),
      })
    } catch (e) {
      return res.status(200).json({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  const storeIds = Array.isArray(body.stores) ? body.stores.filter((s): s is string => typeof s === 'string')
    : typeof req.query.stores === 'string' ? req.query.stores.split(',') : null
  const engine = probe ? req.query.engine : body.engine
  if (engine === 'claude' || engine === 'combined') {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ query, configured: false, error: 'Claude is not set up for Remus yet.' })
    // Combined: what the crawler read is kept, and Claude is asked only about the rest.
    const results = engine === 'combined' ? await crawlAll(query, storeIds) : null
    const rest = results ? results.filter((r) => r.outcome !== 'ok').map((r) => r.store) : storeIds
    if (results && rest && rest.length === 0) return res.status(200).json({ query, results, claude: null })
    const claude = await claudeSearch(query, rest)
    // Counted on the credit tile (0019_ai_usage.sql). The build session's probe runs have no person to
    // write the row as, so they are not counted; they are few, and the Console shows them.
    if (caller) {
      await recordUsage(caller.db, caller.user.id, {
        feature: 'find_prices', model: MODEL, inputTokens: claude.usage.inputTokens, outputTokens: claude.usage.outputTokens,
        searches: claude.usage.searches, note: query,
      })
    }
    return res.status(200).json({ query, claude, ...(results ? { results } : {}) })
  }
  const results = await crawlAll(query, storeIds)
  return res.status(200).json({ query, results })
}
