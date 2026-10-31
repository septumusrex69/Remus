import type { RemusVariant } from './RemusOpening'

/**
 * THE SOUND OF REMUS'S OPENINGS (Remus · Handoff 6), drawn by the browser and timed to RemusOpening's clock. Copied
 * from Raptor's (raptorSound.ts and the portal's portalSound.ts, Raptor S16): the same rules, Remus's own instruments.
 *
 * A browser plays sound only after a press: the Sign in button wakes it (primeOpeningAudio), and a refusal is silence,
 * never a wait. Stephan on Raptor's first sounds: "It sounds like a video game ... deeper, softer ... the high pitched
 * things is too high pitched." So nothing high here either: everything goes through a low-pass at 2.4 kHz, and the
 * body sits around 60-330 Hz. Remus's sound is the building site -- deep drums and dust ("doof, doof, doof"), a
 * scribe and a cutting torch, a steel plate landing, a concrete mixer and the shuttering knocked off -- with a low,
 * warm horn under the name.
 */
let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (ctx) return ctx
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ctx = C ? new C() : null
  } catch { ctx = null }
  return ctx
}

/** Call from inside a click or submit: it is the press that lets the sound play a moment later. */
export function primeOpeningAudio(): void {
  const c = context()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

export function playRemusSound(variant: RemusVariant): boolean {
  const c = context()
  if (!c) return false
  if (c.state === 'suspended') void c.resume().catch(() => {})
  if (c.state !== 'running') return false
  const t0 = c.currentTime + 0.05
  if (variant === 'slash') slash(c, t0)
  else if (variant === 'cut') cut(c, t0)
  else if (variant === 'pour') pour(c, t0)
  else stamp(c, t0)
  return true
}

type Out = { master: GainNode; delay: DelayNode }

/** The room: a master that swells in and out, a low-pass over everything, and a dark echo. (Raptor's softBus.) */
function softBus(c: AudioContext, t0: number, end: number, peak = 0.6): Out {
  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(peak, t0 + 0.15)
  master.gain.setValueAtTime(peak, end - 1.4)
  master.gain.exponentialRampToValueAtTime(0.0001, end)
  const air = c.createBiquadFilter()
  air.type = 'lowpass'
  air.frequency.value = 2400
  master.connect(air); air.connect(c.destination)
  const delay = c.createDelay(1.5)
  delay.delayTime.value = 0.38
  const feedback = c.createGain()
  feedback.gain.value = 0.38
  const tone = c.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 900
  delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(master)
  return { master, delay }
}

function noiseSource(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate)
  const d = buf.getChannelData(0)
  /* Brown noise: each sample a step from the last -- a low roar, not a hiss. */
  let last = 0
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 }
  const src = c.createBufferSource()
  src.buffer = buf
  return src
}

/** Filtered noise with a shape: the one tool for dust, wind, the torch and the mixer. */
function breath(c: AudioContext, out: Out, at: number, len: number, o: {
  type?: BiquadFilterType; from: number; to?: number; q?: number; level: number; attack?: number; echo?: boolean
}) {
  const src = noiseSource(c, len)
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'lowpass'
  f.Q.value = o.q ?? 0.7
  f.frequency.setValueAtTime(o.from, at)
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(o.level, at + (o.attack ?? 0.02))
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  src.connect(f); f.connect(g); g.connect(out.master)
  if (o.echo) g.connect(out.delay)
  src.start(at); src.stop(at + len)
}

/** "Doof": a deep drum -- a sine dropping into its pitch -- with a soft felt beater. */
function drum(c: AudioContext, out: Out, at: number, pitch = 70, level = 0.6, len = 1.3) {
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(pitch * 2.2, at)
  o.frequency.exponentialRampToValueAtTime(pitch, at + 0.12)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g); g.connect(out.master); g.connect(out.delay)
  o.start(at); o.stop(at + len + 0.05)
  breath(c, out, at, 0.12, { from: 700, level: level * 0.45, attack: 0.004 })
}

/** "Poof": the dust thrown up as a letter lands -- a soft burst of low air, opening then closing. */
function poof(c: AudioContext, out: Out, at: number, level = 0.35) {
  breath(c, out, at, 0.45, { from: 1300, to: 260, level, attack: 0.015 })
}

/** Steel landing: a few inharmonic partials, the way a plate rings, kept low and dark. */
function clang(c: AudioContext, out: Out, at: number, level = 0.12) {
  for (const [hz, l, len] of [[87, 1, 2.2], [139, 0.7, 1.6], [211, 0.45, 1.2], [318, 0.3, 0.9], [467, 0.15, 0.6]] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(level * l, at + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, at + len)
    o.connect(g); g.connect(out.master); g.connect(out.delay)
    o.start(at); o.stop(at + len + 0.05)
  }
  drum(c, out, at, 58, 0.45)
}

