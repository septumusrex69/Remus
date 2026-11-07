import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, BookOpen, Lock, Pencil, PenLine, Plus, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../../components/ui'
import { RecordTabs } from '../../../components/record/RecordShell'
import { DocumentSheet } from '../../../components/documents/DocumentSheet'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { useBuild } from '../BuildContext'
import { useAccess, seesMoney } from '../../../lib/access'
import { deleteTemplate, listTemplates, saveTemplate, type DocumentTemplate, type TemplateDraft } from '../../../lib/documentsApi'
import {
  DOC_KIND, DOC_KINDS, MERGE_FIELDS, MONEY_FREE_KINDS, fieldsUsed, renderTemplate, sampleValues, unknownFields, type DocKind, type MergeField,
} from '../../../lib/documentTemplates'
import { paths } from '../paths'

/**
 * THE LIBRARY (Remus · Handover 8). Copied from Raptor's src/pages/library/LibraryPage.tsx (the list grouped by
 * kind on the left, the open template on the right, "Merge fields / Example data", the field chips, Edit for an
 * Administrator) and its Letterhead tab. Stephan, 7 Nov, on Raptor's Library: "we can start with pretty much all
 * of that."
 *
 * DIFFERENT FROM RAPTOR, AND WHY:
 *   - One library, not two (Raptor has a collections side and a sales side): a builder writes to clients.
 *   - No workflows tab: Raptor's workflows send debt-collection letters on a timetable; Stephan's documents are
 *     made for a job by a person.
 *   - The letterhead is the company's details from Settings (logo, address, registration and VAT numbers),
 *     drawn as on a quote, not an uploaded A4 picture with margins: Remus has no such picture, and the quotes
 *     already print this letterhead, so a contract and its quote match.
 *   - "Example data" fills the template from made-up values; a document is made for a real job on the job's
 *     Documents tab, where the job, the client and the quote fill it in.
 *
 * Everybody reads (a site manager only the kinds without rand amounts); an Administrator writes.
 */
type Tab = 'templates' | 'letterhead'

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'letterhead' ? 'letterhead' : 'templates'
  const { currentUser } = useAuth()
  const access = useAccess()
  const mayEdit = currentUser?.role === 'Administrator'

  return (
    <div className="space-y-4" data-testid="library-page">
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Library</h2>
            <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
              The company's documents, written once: contracts, site instructions, variation orders, completion certificates, letters and reminders.
              A document for a job is made from these on the job's Documents tab, filled in from the job, its client and its quote.
            </p>
          </div>
          {!mayEdit && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-400"><Lock size={12} /> An Administrator writes these</span>}
        </div>
        <div className="px-5">
          <RecordTabs<Tab> tabs={[{ id: 'templates', label: 'Templates' }, { id: 'letterhead', label: 'Letterhead' }]} active={tab}
            onChange={(t) => setParams(t === 'templates' ? {} : { tab: t }, { replace: true })} />
        </div>
      </Card>
      {tab === 'templates' ? <Templates mayEdit={mayEdit} money={seesMoney(access) || access === 'contractor'} /> : <Letterhead />}
    </div>
  )
}

/* ------------------------------------------------------------------ the templates */

const blankDraft = (): TemplateDraft => ({ kind: 'letter', name: '', subject: '', body: '', signable: false, active: true })
const draftOf = (t: DocumentTemplate): TemplateDraft => ({ kind: t.kind, name: t.name, subject: t.subject, body: t.body, signable: t.signable, active: t.active })

