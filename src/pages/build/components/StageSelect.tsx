import { useEffect, useState } from 'react'
import { projectStages } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import type { ProjectStage } from '../../../types'

/**
 * Which stage of the project a slip was spent on, for quoted vs actual per stage (migration 0016).
 * Shows only once the project has a plan; "Whole project" leaves it on the project alone.
 */
export function StageSelect({ projectId, value, onChange, className = '' }: { projectId: string | null; value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const [stages, setStages] = useState<ProjectStage[]>([])
  useEffect(() => {
    let live = true
    if (!projectId) { setStages([]); return }
    projectStages.list({ project_id: projectId }).then((s) => live && setStages(s)).catch(() => live && setStages([]))
    return () => { live = false }
  }, [projectId])
  if (!projectId || stages.length === 0) return null
  return (
    <label className={`block ${className}`}>
      <span className="label">Stage</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Whole project (no stage)</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name || 'General'}{s.start_date ? ` · ${formatDate(s.start_date, 'd MMM')}` : ''}</option>
        ))}
      </select>
    </label>
  )
}
