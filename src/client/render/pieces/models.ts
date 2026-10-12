// Procedural painted miniatures. Units stand on a round base (radius BASE_R) in local space,
// facing +z, base bottom at y = 0. Figures have faces, arms and boots, capes and cloth that
// flutter; their `idle` channel lets them breathe and shift their weight in the vertex shader.
import * as THREE from 'three'
import type { UnitType } from '../../../engine/types.ts'
import { Kit, type Model, type V3, box, capsule, cone, cyl, dome, lathe, shell, slab, sphere, torus } from './kit.ts'

export const BASE_R = 0.37
export const BASE_H = 0.058

/** Neutral paint, sRGB. Warm, slightly desaturated so the team colours sing. */
export const PAINT = {
  skin: '#EDB894',
  skinShade: '#D99E7B',
  cheek: '#E99A88',
  eye: '#2A2220',
  hair: '#5A3A28',
  hairLight: '#9A6A3E',
  wood: '#8E5E3B',
  woodDark: '#6A4329',
  woodLight: '#B2804F',
  steel: '#A9B0B9',
  steelDark: '#737A84',
  steelLight: '#C9CFD6',
  gold: '#D9AE4E',
  leather: '#6F4A33',
  leatherDark: '#4E3424',
  boot: '#4A3326',
  trousers: '#8A7B6C',
  moss: '#7D8466',
  ochre: '#C89B5A',
  cloth: '#EADBBB',
  clothDark: '#C9B48D',
  linen: '#F1E6D0',
  sack: '#D6C29A',
  straw: '#DDBE72',
  strawDark: '#BFA05A',
  horse: '#A06A45',
  horseLight: '#B98258',
  horseDark: '#5C3B29',
  mane: '#3B2A22',
  hoof: '#3A2E28',
  baseTop: '#E9DFCB',
  baseGroove: '#C9BC9F',
  ivory: '#F6EFE1',
}

const UP = new THREE.Vector3(0, 1, 0)
/** Placement for a y-axis primitive stretched from a to b. */
function between(a: V3, b: V3): { p: V3; r: V3; len: number } {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const d = vb.clone().sub(va)
  const len = d.length()
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
  const m = va.add(vb).multiplyScalar(0.5)
  return { p: [m.x, m.y, m.z], r: [e.x, e.y, e.z], len }
}

function limb(_k: Kit, a: V3, b: V3, r: number, paint: (g: THREE.BufferGeometry, o: { p: V3; r: V3 }) => void) {
  const t = between(a, b)
  paint(capsule(r, Math.max(0.001, t.len), 2, 8), { p: t.p, r: t.r })
}

// ---------------------------------------------------------------------------------------------
// Units

function addBase(k: Kit) {
  // Bevelled disc: the rim band and an outer ring on top are team-coloured, the centre is neutral.
  k.sil = false
  k.idle = 0
  k.team(lathe([[BASE_R - 0.012, 0], [BASE_R, 0.008], [BASE_R + 0.002, 0.016], [BASE_R + 0.002, 0.04], [BASE_R - 0.004, 0.052], [BASE_R - 0.018, BASE_H], [BASE_R - 0.06, BASE_H + 0.001]], 30), 1)
  k.add(torus(BASE_R - 0.001, 0.0035, 3, 40), PAINT.gold, { p: [0, 0.028, 0], r: [Math.PI / 2, 0, 0] })
  k.add(lathe([[BASE_R - 0.06, BASE_H + 0.001], [BASE_R - 0.066, BASE_H + 0.004], [0.2, BASE_H + 0.006], [0, BASE_H + 0.007]], 30), PAINT.baseTop)
  k.add(lathe([[BASE_R - 0.085, BASE_H + 0.0062], [BASE_R - 0.092, BASE_H + 0.0064], [BASE_R - 0.099, BASE_H + 0.0066]], 30), PAINT.baseGroove)
  k.sil = true
  k.idle = 1
}

const Y0 = BASE_H + 0.004

interface Peg {
  /** Head centre. */
  hy: number
  /** Shoulder height. */
  sy: number
  s: number
  y: number
}

type Paint = (g: THREE.BufferGeometry, o: { p?: V3; r?: V3; s?: V3 | number }) => void

interface FigureOpts {
  scale?: number
  y?: number
  /** Legs, trousers and boots (riders sit, so they have none here). */
  legs?: boolean
  trousers?: string
  /** Paint for the tunic (default: team base). */
  tunic?: Paint
  /** Paint for the hem band (default: team dark). */
  hem?: Paint
}

