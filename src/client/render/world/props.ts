// Instanced vegetation and props. Forests mix teal pines and spruces, emerald and olive oaks,
// birches and a few gold and rust autumn trees, with ferns, mushrooms and the odd mossy log beneath.
// Meadows get tufts, clover and drifts of wildflowers; plains get wheat stooks; hills mossy boulders;
// beaches reeds along the water. The centre of every tile stays clear for the pieces.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WorldQuality } from '../api.ts'
import { BIOME, NATURE } from '../palette.ts'
import { lin, mix3 } from './builder.ts'
import { WATER_Y, hash01, hexSdf, type Layout } from './layout.ts'
import { patchMaterial, windDepthMaterial } from './shading.ts'

type Kind =
  | 'pine' | 'oak' | 'olive' | 'birch' | 'gold' | 'rust' | 'bush'
  | 'fern' | 'mushroom' | 'log' | 'reed'
  | 'poppy' | 'lavender' | 'buttercup' | 'daisy' | 'clover' | 'tuft' | 'wheat'
  | 'rock' | 'stone' | 'lily' | 'blob'

type RGB = [number, number, number]

interface Prop {
  tile: number
  m: THREE.Matrix4
  c: THREE.Color
}

/** Sway amplitude (0 = rigid). */
const WIND: Record<Kind, number> = {
  pine: 0.02, oak: 0.024, olive: 0.024, birch: 0.03, gold: 0.024, rust: 0.024, bush: 0.012,
  fern: 0.02, mushroom: 0, log: 0, reed: 0.04,
  poppy: 0.016, lavender: 0.016, buttercup: 0.016, daisy: 0.016, clover: 0, tuft: 0.018, wheat: 0.026,
  rock: 0, stone: 0, lily: 0, blob: 0,
}
/** Soft contact shadow radius under a prop, relative to its scale (0 = none). */
const BLOB: Partial<Record<Kind, number>> = { pine: 0.4, oak: 0.5, olive: 0.5, birch: 0.36, gold: 0.5, rust: 0.5, bush: 0.5, log: 0.55, wheat: 0.34, rock: 0.62 }
/** Kinds that cast shadows (small ground cover does not). */
const CASTS = new Set<Kind>(['pine', 'oak', 'olive', 'birch', 'gold', 'rust', 'bush', 'log', 'wheat', 'rock', 'reed'])
/** Foliage: sunlight glows softly through it. */
const LEAFY = new Set<Kind>(['pine', 'oak', 'olive', 'birch', 'gold', 'rust', 'bush', 'fern', 'reed', 'tuft', 'wheat'])
/** Thin, flat parts seen from both sides. */
const TWO_SIDED = new Set<Kind>(['fern', 'lily'])

// ------------------------------------------------------------------------------------------------
// Geometry (authored with the base at y = 0 and about 1 unit tall, coloured per vertex).

function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, ny: number) => RGB): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g
  ng.computeVertexNormals()
  const p = ng.attributes.position, n = ng.attributes.normal
  const col = new Float32Array(p.count * 3)
  // One colour per face (flat), from the face centroid.
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3
    const c = fn(x, y, z, ny)
    for (let k = 0; k < 3; k++) col.set(c, (i + k) * 3)
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3))
  ng.deleteAttribute('uv')
  return ng
}

function jitter(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position
  // Move coincident vertices together so the surface stays closed.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const h = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791
    p.setXYZ(i, x + (hash01(h, seed) - 0.5) * amt, y + (hash01(h, seed + 1) - 0.5) * amt, z + (hash01(h, seed + 2) - 0.5) * amt)
  }
  return g
}

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

function trunk(r0: number, r1: number, h: number, color: RGB, seg = 6): THREE.BufferGeometry {
  const t = new THREE.CylinderGeometry(r1, r0, h, seg, 1)
  t.translate(0, h / 2, 0)
  return paint(t, (_x, _y, _z, ny) => shade(color, ny > 0.5 ? 1.1 : 1))
}

