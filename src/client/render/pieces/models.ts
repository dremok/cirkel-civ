// Procedural painted miniatures. Units stand on a round base (radius BASE_R) in local space,
// facing +z, base bottom at y = 0. Cities are built from instanced houses, towers and walls.
import * as THREE from 'three'
import type { UnitType } from '../../../engine/types.ts'
import { Kit, box, capsule, cone, cyl, dome, lathe, slab, sphere, torus } from './kit.ts'

export const BASE_R = 0.37
export const BASE_H = 0.058

/** Neutral paint, sRGB. Warm, slightly desaturated so the team colours sing. */
export const PAINT = {
  skin: '#EBB896',
  skinShade: '#D99E7B',
  wood: '#8E5E3B',
  woodDark: '#6A4329',
  steel: '#A7AEB7',
  steelDark: '#737A84',
  leather: '#6F4A33',
  cloth: '#EADBBB',
  clothDark: '#C9B48D',
  straw: '#DDBE72',
  horse: '#9C6542',
  horseDark: '#5C3B29',
  mane: '#3E2B22',
  baseTop: '#E9DFCB',
  baseGroove: '#C9BC9F',
  stone: '#D9CDB6',
  stoneDark: '#B4A68C',
  plaza: '#D8C9A8',
  door: '#5E3D29',
  window: '#3B3330',
  ivory: '#F6EFE1',
}

// ---------------------------------------------------------------------------------------------
// Units

function addBase(k: Kit) {
  // Bevelled disc: the rim band and an outer ring on top are team-coloured, the centre is neutral.
  k.sil = false
  k.team(lathe([[BASE_R - 0.012, 0], [BASE_R, 0.008], [BASE_R + 0.002, 0.016], [BASE_R + 0.002, 0.04], [BASE_R - 0.004, 0.052], [BASE_R - 0.018, BASE_H], [BASE_R - 0.06, BASE_H + 0.001]], 28), 1)
  k.add(lathe([[BASE_R - 0.06, BASE_H + 0.001], [BASE_R - 0.066, BASE_H + 0.004], [0.2, BASE_H + 0.006], [0, BASE_H + 0.007]], 28), PAINT.baseTop)
  k.add(lathe([[BASE_R - 0.085, BASE_H + 0.0062], [BASE_R - 0.092, BASE_H + 0.0064], [BASE_R - 0.099, BASE_H + 0.0066]], 28), PAINT.baseGroove)
  k.sil = true
}

const Y0 = BASE_H + 0.004

/** A rounded peg figure: tunic (team) + head (skin). Returns the head centre height. */
function addPeg(k: Kit, o: { shade?: number; scale?: number; y?: number } = {}): number {
  const s = o.scale ?? 1
  const y = o.y ?? Y0
  const pts: [number, number][] = [
    [0.0, 0], [0.13, 0], [0.142, 0.012], [0.138, 0.05], [0.122, 0.12], [0.104, 0.19], [0.098, 0.235], [0.104, 0.28],
    [0.112, 0.315], [0.108, 0.345], [0.088, 0.372], [0.05, 0.388], [0.0, 0.392],
  ]
  // tunic above the belt, a darker skirt below it
  const belt = 0.215
  const lower = pts.filter(([, h]) => h < belt)
  const upper = pts.filter(([, h]) => h > belt)
  const rb = 0.1
  k.team(lathe([...lower, [rb, belt]].map(([r, h]) => [r * s, y + h * s]), 18), (o.shade ?? 1) * 0.66)
  k.team(lathe([[rb, belt], ...upper].map(([r, h]) => [r * s, y + h * s]), 18), o.shade ?? 1)
  // belt
  k.add(torus(0.1 * s, 0.014 * s, 6, 20), PAINT.leather, { p: [0, y + 0.215 * s, 0], r: [Math.PI / 2, 0, 0] })
  // neck + head
  k.add(cyl(0.034 * s, 0.04 * s, 0.05 * s, 10), PAINT.skinShade, { p: [0, y + 0.395 * s, 0] })
  const hy = y + 0.465 * s
  k.add(sphere(0.088 * s, 16, 12), PAINT.skin, { p: [0, hy, 0] })
  return hy
}

