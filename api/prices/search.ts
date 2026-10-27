import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { BROWSER_HEADERS, STORES, crawlAll } from '../_lib/priceCrawl.js'

/**
 * FIND PRICES -- step one, Remus's own crawler (Remus · Handoff 1; the reasoning is in
 * api/_lib/priceCrawl.ts).
 *
 *   POST { query, stores? }  -> { query, results: StoreResult[] }   for a signed-in Remus user
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
  if (!probe) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
    const caller = await requireCaller(req)
    if (!caller) return res.status(401).json({ error: 'Sign in again.' })
  }

  const body = (req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {}) as { query?: unknown; stores?: unknown }
  const raw = probe ? req.query.q : body.query
  const query = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUERY) : ''
  if (query.length < 2) return res.status(400).json({ error: 'Say what to look for, e.g. "close coupled toilet".' })

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
  const results = await crawlAll(query, storeIds)
  return res.status(200).json({ query, results })
}