/** A teal pine: four drooping, slightly ragged tiers on a short trunk. */
function pineGeometry(): THREE.BufferGeometry {
  const dark = lin(NATURE.pineTeal), light = lin(NATURE.pineTealLight)
  const parts = [trunk(0.05, 0.035, 0.3, lin(NATURE.trunk))]
  const tiers = [
    { r: 0.36, y0: 0.14, y1: 0.48 },
    { r: 0.3, y0: 0.32, y1: 0.66 },
    { r: 0.23, y0: 0.5, y1: 0.84 },
    { r: 0.15, y0: 0.68, y1: 1.02 },
  ]
  tiers.forEach((t, i) => {
    const cone = new THREE.ConeGeometry(t.r, t.y1 - t.y0, 9, 1, true)
    // Droop the rim a little and close the underside with a shallow cone.
    const under = new THREE.ConeGeometry(t.r, 0.06, 9, 1)
    under.rotateX(Math.PI)
    under.translate(0, -(t.y1 - t.y0) / 2 + 0.03, 0)
    const tier = mergeGeometries([cone.toNonIndexed(), under.toNonIndexed()])
    jitter(tier, 0.05, 20 + i)
    tier.rotateY(i * 0.7)
    tier.translate(0, (t.y0 + t.y1) / 2, 0)
    parts.push(paint(tier, (_x, y, _z, ny) => {
      if (ny < -0.3) return shade(dark, 0.62)
      const k = THREE.MathUtils.clamp((y - t.y0) / (t.y1 - t.y0), 0, 1)
      return mix3(dark, light, 0.15 + i * 0.16 + k * 0.25)
    }))
  })
  return mergeGeometries(parts)
}

/** A broadleaf tree: forked trunk and a layered canopy of soft faceted clumps. */
function broadGeometry(canopy: string, canopyLight: string, seed: number, form: 'round' | 'tall' = 'round'): THREE.BufferGeometry {
  const bark = lin(NATURE.trunk)
  const c0 = lin(canopy), c1 = lin(canopyLight)
  const parts = [trunk(0.065, 0.04, 0.46, bark)]
  // Two branches reaching into the canopy.
  for (const [a, lean] of [[0.4, 0.55], [3.4, 0.5]] as const) {
    const b = new THREE.CylinderGeometry(0.018, 0.03, 0.3, 5, 1)
    b.translate(0, 0.15, 0)
    b.rotateZ(lean)
    b.rotateY(a)
    b.translate(0, 0.36, 0)
    parts.push(paint(b, () => bark))
  }
  const tall = form === 'tall'
  const clumps = [
    { r: 0.27, x: 0, y: tall ? 0.86 : 0.74, z: 0 },
    { r: 0.24, x: 0.2, y: 0.6, z: 0.08 },
    { r: 0.22, x: -0.17, y: 0.6, z: -0.12 },
    { r: 0.2, x: 0.02, y: 0.58, z: 0.22 },
    { r: 0.19, x: -0.05, y: tall ? 1.02 : 0.9, z: -0.05 },
  ]
  clumps.forEach((cl, i) => {
    const ico = new THREE.IcosahedronGeometry(cl.r, 1)
    jitter(ico, cl.r * 0.28, seed + i * 3)
    ico.scale(1, 0.86, 1)
    ico.translate(cl.x * (tall ? 0.7 : 1), cl.y, cl.z * (tall ? 0.7 : 1))
    parts.push(paint(ico, (_x, y, _z, ny) => {
      // Lit tops, shaded undersides, inner clumps a touch darker.
      const t = THREE.MathUtils.clamp(0.4 + ny * 0.42 + (y - 0.65) * 0.5, 0, 1)
      return shade(mix3(c0, c1, t), ny < -0.4 ? 0.72 : 1)
    }))
  })
  return mergeGeometries(parts)
}

/** A birch: slender pale trunk with dark marks and a small airy canopy. */
function birchGeometry(): THREE.BufferGeometry {
  const bark = lin(NATURE.birchBark), mark = lin('#3E3A38')
  const c0 = lin(NATURE.birch), c1 = lin(NATURE.birchLight)
  const tr = new THREE.CylinderGeometry(0.022, 0.034, 0.8, 6, 6)
  tr.translate(0, 0.4, 0)
  const parts = [paint(tr, (x, y, z) => (Math.sin(y * 41 + Math.atan2(z, x) * 2) > 0.82 ? mark : bark))]
  const clumps = [
    { r: 0.17, x: 0, y: 0.92, z: 0 },
    { r: 0.15, x: 0.1, y: 0.76, z: 0.06 },
    { r: 0.14, x: -0.09, y: 0.72, z: -0.07 },
    { r: 0.12, x: 0.02, y: 1.06, z: 0.03 },
  ]
  clumps.forEach((cl, i) => {
    const ico = new THREE.IcosahedronGeometry(cl.r, 1)
    jitter(ico, cl.r * 0.3, 60 + i)
    ico.scale(0.9, 1.15, 0.9)
    ico.translate(cl.x, cl.y, cl.z)
    parts.push(paint(ico, (_x, y, _z, ny) => shade(mix3(c0, c1, THREE.MathUtils.clamp(0.35 + ny * 0.45 + (y - 0.8) * 0.8, 0, 1)), ny < -0.4 ? 0.75 : 1)))
  })
  return mergeGeometries(parts)
}

