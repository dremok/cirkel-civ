// The six neighbour tiles around the city, at the same scale as the plinth: their biome, their
// height (so a hill rises above the town and the sea lies below it), dense vegetation, crags on
// mountains, a sea with real depth and foam along every shore.

import * as THREE from 'three'
import { BIOME, NATURE } from '../../render/palette.ts'
import type { Biome } from '../../../engine/types.ts'
import { TerrainBuilder, buildColumn, corner, groundFlavour, vnoise } from './column.ts'
import { broadleaf, birch, bush, clover, fern, flowers, log, model, mossyRock, mushroom, oak, pine, reeds, rock, sheep, spruce, tuft, wheat, wildflowers } from './flora.ts'
import { type RGB, hash, lin, mix, rng, shade } from './geo.ts'
import { KERB_EDGE } from './board.ts'
import { BOARD_IN, BOARD_R, BOTTOM_Y, type CityLayout, type Neighbour, hexSdf } from './layout.ts'
import { cityDepthMaterial, cityMaterial } from './mat.ts'

type PropKind = 'pine' | 'spruce' | 'oak' | 'olive' | 'broad' | 'autumn' | 'gold' | 'birch' | 'bush' | 'tuft' | 'dryTuft' | 'flowerA' | 'flowerB' | 'flowerC'
  | 'poppy' | 'lavender' | 'buttercup' | 'daisy' | 'clover' | 'fern' | 'mushroom' | 'log' | 'reeds' | 'wheat' | 'rock' | 'mossRock' | 'sheep'

export interface Placed { kind: PropKind; x: number; y: number; z: number; s: number; rot: number; tint?: number }

function topColor(biome: Biome, x: number, z: number, _seed: number, moisture: number): RGB {
  return groundFlavour(biome, x, z, moisture)
}

/** Centres of the seven columns (city first), for "what is across this edge". */
function centres(layout: CityLayout) {
  return [{ x: 0, z: 0, top: 0, land: true }, ...layout.neighbours.map((n) => ({ x: n.cx, z: n.cz, top: n.tile === null ? BOTTOM_Y : n.top, land: n.tile !== null && !n.water }))]
}

function acrossOf(layout: CityLayout, n: Neighbour): number[] {
  const cs = centres(layout)
  const out: number[] = []
  for (let e = 0; e < 6; e++) {
    const a = (-Math.PI / 3) * e
    const x = n.cx + Math.cos(a) * BOARD_IN * 2, z = n.cz + Math.sin(a) * BOARD_IN * 2
    const hit = cs.find((c) => Math.hypot(c.x - x, c.z - z) < 0.5)
    out.push(hit ? hit.top : BOTTOM_Y)
  }
  return out
}

/** Distance from a point to the nearest land column of the diorama (0 inside land). */
function landDist(layout: CityLayout, x: number, z: number): number {
  let best = Infinity
  for (const c of centres(layout)) if (c.land) best = Math.min(best, hexSdf(x - c.x, z - c.z, BOARD_IN))
  return Math.max(0, best)
}

/** Seabed / ground height inside a neighbour column. */
function heightFn(layout: CityLayout, n: Neighbour): (x: number, z: number) => number {
  const b = n.biome!
  if (n.water) {
    const deep = n.top
    return (x, z) => {
      const d = landDist(layout, x, z)
      const t = THREE.MathUtils.smoothstep(d, 0.0, b === 'deep' ? 3.2 : 2.4)
      return THREE.MathUtils.lerp(layout.waterY - 0.08, deep, t) + (hash(Math.round(x * 3), Math.round(z * 3)) - 0.5) * 0.03
    }
  }
  if (b === 'mountain' || b === 'snow') {
    // scree rising away from the town toward the peaks, broken up by a rocky noise
    const seed = n.tile! * 13 + 7
    return (x, z) => {
      const d = Math.hypot(x, z) - BOARD_IN
      const rise = THREE.MathUtils.smoothstep(d, 0.2, 4.2)
      const rough = vnoise(x * 0.9, z * 0.9, seed) * 0.6 + vnoise(x * 2.3, z * 2.3, seed + 1) * 0.4
      const edge = THREE.MathUtils.smoothstep(-hexSdf(x - n.cx, z - n.cz, BOARD_IN), 0, 0.5)
      return n.top + (rise * (1.1 + rough * 0.6) + rough * 0.14) * edge
    }
  }
  if (b === 'hills') {
    const r = rng(n.tile! * 7 + 1)
    const bumps = Array.from({ length: 4 }, () => ({ x: n.cx + (r() - 0.5) * 6, z: n.cz + (r() - 0.5) * 6, h: 0.35 + r() * 0.45, s: 1.4 + r() * 1.2 }))
    return (x, z) => {
      let h = 0
      for (const bp of bumps) h += bp.h * Math.exp(-((x - bp.x) ** 2 + (z - bp.z) ** 2) / (bp.s * bp.s))
      const edge = THREE.MathUtils.smoothstep(-hexSdf(x - n.cx, z - n.cz, BOARD_IN), 0, 1.6)
      return n.top + h * edge
    }
  }
  return () => n.top
}

