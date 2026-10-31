import { describe, expect, it } from 'vitest'
import { adviceFor, matchScore, words, type Product } from './products'

const p = (id: string, name: string, brand: string | null, category: string | null, verdict: Product['verdict'], rating: number | null = null): Product => ({
  id, name, brand, category, verdict, rating, use_for: null, unit: null, store: null, product_code: null, product_url: null,
  last_price: null, note: null, share_ok: false, created_by: null, created_at: '', updated_at: '',
})

// Stephan's story: two strippers that did not work, then one far better.
const book = [
  p('a', 'Strip-It Paint Stripper 5L', 'Hamiltons', 'Paint stripper', 'avoid'),
  p('b', 'Gel Paint Remover 1L', 'Plascon', 'Paint stripper', 'avoid'),
  p('c', 'Industrial Paint Stripper', 'Dulux', 'Paint stripper', 'preferred', 5),
  p('d', 'PPC Cement 42.5N 50kg', 'PPC', 'Cement', 'preferred', 4),
]

describe('the products book', () => {
  it('cuts text into words that say which product it is', () => {
    expect(words('Strip-It Paint Stripper 5L x2')).toEqual(['strip', 'paint', 'stripper'])
  })
  it('a slip line naming a product we avoid is flagged, and our preferred one is suggested', () => {
    const a = adviceFor('Hamiltons Strip-It paint stripper 5L', book)
    expect(a.avoid.map((x) => x.id)).toEqual(['a'])
    expect(a.preferred.map((x) => x.id)).toEqual(['c'])
  })
  it('a quote line that only says the kind of thing gets the preferred one', () => {
    const a = adviceFor('Strip paint off floor: paint stripper', book)
    expect(a.preferred.map((x) => x.id)).toContain('c')
    expect(adviceFor('Cement for the footings', book).preferred.map((x) => x.id)).toEqual(['d'])
  })
  it('nothing about unrelated lines', () => {
    expect(adviceFor('Tiles 600x600 porcelain', book)).toEqual({ avoid: [], preferred: [] })
    expect(matchScore(book[0], '')).toBe(0)
  })
})
