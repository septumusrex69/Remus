/**
 * THE PRODUCTS BOOK (Remus · Handover 6, migration 0034). Stephan: two paint strippers bought and used for a week,
 * then two more "far superior" -- "save the products that we used ... warn ourselves against buying ... mark it as my
 * preferential product". Urban Haus's own verdicts; pooling with other builders waits for multi-company (`share_ok`).
 *
 * The matching is plain words, no AI: a quote line, a slip line or a Find prices search is cut into words, and a
 * product matches when enough of its own words (name, brand) are in it, or its category is. PURE, so it is tested.
 */
export type Verdict = 'preferred' | 'ok' | 'avoid'

export interface Product {
  id: string
  name: string
  brand: string | null
  category: string | null
  use_for: string | null
  unit: string | null
  store: string | null
  product_code: string | null
  product_url: string | null
  last_price: number | null
  verdict: Verdict
  rating: number | null
  note: string | null
  share_ok: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProductUse {
  id: string
  product_id: string
  project_id: string | null
  expense_id: string | null
  quote_item_id: string | null
  used_on: string
  price: number | null
  note: string | null
  created_by: string | null
  created_at: string
}

/* Words that say nothing about which product it is. */
const NOISE = new Set(['the', 'and', 'for', 'with', 'per', 'each', 'sum', 'materials', 'material', 'supply', 'install', 'labour', 'top', 'kg', 'ml', 'mm', 'litre', 'litres', 'liter', 'bag', 'bags', 'box', 'pack', 'tin', 'can', 'off', 'from'])

export function words(text: string | null | undefined): string[] {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/s$/, ''))
    .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w))
}

/** How well a product fits a piece of text: 0 none, 1 its category is named, 2+ its own words are there. */
export function matchScore(p: Pick<Product, 'name' | 'brand' | 'category'>, text: string): number {
  const have = new Set(words(text))
  if (!have.size) return 0
  const own = [...new Set([...words(p.name), ...words(p.brand)])]
  const hits = own.filter((w) => have.has(w)).length
  const cat = words(p.category)
  const catHit = cat.length > 0 && cat.every((w) => have.has(w))
  if (own.length && hits >= Math.min(2, own.length)) return 2 + hits
  return catHit ? 1 : 0
}

export interface ProductAdvice {
  /** Products the team said not to buy, that this looks like. */
  avoid: Product[]
  /** What the team prefers for this kind of thing. */
  preferred: Product[]
}

/** What the book says about a line of text: the avoid matches, and the preferred ones of the same kind. */
export function adviceFor(text: string, book: Product[]): ProductAdvice {
  if (!text.trim() || !book.length) return { avoid: [], preferred: [] }
  const scored = book.map((p) => ({ p, s: matchScore(p, text) })).filter((x) => x.s > 0)
  // The kinds of thing this text is about: categories named, or of the products it names.
  const kinds = new Set(scored.map((x) => (x.p.category ?? '').trim().toLowerCase()).filter(Boolean))
  const avoid = scored.filter((x) => x.p.verdict === 'avoid' && x.s >= 2).sort((a, b) => b.s - a.s).map((x) => x.p)
  const preferred = book
    .filter((p) => p.verdict === 'preferred' && (matchScore(p, text) > 0 || kinds.has((p.category ?? '').trim().toLowerCase())))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  return { avoid, preferred }
}

export const VERDICT_WORD: Record<Verdict, string> = { preferred: 'Preferred', ok: 'Fine', avoid: 'Avoid' }
