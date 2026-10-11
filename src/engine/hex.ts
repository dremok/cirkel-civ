// Hex math. Pointy-top hexes in an odd-r offset grid (odd rows shifted half a hex right).
// Tiles are addressed by TileId = row * width + col; axial (q, r) is used for distance.

import type { GameMap, TileId } from './types.ts'

export const SQRT3 = Math.sqrt(3)

export function offsetToAxial(col: number, row: number): { q: number; r: number } {
  return { q: col - (row - (row & 1)) / 2, r: row }
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2, row: r }
}

export function axialDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2
  const dr = r1 - r2
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** Axial neighbour directions, clockwise from east. */
export const AXIAL_DIRS: readonly [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]

/** Planar centre of a hex with circumradius 1, in the x/z plane (y is up in the renderer). */
export function hexCenter(col: number, row: number): { x: number; z: number } {
  return { x: SQRT3 * (col + 0.5 * (row & 1)), z: 1.5 * row }
}

/** Corner i (0..5) of a pointy-top hex with circumradius 1, relative to its centre. */
export function hexCorner(i: number): { x: number; z: number } {
  const a = (Math.PI / 180) * (60 * i - 30)
  return { x: Math.cos(a), z: Math.sin(a) }
}

const neighbourCache = new WeakMap<GameMap, TileId[][]>()

/** Neighbour tile ids (only those on the map). Cached per map object. */
export function neighbors(map: GameMap, id: TileId): TileId[] {
  let all = neighbourCache.get(map)
  if (!all) {
    all = map.tiles.map((t) => {
      const out: TileId[] = []
      for (const [dq, dr] of AXIAL_DIRS) {
        const { col, row } = axialToOffset(t.q + dq, t.r + dr)
        if (col >= 0 && col < map.width && row >= 0 && row < map.height) out.push(row * map.width + col)
      }
      return out
    })
    neighbourCache.set(map, all)
  }
  return all[id]
}

export function distance(map: GameMap, a: TileId, b: TileId): number {
  const ta = map.tiles[a]
  const tb = map.tiles[b]
  return axialDistance(ta.q, ta.r, tb.q, tb.r)
}

/** All tile ids within `radius` steps of `center` (including it). */
export function tilesInRange(map: GameMap, center: TileId, radius: number): TileId[] {
  const c = map.tiles[center]
  const out: TileId[] = []
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const { col, row } = axialToOffset(c.q + dq, c.r + dr)
      if (col >= 0 && col < map.width && row >= 0 && row < map.height) out.push(row * map.width + col)
    }
  }
  return out
}

export function tileAt(map: GameMap, col: number, row: number): TileId | null {
  if (col < 0 || col >= map.width || row < 0 || row >= map.height) return null
  return row * map.width + col
}