/** A miniature figure: boots, trousers, a tunic with a dark hem and ivory trim, belt, a face. */
function figure(k: Kit, o: FigureOpts = {}): Peg {
  const s = o.scale ?? 1
  const y = o.y ?? Y0
  const tunic: Paint = o.tunic ?? ((g, p) => k.team(g, 1, p))
  const hem: Paint = o.hem ?? ((g, p) => k.teamDark(g, 1, p))
  if (o.legs !== false) {
    for (const sx of [-1, 1]) {
      limb(k, [sx * 0.044 * s, y + 0.17 * s, 0], [sx * 0.046 * s, y + 0.05 * s, 0.006 * s], 0.031 * s, (g, p) => k.add(g, o.trousers ?? PAINT.trousers, p))
      k.add(capsule(0.029 * s, 0.032 * s, 3, 8), PAINT.boot, { p: [sx * 0.046 * s, y + 0.026 * s, 0.022 * s], r: [Math.PI / 2, 0, 0] })
      k.add(torus(0.03 * s, 0.006 * s, 4, 12), PAINT.leatherDark, { p: [sx * 0.046 * s, y + 0.058 * s, 0.006 * s], r: [Math.PI / 2, 0, 0] })
    }
  }
  // tunic to the knee: a flared skirt below the belt, the chest above
  const belt = 0.215
  const skirt: [number, number][] = [[0, 0.118], [0.106, 0.118], [0.116, 0.128], [0.11, 0.165], [0.1, 0.2], [0.097, belt]]
  const chest: [number, number][] = [[0.097, belt], [0.094, 0.235], [0.1, 0.28], [0.108, 0.315], [0.104, 0.345], [0.084, 0.372], [0.048, 0.388], [0, 0.392]]
  tunic(lathe(skirt.map(([r, h]) => [r * s, y + h * s]), 18), {})
  tunic(lathe(chest.map(([r, h]) => [r * s, y + h * s]), 18), {})
  hem(torus(0.113 * s, 0.011 * s, 4, 22), { p: [0, y + 0.13 * s, 0], r: [Math.PI / 2, 0, 0] })
  k.add(torus(0.111 * s, 0.004 * s, 3, 22), PAINT.ivory, { p: [0, y + 0.146 * s, 0], r: [Math.PI / 2, 0, 0] })
  // belt with a buckle
  k.add(torus(0.099 * s, 0.013 * s, 5, 22), PAINT.leather, { p: [0, y + belt * s, 0], r: [Math.PI / 2, 0, 0] })
  k.add(box(0.03 * s, 0.026 * s, 0.012 * s), PAINT.gold, { p: [0, y + belt * s, 0.105 * s] })
  // neck and head with a face
  k.add(cyl(0.032 * s, 0.038 * s, 0.05 * s, 10), PAINT.skinShade, { p: [0, y + 0.397 * s, 0] })
  const hy = y + 0.462 * s
  face(k, hy, s)
  return { hy, sy: y + 0.33 * s, s, y }
}

function face(k: Kit, hy: number, s: number, hair = PAINT.hair) {
  const r = 0.083 * s
  k.add(sphere(r, 16, 11), PAINT.skin, { p: [0, hy, 0] })
  for (const sx of [-1, 1]) {
    k.add(sphere(0.011 * s, 6, 4), PAINT.eye, { p: [sx * 0.029 * s, hy + 0.012 * s, 0.073 * s] })
    k.add(sphere(0.004 * s, 4, 3), PAINT.ivory, { p: [sx * 0.026 * s, hy + 0.016 * s, 0.083 * s] })
    k.add(sphere(0.015 * s, 6, 4), PAINT.cheek, { p: [sx * 0.047 * s, hy - 0.019 * s, 0.062 * s], s: [1, 0.7, 0.6] })
  }
  k.add(sphere(0.012 * s, 6, 4), PAINT.skinShade, { p: [0, hy - 0.004 * s, 0.083 * s] })
  k.add(dome(0.088 * s, 12, 5, 0.55), hair, { p: [0, hy + 0.004 * s, -0.008 * s], r: [-1.05, 0, 0] })
}

