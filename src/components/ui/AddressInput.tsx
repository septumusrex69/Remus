import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/**
 * AN ADDRESS THAT FILLS IN AS YOU TYPE (Remus · Handoff 1). Stephan: "It didn't even pick up the
 * address. I think it should be linked with Google Maps." -- then, of Google's bill: "Isn't there any
 * cheaper way?" Suggestions come through Remus's own server (api/places/nearby, { autocomplete }): the
 * free OpenStreetMap address search (Photon) by default, Google's only if its key is ever set, which
 * then never reaches the browser.
 *
 * Picking a suggestion puts the full address in the box ("42 Mackenzie Street, Brooklyn, Pretoria,
 * 0181"), which is exactly what the map then finds.
 */
export function AddressInput({ value, onChange, placeholder, className = 'input', ariaLabel }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const [suggestions, setSuggestions] = useState<{ text: string; placeId: string }[]>([])
  const [open, setOpen] = useState(false)
  const typed = useRef(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Only while somebody is typing: a saved address is not looked up again on every render.
    if (!typed.current || value.trim().length < 3) { setSuggestions([]); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const r = await fetch('/api/places/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ autocomplete: value }),
        })
        const body = (await r.json().catch(() => ({}))) as { suggestions?: { text: string; placeId: string }[] }
        setSuggestions(body.suggestions ?? [])
        setOpen(true)
      } catch {
        setSuggestions([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input className={`${className} w-full`} value={value} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off"
        onChange={(e) => { typed.current = true; onChange(e.target.value) }} onFocus={() => suggestions.length && setOpen(true)} />
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onMouseDown={(e) => { e.preventDefault(); typed.current = false; onChange(s.text); setSuggestions([]); setOpen(false) }}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" /> {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
