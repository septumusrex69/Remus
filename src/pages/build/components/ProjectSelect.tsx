import type { Project } from '../../../types'

export function ProjectSelect({
  projects,
  value,
  onChange,
  allowOverhead = true,
  className,
  highlight,
}: {
  projects: Project[]
  value: string | null
  onChange: (id: string | null) => void
  allowOverhead?: boolean
  className?: string
  highlight?: boolean
}) {
  const open = projects.filter((p) => p.status !== 'cancelled')
  return (
    <select
      className={`input ${highlight ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300/40' : ''} ${className ?? ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {allowOverhead && <option value="">Company overhead (no project)</option>}
      {!allowOverhead && <option value="">— Select project —</option>}
      {open.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code ? `${p.code} · ` : ''}{p.name}{p.status !== 'active' ? ` (${p.status.replace('_', ' ')})` : ''}
        </option>
      ))}
    </select>
  )
}
