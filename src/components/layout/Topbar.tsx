import { Menu } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'
import { MessagesMenu } from './MessagesMenu'
import { QuickAdd } from './QuickAdd'

/**
 * Raptor's top bar: which screen you are on, search across everything, unread client mail, and
 * "+ New". On a phone the title gives way to the menu button and the search to an icon.
 */
export function Topbar({ title, onMenu }: { title: string; onMenu: () => void }) {
  return (
    <header className="no-print flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-card/90 backdrop-blur px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={onMenu} className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <h1 className="truncate text-lg font-semibold text-slate-800">{title}</h1>
      </div>
      <div className="hidden flex-1 justify-center md:flex">
        <GlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="md:hidden">
          <GlobalSearch compact />
        </div>
        <MessagesMenu />
        <QuickAdd />
      </div>
    </header>
  )
}
