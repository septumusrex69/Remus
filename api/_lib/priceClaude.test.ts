import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { claudeSearch, costOf } from './priceClaude.js'

/* A stand-in for Anthropic's client: each call returns the next scripted response. */
function fakeClient(responses: object[]) {
  const calls: unknown[] = []
  const client = { beta: { messages: { create: async (req: unknown) => { calls.push(req); return responses.shift() } } } }
  return { client: client as unknown as Anthropic, calls }
}
const usage = (i: number, o: number, searches = 0) => ({ input_tokens: i, output_tokens: o, server_tool_use: { web_search_requests: searches } })

describe('what a pure-Claude search costs', () => {
  it('tokens at Haiku 5.5 rates plus a cent a search', () => {
    // 50k in * $0.10/M = $0.005; 2k out * $0.50/M = $0.001; 3 searches = $0.03.
    expect(costOf({ inputTokens: 50_000, outputTokens: 2_000, searches: 3 })).toEqual({ usd: 0.036, zar: 0.65 })
  })
})

describe('reading what Claude reports', () => {
  it('takes the report_prices call as the answer, and adds up every turn', async () => {
    const { client, calls } = fakeClient([
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'searching' }], usage: usage(10_000, 500, 2) },
      { stop_reason: 'tool_use', usage: usage(20_000, 800, 1), content: [{
        type: 'tool_use', id: 't1', name: 'report_prices',
        input: { products: [{ store: 'Cashbuild', name: 'Close Couple Suite in Box', price: 989.95, url: 'https://www.cashbuild.co.za/p', note: null }],
          stores: [{ store: 'Cashbuild', reached: true, note: '1 found' }, { store: 'Builders', reached: false, note: 'no prices shown' }] },
      }] },
    ])
    const r = await claudeSearch('close coupled toilet', ['cashbuild', 'builders'], client)
    expect(r.error).toBeNull()
    expect(r.products.map((p) => [p.store, p.price])).toEqual([['Cashbuild', 989.95]])
    expect(r.stores.map((s) => s.reached)).toEqual([true, false])
    expect(r.usage).toMatchObject({ inputTokens: 30_000, outputTokens: 1_300, searches: 3 })
    expect(calls).toHaveLength(2)
    // Only the chosen stores' own sites.
    const tools = (calls[0] as { tools: { name: string; allowed_domains?: string[] }[] }).tools
    expect(tools.find((t) => t.name === 'web_search')?.allowed_domains).toEqual(['builders.co.za', 'cashbuild.co.za'])
    // The cheap version: no page is opened, and one search per store asked about.
    expect(tools.map((t) => t.name)).toEqual(['web_search', 'report_prices'])
    expect((tools[0] as { max_uses?: number }).max_uses).toBe(2)
  })
  it('a refusal or a failure is an error on the run, never a thrown request', async () => {
    const refused = await claudeSearch('x pipe', null, fakeClient([{ stop_reason: 'refusal', content: [], usage: usage(100, 10) }]).client)
    expect(refused.error).toMatch(/declined/)
    const broken = { beta: { messages: { create: async () => { throw new Error('overloaded') } } } } as unknown as Anthropic
    expect((await claudeSearch('x pipe', null, broken)).error).toBe('overloaded')
  })
})
