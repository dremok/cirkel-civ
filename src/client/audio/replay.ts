// Sounds for a resolved turn's replay. The events are laid out tick by tick the way the visual replay
// (render/pieces/replay.ts) lays them out, about 0.5 s per tick at speed 1, and each tick's sounds
// are aggregated: twelve units stepping at once give a few footsteps, not twelve.
//
// Self-clocked by default. For exact sync pass the handle's tick() to PlaybackOptions.onTick: the
// first call switches it to follow the visuals.

import type { GameEvent, GameState, PlayerId, Target, Tick, TileId, UnitId, UnitType } from '../../engine/types.ts'
import type { SfxSound, Sting } from './catalog.ts'

export interface ReplayAudioOptions {
  /** Whose replay this is: decides victory or defeat. */
  me?: PlayerId | null
  /** The state the turn started from (unit and city positions, for panning). */
  prev?: GameState
  /** Screen x of a tile: -1 (left edge) .. 1 (right edge); beyond that is off screen (quieter). */
  pan?: (tile: TileId) => number | null | undefined
  /** Never self-clock: play a tick only when tick(t) is called. */
  manual?: boolean
}

export interface ReplayAudio {
  /** Play tick t now (call from PlaybackOptions.onTick). */
  tick(t: Tick): void
  /** Stop scheduling (skip). */
  stop(): void
  /** Nominal length in seconds, and when each tick starts (seconds after the call). */
  readonly duration: number
  readonly ticks: readonly { t: Tick; start: number }[]
}

export interface ReplayHost {
  sfx(name: SfxSound, opts: { pan?: number; volume?: number; delay?: number; rate?: number }): void
  pulse(delay: number): void
  sting(kind: Sting, delay: number): void
  noteCombat(amount: number): void
}

interface Cue {
  at: number // seconds after the tick starts
  sound: SfxSound | 'pulse' | Sting
  tile: TileId | null
  volume: number
  rate?: number
}

interface TickPlan {
  t: Tick
  start: number
  cues: Cue[]
}

export function scheduleReplay(host: ReplayHost, events: GameEvent[], tickSeconds: number, opts: ReplayAudioOptions = {}): ReplayAudio {
  const { plan, duration, combat } = buildPlan(events, tickSeconds, opts)
  host.noteCombat(combat)
  const fired = new Set<Tick>()
  const timers: ReturnType<typeof setTimeout>[] = []
  let following = !!opts.manual
  let stopped = false

  const fire = (p: TickPlan) => {
    if (stopped || fired.has(p.t)) return
    fired.add(p.t)
    for (const c of p.cues) {
      let pan = 0
      let gain = c.volume
      if (c.tile !== null && opts.pan) {
        const x = opts.pan(c.tile)
        if (x !== null && x !== undefined && Number.isFinite(x)) {
          const off = Math.abs(x) - 1
          if (off > 0) gain *= Math.max(0.35, 1 - off)
          pan = Math.max(-1, Math.min(1, x))
        }
      }
      if (c.sound === 'pulse') host.pulse(c.at)
      else if (c.sound === 'victory' || c.sound === 'defeat') host.sting(c.sound, c.at)
      else host.sfx(c.sound, { pan, volume: gain, delay: c.at, rate: c.rate })
    }
  }

  if (!following) for (const p of plan) timers.push(setTimeout(() => fire(p), p.start * 1000))

  return {
    duration,
    ticks: plan.map((p) => ({ t: p.t, start: p.start })),
    tick(t: Tick) {
      if (!following) {
        following = true
        for (const id of timers) clearTimeout(id)
      }
      const p = plan.find((x) => x.t === t)
      if (p) fire(p)
    },
    stop() {
      stopped = true
      for (const id of timers) clearTimeout(id)
    },
  }
}

const CAP: Partial<Record<SfxSound, number>> = { clash: 3, hit: 4, fall: 3, cityHit: 2, capture: 1, found: 1, fail: 1, muster: 1, built: 1, grow: 1, halt: 1 }

