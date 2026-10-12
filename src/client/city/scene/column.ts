// Hex columns for the diorama: a top surface (flat or shaped by a height function, subdivided into
// a fine triangle grid) and strata on the sides down to whatever is next to it. Shared by the city
// plinth and the six neighbour tiles so the earth and rock layers line up across columns.

import * as THREE from 'three'
import { BIOME, FLAVOURS } from '../../render/palette.ts'
import { PATTERN, type Pattern, type RGB, hash, lin, mix, shade } from './geo.ts'
import { BOTTOM_Y } from './layout.ts'

export class TerrainBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  aux: number[] = []

  tri(a: number[], b: number[], c: number[], ca: RGB, cb: RGB = ca, cc: RGB = ca, pattern: Pattern = 'none') {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    const p = PATTERN[pattern]
    for (const [v, cl] of [[a, ca], [b, cb], [c, cc]] as const) {
      this.pos.push(v[0], v[1], v[2])
      this.nor.push(nx, ny, nz)
      this.col.push(cl[0], cl[1], cl[2])
      this.aux.push(0, 0, p)
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], ca: RGB, cb: RGB = ca, cc: RGB = cb, cd: RGB = ca, pattern: Pattern = 'none') {
    this.tri(a, b, c, ca, cb, cc, pattern)
    this.tri(a, c, d, ca, cc, cd, pattern)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 3))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

const ST = FLAVOURS.strata
const C = {
  earth: lin(ST.ochre),
  rust: lin(ST.rust),
  rockA: lin(ST.umber),
  rockB: lin(ST.plum),
  rockC: lin(ST.deep),
  base: lin(ST.base),
  high: lin(BIOME.mountain.base, 0.92),
  highLight: lin(BIOME.mountain.light),
  snow: lin(BIOME.snow.base),
  sand: lin(BIOME.beach.base),
  wetSand: lin(BIOME.beach.dark),
}

const TURF: Partial<Record<string, string>> = { grass: BIOME.grass.dark, forest: BIOME.forest.dark, plains: BIOME.plains.dark, hills: BIOME.hills.dark }

/** Strata cut heights (world y), shared by all columns. */
const CUTS = [1.6, 0.5, -0.7, -1.7, -2.6]

/** Side colour at height y below a column top at `top`. */
export function sideColor(biome: string, top: number, y: number, jitter: number): RGB {
  const depth = top - y
  if (biome === 'snow') {
    if (depth < 0.16) return shade(C.snow, 0.93)
  } else if (biome === 'mountain') {
    if (depth < 0.1) return shade(C.highLight, 0.9)
  } else if (biome === 'beach') {
    if (depth < 0.42) return shade(C.sand, depth < 0.1 ? 0.9 : 0.8)
  } else if (biome === 'deep' || biome === 'shallow') {
    if (depth < 0.12) return shade(C.wetSand, 0.85)
  } else if (depth < 0.11) {
    return mix(lin(TURF[biome] ?? BIOME.grass.dark, 0.92), lin(ST.turfShadow), 0.35)
  } else if (depth < (biome === 'hills' ? 0.3 : 0.46)) {
    return C.earth
  }
  // painted earth bands by world height, so they line up across neighbouring columns
  const yy = y + jitter
  if (yy > CUTS[0]) return biome === 'mountain' || biome === 'snow' ? C.high : mix(C.rockA, C.earth, 0.3)
  if (yy > CUTS[1]) return mix(C.rockA, C.rust, 0.4)
  if (yy > CUTS[2]) return C.rust
  if (yy > CUTS[3]) return C.rockA
  if (yy > CUTS[4]) return C.rockB
  return C.base
}

/** Smooth value noise in [0, 1). */
export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const h = (a: number, b: number) => hash(a * 7919 + b * 104729, seed)
  return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v
}

const FL = {
  meadow: FLAVOURS.meadow.map((c) => lin(c)),
  plains: FLAVOURS.plains.map((c) => lin(c)),
  forest: FLAVOURS.forest.map((c) => lin(c)),
  hills: FLAVOURS.hills.map((c) => lin(c)),
  beach: FLAVOURS.beach.map((c) => lin(c)),
  rock: FLAVOURS.rock.map((c) => lin(c)),
}

/** Blend smoothly around a list of hues by t (wraps). */
export function flavour(list: RGB[], t: number): RGB {
  const f = (((t % 1) + 1) % 1) * list.length
  const i = Math.floor(f)
  const k = f - i
  const sm = k * k * (3 - 2 * k)
  return mix(list[i % list.length], list[(i + 1) % list.length], sm)
}