/** An arm from the shoulder to a hand (team sleeve with a light cuff, skin hand). */
function arm(k: Kit, peg: Peg, side: 1 | -1, hand: V3, sleeve: Paint = (g, o) => k.team(g, 1, o)) {
  const sh: V3 = [side * 0.098 * peg.s, peg.sy, 0]
  const el: V3 = [sh[0] + (hand[0] - sh[0]) * 0.6, sh[1] + (hand[1] - sh[1]) * 0.6, sh[2] + (hand[2] - sh[2]) * 0.6]
  limb(k, sh, el, 0.031 * peg.s, sleeve)
  limb(k, el, hand, 0.026 * peg.s, sleeve)
  const cuff = between(el, hand)
  const c: V3 = [hand[0] + (el[0] - hand[0]) * 0.18, hand[1] + (el[1] - hand[1]) * 0.18, hand[2] + (el[2] - hand[2]) * 0.18]
  k.teamLight(cyl(0.029 * peg.s, 0.029 * peg.s, 0.02 * peg.s, 10), 1, { p: c, r: cuff.r })
  k.add(sphere(0.03 * peg.s, 8, 6), PAINT.skin, { p: hand })
}

/** A cape in the dark tone, hanging from the shoulders and fluttering at the hem. */
function cape(k: Kit, peg: Peg, len = 0.27, flare = 0.15) {
  const top = peg.sy + 0.04 * peg.s
  const h = len * peg.s
  k.teamDark(shell(0.094 * peg.s, flare * peg.s, h, Math.PI * 1.15, 14), 1, {
    p: [0, top - h / 2, -0.012 * peg.s], r: [0, Math.PI, 0],
    flutter: (_x, y) => Math.max(0, (h / 2 - y) / h) * 1.2,
  })
  for (const sx of [-1, 1]) k.add(sphere(0.014 * peg.s, 8, 6), PAINT.gold, { p: [sx * 0.07 * peg.s, top - 0.01, 0.04 * peg.s] })
}

function helmet(k: Kit, hy: number, s = 1, crest = true) {
  // sits above the eyes so the face stays visible
  const y = hy + 0.028 * s
  k.add(dome(0.09 * s, 18, 7, 0.5), PAINT.steel, { p: [0, y, -0.006 * s] })
  k.add(torus(0.089 * s, 0.011 * s, 5, 22), PAINT.steelDark, { p: [0, y, -0.006 * s], r: [Math.PI / 2, 0, 0] })
  k.add(box(0.014 * s, 0.045 * s, 0.012 * s), PAINT.steelDark, { p: [0, y - 0.015 * s, 0.086 * s] })
  k.add(box(0.012 * s, 0.09 * s, 0.006 * s), PAINT.steelLight, { p: [0, y + 0.045 * s, 0.03 * s], r: [-0.75, 0, 0] })
  k.add(sphere(0.012 * s, 8, 6), PAINT.gold, { p: [0, y + 0.09 * s, 0] })
  if (crest) {
    // a horsehair crest: light on top, base below
    k.teamLight(sphere(1, 14, 8), 1, { p: [0, y + 0.1 * s, -0.016 * s], s: [0.024 * s, 0.05 * s, 0.092 * s] })
    k.team(sphere(1, 10, 6), 0.9, { p: [0, y + 0.075 * s, -0.07 * s], s: [0.02 * s, 0.05 * s, 0.03 * s] })
  }
}

/** A row of little gold beads along a banner's edge (they flutter with the cloth). */
function fringe(k: Kit, x0: number, x1: number, y: number, z: number, flutter: (x: number) => number, n = 8) {
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n
    k.add(sphere(0.0055, 4, 3), PAINT.gold, { p: [x, y, z], flutter: () => flutter(x) })
  }
}

