import { useEffect, useState } from 'react'
import { ExternalLink, UserPlus } from 'lucide-react'
import { Button, Card, ErrorBanner, Field, Modal } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { useAuth } from '../../store/AuthContext'
import { addSubscriberByHand, listSubscribers, removeSubscriber, type Subscriber } from '../../lib/newsApi'

/**
 * THE PEOPLE WHO ASKED FOR OUR NEWS (Remus · Handover 8). Stephan asked for "sign-up": the public page /subscribe
 * (no login, a link to put on the website or in an email signature), people imported from a list, and anybody who
 * said yes to us in person. Each shows WHEN and HOW they said yes -- POPIA's record. Raptor keeps these people as
 * leads; Remus has no leads, so they are here.
 */
const HOW: Record<string, string> = {
  'sign-up page': 'Signed up on the page',
  'opt-in link': 'Pressed “Yes, keep me informed”',
  'imported with consent': 'Said yes before import',
  'recorded by staff': 'Said yes to us',
}

export function SubscribersCard() {
  const { currentUser } = useAuth()
  const [rows, setRows] = useState<Subscriber[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', company: '', consentNote: '' })
  const [busy, setBusy] = useState(false)

  const load = () => listSubscribers().then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => { void load() }, [])

  const yes = (rows ?? []).filter((r) => r.consent_at)
  const waiting = (rows ?? []).filter((r) => !r.consent_at)
  const signUpUrl = `${window.location.origin}/subscribe`

  async function add() {
    if (!currentUser) return
    setBusy(true); setError(null)
    try {
      await addSubscriberByHand(form, currentUser.id)
      setAdding(false); setForm({ email: '', name: '', company: '', consentNote: '' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function remove(r: Subscriber) {
    if (!window.confirm(`Take ${r.email} off the list altogether? Their record is deleted.`)) return
    try { await removeSubscriber(r.id); await load() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <Card title={`People who signed up (${yes.length})`} subtitle={`Not clients, but asked for our news.${waiting.length ? ` ${waiting.length} more have not said yes yet (waiting to confirm, or imported without a yes).` : ''}`}
      actions={<Button size="sm" onClick={() => setAdding(true)} data-testid="news-add-subscriber"><UserPlus size={14} /> Add somebody who said yes</Button>}>
      <div className="space-y-3" data-testid="news-subscribers">
        <p className="text-sm text-slate-600">
          The sign-up page, for the website or an email signature:{' '}
          <a href={signUpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-brand-700 hover:underline" data-testid="news-signup-link">
            {signUpUrl} <ExternalLink size={12} />
          </a>
        </p>
        <ErrorBanner error={error} />
        {rows && rows.length > 0 && (
          <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide the list' : 'Show who, and how they said yes'}</button>
        )}
        {open && rows && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="font-medium text-slate-800">{r.name || r.email}</span>
                {r.name && <span className="break-all text-slate-500">{r.email}</span>}
                {r.company && <span className="text-slate-400">{r.company}</span>}
                <span className="text-xs text-slate-500">
                  {r.consent_at ? `${HOW[r.consent_how ?? ''] ?? 'Said yes'} · ${formatDate(r.consent_at)}` : r.source === 'sign-up page' ? 'Waiting for them to confirm' : 'No yes yet: an invitation only'}
                </span>
                <button type="button" className="ml-auto text-xs text-slate-400 hover:text-red-600" onClick={() => void remove(r)}>Remove</button>
                {r.consent_note && <span className="w-full text-xs text-slate-400">{r.consent_note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Somebody who said yes"
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void add()} disabled={!form.email.trim() || !form.consentNote.trim()}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Company (optional)"><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
          <Field label="Where and how they said yes" hint="POPIA needs a record: e.g. “Asked on site at 12 Brooklyn Road, 5 Nov”. Recorded with your name and today’s date.">
            <input className="input" value={form.consentNote} onChange={(e) => setForm({ ...form, consentNote: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}
