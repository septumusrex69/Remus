/**
 * Seam for a live bank feed (e.g. an account-aggregation provider such as Stitch).
 *
 * NOT IMPLEMENTED. Today transactions arrive only by statement upload (CSV/OFX). A live feed
 * would implement this interface server-side (an api/bank/sync.ts function holding the provider
 * secret), write rows into public.bank_transactions with external_id set to the provider's own
 * transaction id (prefix e.g. "stitch:"), and set bank_accounts.feed_provider / feed_external_id.
 * Everything downstream (dedupe on (bank_account_id, external_id), reconcile.ts, the Bank page)
 * already works on those rows unchanged.
 */
import type { ParsedTransaction } from './bankCsv'

export interface BankFeedProvider {
  /** Stable id stored in bank_accounts.feed_provider, e.g. 'stitch'. */
  id: string
  /** Fetches transactions posted since `since` (yyyy-mm-dd) for the provider's account id. */
  fetchTransactions(feedAccountId: string, since: string): Promise<ParsedTransaction[]>
}

export const CSV_PROVIDER_ID = 'csv'
