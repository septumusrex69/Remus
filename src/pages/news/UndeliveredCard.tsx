import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MailX } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Card, ErrorBanner, Field, Modal } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { paths } from '../../pages/build/paths'
import { listStopped, recordStop, type Preference } from '../../lib/newsApi'

/**
 * WHO IS NEVER SENT NEWS, AND WHY (Remus · Handover 8; Raptor's UndeliveredCard, 22 Oct, widened).
 *
 * Raptor's firm: bounces "just clog up the inbox ... Raptor should be flagged ... these ones didn't deliver, because
 * of the following reasons ... contact them to update their email addresses." A bounce never reaches anybody's inbox
 * (it returns to Resend); the webhook marks a hard bounce undeliverable and a spam report unsubscribed, and this card
 * LISTS them, with the reason and the client record to fix the address on.
 *
 * Remus adds the unsubscribes to the same card -- everybody who is never sent news, in one place -- and "Somebody
 * asked us to stop": a person who phones and says so is recorded as staff's (Raptor records it on the client page).
 */
interface Row extends Preference { name: string | null; link: string | null }

const HOW: Record<string, string> = {
  'unsubscribe link': 'Unsubscribed (the link in the email)',
  'one-click header': 'Unsubscribed (their mail program’s button)',
  'recorded by staff': 'Asked us to stop',
  complaint: 'Marked it as spam',
  'hard bounce': 'The address does not exist',
}

export function UndeliveredCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ email: '', reason: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const prefs = await listStopped()
    const emails = prefs.map((p) => p.email)
    const who = new Map<string, { name: string | null; link: string | null }>()
    for (let i = 0; i < emails.length; i += 100) {
      const { data: sends } = await supabase.from('marketing_sends').select('email, first_name, company_name, contact_id, company_id, sent_at')
        .in('email', emails.slice(i, i + 100)).order('sent_at', { ascending: false })
      for (const s of (sends ?? []) as Record<string, string | null>[]) {
        const email = s.email as string
        if (who.has(email)) continue
        who.set(email, {
          name: s.first_name || s.company_name || null,
          link: s.contact_id ? paths.contact(s.contact_id) : s.company_id ? paths.company(s.company_id) : null,
        })
      }
    }
    setRows(prefs.map((p) => ({ ...p, name: who.get(p.email)?.name ?? null, link: who.get(p.email)?.link ?? null })))
  }
  useEffect(() => { load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))) }, [])

  async function add() {
    setBusy(true); setError(null)
    try { await recordStop(form.email, form.reason); setAdding(false); setForm({ email: '', reason: '' }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const bounced = (rows ?? []).filter((r) => r.status === 'undeliverable')
  const stopped = (rows ?? []).filter((r) => r.status === 'unsubscribed')
  return (
    <Card title={`Never sent news (${(rows ?? []).length})`} subtitle={`${stopped.length} unsubscribed or asked us to stop · ${bounced.length} didn’t arrive. Fix a wrong address on the client, or leave them off.`}
      actions={<Button size="sm" onClick={() => setAdding(true)} data-testid="news-record-stop">Somebody asked us to stop</Button>}>
      <div data-testid="news-stopped">
        <ErrorBanner error={error} />
        {rows && rows.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} data-testid="undelivered-toggle" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
            <MailX size={14} /> {open ? 'Hide the list' : 'Show who, and why'}
          </button>
        )}
        {open && rows && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm" data-testid="undelivered-list">
            {rows.map((r) => (
              <li key={r.email} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="font-medium text-slate-800">{r.name || r.email}</span>
                {r.name && <span className="break-all text-slate-500">{r.email}</span>}
                <span className={r.status === 'undeliverable' ? 'text-red-600' : 'text-slate-600'}>{r.status === 'undeliverable' ? r.reason || HOW['hard bounce'] : HOW[r.how] ?? 'Unsubscribed'}</span>
                <span className="text-slate-400">{formatDate(r.changed_at)}</span>
                {r.link && r.status === 'undeliverable' && <Link to={r.link} className="ml-auto text-brand-700 hover:underline">Fix the address</Link>}
                {r.reason && r.status !== 'undeliverable' && <span className="w-full text-xs text-slate-400">{r.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Somebody asked us to stop"
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!form.email.includes('@')} onClick={() => void add()}>Record it</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">They will never be sent news again, whichever list they are on, until they sign up again themselves.</p>
          <Field label="Their email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="What they said (optional)"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  )
}