/** Ground colour of a biome at a planar point: the hue drifts slowly, as on the world map. */
export function groundFlavour(biome: string, x: number, z: number, moisture = 0.5): RGB {
  const drift = vnoise(x * 0.12, z * 0.12, 3) * 0.7 + vnoise(x * 0.35, z * 0.35, 4) * 0.3
  const j = 1 + (vnoise(x * 1.1, z * 1.1, 5) - 0.5) * 0.06
  let c: RGB
  switch (biome) {
    case 'grass': c = flavour(FL.meadow, drift * 1.6 + moisture * 0.4); break
    case 'plains': c = flavour(FL.plains, drift * 1.4 + moisture * 0.5); break
    case 'forest': c = flavour(FL.forest, drift * 1.5); break
    case 'hills': c = flavour(FL.hills, drift * 1.3); break
    case 'mountain': c = mix(flavour(FL.rock, drift * 1.5), lin(BIOME.mountain.light), 0.2); break
    case 'snow': return lin(BIOME.snow.base)
    case 'beach': c = flavour(FL.beach, drift * 1.6); break
    default: c = flavour(FL.beach, drift); break
  }
  return shade(c, j)
}

export const MEADOWS = FL.meadow

/** Light through sea water loses red first: tint anything below the surface. */
const SCATTER = lin('#2A8F98')
export function submerge(c: RGB, y: number, waterY: number): RGB {
  const d = waterY - y
  if (d <= 0) return c
  const t = [Math.exp(-2.4 * d), Math.exp(-0.7 * d), Math.exp(-0.45 * d)]
  return [c[0] * t[0] + SCATTER[0] * (1 - t[0]), c[1] * t[1] + SCATTER[1] * (1 - t[1]), c[2] * t[2] + SCATTER[2] * (1 - t[2])]
}

/** Corner i of a pointy-top hex of circumradius r, at angle -30 - 60 i (corner i closes edge i). */
export function corner(cx: number, cz: number, r: number, i: number): [number, number] {
  const a = (Math.PI / 180) * (-30 - 60 * i)
  return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]
}
/** The two ends of edge d (outward normal at angle -60 d), by increasing angle. */
export function edgeEnds(cx: number, cz: number, r: number, d: number): [[number, number], [number, number]] {
  const a0 = (Math.PI / 180) * (-60 * d - 30)
  const a1 = (Math.PI / 180) * (-60 * d + 30)
  return [[cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r]]
}

export interface ColumnSpec {
  cx: number
  cz: number
  /** Circumradius. */
  r: number
  biome: string
  /** Top height at a planar point (inside the hex). */
  height: (x: number, z: number) => number
  /** Top colour at a planar point (linear RGB), given its height. */
  color: (x: number, z: number, y: number) => RGB
  pattern: Pattern
  /** Subdivisions along each sector edge (1 for a flat top). */
  sub: number
  /** For each edge 0..5: the top of whatever is across it (BOTTOM_Y when nothing). */
  across: number[]
  /** Sea level for submerged tinting (or null). */
  waterY: number | null
  seed: number
  /** Width/drop of the bevel on the top edge (flat columns only). */
  bevel?: number
}