function scatter(layout: CityLayout, n: Neighbour, h: (x: number, z: number) => number, density: number): Placed[] {
  const out: Placed[] = []
  const r = rng((n.tile ?? 0) * 131 + 17)
  const spots: { x: number; z: number; r: number }[] = []
  const b = n.biome!
  /** A free spot inside the hex (margin from the edge), or null. */
  const spot = (rad: number, margin = 0.15, tries = 12) => {
    for (let t = 0; t < tries; t++) {
      const x = n.cx + (r() * 2 - 1) * BOARD_R
      const z = n.cz + (r() * 2 - 1) * BOARD_R
      if (hexSdf(x - n.cx, z - n.cz, BOARD_IN) > -margin - rad) continue
      // keep vegetation off the city's outskirts edge so the town stays readable
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < ((s.r + rad) * 0.92) ** 2)) continue
      spots.push({ x, z, r: rad })
      return { x, z }
    }
    return null
  }
  const put = (kind: PropKind, rad: number, s: number, margin = 0.15, tint = 1) => {
    const p = spot(rad, margin)
    if (p) out.push({ kind, x: p.x, z: p.z, y: h(p.x, p.z) - 0.01, s, rot: r() * Math.PI * 2, tint })
    return p
  }
  /** A drift of one kind of small plant around a free spot. */
  const drift = (kind: PropKind, count: number, rad: number, scale = 1) => {
    const c = spot(0.08, 0.25)
    if (!c) return
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d
      if (hexSdf(x - n.cx, z - n.cz, BOARD_IN) > -0.15) continue
      out.push({ kind, x, z, y: h(x, z) - 0.005, s: scale * (0.8 + r() * 0.5), rot: r() * 6.28 })
    }
  }
  const D = (k: number) => Math.round(k * density)
  const shore = (x: number, z: number) => layout.neighbours.some((o) => o.water && o.tile !== null && hexSdf(x - o.cx, z - o.cz, BOARD_IN) < 0.6)
  const crags = b === 'mountain' || b === 'snow'
  if (crags) {
    for (let i = 0; i < D(26); i++) put(r() < 0.6 ? 'mossRock' : 'rock', 0.2, 0.25 + r() * 0.35, 0.1, 0.95 + r() * 0.1)
    if (b === 'mountain') for (let i = 0; i < D(20); i++) put(r() < 0.6 ? 'spruce' : 'pine', 0.18, 0.45 + r() * 0.3, 0.15)
    for (let i = 0; i < D(30); i++) put('dryTuft', 0.05, 0.8 + r() * 0.4)
    for (let i = 0; i < D(4); i++) drift('lavender', 6, 0.3)
  } else if (b === 'forest') {
    // a mixed wood: teal pines and spruce up high, emerald oak, olive and birch lower down, a few in autumn gold and rust
    const piney = n.height >= 4 ? 0.7 : 0.28
    for (let i = 0; i < Math.round(230 * Math.max(0.7, density)); i++) {
      const pineT = r() < piney
      const s = pineT ? 0.75 + r() * 0.5 : 0.7 + r() * 0.45
      const k2 = r()
      const kind: PropKind = pineT ? (k2 < 0.45 ? 'spruce' : 'pine') : k2 < 0.04 ? 'autumn' : k2 < 0.08 ? 'gold' : k2 < 0.2 ? 'birch' : k2 < 0.55 ? 'oak' : k2 < 0.8 ? 'olive' : 'broad'
      put(kind, 0.24 * s, s, 0.2, 0.9 + r() * 0.2)
    }
    for (let i = 0; i < D(40); i++) put(r() < 0.5 ? 'fern' : 'bush', 0.1, 0.9 + r() * 0.5)
    for (let i = 0; i < D(14); i++) put('mushroom', 0.05, 0.9 + r() * 0.5)
    for (let i = 0; i < D(6); i++) put('log', 0.25, 0.9 + r() * 0.4)
    for (let i = 0; i < D(8); i++) put('mossRock', 0.12, 0.14 + r() * 0.16)
    for (let i = 0; i < D(60); i++) put('tuft', 0.05, 0.8 + r() * 0.5)
  } else if (b === 'grass') {
    for (let i = 0; i < D(7); i++) put(r() < 0.3 ? 'birch' : r() < 0.1 ? 'gold' : 'oak', 0.3, 0.6 + r() * 0.35, 0.3)
    for (let i = 0; i < D(10); i++) put('bush', 0.12, 0.8 + r() * 0.5)
    for (let i = 0; i < D(5); i++) put('sheep', 0.2, 1 + r() * 0.15, 0.6)
    for (let i = 0; i < D(140); i++) put('tuft', 0.05, 0.8 + r() * 0.6)
    // wildflowers come in drifts: poppy, lavender, buttercup, daisy
    const kinds: PropKind[] = ['poppy', 'lavender', 'buttercup', 'daisy']
    for (let i = 0; i < D(16); i++) drift(kinds[Math.floor(r() * 4)], 5 + Math.floor(r() * 5), 0.35)
    for (let i = 0; i < D(12); i++) drift('clover', 3, 0.2)
  } else if (b === 'plains') {
    for (let i = 0; i < D(150); i++) put('wheat', 0.09, 0.9 + r() * 0.5)
    for (let i = 0; i < D(50); i++) put('dryTuft', 0.05, 0.8 + r() * 0.5)
    for (let i = 0; i < D(6); i++) drift('poppy', 6, 0.3)
    for (let i = 0; i < D(3); i++) drift('buttercup', 5, 0.3)
    for (let i = 0; i < D(6); i++) put('mossRock', 0.1, 0.12 + r() * 0.12)
    for (let i = 0; i < D(2); i++) put('gold', 0.3, 0.6 + r() * 0.3, 0.4)
  } else if (b === 'hills') {
    for (let i = 0; i < D(18); i++) put(r() < 0.6 ? 'mossRock' : 'rock', 0.18, 0.16 + r() * 0.3)
    for (let i = 0; i < D(14); i++) put(r() < 0.5 ? 'spruce' : 'pine', 0.22, 0.6 + r() * 0.35)
    for (let i = 0; i < D(12); i++) put('bush', 0.1, 0.8 + r() * 0.4)
    for (let i = 0; i < D(80); i++) put('dryTuft', 0.05, 0.8 + r() * 0.5)
    for (let i = 0; i < D(8); i++) drift('lavender', 7, 0.4)
  } else if (b === 'beach') {
    for (let i = 0; i < D(10); i++) put('mossRock', 0.12, 0.1 + r() * 0.18)
    for (let i = 0; i < D(40); i++) put('dryTuft', 0.05, 0.7 + r() * 0.4)
    for (let i = 0; i < D(30); i++) { const p = spot(0.06, 0.1); if (p && shore(p.x, p.z)) out.push({ kind: 'reeds', x: p.x, z: p.z, y: h(p.x, p.z) - 0.01, s: 0.9 + r() * 0.5, rot: r() * 6.28 }) }
  } else if (n.water) {
    // rocks and reeds in the shallows, just breaking the surface near the shore
    for (let i = 0; i < D(40); i++) {
      const p = spot(0.08, 0.3)
      if (!p) continue
      const dl = landDist(layout, p.x, p.z)
      if (dl > 1.4) continue
      if (dl < 0.5 && r() < 0.7) out.push({ kind: 'reeds', x: p.x, z: p.z, y: layout.waterY - 0.06, s: 1 + r() * 0.5, rot: r() * 6.28 })
      else if (i % 4 === 0) out.push({ kind: 'mossRock', x: p.x, z: p.z, y: h(p.x, p.z), s: 0.25 + r() * 0.25, rot: r() * 6.28 })
    }
  }
  return out
}

