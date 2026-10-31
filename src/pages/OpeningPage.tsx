import { useState } from 'react'
import { Check, Play, RotateCcw } from 'lucide-react'
import { RemusOpening, type RemusVariant } from '../components/opening/RemusOpening'
import { primeOpeningAudio } from '../components/opening/remusSound'
import { chooseOpening, chosenOpening } from '../components/opening/openingChoice'

/**
 * /opening -- REMUS'S OPENINGS, ON DEMAND (Remus · Handoff 6; Raptor's /opening, S16). No sign-in and no data. Each
 * play starts from a press, because that is what lets the sound start on an iPad. "Play this one when I sign in"
 * remembers the pick on this device (openingChoice.ts).
 */
const OPENINGS: { id: RemusVariant; name: string; line: string }[] = [
  { id: 'stamp', name: '1 · Stamp', line: 'R, E, M, U, S slam down one at a time: doof, doof, doof, a puff of dust each, the floor shakes, a light runs along the steel.' },
  { id: 'slash', name: '2 · Cut line', line: 'The logo\'s own cut line: the word stands dark, a blade of light runs up the cut, the word splits on it, lights up silver and clacks back together.' },
  { id: 'cut', name: '3 · Blueprint', line: 'The blueprint: the letters drawn as cut lines on a steel plate, a cutting torch runs along them, the off-cut drops away.' },
  { id: 'pour', name: '4 · Pour', line: 'The formwork drawn, concrete poured up to the laser level, the shuttering knocked off, polished to silver.' },
]

export default function OpeningPage() {
  const [playing, setPlaying] = useState<RemusVariant | null>(null)
  const [run, setRun] = useState(0)
  const [last, setLast] = useState<RemusVariant | null>(null)
  const [chosen, setChosen] = useState<RemusVariant>(chosenOpening())
  const play = (v: RemusVariant) => { primeOpeningAudio(); setRun((n) => n + 1); setLast(v); setPlaying(v) }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 sm:p-6" data-testid="remus-openings"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #1c1e22 0%, #121316 60%, #060708 100%)' }}>
      {playing && <RemusOpening key={run} variant={playing} force onDone={() => setPlaying(null)} />}
      <div className="w-full max-w-[560px]">
        <img src="/brand/remus-wordmark-white.png" alt="Remus" className="h-10 w-auto mx-auto" />
        <h1 className="mt-6 text-center text-2xl font-semibold text-white">Remus's opening</h1>
        <p className="mt-2 text-center text-sm text-white/70">What plays after you sign in. Tap one to play it, with sound; tap the screen to skip.</p>
        <ul className="mt-8 space-y-3">
          {OPENINGS.map((o) => (
            <li key={o.id} className="rounded-2xl border border-white/15 bg-white/[0.06]">
              <button type="button" onClick={() => play(o.id)} data-testid={`remus-opening-${o.id}`}
                className="w-full text-left flex items-center gap-4 rounded-2xl hover:bg-white/[0.08] px-5 py-4 transition-colors">
                <span className="shrink-0 h-11 w-11 rounded-full grid place-items-center bg-[#c4c8cf] text-[#09090b]">
                  {last === o.id ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </span>
                <span>
                  <span className="block text-white font-semibold">{o.name}</span>
                  <span className="block mt-0.5 text-[13px] text-white/65">{o.line}</span>
                </span>
              </button>
              <div className="px-5 pb-3 pl-[84px]">
                {chosen === o.id ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#c4c8cf]"><Check className="h-3.5 w-3.5" /> Plays when you sign in on this device</span>
                ) : (
                  <button type="button" onClick={() => { chooseOpening(o.id); setChosen(o.id) }} data-testid={`remus-opening-choose-${o.id}`}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/75 hover:text-white hover:border-white/40 transition-colors">
                    Play this one when I sign in
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-xs text-white/45">If there is no sound on the iPad or phone, check that Silent mode is off.</p>
      </div>
    </div>
  )
}
