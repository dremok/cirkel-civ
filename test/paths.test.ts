import { describe, expect, it } from 'vitest'
import { createGame } from '../src/engine/game.ts'
import { findPath, pathTiming, reachableThisTurn } from '../src/engine/paths.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import { isPassable } from '../src/engine/terrain.ts'
import type { GameState, Unit } from '../src/engine/types.ts'
import { at, makeMap, makeState, unit } from './helpers.ts'

const players = [{ name: 'A', kind: 'bot' as const }, { name: 'B', kind: 'bot' as const }]

/** Only `u` on the board, and enemy cities at 0 hp (they do not shoot): nothing gets in the way. */
function alone(s: GameState, u: Unit): GameState {
  return { ...s, units: [{ ...u, path: [] }], cities: s.cities.map((c) => (c.owner === u.owner ? c : { ...c, hp: 0 })) }
}

describe('pathTiming', () => {
  it('agrees with resolveTurn when nothing is in the way', () => {
    let checked = 0
    for (const seed of ['p1', 'p2', 'p3']) {
      const game = createGame({ seed, players, fog: false })
      for (const u0 of game.units) {
        const cityTiles = new Set(game.cities.map((c) => c.tile))
        const land = game.map.tiles.filter((t) => isPassable(game.map, t.id) && t.id !== u0.tile && !cityTiles.has(t.id))
        for (let k = 0; k < land.length; k += 23) {
          const s0 = alone(game, u0)
          const path = findPath(s0, u0.id, land[k].id)
          if (!path || path.length === 0) continue
          const expected = pathTiming(s0, u0.id, path)
          expect(expected).toHaveLength(path.length)
          const seen: { turn: number; tick: number; to: number }[] = []
          let s = s0
          for (let turn = 0; seen.length < path.length && turn < 40; turn++) {
            const r = resolveTurn(s, turn === 0 ? { [u0.owner]: { units: { [u0.id]: { path, stance: 'cautious' } }, cities: {} } } : {})
            for (const e of r.events) if (e.kind === 'move') seen.push({ turn, tick: e.t, to: e.to })
            // Cities regenerate: keep enemy ones silent.
            s = { ...r.state, cities: r.state.cities.map((c) => (c.owner === u0.owner ? c : { ...c, hp: 0 })) }
          }
          expect(seen.map((m) => m.to)).toEqual(path)
          expect(seen.map(({ turn, tick }) => ({ turn, tick }))).toEqual(expected)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('minimises arrival time, not total cost (points reset each turn)', () => {
    // Spear (6 points per 3 ticks): flat then hills wastes the end of turn 1; hills first does not.
    const map = makeMap(6, 3, (t) => {
      if (t.row === 0 && t.col === 2) t.biome = 'hills'
      if (t.row === 2 && t.col === 1) t.biome = 'hills'
    })
    const s = unit(0, 'spear', at(map, 1, 1))
    const st = makeState(map, [s])
    const viaTop = [at(map, 1, 0), at(map, 2, 0)] // (1,1) odd row: neighbours (1,0) and (2,0)
    const t1 = pathTiming(st, s.id, viaTop)
    expect(t1).toEqual([{ turn: 0, tick: 3 }, { turn: 1, tick: 6 }])
    const reversed = pathTiming(st, s.id, [at(map, 2, 0)])
    expect(reversed).toEqual([{ turn: 0, tick: 6 }])
  })
})

describe('findPath', () => {
  const map = makeMap(10, 4, (t) => {
    if (t.col === 4 && t.row <= 2) {
      t.biome = 'mountain'
      t.height = 7
    }
  })

  it('goes around impassable tiles and may end on an enemy (attack)', () => {
    const s = unit(0, 'spear', at(map, 2, 1))
    const e = unit(1, 'spear', at(map, 6, 1))
    const st = makeState(map, [s, e])
    const p = findPath(st, s.id, e.tile)!
    expect(p.at(-1)).toBe(e.tile)
    expect(p.some((t) => map.tiles[t].biome === 'mountain')).toBe(false)
    expect(findPath(st, s.id, at(map, 4, 0))).toBeNull()
  })

  it('settlers cannot path onto enemies or through enemy cities', () => {
    const s = unit(0, 'settler', at(map, 2, 3))
    const e = unit(1, 'spear', at(map, 6, 3))
    const st = makeState(map, [s, e])
    expect(findPath(st, s.id, e.tile)).toBeNull()
  })

  it('reachableThisTurn is exactly the tiles a fastest path enters in turn 0', () => {
    const game = createGame({ seed: 'reach', players, fog: false })
    for (const u of game.units) {
      const reach = new Set(reachableThisTurn(game, u.id))
      for (const t of game.map.tiles) {
        if (t.id === u.tile) continue
        const p = findPath(game, u.id, t.id)
        const thisTurn = !!p && pathTiming(game, u.id, p).at(-1)?.turn === 0
        expect(reach.has(t.id)).toBe(thisTurn)
      }
    }
  })
})