function buildPlan(events: GameEvent[], secPerTick: number, opts: ReplayAudioOptions) {
  const k = secPerTick / 0.5 // timings are authored for 0.5 s per tick, like the visual replay
  const byTick = new Map<Tick, GameEvent[]>()
  for (const e of events) {
    if (!byTick.has(e.t)) byTick.set(e.t, [])
    byTick.get(e.t)!.push(e)
  }
  const lastMoveTick = Math.max(0, ...events.filter((e) => e.t <= 6).map((e) => e.t))
  const ticks: Tick[] = []
  for (let t = 1; t <= lastMoveTick; t++) ticks.push(t)
  for (const t of [7, 8]) if (byTick.get(t)?.length) ticks.push(t)

  // Where things are, as the replay goes.
  const tileOf = new Map<UnitId, TileId>()
  const typeOf = new Map<UnitId, UnitType>()
  const cityTile = new Map<number, TileId>()
  for (const u of opts.prev?.units ?? []) {
    tileOf.set(u.id, u.tile)
    typeOf.set(u.id, u.type)
  }
  for (const c of opts.prev?.cities ?? []) cityTile.set(c.id, c.tile)
  for (const e of events) {
    if (e.kind === 'spawn') {
      typeOf.set(e.unit.id, e.unit.type)
      tileOf.set(e.unit.id, e.unit.tile)
    }
    if (e.kind === 'found') cityTile.set(e.city.id, e.city.tile)
  }
  const targetTile = (t: Target): TileId | null => ('unit' in t ? tileOf.get(t.unit) ?? null : cityTile.get(t.city) ?? null)

  const plan: TickPlan[] = []
  let S = 0.12 * k
  let combat = 0
  for (const t of ticks) {
    const list = byTick.get(t) ?? []
    const cues: Cue[] = []
    const count = new Map<SfxSound, number>()
    const add = (sound: SfxSound, at: number, tile: TileId | null, volume = 1, rate?: number) => {
      const n = count.get(sound) ?? 0
      if (n >= (CAP[sound] ?? 3)) return
      count.set(sound, n + 1)
      cues.push({ at, sound, tile, volume, rate })
    }
    let end = t <= 6 ? 0.5 * k : 0.3 * k
    if (t <= 6) cues.push({ at: 0, sound: 'pulse', tile: null, volume: 1 })

    // Footsteps and hooves: a few voices for the whole group, louder (gently) with its size.
    const steps: TileId[] = []
    const gallop: TileId[] = []
    for (const e of list) if (e.kind === 'move') (typeOf.get(e.unit) === 'rider' ? gallop : steps).push(e.to)
    const group = (sound: SfxSound, tiles: TileId[], maxVoices: number, at: number) => {
      if (!tiles.length) return
      const voices = Math.min(maxVoices, tiles.length)
      const vol = Math.sqrt((1 + 0.6 * Math.log(tiles.length)) / voices)
      for (let i = 0; i < voices; i++) {
        const tile = tiles[Math.floor(((i + 0.5) * tiles.length) / voices)]
        cues.push({ at: at + i * 0.045 * k + Math.random() * 0.03 * k, sound, tile, volume: vol })
      }
    }
    group('march', steps, 3, 0.03 * k)
    group('hooves', gallop, 2, 0.01 * k)

    // Volleys: release at the shooters, thuds at the targets.
    const shooters: TileId[] = []
    const struck: TileId[] = []
    const shotAt = new Set<UnitId>()
    for (const e of list) {
      if (e.kind !== 'shot') continue
      combat += 1
      const from = targetTile(e.from)
      const to = targetTile(e.target)
      if (from !== null) shooters.push(from)
      if (to !== null) struck.push(to)
      if ('unit' in e.target) shotAt.add(e.target.unit)
      else add('cityHit', 0.52 * k, to, 0.7)
      end = Math.max(end, 0.56 * k)
    }
    group('volley', shooters, 3, 0.1 * k)
    group('thuds', struck, 3, 0.5 * k)

    const meleeOn = new Set<UnitId>()
    for (const e of list) {
      switch (e.kind) {
        case 'move':
          tileOf.set(e.unit, e.to)
          end = Math.max(end, 0.42 * k)
          break
        case 'clash': {
          combat += 2
          meleeOn.add(e.a)
          meleeOn.add(e.b)
          const tile = e.tile ?? tileOf.get(e.a) ?? null
          add('clash', 0.16 * k, tile, 0.8 + 0.2 * Math.min(1, (e.dmgA + e.dmgB) / 8))
          end = Math.max(end, 0.48 * k)
          break
        }
        case 'melee': {
          combat += 1
          if ('unit' in e.target) meleeOn.add(e.target.unit)
          meleeOn.add(e.attacker)
          const tile = targetTile(e.target)
          add('hit', 0.16 * k, tile, 0.75 + 0.25 * Math.min(1, e.dmgToTarget / 5))
          if ('city' in e.target) add('cityHit', 0.18 * k, tile, 0.9)
          end = Math.max(end, 0.48 * k)
          break
        }
        case 'halt':
          if (e.reason === 'contact') add('halt', 0.05 * k, tileOf.get(e.unit) ?? null, 0.8)
          break
        case 'death': {
          combat += 1
          const at = shotAt.has(e.unit) ? 0.95 * k : meleeOn.has(e.unit) ? 0.6 * k : 0.38 * k
          add('fall', at, e.tile)
          break
        }
        case 'capture':
          add('capture', 0.45 * k, cityTile.get(e.city) ?? null)
          end = Math.max(end, 0.9 * k)
          break
        case 'found':
          add('found', 0.2 * k, e.city.tile)
          end = Math.max(end, 1.3 * k)
          break
        case 'foundFailed':
          add('fail', 0.05 * k, tileOf.get(e.unit) ?? null)
          break
        case 'spawn':
          add('muster', 0.05 * k, e.unit.tile)
          end = Math.max(end, 0.55 * k)
          break
        case 'built':
          if (e.item === 'walls') add('built', 0.05 * k, cityTile.get(e.city) ?? null)
          end = Math.max(end, 0.8 * k)
          break
        case 'grow':
          add('grow', 0.1 * k, cityTile.get(e.city) ?? null)
          end = Math.max(end, 0.7 * k)
          break
        case 'eliminated':
          add('capture', 0.3 * k, null, 0.8, 0.84)
          if (opts.me !== undefined && opts.me !== null && e.player === opts.me) cues.push({ at: 0.9 * k, sound: 'defeat', tile: null, volume: 1 })
          break
        case 'victory': {
          const mine = opts.me === undefined || opts.me === null || e.winner === 'draw' || e.winner === opts.me
          cues.push({ at: 0.6 * k, sound: mine ? 'victory' : 'defeat', tile: null, volume: 1 })
          break
        }
        default:
          break
      }
    }
    // A defeat already announced by 'eliminated' needs no second sting.
    const stings = cues.filter((c) => c.sound === 'victory' || c.sound === 'defeat')
    if (stings.length > 1) cues.splice(cues.indexOf(stings[1]), 1)

    plan.push({ t, start: S, cues })
    S += end
  }
  return { plan, duration: S, combat }
}
