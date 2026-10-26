import { round2 } from './format'
import { scheduleStages, type StagePlan } from './quoteMath'
import { addWorkingDays, nextWorkingDay, overlaps, workingDaysBetween } from './workdays'
import type { Expense, LineKind, ProjectStage, StageBooking, Worker } from '../types'

/**
 * A project's plan: the accepted quote's stages put on the calendar, and each stage's quoted cost
 * against what it has actually cost so far (Stephan, 26 Oct 2026: profitability per project,
 * "the bathroom is going to take 2 days...").
 */

export type NewStage = Pick<ProjectStage, 'name' | 'sort_order' | 'start_date' | 'end_date' | 'quoted_sell' | 'quoted_material' | 'quoted_labour' | 'quoted_subcontractor'>

interface QuoteLine {
  section: string | null
  kind?: LineKind | null
  quantity: number
  unit_cost: number
  unit_price: number
  description: string
}

/**
 * The quote's sections as dated stages, from a start date. Day N of the quote's plan becomes the
 * Nth working day from the start (weekends and public holidays skipped). A stage of 0 days is
 * given its start day, so it still shows on the calendar.
 */
export function stagesFromQuote(lines: QuoteLine[], plans: StagePlan[], start: string): NewStage[] {
  const first = nextWorkingDay(start)
  const used = lines.filter((l) => l.description.trim() || Number(l.unit_price) || Number(l.unit_cost))
  const order: string[] = []
  for (const l of used) if (!order.includes(l.section ?? '')) order.push(l.section ?? '')
  const planFor = (name: string, i: number): StagePlan =>
    plans.find((p) => p.name === name) ?? { name, duration_days: 1, start_mode: i === 0 ? 'start' : 'after', start_ref: null, lag_days: 0 }
  const { stages } = scheduleStages(order.map(planFor))
  return stages.map((s, i) => {
    const mine = used.filter((l) => (l.section ?? '') === s.name)
    const cost = (k: LineKind) => round2(mine.filter((l) => (l.kind ?? 'material') === k).reduce((t, l) => t + Number(l.quantity) * Number(l.unit_cost), 0))
    return {
      name: s.name,
      sort_order: i,
      start_date: addWorkingDays(first, s.startDay),
      end_date: addWorkingDays(first, Math.max(s.startDay, s.endDay - 1)),
      quoted_sell: round2(mine.reduce((t, l) => t + Number(l.quantity) * Number(l.unit_price), 0)),
      quoted_material: cost('material'),
      quoted_labour: cost('labour'),
      quoted_subcontractor: cost('subcontractor'),
    }
  })
}

export interface StageActual {
  material: number
  labour: number
  subcontractor: number
  /** Plant hire, transport, permits and the like, filed on the stage. */
  other: number
  total: number
  /** Labour days worked so far, from the bookings. */
  labourDays: number
}

/**
 * What a stage has cost so far: slips filed on it by category, plus labour from its bookings
 * (each worker's day cost × the working days booked up to today). Labour slips filed on the
 * stage count too, so wages should be booked OR slipped against a stage, not both.
 */
export function stageActual(stageId: string, expenses: Expense[], bookings: StageBooking[], workers: Map<string, Worker>, today: string): StageActual {
  const mine = expenses.filter((e) => e.stage_id === stageId)
  const sum = (pred: (e: Expense) => boolean) => mine.filter(pred).reduce((t, e) => t + Number(e.amount_excl), 0)
  let labourDays = 0
  let booked = 0
  for (const b of bookings.filter((x) => x.stage_id === stageId)) {
    const days = workingDaysBetween(b.start_date, b.end_date < today ? b.end_date : today)
    labourDays += days
    booked += days * Number(workers.get(b.worker_id)?.day_cost ?? 0)
  }
  const material = round2(sum((e) => e.category === 'materials'))
  const labour = round2(sum((e) => e.category === 'labour') + booked)
  const subcontractor = round2(sum((e) => e.category === 'subcontractor'))
  const other = round2(sum((e) => !['materials', 'labour', 'subcontractor'].includes(e.category)))
  return { material, labour, subcontractor, other, total: round2(material + labour + subcontractor + other), labourDays }
}

/** The labour a stage's bookings will cost in full (all booked days), for planning. */
export function bookedLabourCost(stageId: string, bookings: StageBooking[], workers: Map<string, Worker>): number {
  return round2(
    bookings
      .filter((b) => b.stage_id === stageId)
      .reduce((t, b) => t + workingDaysBetween(b.start_date, b.end_date) * Number(workers.get(b.worker_id)?.day_cost ?? 0), 0),
  )
}

/** The other bookings the same worker has on overlapping days: a double booking. */
export function clashesFor(booking: Pick<StageBooking, 'id' | 'worker_id' | 'start_date' | 'end_date'>, all: StageBooking[]): StageBooking[] {
  return all.filter((b) => b.id !== booking.id && b.worker_id === booking.worker_id && overlaps(b, booking))
}
