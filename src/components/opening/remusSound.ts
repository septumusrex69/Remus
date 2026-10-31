import type { RemusVariant } from './RemusOpening'

/**
 * THE SOUND OF REMUS'S OPENINGS (Remus · Handoff 6), drawn by the browser and timed to RemusOpening's clock.
 *
 * HARD, NOT CLASSICAL (31 Oct). The first set borrowed Raptor's soft way -- a warm horn, a long echo -- and Stephan:
 * "I don't like any of the [sounds] ... this classical thing is not here. Remus is hard. Remus is a builder. Remus is
 * like doof, doof, doof, doof ... an undertone of like, training ... construction [sounds] in there ... like hammers."
 * So every opening runs on a beat: a heavy kick ("doof") on a 0.35 s grid -- the same grid the letters land on --
 * with a distorted bass pulsing between the kicks (the gym/training drive), and the building site on top: sledgehammers
 * on steel, a nail gun, an angle grinder, a concrete mixer, a steel plate crashing, shuttering knocked off -- and, after Stephan picked
 * Pour's as "the closest" ("like rain ... and thunder"), rain under all four and thunder on the big hits. All of it goes
 * through a saturator and a compressor so it hits hard and stays loud on a phone or iPad speaker. No horn, no pad.
 *
 * A browser plays sound only after a press: the Sign in button wakes it (primeOpeningAudio), and a refusal is silence,
 * never a wait (Raptor's rule, kept).
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

/** The beat's grid: the letters land on it (RemusOpening's STAMP_EVERY). */
const BEAT = 0.35

type Out = { bus: GainNode; room: DelayNode }

/** The desk: everything into a saturator and a compressor (hard and loud), a short slap of room, fade at the end. */
function hardBus(c: AudioContext, t0: number, end: number): Out {
  const bus = c.createGain()
  bus.gain.value = 1
  const drive = c.createWaveShaper()
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(2.2 * x) }
  drive.curve = curve
  drive.oversample = '2x'
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.knee.value = 4
  comp.ratio.value = 6
  comp.attack.value = 0.003
  comp.release.value = 0.12
  const top = c.createBiquadFilter()
  top.type = 'lowpass'
  top.frequency.value = 7000
  const master = c.createGain()
  master.gain.setValueAtTime(0.9, t0)
  master.gain.setValueAtTime(0.9, end - 0.6)
  master.gain.exponentialRampToValueAtTime(0.0001, end)
  bus.connect(drive); drive.connect(top); top.connect(comp); comp.connect(master); master.connect(c.destination)
  /* A short slap off the site walls, not a concert hall. */
  const room = c.createDelay(0.5)
  room.delayTime.value = 0.09
  const fb = c.createGain()
  fb.gain.value = 0.22
  const dark = c.createBiquadFilter()
  dark.type = 'lowpass'
  dark.frequency.value = 1800
  room.connect(dark); dark.connect(fb); fb.connect(room); dark.connect(bus)
  return { bus, room }
}

function env(c: AudioContext, at: number, peak: number, attack: number, len: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  return g
}

function noise(c: AudioContext, seconds: number, white = true): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const r = Math.random() * 2 - 1
    if (white) d[i] = r
    else { last = (last + 0.02 * r) / 1.02; d[i] = last * 3.5 }
  }
  const s = c.createBufferSource()
  s.buffer = buf
  return s
}

/** Filtered noise with a shape. */
function hiss(c: AudioContext, out: Out, at: number, len: number, type: BiquadFilterType, freq: number, level: number, o: { q?: number; to?: number; attack?: number; white?: boolean } = {}) {
  const s = noise(c, len, o.white ?? true)
  const f = c.createBiquadFilter()
  f.type = type
  f.Q.value = o.q ?? 0.8
  f.frequency.setValueAtTime(freq, at)
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, at + len)
  const g = env(c, at, level, o.attack ?? 0.002, len)
  s.connect(f); f.connect(g); g.connect(out.bus)
  s.start(at); s.stop(at + len)
}

function tone(c: AudioContext, out: Out, at: number, len: number, type: OscillatorType, from: number, to: number, level: number, drop = 0.1, room = false) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + drop)
  const g = env(c, at, level, 0.003, len)
  o.connect(g); g.connect(out.bus)
  if (room) g.connect(out.room)
  o.start(at); o.stop(at + len + 0.02)
}