function spear(k: Kit) {
  addBase(k)
  const peg = figure(k)
  // a tabard stripe in the light tone and steel pauldrons
  k.teamLight(box(0.05, 0.15, 0.012), 1, { p: [0, 0.335, 0.098], r: [-0.08, 0, 0] })
  k.add(box(0.05, 0.012, 0.014), PAINT.gold, { p: [0, 0.405, 0.094] })
  for (const sx of [-1, 1]) k.add(dome(0.05, 12, 5, 0.5), PAINT.steel, { p: [sx * 0.09, peg.sy + 0.012, 0], r: [0, 0, sx * -0.5] })
  cape(k, peg, 0.29, 0.15)
  helmet(k, peg.hy)
  // spear held upright in the right hand, a light ribbon under the head
  const hand: V3 = [0.158, 0.31, 0.09]
  arm(k, peg, 1, hand)
  k.group({ p: [0.162, 0, 0.095], r: [0.08, 0, -0.035] }, () => {
    k.add(cyl(0.012, 0.014, 0.94, 7), PAINT.wood, { p: [0, 0.5, 0] })
    k.add(cyl(0.017, 0.017, 0.03, 8), PAINT.steelDark, { p: [0, 0.96, 0] })
    k.add(slab([[0, 0], [0.026, 0.05], [0, 0.15], [-0.026, 0.05]], 0.01), PAINT.steel, { p: [0, 0.97, 0] })
    k.teamLight(box(0.014, 0.07, 0.004), 1, { p: [0.01, 0.91, 0], r: [0, 0, 0.2], flutter: (_x, y) => Math.max(0, 0.6 - y * 8) })
    k.add(cyl(0.016, 0.013, 0.025, 7), PAINT.steelDark, { p: [0, 0.035, 0] })
  })
  // round shield on the left with a painted chevron: dark field, ivory edge, light chevron
  arm(k, peg, -1, [-0.12, 0.24, 0.1])
  k.group({ p: [-0.1, 0.235, 0.125], r: [0.12, -0.62, 0] }, () => {
    k.teamDark(cyl(0.15, 0.15, 0.026, 28), 1, { r: [Math.PI / 2, 0, 0] })
    k.add(torus(0.15, 0.014, 5, 32), PAINT.woodDark, {})
    k.add(torus(0.128, 0.005, 3, 32), PAINT.ivory, { p: [0, 0, 0.012] })
    for (const sx of [-1, 1]) {
      k.add(box(0.16, 0.054, 0.02), PAINT.ivory, { p: [sx * 0.052, -0.02, 0.008], r: [0, 0, sx * 0.62] })
      k.teamLight(box(0.15, 0.036, 0.026), 1, { p: [sx * 0.052, -0.02, 0.01], r: [0, 0, sx * 0.62] })
    }
    k.add(sphere(0.04, 14, 10), PAINT.steel, { p: [0, 0.035, 0.014], s: [1, 1, 0.55] })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      k.add(sphere(0.009, 5, 3), PAINT.gold, { p: [Math.cos(a) * 0.138, Math.sin(a) * 0.138, 0.014] })
    }
  })
}

function archer(k: Kit) {
  addBase(k)
  const peg = figure(k, { trousers: PAINT.moss })
  // leather jerkin over the tunic, a strap across the chest
  k.add(lathe([[0.104, 0.24], [0.108, 0.3], [0.104, 0.345], [0.086, 0.37], [0.05, 0.384]].map(([r, h]) => [r + 0.003, Y0 + h]), 18), PAINT.leather)
  k.add(box(0.02, 0.3, 0.012), PAINT.leatherDark, { p: [0.0, 0.3, 0.1], r: [0, 0, 0.62] })
  cape(k, peg, 0.2, 0.13)
  // hood in the light tone with a darker lining
  k.teamLight(dome(0.096, 18, 8, 0.62), 1, { p: [0, peg.hy + 0.004, -0.016], r: [-0.28, 0, 0] })
  k.teamLight(cone(0.048, 0.11, 8), 0.95, { p: [0, peg.hy + 0.02, -0.1], r: [-2.15, 0, 0] })
  k.teamDark(torus(0.082, 0.015, 5, 18, Math.PI * 1.2), 1, { p: [0, peg.hy - 0.005, 0.018], r: [0.3, 0, Math.PI * -0.1] })
  // quiver on the back with fletched arrows
  k.group({ p: [0.06, 0.31, -0.12], r: [0.25, 0, -0.42] }, () => {
    k.add(cyl(0.044, 0.036, 0.26, 12), PAINT.leather, {})
    k.add(torus(0.044, 0.008, 4, 16), PAINT.gold, { p: [0, 0.125, 0], r: [Math.PI / 2, 0, 0] })
    k.add(torus(0.04, 0.006, 4, 16), PAINT.leatherDark, { p: [0, -0.06, 0], r: [Math.PI / 2, 0, 0] })
    k.teamDark(box(0.05, 0.08, 0.006), 1, { p: [0, 0.02, 0.04] })
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      k.add(cyl(0.005, 0.005, 0.1, 4), PAINT.wood, { p: [Math.cos(a) * 0.018, 0.16, Math.sin(a) * 0.018] })
      if (i % 2) k.add(cone(0.018, 0.05, 4), PAINT.ivory, { p: [Math.cos(a) * 0.018, 0.215, Math.sin(a) * 0.018] })
      else k.teamLight(cone(0.018, 0.05, 4), 1, { p: [Math.cos(a) * 0.018, 0.215, Math.sin(a) * 0.018] })
    }
  })
  // bow in the left hand with a leather grip
  const arc = 2.3
  const bx = -0.055
  const by = 0.33
  const bz = 0.1
  k.add(torus(0.21, 0.012, 5, 26, arc), PAINT.wood, { p: [bx, by, bz], r: [0, 0, Math.PI - arc / 2] })
  const ex = bx - Math.cos(arc / 2) * 0.21
  const ey = Math.sin(arc / 2) * 0.21
  k.add(cyl(0.0035, 0.0035, ey * 2, 4), PAINT.linen, { p: [ex, by, bz] })
  for (const sy of [-1, 1]) k.add(sphere(0.008, 5, 4), PAINT.gold, { p: [ex, by + sy * ey, bz] })
  arm(k, peg, -1, [bx - 0.205, by, bz])
  k.add(box(0.02, 0.05, 0.022), PAINT.leatherDark, { p: [bx - 0.21, by, bz] })
  k.add(cyl(0.03, 0.03, 0.04, 10), PAINT.leather, { p: [bx - 0.17, by, bz], r: [0, 0, Math.PI / 2] })
  arm(k, peg, 1, [0.11, 0.3, 0.09])
}

