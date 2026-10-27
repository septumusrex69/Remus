import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Profile } from '../../types'

/**
 * The two small pieces Raptor's request screens borrow from its own kit and Remus did not have: a
 * person's round initials in their own colour (Raptor's UserAvatar), and a screenshot that opens full
 * size when tapped (Raptor's ZoomableImage) -- a request's screenshot is read, not glanced at.
 */
export function PersonAvatar({ person, size = 24 }: { person: Pick<Profile, 'name' | 'avatar_color'> | null | undefined; size?: number }) {
  const name = person?.name?.trim() || '?'
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), backgroundColor: person?.avatar_color || '#64748b' }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [big, setBig] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setBig(true)} className="cursor-zoom-in" aria-label={`Open ${alt}`}>
        <img src={src} alt={alt} className={className} />
      </button>
      {big && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setBig(false)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/90 p-1.5 text-slate-700" aria-label="Close"><X size={18} /></button>
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>,
        document.body,
      )}
    </>
  )
}
