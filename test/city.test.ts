import { describe, expect, it } from 'vitest'
import { BUILDINGS, PLOTS, cityOutput, newInterior } from '../src/engine/city.ts'
import { buildCost, growthNeed, growthThreshold, outputOf } from '../src/engine/economy.ts'
import { capitalInterior, createGame, rotateInterior } from '../src/engine/game.ts'
import { scores } from '../src/engine/observe.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import type { BuildingType, CityInterior, GameState, PlayerOrders } from '../src/engine/types.ts'
import { at, city, makeMap, makeState, ofKind, order, orders, unit } from './helpers.ts'

// A grass map with forest east of the city at (5, 2) and the sea to its west.
const map = makeMap(12, 6, (t) => {
  if (t.row === 2 && t.col === 6) t.biome = 'forest'
  if (t.row === 2 && t.col === 4) {
    t.biome = 'shallow'
    t.height = 1
  }
})
const T = (c: number, r: number) => at(map, c, r)
const C = T(5, 2)
// Plot numbers: 1 + d inner, 7 + 2d corner (faces d), 8 + 2d side (faces d and d + 1); d = 0 is east.
const EAST_CORNER = 7
const WEST_CORNER = 13

function interior(plots: Record<number, BuildingType>, focus: CityInterior['focus'] = 'balance'): CityInterior {
  const i = newInterior()
  for (const [p, b] of Object.entries(plots)) i.plots[Number(p)] = b
  i.focus = focus
  return i
}

function withCity(extra: Parameters<typeof city>[2], units = [] as ReturnType<typeof unit>[]): { st: GameState; id: number } {
  const c = city(0, C, extra)
  return { st: makeState(map, units, [c, city(1, T(11, 5))]), id: c.id }
}

const cityOf = (s: GameState, id: number) => s.cities.find((c) => c.id === id)!

describe('building orders', () => {
  it('accepts a building on a plot that fits, ignores one that does not, and accepts focus', () => {
    const { st, id } = withCity({ build: 'spear' })
    const good: PlayerOrders = { units: {}, cities: { [id]: { building: 'sawmill', plot: EAST_CORNER } }, focus: { [id]: 'production' } }
    const s1 = resolveTurn(st, { 0: good }).state
    expect(cityOf(s1, id).build).toEqual({ building: 'sawmill', plot: EAST_CORNER })
    expect(cityOf(s1, id).interior.focus).toBe('production')
    // A farm cannot face the sea, a workshop is inner only, the square takes nothing.
    for (const bad of [{ building: 'farm', plot: WEST_CORNER }, { building: 'workshop', plot: EAST_CORNER }, { building: 'house', plot: 0 }, { building: 'castle', plot: 2 }]) {
      const s2 = resolveTurn(st, { 0: { units: {}, cities: { [id]: bad } } as unknown as PlayerOrders }).state
      expect(cityOf(s2, id).build).toBe('spear')
    }
  })

  it('completes a building with production, places it, keeps the rest, and reports it', () => {
    const { st, id } = withCity({ prod: 19, build: { building: 'sawmill', plot: EAST_CORNER } })
    const { state, events } = resolveTurn(st, {})
    const c = cityOf(state, id)
    expect(c.interior.plots[EAST_CORNER]).toBe('sawmill')
    expect(c.build).toBeNull()
    // The square makes 4 production; the sawmill (20) completes and 3 carry over.
    expect(c.prod).toBe(19 + 4 - BUILDINGS.sawmill.cost)
    expect(ofKind(events, 'built')).toEqual([{ t: 8, kind: 'built', city: id, item: { building: 'sawmill', plot: EAST_CORNER } }])
  })

  it('fails a building whose plot no longer fits, keeping the production', () => {
    const { st, id } = withCity({ prod: 30, build: { building: 'farm', plot: 2 }, interior: interior({ 2: 'house' }) })
    const { state, events } = resolveTurn(st, {})
    expect(ofKind(events, 'buildFailed')).toMatchObject([{ t: 8, city: id, item: { building: 'farm', plot: 2 } }])
    expect(cityOf(state, id).prod).toBe(34)
    expect(cityOf(state, id).interior.plots[2]).toBe('house')
  })

  it('a unit build also reports built, then spawns; barracks make units 25 % cheaper', () => {
    const { st, id } = withCity({ prod: 11, build: 'spear', interior: interior({ 1: 'barracks' }) })
    expect(buildCost(cityOf(st, id), 'spear')).toBe(15)
    expect(buildCost(cityOf(st, id), 'rider')).toBe(23)
    const { events } = resolveTurn(st, {})
    expect(events.filter((e) => e.kind === 'built' || e.kind === 'spawn').map((e) => e.kind)).toEqual(['built', 'spawn'])
  })

  it('keeps the deprecated walls flag in sync', () => {
    const { st, id } = withCity({ prod: 20, build: { building: 'wall', plot: EAST_CORNER } })
    expect(cityOf(resolveTurn(st, {}).state, id).walls).toBe(true)
  })
})

