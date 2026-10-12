// The city plinth: a bevelled hex column at y = 0 with strata on its sides, its outskirts in the
// city tile's own ground, and the cobbled street net running along the seams between the plots,
// with a kerb around the town.

import * as THREE from 'three'
import { BIOME } from '../../render/palette.ts'
import { TerrainBuilder, buildColumn, groundFlavour } from './column.ts'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Kit, type RGB, box, cone, cyl, hash, ico, lin, mix, shade, sphere } from './geo.ts'
import { BOARD_R, BOTTOM_Y, type CityLayout, LOT_IN, SPOTS, SQRT3, STREET_Y, dirAngle } from './layout.ts'

export const GROUND: Record<string, { base: string; light: string; dark: string }> = {
  grass: BIOME.grass, plains: BIOME.plains, forest: BIOME.grass, hills: BIOME.hills, beach: BIOME.beach,
  mountain: BIOME.hills, snow: BIOME.grass, deep: BIOME.grass, shallow: BIOME.grass,
}

export const STREET = '#D8CBB2'
export const KERB = '#B9AA8F'

/** Outline of the 19-plot cluster (unit hexes), by increasing angle around the centre. */
function clusterOutline(): [number, number][] {
  const pts = new Map<string, [number, number]>()
  for (const s of SPOTS) {
    for (const e of s.outEdges) {
      for (const da of [-30, 30]) {
        const a = dirAngle(e) + (da * Math.PI) / 180
        const x = s.x + Math.cos(a), z = s.z + Math.sin(a)
        pts.set(`${x.toFixed(3)},${z.toFixed(3)}`, [x, z])
      }
    }
  }
  return [...pts.values()].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
}

/** Mitered outward offset of a polygon given by increasing angle. */
export function offsetPolygon(pts: [number, number][], d: number): [number, number][] {
  const n = pts.length
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n]
    const n1 = norm([c[1] - p[1], -(c[0] - p[0])])
    const n2 = norm([q[1] - c[1], -(q[0] - c[0])])
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    out.push([c[0] + (n1[0] + n2[0]) * k, c[1] + (n1[1] + n2[1]) * k])
  }
  return out
}

function norm(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}

export const OUTLINE = clusterOutline()
const STREET_OUT = SQRT3 / 2 - LOT_IN
export const STREET_EDGE = offsetPolygon(OUTLINE, STREET_OUT)
export const KERB_EDGE = offsetPolygon(OUTLINE, STREET_OUT + 0.06)

export function groundColor(biome: string, x: number, z: number, _seed: number): RGB {
  const b = biome === 'forest' || biome === 'snow' || biome === 'deep' || biome === 'shallow' ? 'grass' : biome === 'mountain' ? 'hills' : biome
  // the town's own land is a little greener than the wild tile around it
  const own = groundFlavour(b, x * 1.6, z * 1.6, 0.5)
  return b === 'grass' || b === 'beach' ? own : mix(own, groundFlavour('grass', x * 1.6, z * 1.6, 0.6), 0.35)
}

export function buildBoard(layout: CityLayout) {
  const b = new TerrainBuilder()
  const across = layout.neighbours.map((n) => (n.tile === null ? BOTTOM_Y : n.top))
  buildColumn(b, {
    cx: 0, cz: 0, r: BOARD_R, biome: layout.biome === 'beach' ? 'grass' : layout.biome,
    height: () => 0,
    color: (x, z) => groundColor(layout.biome, x, z, 1.3),
    pattern: 'grass', sub: 1, across, waterY: layout.waterY, seed: layout.tile, bevel: 0.07,
  })

  const geo = b.build()
  return { geo }
}

/** Plot and edge (direction) that each street-edge segment of the town outline belongs to. */
const OUTLINE_OWNER: { plot: number }[] = STREET_EDGE.map((a, i) => {
  const b = STREET_EDGE[(i + 1) % STREET_EDGE.length]
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
  let best = 0, bd = Infinity
  for (const sp of SPOTS) if (sp.ring === 2) {
    const d = Math.hypot(sp.x - mx, sp.z - mz)
    if (d < bd) { bd = d; best = sp.index }
  }
  return { plot: best }
})

