// What a player is allowed to see. v0.1 has no fog of war: every unit and city is visible, but
// other players' plans are not: their units' paths, founding flags and volley targets, and their
// cities' current construction and stores. Stances, buildings and city focus are visible.
import type { GameState, PlayerId } from './types.ts'

export function observe(state: GameState, player: PlayerId): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    units: state.units.map((u) =>
      u.owner === player ? { ...u, path: [...u.path] } : { ...u, path: [], found: false, target: null },
    ),
    cities: state.cities.map((c) => {
      const interior = { ...c.interior, plots: [...c.interior.plots] }
      return c.owner === player ? { ...c, interior } : { ...c, interior, build: null, prod: 0, food: 0 }
    }),
  }
}

/** Points per city, citizen, building (a temple counts extra) and unit, used at the turn limit. */
export const SCORE = { city: 10, pop: 3, building: 1, temple: 3, unit: 1 }

/** Score per player: cities, citizens, buildings and units (used at the turn limit). */
export function scores(state: GameState): number[] {
  return state.players.map((p) => {
    let s = 0
    for (const c of state.cities) {
      if (c.owner !== p.id) continue
      s += SCORE.city + c.pop * SCORE.pop
      for (const b of c.interior.plots) if (b) s += SCORE.building + (b === 'temple' ? SCORE.temple : 0)
    }
    for (const u of state.units) if (u.owner === p.id) s += SCORE.unit
    return s
  })
}
