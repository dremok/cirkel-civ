// STUB: owned by the engine agent. What a player is allowed to see (fog of war hooks in here later).
import type { GameState, PlayerId } from './types.ts'

export function observe(state: GameState, player: PlayerId): GameState {
  void player
  return state
}

/** Score per player: cities, population, units (used at the turn limit). */
export function scores(state: GameState): number[] {
  return state.players.map((p) => {
    const cities = state.cities.filter((c) => c.owner === p.id)
    return cities.length * 10 + cities.reduce((s, c) => s + c.pop * 3, 0) + state.units.filter((u) => u.owner === p.id).length
  })
}
