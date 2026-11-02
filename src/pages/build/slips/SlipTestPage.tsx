import { useRef, useState } from 'react'
import { Check, Images, Loader2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { listSlipTrials, runSlipTrial, saveSlipTruth, USD_TO_ZAR, type SlipFields, type SlipTrial } from '../../../lib/api'
import { FIELD_LABEL, SLIP_TRIAL_FIELDS, sameValue, summariseTrials, type SlipTrialField } from '../../../lib/slipTrial'
import { formatZAR } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { Button, Card, ErrorBanner, PageHeader } from '../../../components/ui'
import { RECEIPTS_BUCKET, supabase } from '../../../lib/supabase'

/**
 * THE SLIP READER, OLD AGAINST NEW (Remus · Handover 7). Stephan: "Run 20 real slips (mix of clear, faded and
 * crumpled) through both the old and new setup. Give me a side-by-side comparison of accuracy per field and cost per
 * slip. Only make the new setup live once I approve the results."
 *
 * Choose slips -> each is stored as Snap slip stores it and read by both readers on the server
 * (api/receipts/compare.ts) -> the two answers sit side by side; type what is really on the slip where they are wrong
 * (or tick the one that is right) and the score at the top counts it. Administrators only. Remove this page with
 * api/_lib/slipReaderBaseline.ts once the test is decided.
 */
export function SlipTestPage() {
  const admin = useAccess() === 'admin'
  const { data: trials, reload, error: loadError } = useLoad(() => listSlipTrials(), [], 'slip-trials')
  const [running, setRunning] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  async function run(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const list = Array.from(files)
    setRunning(list.map((f) => f.name))
    // Two at a time: quick enough, and gentle on the phone's upload.
    const queue = [...list]
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try { await runSlipTrial(f) } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
        setRunning((r) => r.filter((n) => n !== f!.name))
        reload()
      }
    }
    await Promise.all([worker(), worker()])
  }

  if (!admin) return <div><PageHeader title="Slip reader test" /><p className="text-sm text-slate-500">Only an Administrator can run the slip test.</p></div>

  const s = summariseTrials(trials ?? [])
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const zar = (usd: number) => formatZAR(usd * USD_TO_ZAR, { decimals: usd * USD_TO_ZAR < 1 ? 3 : 2 })

  return (
    <div className="space-y-4">
      <PageHeader title="Slip reader test" subtitle="The same slips read by the old reader and the new one, side by side." />
      <ErrorBanner error={error ?? (loadError ? String(loadError) : null)} />
      <input ref={filesRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void run(e.target.files); e.target.value = '' }} />

      <Card title="The score" subtitle={s.checked < s.slips ? `${s.slips} slips read, ${s.checked} checked against the slip. Tick or type the right answer on each one below.` : `${s.slips} slips, all checked.`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="slip-test-score">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Field</th>
                <th className="py-1.5 pr-3 font-medium">Old (Sonnet) right</th>
                <th className="py-1.5 pr-3 font-medium">New (Haiku) right</th>
                <th className="py-1.5 font-medium">The two agree</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.fields.map((f) => (
                <tr key={f.field}>
                  <td className="py-1.5 pr-3">{FIELD_LABEL[f.field]}</td>
                  <td className="tabular py-1.5 pr-3">{f.checked ? `${f.oldRight} of ${f.checked} · ${pct(f.oldRight, f.checked)}` : '—'}</td>
                  <td className={clsx('tabular py-1.5 pr-3', f.checked && f.newRight < f.oldRight && 'font-semibold text-red-700')}>{f.checked ? `${f.newRight} of ${f.checked} · ${pct(f.newRight, f.checked)}` : '—'}</td>
                  <td className="tabular py-1.5">{pct(f.agree, f.compared)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5 pr-3">Cost a slip</td>
                <td className="tabular py-1.5 pr-3">{s.slips ? `$${s.oldUsdPerSlip.toFixed(4)} ≈ ${zar(s.oldUsdPerSlip)}` : '—'}</td>
                <td className="tabular py-1.5 pr-3">{s.slips ? `$${s.newUsdPerSlip.toFixed(4)} ≈ ${zar(s.newUsdPerSlip)}` : '—'}</td>
                <td className="tabular py-1.5">{s.slips && s.newUsdPerSlip ? `${Math.round(s.oldUsdPerSlip / s.newUsdPerSlip)}× cheaper` : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => filesRef.current?.click()} disabled={running.length > 0}><Images size={16} /> Add slips to the test</Button>
          {running.length > 0 && <span className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Reading {running.length} slip{running.length === 1 ? '' : 's'} both ways…</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Each slip is read twice (about R0.60 for the old reader, about a cent for the new). The slips are stored like any slip; they do not become expenses.</p>
      </Card>

      {(trials ?? []).slice().reverse().map((t, i, all) => <TrialCard key={t.id} n={all.length - i} trial={t} onSaved={reload} />)}
    </div>
  )
}

function TrialCard({ n, trial, onSaved }: { n: number; trial: SlipTrial; onSaved: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [truth, setTruth] = useState<Partial<SlipFields>>(trial.truth ?? {})
  const [saving, setSaving] = useState(false)
  const o = trial.old_result?.extraction ?? {}
  const nw = trial.new_result?.extraction ?? {}
  const dirty = JSON.stringify(truth) !== JSON.stringify(trial.truth ?? {})

  async function show() {
    const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(trial.path, 600)
    setUrl(data?.signedUrl ?? null)
  }
  async function save(next = truth) {
    setSaving(true)
    try { await saveSlipTruth(trial.id, next); onSaved() } finally { setSaving(false) }
  }
  /** Both readers agree, or the one picked is right: take those values as the truth for every field at once. */
  function takeAll(from: 'old' | 'new') {
    const src = from === 'old' ? o : nw
    const next: Partial<SlipFields> = {}
    for (const f of SLIP_TRIAL_FIELDS) next[f] = (src[f] ?? null) as never
    setTruth(next)
    void save(next)
  }
  const show$ = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="text-slate-400">—</span> : String(v))

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-sm">
        <span className="font-semibold text-slate-800">#{n} · {trial.label ?? trial.path.split('/').pop()}</span>
        <span className="text-xs text-slate-500">
          Old {trial.old_input_tokens?.toLocaleString()} + {trial.old_output_tokens} tokens · ${Number(trial.old_usd ?? 0).toFixed(4)} · {((trial.old_ms ?? 0) / 1000).toFixed(1)}s
          {'  |  '}
          New {trial.new_input_tokens?.toLocaleString()} + {trial.new_output_tokens} tokens · ${Number(trial.new_usd ?? 0).toFixed(4)} · {((trial.new_ms ?? 0) / 1000).toFixed(1)}s
          {trial.sent_width ? ` · sent ${trial.sent_width}×${trial.sent_height}, ${Math.round((trial.bytes_sent ?? 0) / 1024)} KB of ${Math.round((trial.bytes_in ?? 0) / 1024)} KB` : ''}
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="flex items-center justify-center bg-slate-900 p-2">
          {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Slip" className="max-h-80 w-auto object-contain" /></a>
            : <Button size="sm" onClick={() => void show()}>Show the slip</Button>}
        </div>
        <div className="overflow-x-auto p-3">
          {(trial.old_result?.error || trial.new_result?.error) && (
            <p className="mb-2 text-xs text-red-700">{trial.old_result?.error && `Old reader: ${trial.old_result.error}. `}{trial.new_result?.error && `New reader: ${trial.new_result.error}.`}</p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Field</th>
                <th className="py-1 pr-2 font-medium">Old (Sonnet)</th>
                <th className="py-1 pr-2 font-medium">New (Haiku)</th>
                <th className="py-1 font-medium">On the slip</th>
              </tr>
            </thead>
            <tbody>
              {SLIP_TRIAL_FIELDS.map((f: SlipTrialField) => {
                const t = truth[f]
                const known = f in truth
                const mark = (v: unknown) => known ? (sameValue(f, v as never, t as never) ? 'text-emerald-700' : 'font-semibold text-red-700') : (sameValue(f, o[f] as never, nw[f] as never) ? '' : 'text-amber-700')
                return (
                  <tr key={f} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-slate-600">{FIELD_LABEL[f]}</td>
                    <td className={clsx('tabular py-1 pr-2', mark(o[f]))}>{show$(o[f])}</td>
                    <td className={clsx('tabular py-1 pr-2', mark(nw[f]))}>{show$(nw[f])}</td>
                    <td className="py-1">
                      <input className="input h-8 py-1 text-sm" value={t === null || t === undefined ? '' : String(t)} placeholder={known ? 'nothing printed' : 'type it'}
                        onChange={(e) => {
                          const raw = e.target.value
                          const v = raw === '' ? null : f === 'total_incl' || f === 'vat' ? (Number.isFinite(Number(raw)) ? Number(raw) : raw) : raw
                          setTruth((x) => ({ ...x, [f]: v }))
                        }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Right answers:</span>
            <Button size="sm" variant="ghost" onClick={() => takeAll('old')}><Check size={13} /> Old is right</Button>
            <Button size="sm" variant="ghost" onClick={() => takeAll('new')}><Check size={13} /> New is right</Button>
            {dirty && <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save what's on the slip</Button>}
            {trial.truth && <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={13} /> Checked</span>}
            {!trial.truth && !dirty && <span className="inline-flex items-center gap-1 text-slate-400"><X size={13} /> Not checked yet</span>}
          </div>
          {(nw.line_items?.length ?? 0) + (o.line_items?.length ?? 0) > 0 && (
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer">Line items: old {o.line_items?.length ?? 0}, new {nw.line_items?.length ?? 0}</summary>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                {[['Old', o.line_items], ['New', nw.line_items]].map(([who, items]) => (
                  <ul key={who as string} className="space-y-0.5">
                    <li className="font-semibold">{who as string}</li>
                    {((items as { description: string; quantity: number | null; amount: number | null }[]) ?? []).map((li, k) => (
                      <li key={k} className="flex justify-between gap-2"><span className="truncate">{li.quantity && li.quantity !== 1 ? `${li.quantity} × ` : ''}{li.description}</span><span className="tabular">{li.amount ?? ''}</span></li>
                    ))}
                  </ul>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </Card>
  )
}
