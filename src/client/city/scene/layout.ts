// Where everything sits in the city diorama. The city tile is a large pointy-top hex column (the
// plinth) whose top holds the 19 plots of engine/city.ts at unit spacing; the six real neighbour
// tiles are columns of the same size around it, at their own heights. y is up, x right, z towards
// the viewer, exactly like the world (and the engine's plot layout).

import { PLOTS, neighborInDir } from '../../../engine/city.ts'
import type { Biome, GameMap, TileId } from '../../../engine/types.ts'

export const SQRT3 = Math.sqrt(3)
/** Lot inradius (plots are spaced SQRT3 apart, so streets are 2 * (SQRT3 / 2 - LOT_IN) wide). */
export const LOT_IN = 0.75
export const LOT_R = LOT_IN / (SQRT3 / 2)
/** Top of a lot above the street. */
export const LOT_Y = 0.045
export const STREET_Y = 0.012
/** The plinth: inradius and circumradius. */
export const BOARD_IN = 4.75
export const BOARD_R = BOARD_IN / (SQRT3 / 2)
/** Height of one terrain level at this scale (compressed: the world's would be about 1.6). */
export const LEVEL = 0.5
export const BOTTOM_Y = -3.4

/** Planar angle (atan2(z, x)) of axial direction d, the outward normal of hex edge d. */
export const dirAngle = (d: number) => (-Math.PI / 3) * d

export const DIR_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east']

export interface PlotSpot {
  index: number
  ring: 0 | 1 | 2
  x: number
  z: number
  /** Angle pointing away from the centre (for outer plots: towards what the plot faces). */
  out: number
  facing: number[]
  /** Hex edges (directions) of this plot that face out of the city (outer plots only). */
  outEdges: number[]
  /** Distance from the plot centre to the plinth edge along `out`. */
  edgeDist: number
}

export const SPOTS: PlotSpot[] = PLOTS.map((p) => {
  const out = p.ring === 0 ? 0 : Math.atan2(p.z, p.x)
  const outEdges: number[] = []
  if (p.ring === 2) {
    const f = p.facing
    if (f.length === 1) outEdges.push((f[0] + 5) % 6, f[0], (f[0] + 1) % 6)
    else outEdges.push(f[0], f[1])
  }
  // plinth edge along `out`: the hex edge(s) in that direction
  let edgeDist = 0
  if (p.ring > 0) {
    let best = Infinity
    for (let d = 0; d < 6; d++) {
      const a = dirAngle(d)
      const c = Math.cos(out - a)
      if (c <= 1e-6) continue
      const along = (BOARD_IN - (p.x * Math.cos(a) + p.z * Math.sin(a))) / c
      if (along < best) best = along
    }
    edgeDist = best
  }
  return { index: p.index, ring: p.ring, x: p.x, z: p.z, out, facing: p.facing, outEdges, edgeDist }
})

export interface Neighbour {
  dir: number
  tile: TileId | null
  biome: Biome | null
  /** Column top (seabed for water). */
  top: number
  water: boolean
  cx: number
  cz: number
  height: number
  moisture: number
}

export interface CityLayout {
  map: GameMap
  tile: TileId
  biome: Biome
  height: number
  /** Sea surface (relative to the plinth top at y = 0). */
  waterY: number
  neighbours: Neighbour[]
}

export function seaLevel(cityHeight: number): number {
  return (2 - cityHeight) * LEVEL - 0.28
}

export function buildCityLayout(map: GameMap, tile: TileId): CityLayout {
  const t = map.tiles[tile]
  const waterY = seaLevel(t.height)
  const neighbours: Neighbour[] = []
  for (let d = 0; d < 6; d++) {
    const n = neighborInDir(map, tile, d)
    const a = dirAngle(d)
    const cx = Math.cos(a) * BOARD_IN * 2
    const cz = Math.sin(a) * BOARD_IN * 2
    if (n === null) {
      neighbours.push({ dir: d, tile: null, biome: null, top: BOTTOM_Y, water: false, cx, cz, height: 0, moisture: 0 })
      continue
    }
    const nt = map.tiles[n]
    const water = nt.height < 2
    const top = water ? waterY - (nt.biome === 'deep' ? 1.2 : 0.55) : (nt.height - t.height) * LEVEL - (nt.biome === 'beach' ? 0.06 : 0)
    neighbours.push({ dir: d, tile: n, biome: nt.biome, top, water, cx, cz, height: nt.height, moisture: nt.moisture })
  }
  return { map, tile, biome: t.biome, height: t.height, waterY, neighbours }
}

/** Signed distance from (px, pz) relative to a pointy-top hex centre to its outline (inradius r). */
export function hexSdf(px: number, pz: number, r: number): number {
  let x = Math.abs(pz)
  let y = Math.abs(px)
  const kx = -0.8660254, ky = 0.5, kz = 0.57735027
  const d = Math.min(kx * x + ky * y, 0)
  x -= 2 * d * kx
  y -= 2 * d * ky
  x -= Math.min(Math.max(x, -kz * r), kz * r)
  y -= r
  return Math.hypot(x, y) * Math.sign(y)
}

/** Which plot (0..18) contains the planar point, or -1. */
export function plotAt(x: number, z: number): number {
  const r = z / 1.5
  const q = x / SQRT3 - r / 2
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(-q - r)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  const p = PLOTS.find((pl) => pl.q === rq && pl.r === rr)
  return p ? p.index : -1
}