function rider(k: Kit) {
  addBase(k)
  k.idle = 0.5
  const H = 1.22
  const hb = Y0 + 0.25 * H
  // horse: barrel, chest and hindquarters, a paler belly
  k.add(capsule(0.088 * H, 0.17 * H, 6, 16), PAINT.horse, { p: [0, hb, -0.01], r: [Math.PI / 2, 0, 0] })
  k.add(sphere(0.092 * H, 16, 12), PAINT.horse, { p: [0, hb + 0.02, 0.1 * H], s: [0.9, 1, 0.95] })
  k.add(sphere(0.098 * H, 16, 12), PAINT.horse, { p: [0, hb + 0.014, -0.12 * H] })
  k.add(sphere(0.06 * H, 12, 8), PAINT.horseLight, { p: [0, hb - 0.045, 0.02], s: [1.2, 0.6, 2.2] })
  // neck rising high
  k.add(capsule(0.045 * H, 0.17 * H, 4, 12), PAINT.horse, { p: [0, hb + 0.14 * H, 0.17 * H], r: [0.38, 0, 0] })
  // the head nods (idle 2) with a blaze, bridle and ears
  k.idle = 2
  k.group({ p: [0, hb + 0.25 * H, 0.235 * H], r: [2.25, 0, 0] }, () => {
    k.add(cyl(0.028 * H, 0.046 * H, 0.15 * H, 12), PAINT.horse, {})
    k.add(sphere(0.046 * H, 12, 8), PAINT.horse, { p: [0, -0.07 * H, 0] })
    k.add(sphere(0.031 * H, 12, 8), PAINT.horseDark, { p: [0, 0.075 * H, 0.004] })
    k.add(box(0.016 * H, 0.1 * H, 0.006), PAINT.linen, { p: [0, 0.0, 0.03 * H], r: [0.12, 0, 0] })
    for (const sx of [-1, 1]) {
      k.add(sphere(0.011 * H, 8, 6), PAINT.eye, { p: [sx * 0.037 * H, -0.045 * H, 0.016 * H] })
      k.add(sphere(0.006 * H, 6, 4), PAINT.hoof, { p: [sx * 0.015 * H, 0.1 * H, 0.02 * H] })
    }
    k.add(torus(0.033 * H, 0.005, 4, 16), PAINT.leatherDark, { p: [0, 0.035 * H, 0.002], r: [Math.PI / 2, 0, 0] })
    k.add(torus(0.045 * H, 0.005, 4, 16), PAINT.leatherDark, { p: [0, -0.04 * H, 0.002], r: [Math.PI / 2, 0, 0] })
    k.add(sphere(0.008, 6, 4), PAINT.gold, { p: [0.034 * H, 0.035 * H, 0] })
    k.teamLight(sphere(0.014, 8, 6), 1, { p: [0, -0.085 * H, 0.03 * H] })
    for (const sx of [-1, 1]) k.add(cone(0.014 * H, 0.055 * H, 5), PAINT.horseDark, { p: [sx * 0.022 * H, -0.105 * H, -0.02 * H], r: [-Math.PI - 0.2, 0, sx * 0.18] })
  })
  k.idle = 0.5
  // mane: tufts along the neck, a forelock
  for (let i = 0; i < 6; i++) {
    const f = i / 5
    k.add(box(0.024 * H, 0.045 * H, 0.038 * H), PAINT.mane, { p: [0, hb + (0.09 + f * 0.2) * H, (0.1 + f * 0.085) * H], r: [0.38 + (i % 2) * 0.15, 0, (i % 2 ? 1 : -1) * 0.1] })
  }
  // legs with knees, white socks and hooves
  const legLen = hb - Y0
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const x = sx * 0.058 * H
    const z = sz * 0.12 * H - 0.01
    const top: V3 = [x, hb - 0.02, z]
    const knee: V3 = [x, Y0 + legLen * 0.45, z + (sz > 0 ? 0.012 : -0.016)]
    const foot: V3 = [x, Y0 + 0.024, z + (sz > 0 ? 0.004 : 0)]
    limb(k, top, knee, 0.026 * H, (g, o) => k.add(g, PAINT.horse, o))
    limb(k, knee, foot, 0.019 * H, (g, o) => k.add(g, PAINT.horse, o))
    k.add(cyl(0.024 * H, 0.028 * H, 0.04, 10), PAINT.hoof, { p: [foot[0], Y0 + 0.02, foot[2]] })
    k.add(cyl(0.026 * H, 0.026 * H, 0.018, 10), PAINT.linen, { p: [foot[0], Y0 + 0.047, foot[2]] })
  }
  // tail
  k.add(cone(0.036 * H, 0.24 * H, 8), PAINT.mane, { p: [0, hb - 0.05, -0.245 * H], r: [-2.7, 0, 0], flutter: () => 0.3 })
  k.add(sphere(0.03 * H, 8, 6), PAINT.mane, { p: [0, hb + 0.04, -0.215 * H] })
  // saddle cloth in the light tone with a dark border and a gold fringe, saddle and stirrups
  const cr = 0.1 * H + 0.008
  k.teamLight(shell(cr, cr, 0.17 * H, Math.PI * 1.25, 18), 1, { p: [0, hb, -0.025], r: [-Math.PI / 2, 0, 0] })
  for (const sx of [-1, 1]) {
    const ex = sx * cr * 0.924
    const ey = hb - cr * 0.383
    k.teamDark(box(0.012, 0.018, 0.17 * H + 0.004), 1, { p: [ex, ey, -0.025] })
    for (let i = 0; i <= 8; i++) k.add(sphere(0.006, 4, 3), PAINT.gold, { p: [ex * 1.02, ey - 0.014, -0.025 - 0.085 * H + (0.17 * H * i) / 8] })
    k.add(box(0.01, 0.07, 0.01), PAINT.leatherDark, { p: [sx * 0.104 * H, hb - 0.05, 0.035] })
    k.add(torus(0.016, 0.005, 4, 10), PAINT.steelDark, { p: [sx * 0.106 * H, hb - 0.09, 0.045], r: [0, Math.PI / 2, 0] })
  }
  k.add(capsule(0.06, 0.07, 3, 12), PAINT.leather, { p: [0, hb + 0.1 * H, -0.03], r: [Math.PI / 2, 0, 0], s: [1.25, 1, 0.45] })
  k.add(box(0.006, 0.006, 0.17), PAINT.leatherDark, { p: [0.03, hb + 0.2, 0.15], r: [-0.55, 0, 0] })
  k.add(box(0.006, 0.006, 0.17), PAINT.leatherDark, { p: [-0.03, hb + 0.2, 0.15], r: [-0.55, 0, 0] })
  // rider, seated: legs over the saddle with boots in the stirrups
  k.idle = 1
  const peg = figure(k, { scale: 0.8, y: hb + 0.04, legs: false })
  for (const sx of [-1, 1]) {
    limb(k, [sx * 0.055, hb + 0.1, 0.0], [sx * 0.1 * H, hb + 0.03, 0.055], 0.028, (g, o) => k.add(g, PAINT.trousers, o))
    limb(k, [sx * 0.1 * H, hb + 0.03, 0.055], [sx * 0.105 * H, hb - 0.055, 0.03], 0.023, (g, o) => k.add(g, PAINT.trousers, o))
    k.add(capsule(0.022, 0.03, 3, 8), PAINT.boot, { p: [sx * 0.106 * H, hb - 0.075, 0.045], r: [Math.PI / 2, 0, 0] })
  }
  cape(k, peg, 0.24, 0.16)
  helmet(k, peg.hy, 0.8)
  arm(k, peg, -1, [-0.03, hb + 0.2, 0.12])
  // lance with a pennant (base tone, fringed)
  arm(k, peg, 1, [0.15, hb + 0.2, 0.08])
  k.group({ p: [0.155, 0, 0.085], r: [0.06, 0, -0.05] }, () => {
    k.add(cyl(0.011, 0.013, 0.92, 7), PAINT.wood, { p: [0, 0.66, 0] })
    k.add(slab([[0, 0], [0.02, 0.035], [0, 0.11], [-0.02, 0.035]], 0.009), PAINT.steel, { p: [0, 1.12, 0] })
    const fl = (x: number) => Math.max(0, x / 0.26)
    k.team(slab([[0, 0], [0.26, -0.045], [0.17, -0.062], [0.26, -0.105], [0, -0.12]], 0.008), 1.05, { p: [0.008, 1.1, 0], flutter: fl })
    k.teamLight(slab([[0, -0.045], [0.12, -0.056], [0.12, -0.066], [0, -0.075]], 0.01), 1, { p: [0.008, 1.1, 0], flutter: fl })
    k.add(box(0.03, 0.012, 0.012), PAINT.gold, { p: [0, 1.1, 0] })
  })
}

