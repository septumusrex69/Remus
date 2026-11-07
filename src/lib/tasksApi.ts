/**
 * Reading and writing tasks and activities (Remus · Handover 8). Kept out of lib/api.ts so the five helpers
 * working at once do not all edit one file; the pattern is lib/api.ts's (throw the PostgREST message).
 */
import { supabase } from './supabase'
import { refreshTaskCount } from './taskCount'
import { taskActivity, type ActivityRow, type LogType, type Task } from './tasks'
import type { ID } from '../types'

type Result<T> = { data: T | null; error: { message: string } | null }
function unwrap<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export type TaskDraft = Pick<Task, 'title' | 'type' | 'priority' | 'owner_id' | 'due_date'>
  & Partial<Pick<Task, 'project_id' | 'company_id' | 'contact_id' | 'related_to_label' | 'notes' | 'status'>>

/** Tasks, optionally only one project's or one client's. A client is a company (and its people) or a contact. */
export async function listTasks(ref: { projectId?: ID; companyId?: ID; contactIds?: ID[] } = {}): Promise<Task[]> {
  let q = supabase.from('tasks').select('*')
  if (ref.projectId) q = q.eq('project_id', ref.projectId)
  const ors: string[] = []
  if (ref.companyId) ors.push(`company_id.eq.${ref.companyId}`)
  if (ref.contactIds?.length) ors.push(`contact_id.in.(${ref.contactIds.join(',')})`)
  if (ors.length) q = q.or(ors.join(','))
  return unwrap<Task[]>(await q.order('due_date', { ascending: true }).limit(2000))
}

export async function listTasksBetween(fromIso: string, toIso: string): Promise<Task[]> {
  return unwrap<Task[]>(
    await supabase.from('tasks').select('*').gte('due_date', fromIso).lt('due_date', toIso).order('due_date', { ascending: true }),
  )
}

export async function addTask(draft: TaskDraft): Promise<Task> {
  const row = unwrap<Task>(await supabase.from('tasks').insert(draft).select('*').single())
  void refreshTaskCount()
  return row
}

export async function updateTask(id: ID, patch: Partial<Omit<Task, 'id' | 'created_at'>>): Promise<Task> {
  const row = unwrap<Task>(await supabase.from('tasks').update(patch).eq('id', id).select('*').single())
  void refreshTaskCount()
  return row
}

/**
 * Ticking a task off (or un-ticking it). Finishing one writes "Task completed: ..." on the client's or job's file,
 * as Raptor's AppStore does: "a meeting that actually happened left no trace anywhere except the task disappearing
 * off a list". Nothing is written when the task is about nobody.
 */
export async function setTaskDone(t: Task, done: boolean, userId: ID): Promise<Task> {
  const row = await updateTask(t.id, {
    status: done ? 'Completed' : 'Not Started',
    completed_at: done ? new Date().toISOString() : null,
  })
  if (done && (t.company_id || t.contact_id || t.project_id)) {
    await supabase.from('activities').insert(taskActivity(t, 'completed', userId))
  }
  return row
}

/** Calling a task off, with the reason going on the client's file (Raptor: "so all the data is captured there"). */
export async function cancelTask(t: Task, reason: string, userId: ID): Promise<Task> {
  const row = await updateTask(t.id, { status: 'Cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
  if (t.company_id || t.contact_id || t.project_id) {
    await supabase.from('activities').insert(taskActivity(t, 'cancelled', userId, reason))
  }
  return row
}

export async function removeTask(id: ID): Promise<void> {
  unwrap(await supabase.from('tasks').delete().eq('id', id))
  void refreshTaskCount()
}

/* ------------------------------------------------------------ activities ---- */

const ACTIVITY_COLUMNS = 'id, type, user_id, company_id, contact_id, project_id, task_id, subject, notes, activity_date, created_at, attachment_names'

/**
 * The timeline: everything logged, emails included (they are activities too, filed by the mailbox), newest first.
 * Narrowed to one project and/or one client when given.
 */
export async function listActivities(ref: { projectId?: ID; companyId?: ID; contactIds?: ID[]; limit?: number } = {}): Promise<ActivityRow[]> {
  let q = supabase.from('activities').select(ACTIVITY_COLUMNS)
  const ors: string[] = []
  if (ref.projectId) ors.push(`project_id.eq.${ref.projectId}`)
  if (ref.companyId) ors.push(`company_id.eq.${ref.companyId}`)
  if (ref.contactIds?.length) ors.push(`contact_id.in.(${ref.contactIds.join(',')})`)
  if (ors.length) q = q.or(ors.join(','))
  return unwrap<ActivityRow[]>(await q.order('activity_date', { ascending: false }).limit(ref.limit ?? 500))
}

export interface ActivityDraft {
  type: LogType
  subject: string
  notes: string | null
  activity_date: string
  project_id: ID | null
  company_id: ID | null
  contact_id: ID | null
}

/** Log a call, note, meeting, site visit or WhatsApp. It is the logger's own row (user_id). */
export async function logActivity(draft: ActivityDraft, userId: ID): Promise<ActivityRow> {
  return unwrap<ActivityRow>(
    await supabase.from('activities').insert({ ...draft, user_id: userId, is_read: true }).select(ACTIVITY_COLUMNS).single(),
  )
}

export async function updateActivity(id: ID, patch: Partial<ActivityDraft>): Promise<void> {
  unwrap(await supabase.from('activities').update(patch).eq('id', id))
}

export async function removeActivity(id: ID): Promise<void> {
  unwrap(await supabase.from('activities').delete().eq('id', id))
}