/** DOOF: a heavy kick -- a sine falling from 170 to 46 Hz -- with a click on the front so a phone speaker hears it. */
function kick(c: AudioContext, out: Out, at: number, level = 0.9, len = 0.5) {
  tone(c, out, at, len, 'sine', 170, 46, level, 0.11)
  hiss(c, out, at, 0.012, 'highpass', 1800, level * 0.35)
}

/** The training drive: a distorted bass note between the kicks, ducking out of the kick's way. */
function bassPulse(c: AudioContext, out: Out, at: number, hz = 55, level = 0.32) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, at)
  lp.frequency.exponentialRampToValueAtTime(180, at + 0.2)
  const g = env(c, at, level, 0.01, 0.24)
  lp.connect(g); g.connect(out.bus)
  for (const det of [-9, 9]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = det
    o.connect(lp)
    o.start(at); o.stop(at + 0.26)
  }
}

/** The beat bed: kicks on the grid from `start`, bass on each off-beat, for `count` beats. */
function beat(c: AudioContext, out: Out, start: number, count: number, o: { skip?: number[]; hz?: number } = {}) {
  for (let i = 0; i < count; i++) {
    const at = start + i * BEAT
    if (!o.skip?.includes(i)) kick(c, out, at, 0.8)
    bassPulse(c, out, at + BEAT / 2, o.hz ?? 55)
  }
}

/** A sledgehammer on steel: the thump, the crack, and the ring of the metal (inharmonic, short). */
function hammer(c: AudioContext, out: Out, at: number, level = 0.7) {
  tone(c, out, at, 0.18, 'sine', 240, 95, level * 0.8, 0.05)
  hiss(c, out, at, 0.04, 'bandpass', 3200, level * 0.6, { q: 0.7 })
  for (const [hz, l, len] of [[612, 0.32, 0.35], [1393, 0.22, 0.25], [2207, 0.14, 0.18], [3110, 0.08, 0.12]] as const) {
    tone(c, out, at, len, 'sine', hz, hz * 0.995, level * l, 0.3, true)
  }
}

/** Shuttering knocked off: a hammer on timber -- dull, woody, no ring. */
function knock(c: AudioContext, out: Out, at: number, level = 0.6) {
  tone(c, out, at, 0.12, 'sine', 330, 180, level, 0.04)
  hiss(c, out, at, 0.05, 'bandpass', 900, level * 0.7, { q: 1.5 })
}

/** A nail gun: the pneumatic bang and the hiss of air after. */
function nailGun(c: AudioContext, out: Out, at: number, level = 0.55) {
  hiss(c, out, at, 0.02, 'highpass', 2500, level * 0.8)
  tone(c, out, at, 0.09, 'sine', 200, 70, level * 0.9, 0.05)
  hiss(c, out, at + 0.015, 0.16, 'bandpass', 2400, level * 0.25, { q: 1, to: 1200, attack: 0.01 })
}

/** An angle grinder biting into steel: a whining motor rising, the shriek of the disc kept under 4 kHz. */
function grinder(c: AudioContext, out: Out, at: number, len: number, level = 0.22) {
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 3
  bp.frequency.setValueAtTime(1100, at)
  bp.frequency.linearRampToValueAtTime(1900, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.06)
  g.gain.setValueAtTime(level, at + len - 0.08)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  bp.connect(g); g.connect(out.bus)
  for (const [hz, det] of [[180, 0], [181.5, 0], [360, 7]] as const) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(hz, at)
    o.frequency.linearRampToValueAtTime(hz * 1.35, at + len * 0.3)
    o.detune.value = det
    o.connect(bp)
    o.start(at); o.stop(at + len)
  }
  hiss(c, out, at, len, 'bandpass', 2600, level * 0.9, { q: 1.2, attack: 0.05 })
}

/** A steel plate hitting the floor: the slam, a long low ring and a rattle. */
function plateCrash(c: AudioContext, out: Out, at: number, level = 0.8) {
  kick(c, out, at, level, 0.7)
  for (const [hz, l, len] of [[87, 0.5, 1.4], [143, 0.4, 1.1], [231, 0.3, 0.9], [377, 0.2, 0.7], [611, 0.15, 0.5]] as const) {
    tone(c, out, at, len, 'triangle', hz, hz * 0.99, level * l, 0.4, true)
  }
  hiss(c, out, at, 0.35, 'bandpass', 1500, level * 0.5, { q: 0.6, to: 500 })
  for (let i = 1; i <= 4; i++) hammer(c, out, at + i * 0.07 + i * i * 0.01, level * 0.25 / i)
}

