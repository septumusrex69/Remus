import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths } from 'date-fns'
import { ymd } from './format'

export type PeriodKey = 'this_month' | 'last_month' | 'last_3' | 'this_fy' | 'this_year' | 'last_12' | 'custom'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3: 'Last 3 months',
  this_fy: 'This tax year (Mar–Feb)',
  this_year: 'This calendar year',
  last_12: 'Last 12 months',
  custom: 'Custom',
}

/** Resolves a period to inclusive yyyy-mm-dd bounds. SA tax year runs 1 March to end February. */
export function periodRange(key: PeriodKey, now = new Date()): { from: string; to: string } {
  switch (key) {
    case 'this_month':
      return { from: ymd(startOfMonth(now)), to: ymd(endOfMonth(now)) }
    case 'last_month': {
      const m = subMonths(now, 1)
      return { from: ymd(startOfMonth(m)), to: ymd(endOfMonth(m)) }
    }
    case 'last_3':
      return { from: ymd(startOfMonth(subMonths(now, 2))), to: ymd(endOfMonth(now)) }
    case 'this_fy': {
      const y = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
      return { from: `${y}-03-01`, to: ymd(endOfMonth(new Date(y + 1, 1, 1))) }
    }
    case 'this_year':
      return { from: ymd(startOfYear(now)), to: ymd(endOfYear(now)) }
    case 'last_12':
    case 'custom':
    default:
      return { from: ymd(startOfMonth(subMonths(now, 11))), to: ymd(endOfMonth(now)) }
  }
}
