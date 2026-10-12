// What this player can see (SPEC.md §7b), for panels and tile info. The engine decides; this only
// reads its answers. Without fog everything is explored and in sight.
import { exploredOf, visibility } from '../../../engine/index.ts'
import type { CityId, GameState, PlayerId, TileId } from '../../../engine/types.ts'

export interface FogView {
  readonly on: boolean
  /** Seen at least once: the terrain is known. */
  explored(tile: TileId): boolean
  /** In sight right now: units and cities there are live. */
  visible(tile: TileId): boolean
  /** The turn a remembered rival city was last seen, if known. */
  lastSeen(city: CityId): number | null
}

export const NO_FOG: FogView = { on: false, explored: () => true, visible: () => true, lastSeen: () => null }

const cache = new WeakMap<GameState, FogView>()

export function fogView(state: GameState, me: PlayerId | null): FogView {
  // Spectators (who only ever get finished fog games) and fogless games see everything.
  const memory = me === null ? null : state.fog?.[me] ?? null
  if (!memory) return NO_FOG
  let v = cache.get(state)
  if (!v) {
    const explored = exploredOf(state, me!)
    const seen = visibility(state, me!)
    v = {
      on: true,
      explored: (t) => explored[t] === 1,
      visible: (t) => seen[t] === 1,
      lastSeen: (c) => memory.seen?.[c] ?? null,
    }
    cache.set(state, v)
  }
  return v
}