/** Rain on the site: a soft wash of high noise, and drops ticking on sheeting and steel at random. */
function rain(c: AudioContext, out: Out, at: number, len: number, level = 0.12) {
  const s = noise(c, len)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 900
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 5500
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.6)
  g.gain.setValueAtTime(level, at + len - 0.8)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out.bus)
  s.start(at); s.stop(at + len)
  /* Single drops: a tick each, pitched at random, thickest in the middle. */
  for (let t = 0.1; t < len - 0.3; t += 0.02 + Math.random() * 0.05) {
    const hz = 1800 + Math.random() * 2600
    tone(c, out, at + t, 0.025, 'sine', hz, hz * 0.6, level * (0.25 + Math.random() * 0.45), 0.02)
  }
}

/** Thunder: a crack up front, then a long low roll that grumbles as it fades. */
function thunder(c: AudioContext, out: Out, at: number, len = 2.4, level = 0.85) {
  hiss(c, out, at, 0.18, 'bandpass', 1400, level * 0.55, { q: 0.5, to: 300 })
  const s = noise(c, len, false)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(420, at)
  lp.frequency.exponentialRampToValueAtTime(90, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.05)
  /* The roll: the level swelling and sagging a few times on the way down. */
  let v = level
  for (let t = 0.25; t < len; t += 0.2 + Math.random() * 0.25) {
    v *= 0.72
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * (0.6 + Math.random() * 0.8)), at + t)
  }
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  s.connect(lp); lp.connect(g); g.connect(out.bus); g.connect(out.room)
  s.start(at); s.stop(at + len)
  tone(c, out, at, 0.9, 'sine', 70, 38, level * 0.6, 0.6)
}

/** The concrete mixer turning: a low rumble that throbs (Pour's first sound, which Stephan liked). */
function mixer(c: AudioContext, out: Out, at: number, len: number, level = 0.6) {
  const s = noise(c, len, false)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 220
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.4)
  g.gain.setValueAtTime(level, at + len - 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  const lfo = c.createOscillator()
  const depth = c.createGain()
  lfo.frequency.value = 6.5
  depth.gain.value = level * 0.5
  lfo.connect(depth); depth.connect(g.gain)
  s.connect(lp); lp.connect(g); g.connect(out.bus)
  s.start(at); s.stop(at + len); lfo.start(at); lfo.stop(at + len)
}

/** The rush before a hit: noise swelling up into it. */
function riser(c: AudioContext, out: Out, at: number, len: number, level = 0.25) {
  hiss(c, out, at, len, 'bandpass', 400, level, { q: 1, to: 3000, attack: len * 0.9 })
}

/* STAMP: each letter lands on a kick with a sledgehammer on steel and a puff of grit -- DOOF, DOOF, DOOF, DOOF -- the
   last one doubled; the beat and the bass carry on under the light along the steel, then a final slam. */
function stamp(c: AudioContext, t0: number) {
  const out = hardBus(c, t0, t0 + 4.6)
  rain(c, out, t0, 4.5)
  thunder(c, out, t0 + 0.37 + 4 * BEAT, 2.4, 0.7)
  riser(c, out, t0, 0.37, 0.18)
  const first = t0 + 0.37
  for (let i = 0; i < 5; i++) {
    const at = first + i * BEAT
    kick(c, out, at, i === 4 ? 1 : 0.9, i === 4 ? 0.8 : 0.5)
    hammer(c, out, at, i === 4 ? 0.85 : 0.6)
    hiss(c, out, at + 0.01, 0.3, 'lowpass', 1200, 0.25, { to: 300 })
    bassPulse(c, out, at + BEAT / 2, 55)
  }
  beat(c, out, first + 5 * BEAT, 4)
  plateCrash(c, out, first + 9 * BEAT, 0.7)
}

/* SLASH: the beat already going, an angle grinder screaming up the cut line, the halves parting with a ring of steel,
   then a sledgehammer slam as they clack back together, and the beat drives on. Clack at 1.62 s = on the grid. */
