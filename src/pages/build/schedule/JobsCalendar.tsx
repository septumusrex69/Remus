import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, addWeeks, format, parseISO } from 'date-fns'
import { clsx } from 'clsx'
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { calendarWeeks, mondayOf, openStretches, overbooked, scheduledJobs, type WeekLoad } from '../../../lib/jobCalendar'
import { formatDate, todayYmd } from '../../../lib/format'
import { Button, Card } from '../../../components/ui'
import { paths } from '../paths'
import type { Project } from '../../../types'

/**
 * THE JOBS CALENDAR (Remus · Handover 6, lib/jobCalendar.ts): every job week by week, how many run at once
 * against what the company can take on (Settings → Company, "Jobs we can run at once"), and the weeks ahead
 * with nothing booked. Stephan: "where do we have what to do ... not to overbook ourselves".
 */
const BACK = 8
const AHEAD = 26
const LOAD: Record<WeekLoad, { cell: string; word: string }> = {
  open: { cell: 'bg-white text-slate-300 ring-1 ring-inset ring-dashed ring-slate-200', word: 'Nothing booked' },
  room: { cell: 'bg-emerald-100 text-emerald-800', word: 'Room for more' },
  full: { cell: 'bg-amber-100 text-amber-900', word: 'Full' },
  over: { cell: 'bg-red-500 text-white', word: 'Overbooked' },
}
const BAR: Record<string, string> = {
  active: 'bg-brand-500', on_hold: 'bg-amber-400', planned: 'bg-sky-300', completed: 'bg-slate-300',
}
const STATUS_WORD: Record<string, string> = { active: 'Running', on_hold: 'On hold', planned: 'Booked', completed: 'Finished' }