function spear(k: Kit) {
  addBase(k)
  const hy = addPeg(k)
  // helmet with a crest in the team colour
  k.add(dome(0.094, 16, 6, 0.52), PAINT.steel, { p: [0, hy + 0.004, 0] })
  k.add(torus(0.093, 0.011, 5, 20), PAINT.steelDark, { p: [0, hy + 0.004, 0], r: [Math.PI / 2, 0, 0] })
  k.team(sphere(1, 12, 8), 1, { p: [0, hy + 0.1, -0.004], s: [0.026, 0.05, 0.088] })
  // spear held upright on the right
  k.group({ p: [0.165, 0, 0.05], r: [0.1, 0, -0.04] }, () => {
    k.add(cyl(0.013, 0.015, 0.92, 7), PAINT.wood, { p: [0, 0.5, 0] })
    k.add(cone(0.032, 0.13, 8), PAINT.steel, { p: [0, 1.02, 0] })
    k.add(cyl(0.02, 0.02, 0.03, 8), PAINT.steelDark, { p: [0, 0.955, 0] })
  })
  k.add(sphere(0.033, 10, 8), PAINT.skin, { p: [0.158, 0.33, 0.085] })
  // round shield on the left front
  k.group({ p: [-0.075, 0.27, 0.12], r: [0.05, -0.55, 0] }, () => {
    k.team(cyl(0.155, 0.155, 0.026, 24), 1, { r: [Math.PI / 2, 0, 0] })
    k.add(torus(0.155, 0.014, 5, 28), PAINT.wood, {})
    k.add(sphere(0.042, 12, 8), PAINT.steel, { p: [0, 0, 0.013], s: [1, 1, 0.55] })
    k.team(box(0.3, 0.03, 0.028), 0.62, { p: [0, 0, 0.002] })
  })
}

function archer(k: Kit) {
  addBase(k)
  const hy = addPeg(k)
  // hood
  k.team(dome(0.098, 16, 7, 0.6), 0.78, { p: [0, hy + 0.004, -0.014], r: [-0.25, 0, 0] })
  k.team(cone(0.05, 0.1, 8), 0.78, { p: [0, hy + 0.03, -0.1], r: [-2.1, 0, 0] })
  // quiver on the back, arrows peeking out
  k.group({ p: [0.06, 0.3, -0.115], r: [0.25, 0, -0.42] }, () => {
    k.add(cyl(0.042, 0.036, 0.25, 10), PAINT.leather, {})
    k.add(torus(0.042, 0.008, 4, 14), PAINT.woodDark, { p: [0, 0.12, 0], r: [Math.PI / 2, 0, 0] })
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      k.add(cyl(0.005, 0.005, 0.1, 4), PAINT.wood, { p: [Math.cos(a) * 0.016, 0.16, Math.sin(a) * 0.016] })
      k.add(cone(0.018, 0.05, 4), PAINT.ivory, { p: [Math.cos(a) * 0.016, 0.21, Math.sin(a) * 0.016] })
    }
  })
  // bow in the left hand, facing the viewer
  const arc = 2.25
  const bx = -0.035
  const by = 0.33
  const bz = 0.07
  k.add(torus(0.2, 0.013, 5, 22, arc), PAINT.wood, { p: [bx, by, bz], r: [0, 0, Math.PI - arc / 2] })
  const ex = bx + Math.cos(Math.PI - arc / 2) * 0.2
  const ey = Math.sin(arc / 2) * 0.2
  k.add(cyl(0.004, 0.004, ey * 2, 4), PAINT.ivory, { p: [ex, by, bz] })
  k.add(sphere(0.034, 10, 8), PAINT.skin, { p: [bx - 0.2, by, bz] })
  k.add(sphere(0.033, 10, 8), PAINT.skin, { p: [0.12, 0.3, 0.06] })
}