/** Build one column into `b`. */
export function buildColumn(b: TerrainBuilder, s: ColumnSpec) {
  const { cx, cz, r } = s
  const wy = s.waterY
  const sub = (c: RGB, y: number) => (wy === null ? c : submerge(c, y, wy))
  const bevel = s.sub === 1 ? s.bevel ?? 0.06 : 0
  const inner = r - bevel / (Math.sqrt(3) / 2)
  // Top: six sectors, each subdivided into sub^2 triangles.
  const n = s.sub
  for (let i = 0; i < 6; i++) {
    const [ax, az] = corner(cx, cz, s.sub === 1 ? inner : r, i)
    const [bx, bz] = corner(cx, cz, s.sub === 1 ? inner : r, i + 1)
    // barycentric grid from the centre (row 0) out to the edge (row n)
    const P = (row: number, k: number): number[] => {
      const t = row / n
      const u = row === 0 ? 0 : k / row
      const x = cx + ((ax - cx) * (1 - u) + (bx - cx) * u) * t
      const z = cz + ((az - cz) * (1 - u) + (bz - cz) * u) * t
      return [x, s.height(x, z), z]
    }
    const cache = new Map<string, { p: number[]; c: RGB }>()
    const V = (row: number, k: number) => {
      const key = `${row},${k}`
      let v = cache.get(key)
      if (!v) {
        const p = P(row, k)
        v = { p, c: sub(s.color(p[0], p[2], p[1]), p[1]) }
        cache.set(key, v)
      }
      return v
    }
    for (let row = 0; row < n; row++) {
      for (let k = 0; k <= row; k++) {
        const a = V(row, k), bb = V(row + 1, k), c = V(row + 1, k + 1)
        b.tri(a.p, bb.p, c.p, a.c, bb.c, c.c, s.pattern)
        if (k < row) {
          const d = V(row, k + 1)
          b.tri(a.p, c.p, d.p, a.c, c.c, d.c, s.pattern)
        }
      }
    }
  }
  // Bevel ring for flat tops.
  const y0 = s.height(cx, cz)
  if (bevel > 0) {
    const yb = y0 - bevel * 0.45
    for (let i = 0; i < 6; i++) {
      const [ax, az] = corner(cx, cz, inner, i)
      const [bx, bz] = corner(cx, cz, inner, i + 1)
      const [ox, oz] = corner(cx, cz, r, i)
      const [px, pz] = corner(cx, cz, r, i + 1)
      const c0 = sub(shade(s.color(ax, az, y0), 0.97), y0)
      const c1 = sub(shade(s.color(ox, oz, y0), 1.02), yb)
      b.quad([ax, y0, az], [ox, yb, oz], [px, yb, pz], [bx, y0, bz], c0, c1, c1, c0)
    }
  }
  // Sides.
  const topAt = (x: number, z: number) => (bevel > 0 ? y0 - bevel * 0.45 : s.height(x, z))
  for (let d = 0; d < 6; d++) {
    const [[ax, az], [bx, bz]] = edgeEnds(cx, cz, r, d)
    // down past the neighbour's bevel, so no sliver of sky shows in the seam
    const yBot = Math.max(BOTTOM_Y, s.across[d] - (s.across[d] > BOTTOM_Y + 1e-3 ? 0.05 : 0))
    const steps = s.sub === 1 ? 1 : n
    const jitter = (hash(s.seed, 10 + d) - 0.5) * 0.08
    const rim = s.across[d] <= BOTTOM_Y + 1e-3
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1
      const h0 = topAt(x0, z0), h1 = topAt(x1, z1)
      if (Math.max(h0, h1) - yBot < 0.003) continue
      const hi = Math.max(h0, h1)
      const cuts = new Set<number>([yBot])
      const add = (y: number) => { if (y < hi - 0.004 && y > yBot + 0.004) cuts.add(y) }
      for (const dd of [0.11, 0.16, 0.3, 0.42, 0.46]) add(hi - dd)
      for (const c of CUTS) add(c - jitter)
      if (!rim) add(yBot + 0.45)
      if (wy !== null) for (const w of [wy, wy - 0.15, wy - 0.4, wy - 0.8]) add(w)
      const ys = [...cuts].sort((p, q) => q - p)
      // the top band follows the profile: from the top edge down to the first cut
      const shadeAt = (y: number) => {
        let f = 1
        if (!rim) f *= 1 - 0.4 * Math.max(0, 1 - (y - yBot) / 0.45)
        else f *= 1 - 0.2 * Math.max(0, 1 - (y - BOTTOM_Y) / 0.7)
        return f
      }
      const colAt = (y: number, mid: number) => {
        const c = shade(sideColor(s.biome, hi, mid, jitter), shadeAt(y))
        return !rim && wy !== null ? submerge(c, y, wy) : c
      }
      const first = ys.length > 1 ? ys[1] : yBot
      if (h0 > first || h1 > first) {
        const mid = (Math.min(h0, h1) + first) / 2
        b.quad([x0, h0, z0], [x1, h1, z1], [x1, first, z1], [x0, first, z0], colAt(h0, mid), colAt(h1, mid), colAt(first, mid), colAt(first, mid))
      }
      for (let j = 1; j < ys.length - 1; j++) {
        const yh = ys[j], yl = ys[j + 1]
        const mid = (yh + yl) / 2
        b.quad([x0, yh, z0], [x1, yh, z1], [x1, yl, z1], [x0, yl, z0], colAt(yh, mid), colAt(yh, mid), colAt(yl, mid), colAt(yl, mid))
      }
    }
  }
}
