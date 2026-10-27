import { lazy, Suspense, useState } from 'react'
import { Loader2, MapPin, Plus, Store, Truck, X } from 'lucide-react'
import { Button, Card } from '../../../components/ui'
import { effectiveAreas, findNearby, type Nearby } from '../../../lib/api'
import type { ShopArea } from '../../../types'

const ShopMap = lazy(() => import('./ShopMap'))

/**
 * WHERE THIS QUOTE SHOPS (Remus · Handoff 1, 27 Oct 2026). Stephan: "where you're looking and what's
 * the radius ... unless you include delivery, because delivery can come from anywhere", and that it is
 * "quotation specific". Saved on the quote (0022: shop_areas, shop_online) with the rest of it.
 *
 * The first area is the SITE and follows the quote's site address unless another is typed. More areas
 * can be added -- around the yard, or the suburb where the store with the discount is. Find prices on
 * this quote searches the branches inside them, and the stores that deliver when the switch is on.
 */
const RADII = [2, 5, 10, 20, 50]

export function WhereToShopCard({ areas, online, siteAddress, onChange }: {
  areas: ShopArea[]
  online: boolean
  siteAddress: string | null
  onChange: (p: { shop_areas?: ShopArea[]; shop_online?: boolean }) => void
}) {
  const list: ShopArea[] = areas.length ? areas : [{ label: 'Site', address: '', radiusKm: 10 }]
  const [nearby, setNearby] = useState<Nearby | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (i: number, p: Partial<ShopArea>) => onChange({ shop_areas: list.map((a, j) => (j === i ? { ...a, ...p } : a)) })

  async function show() {
    setBusy(true); setError(null)
    try {
      const ask = effectiveAreas(list, siteAddress)
      if (!ask.length) { setError('Give the quote a site address, or type an address for an area.'); return }
      setNearby(await findNearby(ask))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const byStore = new Map<string, Nearby['branches']>()
  for (const b of nearby?.branches ?? []) byStore.set(b.storeName, [...(byStore.get(b.storeName) ?? []), b])

  return (
    <Card title={<span className="flex items-center gap-2"><MapPin size={17} /> Where to shop</span>} subtitle="Where Find prices looks for stores on this quote. Only you see this.">
      <div className="space-y-2">
        {list.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {i === 0 ? (
              <span className="w-24 text-sm font-medium text-slate-700">Site</span>
            ) : (
              <input className="input w-24 px-2 py-1.5 text-sm" value={a.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Area name" placeholder="e.g. Yard" />
            )}
            <input className="input min-w-[12rem] flex-1 px-2 py-1.5 text-sm" value={a.address}
              placeholder={i === 0 ? (siteAddress ? `The site address: ${siteAddress}` : 'The site address, e.g. 42 Mackenzie St, Brooklyn, Pretoria') : 'Address or suburb, e.g. Brooklyn, Pretoria'}
              onChange={(e) => set(i, { address: e.target.value })} aria-label={`${a.label || 'Area'} address`} />
            <select className="input w-auto px-2 py-1.5 text-sm" value={a.radiusKm} onChange={(e) => set(i, { radiusKm: Number(e.target.value) })} aria-label="Radius">
              {RADII.map((r) => <option key={r} value={r}>within {r} km</option>)}
            </select>
            {i > 0 && (
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Remove area"
                onClick={() => onChange({ shop_areas: list.filter((_, j) => j !== i) })}><X size={15} /></button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {list.length < 4 && (
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
              onClick={() => onChange({ shop_areas: [...list, { label: 'Area', address: '', radiusKm: 5 }] })}>
              <Plus size={14} /> Add an area
            </button>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={online} onChange={(e) => onChange({ shop_online: e.target.checked })} />
            <Truck size={15} className="text-slate-400" /> Include online stores (delivery)
          </label>
          <Button size="sm" className="ml-auto" onClick={() => void show()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />} Show stores on the map
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {nearby && (
          <div className="space-y-3 pt-2">
            {nearby.problems.map((p, i) => <p key={i} className="text-sm text-amber-700">{p}</p>)}
            <Suspense fallback={<div className="flex h-72 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">Loading the map…</div>}>
              <ShopMap centres={nearby.centres} branches={nearby.branches} />
            </Suspense>
            {byStore.size === 0 ? (
              <p className="text-sm text-slate-500">No branches of the six stores inside these areas{online ? ' — Find prices will still search them online, for delivery.' : '. Make an area larger, or include online stores.'}</p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {[...byStore.entries()].map(([store, bs]) => (
                  <li key={store} className="flex items-start gap-2 text-sm">
                    <Store size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <span><strong className="font-medium text-slate-800">{store}</strong> <span className="text-slate-500">· {bs[0].name}, {bs[0].distanceKm} km{bs.length > 1 ? ` (+${bs.length - 1} more)` : ''}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-400">Branches from OpenStreetMap, which can miss a store. Distances are straight-line.</p>
          </div>
        )}
      </div>
    </Card>
  )
}
