// Vegetation and small props at city scale, authored with the kit (base at y = 0, about 1 unit
// tall for trees). Flutter weights grow with height so crowns sway and trunks stay put.

import * as THREE from 'three'
import { BIOME, NATURE } from '../../render/palette.ts'
import { Kit, box, cone, cyl, hash, ico, lin, mix, sphere, type RGB } from './geo.ts'

const sway = (k: number) => (_x: number, y: number) => Math.max(0, y) ** 2 * k

function jitterGeo(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const h = (Math.round(x * 1000) * 73856093) ^ (Math.round(y * 1000) * 19349663) ^ (Math.round(z * 1000) * 83492791)
    p.setXYZ(i, x + (hash(h, seed) - 0.5) * amt, y + (hash(h, seed + 1) - 0.5) * amt, z + (hash(h, seed + 2) - 0.5) * amt)
  }
  return g
}

export function pine(k: Kit, o: { light?: number; dark?: string; lite?: string } = {}) {
  const dark = lin(o.dark ?? NATURE.pineTeal, 0.92), light = lin(o.lite ?? NATURE.pineTealLight)
  k.add(cyl(0.035, 0.055, 0.28, 6), NATURE.trunk, { p: [0, 0.14, 0] })
  const tiers = [
    { r: 0.36, y0: 0.14, y1: 0.58 },
    { r: 0.29, y0: 0.36, y1: 0.8 },
    { r: 0.2, y0: 0.58, y1: 1.02 },
  ]
  tiers.forEach((t, i) => {
    const c = mix(dark, light, (i / 2) * 0.6 + (o.light ?? 0))
    k.add(cone(t.r, t.y1 - t.y0, 7), c, { p: [0, (t.y0 + t.y1) / 2, 0], r: [0, i * 0.5, 0] }, { flutter: sway(0.012), jit: 0.1 })
  })
}

export function broadleaf(k: Kit, canopy: string = NATURE.broadleaf, canopyLight: string = NATURE.broadleafLight, seed = 1) {
  k.add(cyl(0.04, 0.06, 0.48, 6), NATURE.trunk, { p: [0, 0.24, 0] })
  k.add(cyl(0.02, 0.03, 0.2, 5), NATURE.trunk, { p: [0.08, 0.45, 0.02], r: [0, 0, -0.7] })
  const c0 = lin(canopy), c1 = lin(canopyLight)
  const blobs = [
    { r: 0.34, x: 0, y: 0.66, z: 0 },
    { r: 0.24, x: 0.2, y: 0.54, z: 0.1 },
    { r: 0.21, x: -0.16, y: 0.53, z: -0.13 },
    { r: 0.18, x: -0.05, y: 0.86, z: 0.08 },
  ]
  blobs.forEach((b, i) => {
    const g = jitterGeo(ico(b.r, i === 0 ? 1 : 0), b.r * (i === 0 ? 0.24 : 0.3), seed * 11 + i)
    g.scale(1, 0.9, 1)
    const t = 0.35 + (b.y - 0.5) * 1.2
    k.add(g, mix(c0, c1, Math.min(1, t)), { p: [b.x, b.y, b.z] }, { flutter: sway(0.014), jit: 0.14, seed: seed + i })
  })
}

export function birch(k: Kit, seed = 3) {
  k.add(cyl(0.025, 0.036, 0.62, 6), NATURE.birchBark, { p: [0, 0.31, 0] })
  for (let i = 0; i < 4; i++) k.add(cyl(0.038, 0.038, 0.018, 6), '#3B3532', { p: [0, 0.1 + i * 0.13 + hash(seed, i) * 0.04, 0] })
  const c0 = lin(NATURE.birch), c1 = lin(NATURE.birchLight)
  const blobs = [
    { r: 0.2, x: 0, y: 0.78, z: 0, s: 1.35 },
    { r: 0.15, x: 0.1, y: 0.62, z: 0.06, s: 1.2 },
    { r: 0.14, x: -0.1, y: 0.66, z: -0.06, s: 1.2 },
  ]
  blobs.forEach((b, i) => {
    const g = jitterGeo(ico(b.r, i === 0 ? 1 : 0), b.r * 0.25, seed * 13 + i)
    g.scale(1, b.s, 1)
    k.add(g, mix(c0, c1, 0.3 + i * 0.25), { p: [b.x, b.y, b.z] }, { flutter: sway(0.016), jit: 0.14, seed: seed + i })
  })
}

