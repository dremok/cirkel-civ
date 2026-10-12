// Replay of a resolved turn. Events are grouped by tick; everything in a tick starts together,
// with per-unit sequencing (a unit's death waits for the blow that killed it, a follow-up move
// waits for the attack before it). About 0.5 s per tick at speed 1.
import * as THREE from 'three'
import { UNIT_MAX_HP } from '../../../engine/config.ts'
import type { City, GameEvent, GameState, Target, Tick, TileId, UnitId } from '../../../engine/types.ts'
import {
  type Board, angleDelta, clamp01, colorIndexOf, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, lerp, smoothstep, teamColors,
} from './common.ts'
import { type CityLayer, interiorOf } from './cities.ts'
import type { Fx } from './fx.ts'
import type { Labels } from './labels.ts'
import { BASE_R } from './models.ts'
import type { UnitLayer, UnitVis } from './units.ts'

export interface Track {
  start: number
  dur: number
  /** Cosmetic only: dropped when skipping. */
  fx?: boolean
  begin?(): void
  update?(p: number): void
  end?(): void
  started?: boolean
  done?: boolean
}

export class Timeline {
  private tracks: Track[] = []
  t = 0
  duration = 0

  add(tr: Track): Track {
    this.tracks.push(tr)
    this.duration = Math.max(this.duration, tr.start + tr.dur)
    return tr
  }

  sort() {
    // stable: keep insertion order for equal starts
    this.tracks = this.tracks.map((t, i) => ({ t, i })).sort((a, b) => a.t.start - b.t.start || a.i - b.i).map((x) => x.t)
  }

  step(dt: number): boolean {
    this.t += dt
    for (const tr of this.tracks) {
      if (tr.done) continue
      if (this.t < tr.start) break
      this.run(tr, false)
    }
    return this.t >= this.duration
  }

  private run(tr: Track, skip: boolean) {
    if (!tr.started) {
      tr.started = true
      if (!(skip && tr.fx)) tr.begin?.()
    }
    const p = skip ? 1 : tr.dur > 0 ? clamp01((this.t - tr.start) / tr.dur) : 1
    if (!(skip && tr.fx)) tr.update?.(p)
    if (p >= 1) {
      tr.done = true
      if (!(skip && tr.fx)) tr.end?.()
    }
  }

  /** Apply every remaining track's end state, skipping cosmetics. */
  finish() {
    for (const tr of this.tracks) if (!tr.done) this.run(tr, true)
    this.t = this.duration
  }
}

export interface ReplayDeps {
  board: Board
  units: UnitLayer
  cities: CityLayer
  fx: Fx
  labels: Labels
  /** Territory refresh from the cities as currently displayed. */
  territory(animate: boolean): void
}

const IMPACT = new THREE.Color('#FFF6E4')

