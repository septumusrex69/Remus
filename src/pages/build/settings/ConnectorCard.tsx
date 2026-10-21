import { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { createApiToken, listApiTokens, revokeApiToken } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, ErrorBanner } from '../../../components/ui'

/** Personal access tokens for connecting your own Claude to Remus (api/mcp.ts). */
export function ConnectorCard() {
  const tokens = useLoad(() => listApiTokens(), [], 'api-tokens')
  const [name, setName] = useState('Claude')
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `${window.location.origin}/api/mcp`

  async function create() {
    setBusy(true)
    setError(null)
    try {
      setCreated(await createApiToken(name))
      tokens.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Anything using it stops working straight away.')) return
    try {
      await revokeApiToken(id)
      tokens.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  const CopyRow = ({ label, value }: { label: string; value: string }) => (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs">{value}</code>
        <Button size="sm" onClick={() => copy(label, value)} aria-label={`Copy ${label}`}>{copied === label ? <Check size={14} /> : <Copy size={14} />}</Button>
      </div>
    </div>
  )

  return (
    <Card title="Claude connector">
      <ErrorBanner error={error} />
      <p className="text-sm text-slate-600">
        Connect your own Claude to Remus so it can look up projects and quotes, file slips you photograph in a chat, add site diary entries and draft quotes for you to review.
        Claude acts as you, with your access.
      </p>

      {created ? (
        <div className="mt-4 space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-brand-900">Copy this now. It won't be shown again.</p>
          <CopyRow label="Claude.ai connector URL" value={`${base}?key=${created}`} />
          <CopyRow label="Claude Code" value={`claude mcp add --transport http remus ${base} --header "Authorization: Bearer ${created}"`} />
          <p className="text-xs text-brand-900">
            In Claude: Settings → Connectors → Add custom connector, name it "Remus" and paste the connector URL. Treat the URL like a password.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Done</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className="input w-44" value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" placeholder="e.g. Claude on my phone" />
          <Button size="sm" variant="dark" onClick={create} loading={busy}><KeyRound size={14} /> Create connection</Button>
        </div>
      )}

      {(tokens.data ?? []).length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name} <span className="font-normal text-slate-400">…{t.token_hint}</span></span>
                <span className="block text-xs text-slate-500">
                  Created {formatDateTime(t.created_at)} · {t.last_used_at ? `last used ${formatDateTime(t.last_used_at)}` : 'not used yet'}
                </span>
              </span>
              <Button size="sm" variant="danger" onClick={() => revoke(t.id)}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
