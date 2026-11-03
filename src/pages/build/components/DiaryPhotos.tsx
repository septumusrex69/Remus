import { useEffect, useRef, useState } from 'react'
import { Camera, Eye, EyeOff, ImagePlus, X } from 'lucide-react'
import { listDiaryPhotos, removeDiaryPhoto } from '../../../lib/api'
import type { SiteDiaryPhoto } from '../../../types'

type Photo = SiteDiaryPhoto & { url: string | null }

/**
 * THE SITE DIARY'S PHOTOS (Remus · Handover 5, 0030). Taken on the phone, on site: the camera button opens
 * the phone's camera, the other picks from the gallery (several at once). Shrunk on the phone before they
 * are sent (api.addDiaryPhoto).
 */

/** The two buttons. `onFiles` gets every file picked; the caller uploads (or holds them until saved). */
export function PhotoButtons({ onFiles, busy }: { onFiles: (files: File[]) => void; busy?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const take = (list: FileList | null) => { if (list?.length) onFiles([...list]) }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => camera.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
        <Camera size={16} /> Take a photo
      </button>
      <button type="button" disabled={busy} onClick={() => gallery.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <ImagePlus size={16} /> From the gallery
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { take(e.target.files); e.target.value = '' }} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { take(e.target.files); e.target.value = '' }} />
    </div>
  )
}

/**
 * Thumbnails in a row; tap one to open it full size. `onRemove` shows an x on each. `onToggleClient` shows a
 * "Client" switch under each (Remus · Handover 8): ticked, the client sees the photo on their portal. Off
 * unless ticked -- a site photo is the firm's until somebody decides the client should see it.
 */
export function PhotoStrip({ photos, onRemove, onToggleClient }: {
  photos: { key: string; url: string | null; client?: boolean }[]
  onRemove?: (key: string) => void
  onToggleClient?: (key: string, client: boolean) => void
}) {
  if (photos.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2" data-testid="diary-photos">
      {photos.map((p) => (
        <span key={p.key} className="relative flex flex-col items-stretch gap-1">
          <a href={p.url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            className={`block h-16 w-16 overflow-hidden rounded-lg bg-slate-100 ring-1 sm:h-20 sm:w-20 ${p.client ? 'ring-2 ring-emerald-500' : 'ring-slate-200'}`}>
            {p.url && <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />}
          </a>
          {onToggleClient && (
            <button type="button" onClick={() => onToggleClient(p.key, !p.client)} aria-pressed={!!p.client} data-testid="diary-photo-client"
              title={p.client ? 'The client sees this photo on their portal. Tap to hide it.' : 'Tap to show this photo to the client on their portal.'}
              className={`inline-flex items-center justify-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-medium ${p.client ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {p.client ? <Eye size={11} /> : <EyeOff size={11} />} Client
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={() => onRemove(p.key)} aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-800 p-0.5 text-white shadow">
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

/** The photos on these entries, re-read when the entries change. */
export function useDiaryPhotos(entryIds: string[]): { byEntry: Map<string, Photo[]>; reload: () => void } {
  const [rows, setRows] = useState<Photo[]>([])
  const [n, setN] = useState(0)
  const key = entryIds.join(',')
  useEffect(() => {
    let live = true
    listDiaryPhotos(key ? key.split(',') : []).then((r) => { if (live) setRows(r) }).catch(() => {})
    return () => { live = false }
  }, [key, n])
  const byEntry = new Map<string, Photo[]>()
  for (const r of rows) byEntry.set(r.entry_id, [...(byEntry.get(r.entry_id) ?? []), r])
  return { byEntry, reload: () => setN((x) => x + 1) }
}

export { removeDiaryPhoto }
