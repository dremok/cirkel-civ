// The audio engine: WebAudio buses (music, ambience, sfx, ui -> master -> a soft safety limiter),
// unlocked on the first user gesture (iOS Safari included), lazy loading, voice limiting, ducking,
// panning, music decks with crossfades and rests, looping ambience beds, persisted settings.

import type { GameEvent } from '../../engine/types.ts'
import { ASSETS, type AssetId } from './assets.gen.ts'
import {
  AMBIENCE, MIX, MUSIC, SFX, STINGS, UI,
  type AmbienceKind, type MusicChoice, type MusicTrack, type SfxSound, type SoundDef, type Sting, type UiSound, type VolumeBus,
} from './catalog.ts'
import { scheduleReplay, type ReplayAudio, type ReplayAudioOptions } from './replay.ts'

const BASE = `${import.meta.env.BASE_URL}audio/`
const STORE = 'cirkel-civ.audio'
const MAX_VOICES = 24
const PAN_WIDTH = 0.7 // keep the stereo image gentle: a board game, not a shooter

export interface PlayOptions {
  /** -1 (left) .. 1 (right). */
  pan?: number
  /** Gain multiplier (1 = as mixed). */
  volume?: number
  /** Seconds from now. */
  delay?: number
  /** Playback rate multiplier (pitch). */
  rate?: number
}

interface Settings {
  volumes: Record<VolumeBus, number>
  muted: boolean
}

interface Loaded {
  buffer: AudioBuffer
  /** Leading silence to skip (decoders that keep the mp3 encoder delay). */
  offset: number
}

interface Voice {
  id: AssetId
  src: AudioBufferSourceNode
  gain: GainNode
  end: number
}

type BusName = 'music' | 'ambience' | 'sfx' | 'ui'

const DEFAULTS: Settings = { volumes: { master: 1, music: 1, ambience: 1, sfx: 1, ui: 1 }, muted: false }

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return structuredClone(DEFAULTS)
    const s = JSON.parse(raw) as Partial<Settings>
    const volumes = { ...DEFAULTS.volumes }
    for (const k of Object.keys(volumes) as VolumeBus[]) {
      const v = s.volumes?.[k]
      if (typeof v === 'number' && v >= 0 && v <= 1) volumes[k] = v
    }
    return { volumes, muted: s.muted === true }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    // private mode or storage blocked: settings just do not persist
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const cents = (spread: number) => (spread ? 2 ** (((Math.random() * 2 - 1) * spread) / 1200) : 1)

/** One music player: a streamed media element routed through WebAudio (so iOS can fade it). */
class Deck {
  readonly el: HTMLAudioElement
  readonly gain: GainNode
  track: MusicTrack | null = null

  constructor(ctx: AudioContext, out: AudioNode) {
    this.el = new Audio()
    this.el.preload = 'auto'
    this.el.crossOrigin = 'anonymous'
    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(out)
  }

