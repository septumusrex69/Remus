import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ImagePlus, Images, Megaphone, Plus, Send, Trash2, X } from 'lucide-react'
import { Button, Card, ErrorBanner, Field, Modal, Spinner, Table, td, th } from '../../components/ui'
import { formatDate } from '../../lib/format'
import {
  AUDIENCE_LABELS, INVITATION_AUDIENCES, KIND_LABELS, MERGE_FIELDS, OPENS_ARE_APPROXIMATE, RECIPIENT_PAGE,
  campaignRecipients, campaignResults, cancelCampaign, clientPhotos, copyDiaryPhoto, createCampaign, deleteDraft, drainCampaign,
  getCampaign, listCampaigns, listLists, previewAudience, queueCampaign, renderEmail, resultRates, saveCampaign, sendTest,
  senderConfig, uploadNewsPicture,
  type Audience, type AudiencePreview, type CampaignDraft, type CampaignKind, type CampaignResults, type CampaignRow,
  type ClientPhoto, type MarketingList, type NewsPicture, type RecipientRow, type SenderConfig,
} from '../../lib/newsApi'
import { ImportListCard } from './ImportListCard'
import { SubscribersCard } from './SubscribersCard'
import { UndeliveredCard } from './UndeliveredCard'

/**
 * NEWS -- email newsletters to clients, with sign-up and unsubscribe (Remus · Handover 8, 7 Nov 2026).
 *
 * Stephan, 7 Nov, agreeing to "News & campaigns: email newsletters to clients (with sign-up and unsubscribe), e.g.
 * 'We've finished a job in Brooklyn'": "we can start with pretty much all of that."
 *
 * COPIED FROM RAPTOR's src/pages/news/NewsPage.tsx (S10, 21-22 Oct) and adapted: the same list of newsletters with
 * their counts, the same editor (the message on the left, how it reads on the right, who it goes to below, count
 * first then send, a test to yourself), the same results. Stripped: Raptor's leads, prospect campaigns, warm-up and
 * lead audiences. Added for Remus: photos (picked from the site diary, or uploaded), the people who signed up, and
 * the public sign-up page. Administrators only (lib/access.ts; the database holds the same rule, news_may_send).
 *
 * Lists are rules over Remus's own records, never typed; the count and a sample are shown before anything goes;
 * and an address that has said stop is never sent to.
 */
export function NewsPage() {
  const [params] = useSearchParams()
  const id = params.get('c')
  return id ? <CampaignEditor key={id} id={id} /> : <NewsHome />
}

/* ------------------------------------------------------------------------------------------------ the sender */

