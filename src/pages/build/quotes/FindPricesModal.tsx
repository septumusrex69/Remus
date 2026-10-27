import { useState } from 'react'
import { Bot, ExternalLink, Loader2, Package, Search, Zap } from 'lucide-react'
import { Button, Modal } from '../../../components/ui'
import { formatZAR } from '../../../lib/format'
import { findPrices, PRICE_STORES, type PriceEngine, type PriceHit, type PriceSearch, type PriceSource } from '../../../lib/api'

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

export function FindPricesModal({ open, onClose, initialQuery, onPick }: {
  open: boolean
  onClose: () => void
  initialQuery: string
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

  async function search() {
    if (query.trim().length < 2) return
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await findPrices(query.trim(), engine, picked.length === PRICE_STORES.length ? null : picked))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const chosen = ENGINES.find((e) => e.id === engine)!
  const stores = result ? [...new Set([...result.hits.map((h) => h.store), ...result.stores.map((s) => s.store)])] : []

  return (
    <Modal open={open} onClose={onClose} title="Find prices" wide>
      <div className="space-y-4">
        {ENGINES.length === 1 ? (
          <p className="text-xs text-slate-500">Remus's own search, free. It reads the stores that let it in: Cashbuild today.</p>
        ) : (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-600">How to search</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="How to search">
            {ENGINES.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={engine === e.id} onClick={() => setEngine(e.id)} disabled={busy}
                className={`rounded-xl border p-3 text-left transition ${engine === e.id ? 'border-ink-950 bg-slate-50 ring-1 ring-ink-950' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><e.icon size={15} /> {e.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.id === 'crawler' ? 'bg-emerald-100 text-emerald-800' : e.id === 'combined' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{e.cost}</span>
                </span>
                <span className="mt-1 block text-xs text-slate-500">{e.hint}</span>
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5" aria-label="Stores">
          <span className="mr-1 text-xs font-semibold text-slate-600">Stores</span>
          {PRICE_STORES.map((st) => {
            const on = picked.includes(st.id)
            return (
              <button key={st.id} type="button" disabled={busy} aria-pressed={on}
                onClick={() => setPicked((p) => (on ? (p.length > 1 ? p.filter((x) => x !== st.id) : p) : [...p, st.id]))}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-ink-950 bg-ink-950 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                {st.name}
              </button>
            )
          })}
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <input className="input flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. close coupled toilet, galvanised pipe 20 mm" aria-label="What to look for" autoFocus />
          <Button type="submit" variant="primary" disabled={busy || query.trim().length < 2}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </Button>
        </form>

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
            {stores.map((store) => {
              const hits = result.hits.filter((h) => h.store === store)
              const notes = result.stores.filter((s) => s.store === store)
              return (
                <section key={store} className="rounded-xl border border-slate-200">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-800">{store}</span>
                    <span className="text-xs text-slate-500">{notes.map((n) => n.note).join(' ')}</span>
                  </header>
                  {hits.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-400">No prices from this store.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {hits.map((h, i) => (
                        <li key={i} className="flex items-center gap-3 px-4 py-2">
                          {h.image
                            ? <img src={h.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
                            // Claude reads search results, which carry no picture; say "no picture" rather than draw a hole.
                            : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-50 text-slate-300" title="No picture from this store"><Package size={18} /></span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-slate-800">{h.name}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              <span className={`rounded px-1.5 py-0.5 font-medium ${SOURCE_TONE[h.source]}`}>{SOURCE_LABEL[h.source]}</span>
                              {h.code && <span className="font-mono">#{h.code}</span>}
                              {h.note && <span>{h.note}</span>}
                              {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">View <ExternalLink size={11} /></a>}
                            </span>
                          </span>
                          <span className="tabular shrink-0 text-sm font-semibold text-slate-800">{h.price != null ? formatZAR(h.price) : 'No price'}</span>
                          <Button size="sm" variant="secondary" disabled={h.price == null}
                            onClick={() => { if (h.price != null) { onPick({ ...h, price: h.price }); onClose() } }}>
                            Use
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
            <p className="text-[11px] text-slate-400">Prices are the stores' online prices including VAT, and can differ in store. "Use" puts the price in the line's cost (your markup is added on top) and notes the store, product and code for the shopping list.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
