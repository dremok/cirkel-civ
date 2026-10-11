// Shared helpers for the pieces layer: board geometry in world space, easing, colours.
import * as THREE from 'three'
import { axialToOffset } from '../../../engine/hex.ts'
import type { GameMap, GameState, PlayerId, TileId } from '../../../engine/types.ts'
import type { World } from '../api.ts'
import { PLAYERS, UI } from '../palette.ts'

export const SQRT3 = Math.sqrt(3)

/** Axial direction of the neighbour across edge i (edge i joins corner i and i+1; its outward
 * normal points at 60·i degrees in the x/z plane, z towards the viewer). */
export const EDGE_DIRS: readonly [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]

/** Board geometry in world units, derived from the World so it follows whatever the world does. */
export interface Board {
  readonly map: GameMap
  /** Top centre of every tile (where pieces stand). */
  readonly tops: THREE.Vector3[]
  /** Hex circumradius in world units. */
  readonly R: number
  tileAtXZ(x: number, z: number): TileId | null
  /** Corner i (0..5) of a tile at its top, pulled towards the centre by `inset` world units along the corner ray. */
  corner(tile: TileId, i: number, out?: THREE.Vector3): THREE.Vector3
  across(tile: TileId, edge: number): TileId | null
  isLand(tile: TileId): boolean
}

export function makeBoard(world: World): Board {
  const map = world.map
  const tops = map.tiles.map((t) => world.tileTop(t.id).clone())
  const a = tops[0]
  const b = tops[1]
  const R = Math.hypot(b.x - a.x, b.z - a.z) / SQRT3 || 1
  // hexCenter(0,0) is the origin of the engine's layout; the world may offset it.
  const ox = a.x
  const oz = a.z
  const tileAtXZ = (x: number, z: number): TileId | null => {
    const xx = (x - ox) / R
    const zz = (z - oz) / R
    const r = zz / 1.5
    const q = xx / SQRT3 - r / 2
    let rq = Math.round(q)
    let rr = Math.round(r)
    const rs = Math.round(-q - r)
    const dq = Math.abs(rq - q)
    const dr = Math.abs(rr - r)
    const ds = Math.abs(rs + q + r)
    if (dq > dr && dq > ds) rq = -rr - rs
    else if (dr > ds) rr = -rq - rs
    const { col, row } = axialToOffset(rq, rr)
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null
    return row * map.width + col
  }
  return {
    map, tops, R, tileAtXZ,
    corner(tile, i, out = new THREE.Vector3()) {
      const ang = (Math.PI / 180) * (60 * (((i % 6) + 6) % 6) - 30)
      const t = tops[tile]
      return out.set(t.x + Math.cos(ang) * R, t.y, t.z + Math.sin(ang) * R)
    },
    across(tile, edge) {
      const t = map.tiles[tile]
      const [dq, dr] = EDGE_DIRS[((edge % 6) + 6) % 6]
      const { col, row } = axialToOffset(t.q + dq, t.r + dr)
      if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null
      return row * map.width + col
    },
    isLand(tile) {
      const bio = map.tiles[tile].biome
      return bio !== 'deep' && bio !== 'shallow'
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Easing

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
export const easeInCubic = (t: number) => t * t * t
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
export const easeOutBack = (t: number, s = 1.2) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
export const easeOutQuart = (t: number) => 1 - (1 - t) ** 4

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Deterministic 0..1 hash of an integer (for per-piece variety that is stable across reloads). */
export function hash01(n: number, salt = 0): number {
  let h = (n * 374761393 + salt * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------------------------
// Colours

export interface TeamColors { base: THREE.Color; light: THREE.Color; dark: THREE.Color; css: { base: string; light: string; dark: string } }

const teamCache = new Map<number, TeamColors>()
/** Colours for palette index `idx` (linear THREE colours plus the sRGB css strings). */
export function teamColors(idx: number): TeamColors {
  let c = teamCache.get(idx)
  if (!c) {
    const p = PLAYERS[((idx % PLAYERS.length) + PLAYERS.length) % PLAYERS.length]
    c = { base: new THREE.Color(p.base), light: new THREE.Color(p.light), dark: new THREE.Color(p.dark), css: { base: p.base, light: p.light, dark: p.dark } }
    teamCache.set(idx, c)
  }
  return c
}

/** Palette index of a player in a state (falls back to the seat). */
export function colorIndexOf(state: GameState | null, owner: PlayerId): number {
  return state?.players[owner]?.color ?? owner
}

export const IVORY = new THREE.Color(UI.paper)
export const INK = new THREE.Color(UI.ink)
export const ATTACK_RED = '#D2432B'
