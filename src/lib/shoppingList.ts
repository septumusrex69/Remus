import { formatZAR, round2 } from './format'
import type { QuoteItem } from '../types'

/**
 * THE SHOPPING LIST'S ARITHMETIC (Remus · Handoff 1): the quote's material lines grouped by the store
 * each is bought at (migration 0020). Kept apart from the window so it can be tested. The screen and
 * the reasoning are in pages/build/quotes/ShoppingListModal.tsx.
 */
export type ShoppingItem = Pick<QuoteItem, 'description' | 'quantity' | 'unit' | 'kind' | 'buy_store' | 'buy_code' | 'buy_product' | 'buy_url' | 'buy_price' | 'buy_checked_on' | 'unit_cost'>

export const NO_STORE = 'Store not chosen yet'

export function shoppingGroups(lines: ShoppingItem[]): { store: string; items: ShoppingItem[]; total: number }[] {
  const mats = lines.filter((l) => (l.kind ?? 'material') === 'material' && (l.description.trim() || l.buy_product))
  const by = new Map<string, ShoppingItem[]>()
  for (const l of mats) {
    const store = l.buy_store?.trim() || NO_STORE
    by.set(store, [...(by.get(store) ?? []), l])
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a === NO_STORE ? 1 : b === NO_STORE ? -1 : a.localeCompare(b)))
    .map(([store, items]) => ({ store, items, total: round2(items.reduce((t, l) => t + Number(l.quantity) * Number(l.buy_price ?? 0), 0)) }))
}

/** The list as plain text: for WhatsApp, an email, or a note on the phone in the store. */
export function shoppingText(title: string, groups: ReturnType<typeof shoppingGroups>): string {
  const out = [`Shopping list: ${title}`, '']
  for (const g of groups) {
    out.push(`${g.store.toUpperCase()}${g.total ? ` (about ${formatZAR(g.total)})` : ''}`)
    for (const l of g.items) {
      const what = l.buy_product || l.description
      const code = l.buy_code ? ` [${l.buy_code}]` : ''
      const price = l.buy_price != null ? ` @ ${formatZAR(l.buy_price)}` : ''
      out.push(`- ${Number(l.quantity)} ${l.unit} ${what}${code}${price}`)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

