import { describe, expect, it } from 'vitest'
import { shoppingGroups, shoppingText } from './shoppingList'

const line = (over: Record<string, unknown>) => ({
  description: 'Toilet', quantity: 1, unit: 'each' as const, kind: 'material' as const, unit_cost: 0,
  buy_store: null, buy_code: null, buy_product: null, buy_url: null, buy_price: null, buy_checked_on: null, ...over,
})

describe('the shopping list', () => {
  it('groups materials by store, the unchosen last, labour and subcontractors left off', () => {
    const g = shoppingGroups([
      line({ description: 'Toilet', buy_store: 'Leroy Merlin', buy_price: 799, buy_code: '81504561' }),
      line({ description: 'Galv pipe 20 mm', quantity: 3, unit: 'm', buy_store: 'Cashbuild', buy_price: 147.95 }),
      line({ description: 'Basin' }),
      line({ description: 'Labour (senior)', kind: 'labour' }),
      line({ description: 'Plumber', kind: 'subcontractor' }),
      line({ description: '   ' }),
    ])
    expect(g.map((x) => [x.store, x.items.length, x.total])).toEqual([
      ['Cashbuild', 1, 443.85], ['Leroy Merlin', 1, 799], ['Store not chosen yet', 1, 0],
    ])
  })
  it('reads as a list to send to a phone', () => {
    const text = shoppingText('Q-0006 Bathroom', shoppingGroups([
      line({ description: 'Toilet', buy_store: 'Leroy Merlin', buy_product: 'Top Flush Close Coupled Toilet', buy_code: '81504561', buy_price: 799 }),
    ]))
    expect(text).toContain('LEROY MERLIN')
    expect(text).toContain('- 1 each Top Flush Close Coupled Toilet [81504561] @ R')
  })
})
