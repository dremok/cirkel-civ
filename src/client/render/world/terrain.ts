// The board: one merged, flat-shaded mesh of bevelled hex columns with strata on their sides,
// baked ambient occlusion in the vertex colours, and low-poly crags on the mountains.

import * as THREE from 'three'
import { hexCorner } from '../../../engine/hex.ts'
import type { Biome } from '../../../engine/types.ts'
import { BIOME, FLAVOURS } from '../palette.ts'
import { GeoBuilder, lin, mix3, scale3, type Vec } from './builder.ts'
import { BEVEL_DROP, BEVEL_IN, BOTTOM_Y, WATER_Y, hash01, type Layout } from './layout.ts'
import { patchMaterial } from './shading.ts'

type RGB = [number, number, number]

const ST = FLAVOURS.strata
const C = {
  earth: lin(ST.ochre),
  rust: lin(ST.rust),
  rockA: lin(ST.umber),
  rockB: lin(ST.plum),
  rockC: lin(ST.deep),
  base: lin(ST.base),
  high: lin(BIOME.mountain.base, 0.92),
  highDark: lin(BIOME.mountain.dark),
  highLight: lin(BIOME.mountain.light),
  snow: lin(BIOME.snow.base),
  snowShade: lin(BIOME.snow.dark),
  wetSand: lin(BIOME.beach.dark),
  sand: lin(BIOME.beach.base),
}

/** Unit hex ring: 12 points (corner, edge midpoint, corner, ...) by increasing angle. */
const RING: { x: number; z: number }[] = []
for (let i = 0; i < 6; i++) {
  const a = hexCorner(i)
  const b = hexCorner((i + 1) % 6)
  RING.push(a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
}

/** Smooth value noise in [0, 1] over the board's plane (for colour drifts across tiles). */
function vnoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z)
  const fx = x - xi, fz = z - zi
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const h = (i: number, j: number) => hash01(i * 7919 + j * 104729, seed)
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v
}

const FL = {
  meadow: FLAVOURS.meadow.map((c) => lin(c)),
  plains: FLAVOURS.plains.map((c) => lin(c)),
  forest: FLAVOURS.forest.map((c) => lin(c)),
  hills: FLAVOURS.hills.map((c) => lin(c)),
  beach: FLAVOURS.beach.map((c) => lin(c)),
  rock: FLAVOURS.rock.map((c) => lin(c)),
}

/** Blend through a list of flavours by a 0..1 parameter (smoothly, wrapping). */
function flavour(list: RGB[], t: number): RGB {
  const f = ((t % 1) + 1) % 1 * list.length
  const i = Math.floor(f)
  const k = f - i
  const s = k * k * (3 - 2 * k)
  return mix3(list[i % list.length], list[(i + 1) % list.length], s)
}

/** Top colour of a tile at a world position: hue drifts across the board, varying within tiles. */
function topColorAt(layout: Layout, id: number, x: number, z: number): RGB {
  const t = layout.map.tiles[id]
  const drift = vnoise(x * 0.16, z * 0.16, 3) * 0.7 + vnoise(x * 0.45, z * 0.45, 4) * 0.3
  const local = (vnoise(x * 1.3, z * 1.3, 5) - 0.5) * 0.05
  const j = 1 + (hash01(id, 1) - 0.5) * 0.05 + local
  let c: RGB
  switch (t.biome) {
    case 'grass': c = flavour(FL.meadow, drift * 1.6 + t.moisture * 0.4); break
    case 'plains': c = flavour(FL.plains, drift * 1.4 + t.moisture * 0.5); break
    case 'forest': c = flavour(FL.forest, drift * 1.5); break
    case 'hills': c = flavour(FL.hills, drift * 1.3); break
    case 'mountain': c = mix3(flavour(FL.rock, drift * 1.5), lin(BIOME.mountain.light), 0.25); break
    case 'snow': return lin(BIOME.snow.base)
    case 'beach': c = flavour(FL.beach, drift * 1.6); break
    case 'shallow': c = lin('#E8E2D0', 0.95); break
    default: c = lin('#C9CBBE'); break
  }
  return scale3(c, j)
}

/** Darker band colour just under a tile's top edge (its turf seen from the side). */
function turfSide(layout: Layout, id: number): RGB {
  return scale3(mix3(topColorAt(layout, id, layout.cx[id], layout.cz[id]), lin(FLAVOURS.strata.turfShadow), 0.45), 0.86)
}

