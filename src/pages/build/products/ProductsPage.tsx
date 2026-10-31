import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleCheck, Minus, OctagonAlert, Package, Plus, Search, Star, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { productsApi, productUses, projects as projectsApi } from '../../../lib/api'
import { VERDICT_WORD, type Product, type ProductUse, type Verdict } from '../../../lib/products'
import { formatDate, formatZAR, todayYmd } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '../../../components/ui'
import { NumInput } from '../../../components/ui/NumInput'
import { DictateButton } from '../../../components/ui/Dictate'
import { ProjectSelect } from '../components/ProjectSelect'

/**
 * THE PRODUCTS BOOK (Remus · Handover 6, lib/products.ts, migration 0034). Stephan's paint stripper: two bought and
 * used for a week, then two more "far superior". Every product the team has used, its verdict -- Preferred, Fine or
 * Avoid -- a rating, what it is good for, a note ("shit product, don't buy this"), where it came from and what it
 * cost, and each job it was used on. Quotes, Find prices and Snap slip read it to warn and to suggest.
 */
type Shelf = 'all' | Verdict

const VERDICT_STYLE: Record<Verdict, string> = {
  preferred: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  ok: 'bg-slate-100 text-slate-600 ring-slate-200',
  avoid: 'bg-red-50 text-red-700 ring-red-200',
}

async function load() {
  const [products, uses, projects] = await Promise.all([productsApi.list(), productUses.list().catch(() => []), projectsApi.list().catch(() => [])])
  return { products, uses, projects }
}