function rider(k: Kit) {
  addBase(k)
  // horse
  const H = 1.2
  const hb = Y0 + 0.25 * H
  k.add(capsule(0.105 * H, 0.2 * H, 5, 14), PAINT.horse, { p: [0, hb, -0.01], r: [Math.PI / 2, 0, 0] })
  // neck rising forward, a tapered head angled down, darker muzzle, ears and mane
  k.add(capsule(0.052 * H, 0.15 * H, 4, 12), PAINT.horse, { p: [0, hb + 0.115 * H, 0.165 * H], r: [0.55, 0, 0] })
  k.group({ p: [0, hb + 0.205 * H, 0.245 * H], r: [1.95, 0, 0] }, () => {
    k.add(cyl(0.032 * H, 0.05 * H, 0.15 * H, 12), PAINT.horse, {})
    k.add(sphere(0.05 * H, 12, 8), PAINT.horse, { p: [0, -0.07 * H, 0] })
    k.add(sphere(0.034 * H, 12, 8), PAINT.horseDark, { p: [0, 0.075 * H, 0.004] })
  })
  k.add(box(0.022 * H, 0.17 * H, 0.04 * H), PAINT.mane, { p: [0, hb + 0.15 * H, 0.12 * H], r: [0.55, 0, 0] })
  for (const sx of [-1, 1]) k.add(cone(0.014 * H, 0.05 * H, 5), PAINT.mane, { p: [sx * 0.024 * H, hb + 0.285 * H, 0.215 * H], r: [-0.35, 0, sx * 0.15] })
  const legLen = hb - Y0
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    k.add(cyl(0.027 * H, 0.022 * H, legLen, 8), PAINT.horse, { p: [sx * 0.058 * H, Y0 + legLen / 2, sz * 0.12 * H - 0.01] })
    k.add(cyl(0.025 * H, 0.028 * H, 0.04, 8), PAINT.horseDark, { p: [sx * 0.058 * H, Y0 + 0.02, sz * 0.12 * H - 0.01] })
  }
  k.add(cone(0.036 * H, 0.22 * H, 8), PAINT.mane, { p: [0, hb - 0.04, -0.24 * H], r: [-2.75, 0, 0] })
  // saddle cloth draped over the back
  k.team(cyl(0.113 * H + 0.004, 0.113 * H + 0.004, 0.17 * H, 14, true), 0.4, { p: [0, hb, -0.03], r: [Math.PI / 2, 0, 0] })
  // rider
  const hy = addPeg(k, { scale: 0.8, y: hb + 0.03 })
  k.add(dome(0.076, 14, 6, 0.52), PAINT.steel, { p: [0, hy + 0.004, 0] })
  k.add(torus(0.075, 0.009, 5, 18), PAINT.steelDark, { p: [0, hy + 0.004, 0], r: [Math.PI / 2, 0, 0] })
  k.team(sphere(1, 10, 6), 1, { p: [0, hy + 0.08, -0.004], s: [0.021, 0.042, 0.072] })
  // lance with a pennant
  k.group({ p: [0.15, 0, 0.07], r: [0.06, 0, -0.05] }, () => {
    k.add(cyl(0.011, 0.013, 0.9, 7), PAINT.wood, { p: [0, 0.66, 0] })
    k.add(cone(0.024, 0.09, 7), PAINT.steel, { p: [0, 1.155, 0] })
    k.team(slab([[0, 0], [0.24, -0.045], [0.16, -0.06], [0.24, -0.1], [0, -0.115]], 0.012), 1.05, { p: [0.008, 1.08, 0], flutter: (x) => Math.max(0, x / 0.24) })
  })
  k.add(sphere(0.029, 10, 8), PAINT.skin, { p: [0.145, hb + 0.2, 0.08] })
}

function settler(k: Kit) {
  addBase(k)
  const hy = addPeg(k, { scale: 0.94, y: Y0 })
  // wide straw hat
  k.add(cyl(0.135, 0.14, 0.014, 20), PAINT.straw, { p: [0, hy + 0.045, 0] })
  k.add(cyl(0.062, 0.072, 0.06, 14), PAINT.straw, { p: [0, hy + 0.08, 0] })
  k.team(cyl(0.073, 0.073, 0.016, 14), 0.9, { p: [0, hy + 0.06, 0] })
  // bundle on the back
  k.add(sphere(0.095, 12, 10), PAINT.cloth, { p: [-0.01, 0.33, -0.12], s: [1, 0.85, 0.78] })
  k.add(torus(0.08, 0.009, 4, 16), PAINT.leather, { p: [-0.01, 0.34, -0.12], r: [0, 0, 0.2] })
  // handcart on the right
  k.group({ p: [0.235, 0, 0.0], r: [0, 0.12, 0] }, () => {
    k.add(box(0.15, 0.04, 0.24), PAINT.wood, { p: [0, 0.16, 0] })
    k.add(box(0.16, 0.05, 0.012), PAINT.woodDark, { p: [0, 0.195, 0.115] })
    k.add(box(0.16, 0.05, 0.012), PAINT.woodDark, { p: [0, 0.195, -0.115] })
    for (const sx of [-1, 1]) {
      k.add(cyl(0.075, 0.075, 0.024, 14), PAINT.woodDark, { p: [sx * 0.088, Y0 + 0.075, -0.01], r: [0, 0, Math.PI / 2] })
      k.add(cyl(0.022, 0.022, 0.03, 8), PAINT.steelDark, { p: [sx * 0.092, Y0 + 0.075, -0.01], r: [0, 0, Math.PI / 2] })
      k.add(cyl(0.008, 0.008, 0.2, 5), PAINT.wood, { p: [sx * 0.05, 0.15, 0.2], r: [Math.PI / 2 - 0.25, 0, 0] })
    }
    k.add(sphere(0.06, 10, 8), PAINT.clothDark, { p: [-0.03, 0.22, -0.04], s: [1, 0.8, 1.2] })
    k.add(sphere(0.05, 10, 8), PAINT.cloth, { p: [0.035, 0.215, 0.05], s: [1, 0.8, 1] })
    k.add(cyl(0.022, 0.022, 0.12, 10), PAINT.straw, { p: [0.0, 0.21, 0.04], r: [Math.PI / 2, 0, 0.4] })
    // little banner
    k.add(cyl(0.008, 0.009, 0.62, 6), PAINT.wood, { p: [0.06, 0.48, -0.1] })
    k.add(cyl(0.006, 0.006, 0.13, 5), PAINT.wood, { p: [0.0, 0.775, -0.1], r: [0, 0, Math.PI / 2] })
    k.team(box(0.12, 0.14, 0.01), 1.05, { p: [0.0, 0.7, -0.1], flutter: (_x, y) => Math.max(0, (0.07 - y) / 0.14) * 0.8 })
    k.team(slab([[-0.06, 0], [0.06, 0], [0, -0.035]], 0.01), 1.05, { p: [0, 0.63, -0.1], flutter: () => 0.85 })
  })
  k.add(sphere(0.03, 10, 8), PAINT.skin, { p: [0.13, 0.27, 0.12] })
}

