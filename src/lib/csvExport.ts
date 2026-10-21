import { labelize } from './format'
import type { Expense, Project } from '../types'

/** Builds a CSV (Excel-friendly: BOM, CRLF, quoted where needed) and downloads it. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportExpensesCsv(rows: Expense[], projects: Project[], linked: Set<string>, filename: string) {
  const name = new Map(projects.map((p) => [p.id, `${p.code ? `${p.code} ` : ''}${p.name}`]))
  downloadCsv(filename, [
    ['Date', 'Supplier', 'Description', 'Category', 'Project', 'Slip no.', 'Amount excl. VAT', 'VAT', 'Total incl. VAT', 'Paid', 'Source', 'Bank linked'],
    ...rows.map((e) => [
      e.date,
      e.supplier,
      e.description,
      labelize(e.category),
      e.project_id ? name.get(e.project_id) ?? '' : 'Overhead',
      e.receipt_number,
      e.amount_excl.toFixed(2),
      e.vat.toFixed(2),
      (e.amount_excl + e.vat).toFixed(2),
      e.paid ? 'Yes' : 'No',
      e.source,
      linked.has(e.id) ? 'Yes' : 'No',
    ]),
  ])
}

