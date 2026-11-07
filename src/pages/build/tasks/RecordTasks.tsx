import { useState } from 'react'
import { Plus } from 'lucide-react'
import { listProfiles } from '../../../lib/api'
import { listTasks, setTaskDone } from '../../../lib/tasksApi'
import { isOpen, localDay, type Task } from '../../../lib/tasks'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { useAuth } from '../../../store/AuthContext'
import { Button, Card, ErrorBanner, Spinner } from '../../../components/ui'
import { CancelTaskModal, RescheduleTaskModal, TaskFormModal, type TaskDefaults } from './TaskForms'
import { TaskList } from './TaskList'
import type { ID } from '../../../types'

/**
 * THE TASKS TAB on a project's and a client's page (Remus · Handover 8): Raptor raises tasks from the record they
 * are about, and shows them there. "+ Task" here starts one already tied to this job or client. Open work first,
 * then what is finished or called off, so the tab reads as what is left to do.
 */
export function RecordTasks({ projectId, companyId, contactIds, defaults, label }: {
  projectId?: ID
  companyId?: ID
  contactIds?: ID[]
  /** What a new task starts with (this job / this client). */
  defaults: TaskDefaults
  /** "this job", "this client": for the empty line. */
  label: string
}) {
  const { currentUser } = useAuth()
  const canEdit = useAccess() !== 'read_only'
  const today = localDay(new Date())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [cancelling, setCancelling] = useState<Task | null>(null)
  const [moving, setMoving] = useState<Task | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, error, loading, reload } = useLoad(async () => {
    const [tasks, team] = await Promise.all([listTasks({ projectId, companyId, contactIds }), listProfiles()])
    return { tasks, team }
  }, [projectId, companyId, (contactIds ?? []).join(',')], 'record-tasks')

  const open = (data?.tasks ?? []).filter(isOpen)
  const closed = (data?.tasks ?? []).filter((t) => !isOpen(t)).reverse()
  const list = (rows: Task[], empty: string) => (
    <TaskList
      tasks={rows}
      team={data?.team ?? []}
      today={today}
      canEdit={canEdit}
      showLinks={!projectId}
      empty={empty}
      onToggle={async (t, done) => {
        setActionError(null)
        try { await setTaskDone(t, done, currentUser?.id ?? t.owner_id); reload() } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
      }}
      onEdit={setEditing}
      onReschedule={setMoving}
      onCancel={setCancelling}
    />
  )

  return (
    <div className="space-y-4" data-testid="record-tasks">
      <ErrorBanner error={actionError ?? error} />
      <Card
        title="Tasks"
        subtitle={open.length ? `${open.length} still to do` : `Nothing to do for ${label}`}
        padded={false}
        actions={canEdit && <Button size="sm" variant="primary" onClick={() => setAdding(true)} data-testid="record-task-add"><Plus size={14} /> Task</Button>}
      >
        {loading && !data ? <Spinner /> : list(open, `No open tasks for ${label}.`)}
      </Card>
      {closed.length > 0 && (
        <Card title="Done and cancelled" subtitle={`${closed.length}`} padded={false}>
          {list(closed, '')}
        </Card>
      )}
      <TaskFormModal
        open={adding || !!editing}
        editing={editing}
        defaults={defaults}
        onClose={() => { setAdding(false); setEditing(null) }}
        onSaved={() => { setAdding(false); setEditing(null); reload() }}
      />
      <CancelTaskModal task={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); reload() }} />
      <RescheduleTaskModal task={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); reload() }} />
    </div>
  )
}