function Templates({ mayEdit, money }: { mayEdit: boolean; money: boolean }) {
  const { data, error, loading, reload } = useLoad(() => listTemplates(), [], 'library-templates')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; draft: TemplateDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const rows = useMemo(() => (data ?? []).filter((t) => money || MONEY_FREE_KINDS.includes(t.kind)), [data, money])
  const open = rows.find((r) => r.id === openId) ?? rows[0] ?? null

  async function save() {
    if (!editing) return
    if (!editing.draft.name.trim()) return setSaveError('Give the template a name.')
    setSaving(true)
    setSaveError(null)
    try {
      const t = await saveTemplate(editing.id, editing.draft)
      setEditing(null)
      reload()
      setOpenId(t.id)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: DocumentTemplate) {
    if (!window.confirm(`Delete "${t.name}" for good? Documents already made from it keep their words. Untick "In use" instead to keep it for the record.`)) return
    setSaving(true)
    try {
      await deleteTemplate(t.id)
      setEditing(null)
      setOpenId(null)
      reload()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <Spinner />
  return (
    <>
      <ErrorBanner error={error} />
      {mayEdit && (
        <div className="flex justify-end">
          <Button variant="dark" onClick={() => { setSaveError(null); setEditing({ id: null, draft: blankDraft() }) }} data-testid="new-template"><Plus size={14} /> New template</Button>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div data-testid="library-list">
          {DOC_KINDS.map((kind) => {
            const list = rows.filter((r) => r.kind === kind)
            if (!list.length) return null
            return (
              <div key={kind} className="mb-3">
                <div className="flex items-baseline justify-between border-b border-slate-100 px-1 pb-1">
                  <h3 className="text-[10px] font-semibold tracking-[0.16em] text-slate-400 uppercase">{DOC_KIND[kind].plural}</h3>
                  <span className="tabular text-[10px] text-slate-400">{list.length}</span>
                </div>
                {list.map((t) => {
                  const current = !editing && open?.id === t.id
                  return (
                    <button key={t.id} type="button" onClick={() => { setOpenId(t.id); setEditing(null) }} aria-current={current}
                      data-testid="library-row"
                      className={clsx('flex w-full items-center gap-2 border-b border-l-[3px] border-slate-100 px-2.5 py-2.5 text-left text-[14px] transition',
                        current ? 'border-l-brand-500 bg-slate-50' : 'border-l-transparent hover:bg-slate-50')}>
                      {unknownFields(t.body, t.subject).length > 0 && <span title="Asks for a field nothing can fill" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                      <span className={clsx('min-w-0 flex-1 truncate', current ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>{t.name}</span>
                      {t.signable && <span title="Can be signed online" className="inline-flex shrink-0"><PenLine size={12} className="text-slate-400" /></span>}
                      {!t.active && <span className="shrink-0 text-[10px] text-slate-400">not in use</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
          {rows.length === 0 && <p className="px-1 text-sm text-slate-400">Nothing in the Library yet{mayEdit ? ': press New template.' : '.'}</p>}
        </div>

        <div className="min-w-0 rounded-xl lg:sticky lg:top-2" data-testid="library-open">
          <Card padded={false}>
            {mayEdit && editing ? (
              <div className="p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">{editing.id ? 'Editing' : 'New template'}</h3>
                <TemplateEditor draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} />
                {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  {editing.id && open && <Button variant="danger" className="mr-auto" onClick={() => void remove(open)} disabled={saving}><Trash2 size={14} /> Delete</Button>}
                  <Button variant="ghost" onClick={() => { setEditing(null); setSaveError(null) }}>Cancel</Button>
                  <Button variant="dark" onClick={() => void save()} loading={saving}>Save</Button>
                </div>
              </div>
            ) : open ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">{open.name}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{DOC_KIND[open.kind].label}</span>
                      {open.signable && <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">Can be signed online</span>}
                      {!open.active && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Not in use</span>}
                      {unknownFields(open.body, open.subject).length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700"><AlertTriangle size={10} /> fields with nothing behind them</span>
                      )}
                    </div>
                  </div>
                  {mayEdit && <Button size="sm" onClick={() => { setSaveError(null); setEditing({ id: open.id, draft: draftOf(open) }) }}><Pencil size={13} /> Edit</Button>}
                </div>
                <Reading template={open} />
              </>
            ) : (
              <EmptyState title="Pick something on the left to read it." icon={<BookOpen size={20} />} />
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function Reading({ template }: { template: DocumentTemplate }) {
  const { settings } = useBuild()
  const [filled, setFilled] = useState(true)
  const values = sampleValues()
  const used = fieldsUsed(template.body, template.subject)
  const unknown = unknownFields(template.body, template.subject)
  const show = (s: string) => (filled ? renderTemplate(s, values).text : s)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {([[false, 'Merge fields'], [true, 'Example data']] as const).map(([id, label]) => (
            <button key={label} type="button" onClick={() => setFilled(id)} aria-pressed={filled === id}
              className={clsx('rounded-md px-2.5 py-1 text-xs font-medium transition', filled === id ? 'bg-ink-950 text-white' : 'text-slate-500 hover:text-slate-700')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {template.subject && (
        <div className="border-b border-slate-100 px-5 py-3">
          <span className="mb-1 block text-[10px] tracking-wide text-slate-400 uppercase">Email subject</span>
          <span className="text-[13px] font-medium text-slate-900">{show(template.subject)}</span>
        </div>
      )}
      <div className="bg-slate-100 px-2 py-4 sm:px-5 sm:py-5">
        <DocumentSheet company={settings} body={show(template.body)} signable={template.signable} clientName={filled ? values.client_name : '{{client_name}}'} />
      </div>
      <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
        <p className="mb-1.5 text-[10px] tracking-wide text-slate-400 uppercase">Fields used</p>
        <div className="flex flex-wrap gap-1.5">
          {used.length === 0 && <span className="text-xs text-slate-400">None.</span>}
          {used.map((k) => (
            <span key={k} className={clsx('rounded px-1.5 py-0.5 font-mono text-[10px]', unknown.includes(k) ? 'bg-red-50 text-red-700' : 'bg-slate-200/70 text-slate-700')}>{`{{${k}}}`}</span>
          ))}
        </div>
        {unknown.length > 0 && <p className="mt-2.5 border-l-2 border-red-300 pl-2.5 text-xs text-red-700">Remus cannot fill {unknown.length === 1 ? 'that one' : 'those'} in: the document would show the braces.</p>}
      </div>
    </>
  )
}

/** Raptor's TemplateEditor, for words: the kind, the name, the subject, the words, and the fields to put in. */
function TemplateEditor({ draft, onChange }: { draft: TemplateDraft; onChange: (d: TemplateDraft) => void }) {
  const body = useRef<HTMLTextAreaElement>(null)
  const groups = useMemo(() => {
    const g = new Map<MergeField['group'], MergeField[]>()
    for (const f of MERGE_FIELDS) g.set(f.group, [...(g.get(f.group) ?? []), f])
    return [...g]
  }, [])
  /* The field goes in where the cursor is, as Raptor's chips do, and the cursor lands after it. */
  function insert(key: string) {
    const el = body.current
    const token = `{{${key}}}`
    if (!el) return onChange({ ...draft, body: draft.body + token })
    const start = el.selectionStart ?? draft.body.length
    const end = el.selectionEnd ?? start
    const next = draft.body.slice(0, start) + token + draft.body.slice(end)
    onChange({ ...draft, body: next })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
  }
  const unknown = unknownFields(draft.body, draft.subject)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="e.g. Building contract" /></Field>
        <Field label="Kind">
          <select className="input" value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.target.value as DocKind })}>
            {DOC_KINDS.map((k) => <option key={k} value={k}>{DOC_KIND[k].label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Email subject" hint="Used when the document is emailed. Fields work here too.">
        <input className="input" value={draft.subject ?? ''} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
      </Field>
      <Field label="The words" hint={'"# " starts a heading, "## " a smaller one, "- " a bullet, **words** in bold.'}>
        <textarea ref={body} className="input min-h-[320px] font-mono text-[12.5px] leading-relaxed" value={draft.body} onChange={(e) => onChange({ ...draft, body: e.target.value })} data-testid="template-body" />
      </Field>
      <div>
        <p className="label">Put in a field</p>
        <div className="space-y-1.5">
          {groups.map(([group, fields]) => (
            <div key={group} className="flex flex-wrap items-center gap-1">
              <span className="w-16 shrink-0 text-[10px] tracking-wide text-slate-400 uppercase">{group}</span>
              {fields.map((f) => (
                <button key={f.key} type="button" onClick={() => insert(f.key)} title={`{{${f.key}}}, e.g. ${f.example}`}
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:border-brand-400 hover:bg-brand-50">{f.label}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
      {unknown.length > 0 && <p className="text-xs text-red-700">Remus cannot fill {unknown.map((k) => `{{${k}}}`).join(', ')}.</p>}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={draft.signable} onChange={(e) => onChange({ ...draft, signable: e.target.checked })} /> Has a place to sign (and can be signed online)</label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={draft.active} onChange={(e) => onChange({ ...draft, active: e.target.checked })} /> In use</label>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the letterhead */

function Letterhead() {
  const { settings } = useBuild()
  const access = useAccess()
  const sample = '{{today}}\n\n{{client_name}}\n{{client_address}}\n\nDear {{client_name}},\n\n**{{project_name}}**\n\nThis is how every document from the Library looks on paper and in its PDF: the company\'s logo and details at the top, the words, and the company\'s name and numbers at the foot of each page.\n\nKind regards,\n\n{{sender_name}}\n{{company_name}}'
  const missing = [
    !settings?.logo_url && 'logo',
    !settings?.address && 'address',
    !settings?.phone && 'phone',
    !settings?.reg_no && 'registration number',
    !settings?.vat_no && 'VAT number',
    !settings?.bank_details && 'banking details',
  ].filter(Boolean) as string[]
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card title="Where it comes from" subtitle="The company's details in Settings, the same as on every quote.">
        <dl className="space-y-1.5 pb-2 text-sm">
          {([
            ['Name', settings?.name], ['Address', settings?.address], ['Phone', settings?.phone], ['Email', settings?.email],
            ['Registration no.', settings?.reg_no], ['VAT no.', settings?.vat_no], ['Logo', settings?.logo_url ? 'Uploaded' : null],
            ['Banking details', settings?.bank_details ? 'Filled in' : null],
          ] as [string, string | null | undefined][]).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className={clsx('min-w-0 break-words', v ? 'text-slate-800' : 'text-slate-400')}>{v || 'not filled in'}</dd></div>
          ))}
        </dl>
        {missing.length > 0 && <p className="mb-2 text-xs text-amber-700">Missing: {missing.join(', ')}. Fill them in so documents carry them.</p>}
        {seesMoney(access) && <Link to={paths.settings('Company')} className="mb-2 inline-flex text-sm font-medium text-brand-700 hover:underline">Change them in Settings → Company</Link>}
      </Card>
      <div className="min-w-0 rounded-xl bg-slate-100 p-2 sm:p-5" data-testid="letterhead-preview">
        <DocumentSheet company={settings} body={renderTemplate(sample, { ...sampleValues(), company_name: settings?.name ?? sampleValues().company_name }).text} />
      </div>
    </div>
  )
}
