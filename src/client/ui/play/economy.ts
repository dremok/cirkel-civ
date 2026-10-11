// Per-turn city economy for the city panel, straight from the engine's rules.
import { cityYields, foodSurplus, growthThreshold } from '../../../engine/economy.ts'
import type { City, GameState } from '../../../engine/types.ts'

export interface CityEconomy {
  food: number // net food per turn
  prod: number // production per turn
  growIn: number | null // turns until the next citizen, null if not growing
}

const cache = new WeakMap<GameState, ReturnType<typeof cityYields>>()

export function cityEconomy(state: GameState, city: City): CityEconomy | null {
  let all = cache.get(state)
  if (!all) {
    all = cityYields(state)
    cache.set(state, all)
  }
  const y = all.get(city.id)
  if (!y) return null
  const food = foodSurplus(city, y)
  const need = growthThreshold(city.pop) - city.food
  return { food, prod: y.prod, growIn: food > 0 ? Math.max(1, Math.ceil(need / food)) : null }
}
