/**
 * WHO WORKED WHERE, AND WHAT IT COST (Remus · Handoff 1, 28 Oct 2026). Stephan: "a certain person is at
 * a certain site ... on a certain day. We need to keep track of that."
 *
 * Two sources, one answer. A BOOKING (Plan & crew) says who is meant to be on a site; the REGISTER
 * (crew_days, 0024) says who was. For each person and working day:
 *   - a register row wins, whatever the booking said -- there, half a day, not there (0), or on a
 *     different site than booked;
 *   - with no register row, a booked day still counts, marked NOT CONFIRMED, so labour costs do not
 *     drop to nothing on the day the register goes in, and the gap is visible rather than guessed.
 * A register row carries the day rate as it was that day; an unconfirmed booked day uses today's.
 *
 * Every labour figure goes through here -- a project's scorecard, Plan & crew, the company's month,
 * and the weekly wage list -- so they cannot disagree about a day.
 */
import { round2 } from './format'
import { workingDaysIn } from './workdays'
import type { CrewDay, StageBooking, Worker } from '../types'

export interface WorkedDay {
  worker_id: string
  project_id: string
  stage_id: string | null
  day: string
  /** 1, 0.5 or 0. */
  days: number
  cost: number
  /** From the register (true), or only booked (false). */
  confirmed: boolean
}

export interface CrewSources {
  bookings: StageBooking[]
  register: CrewDay[]
  /** stage id -> project id */
  stageProject: Map<string, string>
  workers: Map<string, Worker>
}

export function workedDays(src: CrewSources, from: string, to: string): WorkedDay[] {
  if (to < from) return []
  const out: WorkedDay[] = []
  const registered = new Set<string>()
  for (const r of src.register) {
    if (r.day < from || r.day > to) continue
    registered.add(`${r.worker_id}|${r.day}`)
    out.push({ worker_id: r.worker_id, project_id: r.project_id, stage_id: r.stage_id, day: r.day, days: Number(r.days), cost: round2(Number(r.days) * Number(r.day_cost)), confirmed: true })
  }
  // The register for a day is read across ALL of a person's sites: registered anywhere that day, the
  // booking for that day is settled (they came, came elsewhere, or did not come).
  for (const r of src.register) registered.add(`${r.worker_id}|${r.day}`)
  for (const b of src.bookings) {
    const project = src.stageProject.get(b.stage_id)
    if (!project) continue
    const s = b.start_date > from ? b.start_date : from
    const e = b.end_date < to ? b.end_date : to
    if (s > e) continue
    const rate = Number(src.workers.get(b.worker_id)?.day_cost ?? 0)
    for (const d of workingDaysIn(s, e)) {
      if (registered.has(`${b.worker_id}|${d}`)) continue
      out.push({ worker_id: b.worker_id, project_id: project, stage_id: b.stage_id, day: d, days: 1, cost: rate, confirmed: false })
    }
  }
  return out
}

const sum = (xs: WorkedDay[]) => round2(xs.reduce((t, x) => t + x.cost, 0))

/** One project's crew cost from the start of time up to `today`. */
export function projectCrewCost(src: CrewSources, projectId: string, today: string): number {
  return sum(workedDays(src, '2000-01-01', today).filter((w) => w.project_id === projectId))
}

/** One stage's crew cost and days up to `today` (Plan & crew). */
export function stageCrew(src: CrewSources, stageId: string, today: string): { cost: number; days: number } {
  const mine = workedDays(src, '2000-01-01', today).filter((w) => w.stage_id === stageId)
  return { cost: sum(mine), days: mine.reduce((t, w) => t + w.days, 0) }
}

export interface WageLine {
  worker_id: string
  /** Days from the register. */
  confirmed: number
  /** Booked days nobody has confirmed yet. */
  unconfirmed: number
  amount: number
  /** Of which, from unconfirmed days. */
  unconfirmedAmount: number
  sites: string[]
}

/** The wage list for a period: per person, days and money, confirmed and not. */
export function wageList(src: CrewSources, from: string, to: string): WageLine[] {
  const by = new Map<string, WageLine>()
  for (const w of workedDays(src, from, to)) {
    const l = by.get(w.worker_id) ?? { worker_id: w.worker_id, confirmed: 0, unconfirmed: 0, amount: 0, unconfirmedAmount: 0, sites: [] }
    if (w.confirmed) l.confirmed += w.days
    else { l.unconfirmed += w.days; l.unconfirmedAmount = round2(l.unconfirmedAmount + w.cost) }
    l.amount = round2(l.amount + w.cost)
    if (w.days > 0 && !l.sites.includes(w.project_id)) l.sites.push(w.project_id)
    by.set(w.worker_id, l)
  }
  return [...by.values()].filter((l) => l.confirmed + l.unconfirmed > 0 || l.amount > 0)
}
