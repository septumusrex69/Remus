import { useEffect, useRef, useState } from 'react'
import { Bot, ExternalLink, Loader2, Package, Search, Zap } from 'lucide-react'
import { Button, Modal } from '../../../components/ui'
import { formatZAR } from '../../../lib/format'
import { effectiveAreas, findNearby, findPrices, PRICE_STORES, type NearbyBranch, type PriceEngine, type PriceHit, type PriceSearch, type PriceSource } from '../../../lib/api'
import type { ShopArea } from '../../../types'

/**
 * FIND PRICES on a quote line (Remus · Handoff 1, 27 Oct 2026). Stephan: "I can't find it on the line
 * items on creating a quotation" -- the search existed only on the server; this is where it is used.
 *
 * THREE CHOICES, CHEAPEST FIRST, AND EACH SAYS WHAT IT IS: "we should be clearly just differentiating
 * between what are we using" (lib/api.ts, findPrices). Every result carries a tag naming what found it,
 * Remus's crawler or Claude, and the run says what it cost, so the comparison is on the screen.
 *
 * Picking a price puts it in the line's COST, never its price: the markup still applies on top.
 */

const ALL_ENGINES: { id: PriceEngine; label: string; cost: string; hint: string; icon: typeof Zap }[] = [
  { id: 'crawler', label: 'Quick', cost: 'Free', hint: "Remus's own search. A few seconds. Only the stores that let it in (Cashbuild today).", icon: Zap },
  { id: 'combined', label: 'Combined', cost: 'Cents', hint: 'Quick first, then Claude only for the stores Quick could not read.', icon: Search },
  { id: 'claude', label: 'Claude', cost: 'Cents', hint: 'Claude searches every chosen store from its search results.', icon: Bot },
]
/*
 * ALL THREE, CLAUDE NOW THE CHEAP ONE (27 Oct). Switched off at R7 a search, then back on at Stephan's
 * word ("don't remove Claude search ... find a better alternative"): Haiku, search results only, two
 * searches at most, and a week's memory -- the same search again is free (api/prices/search.ts).
 */
const ENGINES = ALL_ENGINES

const SOURCE_LABEL: Record<PriceSource, string> = { crawler: 'Remus search', claude: 'Claude' }
const SOURCE_TONE: Record<PriceSource, string> = { crawler: 'bg-emerald-50 text-emerald-700', claude: 'bg-brand-100 text-brand-800' }

