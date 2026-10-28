import { AlertTriangle, CheckCircle2, Info, TrendingDown } from 'lucide-react'
import { Card } from '../../../components/ui'
import { formatZAR, round2, todayYmd } from '../../../lib/format'
import { actualCost, quotedCost, scoreJob, type Tone } from '../../../lib/jobScore'
import type { Expense, Project, ProjectStage, Quote, QuoteItem } from '../../../types'

/**
 * THE JOB'S SCORECARD (Remus · Handoff 1, 28 Oct 2026). Stephan: "what was estimated for the project.
 * Did we overquote? ... the profit." What the quote said each kind of cost would be, what it has cost,
 * and a verdict in words at the top (lib/jobScore.ts decides it, so the dashboard says the same thing).
 */
const TONE: Record<Tone, { box: string; icon: typeof Info }> = {
  good: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CheckCircle2 },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle },
  bad: { box: 'border-red-200 bg-red-50 text-red-900', icon: TrendingDown },
  neutral: { box: 'border-slate-200 bg-slate-50 text-slate-700', icon: Info },
}

export function JobScorecard({ project, quote, items, stages, expenses, crew, variations, plain }: {
  /** The plan's stages: the quoted cost when the quote's lines are not to hand (lib/jobScore quotedCost). */
  stages: ProjectStage[]
  /** For a contractor (lib/access.ts): the verdict and the percentages, never a rand amount. */
  plain?: boolean
  project: Project
  quote: Quote | null
  items: QuoteItem[]
  expenses: Expense[]
  /** The crew's cost to date (lib/crewDays.ts: the register, or the bookings where it is not filled in). */
  crew: number
  variations: number
}) {
  const today = todayYmd()
  const quoted = quotedCost(quote, items, Number(project.budget), stages)
  const actual = actualCost(expenses, crew)
  const s = scoreJob({ quoted, actual, contract: Number(project.contract_value), variations, status: project.status, start: project.start_date, end: project.end_date, today })
  const fromBudget = !!quoted && !(quote && items.length) && quoted.material + quoted.labour + quoted.subcontractor === 0
  const Icon = TONE[s.tone].icon
  const rows: [string, number | null, number][] = fromBudget || !quoted
    ? [['Total cost', quoted?.total ?? null, actual.total]]
    : [
      ['Materials', quoted.material, actual.material],
      ['Labour', quoted.labour, actual.labour],
      ['Subcontractors', quoted.subcontractor, actual.subcontractor],
      ['Other (transport, hire, permits…)', quoted.other, actual.other],
      ['Total cost', quoted.total, actual.total],
    ]
  const z = (n: number) => formatZAR(n, { decimals: 0 })

  if (plain) {
    return (
      <Card title="Budget" subtitle="How the job is doing against what the quote estimated it would cost.">
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONE[s.tone].box}`}>
          <Icon size={20} className="mt-0.5 shrink-0" />
          <p className="font-semibold">{s.plain}</p>
        </div>
        {s.costPct != null && (
          <div className="mt-4 space-y-2 text-sm">
            <Meter label="Budget used" pct={s.costPct} tone={s.tone} />
            {s.timePct != null && <Meter label="Time gone" pct={s.timePct} tone="neutral" />}
          </div>
        )}
      </Card>
    )
  }

  return (
    <Card title="Quoted vs actual" subtitle={quote ? `Against quote ${quote.number ?? ''}, excl. VAT. Labour includes the crew's days on site.` : fromBudget ? 'Against the project budget (no quote linked), excl. VAT.' : undefined}>
      <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${TONE[s.tone].box}`}>
        <Icon size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{s.headline}</p>
          {s.detail && <p className="text-sm opacity-90">{s.detail}</p>}
        </div>
      </div>
      {quoted && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium tracking-wide text-slate-400 uppercase">
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-right font-medium">Quoted</th>
                <th className="pb-2 text-right font-medium">{project.status === 'completed' ? 'Actual' : 'Actual so far'}</th>
                <th className="pb-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, q, a]) => {
                const d = q == null ? null : round2(a - q)
                const total = name === 'Total cost'
                return (
                  <tr key={name} className={total ? 'border-t border-slate-200 font-semibold' : ''}>
                    <td className={`py-1.5 ${total ? 'text-slate-800' : 'text-slate-600'}`}>{name}</td>
                    <td className="tabular py-1.5 text-right">{q == null ? '—' : z(q)}</td>
                    <td className="tabular py-1.5 text-right">{z(a)}</td>
                    <td className={`tabular py-1.5 text-right ${d == null || Math.abs(d) < 1 ? 'text-slate-400' : d > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {d == null || Math.abs(d) < 1 ? '—' : `${d > 0 ? '+' : '−'}${z(Math.abs(d))}`}
                    </td>
                  </tr>
                )
              })}
              {/* A running job's "profit so far" is the contract less the costs SO FAR: it flatters, because the
                  rest of the cost is still coming. So a running job shows where it is heading instead. */}
              <tr className="border-t border-slate-200">
                <td className="pt-2 text-slate-800">{s.profitForecast != null ? 'Profit (where it is heading)' : 'Profit'}</td>
                <td className="tabular pt-2 text-right font-semibold">{z(s.quotedProfit)}</td>
                <td className={`tabular pt-2 text-right font-semibold ${(s.profitForecast ?? s.profitNow) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{z(s.profitForecast ?? s.profitNow)}</td>
                <td className={`tabular pt-2 text-right ${(s.profitForecast ?? s.profitNow) < s.quotedProfit - 1 ? 'text-red-600' : 'text-slate-400'}`}>
                  {Math.abs((s.profitForecast ?? s.profitNow) - s.quotedProfit) < 1 ? '—' : `${(s.profitForecast ?? s.profitNow) > s.quotedProfit ? '+' : '−'}${z(Math.abs((s.profitForecast ?? s.profitNow) - s.quotedProfit))}`}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            "Over" is red, "under" green.
            {variations > 0 && ` Profit so far includes ${z(variations)} of approved variations, which the quote did not price.`}
            {s.profitForecast != null && ` "Where it is heading" assumes the rest of the job costs what was quoted for it.`}
          </p>
        </div>
      )}
    </Card>
  )
}

function Meter({ label, pct, tone }: { label: string; pct: number; tone: Tone }) {
  const bar = tone === 'bad' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'good' ? 'bg-emerald-500' : 'bg-slate-400'
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">{label}</span><span className="tabular font-medium text-slate-800">{pct}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  )
}
