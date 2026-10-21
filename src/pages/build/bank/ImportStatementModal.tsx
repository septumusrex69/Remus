import { useMemo, useState } from 'react'
import { FileUp } from 'lucide-react'
import {
  bankAccounts,
  bankStatements,
  existingTransactionKeys,
  insertBankTransactions,
  uploadStatementFile,
} from '../../../lib/api'
import { applyMapping, guessMapping, looksLikeOfx, parseBankTable, parseOfx, type ParsedTable, type ParseResult } from '../../../lib/bankCsv'
import { formatDate, formatZAR } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import type { BankAccount, BankTransaction, CsvMapping } from '../../../types'

const NONE = ''

/**
 * Statement import: pick file → (CSV) map columns, preview → import. New rows only: rows already
 * imported for this account (same dedupe key) are skipped. The mapping is remembered per account.
 */
export function ImportStatementModal({
  open,
  onClose,
  account,
  onImported,
}: {
  open: boolean
  onClose: () => void
  account: BankAccount | null
  onImported: (inserted: BankTransaction[], summary: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<ParsedTable | null>(null)
  const [ofx, setOfx] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [mode, setMode] = useState<'amount' | 'debitcredit'>('amount')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setTable(null)
    setOfx(null)
    setMapping(null)
    setError(null)
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
    if (t.headers.length < 2) return setError("Couldn't find a header row in this file. Is it a CSV export?")
    setTable(t)
    // Reuse the account's saved mapping when its columns are all present.
    const saved = account?.csv_mapping
    const savedFits = saved && [saved.date, saved.description, saved.amount, saved.debit, saved.credit].filter(Boolean).every((h) => t.headers.includes(h!))
    const m = savedFits ? saved : guessMapping(t.headers)
    setMapping(m)
    setMode(m.amount ? 'amount' : 'debitcredit')
  }

  const result: ParseResult | null = useMemo(() => {
    if (ofx) return ofx
    if (!table || !mapping) return null
    const m = mode === 'amount' ? { ...mapping, debit: undefined, credit: undefined } : { ...mapping, amount: undefined }
    return applyMapping(table, m)
  }, [ofx, table, mapping, mode])

  async function runImport() {
    if (!account || !file || !result) return
    setImporting(true)
    setError(null)
    try {
      const txs = result.transactions
      if (txs.length === 0) throw new Error('No transactions found with this mapping.')
      const existing = await existingTransactionKeys(account.id, txs.map((t) => t.external_id))
      const fresh = txs.filter((t) => !existing.has(t.external_id))
      const path = await uploadStatementFile(file).catch(() => null)
      const dates = txs.map((t) => t.date).sort()
      const statement = await bankStatements.create({
        bank_account_id: account.id,
        period_start: dates[0],
        period_end: dates[dates.length - 1],
        file_path: path,
        file_name: file.name,
        imported_count: fresh.length,
        duplicate_count: txs.length - fresh.length,
      })
      const inserted = await insertBankTransactions(
        fresh.map((t) => ({
          bank_account_id: account.id,
          statement_id: statement.id,
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
      if (mapping && !ofx) {
        const m = mode === 'amount' ? { ...mapping, debit: undefined, credit: undefined } : { ...mapping, amount: undefined }
        await bankAccounts.update(account.id, { csv_mapping: m }).catch(() => {})
      }
      reset()
      onImported(inserted, `Imported ${inserted.length} new transaction${inserted.length === 1 ? '' : 's'}${txs.length - fresh.length ? `, skipped ${txs.length - fresh.length} already imported` : ''}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const headerSelect = (label: string, key: keyof CsvMapping, optional = false) => (
    <Field label={label}>
      <select className="input" value={(mapping?.[key] as string) ?? NONE} onChange={(e) => setMapping((m) => (m ? { ...m, [key]: e.target.value || undefined } : m))}>
        {optional && <option value={NONE}>— None —</option>}
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
          <Button variant="primary" onClick={runImport} loading={importing} disabled={!result?.transactions.length}>
            Import {result?.transactions.length ? `${result.transactions.length} rows` : ''}
          </Button>
        </>
      }
    >
      {!account ? (
        <p className="text-sm text-slate-600">Add a bank account first.</p>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 hover:border-amber-300">
            <FileUp size={24} className="mb-2 text-slate-400" />
            {file ? <span className="font-medium text-slate-700">{file.name}</span> : <span>Choose a CSV or OFX statement export (FNB, ABSA, Standard Bank, Nedbank, Capitec…)</span>}
            <input type="file" accept=".csv,.txt,.ofx,.qfx,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>

          {table && mapping && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Column mapping</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {headerSelect('Date', 'date')}
                {headerSelect('Description', 'description')}
                <Field label="Date format">
                  <select className="input" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as CsvMapping['dateFormat'] })}>
                    <option value="auto">Auto (day first)</option>
                    <option value="dmy">dd/mm/yyyy</option>
                    <option value="mdy">mm/dd/yyyy</option>
                    <option value="ymd">yyyy/mm/dd</option>
                  </select>
                </Field>
                <Field label="Amounts are in">
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                    <option value="amount">One signed column</option>
                    <option value="debitcredit">Separate debit & credit</option>
                  </select>
                </Field>
                {mode === 'amount' ? (
                  <>
                    {headerSelect('Amount', 'amount')}
                    <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} /> Debits are positive</label>
                  </>
                ) : (
                  <>
                    {headerSelect('Debit (money out)', 'debit')}
                    {headerSelect('Credit (money in)', 'credit')}
                  </>
                )}
                {headerSelect('Balance', 'balance', true)}
                {headerSelect('Reference', 'reference', true)}
              </div>
            </div>
          )}

          {result && (
            <div>
              <p className="mb-2 text-sm text-slate-600">
                {result.transactions.length} transactions read{result.errors.length ? `, ${result.errors.length} rows skipped` : ''}. Preview:
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
                  <summary>Skipped rows</summary>
                  {result.errors.slice(0, 20).map((e) => <p key={e.line}>Line {e.line}: {e.message}</p>)}
                </details>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
