import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * EVERY CLAUDE CALL WRITES WHAT IT COST (Remus · Handoff 1; the table and why are in
 * 0019_ai_usage.sql). The dashboard's "Claude credit" tile is the sum of these rows.
 *
 * Written as the caller, and never allowed to fail the thing it is counting: a slip that was read
 * must still come back read even if its cost row could not be written. A failure is logged.
 */

/* Anthropic's per-million-token prices, USD, input / output. Searches are a cent each. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}
export const PRICE_PER_SEARCH = 0.01

export function usdFor(model: string, inputTokens: number, outputTokens: number, searches = 0): number {
  const [i, o] = PRICES[model] ?? PRICES['claude-opus-5-5']
  return Math.round(((inputTokens * i + outputTokens * o) / 1_000_000 + searches * PRICE_PER_SEARCH) * 10000) / 10000
}

export async function recordUsage(db: SupabaseClient, userId: string, row: {
  feature: 'find_prices' | 'slip_reader'
  model: string
  inputTokens: number
  outputTokens: number
  searches?: number
  note?: string | null
}): Promise<void> {
  try {
    const { error } = await db.from('ai_usage').insert({
      user_id: userId,
      feature: row.feature,
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      searches: row.searches ?? 0,
      usd: usdFor(row.model, row.inputTokens, row.outputTokens, row.searches ?? 0),
      note: row.note ?? null,
    })
    if (error) console.error('Could not record Claude usage:', error.message)
  } catch (e) {
    console.error('Could not record Claude usage:', e)
  }
}
