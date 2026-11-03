import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { CheckCircle2, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { Badge, Button, ErrorBanner, Field, Modal, PageHeader, Spinner } from '../../../components/ui'
import { listDayPhotos, saveDayPhotos } from '../../../lib/api'
import { BRAND_PHOTOS, photoById, photoUrl } from '../../../lib/brandPhotos'
import { draftRowFor, johannesburgToday, lineOfTheDay, monthDays, monthStatus, nextMonth, type DayPhotoRow } from '../../../lib/dayPhotos'
import { useAccess } from '../../../lib/access'
import { useAuth } from '../../../store/AuthContext'
import { useLoad } from '../../../hooks/useLoad'
import { useBuild } from '../BuildContext'
import { paths } from '../paths'

// The dashboard's own way of writing a date ("Tuesday 3 November").
const monthName = (m: string) => format(new Date(`${m}-01T12:00:00`), 'MMMM yyyy')
const dayName = (d: string) => format(new Date(`${d}T12:00:00`), 'EEEE d MMMM')

/** As the dashboard band draws it: black glass from the left, the photograph framed where it was set. */
function BandPreview({ row, height = 'h-32', onFrame }: { row: DayPhotoRow; height?: string; onFrame?: (x: number, y: number) => void }) {
  const p = photoById(row.photo_id) ?? BRAND_PHOTOS[0]
  return (
    <div className={clsx('relative overflow-hidden bg-ink-950', height, onFrame && 'cursor-crosshair')} onClick={onFrame ? (e) => frame(e, onFrame) : undefined}
      style={{ backgroundImage: `linear-gradient(100deg, rgba(9,9,11,0.92) 0%, rgba(9,9,11,0.72) 45%, rgba(9,9,11,0.35) 100%), url('${photoUrl(p, 1200)}')`, backgroundSize: 'cover, cover', backgroundPosition: `center, ${row.band_x}% ${row.band_y}%` }}>
      <span className="absolute bottom-3 left-4 right-4 text-white">
        <span className="block text-[10px] font-bold tracking-[0.1em] text-white/60 uppercase">{dayName(row.day)}</span>
        <span className="block text-base font-extrabold">Good morning</span>
        {row.line && <span className="mt-0.5 block truncate text-[11px] text-white/75 italic">“{row.line}”{row.who ? ` — ${row.who}` : ''}</span>}
      </span>
    </div>
  )
}

/** As the sign-in panel draws it: tall, darker at the top and foot. */
function LoginPreview({ row, onFrame }: { row: DayPhotoRow; onFrame?: (x: number, y: number) => void }) {
  const p = photoById(row.photo_id) ?? BRAND_PHOTOS[0]
  return (
    <div className={clsx('relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-ink-950', onFrame && 'cursor-crosshair')} onClick={onFrame ? (e) => frame(e, onFrame) : undefined}
      style={{ backgroundImage: `linear-gradient(160deg, rgba(9,9,11,0.82) 0%, rgba(9,9,11,0.45) 55%, rgba(9,9,11,0.82) 100%), url('${photoUrl(p, 900)}')`, backgroundSize: 'cover, cover', backgroundPosition: `center, ${row.login_x}% ${row.login_y}%` }}>
      <span className="absolute top-3 left-3 text-sm font-extrabold tracking-wider text-white">REMUS</span>
      <span className="absolute bottom-3 left-3 right-3 text-white">
        <span className="block text-sm font-semibold">Build with clarity.</span>
        {row.line && <span className="mt-1 block text-[10px] leading-snug text-white/75 italic">“{row.line}”</span>}
      </span>
    </div>
  )
}

/** A tap on a preview: that point of the photograph goes where it was tapped (CSS background-position, in %). */
function frame(e: MouseEvent<HTMLDivElement>, set: (x: number, y: number) => void) {
  const r = e.currentTarget.getBoundingClientRect()
  set(Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100))
}

/**
 * THE PHOTO OF THE DAY, A MONTH AT A TIME (Remus · Handover 8), Raptor's /portal-looks for Remus. Each day of the month
 * as the dashboard band will show it. "Fill the month" lays out every empty day from the rotation (a different
 * photograph and line each day); tap a day to change its photograph, framing or line; "Approve the month" puts it live.
 * Only approved days show; any other day shows the photographs chosen on /photos. Administrators change; anybody looks.
 */
