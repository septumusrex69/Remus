import { useMemo, useState } from 'react'
import { FileUp } from 'lucide-react'
import { bankAccounts, existingTransactionKeys, importBankStatement, uploadStatementFile } from '../../../lib/api'
import {
  applyMapping,
  guessMapping,
  looksLikeOfx,
  parseBankTable,
  parseOfx,
  type BankCsvMapping,
  type ParsedTable,
  type ParseResult,
} from '../../../lib/bankCsv'
import { formatDate, formatZAR } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import type { BankAccount, BankTransaction } from '../../../types'

const NONE = ''

type Mode = 'amount' | 'debitcredit'

/** The account's saved mapping when all its columns are in this file, otherwise a fresh guess. */
function initialMapping(t: ParsedTable, account: BankAccount | undefined): BankCsvMapping {
  const saved = account?.csv_mapping as BankCsvMapping | null | undefined
  const cols = saved ? [saved.date, saved.description, saved.amount, saved.debit, saved.credit, saved.fee, saved.signColumn] : []
  const fits = saved && cols.filter(Boolean).every((h) => t.headers.includes(h!))
  const m = fits ? saved : guessMapping(t.headers, t.rows)
  // 'ymd' is no longer offered: year-first dates are always recognised.
  return { ...m, dateFormat: m.dateFormat === 'ymd' ? 'auto' : m.dateFormat }
}

/** Only the columns that apply to the chosen amount layout. */
function effective(m: BankCsvMapping, mode: Mode): BankCsvMapping {
  return mode === 'amount' ? { ...m, debit: undefined, credit: undefined } : { ...m, amount: undefined, signColumn: undefined, invertSign: undefined }
}

/**
 * Statement import: pick account and file → (CSV) map columns, preview → import. New rows only:
 * rows already imported for this account (same dedupe key) are skipped, and no statement is
 * recorded when nothing is new. The mapping is remembered per account. Mount it fresh each time
 * it opens so the account and file start clean.
 */