function bushGeometry(): THREE.BufferGeometry {
  const c0 = lin(NATURE.oak, 0.95), c1 = lin(NATURE.oakLight)
  const parts: THREE.BufferGeometry[] = []
  const clumps = [{ r: 0.3, x: 0, z: 0, y: 0.24 }, { r: 0.24, x: 0.22, z: 0.06, y: 0.18 }, { r: 0.22, x: -0.18, z: -0.1, y: 0.17 }]
  clumps.forEach((cl, i) => {
    const ico = new THREE.IcosahedronGeometry(cl.r, 1)
    jitter(ico, cl.r * 0.3, 80 + i)
    ico.scale(1, 0.78, 1)
    ico.translate(cl.x, cl.y, cl.z)
    parts.push(paint(ico, (_x, _y, _z, ny) => mix3(c0, c1, THREE.MathUtils.clamp(0.35 + ny * 0.5, 0, 1))))
  })
  return mergeGeometries(parts)
}

/** A fern: a rosette of arching fronds (two-sided). */
function fernGeometry(): THREE.BufferGeometry {
  const c0 = lin(NATURE.fern, 0.8), c1 = lin(NATURE.fern, 1.25)
  const pos: number[] = []
  const n = 7
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i, 90) * 0.4
    const ca = Math.cos(a), sa = Math.sin(a)
    // Frond: a spine arching out and down, with a little width.
    const pts: [number, number][] = [[0, 0.05], [0.35, 0.55], [0.7, 0.62], [1, 0.35]]
    for (let k = 0; k < pts.length - 1; k++) {
      const [d0, h0] = pts[k], [d1, h1] = pts[k + 1]
      const w0 = 0.12 * Math.sin(((k) / 3) * Math.PI + 0.4), w1 = 0.12 * Math.sin(((k + 1) / 3) * Math.PI + 0.4)
      const P = (d: number, h: number, w: number): [number, number, number] => [ca * d - sa * w, h, sa * d + ca * w]
      pos.push(...P(d0, h0, -w0), ...P(d1, h1, -w1), ...P(d1, h1, w1))
      pos.push(...P(d0, h0, -w0), ...P(d1, h1, w1), ...P(d0, h0, w0))
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return paint(g, (_x, y) => mix3(c0, c1, THREE.MathUtils.clamp(y * 1.6, 0, 1)))
}

function mushroomGeometry(): THREE.BufferGeometry {
  const stem = lin(NATURE.mushroomCream)
  const parts: THREE.BufferGeometry[] = []
  for (const [x, z, s] of [[0, 0, 1], [0.32, 0.18, 0.7], [-0.26, 0.22, 0.55]] as const) {
    const st = new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.5 * s, 6, 1)
    st.translate(x, 0.25 * s, z)
    parts.push(paint(st, () => stem))
    const cap = new THREE.SphereGeometry(0.26 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)
    cap.scale(1, 0.7, 1)
    cap.translate(x, 0.48 * s, z)
    // A red toadstool cap with a few pale spots.
    parts.push(paint(cap, (x, y, z, ny) => (ny < 0.1 ? shade(stem, 0.9) : hash01(Math.round((x + y * 3 + z) * 40), 9) > 0.8 ? stem : lin(NATURE.mushroom))))
  }
  return mergeGeometries(parts)
}

/** A fallen log: bark, pale cut ends and a coat of moss on top. */
function logGeometry(): THREE.BufferGeometry {
  const bark = lin(NATURE.log), cut = lin('#C9A97E'), moss = lin(NATURE.moss)
  const c = new THREE.CylinderGeometry(0.16, 0.18, 1, 8, 2)
  jitter(c, 0.03, 101)
  c.rotateZ(Math.PI / 2)
  c.translate(0, 0.15, 0)
  return paint(c, (x, _y, _z, ny) => {
    if (Math.abs(x) > 0.49) return cut
    if (ny > 0.55) return mix3(moss, bark, hash01(Math.round(x * 50), 7) * 0.4)
    return shade(bark, 0.9 + ny * 0.15)
  })
}

/** Reeds: a clump of thin blades with a couple of cattail heads. */
function reedGeometry(): THREE.BufferGeometry {
  const base = lin(NATURE.reed, 0.75), tip = lin(NATURE.reed, 1.2), head = lin(NATURE.cattail)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + hash01(i, 120) * 0.8
    const d = 0.05 + hash01(i, 121) * 0.16
    const h = 0.6 + hash01(i, 122) * 0.45
    const blade = new THREE.ConeGeometry(0.035, h, 3, 1)
    blade.translate(0, h / 2, 0)
    blade.rotateZ(0.05 + hash01(i, 123) * 0.2)
    blade.rotateY(a)
    blade.translate(Math.cos(a) * d, 0, Math.sin(a) * d)
    parts.push(paint(blade, (_x, y) => mix3(base, tip, THREE.MathUtils.clamp(y, 0, 1))))
    if (i % 4 === 0) {
      const hd = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6, 1)
      hd.translate(Math.cos(a) * d, h * 0.92, Math.sin(a) * d)
      parts.push(paint(hd, () => head))
    }
  }
  return mergeGeometries(parts)
}

