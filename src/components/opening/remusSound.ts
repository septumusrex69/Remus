import type { RemusVariant } from './RemusOpening'

/**
 * THE SOUND OF REMUS'S OPENINGS (Remus · Handoff 6), drawn by the browser and timed to RemusOpening's clock. Copied
 * from Raptor's (raptorSound.ts and the portal's portalSound.ts, Raptor S16): the same rules, Remus's own instruments.
 *
 * ALL FIVE IN POUR'S WAY (31 Oct, third round). Stephan heard the first set and picked POUR's as "the closest ... kind
 * of cool ... like rain ... and thunder". A hard version (a club kick on a grid, distorted bass, grinders) followed and
 * he said "that sounds like a rave club ... the original music ... for Pour was good. Do something like that similar."
 * So every opening is built from Pour's palette: the concrete mixer's low throbbing rumble, the slosh of concrete,
 * deep drums and dull knocks on timber, a steel plate's dark ring, the low warm swell under the name, the long dark
 * echo -- with soft rain under them and thunder rolling far off. NO beat grid, no saw bass, no grinder, no saturation:
 * that is the rave. Nothing high: everything through a low-pass at 2.4 kHz, the body around 60-330 Hz.
 *
 * A browser plays sound only after a press: the Sign in button wakes it (primeOpeningAudio), and a refusal is silence,
 * never a wait.
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
  else if (variant === 'build') build(c, t0)
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

function noiseSource(c: AudioContext, seconds: number, white = false): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate)
  const d = buf.getChannelData(0)
  /* Brown noise: each sample a step from the last -- a low roar, not a hiss. White only for the rain. */
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const r = Math.random() * 2 - 1
    if (white) d[i] = r * 0.5
    else { last = (last + 0.02 * r) / 1.02; d[i] = last * 3.5 }
  }
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

/** Shuttering knocked off: a dull knock on timber (Pour's). */
function knock(c: AudioContext, out: Out, at: number, pitch = 120, level = 0.28) {
  drum(c, out, at, pitch, level, 0.35)
  breath(c, out, at, 0.08, { from: 900, level: level * 0.65, attack: 0.003 })
}

/** The concrete mixer turning: a low rumble that throbs (Pour's). */
function mixer(c: AudioContext, out: Out, at: number, len: number, level = 0.6) {
  const rumble = noiseSource(c, len)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 220
  const throb = c.createGain()
  throb.gain.setValueAtTime(0.0001, at)
  throb.gain.exponentialRampToValueAtTime(level, at + Math.min(0.5, len * 0.3))
  throb.gain.setValueAtTime(level, at + len - 0.5)
  throb.gain.exponentialRampToValueAtTime(0.0001, at + len)
  const lfo = c.createOscillator()
  const depth = c.createGain()
  lfo.frequency.value = 6.5
  depth.gain.value = level / 2
  lfo.connect(depth); depth.connect(throb.gain)
  rumble.connect(lp); lp.connect(throb); throb.connect(out.master)
  rumble.start(at); rumble.stop(at + len); lfo.start(at); lfo.stop(at + len)
}

/** The concrete going in: a slow slosh. */
function slosh(c: AudioContext, out: Out, at: number, len: number, level = 0.3) {
  breath(c, out, at, len, { type: 'bandpass', from: 300, to: 520, q: 0.8, level, attack: len * 0.35 })
}

/** Soft rain on the site: a gentle wash, swelling in and out, under everything. */
function rain(c: AudioContext, out: Out, at: number, len: number, level = 0.07) {
  const s = noiseSource(c, len, true)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1500
  bp.Q.value = 0.4
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.8)
  g.gain.setValueAtTime(level, at + len - 1)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  s.connect(bp); bp.connect(g); g.connect(out.master)
  s.start(at); s.stop(at + len)
}

/** Thunder far off: no crack, just a long low roll that grumbles as it fades, into the echo. */
function thunder(c: AudioContext, out: Out, at: number, len = 2.6, level = 0.45) {
  const s = noiseSource(c, len)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(360, at)
  lp.frequency.exponentialRampToValueAtTime(80, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.25)
  let v = level
  for (let t = 0.5; t < len - 0.2; t += 0.25 + Math.random() * 0.25) {
    v *= 0.75
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * (0.6 + Math.random() * 0.8)), at + t)
  }
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  s.connect(lp); lp.connect(g); g.connect(out.master); g.connect(out.delay)
  s.start(at); s.stop(at + len)
}