  /** Play something silent inside a user gesture, so later play() calls are allowed (iOS). */
  prime() {
    const silence = `${BASE}silence.mp3`
    if (this.el.src) return
    this.el.src = silence
    this.el.play().then(() => { if (this.el.src.endsWith('silence.mp3')) this.el.pause() }).catch(() => {})
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buses: Record<BusName, GainNode> | null = null
  private duckMusic: GainNode | null = null
  private duckAmb: GainNode | null = null
  private stingBus: GainNode | null = null
  private settings: Settings = loadSettings()
  private listeners = new Set<() => void>()
  private isUnlocked = false

  private bytes = new Map<string, Promise<ArrayBuffer | null>>()
  private decoding = new Map<string, Promise<Loaded | null>>()
  private ready = new Map<string, Loaded>()
  private voices: Voice[] = []
  private lastVariant = new Map<AssetId, number>()
  private lastStart = new Map<AssetId, number>()

  private decks: Deck[] = []
  private wantMusic: MusicChoice | null = null
  private playing: { deck: Deck; track: MusicTrack } | null = null
  private restTimer: ReturnType<typeof setTimeout> | undefined
  private tension = 0
  private lastAutoSwitch = 0
  private pausedByHide: HTMLAudioElement | null = null

  private wantAmb: AmbienceKind | null = null
  private beds = new Map<AssetId, { src: AudioBufferSourceNode; gain: GainNode }>()
  private ambGen = 0

  constructor() {
    if (typeof window === 'undefined') return
    const onGesture = () => this.unlock()
    for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(type, onGesture, { capture: true, passive: true })
    document.addEventListener('visibilitychange', () => this.onVisibility())
  }

  // ------------------------------------------------------------------------------- public API

  /** Call from a user gesture (also done automatically on the first pointer, touch or key). */
  unlock(): void {
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state !== 'running' && document.visibilityState !== 'hidden') ctx.resume().catch(() => {})
    if (this.isUnlocked) return
    // iOS: start a buffer inside the gesture, and prime the music players.
    const src = ctx.createBufferSource()
    src.buffer = ctx.createBuffer(1, 1, 22050)
    src.connect(ctx.destination)
    src.start(0)
    for (const d of this.decks) d.prime()
    this.isUnlocked = true
    this.preload('ui')
    this.preload('sfx')
    this.applyMusic(2.5)
    this.applyAmbience()
    this.emit()
  }

  get unlocked(): boolean {
    return this.isUnlocked
  }

  ui(name: UiSound, opts: PlayOptions = {}): void {
    this.play(UI[name], 'ui', opts)
  }

  sfx(name: SfxSound, opts: PlayOptions = {}): void {
    this.play(SFX[name], 'sfx', opts)
  }

  /** Change the music (crossfade). 'game' follows the fighting; null fades out. */
  music(choice: MusicChoice | null): void {
    if (choice === this.wantMusic) return
    this.wantMusic = choice
    this.applyMusic(choice === 'game' && this.playing ? 4 : 2.5)
  }

