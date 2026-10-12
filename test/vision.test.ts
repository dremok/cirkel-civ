import { describe, expect, it } from 'vitest'
import { botOrders } from '../src/engine/bot.ts'
import { createGame } from '../src/engine/game.ts'
import { distance, tilesInRange } from '../src/engine/hex.ts'
import { mirror } from '../src/engine/mapgen.ts'
import { observe, observeEvents } from '../src/engine/observe.ts'
import { findPath, pathTiming } from '../src/engine/paths.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import { exploredOf, initialFog, lineOfSight, sightFrom, visibility } from '../src/engine/vision.ts'
import type { GameState, Tile } from '../src/engine/types.ts'
import { at, city, makeMap, makeState, ofKind, order, orders, unit } from './helpers.ts'

const W = 14
const flat = makeMap(W, 8)
const F = (c: number, r: number) => at(flat, c, r)

/** A state with fog switched on, every player starting from what they see. */
function fogged(st: GameState): GameState {
  return { ...st, fog: initialFog(st) }
}

const ring = (map: typeof flat, t: number, r: number) => tilesInRange(map, t, r).filter((x) => distance(map, t, x) === r)

describe('sight', () => {
  it('units see 2 tiles, cities 3, hills add 1', () => {
    const c = F(6, 4)
    expect(sightFrom(flat, c, 2).sort()).toEqual(tilesInRange(flat, c, 2).sort())
    const st = fogged(makeState(flat, [unit(0, 'spear', c)], [city(0, F(1, 1)), city(1, F(12, 7))]))
    const seen = visibility(st, 0)
    expect(ring(flat, c, 2).every((t) => seen[t])).toBe(true)
    expect(ring(flat, c, 3).some((t) => seen[t] && distance(flat, F(1, 1), t) > 3)).toBe(false)
    expect(ring(flat, F(1, 1), 3).every((t) => seen[t])).toBe(true) // the city sees 3
    const hill = makeMap(W, 8, (t) => {
      if (t.col === 6 && t.row === 4) t.biome = 'hills'
    })
    const fromHill = fogged(makeState(hill, [unit(0, 'spear', at(hill, 6, 4))], [city(0, at(hill, 0, 0)), city(1, at(hill, 13, 7))]))
    expect(ring(hill, at(hill, 6, 4), 3).every((t) => visibility(fromHill, 0)[t])).toBe(true)
  })

  it('a ridge hides the valley behind it, but not a peak behind a forest; neighbours are always seen', () => {
    const edit = (t: Tile) => {
      if (t.row !== 2) return
      if (t.col === 4) t.height = 5 // ridge
      if (t.col === 8) t.biome = 'forest' // forest at height 2 stands 3 in the way
      if (t.col === 9) {
        t.height = 7
        t.biome = 'mountain'
      }
    }
    const map = makeMap(W, 6, edit)
    const T = (c: number, r: number) => at(map, c, r)
    expect(lineOfSight(map, T(3, 2), T(5, 2))).toBe(false) // valley behind the ridge
    expect(sightFrom(map, T(3, 2), 2)).toContain(T(4, 2)) // the ridge itself, next door
    expect(lineOfSight(map, T(7, 2), T(9, 2))).toBe(true) // the peak behind the forest
    expect(lineOfSight(map, T(7, 2), T(10, 2))).toBe(false) // the forest hides low land behind it
  })

  it('is the same from both ends and on a mirrored map', () => {
    const s = createGame({ seed: 'sight', players: [{ name: 'Anna', kind: 'bot' }, { name: 'Lars', kind: 'bot' }] })
    const { map } = s
    const M = (t: number) => mirror(t, map.width, map.height)
    for (let a = 0; a < map.tiles.length; a += 3) {
      for (const b of tilesInRange(map, a, 4)) {
        expect(lineOfSight(map, a, b)).toBe(lineOfSight(map, b, a))
        expect(lineOfSight(map, a, b)).toBe(lineOfSight(map, M(a), M(b)))
      }
    }
  })
})