export function ProductsPage() {
  const { data, error, loading, reload } = useLoad(load, [], 'products-page')
  const [params, setParams] = useSearchParams()
  const [shelf, setShelf] = useState<Shelf>('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const canWrite = useAccess() !== 'read_only'

  // A warning or suggestion elsewhere links here with ?p=<id>: open that product.
  useEffect(() => {
    const id = params.get('p')
    if (!id || !data) return
    const p = data.products.find((x) => x.id === id)
    if (p) setEditing(p)
    setParams((ps) => { ps.delete('p'); return ps }, { replace: true })
  }, [params, data, setParams])

  const groups = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    const shown = data.products
      .filter((p) => shelf === 'all' || p.verdict === shelf)
      .filter((p) => !needle || [p.name, p.brand, p.category, p.use_for, p.note, p.store].some((x) => x?.toLowerCase().includes(needle)))
    const by = new Map<string, Product[]>()
    for (const p of shown) {
      const k = p.category?.trim() || 'Other'
      by.set(k, [...(by.get(k) ?? []), p])
    }
    const rank: Record<Verdict, number> = { preferred: 0, ok: 1, avoid: 2 }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, ps]) => ({ k, ps: ps.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.rating ?? 0) - (a.rating ?? 0)) }))
  }, [data, shelf, q])

  if (loading && !data) return <Spinner page />
  if (!data) return <ErrorBanner error={error} />
  const count = (v: Shelf) => (v === 'all' ? data.products.length : data.products.filter((p) => p.verdict === v).length)
  const usesOf = (id: string) => data.uses.filter((u) => u.product_id === id)

  return (
    <div className="space-y-4">
      <PageHeader title="Products" subtitle="What we buy, what we prefer, and what never to buy again. Quotes, Find prices and Snap slip warn and suggest from here."
        actions={canWrite ? <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Add a product</Button> : undefined} />
      <ErrorBanner error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'preferred', 'ok', 'avoid'] as Shelf[]).map((s) => (
          <button key={s} type="button" onClick={() => setShelf(s)} aria-pressed={shelf === s}
            className={clsx('rounded-full px-3 py-1 text-xs font-medium', shelf === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>
            {s === 'all' ? 'All' : VERDICT_WORD[s]} <span className="opacity-60">{count(s)}</span>
          </button>
        ))}
        <span className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" placeholder="Search the book" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>

      {groups.length === 0 ? (
        <Card><EmptyState title={data.products.length ? 'Nothing matches' : 'No products yet'} icon={<Package size={30} />}>
          {data.products.length ? 'Try another word or shelf.' : 'Add the products you use, or add them from a slip on Snap slip. Mark the good ones Preferred and the bad ones Avoid.'}
        </EmptyState></Card>
      ) : groups.map((g) => (
        <section key={g.k}>
          <p className="skin-eyebrow mb-2 text-[11px] font-semibold text-slate-500">{g.k}</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.ps.map((p) => {
              const used = usesOf(p.id)
              const last = used[0]
              const job = last?.project_id ? data.projects.find((x) => x.id === last.project_id) : null
              return (
                <button key={p.id} type="button" onClick={() => setEditing(p)} className="card block p-4 text-left transition hover:border-slate-300" data-testid="product-card">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900">{p.name}</span>
                      {p.brand && <span className="block truncate text-xs text-slate-500">{p.brand}</span>}
                    </span>
                    <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1', VERDICT_STYLE[p.verdict])}>
                      {p.verdict === 'preferred' ? <CircleCheck size={12} /> : p.verdict === 'avoid' ? <OctagonAlert size={12} /> : <Minus size={12} />} {VERDICT_WORD[p.verdict]}
                    </span>
                  </span>
                  {p.rating != null && <Stars value={p.rating} className="mt-1.5" />}
                  {p.use_for && <span className="mt-1.5 block text-xs text-slate-600">For: {p.use_for}</span>}
                  {p.note && <span className="mt-1 block text-xs italic text-slate-600">“{p.note}”</span>}
                  <span className="mt-2 block text-[11px] text-slate-500">
                    {[p.last_price != null ? formatZAR(p.last_price) : null, p.store, used.length ? `used ${used.length}×` : null, job ? `last on ${job.name}` : last ? `last ${formatDate(last.used_on, 'd MMM')}` : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {editing && (
        <ProductForm product={editing === 'new' ? null : editing} uses={editing === 'new' ? [] : usesOf(editing.id)} projects={data.projects}
          categories={[...new Set(data.products.map((p) => p.category).filter((c): c is string => !!c))]} canWrite={canWrite}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}

function Stars({ value, onChange, className }: { value: number | null; onChange?: (n: number | null) => void; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-0.5', className)} aria-label={value ? `${value} of 5` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(value === n ? null : n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={clsx(onChange ? 'p-0.5' : 'pointer-events-none')}>
          <Star size={onChange ? 18 : 13} className={n <= (value ?? 0) ? 'fill-current text-slate-800' : 'text-slate-300'} />
        </button>
      ))}
    </span>
  )
}

/** Add or change a product, its verdict and note; see and add the jobs it was used on. */
export function ProductForm({ product, uses, projects, categories, canWrite, onClose, onSaved, preset }: {
  product: Product | null
  uses: ProductUse[]
  projects: { id: string; name: string; code: string | null; status: string }[]
  categories: string[]
  canWrite: boolean
  onClose: () => void
  onSaved: (p: Product) => void
  /** A new product started from somewhere else (a slip line): its name, price and store filled in. */
  preset?: Partial<Product> & { project_id?: string | null; expense_id?: string | null }
}) {
  const [f, setF] = useState<Partial<Product>>(() => product ?? { verdict: 'ok', ...preset })
  const [use, setUse] = useState<{ project_id: string | null; used_on: string; price: number | null; note: string }>({ project_id: preset?.project_id ?? null, used_on: todayYmd(), price: preset?.last_price ?? null, note: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Product>(k: K, v: Product[K] | null) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    if (!f.name?.trim()) { setError('Give the product a name.'); return }
    setSaving(true); setError(null)
    try {
      const values = {
        name: f.name.trim(), brand: f.brand?.trim() || null, category: f.category?.trim() || null, use_for: f.use_for?.trim() || null,
        unit: f.unit?.trim() || null, store: f.store?.trim() || null, product_code: f.product_code?.trim() || null, product_url: f.product_url?.trim() || null,
        last_price: f.last_price ?? null, verdict: (f.verdict ?? 'ok') as Verdict, rating: f.rating ?? null, note: f.note?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      const saved = product ? await productsApi.update(product.id, values) : await productsApi.create(values)
      // A new product from a slip, or a use typed here: one line of history.
      if ((!product && (preset?.project_id || preset?.expense_id)) || use.note.trim() || (product && use.project_id)) {
        await productUses.create({ product_id: saved.id, project_id: use.project_id, expense_id: preset?.expense_id ?? null, used_on: use.used_on, price: use.price, note: use.note.trim() || null })
      }
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setSaving(false)
    }
  }

  async function remove() {
    if (!product || !window.confirm(`Take ${product.name} out of the book? Its history goes with it.`)) return
    setSaving(true)
    try { await productsApi.remove(product.id); onSaved(product) } catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} wide title={product ? product.name : 'Add a product'}
      footer={canWrite ? <>
        {product && <Button variant="ghost" className="mr-auto text-red-700" onClick={remove}><Trash2 size={14} /> Remove</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} data-testid="product-save">Save</Button>
      </> : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product" className="sm:col-span-2"><input className="input" value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Industrial Paint Stripper 5L" autoFocus={!product} /></Field>
        <Field label="Brand"><input className="input" value={f.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label="Kind of product">
          <input className="input" list="product-categories" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="Paint stripper, Cement, Tile adhesive…" />
          <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Our verdict</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {(['preferred', 'ok', 'avoid'] as Verdict[]).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={(f.verdict ?? 'ok') === v} onClick={() => set('verdict', v)} data-testid={`verdict-${v}`}
                className={clsx('flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
                  (f.verdict ?? 'ok') === v ? clsx('ring-2', VERDICT_STYLE[v], 'border-transparent') : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {v === 'preferred' ? <CircleCheck size={15} /> : v === 'avoid' ? <OctagonAlert size={15} /> : <Minus size={15} />}
                {v === 'preferred' ? 'Preferred: use this' : v === 'avoid' ? 'Avoid: never again' : 'Fine'}
              </button>
            ))}
          </div>
        </div>
        <Field label="Rating"><Stars value={f.rating ?? null} onChange={(n) => set('rating', n)} /></Field>
        <Field label="Good for"><input className="input" value={f.use_for ?? ''} onChange={(e) => set('use_for', e.target.value)} placeholder="stripping paint off floors" /></Field>
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between"><span className="label mb-0">Note (typed or said)</span><DictateButton size="small" value={f.note ?? ''} onChange={(v) => set('note', v)} /></div>
          <textarea className="input min-h-16" value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Took three coats and still left paint in the grain. Don't buy." />
        </div>
        <Field label="Bought at"><input className="input" value={f.store ?? ''} onChange={(e) => set('store', e.target.value)} placeholder="Cashbuild Silvertondale" /></Field>
        <Field label="Last price (incl. VAT)"><NumInput allowEmpty prefix="R" value={f.last_price ?? null} onValue={(n) => set('last_price', n)} /></Field>
        <Field label="Store's product code"><input className="input font-mono text-sm" value={f.product_code ?? ''} onChange={(e) => set('product_code', e.target.value)} /></Field>
        <Field label="Link"><input className="input" value={f.product_url ?? ''} onChange={(e) => set('product_url', e.target.value)} placeholder="https://" /></Field>
      </div>

      <div className="mt-5">
        <p className="label">Used on</p>
        {uses.length > 0 && (
          <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {uses.map((u) => (
              <li key={u.id} className="px-3 py-2">
                <span className="font-medium text-slate-800">{projects.find((x) => x.id === u.project_id)?.name ?? 'No job'}</span>
                <span className="text-slate-500"> · {formatDate(u.used_on, 'd MMM yyyy')}{u.price != null ? ` · ${formatZAR(u.price)}` : ''}</span>
                {u.note && <span className="block text-xs italic text-slate-600">“{u.note}”</span>}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_9rem_8rem]">
            <ProjectSelect projects={projects as never} value={use.project_id} onChange={(v) => setUse((x) => ({ ...x, project_id: v }))} />
            <input type="date" className="input" value={use.used_on} onChange={(e) => setUse((x) => ({ ...x, used_on: e.target.value }))} />
            <NumInput allowEmpty prefix="R" value={use.price} onValue={(n) => setUse((x) => ({ ...x, price: n }))} />
            <input className="input sm:col-span-3" value={use.note} onChange={(e) => setUse((x) => ({ ...x, note: e.target.value }))} placeholder="How it went on this job (saved with Save)" />
          </div>
        )}
      </div>
    </Modal>
  )
}
