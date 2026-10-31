import { useState } from 'react'
import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import { updateSettings } from '../../../lib/api'
import { BRAND_PHOTOS, PHOTO_PLACES, applyBrandPhotos, photoFor, photoUrl, type BrandPhotoChoice, type PhotoPlace } from '../../../lib/brandPhotos'
import { Card, ErrorBanner, PageHeader } from '../../../components/ui'
import { useBuild } from '../BuildContext'
import { useAccess } from '../../../lib/access'

/**
 * CHOOSE REMUS'S PHOTOGRAPHS (Remus · Handover 6), as Raptor showed its portal candidates at /portal/photos.
 * Stephan: "let's choose some pictures for Remus and show me that, like from Unsplash ... power tools and like
 * cement trucks ... not people's faces ... maybe it should be black and white." Each candidate is drawn as the
 * dashboard band would show it (black and white, under Platinum's black glass), with the place it is used now;
 * an Administrator taps Dashboard band, Sign-in page or Sidebar to use it there, for everybody.
 */
export function PhotosPage() {
  const { settings, reloadSettings } = useBuild()
  const admin = useAccess() === 'admin'
  const [choice, setChoice] = useState<BrandPhotoChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = choice ?? settings?.brand_photos ?? {}

  async function use(place: PhotoPlace, id: string) {
    const next = { ...current, [place]: id }
    setChoice(next)
    applyBrandPhotos(next)
    setError(null)
    try {
      await updateSettings({ brand_photos: next })
      reloadSettings()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Photos" subtitle="Black-and-white construction photographs from Unsplash. Pick one for each place; everybody sees the choice." />
      <ErrorBanner error={error} />
      <Card>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          {PHOTO_PLACES.map((pl) => <span key={pl.id}><span className="font-semibold text-slate-800">{pl.label}:</span> {photoFor(pl.id, current).subject}</span>)}
        </div>
        {!admin && <p className="mt-2 text-xs text-slate-500">Only an Administrator can change them.</p>}
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="photo-candidates">
        {BRAND_PHOTOS.map((p, i) => {
          const usedFor = PHOTO_PLACES.filter((pl) => photoFor(pl.id, current).id === p.id)
          return (
            <div key={p.id} className={clsx('card overflow-hidden', usedFor.length > 0 && 'ring-2 ring-slate-800')} data-testid="photo-candidate">
              {/* As the dashboard band draws it: black glass from the left, the photograph showing through. */}
              <div className="relative h-36 bg-ink-950 bg-cover bg-center"
                style={{ backgroundImage: `linear-gradient(100deg, rgba(9,9,11,0.85) 0%, rgba(9,9,11,0.55) 50%, rgba(9,9,11,0.15) 100%), url('${photoUrl(p, 900)}')` }}>
                <span className="absolute left-3 top-2.5 rounded bg-white/90 px-1.5 text-[11px] font-bold text-slate-900">{i + 1}</span>
                <span className="absolute bottom-3 left-4 text-white">
                  <span className="block text-[10px] font-bold tracking-[0.1em] text-white/60 uppercase">Saturday 31 October</span>
                  <span className="block text-lg font-extrabold">Good afternoon</span>
                </span>
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-slate-800">{p.subject}</p>
                <p className="text-[11px] text-slate-400">Photo: {p.credit} / Unsplash</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PHOTO_PLACES.map((pl) => {
                    const on = photoFor(pl.id, current).id === p.id
                    return (
                      <button key={pl.id} type="button" disabled={!admin || on} onClick={() => void use(pl.id, p.id)}
                        className={clsx('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
                          on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50')}>
                        {on && <Check size={12} />} {pl.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
