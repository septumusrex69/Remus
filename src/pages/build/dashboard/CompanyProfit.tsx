import { Link } from 'react-router-dom'
import { Card } from '../../../components/ui'
import { formatZAR } from '../../../lib/format'
import type { MonthProfit, OverheadRecovery } from '../../../lib/companyProfit'
import { paths } from '../paths'

/**
 * WHAT THE COMPANY MADE (Remus · Handoff 1, 28 Oct 2026). Stephan: "profit per project, and then we have
 * expenses, and then overall profit. Overhead expenses". The ladder for this month, the last six months
 * beside it, and the one number that says whether the markup covers the running of the business
 * (lib/companyProfit.ts has the sums and why each is counted the way it is).
 */
const MONTH = new Intl.DateTimeFormat('en-ZA', { month: 'short' })
const monthName = (m: string) => MONTH.format(new Date(`${m}-15T00:00:00`))
const z = (n: number) => formatZAR(n, { decimals: 0 })

export function CompanyProfit({ ladder, recovery }: { ladder: MonthProfit[]; recovery: OverheadRecovery }) {
  const now = ladder[ladder.length - 1]
  const steps: { label: string; value: number; sign: '' | '−' | '='; strong?: boolean; hint?: string }[] = [
    { label: 'Invoiced', value: now.income, sign: '', hint: 'sent invoices, excl. VAT' },
    { label: 'Job costs', value: now.projectCosts + now.crew, sign: '−', hint: now.crew ? `slips on projects, plus ${z(now.crew)} crew days` : 'slips filed on projects' },
    { label: 'Profit from jobs', value: now.jobProfit, sign: '=', strong: true },
    { label: 'Overheads', value: now.overheads, sign: '−', hint: 'slips filed as Company overhead' },
    { label: 'What the company made', value: now.net, sign: '=', strong: true },
  ]
  const max = Math.max(1, ...ladder.map((r) => Math.max(r.income, r.projectCosts + r.crew + r.overheads)))
  const noOverheads = ladder.every((r) => r.overheads === 0)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title={`This month (${monthName(now.month)})`} subtitle="Excl. VAT. So far this month.">
        <dl className="space-y-1.5 text-sm">
          {steps.map((st) => (
            <div key={st.label} className={`flex items-baseline justify-between gap-3 ${st.strong ? 'border-t border-slate-200 pt-1.5 font-semibold text-slate-800' : 'text-slate-600'}`}>
              <dt>
                <span className="inline-block w-3 text-slate-400">{st.sign}</span> {st.label}
                {st.hint && <span className="block pl-4 text-[11px] font-normal text-slate-400">{st.hint}</span>}
              </dt>
              <dd className={`tabular ${st.strong && st.value < 0 ? 'text-red-600' : ''}`}>{z(st.value)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="The last six months" subtitle="What was invoiced, and where it went." className="lg:col-span-2">
        <div className="space-y-2">
          {ladder.map((r) => {
            const cost = r.projectCosts + r.crew
            return (
              <div key={r.month} className="grid grid-cols-[2.5rem_1fr_6.5rem] items-center gap-3 text-sm">
                <span className="text-slate-500">{monthName(r.month)}</span>
                <span className="space-y-0.5">
                  <span className="block h-2 rounded-full bg-emerald-500/80" style={{ width: `${(r.income / max) * 100}%` }} title={`Invoiced ${z(r.income)}`} />
                  <span className="flex h-2 overflow-hidden rounded-full" style={{ width: `${((cost + r.overheads) / max) * 100}%` }}>
                    <span className="h-full bg-brand-400" style={{ width: `${cost + r.overheads ? (cost / (cost + r.overheads)) * 100 : 0}%` }} title={`Job costs ${z(cost)}`} />
                    <span className="h-full flex-1 bg-amber-400" title={`Overheads ${z(r.overheads)}`} />
                  </span>
                </span>
                <span className={`tabular text-right font-medium ${r.net < 0 ? 'text-red-600' : 'text-slate-800'}`}>{z(r.net)}</span>
              </div>
            )
          })}
          <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-slate-500">
            <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-emerald-500/80" />Invoiced</span>
            <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-brand-400" />Job costs</span>
            <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-amber-400" />Overheads</span>
            <span>Right: what the company made</span>
          </p>
        </div>
      </Card>

      <Card title="Is the markup covering the overheads?" className="lg:col-span-3">
        {noOverheads ? (
          <p className="text-sm text-slate-600">
            No overheads recorded in six months. Rent, fuel, phones, insurance and office salaries belong on slips filed as{' '}
            <strong>Company overhead</strong> (no project), or this page shows more profit than there is.{' '}
            <Link to={paths.expenses()} className="text-brand-700 underline">Expenses</Link>
          </p>
        ) : recovery.pctOnCost == null ? (
          <p className="text-sm text-slate-600">Overheads run at about {z(recovery.monthlyOverheads)} a month. Once there are job costs in a finished month, Remus works out what share each quote needs to carry.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-xs text-slate-500">Overheads a month</p>
              <p className="tabular text-xl font-bold text-slate-800">{z(recovery.monthlyOverheads)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">To cover them, every quote needs on top of cost</p>
              <p className="tabular text-xl font-bold text-amber-700">{recovery.pctOnCost}%</p>
            </div>
            <p className="min-w-[16rem] flex-1 text-sm text-slate-600">
              Over the last {recovery.months} finished month{recovery.months === 1 ? '' : 's'}, overheads came to {recovery.pctOnCost}% of what the jobs cost.
              A markup below that pays for the jobs but not for running the business; the profit is what is left above it.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
