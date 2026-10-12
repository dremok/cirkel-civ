// City economy: output comes from the buildings inside the city (city.ts), citizens eat, cities
// grow up to their housing, and production pays for units and buildings.

import { UNITS } from './config.ts'
import {
  BARRACKS_DISCOUNT, BASE_HOUSING, BUILDINGS, HOUSING_PER_HOUSE, TEMPLE_GROWTH_DISCOUNT, cityOutput, hasBuilding, type CityOutput,
} from './city.ts'
import type { BuildItem, City, CityInterior, GameMap, GameState } from './types.ts'

/** Food eaten per citizen per turn. */
export const FOOD_PER_POP = 1

/** Food needed to grow from `pop` to `pop + 1` (before the temple discount): 12, 16, 20, 24, ... */
export function growthThreshold(pop: number): number {
  return 8 + 4 * pop
}

/** What the city makes this turn with its current citizens and focus. */
export function outputOf(map: GameMap, c: City): CityOutput {
  return cityOutput(map, c.tile, c.interior, c.pop)
}

/** How many citizens the city has room for. */
export function housingOf(interior: CityInterior): number {
  return BASE_HOUSING + HOUSING_PER_HOUSE * interior.plots.filter((b) => b === 'house').length
}

/** Stored food the city needs for its next citizen: 25 % less while a temple is staffed. */
export function growthNeed(c: City, out: CityOutput): number {
  const temple = c.interior.plots.some((b, i) => b === 'temple' && out.staffed[i])
  return Math.round(growthThreshold(c.pop) * (temple ? 1 - TEMPLE_GROWTH_DISCOUNT : 1))
}

/** Net food per turn (can be negative; the store never drops below 0). */
export function foodSurplus(c: City, out: CityOutput): number {
  return out.food - FOOD_PER_POP * c.pop
}

/** Production a build item costs in this city: units are 25 % cheaper with barracks. */
export function buildCost(c: City, item: BuildItem): number {
  if (typeof item !== 'string') return BUILDINGS[item.building].cost
  const discount = hasBuilding(c.interior, 'barracks') ? 1 - BARRACKS_DISCOUNT : 1
  return Math.round(UNITS[item].cost * discount)
}

/** One city's economy for the UI. Null if there is no such city. */
export function cityYield(
  state: GameState,
  cityId: number,
): { food: number; prod: number; foodToGrow: number; housing: number; output: CityOutput } | null {
  const c = state.cities.find((x) => x.id === cityId)
  if (!c) return null
  const out = outputOf(state.map, c)
  return { food: foodSurplus(c, out), prod: out.prod, foodToGrow: growthNeed(c, out), housing: out.housing, output: out }
}
