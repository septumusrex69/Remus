import { useEffect, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { Button, Card, ErrorBanner, Field } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { IMPORT_OUTCOMES, importList, listLists, previewImport, type ImportOutcome, type ImportPreview, type MarketingList } from '../../lib/newsApi'

/**
 * IMPORT A LIST FROM A CSV FILE (Remus · Handover 8; Raptor's ImportListCard, S10 22 Oct, adapted).
 *
 * Two presses, as every import in Raptor has: reading the file and counting what it would do is free and repeatable;
 * writing is separate and deliberate. The counts are the SERVER's, from the same plan it writes with. The file is
 * never stored.
 *
 * DIFFERENT FROM RAPTOR: Raptor's imported people can only ever be sent ONE introduction. Remus asks, on the import,
 * whether these people already said yes, and WHERE ("signed up at our stand at the home show"): with that, each is
 * recorded as having said yes (POPIA's record: where, when, and who imported them) and gets news; without it, each
 * can be sent one invitation and nothing more, as in Raptor.
 */
const OUTCOME_WORDS: Record<ImportOutcome, string> = {
  new: 'new',
  'already on our list': 'already on our list',
  'already a client': 'already a client (they get news as clients)',
  'bad email': 'address does not look right',
  'duplicate in file': 'in the file twice',
}

export function ImportListCard() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [saidYes, setSaidYes] = useState(false)
  const [consentNote, setConsentNote] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [lists, setLists] = useState<MarketingList[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => { if (open) listLists().then(setLists).catch(() => setLists([])) }, [open])

  async function read(f: File) {
    setFile(f); setPreview(null); setError(null); setDone(null)
    if (!name) setName(f.name.replace(/\.csv$/i, ''))
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') { setError('Choose a .csv file. In Excel: File → Save As → CSV.'); return }
    setBusy('read')
    try {
      const text = await f.text()
      setCsv(text)
      setPreview(await previewImport(text))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  async function write() {
    if (!preview) return
    setBusy('write'); setError(null)
    try {
      const out = await importList(csv, name, file?.name ?? null, saidYes ? consentNote : '')
      setDone(`${out.written} ${out.written === 1 ? 'person' : 'people'} added from “${name.trim()}”. ${out.withConsent ? 'They get our news.' : 'They can now be sent one invitation.'}`)
      setPreview(null); setFile(null); setCsv(''); setSaidYes(false); setConsentNote('')
      setLists(await listLists())
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  if (!open) {
    return <div><Button onClick={() => setOpen(true)} data-testid="news-import-open"><Upload size={15} /> Import a list (CSV)</Button></div>
  }
  return (
    <Card title="Import a list" subtitle="A .csv file with a heading row: an Email column, and name, company and phone if you have them. Each new address is added to the people on our news list.">
      <div className="space-y-3" data-testid="news-import">
        <div className="flex flex-wrap items-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <FileUp size={15} /> {file ? file.name : 'Choose a file'}
            <input type="file" accept=".csv,text/csv" className="sr-only" data-testid="news-import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
          </label>
          <Field label="List name" className="w-full max-w-xs"><input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="news-import-name" /></Field>
        </div>
        {busy === 'read' && <p className="text-sm text-slate-500">Reading and checking against Remus…</p>}
        {preview && (
          <div className="space-y-3" data-testid="news-import-preview">
            <ul className="space-y-0.5 text-sm text-slate-700">
              {IMPORT_OUTCOMES.map((o) => (
                <li key={o} data-testid={`news-import-${o.replace(/ /g, '-')}`}>
                  <b className="tabular-nums">{preview.counts[o]}</b> {OUTCOME_WORDS[o]}
                  {o !== 'new' && preview.examples[o].length > 0 && <span className="text-xs text-slate-400"> — {preview.examples[o].join(', ')}</span>}
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={saidYes} onChange={(e) => setSaidYes(e.target.checked)} data-testid="news-import-said-yes" />
              <span>These people already said yes to receiving our news.</span>
            </label>
            {saidYes ? (
              <Field label="Where and when did they say yes?" hint="Recorded with your name and today’s date (POPIA). E.g. “Signed up at our stand, Pretoria Home Show, March 2026”.">
                <input className="input" value={consentNote} onChange={(e) => setConsentNote(e.target.value)} data-testid="news-import-consent" />
              </Field>
            ) : (
              <p className="text-xs text-slate-500">Without a yes, each new person can be sent ONE invitation with a “Yes, keep me informed” button; anybody who does not press it is never sent news (POPIA s69).</p>
            )}
            <Button variant="primary" onClick={() => void write()} loading={busy === 'write'}
              disabled={!preview.counts.new || !name.trim() || (saidYes && !consentNote.trim()) || !!busy} data-testid="news-import-write">
              Add {preview.counts.new} {preview.counts.new === 1 ? 'person' : 'people'}
            </Button>
          </div>
        )}
        {done && <p className="text-sm text-emerald-700" data-testid="news-import-done">{done}</p>}
        <ErrorBanner error={error} />
        {lists.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Lists imported so far</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm text-slate-600">
              {lists.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                  <span className="text-slate-800">{l.name}</span>
                  <span className="text-xs text-slate-400">{l.subscriber_count} people · {l.file_name ?? 'no file name'} · {formatDate(l.uploaded_at)}{l.consent_note ? ` · said yes: ${l.consent_note}` : ' · invitation only'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
