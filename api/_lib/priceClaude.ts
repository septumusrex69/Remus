import Anthropic from '@anthropic-ai/sdk'
import { STORES } from './priceCrawl.js'
import { usdFor } from './aiUsage.js'

/**
 * FIND PRICES -- step two, PURE CLAUDE (Remus · Handoff 1, 27 Oct 2026). Stephan: build our own
 * crawler, then "compare it to Claude, pure Claude", then a combined version. This is the second:
 * Claude searches the same six stores itself, with Anthropic's web search and web fetch, and nothing
 * from Remus's own crawler. Same question, same stores, so the two can be laid side by side.
 *
 * ONLY THE STORES' OWN SITES. Both tools are held to the six stores' domains, so a price comes from
 * the store's own page and never from a blog or a price-comparison site quoting last year's figure.
 *
 * THE ANSWER COMES BACK THROUGH A TOOL, not free text. Claude reports by calling report_prices, whose
 * schema is strict, so the result is read as data rather than parsed out of a paragraph. (Structured
 * output was the other way; a tool keeps it clear of web search's citations.)
 *
 * IT SAYS WHAT IT COST. Every run reports its tokens and searches and works out the rand, because the
 * point of this step is the comparison, and price is half of it.
 */

/* Claude Opus 5.5: Anthropic's default model; effort low, because this is look-up work, not reasoning. */
export const MODEL = 'claude-opus-5-5'
/* For the screen only: a rough rand figure so "what did that cost" reads in the money Urban Haus spends. */
export const USD_TO_ZAR = 18

export interface ClaudeProduct {
  store: string
  name: string
  price: number | null
  url: string | null
  /** The store's own product code (SKU), where the page shows one. */
  code: string | null
  note: string | null
}
export interface ClaudeStoreNote { store: string; reached: boolean; note: string }
export interface ClaudeRun {
  products: ClaudeProduct[]
  stores: ClaudeStoreNote[]
  ms: number
  usage: { inputTokens: number; outputTokens: number; searches: number; fetches: number; usd: number; zar: number }
  stop: string
  error: string | null
}

const STORE_DOMAINS = STORES.map((s) => new URL(s.searchUrl('x')).hostname.replace(/^www\./, ''))

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_prices',
  description: 'Report the products and prices you found, and what happened at each store. Call this exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['products', 'stores'],
    properties: {
      products: {
        type: 'array',
        description: 'Products that match what was asked for, as the store shows them.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['store', 'name', 'price', 'url', 'code', 'note'],
          properties: {
            store: { type: 'string', description: 'The store name, exactly as listed in the request.' },
            name: { type: 'string', description: 'The product name as the store writes it.' },
            price: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Price in rand incl. VAT as shown by the store; null if the store does not show one.' },
            url: { anyOf: [{ type: 'string' }, { type: 'null' }], description: "The product's page on the store's site." },
            code: { anyOf: [{ type: 'string' }, { type: 'null' }], description: "The store's own product code or SKU, if shown; null otherwise." },
            note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Anything worth knowing: size, pack quantity, "price from search snippet", out of stock.' },
          },
        },
      },
      stores: {
        type: 'array',
        description: 'One entry per store in the request.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['store', 'reached', 'note'],
          properties: {
            store: { type: 'string' },
            reached: { type: 'boolean', description: 'Whether you could see products with prices from this store.' },
            note: { type: 'string', description: 'One short sentence: what you found there, or why not.' },
          },
        },
      },
    },
  },
}

function systemPrompt(storeNames: string[]): string {
  return [
    'You find current retail prices of building and plumbing materials at South African stores, for a builder drafting a quotation.',
    `Stores to check: ${storeNames.join(', ')}. Use only these stores' own websites (the search tools are limited to them).`,
    'For each store, search for the item and read prices from the store\'s pages or from its search results. Prefer the product page when you can open it.',
    'Report up to 5 products per store that genuinely match what was asked for (a toilet seat is not a toilet). Never invent a price: if a store shows none, report price null and say so.',
    'Prices are in rand, VAT inclusive, as the store shows them. Note the size or pack where it matters (e.g. a 1 m pipe versus a 6 m one).',
    'Be quick: a few searches, not an exhaustive survey. When done, call report_prices once with everything.',
  ].join('\n')
}

/** Anthropic's price list (aiUsage.ts, the one the credit counter uses), applied to what the run used. */
export function costOf(usage: { inputTokens: number; outputTokens: number; searches: number }): { usd: number; zar: number } {
  const usd = usdFor(MODEL, usage.inputTokens, usage.outputTokens, usage.searches)
  return { usd, zar: Math.round(usd * USD_TO_ZAR * 100) / 100 }
}

export async function claudeSearch(query: string, storeIds: string[] | null, client = new Anthropic()): Promise<ClaudeRun> {
  const started = Date.now()
  const stores = storeIds?.length ? STORES.filter((s) => storeIds.includes(s.id)) : STORES
  const domains = stores.map((s) => new URL(s.searchUrl('x')).hostname.replace(/^www\./, ''))
  const used = { inputTokens: 0, outputTokens: 0, searches: 0, fetches: 0 }
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `Find prices for: ${query}` }]
  let stop = ''
  try {
    // A server-tool turn can pause; send it back to continue, a few times at most.
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: systemPrompt(stores.map((s) => s.name)),
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 6, allowed_domains: domains.length ? domains : STORE_DOMAINS, user_location: { type: 'approximate', country: 'ZA', city: 'Pretoria' } },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6, allowed_domains: domains.length ? domains : STORE_DOMAINS },
          REPORT_TOOL,
        ],
        messages,
      })
      used.inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0)
      used.outputTokens += response.usage.output_tokens
      used.searches += response.usage.server_tool_use?.web_search_requests ?? 0
      used.fetches += (response.usage.server_tool_use as { web_fetch_requests?: number } | null)?.web_fetch_requests ?? 0
      stop = response.stop_reason ?? ''

      const report = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'report_prices')
      if (report) {
        const input = report.input as { products?: ClaudeProduct[]; stores?: ClaudeStoreNote[] }
        return finish({ products: input.products ?? [], stores: input.stores ?? [], stop, error: null })
      }
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content })
        continue
      }
      if (response.stop_reason === 'refusal') return finish({ products: [], stores: [], stop, error: 'Claude declined this search.' })
      // Finished without reporting: ask once, plainly, for the report.
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: 'Now call report_prices with what you found.' })
    }
    return finish({ products: [], stores: [], stop, error: 'Claude did not report back in time.' })
  } catch (e) {
    return finish({ products: [], stores: [], stop, error: e instanceof Error ? e.message : String(e) })
  }

  function finish(r: Pick<ClaudeRun, 'products' | 'stores' | 'stop' | 'error'>): ClaudeRun {
    return { ...r, ms: Date.now() - started, usage: { ...used, ...costOf(used) } }
  }
}