/** Sparse greenery on the town's own land outside the streets: tufts and flowers, and a few trees
 * and bushes in the wide corners of the plinth (unless a harbour may need the shore there). */
function scatterOutskirts(layout: CityLayout): Placed[] {
  const out: Placed[] = []
  const r = rng(layout.tile * 977 + 5)
  const poly = KERB_EDGE
  const inside = (x: number, z: number) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j]
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
    }
    return c
  }
  const nearTown = (x: number, z: number, m: number) => {
    if (inside(x, z)) return true
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]
      const dx = bx - ax, dz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < m) return true
    }
    return false
  }
  const b = layout.biome
  const small: PropKind[] = b === 'plains' ? ['wheat', 'dryTuft', 'wheat', 'poppy'] : b === 'beach' ? ['dryTuft'] : b === 'hills' ? ['dryTuft', 'tuft', 'lavender'] : ['tuft', 'tuft', 'clover', 'poppy', 'lavender', 'buttercup', 'daisy']
  for (let i = 0; i < 220; i++) {
    const x = (r() * 2 - 1) * BOARD_R, z = (r() * 2 - 1) * BOARD_R
    if (hexSdf(x, z, BOARD_IN) > -0.15) continue
    if (nearTown(x, z, 0.32)) continue
    out.push({ kind: small[Math.floor(r() * small.length)], x, y: -0.005, z, s: 0.7 + r() * 0.5, rot: r() * 6.28 })
  }
  for (let c = 0; c < 6; c++) {
    // side plot at this corner faces directions c and c + 1
    const wet = [c, (c + 1) % 6].some((d) => layout.neighbours[d].water)
    if (wet || b === 'beach') continue
    const a = (-Math.PI / 3) * c - Math.PI / 6
    const n = 1 + Math.floor(r() * 2.5)
    for (let i = 0; i < n; i++) {
      const d = 4.55 + r() * 0.5, aa = a + (r() - 0.5) * 0.18
      const x = Math.cos(aa) * d, z = Math.sin(aa) * d
      if (hexSdf(x, z, BOARD_IN) > -0.3 || nearTown(x, z, 0.5)) continue
      const kind: PropKind = b === 'hills' ? (r() < 0.6 ? 'spruce' : 'mossRock') : r() < 0.3 ? 'bush' : r() < 0.45 ? 'birch' : r() < 0.6 ? 'gold' : 'oak'
      out.push({ kind, x, y: -0.01, z, s: kind === 'bush' ? 1.1 + r() * 0.4 : kind === 'mossRock' ? 0.2 + r() * 0.2 : 0.55 + r() * 0.25, rot: r() * 6.28 })
    }
  }
  return out
}