/** Colour of a column's side at world height y, for a column whose top is at `top`. */
function sideColor(biome: Biome, top: number, y: number, jitter: number, turf: RGB): RGB {
  const depth = top - y
  const land = biome !== 'deep' && biome !== 'shallow'
  if (land) {
    const turfH = 0.075
    if (biome === 'snow') {
      if (depth < 0.11) return scale3(C.snow, 0.94)
    } else if (biome === 'mountain') {
      if (depth < turfH) return scale3(C.highLight, 0.9)
    } else if (biome === 'beach') {
      if (depth < 0.32) return scale3(C.sand, depth < turfH ? 0.9 : 0.8)
    } else if (depth < turfH) {
      return turf
    } else if (depth < (biome === 'hills' ? 0.18 : 0.28)) {
      return C.earth
    }
  } else if (depth < 0.08) {
    return scale3(C.wetSand, 0.62)
  } else if (y > -1.15) {
    return scale3(C.rockB, 0.85)
  }
  // World-height geology: the same layers line up across neighbouring columns.
  const yy = y + jitter
  if (yy > 0.85) return biome === 'mountain' || biome === 'snow' ? C.high : mix3(C.rockA, C.earth, 0.3)
  if (yy > 0.2) return mix3(C.rockA, C.rust, 0.35)
  if (yy > -0.5) return C.rust
  if (yy > -1.15) return C.rockA
  if (yy > -1.72) return C.rockB
  return C.base
}

const STRATA_CUTS = [0.85, 0.2, -0.5, -1.15, -1.72]

/** Surface kind for the shader's top detail (see shading.ts): 0 meadow, 1 sand, 2 rock, 3 snow,
 * 4 plains, 5 forest floor, 6 hills. */
const DETAIL: Record<Biome, number> = { grass: 0, plains: 4, forest: 5, hills: 6, beach: 1, shallow: 1, deep: 1, mountain: 2, snow: 3 }

/** Light travelling through sea water loses red first: tint anything below the surface. */
const SCATTER = lin('#2A8F98')
function submerge(c: RGB, y: number): RGB {
  const d = WATER_Y - y
  if (d <= 0) return c
  const t = [Math.exp(-3.4 * d), Math.exp(-0.95 * d), Math.exp(-0.6 * d)]
  return [c[0] * t[0] + SCATTER[0] * (1 - t[0]), c[1] * t[1] + SCATTER[1] * (1 - t[1]), c[2] * t[2] + SCATTER[2] * (1 - t[2])]
}

