import { Copy, ExternalLink, Printer, Share2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Modal } from '../../../components/ui'
import { formatDate, formatZAR, round2 } from '../../../lib/format'
import { NO_STORE, shoppingGroups, shoppingText, type ShoppingItem } from '../../../lib/shoppingList'

/**
 * THE SHOPPING LIST (Remus · Handoff 1, 27 Oct 2026). Stephan: "give me a shopping list, where to go
 * shopping for what, the code ... the particulars of the product."
 *
 * The quote's material lines, grouped by the store each is bought at (migration 0020's buy_*), with the
 * store's code, the product as the store names it, how many, the store price and its link. A line with
 * no store yet is listed under "Store not chosen yet" rather than left off -- a list that silently
 * skips the toilet is how the toilet is forgotten.
 *
 * The quantity is the line's own (its unit as quoted). The money is the STORE price, not the quote's
 * cost: this is what to expect at the till.
 */
export function ShoppingListModal({ open, onClose, title, lines }: { open: boolean; onClose: () => void; title: string; lines: ShoppingItem[] }) {
  const groups = shoppingGroups(lines)
  const [copied, setCopied] = useState(false)
  const text = shoppingText(title, groups)
  const grand = round2(groups.reduce((t, g) => t + g.total, 0))

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* the text is on screen to copy by hand */ }
  }
  async function share() {
    // The phone's share sheet: WhatsApp, Notes, Mail. Closing it is not a failure.
    try { await navigator.share({ title: `Shopping list: ${title}`, text }) } catch { /* cancelled */ }
  }
  function print() {
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Shopping list</title><style>body{font:13px system-ui,sans-serif;margin:24px}h1{font-size:18px}h2{font-size:14px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}td.n{text-align:right}</style>
      <h1>Shopping list: ${esc(title)}</h1>${groups.map((g) => `<h2>${esc(g.store)}${g.total ? ` &middot; about ${esc(formatZAR(g.total))}` : ''}</h2><table><tr><th>Qty</th><th>Product</th><th>Code</th><th>Price</th></tr>${g.items.map((l) => `<tr><td>${Number(l.quantity)} ${esc(l.unit)}</td><td>${esc(l.buy_product || l.description)}</td><td>${esc(l.buy_code ?? '')}</td><td class="n">${l.buy_price != null ? esc(formatZAR(l.buy_price)) : ''}</td></tr>`).join('')}</table>`).join('')}`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Shopping list: ${title}`} wide
      footer={<>
        <Button onClick={() => void copy()}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button>
        {typeof navigator.share === 'function' && <Button onClick={() => void share()}><Share2 size={14} /> Share</Button>}
        <Button onClick={print}><Printer size={14} /> Print</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      {groups.length === 0 ? (
        <p className="text-sm text-slate-500">No material lines on this quote yet.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            The quote's materials, by store. Set a line's store with 🔍 Find prices, or "Where to buy" in its ⋯ menu.
            {grand > 0 && <> About <strong className="text-slate-700">{formatZAR(grand)}</strong> at the stores' prices.</>}
          </p>
          {groups.map((g) => (
            <section key={g.store} className="rounded-xl border border-slate-200">
              <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                <span className={`text-sm font-semibold ${g.store === NO_STORE ? 'text-amber-700' : 'text-slate-800'}`}>{g.store}</span>
                {g.total > 0 && <span className="tabular text-sm text-slate-600">about {formatZAR(g.total)}</span>}
              </header>
              <ul className="divide-y divide-slate-100">
                {g.items.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                    <span className="tabular w-16 shrink-0 text-slate-500">{Number(l.quantity)} {l.unit}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-800">{l.buy_product || l.description}</span>
                      {l.buy_product && l.buy_product !== l.description && <span className="block text-xs text-slate-400">On the quote: {l.description}</span>}
                    </span>
                    {l.buy_code && <span className="font-mono text-xs text-slate-600">#{l.buy_code}</span>}
                    <span className="tabular w-24 text-right text-slate-700">{l.buy_price != null ? formatZAR(l.buy_price) : '—'}</span>
                    {l.buy_url
                      ? <a href={l.buy_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-brand-700 hover:underline">View <ExternalLink size={11} /></a>
                      : <span className="w-9" />}
                    {l.buy_checked_on && <span className="w-full pl-[4.75rem] text-[11px] text-slate-400">price seen {formatDate(l.buy_checked_on, 'd MMM yyyy')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