const UNIT_BUILDERS: Record<UnitType, (k: Kit) => void> = { spear, archer, rider, settler }

export interface ModelGeo { neutral: THREE.BufferGeometry; team: THREE.BufferGeometry; sil?: THREE.BufferGeometry }

const unitCache = new Map<UnitType, ModelGeo>()
export function unitModel(type: UnitType): ModelGeo {
  let g = unitCache.get(type)
  if (!g) {
    const k = new Kit()
    UNIT_BUILDERS[type](k)
    g = k.build()
    unitCache.set(type, g)
  }
  return g
}

// ---------------------------------------------------------------------------------------------
// Cities. Houses face +z, sit on y = 0. Walls are white in vertex colour so the instance colour
// can tint them (ivory, stone, cream). Roofs are team geometry.

export function houseModel(): ModelGeo {
  const k = new Kit()
  const w = 0.2
  const d = 0.25
  const h = 0.15
  k.add(box(w, h, d), '#FFFFFF', { p: [0, h / 2, 0] })
  k.add(box(w + 0.012, 0.03, d + 0.012), '#C9BFAE', { p: [0, 0.015, 0] })
  k.add(box(0.058, 0.09, 0.012), PAINT.door, { p: [0.0, 0.045, d / 2 + 0.004] })
  for (const sz of [-1, 1]) k.add(box(0.012, 0.045, 0.05), PAINT.window, { p: [w / 2 + 0.004, 0.09, sz * 0.06] })
  k.add(box(0.012, 0.045, 0.05), PAINT.window, { p: [-w / 2 - 0.004, 0.09, 0.0] })
  k.add(box(0.042, 0.13, 0.042), '#B8AE9E', { p: [0.052, h + 0.07, -0.07] })
  k.add(box(0.05, 0.016, 0.05), '#8E8579', { p: [0.052, h + 0.14, -0.07] })
  // roof: gable prism with overhang, ridge along z
  const rw = w / 2 + 0.03
  const rh = 0.12
  k.team(slab([[-rw, 0], [rw, 0], [0, rh]], d + 0.05), 1, { p: [0, h, 0] })
  k.team(box(0.02, 0.016, d + 0.06), 0.62, { p: [0, h + rh - 0.002, 0] })
  return k.build()
}

/** Chimney top in house-local space (for smoke). */
export const CHIMNEY_TOP = new THREE.Vector3(0.052, 0.31, -0.07)

export function towerModel(): ModelGeo {
  const k = new Kit()
  k.add(cyl(0.1, 0.112, 0.4, 16), '#FFFFFF', { p: [0, 0.2, 0] })
  k.add(cyl(0.125, 0.115, 0.05, 16), '#E9E2D4', { p: [0, 0.425, 0] })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    k.add(box(0.045, 0.045, 0.035), '#E9E2D4', { p: [Math.cos(a) * 0.112, 0.47, Math.sin(a) * 0.112], r: [0, -a, 0] })
  }
  k.add(box(0.03, 0.06, 0.012), PAINT.window, { p: [0, 0.3, 0.104] })
  k.add(box(0.036, 0.085, 0.012), PAINT.door, { p: [0, 0.042, 0.111] })
  k.team(cone(0.112, 0.2, 16), 1, { p: [0, 0.55, 0] })
  k.add(cyl(0.005, 0.005, 0.14, 5), PAINT.woodDark, { p: [0, 0.7, 0] })
  k.team(slab([[0, 0], [0.1, -0.025], [0, -0.05]], 0.008), 1.05, { p: [0.004, 0.765, 0], flutter: (x) => Math.max(0, x / 0.1) })
  return k.build()
}
export const TOWER_TOP = 0.77

