import { useEffect, useRef, useState } from 'react'

/**
 * A BOX TO SIGN IN WITH A FINGER, A PEN OR A MOUSE (Remus · Handover 8). Copied from Raptor's
 * src/components/ui/SignaturePad.tsx, with Raptor's reasons kept:
 *   - every stroke counts, not only the first (Raptor's firm: "if I stop in the middle of the signature, it
 *     doesn't allow me to sign there again") -- Safari's long-press is refused;
 *   - the stroke follows the finger off the edge (pointer capture), so a signature never loses its last letter;
 *   - a dot is a mark; a resize (an iPad turned, the keyboard coming up) keeps what is drawn.
 * The ink is near-black on white, as on paper, whatever the skin: it becomes a picture on the signed PDF.
 */
export function SignaturePad({ onChange, height = 170, label }: {
  onChange: (png: string | null) => void
  height?: number
  label: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [marked, setMarked] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const fit = () => {
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return
      const before = canvas.width > 0 && canvas.height > 0 ? (() => {
        const copy = document.createElement('canvas')
        copy.width = canvas.width
        copy.height = canvas.height
        copy.getContext('2d')?.drawImage(canvas, 0, 0)
        return copy
      })() : null
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      if (before) ctx.drawImage(before, 0, 0, before.width, before.height, 0, 0, canvas.width, canvas.height)
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0f172a'
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(canvas)
    return () => observer?.disconnect()
  }, [height])

  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    e.preventDefault()
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused !== e.currentTarget) focused.blur()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer has nothing to capture */ }
    drawing.current = true
    const { x, y } = at(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!marked) setMarked(true)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = at(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = ref.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setMarked(false)
    onChange(null)
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <button type="button" onClick={clear} className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">Clear</button>
      </div>
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-white select-none [-webkit-touch-callout:none]">
        <canvas
          ref={ref}
          data-testid="signature-pad"
          style={{ height, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
          className="block w-full cursor-crosshair rounded-lg"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!marked && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Sign here</span>}
      </div>
    </div>
  )
}