describe('citizens and growth', () => {
  it('staffs by focus when there are more jobs than citizens', () => {
    const plots = { [EAST_CORNER]: 'sawmill', 9: 'farm' } as Record<number, BuildingType>
    // The east corner faces the forest (sawmill 3); corner 9 faces the grass to the north-east (farm 3).
    const prod = cityOutput(map, C, interior(plots, 'production'), 1)
    const grow = cityOutput(map, C, interior(plots, 'growth'), 1)
    expect(prod.staffed[EAST_CORNER]).toBe(true)
    expect(grow.staffed[9]).toBe(true)
    expect(prod.prod).toBeGreaterThan(grow.prod)
    expect(grow.food).toBeGreaterThan(prod.food)
  })

  it('does not grow past its housing, and stores at most one citizen of food', () => {
    const { st, id } = withCity({ pop: 2, food: 100 }) // housing 2: no house yet
    const s1 = resolveTurn(st, {}).state
    const c = cityOf(s1, id)
    expect(c.pop).toBe(2)
    expect(c.food).toBe(growthNeed(c, outputOf(map, c)))
    // With a house there is room for two more.
    const roomy = withCity({ pop: 2, food: 100, interior: interior({ 1: 'house' }) })
    expect(cityOf(resolveTurn(roomy.st, {}).state, roomy.id).pop).toBe(3)
  })

  it('a staffed temple makes growth 25 % cheaper', () => {
    const c = city(0, C, { pop: 2, interior: interior({ 1: 'temple', 2: 'house' }) })
    expect(growthNeed(c, outputOf(map, c))).toBe(Math.round(growthThreshold(2) * 0.75))
    const idle = city(0, C, { pop: 0, interior: interior({ 1: 'temple' }) })
    expect(growthNeed(idle, outputOf(map, idle))).toBe(growthThreshold(0))
  })
})

describe('walls and towers', () => {
  it('walls only help against attacks from the side they face', () => {
    const fromEast = withCity({ interior: interior({ [EAST_CORNER]: 'wall' }) }, [unit(1, 'rider', T(6, 2))])
    const fromWest = withCity({ interior: interior({ [WEST_CORNER]: 'wall' }) }, [unit(1, 'rider', T(6, 2))])
    const go = (s: GameState) => {
      const r = s.units[0]
      return ofKind(resolveTurn(s, { 1: orders({ [r.id]: order([C]) }) }).events, 'melee')[0]
    }
    // City defence 4, x1.5 behind a wall: the rider (5) deals round(2.5) = 3 instead of round(3.75) = 4.
    expect(go(fromEast.st)).toMatchObject({ dmgToTarget: 3, dmgToAttacker: 4 })
    expect(go(fromWest.st)).toMatchObject({ dmgToTarget: 4, dmgToAttacker: 2 })
  })

  it('towers add range and strength on their side only', () => {
    const tower = interior({ [EAST_CORNER]: 'tower' })
    const east = withCity({ interior: tower }, [unit(1, 'archer', T(8, 2), { stance: 'hold' })])
    const west = withCity({ interior: tower }, [unit(1, 'archer', T(2, 2), { stance: 'hold' })])
    // Strength 2 + 1 tower against an archer on hold (2 x 1.5): round(3 x 3 / 3) = 3.
    expect(ofKind(resolveTurn(east.st, {}).events, 'shot')).toContainEqual(expect.objectContaining({ t: 7, from: { city: east.id }, dmg: 3 }))
    expect(ofKind(resolveTurn(west.st, {}).events, 'shot').filter((e) => 'city' in e.from)).toEqual([])
    // Within the normal range of 2 on a side without a tower: strength 2, round(2) = 2.
    const plain = withCity({ interior: tower }, [unit(1, 'archer', T(3, 2), { stance: 'hold' })])
    expect(ofKind(resolveTurn(plain.st, {}).events, 'shot')).toContainEqual(expect.objectContaining({ from: { city: plain.id }, dmg: 2 }))
  })
})

describe('starting cities and score', () => {
  it('capitals start with a House and a food (or production) building, new cities with a House', () => {
    const s = createGame({ seed: 'aurora', players: [{ name: 'Anna', kind: 'bot' }, { name: 'Lars', kind: 'bot' }] })
    for (const c of s.cities) {
      const built = c.interior.plots.filter(Boolean)
      expect(built).toContain('house')
      expect(built.some((b) => b === 'farm' || b === 'sawmill' || b === 'harbor')).toBe(true)
      expect(c.interior.plots[0]).toBeNull()
    }
  })

  it('mirrored capitals get mirrored interiors, from the map alone', () => {
    for (const seed of ['aurora', 'b2', 'c3', 'd4', 'e5', 'f6']) {
      const s = createGame({ seed, players: [{ name: 'Anna', kind: 'bot' }, { name: 'Lars', kind: 'bot' }] })
      const [a, b] = s.map.starts
      expect(capitalInterior(s.map, b)).toEqual(rotateInterior(capitalInterior(s.map, a), 3))
      expect(s.cities[1].interior).toEqual(capitalInterior(s.map, b))
    }
  })

  it('a newly founded city has one House', () => {
    const settler = unit(0, 'settler', T(9, 2))
    const r = resolveTurn(withCity({}, [settler]).st, { 0: orders({ [settler.id]: order([], 'cautious', { found: true }) }) })
    const [f] = ofKind(r.events, 'found')
    expect(f.city.interior.plots.filter(Boolean)).toEqual(['house'])
  })

  it('counts buildings in the score, temples extra', () => {
    const base = makeState(map, [], [city(0, C), city(1, T(11, 5))])
    const built = makeState(map, [], [city(0, C, { interior: interior({ 1: 'house', 2: 'temple' }) }), city(1, T(11, 5))])
    expect(scores(built)[0] - scores(base)[0]).toBe(1 + 4)
  })

  it('every plot index maps to its ring and facing', () => {
    expect(PLOTS).toHaveLength(19)
    expect(PLOTS[EAST_CORNER].facing).toEqual([0])
    expect(PLOTS[8].facing).toEqual([0, 1])
  })
})
