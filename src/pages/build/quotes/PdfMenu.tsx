import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Eye, FileDown, Share } from 'lucide-react'
import { Button } from '../../../components/ui'
import { canShareFiles, downloadQuotePdf, openQuotePdf, shareQuotePdf } from '../../../lib/api'

/**
 * The quote's PDF: look at it, keep it, or pass it on (Stephan, 26 Oct 2026: it only ever opened
 * "in a second thing"; he wants it in his downloads, or the choice). Every option saves the quote
 * first (`beforeBuild`), so the PDF always shows what is on the screen.
 */
export function PdfMenu({ quoteId, beforeBuild, onError }: { quoteId: string; beforeBuild: () => Promise<boolean>; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const share = canShareFiles()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function run(label: string, job: () => Promise<void>) {
    setOpen(false)
    setBusy(label)
    job()
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null))
  }

  const item = 'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50'
  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen((o) => !o)} loading={busy !== null}>
        <FileDown size={15} /> {busy ?? 'PDF'} <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {/* Preview opens its tab straight from the tap: Safari only allows a new tab that way. */}
          <button className={item} onClick={() => run('Opening…', () => openQuotePdf(quoteId, beforeBuild))}>
            <Eye size={16} className="text-slate-400" /> Preview
          </button>
          <button className={item} onClick={() => run('Downloading…', () => downloadQuotePdf(quoteId, beforeBuild))}>
            <Download size={16} className="text-slate-400" /> Download
            <span className="ml-auto text-xs text-slate-400">to Downloads</span>
          </button>
          {share && (
            <button className={item} onClick={() => run('Preparing…', async () => { await shareQuotePdf(quoteId, beforeBuild) })}>
              <Share size={16} className="text-slate-400" /> Share or save to Files
            </button>
          )}
        </div>
      )}
    </div>
  )
}