export function buildTerrain(layout: Layout): { mesh: THREE.Mesh; dispose(): void } {
  const b = new GeoBuilder()
  const { map, cx, cz, top, nb } = layout
  const sIn = 1 - BEVEL_IN
  const sMid = 0.58

  for (const t of map.tiles) {
    const id = t.id
    const x0 = cx[id], z0 = cz[id], y0 = top[id]
    const col = topColorAt(layout, id, x0, z0)
    // Colour sampled where each ring vertex sits, so hues drift smoothly across neighbouring tiles.
    const colMid: RGB[] = [], colIn: RGB[] = []
    for (let j = 0; j < 12; j++) {
      colMid.push(topColorAt(layout, id, x0 + RING[j].x * sMid, z0 + RING[j].z * sMid))
      colIn.push(topColorAt(layout, id, x0 + RING[j].x * sIn, z0 + RING[j].z * sIn))
    }
    const turf = turfSide(layout, id)
    b.detail = DETAIL[t.biome]

    // Height of each neighbour's top above ours (for baked occlusion).
    const up = new Float32Array(6)
    for (let i = 0; i < 6; i++) {
      const o = nb[id * 6 + i]
      up[i] = o >= 0 ? Math.max(0, top[o] - y0) : 0
    }
    const aoOf = (d: number) => 1 - 0.36 * Math.min(1, d / 0.55)
    // Beaches darken to wet sand along the waterline.
    const wetEdge = new Float32Array(6)
    if (t.biome === 'beach') for (let i = 0; i < 6; i++) { const o = nb[id * 6 + i]; wetEdge[i] = o >= 0 && layout.water[o] ? 1 : 0 }
    const wetAt = (j: number) => (j % 2 === 1 ? wetEdge[(j - 1) / 2] : Math.max(wetEdge[j / 2], wetEdge[(j / 2 + 5) % 6]) * 0.8)
    const wetC = scale3(C.wetSand, 0.82)
    // AO per ring vertex: corners (even) touch edges i-1 and i, midpoints (odd) edge i.
    const ringAo = new Float32Array(12)
    for (let j = 0; j < 12; j++) {
      if (j % 2 === 1) ringAo[j] = aoOf(up[(j - 1) / 2])
      else {
        const i = j / 2
        ringAo[j] = aoOf(Math.max(up[i], up[(i + 5) % 6]))
      }
    }

    const P = (s: number, j: number, y: number): Vec => [x0 + RING[j].x * s, y, z0 + RING[j].z * s]
    const wet = layout.water[id] === 1
    const yb = y0 - (wet ? 0 : BEVEL_DROP)
    const sw = (c: RGB, y: number) => submerge(c, y)
    const center: Vec = [x0, y0, z0]
    for (let j = 0; j < 12; j++) {
      const k = (j + 1) % 12
      const aoA = (j2: number) => 1 - (1 - ringAo[j2]) * 0.18
      const cA = sw(scale3(mix3(colMid[j], wetC, wetAt(j) * 0.15), aoA(j)), y0), cA2 = sw(scale3(mix3(colMid[k], wetC, wetAt(k) * 0.15), aoA(k)), y0)
      const cB = sw(scale3(mix3(colIn[j], wetC, wetAt(j) * 0.85), ringAo[j]), y0), cB2 = sw(scale3(mix3(colIn[k], wetC, wetAt(k) * 0.85), ringAo[k]), y0)
      b.triN(center, P(sMid, k, y0), P(sMid, j, y0), [0, 1, 0], sw(col, y0), cA2, cA)
      if (wet) {
        b.quad(P(sMid, j, y0), P(sMid, k, y0), P(1, k, y0), P(1, j, y0), cA, cA2, cB2, cB)
        continue
      }
      b.quad(P(sMid, j, y0), P(sMid, k, y0), P(sIn, k, y0), P(sIn, j, y0), cA, cA2, cB2, cB)
      // The bevel: a painted, slightly lighter edge that catches the sun.
      const e1 = scale3(cB, 1.07), e2 = scale3(cB2, 1.07)
      b.quad(P(sIn, j, y0), P(sIn, k, y0), P(1, k, yb), P(1, j, yb), e1, e2, e2, e1)
    }

    // Sides: wherever the neighbour is lower (or off the board), down to its bevel edge.
    for (let i = 0; i < 6; i++) {
      const o = nb[id * 6 + i]
      const rim = o < 0
      const yBot = rim ? BOTTOM_Y : top[o] - (layout.water[o] ? 0 : BEVEL_DROP)
      const yTop = yb
      if (yTop - yBot < 0.002) continue
      const a = hexCorner(i)
      const c = hexCorner((i + 1) % 6)
      const jitter = (hash01(id, 10 + i) - 0.5) * 0.05
      // Band cuts in this face's span.
      const cuts = new Set<number>([yTop, yBot])
      const add = (y: number) => { if (y < yTop - 0.004 && y > yBot + 0.004) cuts.add(y) }
      for (const d of [0.075, 0.11, 0.18, 0.28, 0.32]) add(y0 - d)
      for (const s of STRATA_CUTS) add(s - jitter)
      const footAo = rim ? 0 : 0.3
      if (!rim) add(yBot + footAo)
      add(yTop - 0.03)
      for (const w of [WATER_Y, WATER_Y - 0.12, WATER_Y - 0.3, WATER_Y - 0.6]) add(w)
      const ys = [...cuts].sort((p, q) => q - p)
      for (let k = 0; k < ys.length - 1; k++) {
        const hi = ys[k], lo = ys[k + 1]
        const mid = (hi + lo) / 2
        const bc = sideColor(t.biome, y0, mid, jitter, turf)
        const shade = (y: number) => {
          let s = 1
          if (!rim) s *= 1 - 0.42 * Math.max(0, 1 - (y - yBot) / footAo)
          else s *= 1 - 0.18 * Math.max(0, 1 - (y - BOTTOM_Y) / 0.5)
          // Light catch just under the bevel.
          if (y > yTop - 0.031) s *= 1.04
          return s
        }
        // Only faces fronting the sea are under water (rim faces below the seabed are outside).
        const fronting = !rim && layout.water[o] === 1
        const cHi = fronting ? sw(scale3(bc, shade(hi)), hi) : scale3(bc, shade(hi))
        const cLo = fronting ? sw(scale3(bc, shade(lo)), lo) : scale3(bc, shade(lo))
        b.quad(
          [x0 + a.x, hi, z0 + a.z], [x0 + c.x, hi, z0 + c.z], [x0 + c.x, lo, z0 + c.z], [x0 + a.x, lo, z0 + a.z],
          cHi, cHi, cLo, cLo,
        )
      }
    }

    if (t.biome === 'mountain' || t.biome === 'snow') addCrags(b, layout, id)
  }

  // The underside, so the board reads as a solid object from low angles.
  for (const t of map.tiles) {
    const x0 = cx[t.id], z0 = cz[t.id]
    for (let i = 0; i < 6; i++) {
      const a = hexCorner(i), c = hexCorner((i + 1) % 6)
      b.triN([x0, BOTTOM_Y, z0], [x0 + a.x, BOTTOM_Y, z0 + a.z], [x0 + c.x, BOTTOM_Y, z0 + c.z], [0, -1, 0], C.base)
    }
  }

  const geo = b.build()
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 1 }), { topDetail: true, caustics: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return { mesh, dispose() { geo.dispose(); mat.dispose() } }
}