function tuftGeometry(): THREE.BufferGeometry {
  const base = lin(BIOME.grass.dark, 0.85), tip = lin(BIOME.grass.light)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.ConeGeometry(0.13, 1, 3, 1)
    blade.translate(0, 0.5, 0)
    const a = (i / 6) * Math.PI * 2 + hash01(i, 3) * 0.6
    const lean = 0.25 + hash01(i, 4) * 0.3
    blade.scale(1, 0.65 + hash01(i, 5) * 0.4, 1)
    blade.rotateZ(lean)
    blade.rotateY(a)
    blade.translate(Math.cos(a) * 0.06, 0, -Math.sin(a) * 0.06)
    parts.push(paint(blade, (_x, y) => mix3(base, tip, THREE.MathUtils.clamp(y * 1.2, 0, 1))))
  }
  return mergeGeometries(parts)
}

/** A little cluster of wildflowers in one colour: heads on short stems among a few leaves. */
function flowerGeometry(petal: string, seed: number): THREE.BufferGeometry {
  const stem = lin(BIOME.grass.dark), head = lin(petal), centre = lin('#E8B53A')
  const parts: THREE.BufferGeometry[] = []
  const n = 6
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i, seed) * 0.9
    const d = i === 0 ? 0 : 0.18 + hash01(i, seed + 1) * 0.2
    const h = 0.45 + hash01(i, seed + 2) * 0.4
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    const st = new THREE.CylinderGeometry(0.022, 0.022, h, 3, 1)
    st.translate(x, h / 2, z)
    parts.push(paint(st, () => stem))
    const hd = new THREE.IcosahedronGeometry(0.11, 0)
    hd.scale(1, 0.55, 1)
    hd.translate(x, h, z)
    parts.push(paint(hd, (_x, _y, _z, ny) => (ny > 0.8 && petal === NATURE.daisy ? centre : shade(head, 0.85 + ny * 0.15))))
  }
  const leaf = new THREE.ConeGeometry(0.1, 0.35, 3, 1)
  leaf.rotateZ(1.1)
  leaf.translate(0.12, 0.1, 0)
  parts.push(paint(leaf, () => stem))
  return mergeGeometries(parts)
}

/** Clover: a low patch of tiny round leaves. */
function cloverGeometry(): THREE.BufferGeometry {
  const c0 = lin(NATURE.clover, 0.9), c1 = lin(NATURE.clover, 1.2)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) {
    const a = hash01(i, 140) * Math.PI * 2, d = hash01(i, 141) * 0.4
    const leaf = new THREE.IcosahedronGeometry(0.12, 0)
    leaf.scale(1, 0.35, 1)
    leaf.translate(Math.cos(a) * d, 0.05 + hash01(i, 142) * 0.04, Math.sin(a) * d)
    parts.push(paint(leaf, (_x, _y, _z, ny) => mix3(c0, c1, ny > 0.5 ? 0.8 : 0.2)))
  }
  return mergeGeometries(parts)
}

function wheatGeometry(): THREE.BufferGeometry {
  // A loose sheaf: many thin golden blades, a few carrying ears.
  const base = mix3(lin(BIOME.plains.dark), lin(NATURE.wheat), 0.4), tip = lin(BIOME.plains.light, 1.08), ear = lin(NATURE.wheat, 1.05)
  const parts: THREE.BufferGeometry[] = []
  const n = 16
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i, 9) * 0.7
    const d = 0.04 + hash01(i, 10) * 0.22
    const h = 0.6 + hash01(i, 11) * 0.4
    const blade = new THREE.ConeGeometry(0.11, h, 3, 1)
    blade.translate(0, h / 2, 0)
    blade.rotateZ(0.08 + d * 0.9)
    blade.rotateY(a)
    blade.translate(Math.cos(a) * d * 0.6, 0, -Math.sin(a) * d * 0.6)
    parts.push(paint(blade, (_x, y) => mix3(base, tip, THREE.MathUtils.clamp(y * 1.15, 0, 1))))
    if (i % 3 === 0) {
      const hd = new THREE.OctahedronGeometry(0.075, 0)
      hd.scale(1, 2.8, 1)
      hd.translate(0, h, 0)
      hd.rotateZ(0.08 + d * 0.9)
      hd.rotateY(a)
      hd.translate(Math.cos(a) * d * 0.6, 0, -Math.sin(a) * d * 0.6)
      parts.push(paint(hd, (_x, _y, _z, ny) => mix3(ear, tip, ny > 0 ? 0.5 : 0)))
    }
  }
  return mergeGeometries(parts)
}

