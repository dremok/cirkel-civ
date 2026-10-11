// City economy: which tiles a city works, what it yields, and when it grows.

import { CITY_WORK_RADIUS, TILE_YIELD } from './config.ts'
import { distance, tilesInRange } from './hex.ts'
import type { City, GameState, TileId } from './types.ts'

/** The city centre yields its terrain plus this. */
export const CENTER_BONUS = { food: 1, prod: 2 }
/** Food eaten per citizen per turn. */
export const FOOD_PER_POP = 2

/** Food needed to grow from `pop` to `pop + 1`: 16, 24, 34, 46, 60, ... */
export function growthThreshold(pop: number): number {
  return 10 + 5 * pop + pop * pop
}

export interface CityYield {
  food: number // gross food (before upkeep)
  prod: number
  worked: TileId[] // excluding the centre
}

/**
 * Worked tiles for every city. Each tile within radius 2 of a city belongs to the nearest city (ties:
 * the older city, then the lower id); city centres and tiles with enemy units are never worked.
 * A city works its `pop` best tiles: most food + production, ties to more food.
 */
export function cityYields(state: GameState): Map<number, CityYield> {
  const { map } = state
  const n = map.tiles.length
  const owner = new Int32Array(n).fill(-1) // index into state.cities
  const ownerDist = new Int32Array(n).fill(CITY_WORK_RADIUS + 1)
  const centre = new Uint8Array(n)
  for (const c of state.cities) centre[c.tile] = 1
  state.cities.forEach((c, ci) => {
    for (const t of tilesInRange(map, c.tile, CITY_WORK_RADIUS)) {
      const d = distance(map, c.tile, t)
      const o = owner[t] >= 0 ? state.cities[owner[t]] : null
      if (!o || d < ownerDist[t] || (d === ownerDist[t] && (c.founded < o.founded || (c.founded === o.founded && c.id < o.id)))) {
        owner[t] = ci
        ownerDist[t] = d
      }
    }
  })
  const unitOwner = new Int16Array(n).fill(-1)
  for (const u of state.units) unitOwner[u.tile] = u.owner
  const tiles: TileId[][] = state.cities.map(() => [])
  for (let t = 0; t < n; t++) {
    const ci = owner[t]
    if (ci < 0 || centre[t]) continue
    if (unitOwner[t] === -1 || unitOwner[t] === state.cities[ci].owner) tiles[ci].push(t)
  }
  const out = new Map<number, CityYield>()
  state.cities.forEach((c, ci) => {
    const cand = tiles[ci]
    cand.sort((a, b) => {
      const ya = TILE_YIELD[map.tiles[a].biome]
      const yb = TILE_YIELD[map.tiles[b].biome]
      return yb.food + yb.prod - (ya.food + ya.prod) || yb.food - ya.food || a - b
    })
    const worked = cand.slice(0, c.pop)
    const y = TILE_YIELD[map.tiles[c.tile].biome]
    let food = y.food + CENTER_BONUS.food
    let prod = y.prod + CENTER_BONUS.prod
    for (const t of worked) {
      food += TILE_YIELD[map.tiles[t].biome].food
      prod += TILE_YIELD[map.tiles[t].biome].prod
    }
    out.set(c.id, { food, prod, worked })
  })
  return out
}

/** One city's economy for the UI: net food and production per turn, the stored food it needs to
 * grow (compare with `city.food`), and the tiles it works. Null if there is no such city. */
export function cityYield(state: GameState, cityId: number): { food: number; prod: number; foodToGrow: number; worked: TileId[] } | null {
  const c = state.cities.find((x) => x.id === cityId)
  if (!c) return null
  const y = cityYields(state).get(cityId)!
  return { food: foodSurplus(c, y), prod: y.prod, foodToGrow: growthThreshold(c.pop), worked: y.worked }
}

/** Net food per turn (can be negative; the store never drops below 0). */
export function foodSurplus(c: City, y: CityYield): number {
  return y.food - FOOD_PER_POP * c.pop
}
