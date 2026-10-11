// STUB: owned by the engine agent. Simultaneous resolution of one turn (see SPEC.md §3).
import type { GameState, PlayerId, PlayerOrders, ResolveResult } from './types.ts'

/** Pure: never mutates `state`. Missing players keep their persistent orders. */
export function resolveTurn(state: GameState, orders: Partial<Record<PlayerId, PlayerOrders>>): ResolveResult {
  void orders
  const next: GameState = structuredClone(state)
  next.turn++
  return { state: next, events: [] }
}