/** Lily pads: a few notched round leaves floating together, one with a small pink bloom. */
function lilyGeometry(): THREE.BufferGeometry {
  const leaf = lin('#4F8A47'), leafLight = lin('#74A858'), bloom = lin('#F2B8C9'), heart = lin('#F2D36B')
  const parts: THREE.BufferGeometry[] = []
  const pads = [{ x: 0, z: 0, r: 0.42 }, { x: 0.58, z: 0.22, r: 0.3 }, { x: -0.36, z: 0.5, r: 0.26 }, { x: 0.2, z: -0.55, r: 0.22 }]
  pads.forEach((p, i) => {
    // A disc with a wedge cut out, lying flat.
    const notch = 0.5
    const g = new THREE.CircleGeometry(p.r, 14, notch / 2 + hash01(i, 200) * 6.28, Math.PI * 2 - notch)
    g.rotateX(-Math.PI / 2)
    g.translate(p.x, 0.004 * i, p.z)
    parts.push(paint(g, () => mix3(leaf, leafLight, hash01(i, 201) * 0.6)))
  })
  // A small water-lily flower: two rings of petals around a golden heart.
  const petals = new THREE.ConeGeometry(0.12, 0.12, 6, 1, true)
  petals.translate(0.58, 0.07, 0.22)
  parts.push(paint(petals, () => bloom))
  const inner = new THREE.ConeGeometry(0.07, 0.1, 5, 1)
  inner.translate(0.58, 0.1, 0.22)
  parts.push(paint(inner, (_x, _y, _z, ny) => (ny > 0.6 ? heart : shade(bloom, 1.05))))
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))
}

/** A faceted boulder; mossy ones carry moss and lichen on their upward faces. */
function rockGeometry(seed: number, mossy: boolean): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(0.5, 0)
  jitter(ico, 0.28, seed)
  ico.scale(1, 0.62, 0.9)
  ico.translate(0, 0.18, 0)
  const c = lin(NATURE.rock), light = lin(BIOME.mountain.light), moss = lin(NATURE.moss), lichen = lin('#C9C69A')
  return paint(ico, (x, _y, z, ny) => {
    const h = hash01(Math.round((x + z) * 999), seed)
    if (mossy && ny > 0.62 && h > 0.35) return h > 0.85 ? lichen : mix3(moss, c, 0.35 + h * 0.3)
    return mix3(c, light, THREE.MathUtils.clamp(0.25 + ny * 0.35 + h * 0.2, 0, 1))
  })
}

// ------------------------------------------------------------------------------------------------
// Placement

const WHITE = new THREE.Color(1, 1, 1)

/** A soft round contact shadow: white at the rim, grey in the middle, drawn with multiply blending. */
function blobTexture(): THREE.DataTexture {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1
    const d = Math.min(1, Math.hypot(dx, dy))
    const k = Math.pow(1 - d * d * (3 - 2 * d), 1.6)
    const v = Math.round(255 * (1 - 0.42 * k))
    data.set([v, v, v, 255], (j * n + i) * 4)
  }
  const t = new THREE.DataTexture(data, n, n)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/** Smooth value noise in [0, 1] over the board (for drifts of flowers). */
function vnoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z)
  const fx = x - xi, fz = z - zi
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const h = (i: number, j: number) => hash01(i * 7919 + j * 104729, seed)
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v
}

const FLOWERS: Kind[] = ['poppy', 'lavender', 'buttercup', 'daisy']