  /** A short closing phrase; the music fades out under it and stays off until music() is called. */
  sting(kind: Sting, delay = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.isUnlocked || !this.stingBus) return
    this.wantMusic = null
    this.applyMusic(1.5)
    const def = STINGS[kind]
    const file = ASSETS[def.asset].files[0]
    void this.load(file).then((l) => {
      if (!l || !this.ctx || !this.stingBus) return
      const src = this.ctx.createBufferSource()
      src.buffer = l.buffer
      const g = this.ctx.createGain()
      g.gain.value = def.gain
      src.connect(g).connect(this.stingBus)
      src.start(this.ctx.currentTime + Math.max(0.05, delay))
      src.onended = () => g.disconnect()
    })
  }

  /** Change the ambience bed (crossfade). */
  ambience(kind: AmbienceKind | null): void {
    if (kind === this.wantAmb) return
    this.wantAmb = kind
    this.applyAmbience()
  }

  /** Schedule the sounds of a resolved turn; see replay.ts. */
  onEvents(events: GameEvent[], tickSeconds: number, opts?: ReplayAudioOptions): ReplayAudio {
    return scheduleReplay(
      {
        sfx: (name, o) => this.sfx(name, o),
        pulse: (delay) => this.ui('tick', { delay }),
        sting: (kind, delay) => this.sting(kind, delay),
        noteCombat: (n) => this.noteCombat(n),
      },
      events, tickSeconds, opts,
    )
  }

  volume(bus: VolumeBus): number {
    return this.settings.volumes[bus]
  }

  /** v is 0..1 (perceptual: the gain is v squared). Persisted. */
  setVolume(bus: VolumeBus, v: number): void {
    this.settings.volumes[bus] = clamp(Number.isFinite(v) ? v : 1, 0, 1)
    saveSettings(this.settings)
    this.applyVolumes()
    this.emit()
  }

  get muted(): boolean {
    return this.settings.muted
  }

  setMuted(b: boolean): void {
    this.settings.muted = b
    saveSettings(this.settings)
    this.applyVolumes()
    this.emit()
  }

  /** Called on any settings or unlock change (for UI controls). Returns an unsubscribe. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Fetch (and, once unlocked, decode) a group of sounds ahead of use. */
  preload(group: 'ui' | 'sfx' | 'ambience' | 'music'): void {
    const bus = group === 'ambience' ? 'amb' : group
    for (const a of Object.values(ASSETS)) {
      if (a.bus !== bus) continue
      for (const f of a.files) {
        if (bus === 'music' && !f.includes('sting')) {
          continue // streamed by the media elements
        }
        if (this.ctx) void this.load(f)
        else void this.fetchBytes(f)
      }
    }
  }

  // ------------------------------------------------------------------------------------ graph

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.ctx = ctx
    const limiter = ctx.createDynamicsCompressor()
    // a safety net for rare summed peaks only: below -3 dBFS it does nothing, so clicks never pump the mix
    limiter.threshold.value = -3
    limiter.knee.value = 2
    limiter.ratio.value = 12
    limiter.attack.value = 0.002
    limiter.release.value = 0.15
    limiter.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.connect(limiter)
    const bus = () => ctx.createGain()
    this.buses = { music: bus(), ambience: bus(), sfx: bus(), ui: bus() }
    this.duckMusic = ctx.createGain()
    this.duckAmb = ctx.createGain()
    this.stingBus = ctx.createGain()
    this.duckMusic.connect(this.buses.music)
    this.stingBus.connect(this.buses.music)
    this.duckAmb.connect(this.buses.ambience)
    for (const b of Object.values(this.buses)) b.connect(this.master)
    this.decks = [new Deck(ctx, this.duckMusic), new Deck(ctx, this.duckMusic)]
    this.applyVolumes(0)
    return ctx
  }

  private applyVolumes(ramp = 0.08) {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.buses) return
    const v = this.settings.volumes
    const set = (g: GainNode, value: number) => {
      g.gain.cancelScheduledValues(ctx.currentTime)
      if (ramp > 0) g.gain.setTargetAtTime(value, ctx.currentTime, ramp / 3)
      else g.gain.value = value
    }
    set(this.master, this.settings.muted ? 0 : MIX.master * v.master ** 2)
    for (const name of Object.keys(this.buses) as BusName[]) set(this.buses[name], MIX[name] * v[name] ** 2)
  }

  private emit() {
    for (const cb of this.listeners) cb()
  }

  private onVisibility() {
    const ctx = this.ctx
    if (!ctx) return
    if (document.visibilityState === 'hidden') {
      const el = this.playing?.deck.el
      if (el && !el.paused) {
        el.pause()
        this.pausedByHide = el
      }
      ctx.suspend().catch(() => {})
    } else if (this.isUnlocked) {
      ctx.resume().catch(() => {})
      if (this.pausedByHide && this.playing?.deck.el === this.pausedByHide) this.pausedByHide.play().catch(() => {})
      this.pausedByHide = null
    }
  }

  // ---------------------------------------------------------------------------------- loading

  private fetchBytes(file: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(file)
    if (!p) {
      p = fetch(BASE + file).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
      this.bytes.set(file, p)
    }
    return p
  }

  private load(file: string): Promise<Loaded | null> {
    const ctx = this.ctx
    if (!ctx) return Promise.resolve(null)
    let p = this.decoding.get(file)
    if (!p) {
      p = this.fetchBytes(file)
        .then((ab) => (ab ? new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej)) : null))
        .then((buffer) => {
          this.bytes.delete(file)
          if (!buffer) return null
          const l: Loaded = { buffer, offset: file.startsWith('amb/') ? 0 : leadingSilence(buffer) }
          this.ready.set(file, l)
          return l
        })
        .catch(() => null)
      this.decoding.set(file, p)
    }
    return p
  }

  // ----------------------------------------------------------------------------------- voices

  private play(def: SoundDef, bus: BusName, opts: PlayOptions) {
    const ctx = this.ctx
    if (!ctx || !this.isUnlocked || ctx.state === 'closed' || this.settings.muted || document.visibilityState === 'hidden') return
    const files = ASSETS[def.asset].files
    let vi = 0
    if (files.length > 1) {
      // random, but never the same variation twice in a row
      const last = this.lastVariant.get(def.asset) ?? -1
      vi = Math.floor(Math.random() * (files.length - 1))
      if (vi >= last && last >= 0) vi++
      this.lastVariant.set(def.asset, vi)
    }
    const file = files[vi]
    const when = ctx.currentTime + Math.max(0, opts.delay ?? 0)
    const l = this.ready.get(file)
    if (l) {
      this.start(def, bus, l, when, opts)
      return
    }
    void this.load(file).then((loaded) => {
      if (loaded && this.ctx && this.ctx.currentTime - when < 0.12) this.start(def, bus, loaded, Math.max(when, this.ctx.currentTime), opts)
    })
  }

  private start(def: SoundDef, bus: BusName, l: Loaded, when: number, opts: PlayOptions) {
    const ctx = this.ctx!
    const now = ctx.currentTime
    this.voices = this.voices.filter((v) => v.end > now)
    const same = this.voices.filter((v) => v.id === def.asset)
    if (same.length >= def.voices) {
      if (!def.steal) return
      const old = same[0]
      old.gain.gain.setTargetAtTime(0, now, 0.01)
      old.src.stop(now + 0.05)
      this.voices.splice(this.voices.indexOf(old), 1)
    }
    if (this.voices.length >= MAX_VOICES) return
    // two starts of the same sound within 30 ms only make it phasey and louder
    const prev = this.lastStart.get(def.asset)
    if (prev !== undefined && Math.abs(when - prev) < 0.03) return
    this.lastStart.set(def.asset, when)

    const src = ctx.createBufferSource()
    src.buffer = l.buffer
    const rate = (opts.rate ?? 1) * cents(def.cents)
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = def.gain * (opts.volume ?? 1)
    src.connect(g)
    let out: AudioNode = g
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = clamp(opts.pan, -1, 1) * PAN_WIDTH
      g.connect(p)
      out = p
    }
    out.connect(this.buses![bus])
    src.start(when, l.offset)
    src.onended = () => {
      src.disconnect()
      g.disconnect()
      if (out !== g) out.disconnect()
    }
    this.voices.push({ id: def.asset, src, gain: g, end: when + (l.buffer.duration - l.offset) / rate })
    if (def.duck) this.duck(def.duck.depth, def.duck.hold, when)
  }

  private duck(depth: number, hold: number, when: number) {
    for (const [node, d] of [[this.duckMusic, depth], [this.duckAmb, 1 - (1 - depth) * 0.5]] as const) {
      if (!node) continue
      const g = node.gain
      g.cancelScheduledValues(when)
      g.setTargetAtTime(d, when, 0.04)
      g.setTargetAtTime(1, when + hold, 0.45)
    }
  }

  // ------------------------------------------------------------------------------------ music

  private noteCombat(amount: number) {
    this.tension = this.tension * 0.55 + amount
    if (this.wantMusic === 'game') this.applyMusic(4)
  }

  private resolveMusic(): MusicTrack | null {
    if (this.wantMusic !== 'game') return this.wantMusic
    const current = this.playing?.track
    const battle = current === 'battle' ? this.tension >= 1.2 : this.tension >= 4
    const want: MusicTrack = battle ? 'battle' : 'planning'
    // auto changes no more than every 30 s, so the music never flickers between moods
    if (current && current !== want && current !== 'city' && performance.now() - this.lastAutoSwitch < 30_000) return current
    return want
  }

  private applyMusic(fade: number) {
    if (!this.ctx || !this.isUnlocked) return
    const want = this.resolveMusic()
    if (want === null) {
      clearTimeout(this.restTimer)
      if (this.playing) this.fadeOut(this.playing.deck, 2)
      this.playing = null
      return
    }
    if (this.playing?.track === want) return
    if (this.wantMusic === 'game') this.lastAutoSwitch = performance.now()
    this.startTrack(want, fade)
  }

  private startTrack(track: MusicTrack, fade: number) {
    const ctx = this.ctx!
    clearTimeout(this.restTimer)
    const def = MUSIC[track]
    const old = this.playing
    const deck = this.decks.find((d) => d !== old?.deck)!
    deck.track = track
    deck.el.onended = () => this.onTrackEnded(deck)
    deck.el.src = BASE + ASSETS[def.asset].files[0]
    const g = deck.gain.gain
    const now = ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(0, now)
    g.linearRampToValueAtTime(def.gain, now + fade)
    deck.el.play().catch(() => {})
    if (old) this.fadeOut(old.deck, fade * 1.2)
    this.playing = { deck, track }
  }

  private fadeOut(deck: Deck, secs: number) {
    const ctx = this.ctx!
    const g = deck.gain.gain
    const now = ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + secs)
    deck.el.onended = null
    const src = deck.el.src
    setTimeout(() => {
      if (deck.el.src === src && this.playing?.deck !== deck) deck.el.pause()
    }, secs * 1000 + 100)
  }

  private onTrackEnded(deck: Deck) {
    const p = this.playing
    if (!p || p.deck !== deck) return
    const [a, b] = MUSIC[p.track].rest
    clearTimeout(this.restTimer)
    this.restTimer = setTimeout(() => {
      if (this.playing?.deck !== deck || !this.ctx) return
      const g = deck.gain.gain
      g.cancelScheduledValues(this.ctx.currentTime)
      g.setValueAtTime(MUSIC[p.track].gain, this.ctx.currentTime)
      deck.el.currentTime = 0
      deck.el.play().catch(() => {})
    }, (a + Math.random() * (b - a)) * 1000)
  }

  // --------------------------------------------------------------------------------- ambience

  private applyAmbience() {
    const ctx = this.ctx
    if (!ctx || !this.isUnlocked || !this.duckAmb) return
    const gen = ++this.ambGen
    const layers = this.wantAmb ? AMBIENCE[this.wantAmb] : []
    const wanted = new Map(layers)
    const now = ctx.currentTime
    for (const [id, bed] of this.beds) {
      if (wanted.has(id)) continue
      bed.gain.gain.cancelScheduledValues(now)
      bed.gain.gain.setTargetAtTime(0, now, 0.8)
      bed.src.stop(now + 4)
      this.beds.delete(id)
    }
    for (const [id, level] of layers) {
      const bed = this.beds.get(id)
      if (bed) {
        bed.gain.gain.cancelScheduledValues(now)
        bed.gain.gain.setTargetAtTime(level, now, 0.8)
        continue
      }
      const asset = ASSETS[id]
      void this.load(asset.files[0]).then((l) => {
        if (!l || gen !== this.ambGen || this.beds.has(id) || !this.ctx || !this.duckAmb) return
        const c = this.ctx
        const src = c.createBufferSource()
        src.buffer = l.buffer
        src.loop = true
        const [a, b] = 'loop' in asset ? asset.loop : [0, l.buffer.duration]
        src.loopStart = a
        src.loopEnd = b
        const g = c.createGain()
        g.gain.value = 0
        g.gain.setTargetAtTime(level, c.currentTime, 1)
        src.connect(g).connect(this.duckAmb)
        src.start(c.currentTime, a + Math.random() * (b - a))
        this.beds.set(id, { src, gain: g })
      })
    }
  }
}

/** Seconds of near-silence at the start of a buffer (at most 80 ms). */
function leadingSilence(b: AudioBuffer): number {
  const x = b.getChannelData(0)
  const n = Math.min(x.length, Math.floor(b.sampleRate * 0.08))
  for (let i = 0; i < n; i++) if (Math.abs(x[i]) > 5e-4) return Math.max(0, i / b.sampleRate - 0.001)
  return 0
}