export function buildReplay(d: ReplayDeps, prev: GameState, events: GameEvent[], next: GameState, secPerTick: number, onTick?: (t: Tick) => void): Timeline {
  const tl = new Timeline()
  const k = secPerTick / 0.5 // all timings below are authored for 0.5 s per tick
  const { board, units, cities, fx, labels } = d

  const byTick = new Map<number, GameEvent[]>()
  for (const e of events) {
    if (!byTick.has(e.t)) byTick.set(e.t, [])
    byTick.get(e.t)!.push(e)
  }
  const lastMoveTick = Math.max(0, ...events.filter((e) => e.t <= 6).map((e) => e.t))
  const ticks: number[] = []
  for (let t = 1; t <= lastMoveTick; t++) ticks.push(t)
  for (const t of [7, 8]) if (byTick.get(t)?.length) ticks.push(t)

  // Logical positions while building (the visuals read real positions when tracks begin).
  const tileOf = new Map<UnitId, TileId>()
  for (const u of prev.units) tileOf.set(u.id, u.tile)
  for (const e of events) if (e.kind === 'spawn') tileOf.set(e.unit.id, e.unit.tile)
  const free = new Map<UnitId, number>()
  const deathAt = new Map<TileId, number>()
  const lastHitFrom = new Map<UnitId, TileId>()
  const hpOf = new Map<UnitId, number>()
  for (const u of prev.units) hpOf.set(u.id, u.hp)
  const cityTile = new Map<number, TileId>()
  for (const c of prev.cities) cityTile.set(c.id, c.tile)
  for (const e of events) if (e.kind === 'found') cityTile.set(e.city.id, e.city.tile)
  const colorOf = (owner: number) => colorIndexOf(next, owner)
  // the cities as they are shown while the replay runs (grow and build events patch these)
  const shownCity = new Map<number, City>()
  for (const c of prev.cities) shownCity.set(c.id, structuredClone(c))
  const nextCity = (id: number) => next.cities.find((c) => c.id === id)

  const at = (id: UnitId) => free.get(id) ?? 0
  const busy = (id: UnitId, t: number) => free.set(id, Math.max(at(id), t))
  const targetTile = (t: Target): TileId | null => ('unit' in t ? tileOf.get(t.unit) ?? null : cityTile.get(t.city) ?? null)
  const headOf = (vis: UnitVis | undefined, out = new THREE.Vector3()) => vis ? out.copy(vis.pos).setY(vis.pos.y + (vis.type === 'rider' ? 0.95 : 0.8)) : out
  const cityHead = (id: number, out = new THREE.Vector3()) => {
    const tile = cityTile.get(id)
    if (tile === undefined) return out
    const t = board.tops[tile]
    return out.set(t.x, t.y + 0.9, t.z)
  }

  const damage = (target: Target, dmg: number, when: () => void = () => {}) => {
    // returns a function to run at impact
    return () => {
      when()
      if (dmg <= 0) return
      if ('unit' in target) {
        const vis = units.get(target.unit)
        if (vis) {
          vis.hp = Math.max(0, vis.hp - dmg)
          labels.float(`−${dmg}`, 'dmg', headOf(vis), { key: target.unit })
        }
      } else {
        const c = cities.cities.get(target.city)
        if (c) {
          cities.setHp(target.city, Math.max(0, c.hp - dmg))
          labels.float(`−${dmg}`, 'dmg', cityHead(target.city), { key: -1 - target.city })
        }
      }
    }
  }

  // A lunge towards a point and back; `impact` fires at the moment of contact.
  const lunge = (id: UnitId, start: number, toward: () => THREE.Vector3, reach: (dist: number) => number, impact: () => void) => {
    const tLunge = 0.16 * k
    const tHold = 0.06 * k
    const tBack = 0.26 * k
    let home = new THREE.Vector3()
    let dir = new THREE.Vector3()
    let dist = 0
    let yaw0 = 0
    let yaw1 = 0
    let climb = 0
    tl.add({
      start, dur: tLunge + tHold + tBack,
      begin() {
        const vis = units.get(id)
        if (!vis) return
        home = vis.pos.clone()
        const tgt = toward()
        dir = new THREE.Vector3(tgt.x - home.x, 0, tgt.z - home.z)
        const l = dir.length() || 1
        dir.divideScalar(l)
        dist = Math.max(0.05, reach(l))
        yaw0 = vis.yaw
        yaw1 = Math.atan2(dir.x, dir.z)
        // climb onto higher ground if the lunge reaches over a step
        let g = -Infinity
        for (const f of [0.6, 1]) for (const r of [0, 0.9]) {
          g = Math.max(g, units.groundAt(home.x + dir.x * (dist * f + BASE_R * r), home.z + dir.z * (dist * f + BASE_R * r)))
        }
        climb = Math.max(0, g - home.y)
      },
      update(p) {
        const vis = units.get(id)
        if (!vis) return
        const T = (tLunge + tHold + tBack) * p
        let f: number
        if (T < tLunge) f = easeInCubic(T / tLunge) * 1.0
        else if (T < tLunge + tHold) f = 1
        else f = 1 - easeInOutCubic((T - tLunge - tHold) / tBack)
        // a slight wind-up: lean back first
        const wind = T < tLunge ? Math.sin((T / tLunge) * Math.PI) * -0.05 : 0
        vis.pos.copy(home).addScaledVector(dir, dist * f + wind)
        vis.pos.y = home.y + Math.sin(Math.min(1, f) * Math.PI * 0.5) * 0.05 + climb * Math.min(1, f * 1.5)
        vis.ground = home.y + climb * Math.min(1, f * 1.5)
        vis.yaw = yaw0 + angleDelta(yaw0, yaw1) * easeOutCubic(Math.min(1, T / (tLunge * 0.7)))
        vis.tilt = 0.2 * f
        vis.tdx = dir.x
        vis.tdz = dir.z
        if (p >= 1) { vis.tilt = 0; vis.pos.copy(home) }
        vis.dirty = true
      },
    })
    tl.add({ start: start + tLunge, dur: 0, begin: impact })
    return { impactAt: start + tLunge, end: start + tLunge + tHold + tBack }
  }

  // A small recoil of the one being hit.
  const recoil = (id: UnitId, start: number, from: () => THREE.Vector3) => {
    let home = new THREE.Vector3()
    let dir = new THREE.Vector3()
    tl.add({
      start, dur: 0.32 * k, fx: true,
      begin() {
        const vis = units.get(id)
        if (!vis) return
        home = vis.pos.clone()
        const f = from()
        dir.set(home.x - f.x, 0, home.z - f.z).normalize()
      },
      update(p) {
        const vis = units.get(id)
        if (!vis || vis.hp <= 0) return
        const s = Math.sin(p * Math.PI) * (1 - p * 0.3)
        vis.pos.copy(home).addScaledVector(dir, 0.07 * s)
        vis.tilt = 0.16 * s
        vis.tdx = dir.x
        vis.tdz = dir.z
        if (p >= 1) { vis.tilt = 0; vis.pos.copy(home) }
        vis.dirty = true
      },
    })
  }

  let S = 0.12 * k
  for (const tick of ticks) {
    const list = byTick.get(tick) ?? []
    const tickStart = S
    let blockEnd = S + (tick <= 6 ? 0.5 * k : 0.25 * k)
    tl.add({ start: tickStart, dur: 0, begin: () => onTick?.(tick) })

    for (const e of list) {
      switch (e.kind) {
        case 'move': {
          const start = Math.max(S, at(e.unit), (deathAt.get(e.to) ?? -1) + 0.56 * k)
          const dur = 0.42 * k
          const from = e.from
          const to = e.to
          tileOf.set(e.unit, to)
          let p0 = new THREE.Vector3()
          const p1 = new THREE.Vector3()
          let yaw0 = 0
          let yaw1 = 0
          tl.add({
            start, dur,
            begin() {
              const vis = units.get(e.unit)
              if (!vis) return
              p0 = units.standAt(from, new THREE.Vector3())
              if (vis.tile === from) p0.copy(vis.pos)
              units.standAt(to, p1)
              yaw0 = vis.yaw
              yaw1 = Math.atan2(p1.x - p0.x, p1.z - p0.z)
            },
            update(p) {
              const vis = units.get(e.unit)
              if (!vis) return
              const s = easeInOutCubic(p)
              const dy = p1.y - p0.y
              const hop = 0.1 + Math.abs(dy) * 0.55
              vis.pos.set(lerp(p0.x, p1.x, s), lerp(p0.y, p1.y, smoothstep(0.1, 0.7, p)) + hop * Math.sin(Math.PI * p), lerp(p0.z, p1.z, s))
              vis.ground = lerp(p0.y, p1.y, s < 0.5 ? 0 : 1)
              vis.yaw = yaw0 + angleDelta(yaw0, yaw1) * easeOutCubic(Math.min(1, p / 0.3))
              // lean into the step
              vis.tilt = 0.09 * Math.sin(Math.PI * p)
              vis.tdx = p1.x - p0.x
              vis.tdz = p1.z - p0.z
              const l = Math.hypot(vis.tdx, vis.tdz) || 1
              vis.tdx /= l
              vis.tdz /= l
              if (p >= 1) {
                vis.tilt = 0
                vis.tile = to
                vis.pos.copy(p1)
                vis.ground = p1.y
              }
              vis.dirty = true
            },
          })
          tl.add({ start: start + dur * 0.97, dur: 0, fx: true, begin: () => fx.dust(p1, 4, 0.14) })
          busy(e.unit, start + dur)
          blockEnd = Math.max(blockEnd, start + dur)
          break
        }
        case 'clash': {
          const start = Math.max(S, at(e.a), at(e.b))
          const ta = tileOf.get(e.a)
          const tb = tileOf.get(e.b)
          if (ta === undefined || tb === undefined) break
          const meet = () => {
            if (e.tile !== null) return board.tops[e.tile].clone()
            return board.tops[ta].clone().add(board.tops[tb]).multiplyScalar(0.5)
          }
          const reach = (l: number) => (e.tile !== null ? l * 0.55 : l - BASE_R - 0.03)
          const contact = new THREE.Vector3()
          const hit = () => {
            const va = units.get(e.a)
            const vb = units.get(e.b)
            if (va && vb) contact.copy(va.pos).add(vb.pos).multiplyScalar(0.5)
            else contact.copy(meet())
            const c = contact.clone().setY(contact.y + 0.32)
            fx.spark(c, 0.85)
            fx.dust(contact, 10, 0.26)
            fx.ring(contact, IMPACT, 0.15, 1.0, 0.4, 0.75)
          }
          const ra = lunge(e.a, start, meet, reach, () => {
            hit()
            damage({ unit: e.a }, e.dmgA)()
            damage({ unit: e.b }, e.dmgB)()
          })
          lunge(e.b, start, meet, reach, () => {})
          lastHitFrom.set(e.a, tb)
          lastHitFrom.set(e.b, ta)
          hpOf.set(e.a, (hpOf.get(e.a) ?? UNIT_MAX_HP) - e.dmgA)
          hpOf.set(e.b, (hpOf.get(e.b) ?? UNIT_MAX_HP) - e.dmgB)
          busy(e.a, ra.end)
          busy(e.b, ra.end)
          blockEnd = Math.max(blockEnd, ra.end)
          break
        }
        case 'melee': {
          const tt = targetTile(e.target)
          const ta = tileOf.get(e.attacker)
          if (tt === null || ta === undefined) break
          const targetUnit = 'unit' in e.target ? e.target.unit : null
          const start = Math.max(S, at(e.attacker), targetUnit !== null ? at(targetUnit) : 0)
          const toward = () => {
            if (targetUnit !== null) {
              const v = units.get(targetUnit)
              if (v) return v.pos.clone()
            }
            return board.tops[tt].clone()
          }
          const reach = (l: number) => (targetUnit !== null ? l - BASE_R * 2 - 0.01 : l - 0.82 * board.R - BASE_R + 0.06)
          const target = e.target
          const r = lunge(e.attacker, start, toward, reach, () => {
            const va = units.get(e.attacker)
            const tgt = toward()
            const c = va ? va.pos.clone().lerp(tgt, targetUnit !== null ? 0.5 : 0.75) : tgt
            fx.spark(c.clone().setY(c.y + 0.3), 0.75)
            fx.dust(c, 8, 0.22)
            fx.ring(c, IMPACT, 0.15, 0.9, 0.38, 0.7)
            damage(target, e.dmgToTarget)()
            damage({ unit: e.attacker }, e.dmgToAttacker)()
          })
          if (targetUnit !== null) {
            recoil(targetUnit, r.impactAt, () => units.get(e.attacker)?.pos ?? board.tops[ta])
            lastHitFrom.set(targetUnit, ta)
            busy(targetUnit, r.impactAt + 0.05 * k)
            hpOf.set(targetUnit, (hpOf.get(targetUnit) ?? UNIT_MAX_HP) - e.dmgToTarget)
          }
          lastHitFrom.set(e.attacker, tt)
          busy(e.attacker, r.end)
          blockEnd = Math.max(blockEnd, r.end)
          break
        }
        case 'shot': {
          const shooterUnit = 'unit' in e.from ? e.from.unit : null
          const shooterCity = 'city' in e.from ? e.from.city : null
          const tt = targetTile(e.target)
          if (tt === null) break
          const start = Math.max(S, shooterUnit !== null ? at(shooterUnit) : S)
          const src = () => {
            if (shooterUnit !== null) {
              const v = units.get(shooterUnit)
              if (v) return v.pos.clone().setY(v.pos.y + 0.45)
            }
            if (shooterCity !== null) return cities.topOf(shooterCity)
            return board.tops[tt].clone()
          }
          const dst = () => {
            if ('unit' in e.target) {
              const v = units.get(e.target.unit)
              if (v) return v.pos.clone().setY(v.pos.y + 0.32)
            }
            const t = board.tops[tt]
            return t.clone().setY(t.y + 0.25)
          }
          const draw = 0.12 * k
          const srcTile = shooterUnit !== null ? tileOf.get(shooterUnit) : shooterCity !== null ? cityTile.get(shooterCity) : undefined
          const dist = srcTile !== undefined ? board.tops[srcTile].distanceTo(board.tops[tt]) : 2
          const flight = (0.3 + dist * 0.045) * k
          if (shooterUnit !== null) {
            // archer turns to the target and draws
            let yaw0 = 0
            let yaw1 = 0
            tl.add({
              start, dur: draw + 0.12 * k,
              begin() {
                const v = units.get(shooterUnit)
                if (!v) return
                const t = dst()
                yaw0 = v.yaw
                yaw1 = Math.atan2(t.x - v.pos.x, t.z - v.pos.z)
              },
              update(p) {
                const v = units.get(shooterUnit)
                if (!v) return
                v.yaw = yaw0 + angleDelta(yaw0, yaw1) * easeOutCubic(Math.min(1, p * 1.6))
                const back = Math.sin(p * Math.PI) * 0.1
                v.tilt = back
                v.tdx = -Math.sin(v.yaw)
                v.tdz = -Math.cos(v.yaw)
                if (p >= 1) v.tilt = 0
                v.dirty = true
              },
            })
          }
          const volley = shooterCity !== null ? 3 : 1
          const target = e.target
          const impactAt = start + draw + flight
          for (let i = 0; i < volley; i++) {
            const delay = i * 0.07 * k
            tl.add({
              start: start + draw + delay, dur: 0, fx: i > 0,
              begin() {
                const from = src()
                const to = dst()
                if (i > 0) to.add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3))
                fx.arrow(from, to, flight, i === 0 ? () => {} : () => fx.dust(to, 2, 0.1))
              },
            })
          }
          tl.add({
            start: impactAt, dur: 0,
            begin() {
              const p = dst()
              fx.spark(p, 0.4)
              damage(target, e.dmg)()
            },
          })
          if ('unit' in e.target) {
            const tu = e.target.unit
            recoil(tu, impactAt, () => src())
            busy(tu, impactAt + 0.05 * k)
            if (srcTile !== undefined) lastHitFrom.set(tu, srcTile)
            hpOf.set(tu, (hpOf.get(tu) ?? UNIT_MAX_HP) - e.dmg)
          }
          if (shooterUnit !== null) busy(shooterUnit, start + draw + 0.12 * k)
          blockEnd = Math.max(blockEnd, impactAt)
          break
        }
        case 'halt': {
          const start = Math.max(S, at(e.unit))
          tl.add({
            start, dur: 0.9 * k, fx: true,
            begin() {
              const v = units.get(e.unit)
              if (v) { v.glyphOverride = 3; v.glyphPulse = 0 }
            },
            end() {
              const v = units.get(e.unit)
              if (v) v.glyphOverride = null
            },
          })
          break
        }
        case 'death': {
          const start = Math.max(S, at(e.unit)) + 0.04 * k
          const tip = 0.3 * k
          const pause = 0.08 * k
          const sink = 0.4 * k
          deathAt.set(e.tile, start)
          const fromTile = lastHitFrom.get(e.unit)
          let dir = new THREE.Vector3(1, 0, 0)
          let home = new THREE.Vector3()
          tl.add({
            start, dur: tip + pause + sink,
            begin() {
              const v = units.get(e.unit)
              if (!v) return
              home = v.pos.clone()
              home.y = v.ground
              if (fromTile !== undefined) {
                const f = board.tops[fromTile]
                dir.set(home.x - f.x, 0, home.z - f.z)
                if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
                dir.normalize()
              }
              v.hp = 0
            },
            update(p) {
              const v = units.get(e.unit)
              if (!v) return
              const T = p * (tip + pause + sink)
              const f = easeInCubic(Math.min(1, T / tip))
              // topple, with a little bounce as it lands
              const land = T > tip ? Math.sin(Math.min(1, (T - tip) / (pause * 1.5)) * Math.PI) * 0.06 : 0
              v.tilt = f * 1.3 - land
              v.tdx = dir.x
              v.tdz = dir.z
              v.deco01 = 1 - Math.min(1, T / (tip * 0.6))
              const s = clamp01((T - tip - pause) / sink)
              const e2 = easeInCubic(s)
              v.pos.copy(home).addScaledVector(dir, -0.12 * e2)
              v.pos.y = home.y - e2 * 0.5
              v.scale = 1 - 0.35 * e2
              v.dirty = true
            },
            end() {
              units.remove(e.unit)
            },
          })
          tl.add({ start: start + tip, dur: 0, fx: true, begin: () => fx.dust(home.clone().addScaledVector(dir, 0.35), 8, 0.24) })
          free.set(e.unit, Infinity)
          tileOf.delete(e.unit)
          break
        }
        case 'capture': {
          const start = Math.max(S, at(e.unit))
          const tile = cityTile.get(e.city)
          tl.add({
            start, dur: 0,
            begin() {
              cities.setOwner(e.city, e.to, colorOf(e.to), true)
              if (tile !== undefined) {
                const c = teamColors(colorOf(e.to))
                fx.ring(board.tops[tile], c.base, 0.5, 2.2, 1.0, 0.95)
                fx.ring(board.tops[tile], c.light, 0.3, 1.4, 0.8, 0.7)
              }
              d.territory(true)
            },
          })
          blockEnd = Math.max(blockEnd, start + 0.45 * k)
          break
        }
        case 'found': {
          const start = Math.max(S, at(e.unit))
          const city = e.city
          shownCity.set(city.id, structuredClone(city))
          const ci = colorOf(city.owner)
          tl.add({
            start, dur: 0.32 * k,
            begin() {
              const v = units.get(e.unit)
              if (v) fx.dust(v.pos, 8, 0.24)
            },
            update(p) {
              const v = units.get(e.unit)
              if (!v) return
              v.scale = 1 - easeInCubic(p)
              v.pos.y = v.ground + Math.sin(p * Math.PI) * 0.08
              v.dirty = true
            },
            end() {
              units.remove(e.unit)
            },
          })
          tl.add({
            start: start + 0.2 * k, dur: 0,
            begin() {
              cities.found(prev.map, city, ci)
              const c = teamColors(ci)
              fx.ring(board.tops[city.tile], c.base, 0.4, 2.0, 1.1, 0.9)
              d.territory(true)
            },
          })
          free.set(e.unit, Infinity)
          blockEnd = Math.max(blockEnd, start + 1.3 * k)
          break
        }
        case 'foundFailed': {
          const start = Math.max(S, at(e.unit))
          tl.add({
            start, dur: 0, fx: true,
            begin() {
              const v = units.get(e.unit)
              if (v) labels.float('Cannot settle here', 'note', headOf(v), { life: 1.6 })
            },
          })
          break
        }
        case 'spawn': {
          const u = e.unit
          const start = S + 0.05 * k
          tl.add({
            start, dur: 0.5 * k,
            begin() {
              units.remove(u.id)
              const v = units.create(u, colorOf(u.owner))
              v.scale = 0.001
              v.dirty = true
              const c = teamColors(v.colorIdx)
              fx.ring(v.pos, c.base, 0.3, 1.3, 0.75, 0.9)
              fx.dust(v.pos, 5, 0.16)
            },
            update(p) {
              const v = units.get(u.id)
              if (!v) return
              v.scale = Math.max(0.001, easeOutBack(p, 1.1))
              if (p >= 1) v.scale = 1
              v.dirty = true
            },
          })
          free.set(u.id, start + 0.5 * k)
          blockEnd = Math.max(blockEnd, start + 0.5 * k)
          break
        }
        case 'built': {
          // units are shown by their spawn; a new building in the interior shows up on the map
          const c = shownCity.get(e.city)
          if (!c || typeof e.item !== 'object') break
          const order = e.item
          const n = nextCity(e.city)
          const base = interiorOf(c) ?? (n ? interiorOf(n) : null)
          if (!base) break
          const interior = structuredClone(base)
          interior.plots[order.plot] = order.building
          c.interior = interior
          if (order.building === 'wall') c.walls = true
          const snap = structuredClone(c)
          tl.add({ start: S, dur: 0, begin: () => cities.replan(prev.map, snap, true) })
          blockEnd = Math.max(blockEnd, S + 0.8 * k)
          break
        }
        case 'grow': {
          const c = shownCity.get(e.city)
          if (!c) break
          c.pop = e.pop
          const snap = structuredClone(c)
          tl.add({
            start: S + 0.1 * k, dur: 0,
            begin() {
              cities.setPop(prev.map, snap, true)
            },
          })
          blockEnd = Math.max(blockEnd, S + 0.9 * k)
          break
        }
        case 'cityRepair': {
          const c = shownCity.get(e.city)
          if (c) c.hp = e.hp
          tl.add({
            start: S + 0.05 * k, dur: 0,
            begin() {
              const gain = e.hp - (cities.cities.get(e.city)?.hp ?? e.hp)
              cities.setHp(e.city, e.hp)
              if (gain > 0) labels.float(`+${gain}`, 'heal', cityHead(e.city), { key: -1 - e.city })
            },
          })
          break
        }
        case 'buildFailed': {
          tl.add({ start: S, dur: 0, fx: true, begin: () => labels.float('Could not build', 'note', cityHead(e.city), { life: 1.6, key: -1 - e.city }) })
          break
        }
        case 'heal': {
          tl.add({
            start: S, dur: 0,
            begin() {
              const v = units.get(e.unit)
              if (v) v.hp = e.hp
            },
          })
          break
        }
        default:
          break
      }
    }
    S = Math.max(tickStart + (tick <= 6 ? 0.5 * k : 0.3 * k), blockEnd)
  }
  // linger so the last numbers can be read
  tl.add({ start: S, dur: 0.35 * k, fx: true })
  tl.sort()
  return tl
}
