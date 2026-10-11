// STUB: owned by the engine agent. A scripted bot that plays through the same API as humans.
import type { GameState, PlayerId, PlayerOrders } from './types.ts'

export function botOrders(state: GameState, player: PlayerId, seed = 0): PlayerOrders {
  void state; void player; void seed
  return { units: {}, cities: {} }
}
