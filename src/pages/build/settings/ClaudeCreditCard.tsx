import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { loadClaudeCredit, updateSettings, type ClaudeCredit } from '../../../lib/api'
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setBought(settings.ai_credit_usd)
    loadClaudeCredit(settings.ai_credit_usd).then(setCredit).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
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
          <Figure label="Bought" value={`$${credit.boughtUsd.toFixed(2)}`} />
          <Figure label="Used" value={`$${credit.usedUsd.toFixed(2)}`} hint={`$${credit.monthUsd.toFixed(2)} this month`} />
          <Figure label="Left" value={`$${credit.leftUsd.toFixed(2)}`} strong />
        </div>
      )}
      <Field label="Credit bought, all together (US$)" hint="Add each top-up you buy in the Claude Console. Remus counts what it spends; the Console's own figure is the final word.">
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
      <p className={`tabular text-lg font-bold ${strong ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
