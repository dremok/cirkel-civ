// The player's draft plan for the current turn, and what the renderer should show for it.
import { distance, findPath, MIN_CITY_DISTANCE, pathTiming, reachableThisTurn } from '../../../engine/index.ts'
import type { BuildItem, City, GameState, PlayerId, PlayerOrders, TileId, Unit, UnitId, UnitOrder } from '../../../engine/types.ts'
import type { PlanStep, UnitPlan } from '../../render/api.ts'

export type Draft = PlayerOrders
export type PlanKind = UnitPlan['kind']

export const emptyDraft = (): Draft => ({ units: {}, cities: {} })

/** The order a unit will follow: my draft if I touched it, else its persistent order. */
export function unitOrder(draft: Draft, u: Unit): UnitOrder {
  return draft.units[u.id] ?? { path: u.path, stance: u.stance, found: u.found, target: u.target }
}

export function cityBuild(draft: Draft, c: City): BuildItem | null {
  return c.id in draft.cities ? draft.cities[c.id] : c.build
}

export function withUnitOrder(draft: Draft, u: Unit, patch: Partial<UnitOrder>): Draft {
  const cur = unitOrder(draft, u)
  return { ...draft, units: { ...draft.units, [u.id]: { ...cur, ...patch } } }
}

export function withCityBuild(draft: Draft, c: City, item: BuildItem | null): Draft {
  return { ...draft, cities: { ...draft.cities, [c.id]: item } }
}

export function unitAt(state: GameState, tile: TileId): Unit | undefined {
  return state.units.find((u) => u.tile === tile)
}

export function cityAt(state: GameState, tile: TileId): City | undefined {
  return state.cities.find((c) => c.tile === tile)
}

export function isEnemyAt(state: GameState, me: PlayerId, tile: TileId): boolean {
  const u = unitAt(state, tile)
  if (u && u.owner !== me) return true
  const c = cityAt(state, tile)
  return !!c && c.owner !== me
}

export function planKind(state: GameState, me: PlayerId, o: UnitOrder): PlanKind {
  if (o.found) return 'found'
  const last = o.path[o.path.length - 1]
  return last !== undefined && isEnemyAt(state, me, last) ? 'attack' : 'move'
}

export function planSteps(state: GameState, unit: UnitId, path: TileId[]): PlanStep[] {
  if (!path.length) return []
  const timing = pathTiming(state, unit, path)
  return path.map((tile, i) => ({ tile, turn: timing[i]?.turn ?? 0, tick: timing[i]?.tick ?? 6 }))
}

export function buildPlans(state: GameState, draft: Draft, me: PlayerId): UnitPlan[] {
  const plans: UnitPlan[] = []
  for (const u of state.units) {
    if (u.owner !== me) continue
    const o = unitOrder(draft, u)
    const target = o.target ?? null
    // A standing archer with only a volley target still gets a plan, so its target is drawn.
    if (!o.path.length && !o.found && target === null) continue
    const kind = o.path.length || o.found ? planKind(state, me, o) : 'attack'
    plans.push({ unit: u.id, steps: planSteps(state, u.id, o.path), kind, stance: o.stance, target })
  }
  return plans
}

/** A unit still waiting for the player: no path, not founding, not told to hold, no volley target. */
export function isIdle(draft: Draft, u: Unit): boolean {
  const o = unitOrder(draft, u)
  return !o.path.length && !o.found && o.stance !== 'hold' && o.target == null
}

export function myUnits(state: GameState, me: PlayerId): Unit[] {
  return state.units.filter((u) => u.owner === me).sort((a, b) => a.id - b.id)
}

/** Next unit for "Next unit": the next idle one after `current`, else simply the next one. */
export function nextUnit(state: GameState, draft: Draft, me: PlayerId, current: UnitId | null): Unit | null {
  const units = myUnits(state, me)
  if (!units.length) return null
  const start = current === null ? -1 : units.findIndex((u) => u.id === current)
  const order = [...units.slice(start + 1), ...units.slice(0, start + 1)]
  return order.find((u) => isIdle(draft, u) && u.id !== current) ?? order.find((u) => u.id !== current) ?? units[0]
}

export function safeFindPath(state: GameState, unit: UnitId, dest: TileId): TileId[] | null {
  try {
    const p = findPath(state, unit, dest)
    return p && p.length ? p : null
  } catch {
    return null
  }
}

export function safeReachable(state: GameState, unit: UnitId): TileId[] {
  try {
    return reachableThisTurn(state, unit)
  } catch {
    return []
  }
}

/** Where a settler would found its city, and the nearest city that is too close, if any. */
export function foundingCheck(state: GameState, draft: Draft, u: Unit): { tile: TileId; tooClose: City | null } {
  const o = unitOrder(draft, u)
  const tile = o.path.length ? o.path[o.path.length - 1] : u.tile
  let tooClose: City | null = null
  for (const c of state.cities) {
    if (distance(state.map, c.tile, tile) < MIN_CITY_DISTANCE) tooClose = c
  }
  return { tile, tooClose }
}

/** Nearest city within `max` steps, for "near Lund" in texts. */
export function nearestCity(state: GameState, tile: TileId, max = 3): City | null {
  let best: City | null = null
  let bestD = Infinity
  for (const c of state.cities) {
    const d = distance(state.map, c.tile, tile)
    if (d <= max && d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}
