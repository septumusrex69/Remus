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
  const raw_engine = probe ? req.query.engine : body.engine
  const engine: Engine = raw_engine === 'claude' || raw_engine === 'combined' ? raw_engine : 'crawler'

  // A WEEK'S MEMORY (0021_price_cache.sql): the same search by anybody inside 7 days is free and instant.
  const key = cacheKey(engine, query, storeIds)
  if (caller) {
    const { data: hit } = await caller.db.from('price_cache').select('result, created_at').eq('key', key)
      .gte('created_at', new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString()).maybeSingle()
    if (hit) return res.status(200).json({ ...(hit.result as object), cached: true, searchedAt: hit.created_at })
  }

  const payload = await run(engine, query, storeIds)
  if ('error' in payload && payload.configured === false) return res.status(200).json(payload)

  if (caller) {
    // Counted on the credit tile (0019_ai_usage.sql). The build session's probe runs have no person to
    // write the row as, so they are not counted; they are few, and the Console shows them.
    if ('claude' in payload && payload.claude) {
      const c = payload.claude
      await recordUsage(caller.db, caller.user.id, {
        feature: 'find_prices', model: MODEL, inputTokens: c.usage.inputTokens, outputTokens: c.usage.outputTokens, searches: c.usage.searches, note: query,
      })
    }
    // Only an answer worth keeping is remembered: a Claude run that failed is not.
    if (!('claude' in payload) || !payload.claude?.error) {
      const { error } = await caller.db.from('price_cache').upsert({ key, query, engine, result: payload, created_at: new Date().toISOString(), created_by: caller.user.id })
      if (error) console.error('Could not remember the search:', error.message)
    }
  }
  return res.status(200).json({ ...payload, cached: false, searchedAt: new Date().toISOString() })
}

type Engine = 'crawler' | 'combined' | 'claude'
const CACHE_DAYS = 7

/** The way of searching, the words as anybody would type them, and the stores, in a fixed order. */
export function cacheKey(engine: Engine, query: string, storeIds: string[] | null): string {
  const words = query.toLowerCase().replace(/\s+/g, ' ').trim()
  return `${engine}|${words}|${(storeIds ?? []).slice().sort().join(',') || 'all'}`
}

async function run(engine: Engine, query: string, storeIds: string[] | null) {
  if (engine === 'crawler') return { query, results: await crawlAll(query, storeIds) }
  /*
   * CLAUDE, NOW THE CHEAP ONE (priceClaude.ts). Briefly switched off on 27 Oct at R7.34-R7.85 a search
   * ("7 Rand to find one item, that's ridiculous"); Stephan then: "No, don't remove Claude search ...
   * find a better alternative". It runs on Haiku, search results only, two searches at most.
   */
  if (!process.env.ANTHROPIC_API_KEY) return { query, configured: false as const, error: 'Claude is not set up for Remus yet.' }
  // Combined: what the crawler read is kept, and Claude is asked only about the rest.
  const results = engine === 'combined' ? await crawlAll(query, storeIds) : null
  const rest = results ? results.filter((r) => r.outcome !== 'ok').map((r) => r.store) : storeIds
  if (results && rest && rest.length === 0) return { query, results, claude: null }
  const claude = await claudeSearch(query, rest)
  return { query, claude, ...(results ? { results } : {}) }
}