function place(layout: Layout, quality: WorldQuality): Map<Kind, Prop[]> {
  const out = new Map<Kind, Prop[]>()
  const { map, cx, cz, top, nb, water } = layout
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const push = (kind: Kind, p: Prop) => {
    let list = out.get(kind)
    if (!list) out.set(kind, (list = []))
    list.push(p)
  }
  const add = (kind: Kind, tile: number, x: number, z: number, s: number, rot: number, c: THREE.Color, sy = 1, y = top[tile] - 0.01) => {
    tmpP.set(x, y, z)
    tmpQ.setFromAxisAngle(up, rot)
    tmpS.set(s, s * sy, s)
    push(kind, { tile, m: new THREE.Matrix4().compose(tmpP, tmpQ, tmpS), c })
    const blob = BLOB[kind]
    if (blob) {
      const r = s * blob * (kind === 'rock' ? Math.max(1, sy) : kind === 'log' ? 1.4 : 1)
      tmpP.y = top[tile] + 0.003
      tmpS.set(r, 1, r)
      push('blob', { tile, m: new THREE.Matrix4().compose(tmpP, tmpQ, tmpS), c: WHITE })
    }
  }
  const lite = quality === 'low'
  const rich = quality === 'high' || quality === 'ultra'

  for (const t of map.tiles) {
    const id = t.id
    const x0 = cx[id], z0 = cz[id]
    let k = 0
    const rnd = () => hash01(id, 1000 + k++)
    const spots: { x: number; z: number; r: number }[] = []
    /** A free spot outside the centre disc (kept clear for pieces) and inside the hex, or null. */
    const spot = (rad: number, margin: number, rMin = 0) => {
      const r0 = Math.max(rMin, (rad > 0.075 ? 0.42 : 0.38) + rad * 0.5)
      for (let tries = 0; tries < 18; tries++) {
        const a = rnd() * Math.PI * 2
        const d = r0 + rnd() * (0.85 - r0)
        const x = Math.cos(a) * d, z = Math.sin(a) * d
        if (hexSdf(x, z) > -margin - rad) continue
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < (s.r + rad) * 0.9)) continue
        spots.push({ x, z, r: rad })
        return { x: x0 + x, z: z0 + z }
      }
      return null
    }
    const tint = (base: number, spread: number) => new THREE.Color().setScalar(base + (rnd() - 0.5) * spread)
    const warmTint = (base: number, spread: number) => { const c = tint(base, spread); c.r *= 1.04; c.b *= 0.94; return c }
    const b = t.biome
    const flowersHere = (n: number, size: number) => {
      // Drifts: a broad noise decides where flowers gather and which colour leads there.
      const drift = vnoise(x0 * 0.22, z0 * 0.22, 21)
      const lead = FLOWERS[Math.floor(vnoise(x0 * 0.13 + 9, z0 * 0.13, 22) * 3.999)]
      const count = drift > 0.58 ? n + Math.floor(rnd() * 4) : Math.floor(rnd() * 1.6)
      for (let i = 0; i < count; i++) {
        const p = spot(0.06, 0.04)
        if (!p) continue
        const kind = rnd() < 0.75 ? lead : FLOWERS[Math.floor(rnd() * 4)]
        add(kind, id, p.x, p.z, size * (0.8 + rnd() * 0.45), rnd() * 6.28, tint(1, 0.12))
      }
    }
    const tree = (pine: number, birch: number) => {
      const r = rnd()
      const autumn = rnd()
      let kind: Kind
      if (r < pine) kind = 'pine'
      else if (r < pine + birch) kind = 'birch'
      else if (autumn < 0.035) kind = 'gold'
      else if (autumn < 0.06) kind = 'rust'
      else kind = rnd() < 0.55 ? 'oak' : 'olive'
      const s = kind === 'pine' ? 0.5 + rnd() * 0.3 : kind === 'birch' ? 0.52 + rnd() * 0.22 : 0.44 + rnd() * 0.22
      const p = spot(kind === 'birch' ? 0.1 : 0.15 * s / 0.45, 0.06)
      if (!p) return
      const sy = kind === 'pine' && rnd() < 0.35 ? 1.25 : 1 // the odd tall spruce
      add(kind, id, p.x, p.z, s * (sy > 1 ? 0.85 : 1), rnd() * 6.28, kind === 'pine' ? tint(1, 0.18) : warmTint(1, 0.16), sy)
    }

    if (b === 'forest') {
      const n = 4 + Math.floor(rnd() * 3)
      const high = t.height >= 4
      for (let i = 0; i < n; i++) tree(high ? 0.72 : 0.28, high ? 0.12 : 0.16)
      if (rnd() < 0.5) { const p = spot(0.12, 0.05); if (p) add('bush', id, p.x, p.z, 0.3 + rnd() * 0.12, rnd() * 6.28, warmTint(1, 0.14)) }
      if (!lite) {
        for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) { const p = spot(0.06, 0.03); if (p) add('fern', id, p.x, p.z, 0.13 + rnd() * 0.06, rnd() * 6.28, tint(1, 0.2)) }
        if (rnd() < 0.3) { const p = spot(0.04, 0.03); if (p) add('mushroom', id, p.x, p.z, 0.09 + rnd() * 0.04, rnd() * 6.28, tint(1, 0.1)) }
        if (rnd() < 0.14) { const p = spot(0.16, 0.08); if (p) add('log', id, p.x, p.z, 0.32 + rnd() * 0.1, rnd() * 6.28, tint(1, 0.1)) }
        for (let i = 0; i < 2; i++) { const p = spot(0.05, 0.04); if (p) add('tuft', id, p.x, p.z, 0.09 + rnd() * 0.04, rnd() * 6.28, tint(0.78, 0.1)) }
      }
    } else if (b === 'grass') {
      if (rnd() < 0.16) tree(0.1, 0.4)
      if (rnd() < 0.22) { const p = spot(0.11, 0.05); if (p) add('bush', id, p.x, p.z, 0.24 + rnd() * 0.1, rnd() * 6.28, warmTint(1.05, 0.14)) }
      const n = (lite ? 3 : 5) + Math.floor(rnd() * 4)
      for (let i = 0; i < n; i++) { const p = spot(0.06, 0.04); if (p) add('tuft', id, p.x, p.z, 0.1 + rnd() * 0.08, rnd() * 6.28, tint(1, 0.18)) }
      if (!lite) {
        for (let i = 0; i < 1 + Math.floor(rnd() * 2.5); i++) { const p = spot(0.08, 0.04); if (p) add('clover', id, p.x, p.z, 0.16 + rnd() * 0.08, rnd() * 6.28, tint(1, 0.15)) }
        flowersHere(rich ? 4 : 2, 0.12)
      }
      if (rnd() < 0.12) { const p = spot(0.06, 0.05); if (p) add('rock', id, p.x, p.z, 0.08 + rnd() * 0.05, rnd() * 6.28, tint(1, 0.1)) }
    } else if (b === 'plains') {
      const n = (lite ? 3 : 5) + Math.floor(rnd() * 3)
      for (let i = 0; i < n; i++) { const p = spot(0.1, 0.04); if (p) add('wheat', id, p.x, p.z, 0.2 + rnd() * 0.08, rnd() * 6.28, warmTint(1.05, 0.1)) }
      if (!lite && rnd() < 0.45) for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) { const p = spot(0.05, 0.04); if (p) add('poppy', id, p.x, p.z, 0.1 + rnd() * 0.03, rnd() * 6.28, tint(1, 0.1)) }
      for (let i = 0; i < (lite ? 0 : 2); i++) { const p = spot(0.03, 0.04); if (p) add('stone', id, p.x, p.z, 0.035 + rnd() * 0.025, rnd() * 6.28, warmTint(1.05, 0.12)) }
    } else if (b === 'hills') {
      // Upland: mossy boulders, pebbles, heath tufts, now and then a wind-bent pine or a bush.
      const n = 1 + Math.floor(rnd() * 2.4)
      for (let i = 0; i < n; i++) { const p = spot(0.14, 0.05); if (p) add('rock', id, p.x, p.z, 0.16 + rnd() * 0.12, rnd() * 6.28, rnd() < 0.4 ? new THREE.Color(1.0, 0.94, 1.06) : tint(1, 0.12), 0.7 + rnd() * 0.6) }
      for (let i = 0; i < (lite ? 1 : 3); i++) { const p = spot(0.04, 0.04); if (p) add('stone', id, p.x, p.z, 0.04 + rnd() * 0.04, rnd() * 6.28, tint(0.95, 0.12)) }
      if (rnd() < 0.3) tree(0.85, 0.1)
      if (rnd() < 0.25) { const p = spot(0.11, 0.05); if (p) add('bush', id, p.x, p.z, 0.22 + rnd() * 0.08, rnd() * 6.28, new THREE.Color(1.08, 1.0, 0.8)) }
      const nt = lite ? 2 : 5
      for (let i = 0; i < nt; i++) { const p = spot(0.05, 0.04); if (p) add('tuft', id, p.x, p.z, 0.09 + rnd() * 0.05, rnd() * 6.28, new THREE.Color(1.12 + rnd() * 0.1, 1.0, 0.62)) }
      if (!lite && rnd() < 0.6) for (let i = 0; i < 3; i++) { const p = spot(0.05, 0.04); if (p) add('lavender', id, p.x, p.z, 0.1 + rnd() * 0.03, rnd() * 6.28, tint(1, 0.1)) }
    } else if (b === 'beach') {
      // Reeds stand along the waterline, on the edges that face the sea.
      for (let e = 0; e < 6; e++) {
        const o = nb[id * 6 + e]
        if (o < 0 || !water[o] || rnd() > (lite ? 0.25 : 0.5)) continue
        const a = (Math.PI / 3) * e + (rnd() - 0.5) * 0.7
        const d = 0.66 + rnd() * 0.1
        add('reed', id, x0 + Math.cos(a) * d, z0 + Math.sin(a) * d, 0.2 + rnd() * 0.1, rnd() * 6.28, tint(1, 0.15))
      }
      for (let i = 0; i < (lite ? 1 : 3); i++) { const p = spot(0.04, 0.06); if (p) add('stone', id, p.x, p.z, 0.035 + rnd() * 0.03, rnd() * 6.28, new THREE.Color(1.1, 1.04, 1.0)) }
      if (!lite && rnd() < 0.35) { const p = spot(0.05, 0.06); if (p) add('tuft', id, p.x, p.z, 0.08 + rnd() * 0.03, rnd() * 6.28, new THREE.Color(1.25, 1.15, 0.75)) }
    } else if (b === 'shallow' && layout.seaDist[id] === 1 && !lite) {
      // Lily pads drift in the sheltered shallows next to the land.
      if (rnd() < 0.45) {
        const a = rnd() * Math.PI * 2, d = 0.15 + rnd() * 0.3
        add('lily', id, x0 + Math.cos(a) * d, z0 + Math.sin(a) * d, 0.34 + rnd() * 0.12, rnd() * 6.28, tint(1, 0.12), 1, WATER_Y + 0.003)
      }
    } else if (b === 'mountain') {
      if (rnd() < 0.6) { const p = spot(0.08, 0.04, 0.6); if (p) add('stone', id, p.x, p.z, 0.06 + rnd() * 0.05, rnd() * 6.28, tint(0.95, 0.1)) }
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------

/** Sunlight glowing through leaves: a soft extra term on faces turned away from the sun. */
function translucency(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_end>',
    /* glsl */ `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
    {
      vec3 L = directionalLights[0].direction;
      float away = saturate(-dot(normal, L));
      float into = pow(saturate(dot(-geometryViewDir, L)), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * (0.025 + 0.07 * away + 0.3 * into) * wCloud;
    }
    #endif`,
  )
}

