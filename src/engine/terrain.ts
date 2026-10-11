import { CLIMB_COST_PER_LEVEL, FLAT_COST, MAX_STEP, TERRAIN_COST } from './config.ts'
import type { GameMap, TileId } from './types.ts'

export function isWater(map: GameMap, id: TileId): boolean {
  const b = map.tiles[id].biome
  return b === 'deep' || b === 'shallow'
}

export function isPassable(map: GameMap, id: TileId): boolean {
  return Number.isFinite(TERRAIN_COST[map.tiles[id].biome])
}

/** Can a land unit step from `a` into the neighbouring tile `b` at all (terrain and cliffs)? */
export function canStep(map: GameMap, a: TileId, b: TileId): boolean {
  if (!isPassable(map, b)) return false
  return Math.abs(map.tiles[b].height - map.tiles[a].height) <= MAX_STEP
}

/** Movement points needed to step from `a` into neighbouring `b` (before the per-unit cap). */
export function stepCost(map: GameMap, a: TileId, b: TileId): number {
  if (!canStep(map, a, b)) return Infinity
  const climb = Math.max(0, map.tiles[b].height - map.tiles[a].height)
  return FLAT_COST * TERRAIN_COST[map.tiles[b].biome] + CLIMB_COST_PER_LEVEL * climb
}