/** A small fruit tree for gardens: round crown with red apples. */
export function fruitTree(k: Kit, seed = 5) {
  k.add(cyl(0.025, 0.035, 0.3, 6), NATURE.trunk, { p: [0, 0.15, 0] })
  const g = jitterGeo(ico(0.2, 1), 0.05, seed)
  g.scale(1, 0.85, 1)
  k.add(g, mix(lin(NATURE.broadleaf), lin(NATURE.broadleafLight), 0.55), { p: [0, 0.4, 0] }, { flutter: sway(0.01), jit: 0.12 })
  for (let i = 0; i < 7; i++) {
    const a = hash(seed, i) * Math.PI * 2, e = hash(seed, i + 9) * 0.9 - 0.2
    k.add(sphere(0.022, 6, 4), '#D2432B', { p: [Math.cos(a) * 0.19 * Math.cos(e), 0.4 + Math.sin(e) * 0.16, Math.sin(a) * 0.19 * Math.cos(e)] }, { flutter: sway(0.01) })
  }
}

export function bush(k: Kit, color: string = BIOME.forest.base, seed = 7, flowers?: string) {
  const g = jitterGeo(ico(0.12, 1), 0.04, seed)
  g.scale(1.2, 0.75, 1)
  k.add(g, color, { p: [0, 0.07, 0] }, { flutter: sway(0.02), jit: 0.14 })
  if (flowers) for (let i = 0; i < 6; i++) {
    const a = hash(seed, i) * Math.PI * 2
    k.add(sphere(0.018, 5, 4), flowers, { p: [Math.cos(a) * 0.12, 0.08 + hash(seed, i + 3) * 0.06, Math.sin(a) * 0.1] })
  }
}

export function tuft(k: Kit, base: RGB = lin(BIOME.grass.dark, 0.85), tip: RGB = lin(BIOME.grass.light)) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + hash(i, 3) * 0.6
    const g = cone(0.035, 0.16 + hash(i, 5) * 0.06, 3)
    g.translate(0, 0.08, 0)
    k.group({ p: [Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02], r: [0, a, 0.3 + hash(i, 4) * 0.3] }, () => {
      k.add(g, mix(base, tip, 0.5 + hash(i, 6) * 0.5), {}, { flutter: sway(0.6) })
    })
  }
}

export function flowers(k: Kit, color: string) {
  const stem = lin(BIOME.grass.dark)
  const spots = [[0, 0, 0.1], [0.05, 0.03, 0.08], [-0.04, 0.04, 0.09]] as const
  for (const [x, z, h] of spots) {
    k.add(cyl(0.005, 0.005, h, 3, true), stem, { p: [x, h / 2, z] }, { flutter: sway(0.8) })
    k.add(ico(0.018, 0), color, { p: [x, h, z] }, { flutter: sway(0.8) })
  }
}

export function wheat(k: Kit) {
  const stalk = lin(BIOME.plains.dark), head = lin(NATURE.wheat), headLight = lin(BIOME.plains.light)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + hash(i, 9) * 0.5
    const d = i === 0 ? 0 : 0.03 + hash(i, 10) * 0.02
    const h = 0.13 + hash(i, 11) * 0.05
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    k.add(cyl(0.004, 0.005, h, 3, true), stalk, { p: [x, h / 2, z] }, { flutter: sway(0.9) })
    const hd = new THREE.OctahedronGeometry(0.014, 0)
    hd.scale(1, 2.6, 1)
    k.add(hd, mix(head, headLight, hash(i, 2) * 0.6), { p: [x, h + 0.015, z] }, { flutter: sway(0.9) })
  }
}

export function rock(k: Kit, seed: number, color: string = NATURE.rock) {
  const g = jitterGeo(ico(0.5, 0), 0.3, seed)
  g.scale(1, 0.62, 0.9)
  g.translate(0, 0.16, 0)
  k.add(g, mix(lin(color), lin(BIOME.mountain.light), 0.2), {}, { jit: 0.18, seed })
}

export function sheep(k: Kit) {
  const wool = '#F3EEE4', face = '#3A3330'
  const body = jitterGeo(ico(0.07, 1), 0.012, 4)
  body.scale(1.35, 1, 1)
  k.add(body, wool, { p: [0, 0.085, 0] }, { jit: 0.08 })
  k.add(sphere(0.03, 8, 6), face, { p: [0.095, 0.1, 0] })
  for (const [x, z] of [[0.05, 0.03], [0.05, -0.03], [-0.05, 0.03], [-0.05, -0.03]]) k.add(cyl(0.009, 0.009, 0.05, 4), face, { p: [x, 0.025, z] })
}