export function PhotoDaysPage() {
  const admin = useAccess() === 'admin'
  const { currentUser } = useAuth()
  const { reloadSettings } = useBuild()
  const today = johannesburgToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const days = useMemo(() => monthDays(month), [month])
  const { data, error, loading, reload } = useLoad(() => listDayPhotos(days[0], days[days.length - 1]), [month], 'day-photos')
  const [editing, setEditing] = useState<DayPhotoRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const byDay = useMemo(() => new Map((data ?? []).map((r) => [r.day, r])), [data])
  const status = monthStatus(month, data ?? [])

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(what)
    setActionError(null)
    try {
      await fn()
      reload()
      // Today's look may have changed: the band and sign-in follow at once.
      reloadSettings()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const fill = () => run('fill', () => saveDayPhotos(days.filter((d) => !byDay.has(d)).map(draftRowFor), null))
  const approveAll = () => run('approve', () => saveDayPhotos(days.map((d) => byDay.get(d) ?? draftRowFor(d)), currentUser?.id ?? null))

  return (
    <div className="space-y-4">
      <Link to={paths.photos()} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={14} /> Photos</Link>
      <PageHeader
        title="Photo of the day"
        subtitle="A different photograph and line every day, laid out and approved a month at a time. Only approved days show."
        actions={admin ? <>
          <Button onClick={fill} loading={busy === 'fill'} disabled={!status.empty} data-testid="days-fill"><Sparkles size={15} /> Fill the month</Button>
          <Button variant="primary" onClick={approveAll} loading={busy === 'approve'} disabled={status.approved === days.length} data-testid="days-approve"><CheckCircle2 size={15} /> Approve the month</Button>
        </> : undefined}
      />
      <ErrorBanner error={actionError ?? error} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth((m) => nextMonth(m, -1))} className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span className="w-40 text-center text-sm font-semibold text-slate-800" data-testid="days-month">{monthName(month)}</span>
          <button type="button" onClick={() => setMonth((m) => nextMonth(m))} className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <p className="text-sm text-slate-500" data-testid="days-status">
          {status.approved} approved · {status.draft} waiting for approval · {status.empty} not laid out
        </p>
      </div>
      {!admin && <p className="text-xs text-slate-500">Only an Administrator can change or approve them.</p>}
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="day-cards">
          {days.map((d) => {
            const row = byDay.get(d)
            const shown = row ?? draftRowFor(d)
            return (
              <button key={d} type="button" onClick={() => setEditing(shown)} data-testid="day-card"
                className={clsx('card overflow-hidden text-left', d === today && 'ring-2 ring-slate-800', !row && 'opacity-60')}>
                <BandPreview row={shown} height="h-28" />
                <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span className="truncate text-slate-600">{photoById(shown.photo_id)?.subject ?? 'Photo'}{d === today ? ' · today' : ''}</span>
                  {row?.approved_at ? <Badge tone="bg-emerald-50 text-emerald-700">Approved</Badge>
                    : row ? <Badge tone="bg-amber-50 text-amber-700">Waiting</Badge>
                      : <Badge>Not laid out</Badge>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <DayEditor row={editing} admin={admin} onClose={() => setEditing(null)}
        onSave={(r, approve) => run('save', async () => { await saveDayPhotos([r], approve ? currentUser?.id ?? null : null); setEditing(null) })}
        saving={busy === 'save'} />
    </div>
  )
}

/** One day: its photograph, where it is framed in the band and on the sign-in (tap the picture), and its line. */
function DayEditor({ row, admin, saving, onClose, onSave }: { row: DayPhotoRow | null; admin: boolean; saving: boolean; onClose: () => void; onSave: (r: DayPhotoRow, approve: boolean) => void }) {
  const [r, setR] = useState<DayPhotoRow | null>(row)
  useEffect(() => setR(row), [row])
  if (!r) return null
  const set = (patch: Partial<DayPhotoRow>) => setR((x) => (x ? { ...x, ...patch } : x))
  const own = lineOfTheDay(r.day)
  return (
    <Modal open={!!row} onClose={onClose} wide title={dayName(r.day)}
      footer={admin ? <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(r, false)} loading={saving}>Save, not approved</Button>
        <Button variant="primary" onClick={() => onSave(r, true)} loading={saving} data-testid="day-approve"><CheckCircle2 size={15} /> Save and approve</Button>
      </> : undefined}>
      <div className="grid gap-4 lg:grid-cols-[1fr_12rem]">
        <div className="space-y-3">
          <div>
            <p className="label">Dashboard band {admin && <span className="font-normal text-slate-400">· tap the picture to frame it</span>}</p>
            <div className="overflow-hidden rounded-lg"><BandPreview row={r} height="h-44" onFrame={admin ? (x, y) => set({ band_x: x, band_y: y }) : undefined} /></div>
          </div>
          <Field label="The line" hint={<>Shown under the greeting and on the sign-in. <button type="button" className="text-brand-700 hover:underline" onClick={() => set({ line: own.line, who: own.who ?? null })}>Use the day’s own line</button> · <button type="button" className="text-brand-700 hover:underline" onClick={() => set({ line: null, who: null })}>No line</button></>}>
            <textarea className="input" rows={2} disabled={!admin} value={r.line ?? ''} onChange={(e) => set({ line: e.target.value })} />
          </Field>
          <Field label="Who said it (leave empty for our own words)">
            <input className="input" disabled={!admin} value={r.who ?? ''} onChange={(e) => set({ who: e.target.value })} />
          </Field>
        </div>
        <div>
          <p className="label">Sign-in</p>
          <LoginPreview row={r} onFrame={admin ? (x, y) => set({ login_x: x, login_y: y }) : undefined} />
        </div>
      </div>
      <p className="label mt-4">Photograph</p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8" data-testid="day-photo-picker">
        {BRAND_PHOTOS.map((p) => (
          <button key={p.id} type="button" disabled={!admin} title={p.subject} aria-label={p.subject}
            onClick={() => set({ photo_id: p.id, band_x: 50, band_y: 62, login_x: 50, login_y: 50 })}
            className={clsx('aspect-[4/3] overflow-hidden rounded-md bg-slate-200 bg-cover bg-center', r.photo_id === p.id ? 'ring-2 ring-slate-900 ring-offset-1' : 'opacity-80 hover:opacity-100')}
            style={{ backgroundImage: `url('${photoUrl(p, 240)}')` }} />
        ))}
      </div>
    </Modal>
  )
}