function slash(c: AudioContext, t0: number) {
  const out = hardBus(c, t0, t0 + 4.6)
  rain(c, out, t0, 4.5)
  thunder(c, out, t0 + 0.55, 1.2, 0.4)
  thunder(c, out, t0 + 1.62, 2.6, 0.85)
  const start = t0 + 0.22
  beat(c, out, start, 4)
  grinder(c, out, t0 + 0.5, 0.6, 0.24)
  hammer(c, out, t0 + 0.98, 0.35)
  riser(c, out, t0 + 1.2, 0.42, 0.25)
  const clack = start + 4 * BEAT
  kick(c, out, clack, 1, 0.8)
  hammer(c, out, clack, 0.9)
  hiss(c, out, clack, 0.35, 'lowpass', 1400, 0.3, { to: 300 })
  bassPulse(c, out, clack + BEAT / 2, 55)
  beat(c, out, clack + BEAT, 5)
  plateCrash(c, out, clack + 6 * BEAT, 0.6)
}

/* BLUEPRINT: nail-gun shots as the lines go down, the beat kicking in, the grinder through the plate with the torch,
   and the off-cut crashing to the floor on the beat. */
function cut(c: AudioContext, t0: number) {
  const out = hardBus(c, t0, t0 + 4.6)
  rain(c, out, t0, 4.5, 0.1)
  thunder(c, out, t0 + 0.3 + 7 * BEAT, 1.8, 0.7)
  const start = t0 + 0.3
  ;[0.3, 0.47, 0.65, 0.82, 1.0, 1.17].forEach((dt) => nailGun(c, out, t0 + dt, 0.5))
  beat(c, out, start, 7, { skip: [0, 1] })
  grinder(c, out, t0 + 1.35, 0.78, 0.26)
  plateCrash(c, out, start + 7 * BEAT, 0.95)
  beat(c, out, start + 8 * BEAT, 2)
}

/* POUR -- the one Stephan liked ("the closest ... kind of cool ... like rain ... and thunder"): rain on the site, the
   mixer throbbing under the beat as the concrete goes in, a slosh, then the shuttering knocked off -- five dull blows on
   timber, one per letter -- with a thunderclap on the first, and the beat driving out. Strikes at 2.05 s = on the grid. */
function pour(c: AudioContext, t0: number) {
  const out = hardBus(c, t0, t0 + 4.6)
  const start = t0 + 0.3
  rain(c, out, t0, 4.5, 0.14)
  thunder(c, out, t0 + 0.05, 1.6, 0.45)
  mixer(c, out, t0, 2.2, 0.6)
  beat(c, out, start, 5)
  hiss(c, out, t0 + 0.65, 1.4, 'bandpass', 300, 0.35, { q: 0.8, to: 520, attack: 0.5, white: false })
  const strikes = start + 5 * BEAT
  thunder(c, out, strikes, 2.4, 0.85)
  for (let i = 0; i < 5; i++) knock(c, out, strikes + i * 0.12, 0.75)
  kick(c, out, strikes, 0.95)
  beat(c, out, strikes + BEAT * 2, 4)
}

/* BUILD (Blueprint + Pour): rain from the start, nail-gun shots as each letter's formwork is drawn, the mixer throbbing
   under the beat as the concrete goes in, then the thunderclap and five blows on timber as the shuttering comes off,
   and the beat driving out. Strikes at 2.6 s = on the grid (0.15 + 7 beats). */
function build(c: AudioContext, t0: number) {
  const out = hardBus(c, t0, t0 + 5.1)
  const start = t0 + 0.15
  rain(c, out, t0, 5.0, 0.13)
  for (let i = 0; i < 5; i++) { nailGun(c, out, t0 + 0.35 + i * 0.17, 0.5); nailGun(c, out, t0 + 0.43 + i * 0.17, 0.35) }
  beat(c, out, start, 7, { skip: [0, 1, 2] })
  mixer(c, out, t0 + 1.1, 1.6, 0.6)
  hiss(c, out, t0 + 1.25, 1.3, 'bandpass', 300, 0.35, { q: 0.8, to: 520, attack: 0.5, white: false })
  const strikes = start + 7 * BEAT
  thunder(c, out, strikes, 2.4, 0.9)
  for (let i = 0; i < 5; i++) knock(c, out, strikes + i * 0.12, 0.75)
  kick(c, out, strikes, 0.95)
  beat(c, out, strikes + BEAT * 2, 5)
}
