// STUB: owned by the engine agent. Pathfinding and movement previews for UI and bots.
import type { GameState, TileId, UnitId } from './types.ts'

/** Cheapest path for a unit to `dest` (excluding the start tile), ignoring other units except
 * that `dest` may hold an enemy (an attack). Null if unreachable. */
export function findPath(state: GameState, unit: UnitId, dest: TileId): TileId[] | null {
  void state; void unit; void dest
  return null
}

/** When the unit would enter each tile of `path`: turn offset (0 = this turn) and tick (1..6). */
export function pathTiming(state: GameState, unit: UnitId, path: TileId[]): { turn: number; tick: number }[] {
  void state; void unit
  return path.map(() => ({ turn: 0, tick: 6 }))
}

/** Tiles the unit can reach this turn (ignoring other units' plans). */
export function reachableThisTurn(state: GameState, unit: UnitId): TileId[] {
  void state; void unit
  return []
}