function wheel(k: Kit, r: number, p: V3) {
  k.group({ p, r: [0, 0, Math.PI / 2] }, () => {
    k.add(torus(r, 0.011, 5, 22), PAINT.woodDark, { r: [Math.PI / 2, 0, 0] })
    k.add(torus(r + 0.006, 0.004, 3, 22), PAINT.steelDark, { r: [Math.PI / 2, 0, 0] })
    for (let i = 0; i < 6; i++) k.add(box(0.008, r * 2, 0.008), PAINT.wood, { r: [0, (i / 6) * Math.PI, 0] })
    k.add(cyl(0.02, 0.02, 0.03, 10), PAINT.steelDark, {})
  })
}

function settler(k: Kit) {
  addBase(k)
  // a civilian in warm ochre with team accents: scarf, hat band and banner
  const ochre: Paint = (g, o) => k.add(g, PAINT.ochre, o)
  const peg = figure(k, { scale: 0.94, tunic: ochre, hem: (g, o) => k.teamDark(g, 1, o) })
  k.add(lathe([[0.1, 0.13], [0.108, 0.17], [0.104, 0.205]].map(([r, h]) => [r, Y0 + h]), 16), PAINT.linen)
  k.teamLight(torus(0.058, 0.02, 5, 16), 1, { p: [0, peg.hy - 0.07, 0], r: [Math.PI / 2, 0, 0] })
  k.teamLight(box(0.026, 0.06, 0.012), 1, { p: [0.03, peg.hy - 0.11, 0.07], r: [0.2, 0, 0.3], flutter: () => 0.3 })
  // straw hat with a team band, pushed back so the face shows
  k.group({ p: [0, peg.hy + 0.058, -0.03], r: [-0.42, 0, 0] }, () => {
    k.add(cyl(0.115, 0.12, 0.012, 22), PAINT.straw, {})
    k.add(cyl(0.058, 0.07, 0.06, 16), PAINT.straw, { p: [0, 0.035, 0] })
    k.team(cyl(0.071, 0.071, 0.017, 16), 1, { p: [0, 0.016, 0] })
  })
  // bedroll on the back
  k.teamDark(cyl(0.04, 0.04, 0.2, 12), 1, { p: [0, 0.36, -0.12], r: [0, 0, Math.PI / 2] })
  k.add(torus(0.042, 0.006, 4, 12), PAINT.leather, { p: [0.05, 0.36, -0.12], r: [0, Math.PI / 2, 0] })
  k.add(torus(0.042, 0.006, 4, 12), PAINT.leather, { p: [-0.05, 0.36, -0.12], r: [0, Math.PI / 2, 0] })
  arm(k, peg, 1, [0.13, 0.27, 0.12], ochre)
  arm(k, peg, -1, [-0.11, 0.25, 0.08], ochre)
  k.idle = 0
  k.group({ p: [0.215, 0, -0.06], r: [0, 0.55, 0] }, () => {
    k.add(box(0.16, 0.03, 0.25), PAINT.wood, { p: [0, 0.16, 0] })
    for (const sx of [-1, 1]) k.add(box(0.012, 0.055, 0.25), PAINT.woodLight, { p: [sx * 0.078, 0.2, 0] })
    k.add(box(0.16, 0.055, 0.012), PAINT.woodLight, { p: [0, 0.2, -0.12] })
    for (const sx of [-1, 1]) k.add(cyl(0.008, 0.008, 0.22, 5), PAINT.wood, { p: [sx * 0.05, 0.2, 0.2], r: [Math.PI / 2 - 0.3, 0, 0] })
    wheel(k, 0.078, [0.09, Y0 + 0.078, -0.02])
    wheel(k, 0.078, [-0.09, Y0 + 0.078, -0.02])
    k.add(sphere(0.06, 12, 10), PAINT.sack, { p: [-0.03, 0.225, -0.05], s: [1, 0.85, 1.2] })
    k.add(torus(0.02, 0.006, 4, 10), PAINT.leather, { p: [-0.03, 0.27, -0.05], r: [Math.PI / 2, 0, 0] })
    k.add(lathe([[0.034, 0], [0.04, 0.04], [0.034, 0.08]], 12), PAINT.woodLight, { p: [0.04, 0.18, 0.06] })
    k.add(torus(0.039, 0.004, 4, 12), PAINT.steelDark, { p: [0.04, 0.2, 0.06], r: [Math.PI / 2, 0, 0] })
    k.team(cyl(0.028, 0.028, 0.14, 10), 0.85, { p: [0.02, 0.215, -0.07], r: [0, 0, Math.PI / 2] })
    k.add(sphere(0.03, 10, 8), PAINT.steelDark, { p: [-0.04, 0.215, 0.07], s: [1, 0.8, 1] })
    // the banner on a crossbar: base tone, a light diamond, a gold fringe
    k.add(cyl(0.008, 0.009, 0.64, 6), PAINT.wood, { p: [0.06, 0.49, -0.1] })
    k.add(cyl(0.006, 0.006, 0.14, 5), PAINT.wood, { p: [0.0, 0.79, -0.1], r: [0, 0, Math.PI / 2] })
    k.add(sphere(0.012, 6, 5), PAINT.gold, { p: [0.06, 0.815, -0.1] })
    const fl = (_x: number, y: number) => Math.max(0, (0.075 - y) / 0.15) * 0.9
    k.team(box(0.13, 0.15, 0.008), 1.05, { p: [0.0, 0.71, -0.1], flutter: fl })
    k.teamLight(box(0.055, 0.055, 0.01), 1, { p: [0.0, 0.72, -0.1], r: [0, 0, Math.PI / 4], flutter: () => 0.3 })
    k.team(slab([[-0.065, 0], [0.065, 0], [0, -0.04]], 0.008), 1.05, { p: [0, 0.635, -0.1], flutter: () => 0.9 })
    fringe(k, -0.062, 0.062, 0.632, -0.1, () => 0.9, 7)
  })
}