export function JobsCalendar({ projects, capacity }: { projects: Project[]; capacity: number }) {
  const today = todayYmd()
  const [from, setFrom] = useState(() => format(addWeeks(parseISO(mondayOf(today)), -BACK), 'yyyy-MM-dd'))
  const weeks = useMemo(() => calendarWeeks(projects, from, BACK + AHEAD, capacity), [projects, from, capacity])
  // Looking ahead always means from this week, whatever window is on screen.
  const ahead = useMemo(() => calendarWeeks(projects, today, 52, capacity), [projects, today, capacity])
  const open = openStretches(ahead, today)
  const over = overbooked(ahead, today)
  const thisWeek = ahead[0]
  const rows = scheduledJobs(projects)
    .filter((p) => p.start_date! <= weeks[weeks.length - 1].end && p.end_date! >= weeks[0].start)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!))
  const months: { label: string; span: number }[] = []
  for (const w of weeks) {
    const label = format(parseISO(w.start), 'MMM yyyy')
    if (months.length && months[months.length - 1].label === label) months[months.length - 1].span += 1
    else months.push({ label, span: 1 })
  }
  const nowCol = weeks.findIndex((w) => w.start <= today && format(addDays(parseISO(w.start), 6), 'yyyy-MM-dd') >= today)
  const COL = 'w-7 shrink-0'

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">This week</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{thisWeek.jobs.length} <span className="text-base font-normal text-slate-500">of {capacity} jobs</span></p>
          <p className={clsx('mt-1 text-sm', thisWeek.load === 'over' ? 'text-red-700' : thisWeek.load === 'full' ? 'text-amber-800' : 'text-emerald-700')}>{LOAD[thisWeek.load].word}</p>
        </Card>
        <Card>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"><TriangleAlert size={13} /> Overbooked ahead</p>
          {over.length === 0 ? <p className="mt-1 text-sm text-emerald-700">No week has more than {capacity} jobs.</p> : (
            <ul className="mt-1 space-y-0.5 text-sm text-red-700" data-testid="overbooked">
              {over.slice(0, 4).map((w) => <li key={w.start}>Week of {formatDate(w.start, 'd MMM')}: {w.jobs.length} jobs</li>)}
              {over.length > 4 && <li className="text-xs">and {over.length - 4} more weeks</li>}
            </ul>
          )}
        </Card>
        <Card>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"><CalendarX2 size={13} /> Nothing booked</p>
          {open.length === 0 ? <p className="mt-1 text-sm text-slate-600">Every week of the next year has work.</p> : (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700" data-testid="open-stretches">
              {open.slice(0, 3).map((o) => (
                <li key={o.from}>{formatDate(o.from, 'd MMM')} – {formatDate(o.to, 'd MMM yyyy')} <span className="text-slate-400">({o.weeks} week{o.weeks === 1 ? '' : 's'})</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Jobs, week by week"
        subtitle={`How many jobs run each week against the ${capacity} you can take on (Settings → Company).`}
        padded={false}
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => setFrom((f) => format(addWeeks(parseISO(f), -13), 'yyyy-MM-dd'))} aria-label="Earlier"><ChevronLeft size={15} /></Button>
            <Button size="sm" onClick={() => setFrom(format(addWeeks(parseISO(mondayOf(today)), -BACK), 'yyyy-MM-dd'))}><CalendarCheck2 size={14} /> Now</Button>
            <Button size="sm" onClick={() => setFrom((f) => format(addWeeks(parseISO(f), 13), 'yyyy-MM-dd'))} aria-label="Later"><ChevronRight size={15} /></Button>
          </div>
        }
      >
        <div className="overflow-x-auto" data-testid="jobs-calendar">
          <div className="min-w-max px-4 pb-4 text-xs">
            {/* Months */}
            <div className="flex">
              <div className="w-48 shrink-0" />
              {months.map((m) => (
                <div key={m.label} className="shrink-0 overflow-hidden whitespace-nowrap border-l border-slate-200 px-1 py-1 font-semibold text-slate-600" style={{ width: `${m.span * 1.75}rem` }}>{m.label}</div>
              ))}
            </div>
            {/* Week starts */}
            <div className="flex text-[10px] text-slate-400">
              <div className="w-48 shrink-0" />
              {weeks.map((w, i) => <div key={w.start} className={clsx(COL, 'text-center', i === nowCol && 'font-bold text-brand-700')}>{format(parseISO(w.start), 'd')}</div>)}
            </div>
            {/* Load: jobs running that week */}
            <div className="mt-1 flex items-center">
              <div className="w-48 shrink-0 pr-2 font-medium text-slate-700">Jobs running</div>
              {weeks.map((w, i) => (
                <div key={w.start} className={clsx(COL, 'px-px')}>
                  <div className={clsx('flex h-7 items-center justify-center rounded text-[11px] font-semibold', LOAD[w.load].cell, i === nowCol && 'ring-2 ring-brand-500')}
                    title={`Week of ${formatDate(w.start, 'd MMM')}: ${w.jobs.length} of ${capacity} jobs. ${LOAD[w.load].word}.`} data-load={w.load}>
                    {w.jobs.length || ''}
                  </div>
                </div>
              ))}
            </div>
            {/* One row per job */}
            <div className="mt-2 space-y-1">
              {rows.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No jobs with dates in these weeks.</p>}
              {rows.map((p) => (
                <div key={p.id} className="flex items-center">
                  <Link to={paths.project(p.id)} className="w-48 shrink-0 truncate pr-2 text-slate-700 hover:text-brand-700 hover:underline" title={`${p.name} · ${STATUS_WORD[p.status] ?? p.status} · ${formatDate(p.start_date!, 'd MMM')} – ${formatDate(p.end_date!, 'd MMM yyyy')}`}>
                    {p.code ? <span className="font-mono text-[10px] text-slate-400">{p.code} </span> : null}{p.name}
                  </Link>
                  {weeks.map((w, i) => {
                    const on = p.start_date! <= w.end && p.end_date! >= w.start
                    const first = on && !(p.start_date! <= weeks[i - 1]?.end && p.end_date! >= weeks[i - 1]?.start)
                    const last = on && !(p.start_date! <= weeks[i + 1]?.end && p.end_date! >= weeks[i + 1]?.start)
                    return (
                      <div key={w.start} className={clsx(COL, 'h-5', i === nowCol && 'bg-brand-50')}>
                        {on && <div className={clsx('h-full', BAR[p.status] ?? 'bg-slate-300', first && 'ml-0.5 rounded-l', last && 'mr-0.5 rounded-r')} />}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              {(['room', 'full', 'over', 'open'] as WeekLoad[]).map((l) => (
                <span key={l} className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-4 rounded', LOAD[l].cell)} /> {LOAD[l].word}</span>
              ))}
              <span className="text-slate-300">|</span>
              {(['active', 'planned', 'on_hold', 'completed'] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5"><span className={clsx('h-2.5 w-4 rounded', BAR[s])} /> {STATUS_WORD[s]}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
