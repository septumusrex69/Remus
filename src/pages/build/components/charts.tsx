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
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} />
        <Tooltip formatter={(v) => formatZAR(Number(v))} labelFormatter={(_l, p) => p?.[0]?.payload?.full ?? ''} />
        <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
          {data.map((d) => <Cell key={d.full} fill={d.profit >= 0 ? '#059669' : '#dc2626'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CategoryBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
        <XAxis type="number" tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12, fill: '#475569' }} />
        <Tooltip formatter={(v) => formatZAR(Number(v))} />
        <Bar dataKey="value" fill="#ef6723" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