const UNIT_BUILDERS: Record<UnitType, (k: Kit) => void> = { spear, archer, rider, settler }

const unitCache = new Map<UnitType, Model>()
export function unitModel(type: UnitType): Model {
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
// Props

/** Arrow along +z, nock at z = 0. */
export function arrowModel(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(cyl(0.007, 0.007, 0.3, 5), PAINT.wood, { p: [0, 0, 0.15], r: [Math.PI / 2, 0, 0] })
  k.add(cone(0.02, 0.06, 6), PAINT.steelDark, { p: [0, 0, 0.32], r: [Math.PI / 2, 0, 0] })
  k.add(box(0.002, 0.03, 0.06), PAINT.ivory, { p: [0, 0, 0.04] })
  k.add(box(0.03, 0.002, 0.06), PAINT.ivory, { p: [0, 0, 0.04] })
  return k.build().geo
}

/** A small flag on a pole (found marker). Cloth is a separate subdivided plane so it can wave. */
export function flagPole(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(cyl(0.012, 0.014, 0.6, 7), PAINT.wood, { p: [0, 0.3, 0] })
  k.add(sphere(0.022, 8, 6), PAINT.gold, { p: [0, 0.61, 0] })
  k.add(cyl(0.05, 0.06, 0.03, 10), PAINT.woodDark, { p: [0, 0.015, 0] })
  return k.build().geo
}
