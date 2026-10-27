import { useEffect, useState } from 'react'
import { MapPin, Pencil, Star, Store, Trash2 } from 'lucide-react'
import { myStores, placeAddress, PRICE_STORES } from '../../../lib/api'
import { Button, Card, ErrorBanner, Field } from '../../../components/ui'
import { AddressInput } from '../../../components/ui/AddressInput'
import type { MyStore } from '../../../types'

/**
 * MY STORES (Remus · Handoff 1, 27 Oct 2026). Stephan, of paying Google for the map: "Isn't there any
 * cheaper way to do this?" The branches that matter are the few Urban Haus already shops at -- the
 * Cashbuild down the road, the store with the discount -- so they are typed in ONCE, here. Their point
 * on the map is looked up when they are saved (free OpenStreetMap), and from then on every quote's map
 * and Find prices know them exactly, with no outside service in between (0023_my_stores.sql).
 *
 * A star marks a favourite: it leads its chain on every quote, and is shown even when it is outside
 * the quote's areas, because a discount can be worth the drive.
 */
const BLANK = { store: 'cashbuild', name: '', address: '', favourite: false, notes: '' }
const CHAINS: { id: string; name: string }[] = [...PRICE_STORES, { id: 'other', name: 'Another supplier' }]

export function MyStoresCard() {
  const [rows, setRows] = useState<MyStore[] | null>(null)
  const [draft, setDraft] = useState(BLANK)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => myStores.list().then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => { void load() }, [])

  async function save() {
    if (!draft.name.trim() || !draft.address.trim()) { setError('Give the store a name and an address.'); return }
    setSaving(true); setError(null)
    try {
      // The point is found once, now, so no quote ever has to look this store up again.
      const at = await placeAddress(draft.address.trim())
      const values = { store: draft.store, name: draft.name.trim(), address: draft.address.trim(), favourite: draft.favourite, notes: draft.notes.trim() || null, lat: at.lat, lon: at.lon }
      if (editing) await myStores.update(editing, values)
      else await myStores.create(values)
      setDraft(BLANK); setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(s: MyStore) {
    if (!confirm(`Take ${s.name} off your stores?`)) return
    try { await myStores.remove(s.id); await load() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  async function star(s: MyStore) {
    try { await myStores.update(s.id, { favourite: !s.favourite }); await load() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const chainName = (id: string) => CHAINS.find((c) => c.id === id)?.name ?? id

  return (
    <Card title={<span className="flex items-center gap-2"><Store size={17} /> My stores</span>}
      subtitle="The branches Urban Haus shops at. Entered once; every quote's map and Find prices then know them. Free.">
      <div className="space-y-4">
        <ErrorBanner error={error} />
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                <button type="button" onClick={() => void star(s)} aria-label={s.favourite ? 'Not a favourite' : 'Make a favourite'} title="Favourite"
                  className={`mt-0.5 ${s.favourite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}>
                  <Star size={16} fill={s.favourite ? 'currentColor' : 'none'} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{s.name} <span className="font-normal text-slate-400">· {chainName(s.store)}</span></p>
                  <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} /> {s.address}{s.lat == null && <span className="text-amber-700"> · not on the map yet: edit and save it again</span>}</p>
                  {s.notes && <p className="text-xs text-slate-500">{s.notes}</p>}
                </div>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit"
                  onClick={() => { setEditing(s.id); setDraft({ store: s.store, name: s.name, address: s.address ?? '', favourite: s.favourite, notes: s.notes ?? '' }) }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Remove" onClick={() => void remove(s)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length === 0 && <p className="text-sm text-slate-500">No stores yet. Add the ones you use most: the nearest Cashbuild, the store where you get a discount.</p>}

        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">{editing ? 'Change this store' : 'Add a store'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Store">
              <select className="input" value={draft.store} onChange={(e) => setDraft({ ...draft, store: e.target.value })}>
                {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Branch name">
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cashbuild Silvertondale" />
            </Field>
          </div>
          <Field label="Address" hint="Start typing and pick the address from the list.">
            <AddressInput value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} placeholder="e.g. 12 Hans Strijdom Dr, Silvertondale, Pretoria" ariaLabel="Store address" />
          </Field>
          <Field label="Notes">
            <input className="input" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. 10% trade discount, account no. 4471" />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={draft.favourite} onChange={(e) => setDraft({ ...draft, favourite: e.target.checked })} />
            Favourite: always show it, even when it is outside a quote's area
          </label>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()} loading={saving}>{editing ? 'Save changes' : 'Add store'}</Button>
            {editing && <Button onClick={() => { setEditing(null); setDraft(BLANK) }}>Cancel</Button>}
          </div>
        </div>
      </div>
    </Card>
  )
}