/** A narrow, tall spruce with drooping tiers. */
export function spruce(k: Kit) {
  const dark = lin(NATURE.spruce, 0.9), light = lin(NATURE.pineLight)
  k.add(cyl(0.03, 0.045, 0.22, 6), NATURE.trunk, { p: [0, 0.11, 0] })
  for (let i = 0; i < 5; i++) {
    const y0 = 0.12 + i * 0.17, r = 0.26 - i * 0.042
    k.add(cone(r, 0.3, 7), mix(dark, light, i * 0.12), { p: [0, y0 + 0.15, 0], r: [0, i * 0.7, 0] }, { flutter: sway(0.01), jit: 0.12 })
  }
}

/** A broad oak with a layered crown: a wide lower layer under a smaller upper one. */
export function oak(k: Kit, canopy: string = NATURE.oak, canopyLight: string = NATURE.oakLight, seed = 2) {
  k.add(cyl(0.05, 0.075, 0.44, 7), NATURE.trunk, { p: [0, 0.22, 0] })
  for (const [a, l] of [[0.4, 0.22], [2.4, 0.2], [4.3, 0.18]] as const) {
    k.add(cyl(0.018, 0.028, l, 5), NATURE.trunk, { p: [Math.cos(a) * 0.06, 0.42, Math.sin(a) * 0.06], r: [0, -a, 0.75] })
  }
  const c0 = lin(canopy), c1 = lin(canopyLight)
  const lower = [{ x: 0.2, z: 0.05 }, { x: -0.16, z: 0.14 }, { x: -0.06, z: -0.2 }, { x: 0.12, z: -0.14 }]
  lower.forEach((b, i) => {
    const g = jitterGeo(ico(0.2, 0), 0.07, seed * 17 + i)
    g.scale(1.25, 0.75, 1.25)
    k.add(g, mix(c0, c1, 0.15 + hash(seed, i) * 0.2), { p: [b.x, 0.58, b.z] }, { flutter: sway(0.012), jit: 0.14 })
  })
  const top = jitterGeo(ico(0.24, 1), 0.06, seed * 17 + 9)
  top.scale(1.15, 0.8, 1.15)
  k.add(top, mix(c0, c1, 0.6), { p: [0.02, 0.8, 0] }, { flutter: sway(0.012), jit: 0.12 })
  const crown = jitterGeo(ico(0.14, 0), 0.05, seed * 17 + 11)
  k.add(crown, c1, { p: [-0.04, 0.98, 0.03] }, { flutter: sway(0.012), jit: 0.1 })
}

/** Fern fronds: flattened leaves fanning out of the ground. */
export function fern(k: Kit, seed = 1) {
  const c = lin(NATURE.fern)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash(seed, i) * 0.4
    const g = cone(0.05, 0.22, 3)
    g.scale(1, 1, 0.25)
    g.translate(0, 0.11, 0)
    k.group({ r: [0, -a, 0] }, () => k.add(g, mix(c, lin(NATURE.oakLight), hash(seed, i + 9) * 0.4), { r: [0, 0, -1.0], p: [0.02, 0, 0] }, { flutter: sway(0.5) }))
  }
}

/** A red-capped mushroom with cream spots (and a smaller one beside it). */
export function mushroom(k: Kit) {
  for (const [x, z, s] of [[0, 0, 1], [0.05, 0.03, 0.7]] as const) {
    k.add(cyl(0.012 * s, 0.015 * s, 0.05 * s, 6), NATURE.mushroomCream, { p: [x, 0.025 * s, z] })
    k.add(sphere(0.032 * s, 8, 5), NATURE.mushroom, { p: [x, 0.05 * s, z], s: [1, 0.6, 1] })
    for (let i = 0; i < 3; i++) k.add(sphere(0.006 * s, 4, 3), NATURE.mushroomCream, { p: [x + Math.cos(i * 2.1) * 0.018 * s, 0.065 * s, z + Math.sin(i * 2.1) * 0.018 * s] })
  }
}