describe('exploration', () => {
  it('reveals the land a unit passes, tick by tick', () => {
    const r = unit(0, 'rider', F(3, 4))
    const st = fogged(makeState(flat, [r], [city(0, F(0, 0)), city(1, F(13, 7))]))
    expect(exploredOf(st, 0)[F(7, 4)]).toBe(0)
    // Out three tiles and back one: (7, 4) is only ever seen from (5, 4), at tick 4.
    const { state, events } = resolveTurn(st, { 0: orders({ [r.id]: order([F(4, 4), F(5, 4), F(4, 4)]) }) })
    expect(exploredOf(state, 0)[F(7, 4)]).toBe(1)
    expect(visibility(state, 0)[F(7, 4)]).toBe(0)
    const mine = observeEvents(st, events, 0)
    const explore = ofKind(mine, 'explore')
    expect(explore.map((e) => e.t)).toEqual([2, 4])
    expect(explore.find((e) => e.t === 4)!.tiles).toContain(F(7, 4))
    // The stream and the state agree on what was explored.
    const before = exploredOf(st, 0)
    const after = exploredOf(state, 0)
    const fresh = explore.flatMap((e) => e.tiles).sort((a, b) => a - b)
    expect(fresh).toEqual([...after.keys()].filter((t) => after[t] && !before[t]))
  })

  it('a path into unexplored land plans as open grass; the unit halts at the real obstacle', () => {
    const lake = makeMap(W, 8, (t) => {
      if (t.col === 8 && t.row === 4) {
        t.biome = 'shallow'
        t.height = 1
      }
    })
    const L = (c: number, r: number) => at(lake, c, r)
    const s0 = unit(0, 'spear', L(3, 4))
    const st = fogged(makeState(lake, [s0], [city(0, L(0, 0)), city(1, L(13, 7))]))
    const plan = findPath(st, s0.id, L(9, 4))!
    expect(plan).toContain(L(8, 4)) // straight through the unseen lake
    expect(pathTiming(st, s0.id, plan)).toHaveLength(plan.length)
    let s = resolveTurn(st, { 0: orders({ [s0.id]: order(plan) }) }).state
    const halts: string[] = []
    for (let k = 0; k < 4; k++) {
      const r = resolveTurn(s, {})
      halts.push(...ofKind(r.events, 'halt').map((e) => e.reason))
      s = r.state
    }
    expect(halts).toContain('blocked')
    expect(s.units[0].tile).toBe(L(7, 4))
  })
})

describe('what a player sees', () => {
  it('enemy units only in sight; rival cities live in sight, else as last seen; others memories blanked', () => {
    const mine = unit(0, 'rider', F(3, 4))
    const near = unit(1, 'spear', F(5, 4))
    const far = unit(1, 'spear', F(11, 4))
    const rival = city(1, F(4, 3), { pop: 3 })
    const st = fogged(makeState(flat, [mine, near, far], [city(0, F(0, 0)), rival, city(1, F(13, 7))]))
    const view = observe(st, 0)
    expect(view.units.map((u) => u.id).sort()).toEqual([mine.id, near.id].sort())
    expect(view.cities.map((c) => c.id)).toContain(rival.id)
    expect(view.fog![1]).toEqual({ explored: '', cities: [], seen: {} })
    // The rider rides away; the city grows out of sight but is remembered as it was.
    let s = resolveTurn(st, { 0: orders({ [mine.id]: order([F(2, 5), F(2, 6), F(1, 7)]) }) }).state
    s = { ...s, cities: s.cities.map((c) => (c.id === rival.id ? { ...c, pop: 6 } : c)) }
    const later = observe(s, 0)
    expect(later.units.some((u) => u.id === near.id)).toBe(false)
    expect(later.cities.find((c) => c.id === rival.id)!.pop).toBe(3)
    expect(later.fog![0].seen[rival.id]).toBe(1)
  })

  it('without fog, events and views are as before', () => {
    const s = createGame({ seed: 'clear', players: [{ name: 'Anna', kind: 'bot' }, { name: 'Lars', kind: 'bot' }], fog: false })
    const r = resolveTurn(s, {})
    expect(observeEvents(s, r.events, 0)).toBe(r.events)
    expect(observe(s, 0).units).toHaveLength(s.units.length)
    expect(s.fog).toBeNull()
  })
})

describe('event streams', () => {
  it('spots an enemy before its first visible move and loses it when it leaves', () => {
    const me = unit(0, 'spear', F(3, 4), { stance: 'hold' })
    const them = unit(1, 'rider', F(8, 4))
    const st = fogged(makeState(flat, [me, them], [city(0, F(0, 0)), city(1, F(13, 7))]))
    // In from the east (into sight at tick 4), then on out of sight next turn.
    const r1 = resolveTurn(st, { 1: orders({ [them.id]: order([F(7, 4), F(6, 4), F(5, 4)]) }) })
    const s1 = observeEvents(st, r1.events, 0)
    const i = s1.findIndex((e) => e.kind === 'spotted')
    expect(s1[i]).toMatchObject({ kind: 'spotted', unit: { id: them.id, path: [] } })
    expect(s1[i + 1]).toMatchObject({ kind: 'move', unit: them.id })
    expect(observe(r1.state, 0).units.some((u) => u.id === them.id)).toBe(true)
    const r2 = resolveTurn(r1.state, { 1: orders({ [them.id]: order([F(6, 4), F(7, 4), F(8, 4)]) }) })
    const s2 = observeEvents(r1.state, r2.events, 0)
    expect(ofKind(s2, 'lost')).toMatchObject([{ unit: them.id }])
    expect(observe(r2.state, 0).units.some((u) => u.id === them.id)).toBe(false)
  })

  it('an archer on high ground beyond your sight that shoots you is revealed, then lost again', () => {
    // Two levels up it reaches 3 tiles, with a clear line; your spearman only sees 2.
    const map = makeMap(W, 6, (t) => {
      if (t.row === 2 && t.col === 6) t.height = 4
    })
    const T = (c: number, r: number) => at(map, c, r)
    const me = unit(0, 'spear', T(3, 2))
    const archer = unit(1, 'archer', T(6, 2), { target: T(3, 2) })
    const st = fogged(makeState(map, [me, archer], [city(0, T(0, 5)), city(1, T(13, 5))]))
    expect(observe(st, 0).units.some((u) => u.id === archer.id)).toBe(false)
    const r = resolveTurn(st, {})
    const stream = observeEvents(st, r.events, 0)
    const shot = stream.findIndex((e) => e.kind === 'shot' && 'unit' in e.from && e.from.unit === archer.id)
    expect(shot).toBeGreaterThan(0)
    expect(stream[shot - 1]).toMatchObject({ kind: 'spotted', unit: { id: archer.id } })
    expect(ofKind(stream, 'lost')).toMatchObject([{ unit: archer.id, tile: T(6, 2) }])
    expect(observeEvents(st, r.events, 1).some((e) => e.kind === 'shot')).toBe(true)
  })
})

