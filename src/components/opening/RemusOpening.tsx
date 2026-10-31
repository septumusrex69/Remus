import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { LETTERS, WORD_D, WORD_W } from './remusLetters'
import { playRemusSound } from './remusSound'
import './remusOpening.css'

/**
 * REMUS'S OPENING, AFTER A SIGN-IN (Remus · Handoff 6, 31 Oct 2026). Copied from Raptor's (Raptor S16,
 * `src/components/opening/RaptorOpening.tsx` on claude/beautiful-curie-f7deq7) and made Remus's own. Stephan: "when
 * you log into Remus, then it like does something cool, like a video with like sound effects, like one of the letters
 * just like hit out like poof, poof, poof ... Doof, doof, doof ... Or like ... how the Remus is constructed and the cut
 * lines are cut out ... just make different ones. But use the platinum" -- Raptor's Platinum off the brand board:
 * black glass, brushed-silver lines, white light. The letters are the real wordmark, traced (remusLetters.ts), cut
 * line and all. Its subject is building (Raptor's is the bird), and each has its own
 * sound (remusSound.ts): deep drums and dust, a scribe and a cutting torch, a concrete mixer and the formwork struck.
 *
 *   stamp     -- R, E, M, U, S slam down one at a time, each with a deep "doof" and a puff of dust; the ground shakes;
 *                a white light runs along the steel.
 *   cut       -- a blueprint: the grid, the dimensions, the letters drawn as cut lines on a steel plate; a cutting
 *                torch runs along them, sparks fall, and the off-cut plate drops away leaving REMUS standing.
 *   slash     -- the logo's own cut line: the word stands dark, a blade of light runs up the cut, the word splits along
 *                it and lights up silver, then the two halves clack back together. ("the cut lines are cut out")
 *   pour      -- the formwork drawn, the concrete poured up to a laser level, the shuttering struck, polished to silver.
 *
 * /opening plays any of them on demand; the sign-in plays REMUS_OPENING_DEFAULT. It covers the app as it loads underneath
 * and dissolves into it; a tap skips it; Reduced motion gets the still word (unless `force`, the replay page). It never
 * waits on anything: the app is already drawing under it.
 */
export type RemusVariant = 'stamp' | 'slash' | 'cut' | 'pour'
export const REMUS_OPENING_DEFAULT: RemusVariant = 'stamp'

const FULL_MS = 3900

/* One clock for all of them, matched in remusOpening.css and remusSound.ts. */
export const STAMP_FIRST = 0.37
export const STAMP_EVERY = 0.35