/* STAMP: the mixer low in the background and the rain, each letter landing as a deep drum, a dull knock and its dust
   -- doof, doof, doof, doof, DOOF -- thunder rolling in off the last, and the low swell under the light. */
function stamp(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  rain(c, out, t0, 4.5)
  mixer(c, out, t0, 1.9, 0.3)
  for (let i = 0; i < 5; i++) {
    const at = t0 + 0.37 + i * 0.35
    const last = i === 4
    drum(c, out, at, last ? 55 : 66, last ? 0.65 : 0.45 + i * 0.04)
    knock(c, out, at + 0.01, 120 - i * 6, 0.22)
    poof(c, out, at + 0.01, last ? 0.35 : 0.25)
  }
  thunder(c, out, t0 + 1.8, 2.6, 0.4)
  horn(c, out, t0 + 2.0, 2.3, [98, 146.83, 196], 0.05)
}

/* SLASH: the rain and the mixer in the dark, the blade as a long slosh of air up the cut, the halves parting with a
   steel plate's dark ring, the clack back together as a deep drum and knocks, thunder, and the swell under the light. */
function slash(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  rain(c, out, t0, 4.5)
  mixer(c, out, t0, 1.6, 0.45)
  breath(c, out, t0 + 0.5, 0.6, { type: 'bandpass', from: 300, to: 900, q: 1, level: 0.4, attack: 0.25, echo: true })
  clang(c, out, t0 + 0.98, 0.07)
  drum(c, out, t0 + 1.62, 58, 0.65)
  knock(c, out, t0 + 1.62, 110, 0.3)
  knock(c, out, t0 + 1.74, 104, 0.2)
  thunder(c, out, t0 + 1.7, 2.6, 0.4)
  horn(c, out, t0 + 1.95, 2.3, [98, 146.83, 196], 0.05)
}

/* BLUEPRINT: soft knocks as the lines go down, the torch's roar across the plate with a hum under it, the off-cut
   landing (a plate's dark ring and a deep drum), thunder, and the swell as the name comes up. */
function cut(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  rain(c, out, t0, 4.5)
  ;[0.3, 0.52, 0.71, 0.93, 1.12].forEach((dt, i) => knock(c, out, t0 + dt, 130 - i * 5, 0.18))
  breath(c, out, t0 + 1.35, 0.8, { type: 'bandpass', from: 380, to: 800, q: 0.9, level: 0.4, attack: 0.08, echo: true })
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
  clang(c, out, t0 + 2.75, 0.1)
  thunder(c, out, t0 + 2.75, 1.8, 0.35)
  horn(c, out, t0 + 2.5, 2.0, [98, 146.83, 196], 0.05)
}

/* POUR -- the one Stephan liked, kept as it was: the mixer turning (a low rumble that throbs), the concrete going in,
   the shuttering knocked off -- five dull knocks, one per letter -- and the swell as it is polished. Plus the rain and
   a roll of thunder he asked for ("like rain ... and thunder"). */
function pour(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 4.6, 0.65)
  rain(c, out, t0, 4.5)
  mixer(c, out, t0, 2.3, 0.6)
  slosh(c, out, t0 + 0.65, 1.4)
  for (let i = 0; i < 5; i++) knock(c, out, t0 + 2.05 + i * 0.12, 120 - i * 6)
  thunder(c, out, t0 + 2.05, 2.4, 0.35)
  horn(c, out, t0 + 2.5, 2.0, [98, 146.83, 196], 0.05)
}

/* BUILD (Blueprint + Pour): the rain, soft knocks as each letter's formwork is drawn, the mixer and the slosh as the
   concrete goes in, five dull knocks and thunder as the shuttering comes off at 2.6 s, the swell as it is polished. */
function build(c: AudioContext, t0: number) {
  const out = softBus(c, t0, t0 + 5.1, 0.65)
  rain(c, out, t0, 5.0)
  for (let i = 0; i < 5; i++) knock(c, out, t0 + 0.4 + i * 0.17, 130 - i * 4, 0.18)
  mixer(c, out, t0 + 1.0, 1.8, 0.6)
  slosh(c, out, t0 + 1.25, 1.3)
  for (let i = 0; i < 5; i++) knock(c, out, t0 + 2.6 + i * 0.12, 120 - i * 6)
  thunder(c, out, t0 + 2.6, 2.4, 0.4)
  horn(c, out, t0 + 3.05, 2.0, [98, 146.83, 196], 0.05)
}