describe('shooting in fog', () => {
  // A spearman at (3, 2) and a ridge at (4, 2): an archer at (5, 2) has range but no line of sight.
  const map = makeMap(W, 6, (t) => {
    if (t.row === 2 && t.col === 4) t.height = 5
  })
  const T = (c: number, r: number) => at(map, c, r)
  const shotsAt = (st: GameState, target: number) =>
    ofKind(resolveTurn(st, {}).events, 'shot').filter((e) => 'unit' in e.target && e.target.unit === target)

  it('needs a line of sight: not from behind the ridge, but from on top of it', () => {
    const me = unit(0, 'spear', T(3, 2), { stance: 'hold' })
    const behind = unit(1, 'archer', T(5, 2), { target: T(3, 2) })
    expect(shotsAt(fogged(makeState(map, [me, behind], [city(0, T(0, 5)), city(1, T(13, 5))])), me.id)).toEqual([])
    const onTop = unit(1, 'archer', T(4, 2), { target: T(3, 2) })
    expect(shotsAt(fogged(makeState(map, [me, onTop], [city(0, T(0, 5)), city(1, T(13, 5))])), me.id)).toHaveLength(1)
  })

  it('without fog an archer still shoots over the ridge', () => {
    const me = unit(0, 'spear', T(3, 2), { stance: 'hold' })
    const behind = unit(1, 'archer', T(5, 2), { target: T(3, 2) })
    expect(shotsAt(makeState(map, [me, behind], [city(0, T(0, 5)), city(1, T(13, 5))]), me.id)).toHaveLength(1)
  })

  it('cities need it too', () => {
    const c = city(1, T(5, 2))
    const me = unit(0, 'spear', T(3, 2), { stance: 'hold' })
    const st = makeState(map, [me], [city(0, T(0, 5)), c])
    const cityShots = (s: GameState) => ofKind(resolveTurn(s, {}).events, 'shot').filter((e) => 'city' in e.from)
    expect(cityShots(fogged(st))).toEqual([])
    expect(cityShots(st)).toHaveLength(1)
  })
})

describe('stream consistency', () => {
  it('replaying a player stream from its view lands exactly on its next view, all game long', () => {
    for (const seats of [2, 3]) {
      let s = createGame({ seed: `stream-${seats}`, players: Array.from({ length: seats }, (_, i) => ({ name: `P${i}`, kind: 'bot' as const })), maxTurns: 30 })
      while (s.winner === null) {
        const o: Record<number, ReturnType<typeof botOrders>> = {}
        for (const p of s.players) if (p.alive) o[p.id] = botOrders(observe(s, p.id), p.id, 1)
        const r = resolveTurn(s, o)
        for (const p of s.players) {
          if (!p.alive) continue
          const known = new Set(observe(s, p.id).units.filter((u) => u.owner !== p.id).map((u) => u.id))
          const explored = exploredOf(s, p.id)
          for (const e of observeEvents(s, r.events, p.id)) {
            if (e.kind === 'spotted') known.add(e.unit.id)
            else if (e.kind === 'lost' || e.kind === 'death') known.delete(e.unit)
            else if (e.kind === 'spawn' && e.unit.owner !== p.id) known.add(e.unit.id)
            else if (e.kind === 'explore') for (const t of e.tiles) explored[t] = 1
          }
          const next = observe(r.state, p.id)
          expect([...known].sort()).toEqual(next.units.filter((u) => u.owner !== p.id).map((u) => u.id).sort())
          expect([...explored]).toEqual([...exploredOf(r.state, p.id)])
        }
        s = r.state
      }
    }
  })
})