export function FindPricesModal({ open, onClose, initialQuery, onPick, areas = [], online = true, siteAddress = null }: {
  open: boolean
  onClose: () => void
  initialQuery: string
  /** Where this quote shops (WhereToShopCard, 0022): the stores with a branch inside are ticked. */
  areas?: ShopArea[]
  online?: boolean
  siteAddress?: string | null
  /** The product chosen: its price becomes the line's cost, the rest its "buy at" (store, code, page). */
  onPick: (hit: PriceHit & { price: number }) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [engine, setEngine] = useState<PriceEngine>('crawler')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PriceSearch | null>(null)
  // Which stores to ask. All by default; fewer stores is a quicker, cheaper Claude search.
  const [picked, setPicked] = useState<string[]>(PRICE_STORES.map((s) => s.id))
  /*
   * THE QUOTE'S AREAS DECIDE THE STORES (Stephan: "where you're looking and what's the radius").
   * The nearest branch of each store inside them is found once, on opening; a store with one is
   * ticked, and with "include online stores" on the others stay ticked too, marked for delivery.
   */
  const [nearest, setNearest] = useState<Map<string, NearbyBranch> | null>(null)
  useEffect(() => {
    const ask = effectiveAreas(areas, siteAddress)
    if (!ask.length) return
    let live = true
    findNearby(ask).then((n) => {
      if (!live) return
      const m = new Map<string, NearbyBranch>()
      // My stores beyond every area are not "in reach"; inside, they lead their chain (server order).
      for (const b of n.branches) if (!b.outside && !m.has(b.store)) m.set(b.store, b)
      setNearest(m)
      const inReach = PRICE_STORES.map((s) => s.id).filter((id) => m.has(id))
      if (!online && inReach.length) setPicked(inReach)
    }).catch(() => { /* the map is a help, not a gate: all stores stay ticked */ })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const reach = (id: string) => (nearest?.get(id) ? `${nearest.get(id)!.distanceKm} km` : nearest ? 'online' : null)

  /*
   * ON A PHONE (Stephan, 28 Oct: "you can't search for an item on the phone app"). The window was the
   * desktop's laid out top to bottom -- three engine cards, six store chips, THEN the search box -- so
   * on a phone the box sat at the bottom of the sheet and the results arrived below the edge of the
   * screen, under the keyboard: pressing Search looked like nothing happened. Now the box is first,
   * the choices are one short row each, and the results are scrolled to (and the keyboard put away).
   */
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!result && !error) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result, error])

  async function search(how: PriceEngine = engine) {
    if (query.trim().length < 2) return
    setEngine(how)
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await findPrices(query.trim(), how, picked.length === PRICE_STORES.length ? null : picked))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const chosen = ENGINES.find((e) => e.id === engine)!
  const stores = result ? [...new Set([...result.hits.map((h) => h.store), ...result.stores.map((s) => s.store)])] : []
  /*
   * ON A DESKTOP (Stephan, 28 Oct: "it's not completely user-friendly"). A store with nothing to show
   * was a whole empty box saying so -- five of them under Cashbuild's four prices. They are one short
   * list at the end now, with the reason each gave, and one press to ask Claude about just those.
   */
  const withPrices = stores.filter((st) => result?.hits.some((h) => h.store === st))
  const without = stores.filter((st) => !withPrices.includes(st))
  const nearestOf = (store: string) => {
    const id = PRICE_STORES.find((s) => s.name === store)?.id
    return id ? nearest?.get(id) : undefined
  }

  return (
    <Modal open={open} onClose={onClose} title="Find prices" wide>
      <div className="space-y-4">
        {/* The box stays at the top while the results scroll under it, so the words can be changed. */}
        <form className="sticky -top-4 z-10 -mx-5 -mt-4 flex gap-2 border-b border-slate-100 bg-white px-5 pt-4 pb-3" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <input className="input min-w-0 flex-1" type="search" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. close coupled toilet" aria-label="What to look for" autoFocus />
          <Button type="submit" variant="primary" disabled={busy || query.trim().length < 2}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </Button>
        </form>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-600">How to search</p>
          {/* One row of three on every screen; the explanation only where there is room for it. */}
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How to search">
            {ENGINES.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={engine === e.id} onClick={() => setEngine(e.id)} disabled={busy} title={e.hint}
                className={`rounded-xl border p-2 text-left transition sm:p-3 ${engine === e.id ? 'border-ink-950 bg-slate-50 ring-1 ring-ink-950' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex flex-wrap items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><e.icon size={15} className="hidden sm:block" /> {e.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-[11px] ${e.id === 'crawler' ? 'bg-emerald-100 text-emerald-800' : e.id === 'combined' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{e.cost}</span>
                </span>
                <span className="mt-1 hidden text-xs text-slate-500 sm:block">{e.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 sm:hidden">{chosen.hint}</p>
        </div>

        {/* On a phone the stores are one row that slides sideways, not three rows pushing the results down. */}
        <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Stores <span className="font-normal text-slate-400">· tap one to leave it out</span></p>
        <div className="-mx-5 flex items-center gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="Stores">
          {PRICE_STORES.map((st) => {
            const on = picked.includes(st.id)
            return (
              <button key={st.id} type="button" disabled={busy} aria-pressed={on}
                onClick={() => setPicked((p) => (on ? (p.length > 1 ? p.filter((x) => x !== st.id) : p) : [...p, st.id]))}
                className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${on ? 'border-ink-950 bg-ink-950 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                {st.name}{reach(st.id) && <span className={`ml-1 ${on ? 'text-white/70' : 'text-slate-400'}`}>· {reach(st.id)}</span>}
              </button>
            )
          })}
        </div>

        </div>

        <div ref={resultsRef} className="scroll-mt-16" />
        {busy && (
          <p className="text-sm text-slate-500">
            {engine === 'crawler' ? 'Searching the stores…' : `Searching with ${chosen.label === 'Claude' ? 'Claude' : 'Quick, then Claude'}. This can take a minute…`}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {result && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              <strong className="font-medium text-slate-700">{chosen.label}</strong> · {(result.ms / 1000).toFixed(1)} s ·{' '}
              {result.cached
                ? `remembered from ${result.searchedAt ? new Date(result.searchedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : 'this week'} (free)`
                : result.zar > 0 ? `this search cost about ${formatZAR(result.zar)}` : 'free'}
              {result.error ? ` · ${result.error}` : ''}
            </p>
            {withPrices.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                No prices found for "{query.trim()}". Try fewer or plainer words (e.g. "toilet" rather than a model name){engine === 'crawler' ? ', or search with Combined below' : ''}.
              </p>
            )}
            {withPrices.map((store) => {
              const hits = result.hits.filter((h) => h.store === store)
              const notes = result.stores.filter((s) => s.store === store)
              return (
                <section key={store} className="rounded-xl border border-slate-200">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {store}
                      {(() => {
                        const b = nearestOf(store)
                        return b
                          ? <span className="ml-2 text-xs font-normal text-slate-500">nearest: {b.name}{b.mine ? ' (yours)' : ''}, {b.distanceKm} km</span>
                          : nearest ? <span className="ml-2 text-xs font-normal text-slate-400">no branch in your areas · online / delivery</span> : null
                      })()}
                    </span>
                    <span className="text-xs text-slate-500">{notes.map((n) => n.note).join(' ')}</span>
                  </header>
                  <ul className="divide-y divide-slate-100">
                      {hits.map((h, i) => (
                        <li key={i} className="flex items-center gap-3 px-3 py-2 sm:px-4">
                          {h.image
                            ? <img src={h.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
                            // Claude reads search results, which carry no picture; say "no picture" rather than draw a hole.
                            : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-50 text-slate-300" title="No picture from this store"><Package size={18} /></span>}
                          <span className="min-w-0 flex-1">
                            {/* Two lines on a phone: "Toilet suite clos..." does not say which toilet. */}
                            <span className="line-clamp-2 block text-sm text-slate-800 sm:truncate">{h.name}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              <span className={`rounded px-1.5 py-0.5 font-medium ${SOURCE_TONE[h.source]}`}>{SOURCE_LABEL[h.source]}</span>
                              {h.code && <span className="font-mono">#{h.code}</span>}
                              {h.note && <span>{h.note}</span>}
                              {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">View <ExternalLink size={11} /></a>}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                            <span className="tabular text-sm font-semibold text-slate-800">{h.price != null ? formatZAR(h.price) : 'No price'}</span>
                            <Button size="sm" variant="secondary" disabled={h.price == null}
                              onClick={() => { if (h.price != null) { onPick({ ...h, price: h.price }); onClose() } }}>
                              Use
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                </section>
              )
            })}
            {without.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm">
                <p className="font-medium text-slate-600">No prices from {without.length === 1 ? 'this store' : `these ${without.length} stores`}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                  {without.map((st) => {
                    const b = nearestOf(st)
                    return (
                      <li key={st}>
                        <strong className="font-medium text-slate-700">{st}</strong>
                        {b && <span> (nearest {b.distanceKm} km)</span>}
                        {': '}{result.stores.filter((n) => n.store === st).map((n) => n.note).join(' ') || 'nothing matched.'}
                      </li>
                    )
                  })}
                </ul>
                {engine === 'crawler' && (
                  <Button size="sm" className="mt-2" disabled={busy} onClick={() => void search('combined')}>
                    <Search size={14} /> Ask Claude about these too (Combined, a few cents)
                  </Button>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400">Prices are the stores' online prices including VAT, and can differ in store. "Use" puts the price in the line's cost (your markup is added on top) and notes the store, product and code for the shopping list.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