export function hallModel(): ModelGeo {
  // A longer house with a taller roof and a banner: the heart of a non-capital town.
  const k = new Kit()
  const w = 0.24
  const d = 0.34
  const h = 0.18
  k.add(box(w, h, d), '#FFFFFF', { p: [0, h / 2, 0] })
  k.add(box(w + 0.014, 0.034, d + 0.014), '#C9BFAE', { p: [0, 0.017, 0] })
  k.add(box(0.07, 0.11, 0.012), PAINT.door, { p: [0, 0.055, d / 2 + 0.004] })
  for (const sz of [-1, 0, 1]) k.add(box(0.012, 0.05, 0.05), PAINT.window, { p: [w / 2 + 0.004, 0.11, sz * 0.1] })
  const rw = w / 2 + 0.035
  k.team(slab([[-rw, 0], [rw, 0], [0, 0.16]], d + 0.06), 1, { p: [0, h, 0] })
  k.team(box(0.022, 0.018, d + 0.07), 0.62, { p: [0, h + 0.158, 0] })
  k.add(cyl(0.006, 0.006, 0.2, 5), PAINT.woodDark, { p: [0, h + 0.25, d / 2 - 0.02] })
  k.team(slab([[0, 0], [0.11, -0.025], [0, -0.055]], 0.008), 1.05, { p: [0.004, h + 0.345, d / 2 - 0.02], flutter: (x) => Math.max(0, x / 0.11) })
  return k.build()
}

/** Circular crenellated wall (radius ~0.8) with four small towers. Stone, neutral. */
export function wallModel(): THREE.BufferGeometry {
  const k = new Kit()
  const ro = 0.815
  const ri = 0.765
  const h = 0.085
  const stone = '#FFFFFF'
  k.add(new THREE.CylinderGeometry(ro, ro + 0.008, h, 64, 1, true), stone, { p: [0, h / 2, 0] })
  k.add(lathe([[ri, h], [ri, 0]], 64), stone, {})
  k.add(lathe([[ro, h], [ri, h]], 64), stone, {})
  const n = 40
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2
    k.add(box(0.05, 0.04, 0.05), stone, { p: [Math.cos(a) * (ro + ri) / 2, h + 0.02, Math.sin(a) * (ro + ri) / 2], r: [0, -a, 0] })
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    k.add(cyl(0.062, 0.068, 0.15, 12), stone, { p: [Math.cos(a) * 0.79, 0.075, Math.sin(a) * 0.79] })
    k.add(cyl(0.072, 0.064, 0.03, 12), '#EAE4D8', { p: [Math.cos(a) * 0.79, 0.16, Math.sin(a) * 0.79] })
  }
  return k.build().neutral
}

export function plazaModel(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(lathe([[0.35, 0], [0.35, 0.006], [0.34, 0.012], [0, 0.014]], 40), '#FFFFFF', {})
  k.add(lathe([[0.3, 0.0141], [0.292, 0.0142], [0.284, 0.0143]], 40), '#C8B898', {})
  return k.build().neutral
}

// ---------------------------------------------------------------------------------------------
// Props

/** Arrow along +z, nock at z = 0. */
export function arrowModel(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(cyl(0.007, 0.007, 0.3, 5), PAINT.wood, { p: [0, 0, 0.15], r: [Math.PI / 2, 0, 0] })
  k.add(cone(0.02, 0.06, 6), PAINT.steelDark, { p: [0, 0, 0.32], r: [Math.PI / 2, 0, 0] })
  k.add(box(0.002, 0.03, 0.06), PAINT.ivory, { p: [0, 0, 0.04] })
  k.add(box(0.03, 0.002, 0.06), PAINT.ivory, { p: [0, 0, 0.04] })
  return k.build().neutral
}

/** A small flag on a pole (found marker). Cloth is a separate subdivided plane so it can wave. */
export function flagPole(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(cyl(0.012, 0.014, 0.6, 7), PAINT.wood, { p: [0, 0.3, 0] })
  k.add(sphere(0.022, 8, 6), '#D8B464', { p: [0, 0.61, 0] })
  k.add(cyl(0.05, 0.06, 0.03, 10), PAINT.woodDark, { p: [0, 0.015, 0] })
  return k.build().neutral
}