/** A fallen, mossy log. */
export function log(k: Kit) {
  k.add(cyl(0.035, 0.04, 0.42, 8), NATURE.log, { p: [0, 0.035, 0], r: [0, 0, Math.PI / 2] })
  k.add(box(0.36, 0.012, 0.05), NATURE.moss, { p: [0.02, 0.07, 0] }, { jit: 0.2 })
  for (const s of [-1, 1]) k.add(cyl(0.03, 0.03, 0.004, 8), '#D9B98A', { p: [s * 0.211, 0.035, 0], r: [0, 0, Math.PI / 2] })
}

/** Reeds and a few cattails for the shore. */
export function reeds(k: Kit, seed = 3) {
  for (let i = 0; i < 9; i++) {
    const a = hash(seed, i) * Math.PI * 2, d = hash(seed, i + 3) * 0.06
    const h = 0.14 + hash(seed, i + 6) * 0.1
    k.add(cyl(0.003, 0.005, h, 3, true), mix(lin(NATURE.reed), lin(BIOME.grass.dark), hash(seed, i + 9) * 0.4), { p: [Math.cos(a) * d, h / 2, Math.sin(a) * d], r: [0, 0, (hash(seed, i + 12) - 0.5) * 0.4] }, { flutter: sway(0.7) })
    if (i % 3 === 0) k.add(cyl(0.008, 0.008, 0.03, 5), NATURE.cattail, { p: [Math.cos(a) * d, h, Math.sin(a) * d] }, { flutter: sway(0.7) })
  }
}

/** A drift of one kind of wildflower: several stems close together. */
export function wildflowers(k: Kit, color: string, seed = 1) {
  const stem = lin(BIOME.grass.dark)
  for (let i = 0; i < 7; i++) {
    const a = hash(seed, i) * Math.PI * 2, d = Math.sqrt(hash(seed, i + 3)) * 0.07
    const h = 0.07 + hash(seed, i + 6) * 0.05
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    k.add(cyl(0.003, 0.003, h, 3, true), stem, { p: [x, h / 2, z] }, { flutter: sway(0.8) })
    k.add(ico(0.014, 0), mix(lin(color), lin('#FFFFFF'), hash(seed, i + 9) * 0.15), { p: [x, h, z], s: [1, 0.7, 1] }, { flutter: sway(0.8) })
  }
}

/** A low patch of clover. */
export function clover(k: Kit, seed = 1) {
  for (let i = 0; i < 6; i++) {
    const a = hash(seed, i) * Math.PI * 2, d = hash(seed, i + 3) * 0.06
    k.add(cyl(0.022, 0.022, 0.008, 6), mix(lin(NATURE.clover), lin(NATURE.oakLight), hash(seed, i + 6) * 0.4), { p: [Math.cos(a) * d, 0.012, Math.sin(a) * d] })
  }
  k.add(ico(0.01, 0), '#F2E6EE', { p: [0.01, 0.025, 0.01] })
}

/** A faceted rock with moss on its upward faces. */
export function mossyRock(k: Kit, seed: number) {
  const g = jitterGeo(ico(0.5, 0), 0.3, seed)
  g.scale(1, 0.62, 0.9)
  g.translate(0, 0.16, 0)
  const ng = g.index ? g.toNonIndexed() : g
  if (ng !== g) g.dispose()
  ng.computeVertexNormals()
  const n = ng.attributes.normal
  // split faces: up-facing ones get moss
  const pos = ng.attributes.position
  const mossy: number[] = [], bare: number[] = []
  for (let i = 0; i < pos.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3
    const arr = ny > 0.55 && hash(seed, i) < 0.8 ? mossy : bare
    for (let k2 = 0; k2 < 3; k2++) arr.push(pos.getX(i + k2), pos.getY(i + k2), pos.getZ(i + k2))
  }
  ng.dispose()
  const mk = (arr: number[]) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return b }
  const rockC = pickRock(seed)
  k.add(mk(bare), rockC, {}, { jit: 0.16, seed })
  k.add(mk(mossy), mix(lin(NATURE.moss), lin('#9FB06A'), hash(seed, 3) * 0.5), {}, { jit: 0.14, seed: seed + 1 })
}

const ROCK_TINTS = ['#968D9A', '#8C7C94', '#808799', '#9A8E88']
function pickRock(seed: number): RGB {
  return mix(lin(ROCK_TINTS[Math.floor(hash(seed, 1) * ROCK_TINTS.length)]), lin(BIOME.mountain.light), 0.15)
}

/** Build a kit geometry from a function. */
export function model(fn: (k: Kit) => void): THREE.BufferGeometry {
  const k = new Kit()
  fn(k)
  return k.build()
}