export function ImportStatementModal({
  open,
  onClose,
  accounts,
  defaultAccountId,
  onImported,
}: {
  open: boolean
  onClose: () => void
  accounts: BankAccount[]
  /** The account selected on the page, if any; otherwise the person must choose. */
  defaultAccountId: string | null
  onImported: (inserted: BankTransaction[], summary: string, warning: string | null) => void
}) {
  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? (accounts.length === 1 ? accounts[0].id : NONE))
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<ParsedTable | null>(null)
  const [ofx, setOfx] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<BankCsvMapping | null>(null)
  const [mode, setMode] = useState<Mode>('amount')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const account = accounts.find((a) => a.id === accountId)

  function reset() {
    setFile(null)
    setTable(null)
    setOfx(null)
    setMapping(null)
    setError(null)
  }

  function chooseMapping(m: BankCsvMapping) {
    setMapping(m)
    setMode(m.amount || !(m.debit || m.credit) ? 'amount' : 'debitcredit')
  }

  async function pick(f: File | undefined) {
    reset()
    if (!f) return
    setFile(f)
    const text = await f.text()
    if (looksLikeOfx(text)) {
      setOfx(parseOfx(text))
      return
    }
    const t = parseBankTable(text)
    if (t.headers.length < 2) return setError("Couldn't find any columns in this file. Is it a CSV export?")
    setTable(t)
    chooseMapping(initialMapping(t, account))
  }

  function changeAccount(id: string) {
    setAccountId(id)
    if (table) chooseMapping(initialMapping(table, accounts.find((a) => a.id === id)))
  }

  const result: ParseResult | null = useMemo(() => {
    if (ofx) return ofx
    if (!table || !mapping) return null
    return applyMapping(table, effective(mapping, mode))
  }, [ofx, table, mapping, mode])

  // Date and the amount column(s) must be chosen before anything is imported.
  const missing = ofx || !mapping ? null : !mapping.date ? 'Choose the date column.' : mode === 'amount' ? (!mapping.amount ? 'Choose the amount column.' : null) : !mapping.debit || !mapping.credit ? 'Choose the debit and credit columns.' : null
  const canImport = !!account && !!result?.transactions.length && !missing

  async function runImport() {
    if (!account || !file || !result || !canImport) return
    setImporting(true)
    setError(null)
    try {
      const txs = result.transactions
      const existing = await existingTransactionKeys(account.id, txs.map((t) => t.external_id))
      const fresh = txs.filter((t) => !existing.has(t.external_id))
      if (mapping && !ofx) await bankAccounts.update(account.id, { csv_mapping: effective(mapping, mode) }).catch(() => {})
      if (fresh.length === 0) {
        reset()
        onImported([], `Nothing new: all ${txs.length} transaction${txs.length === 1 ? ' was' : 's were'} already imported.`, null)
        return
      }
      // The stored file is a convenience; failing to upload it shouldn't block the import.
      let warning: string | null = null
      const path = await uploadStatementFile(file).catch((e: unknown) => {
        warning = `The statement file couldn't be stored (${e instanceof Error ? e.message : String(e)}); the transactions were imported.`
        return null
      })
      const dates = txs.map((t) => t.date).sort()
      const { inserted } = await importBankStatement(
        {
          bank_account_id: account.id,
          period_start: dates[0],
          period_end: dates[dates.length - 1],
          file_path: path,
          file_name: file.name,
          imported_count: fresh.length,
          duplicate_count: txs.length - fresh.length,
        },
        fresh.map((t) => ({
          bank_account_id: account.id,
          date: t.date,
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          reference: t.reference,
          external_id: t.external_id,
          status: 'unmatched' as const,
          matched_expense_id: null,
          matched_payment_id: null,
          match_score: null,
          ignore_reason: null,
        })),
      )
      const dup = txs.length - inserted.length
      reset()
      onImported(inserted, `Imported ${inserted.length} new transaction${inserted.length === 1 ? '' : 's'} into ${account.name}${dup ? `, skipped ${dup} already imported` : ''}.`, warning)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const headerSelect = (label: string, key: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'fee' | 'signColumn' | 'balance' | 'reference', optional = false) => (
    <Field label={label}>
      <select className="input" value={mapping?.[key] ?? NONE} onChange={(e) => setMapping((m) => (m ? { ...m, [key]: e.target.value || undefined } : m))}>
        <option value={NONE}>{optional ? '— None —' : '— choose —'}</option>
        {table?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  )

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      wide
      title={`Import statement${account ? ` · ${account.name}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button variant="primary" onClick={runImport} loading={importing} disabled={!canImport}>
            Import {result?.transactions.length ? `${result.transactions.length} rows` : ''}
          </Button>
        </>
      }
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-slate-600">Add a bank account first.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Into account">
            <select className="input" value={accountId} onChange={(e) => changeAccount(e.target.value)}>
              <option value={NONE} disabled>— choose —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.account_number_last4 ? ` ··${a.account_number_last4}` : ''}</option>)}
            </select>
          </Field>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-300">
            <FileUp size={24} className="mb-2 text-slate-400" />
            {file ? <span className="font-medium text-slate-700">{file.name}</span> : <span>Choose a CSV or OFX statement export (FNB, ABSA, Standard Bank, Nedbank, Capitec…)</span>}
            {/* Cleared after each pick so choosing the same file again (after fixing it) fires onChange. */}
            <input
              type="file"
              accept=".csv,.txt,.ofx,.qfx,text/csv"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          {table && mapping && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Column mapping{table.headerIndex < 0 ? ' (this file has no header row)' : ''}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {headerSelect('Date', 'date')}
                {headerSelect('Description', 'description')}
                <Field label="Date format">
                  <select className="input" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as BankCsvMapping['dateFormat'] })}>
                    <option value="auto">Auto (day first)</option>
                    <option value="dmy">dd/mm/yyyy</option>
                    <option value="mdy">mm/dd/yyyy</option>
                  </select>
                </Field>
                <Field label="Amounts are in">
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                    <option value="amount">One amount column</option>
                    <option value="debitcredit">Separate debit & credit</option>
                  </select>
                </Field>
                {mode === 'amount' ? (
                  <>
                    {headerSelect('Amount', 'amount')}
                    {headerSelect('Debit/credit indicator', 'signColumn', true)}
                    {!mapping.signColumn && (
                      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} /> Debits are positive</label>
                    )}
                  </>
                ) : (
                  <>
                    {headerSelect('Debit (money out)', 'debit')}
                    {headerSelect('Credit (money in)', 'credit')}
                  </>
                )}
                {headerSelect('Fees (added to debits)', 'fee', true)}
                {headerSelect('Balance', 'balance', true)}
                {headerSelect('Reference', 'reference', true)}
              </div>
              {missing && <p className="mt-2 text-xs text-brand-700">{missing}</p>}
            </div>
          )}

          {result && (
            <div>
              <p className="mb-2 text-sm text-slate-600">
                {result.transactions.length} transactions read
                {result.skipped ? `, ${result.skipped} zero-amount or balance lines left out` : ''}
                {result.errors.length ? `, ${result.errors.length} rows unreadable` : ''}. Preview:
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <tbody>
                    {result.transactions.slice(0, 6).map((t) => (
                      <tr key={t.external_id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="px-2 py-1.5">{t.description}</td>
                        <td className={`tabular px-2 py-1.5 text-right whitespace-nowrap ${t.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatZAR(t.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.errors.length > 0 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary>Unreadable rows</summary>
                  {result.errors.slice(0, 20).map((e) => <p key={e.line}>Line {e.line}: {e.message}</p>)}
                </details>
              )}
            </div>
          )}
          {!account && <p className="text-xs text-brand-700">Choose the account this statement belongs to.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
