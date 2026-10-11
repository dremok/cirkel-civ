// What a player is allowed to see. v0.1 has no fog of war: every unit and city is visible, but
// other players' plans are not: their units' paths, founding flags and volley targets, and their
// cities' build choice and stores. Stances are visible (you can see a unit dig in or charge).
import type { GameState, PlayerId } from './types.ts'

export function observe(state: GameState, player: PlayerId): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    units: state.units.map((u) =>
      u.owner === player ? { ...u, path: [...u.path] } : { ...u, path: [], found: false, target: null },
    ),
    cities: state.cities.map((c) => (c.owner === player ? { ...c } : { ...c, build: null, prod: 0, food: 0 })),
  }
}

/** Score per player: cities, population, units (used at the turn limit). */
export function scores(state: GameState): number[] {
  return state.players.map((p) => {
    const cities = state.cities.filter((c) => c.owner === p.id)
    return cities.length * 10 + cities.reduce((s, c) => s + c.pop * 3, 0) + state.units.filter((u) => u.owner === p.id).length
  })
}
