import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { listEventsBetween, listProfiles, projects as projectsApi, siteDiary } from '../../../lib/api'
import { labelize } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, ErrorBanner, PageHeader, Spinner, Tabs } from '../../../components/ui'
import type { DiaryEvent, EventType, SiteDiaryEntry } from '../../../types'
import { EventFormModal } from '../components/EventFormModal'
import { SiteDiaryForm } from '../components/SiteDiaryForm'
import { SiteDiaryList } from '../projects/ProjectDetail'

type View = 'month' | 'week' | 'agenda'
type Tab = 'calendar' | 'site'

const TYPE_COLORS: Record<EventType, string> = {
  site_visit: 'bg-brand-100 text-brand-900 border-brand-300',
  meeting: 'bg-sky-50 text-sky-800 border-sky-200',
  inspection: 'bg-violet-50 text-violet-800 border-violet-200',
  delivery: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  quote_appointment: 'bg-orange-50 text-orange-800 border-orange-200',
  other: 'bg-slate-100 text-slate-700 border-slate-200',
}

const WEEK_OPTS = { weekStartsOn: 1 as const } // Monday, as on SA calendars

export function DiaryPage() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'agenda' : 'month'))
  const [cursor, setCursor] = useState(new Date())
  const [editing, setEditing] = useState<DiaryEvent | null>(null)
  const [creating, setCreating] = useState<Partial<DiaryEvent> | null>(null)

  // The top bar's "+ Add" lands here with ?new=1: open the form, then drop the flag so a refresh doesn't reopen it.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating({})
    setParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [params, setParams])
  const [entryOpen, setEntryOpen] = useState(false)
  const [entry, setEntry] = useState<SiteDiaryEntry | null>(null)

  const range = useMemo(() => {
    if (view === 'month') return { from: startOfWeek(startOfMonth(cursor), WEEK_OPTS), to: addDays(endOfWeek(endOfMonth(cursor), WEEK_OPTS), 1) }
    if (view === 'week') return { from: startOfWeek(cursor, WEEK_OPTS), to: addDays(endOfWeek(cursor, WEEK_OPTS), 1) }
    return { from: startOfWeek(cursor, WEEK_OPTS), to: addDays(startOfWeek(cursor, WEEK_OPTS), 28) }
  }, [view, cursor])

  const { data, error, loading, reload } = useLoad(async () => {
    const [events, projects, team, entries] = await Promise.all([
      listEventsBetween(range.from.toISOString(), range.to.toISOString()),
      projectsApi.list(),
      listProfiles(),
      siteDiary.list(),
    ])
    return { events, projects, team, entries }
  }, [range.from.getTime(), range.to.getTime()], 'diary')

  const projectName = (id: string | null) => data?.projects.find((p) => p.id === id)?.name ?? ''
  const eventsOn = (d: Date) => (data?.events ?? []).filter((e) => isSameDay(parseISO(e.start_at), d))

  function step(dir: -1 | 1) {
    setCursor((c) => (view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : addWeeks(c, dir * 4)))
  }

  const chip = (e: DiaryEvent) => (
    <button
      key={e.id}
      onClick={(ev) => { ev.stopPropagation(); setEditing(e) }}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${TYPE_COLORS[e.type]}`}
      title={`${e.title}${e.location ? ` · ${e.location}` : ''}`}
    >
      {!e.all_day && <span className="font-medium">{format(parseISO(e.start_at), 'HH:mm')} </span>}
      {e.title}
    </button>
  )

  const title = view === 'month' ? format(cursor, 'MMMM yyyy') : `${format(range.from, 'd MMM')} – ${format(addDays(range.to, -1), 'd MMM yyyy')}`

  return (
    <div>
      <PageHeader
        title="Diary"
        actions={
          tab === 'calendar' ? (
            <Button variant="primary" onClick={() => setCreating({})}><Plus size={16} /> Event</Button>
          ) : (
            <Button variant="primary" onClick={() => { setEntry(null); setEntryOpen(true) }}><Plus size={16} /> Site diary entry</Button>
          )
        }
      />
      <ErrorBanner error={error} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'calendar', label: 'Calendar' }, { id: 'site', label: 'Site diary (all projects)' }]} />

      {tab === 'site' ? (
        <Card padded={false}>
          {loading && !data ? <Spinner /> : (
            <SiteDiaryList rows={data?.entries ?? []} projectName={(id) => projectName(id)} onEdit={(e) => { setEntry(e); setEntryOpen(true) }} />
          )}
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={16} /></Button>
              <Button size="sm" onClick={() => setCursor(new Date())}>Today</Button>
              <Button size="sm" onClick={() => step(1)} aria-label="Next"><ChevronRight size={16} /></Button>
              <span className="ml-2 font-semibold text-slate-800">{title}</span>
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs">
              {(['month', 'week', 'agenda'] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize ${view === v ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>{v}</button>
              ))}
            </div>
          </div>

          {loading && !data ? <Spinner /> : view === 'month' ? (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-medium uppercase text-slate-500">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {eachDayOfInterval({ start: range.from, end: addDays(range.to, -1) }).map((d) => {
                  const evs = eventsOn(d)
                  return (
                    <div
                      key={d.toISOString()}
                      onClick={() => setCreating({ start_at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8).toISOString() })}
                      className={`min-h-20 cursor-pointer border-r border-b border-slate-100 p-1 hover:bg-brand-50/40 sm:min-h-28 ${isSameMonth(d, cursor) ? '' : 'bg-slate-50/60 text-slate-400'}`}
                    >
                      <div className={`mb-1 text-right text-xs ${isSameDay(d, new Date()) ? 'font-bold text-brand-600' : ''}`}>{format(d, 'd')}</div>
                      <div className="space-y-0.5">
                        {evs.slice(0, 3).map(chip)}
                        {evs.length > 3 && <p className="text-[10px] text-slate-500">+{evs.length - 3} more</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : view === 'week' ? (
            <div className="grid gap-2 sm:grid-cols-7">
              {eachDayOfInterval({ start: range.from, end: addDays(range.to, -1) }).map((d) => (
                <div key={d.toISOString()} className={`rounded-xl border bg-white p-2 ${isSameDay(d, new Date()) ? 'border-brand-400' : 'border-slate-200'}`}>
                  <button className="mb-2 w-full text-left text-xs font-semibold text-slate-700" onClick={() => setCreating({ start_at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8).toISOString() })}>
                    {format(d, 'EEE d MMM')}
                  </button>
                  <div className="space-y-1">{eventsOn(d).map(chip)}</div>
                </div>
              ))}
            </div>
          ) : (
            <Card padded={false}>
              {(data?.events.length ?? 0) === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">Nothing scheduled in the next four weeks.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {eachDayOfInterval({ start: range.from, end: addDays(range.to, -1) })
                    .filter((d) => eventsOn(d).length)
                    .map((d) => (
                      <li key={d.toISOString()} className="px-4 py-3">
                        <p className={`mb-1.5 text-xs font-semibold uppercase ${isSameDay(d, new Date()) ? 'text-brand-600' : 'text-slate-500'}`}>{format(d, 'EEEE d MMMM')}</p>
                        <ul className="space-y-1.5">
                          {eventsOn(d).map((e) => (
                            <li key={e.id}>
                              <button onClick={() => setEditing(e)} className={`w-full rounded-lg border px-3 py-2 text-left ${TYPE_COLORS[e.type]}`}>
                                <span className="text-sm font-medium">{e.all_day ? 'All day' : format(parseISO(e.start_at), 'HH:mm')} · {e.title}</span>
                                <span className="block text-xs opacity-80">{labelize(e.type)}{e.project_id ? ` · ${projectName(e.project_id)}` : ''}{e.location ? ` · ${e.location}` : ''}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      <EventFormModal
        open={!!editing || !!creating}
        editing={editing}
        defaults={creating ?? undefined}
        projects={data?.projects ?? []}
        team={data?.team ?? []}
        onClose={() => { setEditing(null); setCreating(null) }}
        onSaved={() => { setEditing(null); setCreating(null); reload() }}
      />
      <SiteDiaryForm open={entryOpen} editing={entry} projects={data?.projects ?? []} onClose={() => setEntryOpen(false)} onSaved={() => { setEntryOpen(false); reload() }} />
    </div>
  )
}
