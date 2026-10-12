// Fog of war on the pieces side: what a player has explored and sees right now (the engine's rules).
import { exploredOf, visibility } from '../../../engine/index.ts'
import type { GameMap, GameState, PlayerId } from '../../../engine/types.ts'

export interface FogView {
  explored: Uint8Array
  visible: Uint8Array
}

export const exploredFor = (state: GameState, me: PlayerId): Uint8Array => exploredOf(state, me)

/** Tiles `me` sees with its units and cities as they stand in `state`. */
export const visibleFor = (state: GameState, me: PlayerId): Uint8Array => visibility(state, me)

/** The fog for `me` in `state`, or null when the game has no fog or nobody is watching. */
export function fogFor(state: GameState, me: PlayerId | null): FogView | null {
  if (!state.fog || me === null || me < 0) return null
  const visible = visibleFor(state, me)
  const explored = exploredFor(state, me)
  // whatever is seen now is explored too
  for (let i = 0; i < explored.length; i++) if (visible[i]) explored[i] = 1
  return { explored, visible }
}

export function sameMask(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return a === b
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const allExplored = (map: GameMap) => new Uint8Array(map.tiles.length).fill(1)