function useSenderConfig() {
  const [config, setConfig] = useState<SenderConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    senderConfig().then((c) => { if (live) setConfig({ ...c, ready: !!c.ready, missing: c.missing ?? [], steps: c.steps ?? [], problem: c.problem ?? null }) }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  return { config, error }
}

/** What Urban Haus must do before anything can go, in its own words (Raptor's SenderSetup). */
function SenderSetup({ config, error }: { config: SenderConfig | null; error: string | null }) {
  if (error) return <ErrorBanner error={`Sending could not be checked: ${error}`} />
  if (!config || config.ready) return null
  return (
    <Card title="Sending is not set up yet" subtitle={config.problem ?? `Nothing will be sent until ${config.missing.join(' and ')} ${config.missing.length === 1 ? 'is' : 'are'} set. You can write and save newsletters in the meantime.`}>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700" data-testid="news-sender-setup">
        {config.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </Card>
  )
}

/* ------------------------------------------------------------------------------------------------ the list */

const STATUS_WORDS: Record<CampaignRow['status'], string> = { draft: 'Draft', sending: 'Sending', sent: 'Sent', cancelled: 'Stopped' }

function withRate(n: number, rate: number | null): string {
  return rate === null ? String(n) : `${n} (${rate}%)`
}

function describe(a: Audience, lists: Map<string, string>): string {
  if (a.kind !== 'lists') return AUDIENCE_LABELS[a.kind]
  const names = a.listIds.map((id) => lists.get(id)).filter(Boolean)
  return names.length ? `List: ${names.join(', ')}` : 'An imported list'
}

function NewsHome() {
  const navigate = useNavigate()
  const { config, error: configError } = useSenderConfig()
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [counts, setCounts] = useState<Map<string, CampaignResults>>(new Map())
  const [lists, setLists] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listCampaigns().then(({ campaigns, counts: c }) => { setRows(campaigns); setCounts(c) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    listLists().then((l) => setLists(new Map(l.map((x) => [x.id, x.name])))).catch(() => {})
  }, [])

  async function start(kind: CampaignKind) {
    setBusy(true)
    try {
      const month = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
      const c = await createCampaign(kind === 'news' ? `Newsletter ${month}` : `Invitation ${month}`, kind)
      navigate(`/news?c=${c.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="news-home">
      <SenderSetup config={config} error={configError} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-[14rem] flex-1 text-sm text-slate-500">
          News for our clients and for people who asked for it, e.g. “We’ve finished a job in Brooklyn”. Quotes, invoices and emails about a client’s own job never go from here, and unsubscribing does not stop them.
        </p>
        <Button variant="primary" onClick={() => void start('news')} disabled={busy} data-testid="news-new"><Plus size={15} /> New newsletter</Button>
        <Button onClick={() => void start('invitation')} disabled={busy} data-testid="news-new-invitation"><Plus size={15} /> New invitation</Button>
      </div>
      <ErrorBanner error={error} />
      <Card title="Newsletters" subtitle="Every newsletter, newest first, with what happened to it." padded={false}>
        {rows === null ? (
          <div className="p-5"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="news-empty">
            <Megaphone className="mx-auto mb-2 text-slate-300" size={28} />
            No newsletters yet. Start one, choose who it goes to, and send yourself a test first.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Newsletter</th><th className={th}>Goes to</th><th className={th}>Where it stands</th>
                <th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Delivered</th><th className={`${th} text-right`}>Opened</th>
              </tr>
            </thead>
            <tbody data-testid="news-list">
              {rows.map((c) => {
                const n = counts.get(c.id)
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60" data-testid="news-row">
                    <td className={td}>
                      <Link to={`/news?c=${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">{c.name}</Link>
                      <div className="max-w-[22rem] truncate text-xs text-slate-400">{KIND_LABELS[c.kind]}{c.subject ? ` · ${c.subject}` : ''}</div>
                    </td>
                    <td className={`${td} text-slate-600`}>{describe(c.audience, lists)}</td>
                    <td className={`${td} text-slate-600`}>
                      {STATUS_WORDS[c.status]}
                      {c.finished_at && <div className="text-xs text-slate-400">{formatDate(c.finished_at)}</div>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {n ? `${n.accepted} of ${n.total}` : '—'}
                      {n && n.bounced + n.complained + n.failed > 0 && (
                        <div className="text-xs text-slate-400">{[n.failed && `${n.failed} failed`, n.bounced && `${n.bounced} didn’t arrive`, n.complained && `${n.complained} spam reports`].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{n && n.accepted ? withRate(n.delivered, resultRates(n).delivered) : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{n && n.delivered ? withRate(n.opened, resultRates(n).opened) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <SubscribersCard />
      <ImportListCard />
      <UndeliveredCard />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ one newsletter */

const EXCLUSION_ORDER = ['unsubscribed', 'undeliverable', 'no consent recorded', 'already invited once', 'already said yes',
  'already a client', 'no address', 'address does not look right', 'on the list twice']

const KIND_EXPLAINED: Record<CampaignKind, string> = {
  news: 'Goes to clients (unless they unsubscribed) and to people who said yes, from the company’s address.',
  invitation: 'One email to people on an imported list who have never said yes, with a “Yes, keep me informed” button. Each person gets an invitation once, ever. Anybody who does not press it is never sent news.',
}

function CampaignEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const { config, error: configError } = useSenderConfig()
  const [row, setRow] = useState<CampaignRow | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ sent: number; remaining: number; stoppedFor: string | null } | null>(null)
  const [rendered, setRendered] = useState<{ subject: string; html: string; unknown: string[] } | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)

  const load = useCallback(async () => {
    const c = await getCampaign(id)
    setRow(c)
    if (c) setDraft({ name: c.name, kind: c.kind, subject: c.subject, preheader: c.preheader, body: c.body, images: c.images, audience: c.audience })
  }, [id])

  useEffect(() => { load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))) }, [load])

  const locked = !!row && row.status !== 'draft'
  const edit = (patch: Partial<CampaignDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
    if ('audience' in patch || 'kind' in patch) setPreview(null)
  }

  /* HOW IT READS: drawn by the server with the very function the send uses, a moment after the typing stops. */
  const sample = preview?.sample[0] ?? null
  useEffect(() => {
    if (!draft) return
    const t = window.setTimeout(() => {
      renderEmail(draft, sample ? { firstName: sample.firstName, companyName: sample.companyName } : undefined)
        .then(setRendered).catch(() => {})
    }, 500)
    return () => window.clearTimeout(t)
  }, [draft, sample])

  async function save(): Promise<boolean> {
    if (!draft || locked) return true
    try {
      await saveCampaign(id, draft)
      setDirty(false)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setMessage(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  const count = () => run('preview', async () => { if (draft) setPreview(await previewAudience(draft.audience, draft.kind)) })

  const test = () => run('test', async () => {
    if (!(await save())) return
    const r = await sendTest(id)
    setMessage(`A test went to ${r.sentTo}, marked [Test]. Check it in your inbox before sending to anybody else.`)
  })

  /* THE SCREEN DRIVES THE SEND while it is open (Raptor): queue, then drain until nothing is left. */
  const drainLoop = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    try {
      for (let i = 0; i < 300; i += 1) {
        const r = await drainCampaign(id)
        setProgress((p) => ({ sent: (p?.sent ?? 0) + r.sent, remaining: r.remaining, stoppedFor: r.stoppedFor }))
        if (r.remaining === 0) break
        if (r.stoppedFor) await new Promise((res) => setTimeout(res, 20_000))
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      sending.current = false
    }
  }, [id, load])

  const send = () => run('send', async () => {
    if (!draft || !preview) return
    if (!(await save())) return
    if (!window.confirm(`Send “${draft.subject}” to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}? It cannot be called back once it has gone.`)) return
    try {
      const r = await queueCampaign(id)
      setProgress({ sent: r.sent, remaining: r.remaining, stoppedFor: r.stoppedFor })
    } finally {
      await load()
    }
    void drainLoop()
  })

  /* A newsletter already sending when the page opens: carry on driving it. */
  const ready = !!config?.ready
  useEffect(() => { if (row?.status === 'sending' && ready) void drainLoop() }, [row?.status, ready, drainLoop])

  if (error && !row) return <ErrorBanner error={error} />
  if (!row || !draft) return <Spinner />

  const unknown = rendered?.unknown ?? []
  const insertField = (f: string) => {
    const el = bodyRef.current
    const token = `{{${f}}}`
    if (!el) { edit({ body: draft.body + token }); return }
    const at = el.selectionStart ?? draft.body.length
    edit({ body: draft.body.slice(0, at) + token + draft.body.slice(el.selectionEnd ?? at) })
  }
  const canSend = !locked && ready && !!preview && preview.count > 0 && !!draft.subject.trim() && !!draft.body.trim() && unknown.length === 0

  return (
    <div className="space-y-4" data-testid="news-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/news" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> All newsletters</Link>
        {!locked && (
          <Button size="sm" variant="ghost" onClick={() => void run('delete', async () => {
            if (!window.confirm('Delete this draft?')) return
            await deleteDraft(id); navigate('/news')
          })}><Trash2 size={14} /> Delete draft</Button>
        )}
      </div>
      <SenderSetup config={config} error={configError} />
      {locked && (
        <Card>
          <p className="text-sm text-slate-600" data-testid="news-locked">
            {row.status === 'sending' ? 'Sending now.' : row.status === 'sent' ? 'Sent.' : 'Stopped.'}{' '}
            {row.recipient_count ? `${row.recipient_count} on the list. ` : ''}A newsletter that has gone out is a record of what was sent and cannot be changed.
            {progress && ` ${progress.sent} sent so far${progress.remaining ? `, ${progress.remaining} still to go` : ''}.`}
            {progress?.stoppedFor && ` Paused: ${progress.stoppedFor}`}
          </p>
          {row.status === 'sending' && (
            <Button size="sm" variant="danger" className="mt-2" onClick={() => void run('cancel', async () => { await cancelCampaign(id); await load() })}>
              Stop what has not gone yet
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="The message" subtitle="A blank line starts a new paragraph. **Two asterisks** make bold. [Words](https://…) or a bare https:// address make a link.">
          <fieldset disabled={locked} className="min-w-0 space-y-3">
            <div>
              <span className="label">Kind</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
                {(Object.keys(KIND_LABELS) as CampaignKind[]).map((k) => (
                  <Chip key={k} on={draft.kind === k} testid={`news-kind-${k}`}
                    onClick={() => edit({ kind: k, ...(k === 'invitation' && !INVITATION_AUDIENCES.includes(draft.audience.kind) ? { audience: { kind: 'lists', listIds: [] } } : {}) })}>
                    {KIND_LABELS[k]}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{KIND_EXPLAINED[draft.kind]}</p>
            </div>
            <Field label="Name (for us, never shown)"><input className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
            <Field label="Subject"><input className="input" value={draft.subject} placeholder="We’ve finished a job in Brooklyn" onChange={(e) => edit({ subject: e.target.value })} data-testid="news-subject" /></Field>
            <Field label="Preheader (the line an inbox shows after the subject)"><input className="input" value={draft.preheader} onChange={(e) => edit({ preheader: e.target.value })} /></Field>
            <PhotosField campaignId={id} pictures={draft.images} onChange={(images) => edit({ images })} locked={locked} />
            <div>
              <span className="label">Words</span>
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {MERGE_FIELDS.map((f) => (
                  <button key={f} type="button" onClick={() => insertField(f)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">{`{{${f}}}`}</button>
                ))}
              </div>
              <textarea ref={bodyRef} className="input min-h-[14rem]" value={draft.body} onChange={(e) => edit({ body: e.target.value })} data-testid="news-body"
                placeholder={'Hello {{first_name}},\n\nThis month we finished a kitchen and two bathrooms in Brooklyn…\n\nRegards,\nStephan'} />
            </div>
            {unknown.length > 0 && <p className="text-xs text-red-600">Remus does not know {unknown.map((u) => `{{${u}}}`).join(', ')}. Only {MERGE_FIELDS.map((f) => `{{${f}}}`).join(' and ')} are filled in.</p>}
          </fieldset>
          {!locked && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void run('save', async () => { if (await save()) setMessage('Saved.') })} disabled={!dirty || !!busy}>Save draft</Button>
              <Button onClick={() => void test()} disabled={!ready || !!busy} loading={busy === 'test'} data-testid="news-test">Send a test to me</Button>
            </div>
          )}
        </Card>

        <Card title="How it reads" subtitle={`As ${sample?.firstName ?? 'somebody with no first name on file'} will see it, with the company logo from Settings.`}>
          <p className="mb-2 text-sm font-medium text-slate-800" data-testid="news-preview-subject">{rendered?.subject || <span className="text-slate-400">No subject yet</span>}</p>
          <iframe title="Preview" sandbox="" srcDoc={rendered?.html ?? ''} className="h-[30rem] w-full rounded-lg border border-slate-200 bg-white" data-testid="news-preview" />
        </Card>
      </div>

      <Card title="Who it goes to" subtitle="Drawn from Remus’s own clients and the people who signed up, when it is sent. Anybody who has unsubscribed is left out, always.">
        <fieldset disabled={locked} className="min-w-0">
          <AudiencePicker audience={draft.audience} kind={draft.kind} onChange={(audience) => edit({ audience })} />
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void count()} disabled={!!busy} loading={busy === 'preview'} data-testid="news-count-button">Count who gets it</Button>
          {!locked && (
            <Button variant="primary" disabled={!canSend || !!busy} loading={busy === 'send'} onClick={() => void send()} data-testid="news-send">
              <Send size={14} /> {preview ? `Send to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}` : 'Count first, then send'}
            </Button>
          )}
        </div>
        {preview && <PreviewList preview={preview} kind={draft.kind} />}
      </Card>

      {locked && <ResultsPanel campaignId={id} kind={draft.kind} live={row.status === 'sending'} />}

      {message && <p className="text-sm text-emerald-700" data-testid="news-message">{message}</p>}
      {error && <div data-testid="news-error"><ErrorBanner error={error} /></div>}
    </div>
  )
}

function Chip({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: ReactNode; testid?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} data-testid={testid}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------------------------------------ photos */

/**
 * THE PHOTOS: "We've finished a job in Brooklyn" is shown, not told. Picked from the site diary (only photos ticked
 * "show the client") or uploaded; either way copied into the public news store, so a mail program can show them.
 */
function PhotosField({ campaignId, pictures, onChange, locked }: { campaignId: string; pictures: NewsPicture[]; onChange: (p: NewsPicture[]) => void; locked: boolean }) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError(null)
    try {
      const added: NewsPicture[] = []
      for (const f of Array.from(files).slice(0, 12 - pictures.length)) added.push(await uploadNewsPicture(campaignId, f))
      onChange([...pictures, ...added])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div data-testid="news-photos">
      <span className="label">Photos</span>
      {pictures.length > 0 && (
        <ul className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {pictures.map((p, i) => (
            <li key={`${p.url}-${i}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="news-photo">
              <div className="relative">
                <img src={p.url} alt="" className="h-24 w-full object-cover" />
                {!locked && (
                  <button type="button" aria-label="Remove photo" onClick={() => onChange(pictures.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 rounded-full bg-ink-950/70 p-1 text-white hover:bg-ink-950"><X size={12} /></button>
                )}
              </div>
              <input className="w-full border-0 border-t border-slate-100 px-2 py-1 text-xs outline-none" placeholder="Caption (optional)" value={p.caption ?? ''}
                onChange={(e) => onChange(pictures.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
            </li>
          ))}
        </ul>
      )}
      {!locked && pictures.length < 12 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPicking(true)} data-testid="news-photos-diary"><Images size={14} /> From the site diary</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} loading={busy}><ImagePlus size={14} /> Upload a photo</Button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <DiaryPhotoPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => { onChange([...pictures, p]); setPicking(false) }} />
    </div>
  )
}

function DiaryPhotoPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: NewsPicture) => void }) {
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    clientPhotos().then(setPhotos).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [open])
  async function pick(p: ClientPhoto) {
    setBusy(p.id); setError(null)
    try {
      const out = await copyDiaryPhoto(p.id)
      onPick({ url: out.url, caption: out.caption ?? p.project ?? null })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Photos from the site diary" wide>
      <p className="mb-3 text-sm text-slate-500">Only photos ticked “show the client” in the diary. A photo you choose is copied for the email, so anybody with the email can see it.</p>
      <ErrorBanner error={error} />
      {photos === null ? <Spinner /> : photos.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="news-diary-none">No diary photos are ticked “show the client” yet. Tick them in the site diary, or upload a photo instead.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="news-diary-photos">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => void pick(p)} disabled={!!busy}
                className="block w-full overflow-hidden rounded-lg border border-slate-200 text-left hover:border-brand-500 disabled:opacity-50">
                {p.url ? <img src={p.url} alt="" className="h-28 w-full object-cover" /> : <div className="h-28 bg-slate-100" />}
                <div className="truncate px-2 py-1 text-xs text-slate-600">{busy === p.id ? 'Copying…' : p.project || formatDate(p.created_at)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ who it goes to */

function AudiencePicker({ audience, kind, onChange }: { audience: Audience; kind: CampaignKind; onChange: (a: Audience) => void }) {
  const kinds = (Object.keys(AUDIENCE_LABELS) as Audience['kind'][]).filter((k) => kind === 'news' || INVITATION_AUDIENCES.includes(k))
  const pick = (k: Audience['kind']) => onChange(k === 'lists' ? { kind: 'lists', listIds: [] } : { kind: k } as Audience)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who">
        {kinds.map((k) => <Chip key={k} on={audience.kind === k} onClick={() => pick(k)} testid={`news-audience-${k}`}>{AUDIENCE_LABELS[k]}</Chip>)}
      </div>
      <p className="text-xs text-slate-500">
        {audience.kind === 'all_clients' && 'Every client’s own address and every contact on a client. Clients get our news unless they unsubscribe (POPIA allows it for our own clients, with an unsubscribe link in every email).'}
        {audience.kind === 'clients_with_jobs' && 'Only clients with at least one project in Remus.'}
        {audience.kind === 'subscribers' && (kind === 'news' ? 'People who are not clients but said yes: on the sign-up page, by pressing “Yes, keep me informed”, or as recorded by us.' : 'Everybody on our list who has never said yes and has never been invited.')}
        {audience.kind === 'everyone' && 'All clients, and everybody who said yes. Each address once.'}
        {audience.kind === 'lists' && (kind === 'news' ? 'People from the imported lists you tick who said yes.' : 'People from the imported lists you tick who have not said yes yet.')}
      </p>
      {audience.kind === 'lists' && <ListPicker audience={audience} onChange={onChange} />}
    </div>
  )
}

function ListPicker({ audience, onChange }: { audience: Extract<Audience, { kind: 'lists' }>; onChange: (a: Audience) => void }) {
  const [lists, setLists] = useState<MarketingList[] | null>(null)
  useEffect(() => { listLists().then(setLists).catch(() => setLists([])) }, [])
  if (lists === null) return <p className="text-xs text-slate-400">Loading lists…</p>
  if (!lists.length) return <p className="text-xs text-slate-500">No list has been imported yet. Import one on the News page.</p>
  const picked = new Set(audience.listIds)
  return (
    <div className="space-y-1" data-testid="news-list-picker">
      {lists.map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={picked.has(l.id)}
            onChange={(e) => onChange({ ...audience, listIds: e.target.checked ? [...audience.listIds, l.id] : audience.listIds.filter((x) => x !== l.id) })} />
          {l.name} <span className="text-xs text-slate-400">{l.subscriber_count} people · {formatDate(l.uploaded_at)}{l.consent_note ? ' · said yes' : ''}</span>
        </label>
      ))}
    </div>
  )
}

function PreviewList({ preview, kind }: { preview: AudiencePreview; kind: CampaignKind }) {
  const left = useMemo(() => EXCLUSION_ORDER.filter((k) => preview.excluded[k]), [preview])
  return (
    <div className="mt-4 space-y-3" data-testid="news-preview-list">
      <p className="text-sm text-slate-700"><b data-testid="news-count">{preview.count}</b> {preview.count === 1 ? 'address' : 'addresses'}, each once.</p>
      {kind === 'invitation' && preview.count > 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This is the one email each of these {preview.count} will ever get from us unasked. Anybody who does not press “Yes, keep me informed” will <b>never be sent news</b>.
        </p>
      )}
      {left.length > 0 && <p className="text-xs text-slate-500" data-testid="news-excluded">Left out: {left.map((k) => `${preview.excluded[k]} ${k}`).join(' · ')}</p>}
      {preview.sample.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
          {preview.sample.map((s) => (
            <li key={s.email} className="flex flex-wrap gap-x-3 px-3 py-1.5">
              <span className="break-all text-slate-800">{s.email}</span>
              <span className="text-slate-400">{[s.firstName, s.companyName].filter(Boolean).join(' · ')}</span>
              <span className="w-full text-xs text-slate-400">{s.basis}</span>
            </li>
          ))}
          {preview.count > preview.sample.length && <li className="px-3 py-1.5 text-xs text-slate-400">and {preview.count - preview.sample.length} more</li>}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ results */

const STATE_WORDS: Record<RecipientRow['state'], string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent', bounced: 'Didn’t arrive', complained: 'Marked as spam',
}
type RecipientFilter = 'all' | 'undelivered' | 'opened' | 'unopened'

/** "What happened to it" (Raptor's ResultsPanel): the counts, then each person. */
function ResultsPanel({ campaignId, kind, live }: { campaignId: string; kind: CampaignKind; live: boolean }) {
  const [results, setResults] = useState<CampaignResults | null>(null)
  const [rows, setRows] = useState<RecipientRow[] | null>(null)
  const [filter, setFilter] = useState<RecipientFilter>('all')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => Promise.all([campaignResults(campaignId), campaignRecipients(campaignId)])
      .then(([r, list]) => { if (alive) { setResults(r); setRows(list) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    void load()
    const t = live ? window.setInterval(() => void load(), 15_000) : undefined
    return () => { alive = false; if (t) window.clearInterval(t) }
  }, [campaignId, live])
  if (error) return <ErrorBanner error={error} />
  if (!rows) return <Spinner />
  const r = results ?? { campaign_id: campaignId, total: 0, queued: 0, accepted: 0, failed: 0, skipped: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0, opened: 0, clicked: 0, unsubscribed: 0, opted_in: 0 }
  const rates = resultRates(r)
  const tiles = [
    { label: 'Sent', value: r.accepted, rate: null as number | null, of: '' },
    { label: 'Delivered', value: r.delivered, rate: rates.delivered, of: 'of sent' },
    { label: 'Didn’t arrive', value: r.bounced, rate: rates.bounced, of: 'of sent' },
    { label: 'Opened', value: r.opened, rate: rates.opened, of: 'of delivered' },
    { label: 'Clicked', value: r.clicked, rate: rates.clicked, of: 'of delivered' },
    { label: 'Unsubscribed', value: r.unsubscribed, rate: rates.unsubscribed, of: 'of delivered' },
    { label: 'Marked as spam', value: r.complained, rate: rates.complained, of: 'of delivered' },
    ...(kind === 'invitation' ? [{ label: 'Said yes', value: r.opted_in, rate: rates.optedIn, of: 'of delivered' }] : []),
  ]
  const shown = rows.filter((x) => filter === 'all'
    || (filter === 'undelivered' && ['bounced', 'failed', 'skipped'].includes(x.state))
    || (filter === 'opened' && !!x.first_opened_at)
    || (filter === 'unopened' && !x.first_opened_at && x.state === 'sent'))
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
  return (
    <Card title="What happened to it" subtitle={`Of ${r.total} on the list${r.queued ? `, ${r.queued} not sent yet` : ''}${r.skipped ? `, ${r.skipped} not sent (unsubscribed or no longer allowed)` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`}>
      <div data-testid="news-results">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="text-xs text-slate-500">{t.label}</div>
              <div className="text-lg font-semibold text-slate-800 tabular-nums">{t.value}</div>
              <div className="text-xs text-slate-400">{t.rate === null ? (t.of ? '—' : ' ') : `${t.rate}% ${t.of}`}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">{OPENS_ARE_APPROXIMATE}</p>
        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
          {([['all', 'Everybody'], ['undelivered', 'Not delivered'], ['opened', 'Opened'], ['unopened', 'Not opened']] as [RecipientFilter, string][]).map(([k, label]) => (
            <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{label}</Chip>
          ))}
        </div>
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm" data-testid="news-recipients">
          {shown.map((x) => (
            <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="break-all text-slate-800">{x.email}</span>
              <span className="text-xs text-slate-400">{[x.first_name, x.company_name].filter(Boolean).join(' · ')}</span>
              <span className="ml-auto text-xs text-slate-600">
                {STATE_WORDS[x.state]}
                {x.delivered_at && ` · delivered ${when(x.delivered_at)}`}
                {x.first_opened_at && ` · opened${x.open_count > 1 ? ` ${x.open_count}×` : ''}`}
                {x.first_clicked_at && ' · clicked'}
                {x.opted_in_at && ' · said yes'}
                {x.unsubscribed_at && ' · unsubscribed'}
              </span>
              {x.error && x.state !== 'sent' && <span className="w-full text-xs text-slate-400">{x.error}</span>}
              {x.basis && <span className="w-full text-xs text-slate-400">{x.basis}</span>}
            </li>
          ))}
        </ul>
        {rows.length >= RECIPIENT_PAGE && <p className="mt-1 text-xs text-slate-400">The first {RECIPIENT_PAGE} by address. The counts above are the whole newsletter.</p>}
      </div>
    </Card>
  )
}