const seed = (i: number, n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1

/* The word sits in a frame with room round it for the plate and the dimensions. */
const PAD = 40
const VB_W = WORD_W + PAD * 2
const VB_H = 100 + PAD * 2
const VIEWBOX = `${-PAD} ${-PAD} ${VB_W} ${VB_H}`
const pctX = (x: number) => `${((x + PAD) / VB_W) * 100}%`
const pctY = (y: number) => `${((y + PAD) / VB_H) * 100}%`

/* The wordmark's cut line (measured off the PNG): y = CUT_Y0 + CUT_SLOPE * x, rising to the right. Extended past the
   frame so the halves are cut cleanly. */
const CUT_Y0 = 43.1
const CUT_SLOPE = -0.0696
const cutY = (x: number) => CUT_Y0 + CUT_SLOPE * x
const CUT_L = -PAD
const CUT_R = WORD_W + PAD
const TOP_HALF = `${CUT_L},${-PAD} ${CUT_R},${-PAD} ${CUT_R},${cutY(CUT_R)} ${CUT_L},${cutY(CUT_L)}`
const BOTTOM_HALF = `${CUT_L},${cutY(CUT_L)} ${CUT_R},${cutY(CUT_R)} ${CUT_R},${100 + PAD} ${CUT_L},${100 + PAD}`

/* Dust from each letter as it lands: puffs rolling out low along the ground, either side. */
const DUST = LETTERS.map((_, li) => Array.from({ length: 9 }, (_, i) => {
  const side = i % 2 === 0 ? -1 : 1
  return { dx: side * (20 + seed(li * 9 + i, 1) * 90), dy: -(6 + seed(li * 9 + i, 2) * 46), s: 0.7 + seed(li * 9 + i, 3) * 1.1 }
}))
const SPARKS = Array.from({ length: 8 }, (_, i) => ({ dx: (seed(i, 4) - 0.5) * 50, dy: 30 + seed(i, 5) * 70, delay: seed(i, 6) * 0.3 }))

function Word({ className, style, children }: { className: string; style?: CSSProperties; children: React.ReactNode }) {
  return (
    <svg className={className} style={style} viewBox={VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {children}
    </svg>
  )
}

/** A white light running along the steel, clipped to the letters. */
function Shine({ at }: { at: number }) {
  return (
    <g clipPath="url(#rmo-word-clip)">
      <rect className="rmo-shine" x={-80} y={-20} width={46} height={140} fill="url(#rmo-shine-grad)" style={{ animationDelay: `${at}s`, ['--rmo-shine-to' as string]: `${WORD_W + 150}px` }} />
    </g>
  )
}

export function RemusOpening({ variant = REMUS_OPENING_DEFAULT, onDone, force = false }: {
  variant?: RemusVariant
  onDone: () => void
  force?: boolean
}) {
  const reduced = !force && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    setLeaving(true)
    setTimeout(onDone, 550)
  }

  useEffect(() => {
    if (!reduced) playRemusSound(variant)
    const t = setTimeout(finish, reduced ? 700 : FULL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per mount; the replay page remounts by key
  }, [])

  const look = reduced ? 'still' : variant
  return (
    <div className={`remus-opening is-${look} ${leaving ? 'is-leaving' : ''}`} data-testid="remus-opening" data-variant={look}
      onClick={finish} role="presentation">
      {/* Shared paint: brushed silver, the shine, concrete grain, the word as a clip. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id="rmo-silver" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.32" stopColor="#e4e6e9" />
            <stop offset="0.52" stopColor="#a6abb3" />
            <stop offset="0.74" stopColor="#d6d9de" />
            <stop offset="1" stopColor="#8b9098" />
          </linearGradient>
          <linearGradient id="rmo-plate" gradientUnits="userSpaceOnUse" x1="0" y1={-PAD} x2={WORD_W} y2={100 + PAD}>
            <stop offset="0" stopColor="#2a2c31" />
            <stop offset="0.5" stopColor="#1b1c1f" />
            <stop offset="1" stopColor="#26282c" />
          </linearGradient>
          <linearGradient id="rmo-concrete-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
            <stop offset="0" stopColor="#c9ccd0" />
            <stop offset="1" stopColor="#8f939a" />
          </linearGradient>
          <linearGradient id="rmo-shine-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id="rmo-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
            <feComposite in="grey" in2="SourceGraphic" operator="in" result="speck" />
            <feBlend in="SourceGraphic" in2="speck" mode="multiply" />
          </filter>
          <clipPath id="rmo-word-clip"><path d={WORD_D} clipRule="evenodd" /></clipPath>
        </defs>
      </svg>

      {look === 'cut' && <div aria-hidden className="rmo-layer"><span className="rmo-grid" /></div>}
      {look === 'pour' && <div aria-hidden className="rmo-layer"><span className="rmo-site-glow" /></div>}
      {look === 'stamp' && <div aria-hidden className="rmo-layer"><span className="rmo-floor" /></div>}

      <div className="rmo-stage">
        <div className="rmo-word" data-testid="remus-opening-word" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
          {(look === 'stamp' || look === 'still') && (
            <>
              <Word className="rmo-svg">
                {LETTERS.map((l, i) => (
                  <g key={l.ch} className="rmo-stamp-letter" style={{ animationDelay: `${STAMP_FIRST - 0.22 + i * STAMP_EVERY}s` }}>
                    <path d={l.d} fill="url(#rmo-silver)" fillRule="evenodd" stroke="#f6f6f4" strokeOpacity="0.5" strokeWidth="0.6" />
                  </g>
                ))}
                {look === 'stamp' && <Shine at={2.05} />}
              </Word>
              {look === 'stamp' && LETTERS.map((l, li) => (
                <span key={l.ch} aria-hidden className="rmo-impact" style={{ left: pctX(l.x + l.w / 2), top: pctY(100) }}>
                  <span className="rmo-ring" style={{ animationDelay: `${STAMP_FIRST + li * STAMP_EVERY}s` }} />
                  {DUST[li].map((p, i) => (
                    <span key={i} className="rmo-dust" style={{
                      ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--s' as string]: p.s,
                      animationDelay: `${STAMP_FIRST + li * STAMP_EVERY}s`,
                    }} />
                  ))}
                </span>
              ))}
            </>
          )}

          {look === 'slash' && (
            <>
              <Word className="rmo-svg">
                <defs>
                  <clipPath id="rmo-top-half"><polygon points={TOP_HALF} /></clipPath>
                  <clipPath id="rmo-bottom-half"><polygon points={BOTTOM_HALF} /></clipPath>
                </defs>
                {(['top', 'bottom'] as const).map((half) => (
                  <g key={half} className={`rmo-half is-${half}`}>
                    <g clipPath={`url(#rmo-${half}-half)`}>
                      <path d={WORD_D} fill="#26282c" fillRule="evenodd" stroke="#4a4d54" strokeWidth="0.6" />
                      <path d={WORD_D} fill="url(#rmo-silver)" fillRule="evenodd" className="rmo-light" />
                    </g>
                  </g>
                ))}
                <Shine at={2.0} />
              </Word>
              <Word className="rmo-svg rmo-blade-svg">
                <path d={`M${CUT_L} ${cutY(CUT_L)} L${CUT_R} ${cutY(CUT_R)}`} pathLength={1} className="rmo-blade" />
                <path d={`M${CUT_L} ${cutY(CUT_L)} L${CUT_R} ${cutY(CUT_R)}`} className="rmo-seam" />
              </Word>
            </>
          )}

          {look === 'cut' && (
            <>
              {/* The plate before the cut: whole, with the cut lines and the dimensions drawn on it. Taken away behind the torch. */}
              <div className="rmo-cut-before">
                <Word className="rmo-svg">
                  <rect x={-PAD + 6} y={-PAD + 10} width={VB_W - 12} height={VB_H - 20} rx={3} fill="url(#rmo-plate)" stroke="#c4c8cf" strokeOpacity="0.35" strokeWidth="0.8" />
                  <path d={WORD_D} pathLength={1} className="rmo-draw" fill="none" stroke="#c4c8cf" strokeWidth="1.1" />
                </Word>
              </div>
              {/* After the torch: the plate with the letters cut out of it, and the letters standing in their holes. */}
              <div className="rmo-cut-after">
                <div className="rmo-offcut">
                  <Word className="rmo-svg">
                    <path d={`M${-PAD + 6} ${-PAD + 10} h${VB_W - 12} v${VB_H - 20} h${-(VB_W - 12)} Z ${WORD_D}`} fill="url(#rmo-plate)" fillRule="evenodd"
                      stroke="#c4c8cf" strokeOpacity="0.35" strokeWidth="0.8" />
                  </Word>
                </div>
                <Word className="rmo-svg">
                  <path d={WORD_D} fill="url(#rmo-silver)" fillRule="evenodd" />
                  <path d={WORD_D} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="0.8" className="rmo-hot-edge" />
                  <Shine at={2.55} />
                </Word>
              </div>
              {/* The dimensions, drawn like the drawing office does. */}
              <Word className="rmo-svg rmo-dims">
                <path pathLength={1} className="rmo-draw is-dim" d={`M0 -26 H${WORD_W} M0 -31 V-21 M${WORD_W} -31 V-21 M0 -6 V-31 M${WORD_W} -6 V-31`} />
                <path pathLength={1} className="rmo-draw is-dim" d={`M-26 0 V100 M-31 0 H-21 M-31 100 H-21`} />
                <text x={WORD_W / 2} y={-30} className="rmo-dim-text" textAnchor="middle">{Math.round(WORD_W * 10).toLocaleString('en-ZA')}</text>
                <text x={-30} y={50} className="rmo-dim-text" textAnchor="middle" transform="rotate(-90 -30 50)">1 000</text>
              </Word>
              {/* The torch: a white-hot line sweeping across, sparks falling from it. */}
              <span aria-hidden className="rmo-torch">
                {SPARKS.map((s, i) => (
                  <span key={i} className="rmo-spark" style={{ ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`, animationDelay: `${1.35 + s.delay}s` }} />
                ))}
              </span>
            </>
          )}

          {look === 'pour' && (
            <>
              {/* The concrete, rising up the formwork to the laser level. */}
              <div className="rmo-pour-fill">
                <Word className="rmo-svg">
                  <path d={WORD_D} fill="url(#rmo-concrete-fill)" fillRule="evenodd" filter="url(#rmo-grain)" />
                </Word>
              </div>
              <div className="rmo-pour-polish">
                <Word className="rmo-svg">
                  <path d={WORD_D} fill="url(#rmo-silver)" fillRule="evenodd" />
                  <Shine at={2.7} />
                </Word>
              </div>
              <span aria-hidden className="rmo-level" />
              {/* The shuttering: each letter's formwork, struck one after the other. */}
              <Word className="rmo-svg rmo-formwork">
                {LETTERS.map((l, i) => (
                  <g key={l.ch} className="rmo-form" style={{ animationDelay: `${2.05 + i * 0.12}s`, ['--fx' as string]: `${(i - 2) * 14}px` }}>
                    <path d={l.d} pathLength={1} className="rmo-draw is-form" style={{ animationDelay: `${i * 0.08}s` }} />
                  </g>
                ))}
              </Word>
            </>
          )}
        </div>
      </div>

      {look === 'cut' && <p aria-hidden className="rmo-readout">DRG RMS-001 · Rev A · Cut</p>}
      {look === 'pour' && <p aria-hidden className="rmo-readout">Poured · 30 MPa · Struck</p>}
    </div>
  )
}
