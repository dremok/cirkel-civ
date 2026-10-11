// Board layout: where every column, its top, the sea surface and the board rim sit in world space.
// Pointy-top hexes with circumradius 1 (see engine/hex.ts), y is up.

import { SQRT3, axialToOffset, hexCenter } from '../../../engine/hex.ts'
import type { GameMap, TileId } from '../../../engine/types.ts'

/** Height of one terrain level. */
export const LEVEL = 0.36
/** The sea surface. Land at height 2 stands at y = 0. */
export const WATER_Y = -0.16
/** Horizontal width and drop of the chamfer on each column's top edge. */
export const BEVEL_IN = 0.035
export const BEVEL_DROP = 0.018
/** Underside of the board. */
export const BOTTOM_Y = -2.2
/** Hex inradius (centre to edge). */
export const INRADIUS = SQRT3 / 2

/** Seabed depth below the surface by distance (in tiles) from the nearest land. */
const SEA_DEPTH = [0, 0.34, 0.74, 1.0, 1.16, 1.26]

export interface Layout {
  map: GameMap
  /** Tile centres. */
  cx: Float32Array
  cz: Float32Array
  /** Top of each column (the seabed for water tiles). */
  top: Float32Array
  /** Where a piece stands: the column top, or the sea surface for water. */
  stand: Float32Array
  /** Top of the volume used for picking (the stand height). */
  pickTop: Float32Array
  /** Mountains: top of the narrower inner volume that stands in for the crags in picking (else 0). */
  cragTop: Float32Array
  water: Uint8Array
  /** For water tiles: tiles to the nearest land (1 = coast). 0 for land. */
  seaDist: Uint8Array
  /** Neighbour across edge i (0..5, edge i faces angle 60°·i in the x/z plane), or -1 off the board. */
  nb: Int32Array
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  maxY: number
}

export function landY(height: number): number {
  return (height - 2) * LEVEL
}

/** Small deterministic hash in [0, 1) for per-tile variation. */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

export function buildLayout(map: GameMap): Layout {
  const n = map.tiles.length
  const cx = new Float32Array(n)
  const cz = new Float32Array(n)
  const top = new Float32Array(n)
  const stand = new Float32Array(n)
  const pickTop = new Float32Array(n)
  const cragTop = new Float32Array(n)
  const water = new Uint8Array(n)
  const seaDist = new Uint8Array(n)
  const nb = new Int32Array(n * 6).fill(-1)

  for (const t of map.tiles) {
    const c = hexCenter(t.col, t.row)
    cx[t.id] = c.x
    cz[t.id] = c.z
    water[t.id] = t.height < 2 ? 1 : 0
  }
  for (const t of map.tiles) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      nb[t.id * 6 + i] = tileAtPoint(map, cx[t.id] + SQRT3 * Math.cos(a), cz[t.id] + SQRT3 * Math.sin(a)) ?? -1
    }
  }

  // Breadth-first distance from land across the sea.
  const queue: number[] = []
  for (let id = 0; id < n; id++) if (!water[id]) queue.push(id)
  const dist = new Int32Array(n).fill(-1)
  for (const id of queue) dist[id] = 0
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    for (let i = 0; i < 6; i++) {
      const o = nb[id * 6 + i]
      if (o >= 0 && dist[o] < 0) {
        dist[o] = dist[id] + 1
        queue.push(o)
      }
    }
  }

  let maxY = 0
  for (const t of map.tiles) {
    const id = t.id
    if (water[id]) {
      const d = dist[id] < 0 ? SEA_DEPTH.length - 1 : Math.min(dist[id], SEA_DEPTH.length - 1)
      seaDist[id] = Math.max(1, d)
      let depth = SEA_DEPTH[Math.max(1, d)]
      if (t.biome === 'shallow') depth = Math.min(depth, 0.5)
      depth += (hash01(id, 7) - 0.5) * 0.06
      top[id] = WATER_Y - depth
      stand[id] = WATER_Y
      pickTop[id] = WATER_Y
    } else {
      // Beaches sit a hair lower so the shore reads as shore (far less than a level).
      top[id] = landY(t.height) - (t.biome === 'beach' ? 0.04 : 0)
      stand[id] = top[id]
      pickTop[id] = top[id]
      if (t.biome === 'mountain' || t.biome === 'snow') cragTop[id] = top[id] + (t.biome === 'snow' ? 1.0 : 0.62)
    }
    maxY = Math.max(maxY, pickTop[id], cragTop[id])
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let id = 0; id < n; id++) {
    minX = Math.min(minX, cx[id] - INRADIUS)
    maxX = Math.max(maxX, cx[id] + INRADIUS)
    minZ = Math.min(minZ, cz[id] - 1)
    maxZ = Math.max(maxZ, cz[id] + 1)
  }

  return { map, cx, cz, top, stand, pickTop, cragTop, water, seaDist, nb, minX, maxX, minZ, maxZ, maxY }
}

/** The tile whose hexagon contains the planar point (x, z), or null off the board. */
export function tileAtPoint(map: GameMap, x: number, z: number): TileId | null {
  const r = z / 1.5
  const q = x / SQRT3 - r / 2
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  const { col, row } = axialToOffset(rq, rr)
  if (col < 0 || col >= map.width || row < 0 || row >= map.height) return null
  return row * map.width + col
}

/** Signed distance from planar point (px, pz), relative to a hex centre, to that hexagon's outline. */
export function hexSdf(px: number, pz: number): number {
  // Pointy-top hex: flat edges face ±x. Fold into one sextant.
  let x = Math.abs(pz)
  let y = Math.abs(px)
  const kx = -0.8660254, ky = 0.5, kz = 0.57735027
  const d = Math.min(kx * x + ky * y, 0)
  x -= 2 * d * kx
  y -= 2 * d * ky
  const r = INRADIUS
  x -= Math.min(Math.max(x, -kz * r), kz * r)
  y -= r
  return Math.hypot(x, y) * Math.sign(y)
}
