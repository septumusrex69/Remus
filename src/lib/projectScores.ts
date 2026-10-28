/**
 * EVERY PROJECT'S VERDICT, FROM THE LISTS (Remus · Handoff 5). The dashboard and the Projects list both
 * score many jobs at once from the project_financials view, the plan's stages and the crew; this is the
 * one way they do it, so a job reads the same percentage on every screen (and on its own page, where
 * JobScorecard uses the same quotedCost and scoreJob).
 */
import { listCrewDays, listProjectFinancials, projectStages, stageBookings, workers as workersApi } from './api'
import { projectCrewCost, type CrewSources } from './crewDays'
import { quotedCost, scoreJob, type CostSplit, type JobScore } from './jobScore'
import type { Project, ProjectFinancials, ProjectStage } from '../types'

export interface ScoreSources {
  fin: Map<string, ProjectFinancials>
  stages: ProjectStage[]
  crew: CrewSources
}

/** Reads what scoring needs; the register from the earliest open job's start (or `from`). */
export async function loadScoreSources(projects: Project[], from: string, to: string): Promise<ScoreSources> {
  const [fin, stages, bookings, workers] = await Promise.all([
    listProjectFinancials(),
    projectStages.list().catch(() => []),
    stageBookings.list().catch(() => []),
    workersApi.list().catch(() => []),
  ])
  const open = projects.filter((p) => p.status === 'active' || p.status === 'on_hold').map((p) => p.start_date).filter((d): d is string => !!d)
  const register = await listCrewDays([from, ...open].sort()[0], to).catch(() => [])
  return { fin, stages, crew: crewSources(stages, bookings, workers, register) }
}

export function crewSources(stages: ProjectStage[], bookings: CrewSources['bookings'], workers: { id: string }[], register: CrewSources['register']): CrewSources {
  return { bookings, register, stageProject: new Map(stages.map((st) => [st.id, st.project_id])), workers: new Map(workers.map((w) => [w.id, w])) as CrewSources['workers'] }
}

export function scoreProject(p: Project, src: ScoreSources, today: string): JobScore {
  const f = src.fin.get(p.id)
  const crew = projectCrewCost(src.crew, p.id, today)
  const actual: CostSplit = {
    material: f?.expenses_materials ?? 0, labour: (f?.expenses_labour ?? 0) + crew, subcontractor: f?.expenses_subcontractor ?? 0,
    other: (f?.expenses_total ?? 0) - (f?.expenses_materials ?? 0) - (f?.expenses_labour ?? 0) - (f?.expenses_subcontractor ?? 0),
    total: (f?.expenses_total ?? 0) + crew,
  }
  const quoted = quotedCost(null, [], Number(p.budget), src.stages.filter((x) => x.project_id === p.id))
  return scoreJob({ quoted, actual, contract: Number(p.contract_value), variations: f?.approved_variations ?? 0, status: p.status, start: p.start_date, end: p.end_date, today })
}