/** Big low-poly crags on mountain and snow neighbours. */
function addCrags(b: TerrainBuilder, n: Neighbour) {
  const snowy = n.biome === 'snow'
  const r = rng(n.tile! * 977 + 3)
  const hi = lin(BIOME.mountain.light), dk = lin(BIOME.mountain.dark), snow = lin(BIOME.snow.base), snowShade = lin(BIOME.snow.dark)
  // Peaks behind the town lean in close and tower over it; peaks in front of the default view stay
  // lower and further out so they never hide the streets.
  const front = n.cz > 1
  const ux = -n.cx / Math.hypot(n.cx, n.cz), uz = -n.cz / Math.hypot(n.cx, n.cz)
  const pull = front ? -0.6 : 1.5
  const hk = front ? 0.62 : 1
  const peaks = [{ x: ux * pull + (r() - 0.5) * 1.2, z: uz * pull + (r() - 0.5) * 1.2, rad: 2.5 + r() * 0.5, h: (snowy ? 4.6 + r() * 1.2 : 3.2 + r() * 1.0) * hk }]
  const extra = 2 + Math.floor(r() * 2)
  for (let i = 0; i < extra; i++) {
    const a = r() * Math.PI * 2, d = 2.2 + r() * 1.2
    peaks.push({ x: ux * pull * 0.5 + Math.cos(a) * d, z: uz * pull * 0.5 + Math.sin(a) * d, rad: 1.2 + r() * 0.7, h: ((snowy ? 2.2 : 1.6) + r() * 1.2) * hk })
  }
  peaks.forEach((pk, pi) => {
    const nSeg = 8
    const cx = n.cx + pk.x, cz = n.cz + pk.z, yb = n.top - 0.05
    const spec = [{ f: 0, s: 1 }, { f: 0.38, s: 0.66 }, { f: 0.7, s: 0.34 }]
    const rot = r() * Math.PI * 2
    const rings = spec.map((sp, ri) => {
      const ring: number[][] = []
      for (let i = 0; i < nSeg; i++) {
        const a = rot + (i + (ri % 2) * 0.5) * ((Math.PI * 2) / nSeg) + (hash(pi * 100 + ri * 10 + i, 1) - 0.5) * 0.5
        const rad = pk.rad * sp.s * (0.78 + hash(pi * 100 + ri * 10 + i, 2) * 0.4)
        ring.push([cx + Math.cos(a) * rad, yb + pk.h * sp.f * (0.92 + hash(pi * 100 + ri * 10 + i, 3) * 0.16), cz + Math.sin(a) * rad])
      }
      return ring
    })
    const apex = [cx + Math.cos(rot) * pk.rad * 0.15, yb + pk.h, cz + Math.sin(rot) * pk.rad * 0.15]
    const snowLine = snowy ? 0.4 + r() * 0.1 : pk.h > 3.4 ? 0.78 : 2
    let k = 0
    const face = (a: number[], bb: number[], c: number[]) => {
      const cy = (a[1] + bb[1] + c[1]) / 3
      const f = (cy - yb) / pk.h
      const j = 0.92 + hash(pi * 1000 + k, 7) * 0.16
      k++
      const col = f > snowLine + (hash(pi * 1000 + k, 8) - 0.5) * 0.12
        ? shade(mix(snow, snowShade, hash(k, 9) * 0.25), 0.98 + hash(k, 10) * 0.04)
        : shade(mix(dk, hi, Math.min(1, 0.25 + f * 0.9)), j)
      // orient outward from the peak axis
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2]
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const mx = (a[0] + bb[0] + c[0]) / 3 - cx, mz = (a[2] + bb[2] + c[2]) / 3 - cz
      if (nx * mx + ny * 0.35 + nz * mz < 0) b.tri(a, c, bb, col)
      else b.tri(a, bb, c, col)
    }
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const A = rings[ri], B = rings[ri + 1]
      for (let i = 0; i < nSeg; i++) {
        const i1 = (i + 1) % nSeg
        if (ri % 2 === 0) { face(B[i], A[i1], A[i]); face(B[i], B[i1], A[i1]) } else { face(B[i1], A[i1], A[i]); face(B[i], B[i1], A[i]) }
      }
    }
    const L = rings[rings.length - 1]
    for (let i = 0; i < nSeg; i++) face(apex, L[(i + 1) % nSeg], L[i])
  })
}

