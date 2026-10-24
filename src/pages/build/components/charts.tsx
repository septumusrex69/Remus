import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatZAR, formatZARShort } from '../../../lib/format'

/**
 * Charts shared by the dashboard and project pages. Loaded lazily (see LazyCharts.tsx) so the
 * ~350 kB charting library never holds up the figures and lists around it.
 */

export function ProfitPerProjectChart({ data }: { data: { name: string; full: string; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-slate-200)" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-slate-500)' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: 'var(--color-slate-500)' }} tickLine={false} axisLine={false} width={60} />
        <Tooltip formatter={(v) => formatZAR(Number(v))} labelFormatter={(_l, p) => p?.[0]?.payload?.full ?? ''} />
        <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
          {data.map((d) => <Cell key={d.full} fill={d.profit >= 0 ? 'var(--color-emerald-600)' : 'var(--color-red-600)'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CategoryBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-slate-200)" />
        <XAxis type="number" tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: 'var(--color-slate-500)' }} />
        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12, fill: 'var(--color-slate-600)' }} />
        <Tooltip formatter={(v) => formatZAR(Number(v))} />
        <Bar dataKey="value" fill="var(--color-brand-500)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
