import { format, parseISO } from 'date-fns'

/** "R 12 345.67" — space thousands separator, point decimal, as used on SA quotes and invoices. */
export function formatZAR(value: number | null | undefined, opts: { decimals?: number } = {}): string {
  const n = Number(value ?? 0)
  const decimals = opts.decimals ?? 2
  const negative = n < 0
  const fixed = Math.abs(n).toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${negative ? '-' : ''}R ${grouped}${frac ? `.${frac}` : ''}`
}

/** Compact for chart axes: R 1.2m, R 450k. */
export function formatZARShort(value: number): string {
  const n = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (n >= 1_000_000) return `${sign}R ${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${sign}R ${Math.round(n / 1_000)}k`
  return `${sign}R ${Math.round(n)}`
}

export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatDate(value: string | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), pattern)
  } catch {
    return value
  }
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDate(value, 'd MMM yyyy, HH:mm')
}

/** Local YYYY-MM-DD (not toISOString, which shifts to UTC and can land on the wrong day). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayYmd(): string {
  return ymd(new Date())
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function labelize(value: string | null | undefined): string {
  if (!value) return '—'
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