export interface Land {
  group: THREE.Group
  /** Sheep etc. that move. */
  update(dt: number, time: number): void
  dispose(): void
}

export function buildLand(layout: CityLayout, density = 1): Land {
  const group = new THREE.Group()
  group.name = 'land'
  const b = new TerrainBuilder()
  const placed: Placed[] = []
  for (const n of layout.neighbours) {
    if (n.tile === null || !n.biome) continue
    const h = heightFn(layout, n)
    buildColumn(b, {
      cx: n.cx, cz: n.cz, r: BOARD_R, biome: n.biome,
      height: h,
      color: (x, z, y) => {
        let c = topColor(n.biome!, x, z, n.tile! * 0.37, n.moisture)
        if (n.water) c = mix(lin(BIOME.beach.base), lin(BIOME.beach.dark), THREE.MathUtils.clamp((layout.waterY - y) * 1.5, 0, 1))
        return c
      },
      pattern: n.water ? 'sand' : n.biome === 'beach' ? 'sand' : 'grass',
      sub: n.water || n.biome === 'hills' || n.biome === 'mountain' || n.biome === 'snow' ? 14 : 1,
      across: acrossOf(layout, n), waterY: layout.waterY, seed: n.tile!, bevel: 0.07,
    })
    if (n.biome === 'mountain' || n.biome === 'snow') addCrags(b, n)
    placed.push(...scatter(layout, n, h, density))
  }
  placed.push(...scatterOutskirts(layout))
  const geo = b.build()
  const mat = cityMaterial()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'land-columns'
  group.add(mesh)

  // Instanced vegetation.
  const geos: Record<PropKind, THREE.BufferGeometry> = {
    pine: model((k) => pine(k)),
    spruce: model((k) => spruce(k)),
    oak: model((k) => oak(k)),
    olive: model((k) => oak(k, NATURE.olive, NATURE.oliveLight, 5)),
    broad: model((k) => broadleaf(k)),
    autumn: model((k) => broadleaf(k, NATURE.rust, NATURE.amber, 4)),
    gold: model((k) => oak(k, NATURE.gold, NATURE.goldLight, 8)),
    poppy: model((k) => wildflowers(k, NATURE.poppy, 1)),
    lavender: model((k) => wildflowers(k, NATURE.lavender, 2)),
    buttercup: model((k) => wildflowers(k, NATURE.buttercup, 3)),
    daisy: model((k) => wildflowers(k, NATURE.daisy, 4)),
    clover: model((k) => clover(k)),
    fern: model((k) => fern(k)),
    mushroom: model((k) => mushroom(k)),
    log: model((k) => log(k)),
    reeds: model((k) => reeds(k)),
    mossRock: model((k) => mossyRock(k, 5)),
    birch: model((k) => birch(k)),
    bush: model((k) => bush(k, BIOME.forest.base, 7)),
    tuft: model((k) => tuft(k)),
    dryTuft: model((k) => tuft(k, lin(BIOME.plains.dark, 0.9), lin(BIOME.plains.light))),
    flowerA: model((k) => flowers(k, NATURE.flowerA)),
    flowerB: model((k) => flowers(k, NATURE.flowerB)),
    flowerC: model((k) => flowers(k, NATURE.flowerC)),
    wheat: model((k) => wheat(k)),
    rock: model((k) => rock(k, 3)),
    sheep: model((k) => sheep(k)),
  }
  const vegMat = cityMaterial()
  const depth = cityDepthMaterial()
  // Split each kind into what lies within the sun's shadow frustum (casts shadows) and what lies
  // beyond it (seen only from afar, so it can skip the shadow pass).
  const NEAR = 8.6
  const byKind = new Map<string, Placed[]>()
  for (const p of placed) {
    const key = `${p.kind}|${Math.hypot(p.x, p.z) < NEAR ? 'near' : 'far'}`
    let l = byKind.get(key)
    if (!l) byKind.set(key, (l = []))
    l.push(p)
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0)
  const sheepList: { p: Placed; idx: number; mesh: THREE.InstancedMesh; seed: number }[] = []
  for (const [key, list] of byKind) {
    const [k0, zone] = key.split('|')
    const kind = k0 as PropKind
    const im = new THREE.InstancedMesh(geos[kind], vegMat, list.length)
    im.name = `land-${key}`
    const big = kind === 'pine' || kind === 'spruce' || kind === 'oak' || kind === 'olive' || kind === 'gold' || kind === 'broad' || kind === 'autumn' || kind === 'birch' || kind === 'rock' || kind === 'mossRock' || kind === 'sheep' || kind === 'bush' || kind === 'log'
    im.castShadow = big && zone === 'near'
    im.receiveShadow = true
    if (big && kind !== 'rock' && kind !== 'mossRock' && kind !== 'log') im.customDepthMaterial = depth
    list.forEach((p, i) => {
      m4.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rot), s.setScalar(p.s))
      im.setMatrixAt(i, m4)
      im.setColorAt(i, c.setScalar(p.tint ?? 1))
      if (kind === 'sheep') sheepList.push({ p, idx: i, mesh: im, seed: i * 7 + 1 })
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    group.add(im)
  }

  const water = buildSea(layout)
  if (water) group.add(water.surface, water.rim)

  return {
    group,
    update(_dt, time) {
      // sheep graze: drift slowly, turning now and then
      let dirty: THREE.InstancedMesh | null = null
      for (const sh of sheepList) {
        const t = time * 0.05 + sh.seed
        const x = sh.p.x + Math.sin(t) * 0.25, z = sh.p.z + Math.cos(t * 0.8) * 0.2
        const vx = Math.cos(t) * 0.25, vz = -Math.sin(t * 0.8) * 0.16
        const rot = Math.atan2(-vz, vx) + Math.sin(time * 0.3 + sh.seed) * 0.3
        m4.compose(v.set(x, sh.p.y + Math.abs(Math.sin(time * 1.3 + sh.seed)) * 0.004, z), q.setFromAxisAngle(up, rot), s.setScalar(sh.p.s))
        sh.mesh.setMatrixAt(sh.idx, m4)
        dirty = sh.mesh
      }
      if (dirty) dirty.instanceMatrix.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      vegMat.dispose()
      depth.dispose()
      for (const g of Object.values(geos)) g.dispose()
      group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose() })
      water?.dispose()
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The sea: one translucent surface over every water neighbour, coloured by depth, with foam along
// the shores (computed per fragment from the land columns) and glassy walls at the rim.

function buildSea(layout: CityLayout) {
  const wet = layout.neighbours.filter((n) => n.water && n.tile !== null)
  if (!wet.length) return null
  const y = layout.waterY
  const pos: number[] = []
  for (const n of wet) {
    for (let i = 0; i < 6; i++) {
      const [ax, az] = corner(n.cx, n.cz, BOARD_R, i)
      const [bx, bz] = corner(n.cx, n.cz, BOARD_R, i + 1)
      pos.push(n.cx, y, n.cz, ax, y, az, bx, y, bz)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(pos.map(() => 1), 3))
  geo.setAttribute('aux', new THREE.Float32BufferAttribute(pos.map(() => 0), 3))
  geo.computeBoundingSphere()

  const cs = centres(layout)
  const land = cs.map((c, i) => new THREE.Vector3(c.x, c.z, c.land ? 1 : i > 0 && layout.neighbours[i - 1].biome === 'deep' ? -1 : 0))
  const uniforms = {
    uLand: { value: land },
    uShallow: { value: new THREE.Color(BIOME.shallow.light) },
    uMid: { value: new THREE.Color(BIOME.shallow.base) },
    uDeep: { value: new THREE.Color(BIOME.deep.base) },
    uFoam: { value: new THREE.Color(NATURE.foam) },
    uIn: { value: BOARD_IN },
  }
  const mat = cityMaterial({
    transparent: true, roughness: 0.06, key: 'sea', still: true,
    extra(shader) {
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
uniform vec3 uLand[7];
uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uFoam; uniform float uIn;
float sHex(vec2 p, float r) {
  p = abs(p.yx);
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735027);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        float shore = 99.0; float deepK = 0.0; float bestC = 99.0;
        for (int i = 0; i < 7; i++) {
          vec2 d = vWorldP.xz - uLand[i].xy;
          if (uLand[i].z > 0.5) shore = min(shore, max(0.0, sHex(d, uIn)));
          float cd = dot(d, d);
          if (cd < bestC) { bestC = cd; deepK = uLand[i].z < -0.5 ? 1.0 : 0.0; }
        }
        float depth = smoothstep(0.0, mix(2.4, 3.2, deepK), shore) * mix(0.55, 1.2, deepK);
        vec3 wCol = mix(uShallow, uMid, smoothstep(0.02, 0.35, depth));
        wCol = mix(wCol, uDeep, smoothstep(0.35, 1.1, depth));
        float wAlpha = mix(0.25, 0.9, smoothstep(0.03, 1.0, depth));
        float wN = cNoise(vWorldP.xz * 1.6 + vec2(uTime * 0.09, -uTime * 0.07));
        float wN2 = cNoise(vWorldP.xz * 3.5 - vec2(uTime * 0.05, uTime * 0.08));
        float wEdge = 1.0 - smoothstep(0.03, 0.08 + 0.07 * wN, shore);
        float wWave = sin(shore * 9.0 - uTime * 1.1 + wN * 2.5);
        float wBand = smoothstep(0.62, 0.95, wWave * 0.5 + 0.5) * (1.0 - smoothstep(0.1, 0.6, shore)) * smoothstep(0.35, 0.62, wN2);
        float wFoam = clamp(wEdge + wBand * 0.5, 0.0, 1.0);
        diffuseColor.rgb = mix(wCol, uFoam, wFoam);
        diffuseColor.a = mix(wAlpha, 1.0, wFoam);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoam);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // sun glints: tiny bright sparkles drifting on the open water (the bloom makes them glow)
          vec2 gp = vWorldP.xz;
          float g1 = cNoise(gp * 9.0 + vec2(uTime * 0.6, -uTime * 0.4));
          float g2 = cNoise(gp * 14.0 - vec2(uTime * 0.5, uTime * 0.7));
          float glint = smoothstep(0.86, 0.98, g1) * smoothstep(0.8, 0.97, g2) * (1.0 - wFoam) * smoothstep(0.1, 0.6, shore);
          totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * glint * 2.6;
        }`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec2 p = vWorldP.xz; float t = uTime; vec2 g = vec2(0.0);
          g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.6 + t * 1.0) * 0.05;
          g += vec2(-0.47, 0.88) * cos(dot(p, vec2(-0.47, 0.88)) * 2.6 + t * 1.3) * 0.035;
          g += vec2(0.96, -0.28) * cos(dot(p, vec2(0.96, -0.28)) * 4.4 + t * 1.8) * 0.022;
          vec2 q = p * 1.5 + vec2(t * 0.08, t * 0.05);
          float e = 0.08; float n0 = cNoise(q);
          g += vec2(cNoise(q + vec2(e, 0.0)) - n0, cNoise(q + vec2(0.0, e)) - n0) / e * 0.03;
          g *= 1.0 - wFoam * 0.7;
          vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
        .replace('#include <opaque_fragment>', /* glsl */ `{
          vec3 wSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
          float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 5.0);
          float a = clamp(diffuseColor.a + fres * 0.25, 0.0, 1.0);
          outgoingLight = outgoingLight - wSpec + wSpec / max(a, 0.5);
          diffuseColor.a = a;
        }
        #include <opaque_fragment>`)
    },
  })
  mat.depthWrite = false
  const surface = new THREE.Mesh(geo, mat)
  surface.receiveShadow = true
  surface.renderOrder = 2
  surface.name = 'sea'
  surface.userData.treatAsOpaque = true

  // Rim walls where the sea meets the edge of the diorama.
  const rb = new TerrainBuilder()
  const cTop = mix(lin(BIOME.shallow.base), lin(BIOME.deep.light), 0.5)
  const cBot = lin(BIOME.deep.dark)
  const lip = lin('#CBEDE6')
  for (const n of wet) {
    const across = acrossOf(layout, n)
    for (let e = 0; e < 6; e++) {
      if (across[e] > BOTTOM_Y + 1e-3) continue
      const a0 = (-Math.PI / 3) * e - Math.PI / 6, a1 = (-Math.PI / 3) * e + Math.PI / 6
      const ax = n.cx + Math.cos(a0) * BOARD_R, az = n.cz + Math.sin(a0) * BOARD_R
      const bx = n.cx + Math.cos(a1) * BOARD_R, bz = n.cz + Math.sin(a1) * BOARD_R
      const yl = y - 0.03
      rb.quad([ax, y, az], [bx, y, bz], [bx, yl, bz], [ax, yl, az], lip)
      rb.quad([ax, yl, az], [bx, yl, bz], [bx, n.top, bz], [ax, n.top, az], cTop, cTop, mix(cTop, cBot, 0.8), mix(cTop, cBot, 0.8))
    }
  }
  const rgeo = rb.build()
  const rmat = cityMaterial({ transparent: true, opacity: 0.72, roughness: 0.18, key: 'rim', still: true })
  rmat.depthWrite = false
  const rim = new THREE.Mesh(rgeo, rmat)
  rim.renderOrder = 3
  rim.name = 'sea-rim'
  rim.userData.treatAsOpaque = true
  return {
    surface, rim,
    dispose() { geo.dispose(); mat.dispose(); rgeo.dispose(); rmat.dispose() },
  }
}
