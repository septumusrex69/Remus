import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, Camera, ChevronDown, FileText, FolderKanban, Mail, Plus, UserPlus, type LucideIcon } from 'lucide-react'
import { paths } from '../../pages/build/paths'

/**
 * Raptor's "+ Add" menu in the top bar. Each item opens the same form its own page uses (the page
 * reads `?new=1`), so there is one form per thing, not a second copy here.
 */
const OPTIONS: { label: string; icon: LucideIcon; to: () => string }[] = [
  { label: 'New quote', icon: FileText, to: () => `${paths.quotes()}?new=1` },
  { label: 'New project', icon: FolderKanban, to: () => `${paths.projects()}?new=1` },
  { label: 'New client', icon: UserPlus, to: () => `${paths.clients()}?new=1` },
  { label: 'Snap slip', icon: Camera, to: () => paths.capture() },
  { label: 'Diary event', icon: CalendarPlus, to: () => `${paths.diary()}?new=1` },
  { label: 'New email', icon: Mail, to: () => `${paths.mail()}?new=1` },
]

export function QuickAdd() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600 sm:px-3.5"
      >
        <Plus size={16} /> <span className="hidden sm:inline">Add</span> <ChevronDown size={14} className="hidden opacity-70 sm:inline" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-52 rounded-xl border border-slate-100 bg-white py-1.5 shadow-lg">
          {OPTIONS.map(({ label, icon: Icon, to }) => (
            <button
              key={label}
              onClick={() => { setOpen(false); navigate(to()) }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
