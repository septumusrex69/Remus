import { Check } from 'lucide-react'
import { Card } from '../../../components/ui'
import { THEMES } from '../../../lib/themes'
import { useTheme } from '../../../store/ThemeContext'

/**
 * Picking a skin, copied from Raptor's AppearanceTab. Each option is shown as the thing it
 * produces (a three-colour tile) rather than described in words.
 */
export function AppearanceCard() {
  const { themeId, setTheme, theme } = useTheme()
  return (
    <Card
      title="Appearance"
      subtitle={`Choose how ${theme.productName} looks. This changes nothing but the styling, applies to you only, and never changes what clients receive.`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {THEMES.map((t) => {
          const selected = t.id === themeId
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              aria-pressed={selected}
              className={`rounded-xl border p-3 text-left transition-colors ${
                selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/40' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="flex h-20 overflow-hidden rounded-lg border border-black/5" style={{ backgroundColor: t.swatch.surface }} aria-hidden="true">
                <span className="flex w-1/3 flex-col justify-between p-1.5" style={{ backgroundColor: t.swatch.ground }}>
                  <span className="block h-1.5 w-8 rounded-full bg-white/70" />
                  <span className="block h-2.5 w-full rounded-sm" style={{ backgroundColor: t.swatch.accent, boxShadow: '0 0 0 1px rgba(255,255,255,.12)' }} />
                  <span className="block h-1 w-6 rounded-full bg-white/25" />
                </span>
                <span className="flex flex-1 flex-col gap-1.5 p-2">
                  <span className="block h-2.5 w-2/3 rounded" style={{ backgroundColor: t.swatch.ground, opacity: 0.85 }} />
                  <span className="block h-1.5 w-1/2 rounded bg-black/10" />
                  <span className="mt-auto block h-2.5 w-1/3 rounded" style={{ backgroundColor: t.swatch.accent }} />
                </span>
              </span>
              <span className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700">{t.name}</span>
                {selected && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                    <Check size={12} /> Selected
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">{t.description}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
