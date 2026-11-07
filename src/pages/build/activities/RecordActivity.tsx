import { useState } from 'react'
import { Calendar, Phone, StickyNote } from 'lucide-react'
import { listProfiles, loadClientDirectory, projects as projectsApi } from '../../../lib/api'
import { listActivities } from '../../../lib/tasksApi'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { Button, Card, ErrorBanner, Spinner } from '../../../components/ui'
import { ActivityTimeline, LogActivityModal, type LogDefaults } from './ActivityTimeline'
import type { LogType } from '../../../lib/tasks'
import type { ID } from '../../../types'

/**
 * THE ACTIVITY TAB on a project's and a client's page (Remus · Handover 8): Raptor's record pages carry the
 * record's own timeline with "Log a call / note / meeting" over it. A client's tab includes the emails filed on
 * them; a job's tab shows what was logged against the job.
 */
export function RecordActivity({ projectId, companyId, contactIds, defaults, label }: {
  projectId?: ID
  companyId?: ID
  contactIds?: ID[]
  defaults: LogDefaults
  label: string
}) {
  const canEdit = useAccess() !== 'read_only'
  const [logging, setLogging] = useState<LogType | null>(null)
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, team, dir, projects] = await Promise.all([
      listActivities({ projectId, companyId, contactIds }), listProfiles(), loadClientDirectory(), projectsApi.list(),
    ])
    return { rows, team, dir, projects }
  }, [projectId, companyId, (contactIds ?? []).join(',')], 'record-activity')

  return (
    <div data-testid="record-activity">
      <Card
        title="Activity"
        subtitle={data ? `${data.rows.length} logged for ${label}` : undefined}
        actions={canEdit && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setLogging('Call')} data-testid="record-log-call"><Phone size={13} /> Log a call</Button>
            <Button size="sm" onClick={() => setLogging('Note')}><StickyNote size={13} /> Note</Button>
            <Button size="sm" onClick={() => setLogging('Meeting')}><Calendar size={13} /> Meeting</Button>
          </div>
        )}
      >
        <ErrorBanner error={error} />
        {loading && !data ? <Spinner /> : (
          <div className="pb-3">
            <ActivityTimeline
              rows={data?.rows ?? []}
              team={data?.team ?? []}
              dir={data?.dir ?? null}
              projects={data?.projects ?? []}
              canEdit={canEdit}
              onChanged={reload}
              showAbout={!projectId}
              empty={`Nothing logged for ${label} yet.`}
            />
          </div>
        )}
      </Card>
      <LogActivityModal
        open={logging !== null}
        defaults={{ ...defaults, type: logging ?? 'Call' }}
        dir={data?.dir ?? null}
        projects={data?.projects ?? []}
        onClose={() => setLogging(null)}
        onSaved={() => { setLogging(null); reload() }}
      />
    </div>
  )
}
