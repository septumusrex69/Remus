import { Link } from 'react-router-dom'
import { CircleCheck, OctagonAlert } from 'lucide-react'
import { adviceFor, type Product } from '../../../lib/products'
import { formatZAR } from '../../../lib/format'
import { paths } from '../paths'

/**
 * WHAT THE PRODUCTS BOOK SAYS ABOUT THIS LINE (Remus · Handover 6). Under a quote's material line, a Find prices
 * search and a slip's items: a red line for a product the team marked Avoid, with whoever's note; a steel line for
 * what the team prefers for that kind of thing. Nothing at all when the book has nothing to say.
 */
export function ProductAdvice({ text, book, className, max = 2 }: { text: string; book: Product[] | null | undefined; className?: string; max?: number }) {
  if (!book?.length) return null
  const { avoid, preferred } = adviceFor(text, book)
  const rec = preferred.filter((p) => !avoid.some((a) => a.id === p.id)).slice(0, max)
  if (!avoid.length && !rec.length) return null
  return (
    <div className={`space-y-1 ${className ?? ''}`} data-testid="product-advice">
      {avoid.slice(0, max).map((p) => (
        <Link key={p.id} to={`${paths.products()}?p=${p.id}`} className="flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 hover:underline" data-testid="product-avoid">
          <OctagonAlert size={13} className="mt-px shrink-0" />
          <span><strong>Avoid:</strong> {[p.brand, p.name].filter(Boolean).join(' ')}{p.note ? ` — ${p.note}` : ''}</span>
        </Link>
      ))}
      {rec.map((p) => (
        <Link key={p.id} to={`${paths.products()}?p=${p.id}`} className="flex items-start gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:underline" data-testid="product-preferred">
          <CircleCheck size={13} className="mt-px shrink-0" />
          <span><strong>We prefer:</strong> {[p.brand, p.name].filter(Boolean).join(' ')}{p.use_for ? ` · ${p.use_for}` : ''}{p.last_price != null ? ` · ${formatZAR(p.last_price)}` : ''}{p.store ? ` at ${p.store}` : ''}</span>
        </Link>
      ))}
    </div>
  )
}