export interface Props {
  group: THREE.Group
  setCleared(tiles: Iterable<number>): void
  dispose(): void
}

export function buildProps(layout: Layout, quality: WorldQuality): Props {
  const group = new THREE.Group()
  group.name = 'props'
  const geos: Record<Kind, () => THREE.BufferGeometry> = {
    pine: pineGeometry,
    oak: () => broadGeometry(NATURE.oak, NATURE.oakLight, 11),
    olive: () => broadGeometry(NATURE.olive, NATURE.oliveLight, 31, 'tall'),
    birch: birchGeometry,
    gold: () => broadGeometry(NATURE.gold, NATURE.goldLight, 41),
    rust: () => broadGeometry(NATURE.rust, NATURE.amber, 51, 'tall'),
    bush: bushGeometry,
    fern: fernGeometry,
    mushroom: mushroomGeometry,
    log: logGeometry,
    reed: reedGeometry,
    poppy: () => flowerGeometry(NATURE.poppy, 150),
    lavender: () => flowerGeometry(NATURE.lavender, 160),
    buttercup: () => flowerGeometry(NATURE.buttercup, 170),
    daisy: () => flowerGeometry(NATURE.daisy, 180),
    clover: cloverGeometry,
    tuft: tuftGeometry,
    wheat: wheatGeometry,
    rock: () => rockGeometry(1, true),
    stone: () => rockGeometry(2, false),
    lily: lilyGeometry,
    blob: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  }
  const blobTex = blobTexture()
  const placed = place(layout, quality)
  const meshes: { kind: Kind; mesh: THREE.InstancedMesh; props: Prop[] }[] = []
  const mats: THREE.Material[] = []
  const built: THREE.BufferGeometry[] = []
  for (const [kind, props] of placed) {
    const mat = kind === 'blob'
      ? new THREE.MeshBasicMaterial({
        map: blobTex, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false,
        toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      : patchMaterial(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: TWO_SIDED.has(kind) ? THREE.DoubleSide : THREE.FrontSide }),
        LEAFY.has(kind) ? { wind: WIND[kind], extra: translucency, name: 'leaf' } : { wind: WIND[kind] },
      )
    mats.push(mat)
    const geo = geos[kind]()
    built.push(geo)
    const mesh = new THREE.InstancedMesh(geo, mat, props.length)
    mesh.name = `props-${kind}`
    mesh.castShadow = CASTS.has(kind)
    mesh.receiveShadow = kind !== 'blob'
    if (kind === 'blob') mesh.renderOrder = 0.5
    if (WIND[kind] > 0 && mesh.castShadow) {
      const dm = windDepthMaterial(WIND[kind])
      mats.push(dm)
      mesh.customDepthMaterial = dm
    }
    meshes.push({ kind, mesh, props })
    group.add(mesh)
  }

  const setCleared = (tiles: Iterable<number>) => {
    const cleared = new Set(tiles)
    for (const { mesh, props } of meshes) {
      let n = 0
      for (const p of props) {
        if (cleared.has(p.tile)) continue
        mesh.setMatrixAt(n, p.m)
        mesh.setColorAt(n, p.c)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }
  setCleared([])

  return {
    group,
    setCleared,
    dispose() {
      for (const { mesh } of meshes) mesh.dispose()
      for (const g of built) g.dispose()
      for (const m of mats) m.dispose()
      blobTex.dispose()
    },
  }
}
