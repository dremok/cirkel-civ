// Per-turn city economy for the city panel, straight from the engine's rules, with the focus the
// player has chosen this turn (it only reaches the city when the turn resolves).
import { foodSurplus, growthNeed, outputOf } from '../../../engine/index.ts'
import type { City, CityFocus, GameState } from '../../../engine/types.ts'

export interface CityEconomy {
  food: number // net food per turn
  prod: number // production per turn
  housing: number // citizens the city has room for
  /** Turns until the next citizen; null when not growing (no surplus, or no room). */
  growIn: number | null
  /** Out of housing: the city needs a house to grow. */
  full: boolean
}

export function cityEconomy(state: GameState, city: City, focus: CityFocus): CityEconomy {
  const c = focus === city.interior.focus ? city : { ...city, interior: { ...city.interior, focus } }
  const out = outputOf(state.map, c)
  const food = foodSurplus(c, out)
  const full = c.pop >= out.housing
  const growIn = food > 0 && !full ? Math.max(1, Math.ceil((growthNeed(c, out) - c.food) / food)) : null
  return { food, prod: out.prod, housing: out.housing, growIn, full }
}
