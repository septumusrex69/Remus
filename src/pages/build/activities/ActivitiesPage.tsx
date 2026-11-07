import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { listProfiles, loadClientDirectory, projects as projectsApi } from '../../../lib/api'
import { listActivities } from '../../../lib/tasksApi'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { Button, ErrorBanner, Spinner } from '../../../components/ui'
import { ActivityTimeline, LogActivityModal } from './ActivityTimeline'
import type { LogType } from '../../../lib/tasks'

/**
 * ACTIVITIES (Remus · Handover 8), copied from Raptor's `pages/activities/ActivitiesPage.tsx`.
 *
 * Stephan, 7 Nov 2026: "Activities, yeah." One timeline of what happened with clients: calls, notes, meetings,
 * site visits and WhatsApps people log, the emails the mailbox files on clients, and tasks finished or called off.
 * Raptor's filters, kept: who, what kind, which client -- plus which job, Remus's own.
 *
 * Different from Raptor: Raptor logs from its quick-add menu and the record pages; Remus has "Log a call / note /
 * meeting" on this page, in the top bar's + Add, and on each project's and client's Activity tab.
 */
const TYPES = ['Call', 'Email', 'Meeting', 'Note', 'Site visit', 'WhatsApp', 'Task']

export function ActivitiesPage() {
  const canEdit = useAccess() !== 'read_only'
  const [params, setParams] = useSearchParams()
  const [user, setUser] = useState(params.get('owner') ?? 'All')
  const [type, setType] = useState(params.get('type') ?? 'All')
  const [client, setClient] = useState('All')
  const [project, setProject] = useState('All')
  const [logging, setLogging] = useState<LogType | null>(null)

  // The top bar's "+ Add -> Log a call" lands here with ?new=1.
  useEffect(() => {
    if (params.get('new') !== '1') return
    setLogging('Call')
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
  }, [params, setParams])

  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, team, dir, projects] = await Promise.all([listActivities({ limit: 1000 }), listProfiles(), loadClientDirectory(), projectsApi.list()])
    return { rows, team, dir, projects }
  }, [], 'activities')

  const filtered = useMemo(() => (data?.rows ?? []).filter((a) => {
    if (user !== 'All' && a.user_id !== user) return false
    if (type !== 'All' && a.type !== type) return false
    if (client !== 'All' && a.company_id !== client.slice(3) && a.contact_id !== client.slice(3)) return false
    if (project !== 'All' && a.project_id !== project) return false
    return true
  }), [data, user, type, client, project])

  if (loading && !data) return <Spinner page />
  const select = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none min-w-0 max-w-full'

  return (
    <div className="space-y-4" data-testid="activities-page">
      <div className="flex flex-wrap items-center gap-2.5">
        <select value={user} onChange={(e) => setUser(e.target.value)} className={select} aria-label="Who">
          <option value="All">Everybody</option>
          {(data?.team ?? []).map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={select} aria-label="What kind">
          <option value="All">All kinds</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={client} onChange={(e) => setClient(e.target.value)} className={select} aria-label="Client">
          <option value="All">All clients</option>
          {(data?.dir.companies ?? []).map((c) => <option key={c.id} value={`co:${c.id}`}>{c.name}</option>)}
          {(data?.dir.contacts ?? []).map((c) => <option key={c.id} value={`ct:${c.id}`}>{`${c.first_name} ${c.last_name}`.trim()}</option>)}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={select} aria-label="Job">
          <option value="All">All jobs</option>
          {(data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="text-xs text-slate-400">{filtered.length === 1 ? '1 activity' : `${filtered.length} activities`}</span>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setLogging('Call')} data-testid="activity-log-call"><Plus size={15} /> Log a call</Button>
            <Button onClick={() => setLogging('Note')}>Note</Button>
            <Button onClick={() => setLogging('Meeting')}>Meeting</Button>
          </div>
        )}
      </div>
      <ErrorBanner error={error} />
      <ActivityTimeline
        rows={filtered}
        team={data?.team ?? []}
        dir={data?.dir ?? null}
        projects={data?.projects ?? []}
        canEdit={canEdit}
        onChanged={reload}
        empty="No activities match your filters."
      />
      <LogActivityModal
        open={logging !== null}
        defaults={{ type: logging ?? 'Call' }}
        dir={data?.dir ?? null}
        projects={data?.projects ?? []}
        onClose={() => setLogging(null)}
        onSaved={() => { setLogging(null); reload() }}
      />
    </div>
  )
}