const PATH = '#D3BF96'

/**
 * The street net. Every plot cell is its lot plus a band of street around it; a band edge is paved
 * once either plot beside it is built on (the square is always paved), otherwise it is a worn path
 * through the grass. So a young town is a hamlet of tracks, and cobbles spread as it grows.
 */
export function buildStreets(layout: CityLayout, built: (plot: number) => boolean): THREE.BufferGeometry {
  const b = new TerrainBuilder()
  const sc = lin(STREET)
  const g = GROUND[layout.biome] ?? BIOME.grass
  const verge = mix(lin(g.base), lin(g.light), 0.2)
  const path = mix(lin(PATH), lin(g.base), 0.18)
  const cobble = (x: number, z: number): RGB => shade(sc, 0.97 + 0.05 * Math.sin(x * 1.3 + z * 0.7))
  const outR = 1 + STREET_OUT / (SQRT3 / 2)
  const plotAtAxial = new Map(SPOTS.map((sp) => [`${Math.round(sp.x * 100)},${Math.round(sp.z * 100)}`, sp.index]))
  const across = (p: number, d: number): number | null => {
    const a = dirAngle(d)
    const x = SPOTS[p].x + Math.cos(a) * SQRT3, z = SPOTS[p].z + Math.sin(a) * SQRT3
    return plotAtAxial.get(`${Math.round(x * 100)},${Math.round(z * 100)}`) ?? null
  }
  const lotR = LOT_IN / (SQRT3 / 2)
  for (const sp of SPOTS) {
    for (let d = 0; d < 6; d++) {
      const q = across(sp.index, d)
      const paved = sp.index === 0 || q === 0 || built(sp.index) || (q !== null && built(q))
      const rIn = sp.index === 0 ? 0.0 : lotR
      const rOut = q === null ? outR : 1
      const a0 = dirAngle(d) - Math.PI / 6, a1 = dirAngle(d) + Math.PI / 6
      const P = (r: number, a: number, y: number) => [sp.x + Math.cos(a) * r, y, sp.z + Math.sin(a) * r]
      const y = paved ? STREET_Y : STREET_Y - 0.004
      const i0 = P(rIn, a0, y), i1 = P(rIn, a1, y), o0 = P(rOut, a0, y), o1 = P(rOut, a1, y)
      if (paved) b.quad(i0, i1, o1, o0, cobble(i0[0], i0[2]), cobble(i1[0], i1[2]), cobble(o1[0], o1[2]), cobble(o0[0], o0[2]), 'cobble')
      else {
        const cO = q === null ? mix(path, verge, 0.45) : path
        b.quad(i0, i1, o1, o0, verge, verge, cO, cO, 'grass')
      }
    }
  }
  // Kerb along the paved parts of the town's edge.
  const kc = lin(KERB)
  const E = STREET_EDGE, K = KERB_EDGE
  const ys = STREET_Y
  for (let i = 0; i < E.length; i++) {
    if (!built(OUTLINE_OWNER[i].plot)) continue
    const a = E[i], c = E[(i + 1) % E.length]
    const ka = K[i], kb = K[(i + 1) % K.length]
    const j = 0.95 + hash(i, 4) * 0.08
    b.quad([a[0], ys + 0.012, a[1]], [c[0], ys + 0.012, c[1]], [kb[0], ys + 0.012, kb[1]], [ka[0], ys + 0.012, ka[1]], shade(kc, j * 1.04), shade(kc, j * 1.04), shade(kc, j), shade(kc, j), 'stone')
    b.quad([ka[0], ys + 0.012, ka[1]], [kb[0], ys + 0.012, kb[1]], [kb[0], -0.002, kb[1]], [ka[0], -0.002, ka[1]], shade(kc, 0.86), shade(kc, 0.86), shade(kc, 0.7), shade(kc, 0.7))
  }
  // Lanterns at some corners of built lots along paved streets.
  const k = new Kit()
  for (const sp of SPOTS) {
    if (sp.index === 0 || !built(sp.index)) continue
    for (let c = 0; c < 6; c++) {
      if (hash(sp.index * 6 + c, 77) > 0.2) continue
      const a = (Math.PI / 180) * (-30 + 60 * c)
      const r = lotR + 0.045
      const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r
      if (Math.hypot(x, z) < 1.25) continue
      k.add(cyl(0.006, 0.009, 0.27, 6), '#4A4B50', { p: [x, STREET_Y + 0.135, z] })
      k.add(cyl(0.014, 0.016, 0.012, 6), '#4A4B50', { p: [x, STREET_Y + 0.006, z] })
      k.add(box(0.028, 0.036, 0.028), '#FFD08A', { p: [x, STREET_Y + 0.29, z] }, { glow: 1.3 })
      k.add(cone(0.025, 0.022, 4), '#4A4B50', { p: [x, STREET_Y + 0.318, z], r: [0, Math.PI / 4, 0] })
    }
  }
  // Benches, flower tubs and the odd cart along the paved edges of built lots.
  const blooms = ['#D9473A', '#A58BD0', '#F2CC4A', '#F6F1E6', '#E86A8A']
  for (const sp of SPOTS) {
    if (sp.index === 0 || !built(sp.index)) continue
    for (let d = 0; d < 6; d++) {
      const roll = hash(sp.index * 6 + d, 91)
      if (roll > 0.26) continue
      const a = dirAngle(d)
      const rr = LOT_IN + 0.045
      const x = sp.x + Math.cos(a) * rr, z = sp.z + Math.sin(a) * rr
      if (Math.hypot(x, z) < 1.3) continue
      const along = -a + Math.PI / 2
      k.group({ p: [x, STREET_Y, z], r: [0, along, 0] }, () => {
        if (roll < 0.1) {
          // a bench with its back to the lot
          k.add(box(0.13, 0.01, 0.035), '#A27850', { p: [0, 0.042, 0] }, { pattern: 'boards' })
          k.add(box(0.13, 0.03, 0.007), '#A27850', { p: [0, 0.065, -0.018] })
          for (const sx of [-1, 1]) k.add(box(0.008, 0.04, 0.03), '#4A4B50', { p: [sx * 0.055, 0.02, 0] })
        } else if (roll < 0.2) {
          // a wooden tub of flowers
          const c = blooms[Math.floor(hash(sp.index, d) * blooms.length)]
          k.add(cyl(0.032, 0.026, 0.04, 8), '#8E5E3B', { p: [0, 0.02, 0] }, { pattern: 'boards' })
          for (let i = 0; i < 5; i++) k.add(ico(0.013, 0), i % 2 ? c : '#6E9A4F', { p: [Math.cos(i * 1.3) * 0.016, 0.05 + (i % 2) * 0.008, Math.sin(i * 1.3) * 0.016] }, { flutter: 0.002 })
        } else {
          // a little hand cart left by the wall
          k.add(box(0.09, 0.02, 0.06), '#9A6B45', { p: [0, 0.04, 0] }, { pattern: 'boards' })
          for (const sz of [-1, 1]) k.add(cyl(0.024, 0.024, 0.008, 10), '#5E3D29', { p: [0, 0.024, sz * 0.034], r: [Math.PI / 2, 0, 0] })
          k.add(box(0.08, 0.005, 0.005), '#5E3D29', { p: [0.08, 0.05, 0], r: [0, 0, 0.25] })
          k.add(sphere(0.02, 6, 4), hash(sp.index, d + 1) < 0.5 ? '#E8902E' : '#7FA850', { p: [-0.01, 0.06, 0] })
        }
      })
    }
  }
  const geo = b.build()
  if (k.empty) return geo
  const lamps = k.build()
  const merged = mergeGeometries([geo, lamps], false)!
  geo.dispose()
  lamps.dispose()
  merged.computeBoundingSphere()
  return merged
}

export function disposeAll(...objs: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[]) {
  for (const o of objs) o.dispose()
}