/** A low, warm horn under the name: sawtooths in unison and fifths through a filter that never opens past 1 kHz. */
function horn(c: AudioContext, out: Out, at: number, len: number, freqs: number[], level = 0.05) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.1
  lp.frequency.setValueAtTime(200, at)
  lp.frequency.linearRampToValueAtTime(900, at + len * 0.45)
  lp.frequency.linearRampToValueAtTime(340, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + len * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  lp.connect(g); g.connect(out.master); g.connect(out.delay)
  for (const hz of freqs) for (const det of [-7, 7]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = det
    o.connect(lp)
    o.start(at); o.stop(at + len + 0.1)
  }
}

/* STAMP: five letters, five deep drums with their dust -- doof, doof, doof, doof, DOOF -- the last two drums
   together, then the horn under the light running along the steel. Matches STAMP_FIRST / STAMP_EVERY. */
function stamp(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.4, 0.7)
  breath(c, out, t0, 0.4, { from: 300, to: 900, level: 0.12, attack: 0.3 })
  for (let i = 0; i < 5; i++) {
    const at = t0 + 0.37 + i * 0.35
    const last = i === 4
    drum(c, out, at, last ? 55 : 66, last ? 0.75 : 0.5 + i * 0.04)
    if (last) drum(c, out, at + 0.015, 98, 0.3)
    poof(c, out, at + 0.01, last ? 0.42 : 0.3)
  }
  horn(c, out, t0 + 1.95, 2.3, [110, 164.81, 220], 0.045)
}

/* SLASH: a low swell in the dark, the blade's rush up the cut line, the halves parting with a dark ring of steel,
   then the clack as they slam back together -- two drums -- and the horn under the light. */
function slash(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.4, 0.65)
  breath(c, out, t0, 0.6, { from: 220, to: 600, level: 0.14, attack: 0.5 })
  breath(c, out, t0 + 0.55, 0.5, { type: 'bandpass', from: 300, to: 1500, q: 1.2, level: 0.6, attack: 0.18, echo: true })
  clang(c, out, t0 + 0.98, 0.08)
  drum(c, out, t0 + 1.62, 62, 0.7)
  drum(c, out, t0 + 1.635, 104, 0.35)
  poof(c, out, t0 + 1.63, 0.25)
  horn(c, out, t0 + 1.9, 2.3, [116.54, 174.61, 233.08], 0.045)
}

/* CUT: the scribe drawing the lines, the torch's roar across the plate with a hum under it, the off-cut landing on
   the floor (a plate's dark ring), and the horn as the name comes up. */
function cut(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  ;[0.3, 0.52, 0.71, 0.93, 1.12].forEach((dt, i) => breath(c, out, t0 + dt, 0.16, { type: 'bandpass', from: 650 + i * 40, q: 2.5, level: 0.16, attack: 0.03 }))
  breath(c, out, t0 + 1.35, 0.8, { type: 'bandpass', from: 420, to: 1100, q: 0.9, level: 0.55, attack: 0.06, echo: true })
  const hum = c.createOscillator()
  hum.type = 'triangle'
  hum.frequency.setValueAtTime(82, t0 + 1.35)
  hum.frequency.linearRampToValueAtTime(110, t0 + 2.1)
  const hg = c.createGain()
  hg.gain.setValueAtTime(0.0001, t0 + 1.35)
  hg.gain.exponentialRampToValueAtTime(0.12, t0 + 1.45)
  hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.25)
  hum.connect(hg); hg.connect(out.master)
  hum.start(t0 + 1.35); hum.stop(t0 + 2.3)
  breath(c, out, t0 + 2.2, 0.6, { from: 250, to: 900, level: 0.14, attack: 0.5 })
  clang(c, out, t0 + 2.75, 0.12)
  horn(c, out, t0 + 2.55, 1.9, [123.47, 185, 246.94], 0.045)
}

/* POUR: the mixer turning (a low rumble that throbs), the concrete going in, the shuttering knocked off -- five dull
   knocks, one per letter -- and the horn as it is polished. */
function pour(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  const rumble = noiseSource(c, 2.3)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 220
  const throb = c.createGain()
  throb.gain.setValueAtTime(0.0001, t0)
  throb.gain.exponentialRampToValueAtTime(0.6, t0 + 0.5)
  throb.gain.setValueAtTime(0.6, t0 + 1.8)
  throb.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.3)
  const lfo = c.createOscillator()
  const depth = c.createGain()
  lfo.frequency.value = 6.5
  depth.gain.value = 0.3
  lfo.connect(depth); depth.connect(throb.gain)
  rumble.connect(lp); lp.connect(throb); throb.connect(out.master)
  rumble.start(t0); rumble.stop(t0 + 2.3); lfo.start(t0); lfo.stop(t0 + 2.3)
  breath(c, out, t0 + 0.65, 1.4, { type: 'bandpass', from: 300, to: 520, q: 0.8, level: 0.3, attack: 0.5 })
  for (let i = 0; i < 5; i++) {
    const at = t0 + 2.05 + i * 0.12
    drum(c, out, at, 120 - i * 6, 0.28, 0.35)
    breath(c, out, at, 0.08, { from: 900, level: 0.18, attack: 0.003 })
  }
  horn(c, out, t0 + 2.5, 2.0, [98, 146.83, 196], 0.05)
}
