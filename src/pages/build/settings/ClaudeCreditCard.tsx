import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { loadClaudeCredit, loadSlipReading, updateSettings, usdAndZar, USD_TO_ZAR, type ClaudeCredit, type SlipReadingMonth } from '../../../lib/api'
import { formatZAR } from '../../../lib/format'
import { useAccess } from '../../../lib/access'
import { paths } from '../paths'
import { Button, Card, ErrorBanner, Field } from '../../../components/ui'
import { NumInput } from '../../../components/ui/NumInput'
import { useBuild } from '../BuildContext'

/**
 * CLAUDE CREDIT (Remus · Handoff 1). Stephan: "I want to see how many credits do we have, we use and
 * how many credits do we have left." Anthropic does not tell an app its balance, so the person enters
 * what was bought in the Claude Console and Remus subtracts what it has recorded spending
 * (0019_ai_usage.sql). Said on the card, so nobody reads Remus's count as Anthropic's.
 */
export function ClaudeCreditCard() {
  const { settings, reloadSettings } = useBuild()
  const [bought, setBought] = useState<number>(0)
  const [credit, setCredit] = useState<ClaudeCredit | null>(null)
  const [slips, setSlips] = useState<SlipReadingMonth[] | null>(null)
  const admin = useAccess() === 'admin'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setBought(settings.ai_credit_usd)
    loadClaudeCredit(settings.ai_credit_usd).then(setCredit).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    loadSlipReading().then(setSlips).catch(() => setSlips([]))
  }, [settings])

  async function save() {
    setSaving(true); setError(null)
    try {
      await updateSettings({ ai_credit_usd: Math.max(0, bought) })
      reloadSettings()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Bot size={17} /> Claude credit</span>} subtitle="What Find prices (Combined and Claude) and the slip reader spend.">
      <ErrorBanner error={error} />
      {credit && (
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <Figure label="Bought" value={usdAndZar(credit.boughtUsd)} />
          <Figure label="Used" value={usdAndZar(credit.usedUsd)} hint={`${usdAndZar(credit.monthUsd)} this month`} />
          <Figure label="Left" value={usdAndZar(credit.leftUsd)} strong />
        </div>
      )}
      {/* Remus · Handover 7, Stephan: "Log tokens used and estimated cost per slip ... so we can see the monthly total in the app." */}
      <div className="mb-4 rounded-xl border border-slate-200 p-3" data-testid="slip-reading-months">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">Slip reading, month by month</p>
          {admin && <Link to={paths.slipTest()} className="text-xs font-medium text-brand-700 hover:underline">Old against new reader →</Link>}
        </div>
        {!slips ? <p className="text-xs text-slate-400">Loading…</p> : slips.length === 0 ? <p className="text-xs text-slate-500">No slips read in the last six months.</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {slips.map((m) => (
                <tr key={m.month}>
                  <td className="py-1 pr-2 text-slate-600">{new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</td>
                  <td className="tabular py-1 pr-2 text-right">{m.slips} slip{m.slips === 1 ? '' : 's'}</td>
                  <td className="tabular py-1 pr-2 text-right font-semibold">{usdAndZar(m.usd)}</td>
                  <td className="tabular py-1 text-right text-xs text-slate-500">≈ {formatZAR((m.usd * USD_TO_ZAR) / m.slips, { decimals: 2 })} a slip</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Field label="Credit bought, all together (US$)" hint="Add each top-up you buy in the Claude Console. Rand is a guide at R18 to the dollar. Remus counts what it spends; the Console's own figure is the final word.">
        <div className="flex gap-2">
          <NumInput prefix="$" value={bought} onValue={(n) => setBought(n)} />
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!settings || bought === settings.ai_credit_usd}>Save</Button>
        </div>
      </Field>
    </Card>
  )
}

function Figure({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular text-base font-bold ${strong ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