/** Irregular low-poly rock spires on a mountain column; snow tiles get snow caps. */
function addCrags(b: GeoBuilder, layout: Layout, id: number) {
  const t = layout.map.tiles[id]
  const snowy = t.biome === 'snow'
  const x0 = layout.cx[id], z0 = layout.cz[id], y0 = layout.top[id]
  const r = (k: number) => hash01(id, 100 + k)
  const crags: { x: number; z: number; rad: number; h: number }[] = []
  const main = { a: r(1) * Math.PI * 2, d: r(2) * 0.12 }
  crags.push({ x: Math.cos(main.a) * main.d, z: Math.sin(main.a) * main.d, rad: 0.6 + r(3) * 0.08, h: snowy ? 1.35 + r(4) * 0.3 : 0.85 + r(4) * 0.25 })
  const extra = 2 + (r(5) > 0.6 ? 1 : 0)
  for (let k = 0; k < extra; k++) {
    const a = main.a + Math.PI * (0.7 + k * 0.55) + (r(6 + k) - 0.5) * 0.5
    const d = 0.36 + r(8 + k) * 0.12
    const rad = Math.min(0.3 + r(10 + k) * 0.12, (0.84 - d) / 1.18)
    crags.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad, h: (snowy ? 0.62 : 0.42) + r(12 + k) * 0.22 })
  }
  crags.forEach((cr, ci) => {
    const n = 7
    const seed = id * 7 + ci
    const rr = (k: number) => hash01(seed, 300 + k)
    const cxp = x0 + cr.x, czp = z0 + cr.z, yb = y0 - 0.03
    const rings: Vec[][] = []
    const spec = [
      { f: 0, s: 1 },
      { f: 0.42, s: 0.62 },
      { f: 0.76, s: 0.3 },
    ]
    const rot = rr(0) * Math.PI * 2
    spec.forEach((sp, ri) => {
      const ring: Vec[] = []
      for (let i = 0; i < n; i++) {
        const a = rot + (i + (ri % 2) * 0.5) * (Math.PI * 2 / n) + (rr(10 + ri * 10 + i) - 0.5) * 0.5
        const rad = cr.rad * sp.s * (0.78 + rr(40 + ri * 10 + i) * 0.4)
        const lean = sp.f * 0.12
        ring.push([cxp + Math.cos(a) * rad + lean * Math.cos(rot), yb + cr.h * sp.f * (0.92 + rr(70 + ri * 10 + i) * 0.16), czp + Math.sin(a) * rad + lean * Math.sin(rot)])
      }
      rings.push(ring)
    })
    const apex: Vec = [cxp + Math.cos(rot) * cr.rad * 0.18, yb + cr.h, czp + Math.sin(rot) * cr.rad * 0.18]
    const snowLine = snowy ? 0.38 + rr(90) * 0.12 : (cr.h > 0.75 ? 0.8 : 2)
    const faceColor = (p: Vec[], k: number): RGB => {
      const cy = (p[0][1] + p[1][1] + p[2][1]) / 3
      const f = (cy - yb) / cr.h
      const j = 0.93 + rr(120 + k) * 0.14
      if (f > snowLine + (rr(160 + k) - 0.5) * 0.12) return scale3(mix3(C.snow, C.snowShade, rr(200 + k) * 0.25), 0.98 + rr(240 + k) * 0.04)
      return scale3(mix3(C.highDark, C.highLight, Math.min(1, 0.25 + f * 0.9)), j)
    }
    const axis = (y: number): Vec => [cxp, y, czp]
    let k = 0
    const out = (a: Vec, bb: Vec, c: Vec) => {
      const col = faceColor([a, bb, c], k++)
      const m: Vec = [(a[0] + bb[0] + c[0]) / 3, (a[1] + bb[1] + c[1]) / 3, (a[2] + bb[2] + c[2]) / 3]
      const ax = axis(m[1])
      const hint: Vec = [m[0] - ax[0], 0.35, m[2] - ax[2]]
      triOut(b, a, bb, c, hint, col)
    }
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const A = rings[ri], B = rings[ri + 1]
      const shift = ri % 2 === 0 ? 0 : 1
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n
        if (shift === 0) {
          out(B[i], A[i1], A[i])
          out(B[i], B[i1], A[i1])
        } else {
          out(B[i1], A[i1], A[i])
          out(B[i], B[i1], A[i])
        }
      }
    }
    const L = rings[rings.length - 1]
    for (let i = 0; i < n; i++) out(apex, L[(i + 1) % n], L[i])
  })
}

function triOut(b: GeoBuilder, a: Vec, c1: Vec, c2: Vec, hint: Vec, col: RGB) {
  const ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2]
  const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) b.tri(a, c2, c1, col)
  else b.tri(a, c1, c2, col)
}
