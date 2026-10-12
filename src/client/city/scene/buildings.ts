// Every building type as a characterful miniature, built procedurally on its lot. Models are
// authored in plot-local space: the lot centre at the origin, y = 0 on the lot top, +x pointing out
// of the town (towards what an outer plot faces). The player's colour is the accent: roofs,
// awnings, banners, sails. Houses and working buildings glow warmly at the windows.

import * as THREE from 'three'
import type { BuildingType } from '../../../engine/city.ts'
import { BIOME, NATURE } from '../../render/palette.ts'
import { STREET_EDGE } from './board.ts'
import { birch, broadleaf, bush, fruitTree, tuft } from './flora.ts'
import {
  Kit, type Place, type RGB, box, cone, cyl, flat, gableEnds, gableRoof, hash, hexPts, ico, lathe, lin, mix, prism, rbox, rng, shade, sphere, spire, torus,
} from './geo.ts'
import { LOT_R as LOT_R_WORLD, LOT_Y, type PlotSpot, dirAngle } from './layout.ts'

/** Buildings are authored a little small and scaled up onto their lots by this much. */
export const S = 1.3
/** Lot circumradius in model units. */
const LOT_R = LOT_R_WORLD / S

export interface Team { base: string; light: string; dark: string }

export interface BuildCtx {
  spot: PlotSpot
  team: Team
  seed: number
  /** Worker buildings without a worker stay dark. */
  lit: boolean
  /** Local angle (radians, atan2(z, x) in plot space) towards water, for harbours. */
  waterDir: number
  /** Sea level relative to the lot top (negative). */
  waterY: number
  capital: boolean
  /** Leave out gardens and trees (construction sites). */
  bare?: boolean
}

export interface Spinner { geo: THREE.BufferGeometry; pivot: THREE.Vector3; axis: THREE.Vector3; speed: number }
export interface Bobber { geo: THREE.BufferGeometry; pivot: THREE.Vector3; seed: number }

export interface Model {
  geo: THREE.BufferGeometry
  spinners: Spinner[]
  bobbers: Bobber[]
  anchors: { name: string; p: THREE.Vector3; dir?: THREE.Vector3 }[]
  /** Highest point (for labels and construction). */
  height: number
}

// ---------------------------------------------------------------------------------------------
// Paint (sRGB). Warm and slightly desaturated so the player colour sings.

export const P = {
  plaster: ['#F4ECDD', '#F1E2C4', '#EFD7A6', '#E9CB9E', '#EDD0C0', '#D9DEC6', '#D3DADB', '#E8DACA'],
  trim: '#F7F1E6',
  timber: '#8E5E3B',
  timberDark: '#5E3D29',
  boards: '#9A6B45',
  falu: '#9E3C2C',
  stone: '#CFC4AE',
  stoneDark: '#AA9E88',
  granite: '#BDB6AA',
  glass: '#3A3431',
  door: '#6A4329',
  chimney: '#B7ADA1',
  brick: '#A65E44',
  iron: '#4A4B50',
  steel: '#9CA3AC',
  straw: '#E1C67C',
  strawDark: '#BFA05A',
  soil: '#8A6A4C',
  soilDark: '#6F533B',
  lawn: BIOME.grass.base,
  lawnLight: BIOME.grass.light,
  gravel: '#D9CDB5',
  sand: '#E2D2AE',
  cloth: '#F3EADB',
  gold: '#D9AE4E',
  rope: '#C8B48C',
  water: '#4FA9A6',
  skin: '#EBB896',
}

/** Wall colours that do not fight the player colour. */
function wallColour(team: Team, r: () => number): string {
  const t = new THREE.Color(team.base)
  const hsl = { h: 0, s: 0, l: 0 }
  t.getHSL(hsl)
  const ok = P.plaster.filter((c) => {
    const x = new THREE.Color(c)
    const h2 = { h: 0, s: 0, l: 0 }
    x.getHSL(h2)
    const dh = Math.min(Math.abs(h2.h - hsl.h), 1 - Math.abs(h2.h - hsl.h))
    return dh > 0.06 || h2.s < 0.18
  })
  return ok[Math.floor(r() * ok.length)] ?? P.plaster[0]
}

/** Some houses keep older roofs of slate or tarred shingle, so the town colour stays an accent. */
const NEUTRAL_ROOFS = ['#6F7A86', '#665247', '#7E766C']
function houseRoof(team: Team, r: () => number): RGB {
  return r() < 0.3 ? mix(lin(NEUTRAL_ROOFS[Math.floor(r() * NEUTRAL_ROOFS.length)]), lin('#8A8178'), r() * 0.2) : roofColour(team, r)
}

function roofColour(team: Team, r: () => number): RGB {
  const k = r()
  return k < 0.4 ? lin(team.base) : k < 0.75 ? mix(lin(team.base), lin(team.dark), 0.3) : mix(lin(team.base), lin(team.light), 0.22)
}

/** Barns and boathouses are falu red, unless the player is red; then tarred timber. */
function barnColour(team: Team): string {
  const c = new THREE.Color(team.base)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  const red = hsl.h < 0.06 || hsl.h > 0.95
  return red ? '#6E5039' : P.falu
}

// ---------------------------------------------------------------------------------------------
// Pieces

/** The lot: a low hex slab with kerb sides. */
function lot(k: Kit, ctx: BuildCtx, top: string | RGB, pattern: 'grass' | 'cobble' | 'sand' | 'pavers' | 'none' = 'grass', turf = false) {
  const rot = lotRot(ctx.spot)
  k.group({ s: 1 / S }, () => {
    if (turf) k.add(prism(hexPts(LOT_R_WORLD, rot), 0, LOT_Y, false), lin(BIOME.grass.dark, 0.9), { p: [0, -LOT_Y, 0] })
    else k.add(prism(hexPts(LOT_R_WORLD, rot), 0, LOT_Y, false), shade(lin('#B3A68E'), 0.95), { p: [0, -LOT_Y, 0] }, { pattern: 'stone' })
    k.add(flat(hexPts(LOT_R_WORLD, rot), 0), top, {}, { pattern })
  })
}

export function lotRot(spot: PlotSpot): number {
  const m = (((-spot.out) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)
  return m
}

/** A window on a wall facing +z in the current frame: frame, glass (glowing), mullions. */
function windowAt(k: Kit, x: number, y: number, z: number, rotY: number, w: number, h: number, glow: number, frame = P.trim) {
  k.group({ p: [x, y, z], r: [0, rotY, 0] }, () => {
    k.add(box(w + 0.018, h + 0.018, 0.008), frame, { p: [0, 0, 0.002] })
    k.add(box(w, h, 0.01), P.glass, { p: [0, 0, 0.004] }, { glow })
    k.add(box(0.006, h, 0.012), frame, { p: [0, 0, 0.006] })
    k.add(box(w, 0.006, 0.012), frame, { p: [0, h * 0.1, 0.006] })
    k.add(box(w + 0.03, 0.01, 0.024), frame, { p: [0, -h / 2 - 0.012, 0.01] })
  })
}

function doorAt(k: Kit, x: number, z: number, rotY: number, w = 0.075, h = 0.13, color = P.door) {
  k.group({ p: [x, 0, z], r: [0, rotY, 0] }, () => {
    k.add(box(w + 0.02, h + 0.012, 0.008), P.trim, { p: [0, h / 2 + 0.003, 0.002] })
    k.add(box(w, h, 0.012), color, { p: [0, h / 2, 0.005] }, { pattern: 'boards' })
    k.add(box(w + 0.03, 0.012, 0.03), P.stoneDark, { p: [0, 0.006, 0.02] })
    k.add(sphere(0.006, 5, 4), P.gold, { p: [w * 0.3, h * 0.48, 0.013] })
  })
}

interface HouseOpts {
  w: number; d: number; h: number; roofH: number
  wall: string; roof: RGB; seed: number; glow: number
  door?: 'front' | 'side' | 'none'
  chimney?: number | null
  storeys?: 1 | 2
  dormer?: boolean
  corners?: boolean
}

/** A gabled house, ridge along x, front (door) on +z. Returns the chimney top. */
function house(k: Kit, o: HouseOpts) {
  const { w, d, h, roofH } = o
  const r = rng(o.seed)
  k.add(box(w + 0.02, 0.035, d + 0.02), P.stoneDark, { p: [0, 0.0175, 0] }, { pattern: 'stone' })
  k.add(rbox(w, h, d, 0.008), o.wall, { p: [0, h / 2 + 0.02, 0] }, { pattern: 'plaster', jit: 0.02 })
  gableEnds(k, w, d, roofH, o.wall, { p: [0, h + 0.02, 0] })
  gableRoof(k, w, d, roofH, o.roof, { p: [0, h + 0.02, 0] }, { ridge: shade(o.roof, 0.72), over: 0.035, t: 0.024 })
  if (o.corners !== false) for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.016, h, 0.016), P.trim, { p: [sx * (w / 2 - 0.004), h / 2 + 0.02, sz * (d / 2 - 0.004)] })
  // eaves boards
  for (const sz of [-1, 1]) k.add(box(w + 0.07, 0.014, 0.012), P.trim, { p: [0, h + 0.016, sz * (d / 2 + 0.03)] })
  const storeys = o.storeys ?? 1
  const wy = (s: number) => 0.02 + (h / storeys) * (s + 0.55)
  const winW = 0.05, winH = 0.06
  // windows on the long sides
  const n = Math.max(1, Math.round(w / 0.17))
  for (let s = 0; s < storeys; s++) for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5)
    const front = o.door === 'front' && s === 0 && i === Math.floor(n / 2)
    if (!front) {
      windowAt(k, x, wy(s), d / 2, 0, winW, winH, o.glow * (r() < 0.75 ? 1 : 0.25))
      if (s === 0 && r() < 0.55) flowerBox(k, x, wy(s) - winH / 2 - 0.016, d / 2 + 0.014, r)
    }
    windowAt(k, x, wy(s), -d / 2, Math.PI, winW, winH, o.glow * (r() < 0.6 ? 1 : 0.2))
  }
  // a window in each gable
  for (const sx of [-1, 1]) windowAt(k, sx * w / 2, h + 0.02 + roofH * 0.32, 0, sx * Math.PI / 2, 0.04, 0.045, o.glow * 0.8)
  if (storeys === 2) for (const sx of [-1, 1]) windowAt(k, sx * w / 2, wy(0), 0, sx * Math.PI / 2, winW, winH, o.glow)
  if (o.door === 'front') doorAt(k, -w / 2 + (w / n) * (Math.floor(n / 2) + 0.5), d / 2, 0)
  else if (o.door === 'side') doorAt(k, w / 2, 0, Math.PI / 2)
  // a little porch roof over the front door
  if (o.door === 'front' && storeys === 2) {
    const dx = -w / 2 + (w / n) * (Math.floor(n / 2) + 0.5)
    k.add(box(0.12, 0.012, 0.06), o.roof, { p: [dx, 0.19, d / 2 + 0.03], r: [0.35, 0, 0] })
  }
  if (o.dormer) {
    const dz = d / 4 + 0.01
    k.group({ p: [w * 0.15, h + 0.02 + roofH * 0.3, dz] }, () => {
      k.add(box(0.1, 0.09, 0.09), o.wall, { p: [0, 0.03, 0] }, { pattern: 'plaster' })
      gableRoof(k, 0.1, 0.11, 0.05, o.roof, { p: [0, 0.075, 0], r: [0, Math.PI / 2, 0] }, { over: 0.012, t: 0.014 })
      windowAt(k, 0, 0.03, 0.046, 0, 0.04, 0.045, o.glow)
    })
  }
  if (o.chimney !== null && o.chimney !== undefined) {
    const cx = o.chimney * w / 2
    const cz = -d * 0.18
    const top = h + 0.02 + roofH * (1 - Math.abs(cz) / (d / 2)) + 0.07
    k.add(rbox(0.055, top - h, 0.055, 0.006), P.chimney, { p: [cx, h + (top - h) / 2, cz] }, { pattern: 'stone' })
    k.add(box(0.07, 0.016, 0.07), shade(lin(P.chimney), 0.85), { p: [cx, top, cz] })
    k.anchor('chimney', [cx, top + 0.01, cz])
  }
}

const BLOOMS = ['#E05A5A', '#F2CF5B', '#E86A8A', '#F4EFE2', '#D99AB8']

/** A window box of flowers on a wall facing +z. */
function flowerBox(k: Kit, x: number, y: number, z: number, r: () => number) {
  k.add(box(0.062, 0.016, 0.018), '#8E5E3B', { p: [x, y, z] })
  const c = BLOOMS[Math.floor(r() * BLOOMS.length)]
  for (let i = 0; i < 4; i++) k.add(ico(0.009, 0), i % 2 ? c : '#6E9A4F', { p: [x - 0.022 + i * 0.015, y + 0.013, z + 0.002] }, { flutter: 0.0015 })
}

/** A washing line between two posts with a few clothes drying. */
function washingLine(k: Kit, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const h = 0.13
  for (const [x, z] of [[x0, z0], [x1, z1]]) k.add(cyl(0.005, 0.005, h, 4), P.timberDark, { p: [x, h / 2, z] })
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0)
  k.add(box(len, 0.002, 0.002), '#EDE6D8', { p: [(x0 + x1) / 2, h - 0.006, (z0 + z1) / 2], r: [0, -ang, 0] })
  const cloth = ['#F4EFE6', '#6F88A6', '#E8C547', '#D9C49C', '#B86E52']
  const n = 4
  for (let i = 0; i < n; i++) {
    const t = (i + 0.7) / (n + 0.4)
    const w = 0.026 + hash(seed, i) * 0.012, hh = 0.03 + hash(seed, i + 5) * 0.02
    k.add(box(w, hh, 0.002), cloth[Math.floor(hash(seed, i + 9) * cloth.length)], { p: [x0 + (x1 - x0) * t, h - 0.008 - hh / 2, z0 + (z1 - z0) * t], r: [0, -ang, 0] }, { flutter: (_x, y) => Math.max(0, -y + hh / 2) * 0.12 })
  }
}

function fence(k: Kit, pts: [number, number][], color = '#E9E1D2', h = 0.07) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const ang = Math.atan2(bz - az, bx - ax)
    const n = Math.max(1, Math.round(len / 0.07))
    for (let j = 0; j <= n; j++) {
      const t = j / n
      k.add(box(0.01, h, 0.01), color, { p: [ax + (bx - ax) * t, h / 2, az + (bz - az) * t] })
    }
    for (const y of [h * 0.45, h * 0.85]) k.add(box(len, 0.007, 0.006), color, { p: [(ax + bx) / 2, y, (az + bz) / 2], r: [0, -ang, 0] })
  }
}

function barrel(k: Kit, x: number, z: number, s = 1, y = 0) {
  k.add(lathe([[0, 0], [0.026, 0], [0.032, 0.025], [0.026, 0.05], [0, 0.05]].map(([r, h]) => [r * s, h * s]) as [number, number][], 10), P.timber, { p: [x, y, z] }, { smooth: true })
  for (const hh of [0.012, 0.038]) k.add(torus(0.03 * s, 0.003 * s, 4, 12), P.iron, { p: [x, y + hh * s, z], r: [Math.PI / 2, 0, 0] })
}

function crate(k: Kit, x: number, z: number, s = 1, rot = 0, y = 0) {
  k.add(rbox(0.06 * s, 0.05 * s, 0.06 * s, 0.004), '#B48A5C', { p: [x, y + 0.025 * s, z], r: [0, rot, 0] }, { pattern: 'boards' })
}

function flagPole(k: Kit, x: number, z: number, h: number, team: Team, wide = 0.16) {
  k.add(cyl(0.007, 0.009, h, 6), '#E9E1D2', { p: [x, h / 2, z] })
  k.add(sphere(0.012, 6, 5), P.gold, { p: [x, h + 0.008, z] })
  const fh = wide * 0.62
  k.add(box(wide, fh, 0.006), team.base, { p: [x + wide / 2 + 0.006, h - fh / 2 - 0.02, z] }, { flutter: (fx) => Math.max(0, fx + wide / 2) * 0.12 })
  k.add(box(wide * 0.98, 0.012, 0.007), team.light, { p: [x + wide / 2 + 0.006, h - fh * 0.3 - 0.02, z] }, { flutter: (fx) => Math.max(0, fx + wide / 2) * 0.12 })
}

/** Little round person-sized marker used by models for static props like scarecrows. */
function strawDummy(k: Kit, x: number, z: number, rot: number) {
  k.group({ p: [x, 0, z], r: [0, rot, 0] }, () => {
    k.add(cyl(0.008, 0.008, 0.17, 5), P.timberDark, { p: [0, 0.085, 0] })
    k.add(cyl(0.005, 0.005, 0.11, 5), P.timberDark, { p: [0, 0.13, 0], r: [0, 0, Math.PI / 2] })
    const g = ico(0.04, 1)
    g.scale(1, 1.4, 0.8)
    k.add(g, P.straw, { p: [0, 0.11, 0] }, { jit: 0.2 })
    k.add(sphere(0.028, 7, 5), P.strawDark, { p: [0, 0.18, 0] })
  })
}

// ---------------------------------------------------------------------------------------------
// Buildings

function houses(k: Kit, ctx: BuildCtx) {
  const r = rng(ctx.seed * 31 + 7)
  const glow = 1
  const v = ctx.seed % 4
  lot(k, ctx, mix(lin(P.lawn), lin(P.lawnLight), 0.35))
  if (v === 0) {
    // Two cottages and a garden with an apple tree.
    k.group({ p: [-0.12, 0, -0.2], r: [0, 0.08, 0] }, () => house(k, { w: 0.5, d: 0.3, h: 0.24, roofH: 0.2, wall: wallColour(ctx.team, r), roof: houseRoof(ctx.team, r), seed: ctx.seed, glow, door: 'front', chimney: 0.45, dormer: true }))
    k.group({ p: [0.24, 0, 0.2], r: [0, Math.PI / 2 + 0.1, 0] }, () => house(k, { w: 0.34, d: 0.26, h: 0.2, roofH: 0.17, wall: wallColour(ctx.team, r), roof: houseRoof(ctx.team, r), seed: ctx.seed + 1, glow, door: 'front', chimney: -0.5 }))
    if (ctx.bare) return
    k.group({ p: [-0.24, 0, 0.3], s: 0.9 }, () => fruitTree(k, ctx.seed))
    fence(k, [[-0.48, 0.12], [-0.05, 0.12], [-0.05, 0.5]])
    washingLine(k, -0.42, 0.44, -0.12, 0.44, ctx.seed)
    for (let i = 0; i < 3; i++) k.group({ p: [-0.42 + i * 0.12, 0, 0.18 + hash(ctx.seed, i) * 0.04] }, () => bush(k, BIOME.forest.base, ctx.seed + i, ['#E86A8A', '#F2CF5B', '#F4EFE2'][i]))
  } else if (v === 1) {
    // A tall townhouse with its gable to the street, and a lean-to shed.
    k.group({ p: [-0.08, 0, 0], r: [0, Math.PI / 2, 0] }, () => house(k, { w: 0.5, d: 0.34, h: 0.42, roofH: 0.26, wall: wallColour(ctx.team, r), roof: houseRoof(ctx.team, r), seed: ctx.seed, glow, door: 'front', chimney: -0.5, storeys: 2 }))
    k.group({ p: [0.28, 0, -0.18] }, () => {
      k.add(box(0.2, 0.15, 0.18), P.boards, { p: [0, 0.075, 0] }, { pattern: 'boards' })
      k.add(box(0.24, 0.016, 0.22), houseRoof(ctx.team, r), { p: [0, 0.165, 0], r: [0, 0, -0.3] }, { pattern: 'roof' })
      doorAt(k, 0, 0.09, 0, 0.06, 0.1, P.timberDark)
    })
    if (ctx.bare) return
    k.group({ p: [0.3, 0, 0.28], s: 0.75 }, () => birch(k, ctx.seed))
    k.group({ p: [0.18, 0, 0.26] }, () => bush(k, BIOME.forest.base, ctx.seed + 3, '#F4EFE2'))
  } else if (v === 2) {
    // An L-shaped house with a kitchen garden.
    const wall = wallColour(ctx.team, r), roof = houseRoof(ctx.team, r)
    k.group({ p: [-0.1, 0, -0.18] }, () => house(k, { w: 0.56, d: 0.28, h: 0.26, roofH: 0.2, wall, roof, seed: ctx.seed, glow, door: 'front', chimney: -0.4 }))
    k.group({ p: [0.24, 0, 0.08], r: [0, Math.PI / 2, 0] }, () => house(k, { w: 0.34, d: 0.26, h: 0.24, roofH: 0.18, wall, roof, seed: ctx.seed + 2, glow, door: 'none', chimney: null, corners: false }))
    for (let i = 0; i < 4; i++) {
      k.add(box(0.28, 0.02, 0.035), P.soil, { p: [-0.18, 0.01, 0.12 + i * 0.07] })
      for (let j = 0; j < 5; j++) k.add(ico(0.02, 0), i % 2 ? '#6E9A4F' : '#8DBA5A', { p: [-0.3 + j * 0.06, 0.03, 0.12 + i * 0.07] }, { jit: 0.2 })
    }
    if (!ctx.bare) {
      k.group({ p: [0.34, 0, 0.34], s: 0.62 }, () => broadleaf(k, NATURE.broadleaf, NATURE.broadleafLight, ctx.seed))
      washingLine(k, 0.12, 0.42, 0.42, 0.12, ctx.seed + 3)
    }
  } else {
    // A row of three narrow gabled houses facing the street.
    for (let i = 0; i < 3; i++) {
      const tall = i === 1
      k.group({ p: [-0.05, 0, -0.33 + i * 0.235], r: [0, Math.PI / 2, 0] }, () => house(k, {
        w: 0.42, d: 0.22, h: tall ? 0.44 : 0.34, roofH: 0.2, wall: wallColour(ctx.team, r), roof: houseRoof(ctx.team, r), seed: ctx.seed + i, glow,
        door: 'front', chimney: i === 1 ? 0.5 : -0.5, storeys: 2, corners: false,
      }))
    }
    if (ctx.bare) return
    k.group({ p: [0.36, 0, -0.1] }, () => fruitTree(k, ctx.seed + 4))
    k.group({ p: [0.34, 0, 0.22] }, () => bush(k, BIOME.forest.base, ctx.seed + 5, '#E86A8A'))
  }
}

/** z extent of the lot polygon at local x (rows, fields). */
function chord(poly: [number, number][], x: number): [number, number] | null {
  const zs: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]
    if ((ax - x) * (bx - x) <= 0 && ax !== bx) zs.push(az + ((x - ax) / (bx - ax)) * (bz - az))
  }
  if (zs.length < 2) return null
  return [Math.min(...zs), Math.max(...zs)]
}

function farm(k: Kit, ctx: BuildCtx) {
  const r = rng(ctx.seed * 13 + 5)
  const rot = lotRot(ctx.spot)
  const poly = hexPts(LOT_R - 0.02, rot)
  lot(k, ctx, lin('#9C8A5E'), 'none')
  // fields on the outer two thirds: furrows with wheat and a strip of greens
  for (let x = -0.08; x < LOT_R - 0.06; x += 0.062) {
    const c = chord(poly, x)
    if (!c) continue
    const [z0, z1] = [c[0] + 0.03, c[1] - 0.03]
    const len = z1 - z0
    if (len < 0.06) continue
    k.add(box(0.05, 0.016, len), P.soilDark, { p: [x, 0.008, (z0 + z1) / 2] })
    const green = x > LOT_R - 0.24
    if (green) {
      for (let z = z0 + 0.03; z < z1 - 0.01; z += 0.05) k.add(ico(0.021, 0), mix(lin('#6E9A4F'), lin('#9DBF6B'), hash(Math.round(x * 100), Math.round(z * 100))), { p: [x, 0.03, z] }, { jit: 0.2 })
    } else {
      for (let z = z0 + 0.012; z < z1 - 0.02; z += 0.05) {
        const sl = Math.min(0.044, z1 - 0.01 - z)
        const h = 0.05 + hash(Math.round(x * 100), Math.round(z * 100)) * 0.025
        k.add(box(0.036, h, sl), mix(lin(NATURE.wheat), lin(BIOME.plains.light), hash(Math.round(x * 100) + 7, Math.round(z * 100)) * 0.6), { p: [x, 0.016 + h / 2, z + sl / 2] }, { flutter: (_x, y) => Math.max(0, y + h / 2) * 0.22, jit: 0.08 })
      }
    }
  }
  // the barn on the town side, falu red with a big door
  k.group({ p: [-0.36, 0, 0], r: [0, Math.PI / 2, 0] }, () => {
    const w = 0.56, d = 0.32, h = 0.24, rh = 0.22
    const wall = barnColour(ctx.team)
    k.add(box(w + 0.02, 0.03, d + 0.02), P.stoneDark, { p: [0, 0.015, 0] }, { pattern: 'stone' })
    k.add(rbox(w, h, d, 0.006), wall, { p: [0, h / 2 + 0.02, 0] }, { pattern: 'boards' })
    gableEnds(k, w, d, rh, wall, { p: [0, h + 0.02, 0] }, 'boards')
    gableRoof(k, w, d, rh, roofColour(ctx.team, r), { p: [0, h + 0.02, 0] }, { ridge: lin(ctx.team.dark), over: 0.04 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.018, h, 0.018), P.trim, { p: [sx * (w / 2 - 0.004), h / 2 + 0.02, sz * (d / 2 - 0.004)] })
    // barn doors with white cross bracing, facing +z (out to the fields)
    k.group({ p: [0, 0, d / 2] }, () => {
      k.add(box(0.2, 0.19, 0.01), shade(lin(wall), 0.85), { p: [0, 0.115, 0.004] }, { pattern: 'boards' })
      k.add(box(0.22, 0.014, 0.014), P.trim, { p: [0, 0.215, 0.01] })
      for (const s of [-1, 1]) k.add(box(0.012, 0.25, 0.012), P.trim, { p: [s * 0.05, 0.115, 0.012], r: [0, 0, s * 0.85] })
      k.add(box(0.012, 0.19, 0.014), P.trim, { p: [0, 0.115, 0.012] })
    })
    windowAt(k, 0.18, 0.17, -d / 2, Math.PI, 0.045, 0.05, ctx.lit ? 1 : 0.1)
    windowAt(k, -0.18, 0.17, -d / 2, Math.PI, 0.045, 0.05, ctx.lit ? 0.7 : 0.1)
    windowAt(k, w / 2, h + 0.02 + rh * 0.35, 0, Math.PI / 2, 0.05, 0.05, ctx.lit ? 0.5 : 0)
  })
  // haystacks and a cart
  for (let i = 0; i < 2; i++) {
    const hx = -0.12 + i * 0.1, hz = (i ? 1 : -1) * 0.42
    k.add(cyl(0.05, 0.065, 0.07, 9), P.straw, { p: [hx, 0.035, hz] }, { jit: 0.15 })
    k.add(sphere(0.052, 9, 5), P.straw, { p: [hx, 0.07, hz], s: [1, 0.8, 1] }, { jit: 0.15 })
  }
  k.group({ p: [-0.08, 0, 0.0], r: [0, 0.4, 0] }, () => {
    k.add(box(0.12, 0.03, 0.07), P.boards, { p: [0, 0.05, 0] }, { pattern: 'boards' })
    for (const s of [-1, 1]) k.add(cyl(0.028, 0.028, 0.01, 10), P.timberDark, { p: [0, 0.03, s * 0.04], r: [Math.PI / 2, 0, 0] })
    k.add(box(0.12, 0.006, 0.006), P.timberDark, { p: [-0.1, 0.05, 0], r: [0, 0, 0.3] })
    k.add(box(0.1, 0.03, 0.06), P.straw, { p: [0, 0.075, 0] }, { jit: 0.2 })
  })
  strawDummy(k, 0.3, 0.05, 0.3)
  k.anchor('work', [0.15, 0, -0.1])
  k.anchor('work', [0.3, 0, 0.2])
}

function sawmill(k: Kit, ctx: BuildCtx, spinners: Spinner[]) {
  const r = rng(ctx.seed * 17 + 3)
  lot(k, ctx, mix(lin('#A8946A'), lin(P.soil), 0.4), 'none')
  // sawdust scattered on the yard
  k.add(cone(0.09, 0.05, 9), '#E6D2A2', { p: [0.1, 0.025, 0.3] }, { jit: 0.1 })
  // the mill house, plank walls, open saw shed on the outer side
  const roof = roofColour(ctx.team, r)
  k.group({ p: [-0.22, 0, -0.08], r: [0, Math.PI / 2, 0] }, () => {
    const w = 0.5, d = 0.3, h = 0.28, rh = 0.2
    k.add(box(w + 0.02, 0.03, d + 0.02), P.stoneDark, { p: [0, 0.015, 0] }, { pattern: 'stone' })
    k.add(rbox(w, h, d, 0.006), P.boards, { p: [0, h / 2 + 0.02, 0] }, { pattern: 'boards' })
    gableEnds(k, w, d, rh, P.boards, { p: [0, h + 0.02, 0] }, 'boards')
    gableRoof(k, w, d, rh, roof, { p: [0, h + 0.02, 0] }, { ridge: shade(roof, 0.72), over: 0.04 })
    windowAt(k, -0.12, 0.17, d / 2, 0, 0.05, 0.055, ctx.lit ? 1 : 0.1)
    windowAt(k, 0.12, 0.17, -d / 2, Math.PI, 0.05, 0.055, ctx.lit ? 1 : 0.1)
    doorAt(k, 0.1, d / 2, 0, 0.08, 0.14, P.timberDark)
    // water wheel on the -x end with a millrace
    const wx = -w / 2 - 0.05
    k.add(box(0.07, 0.03, 0.52), shade(lin(P.stone), 0.9), { p: [wx, 0.015, 0] }, { pattern: 'stone' })
    k.add(box(0.05, 0.008, 0.52), P.water, { p: [wx, 0.032, 0] }, { glow: 0.05 })
    const wheel = new Kit()
    const R = 0.15
    wheel.add(torus(R, 0.012, 5, 18), P.timberDark, { r: [0, Math.PI / 2, 0] })
    wheel.add(torus(R * 0.55, 0.008, 4, 14), P.timberDark, { r: [0, Math.PI / 2, 0] })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      wheel.add(box(0.04, 0.012, 0.05), P.timber, { p: [0, Math.sin(a) * R, Math.cos(a) * R], r: [a, 0, 0] })
      if (i % 2 === 0) wheel.add(box(0.008, 0.008, R * 2), P.timber, { r: [a, 0, 0] })
    }
    wheel.add(cyl(0.02, 0.02, 0.07, 8), P.iron, { r: [0, 0, Math.PI / 2] })
    const pivot = new THREE.Vector3(wx, R + 0.02, 0).applyMatrix4(k.matrix)
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(k.matrix)
    // geometry is authored around its own pivot; the scene rotates it about `axis`
    const g = wheel.build()
    g.applyMatrix4(k.matrix.clone().setPosition(0, 0, 0))
    spinners.push({ geo: g, pivot, axis, speed: ctx.lit ? -0.9 : -0.25 })
    // axle housing
    k.add(box(0.04, 0.05, 0.05), P.timberDark, { p: [-w / 2 - 0.01, R + 0.02, 0] })
  })
  // open saw shed: posts, plank roof, frame saw
  k.group({ p: [0.22, 0, -0.22], r: [0, 0.2, 0] }, () => {
    for (const [x, z] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]]) k.add(box(0.018, 0.2, 0.018), P.timberDark, { p: [x, 0.1, z] })
    k.add(box(0.34, 0.016, 0.26), roof, { p: [0, 0.21, 0], r: [0.18, 0, 0] }, { pattern: 'roof' })
    k.add(box(0.26, 0.03, 0.05), P.timber, { p: [0, 0.06, 0] })
    k.add(cyl(0.025, 0.025, 0.3, 8), '#B98B5E', { p: [0, 0.095, 0], r: [0, 0, Math.PI / 2] })
    k.add(box(0.012, 0.16, 0.06), P.timberDark, { p: [0.02, 0.1, 0] })
    k.add(box(0.004, 0.13, 0.03), P.steel, { p: [0.02, 0.1, 0.0] })
  })
  // log pile: 3-2-1, with light end grain
  k.group({ p: [0.32, 0, 0.14], r: [0, 0.5 + r() * 0.3, 0] }, () => {
    const lr = 0.03
    let row = 0
    for (const nLogs of [4, 3, 2]) {
      for (let i = 0; i < nLogs; i++) {
        const z = (i - (nLogs - 1) / 2) * lr * 2.05
        const y = lr + row * lr * 1.75
        k.add(cyl(lr, lr, 0.32, 8), mix(lin('#8B6440'), lin('#6E4B30'), hash(row * 10 + i, 3)), { p: [0, y, z], r: [0, 0, Math.PI / 2] })
        for (const s of [-1, 1]) k.add(cyl(lr * 0.86, lr * 0.86, 0.004, 8), '#E2C48E', { p: [s * 0.161, y, z], r: [0, 0, Math.PI / 2] })
      }
      row++
    }
  })
  // stacked planks
  k.group({ p: [-0.05, 0, 0.32], r: [0, -0.3, 0] }, () => {
    for (let i = 0; i < 5; i++) k.add(box(0.26, 0.012, 0.07), mix(lin('#D9B784'), lin('#C49A66'), hash(i, 7)), { p: [0, 0.008 + i * 0.013, (i % 2) * 0.006] })
  })
  for (let i = 0; i < 2; i++) k.add(cyl(0.035, 0.04, 0.04, 8), '#7D5A3C', { p: [0.4 - i * 0.6, 0.02, -0.4 + i * 0.05] })
  k.anchor('work', [0.22, 0, -0.1])
  k.anchor('work', [0.2, 0, 0.12])
}

function workshop(k: Kit, ctx: BuildCtx) {
  const r = rng(ctx.seed * 19 + 1)
  lot(k, ctx, lin(P.gravel), 'cobble')
  const roof = roofColour(ctx.team, r)
  const glow = ctx.lit ? 1 : 0.08
  // stone smithy
  k.group({ p: [-0.16, 0, -0.12], r: [0, 0.1, 0] }, () => {
    const w = 0.46, d = 0.32, h = 0.28, rh = 0.2
    k.add(rbox(w, h, d, 0.01), P.granite, { p: [0, h / 2, 0] }, { pattern: 'stone' })
    gableEnds(k, w, d, rh, P.granite, { p: [0, h, 0] }, 'stone')
    gableRoof(k, w, d, rh, roof, { p: [0, h, 0] }, { ridge: shade(roof, 0.7), over: 0.035 })
    // big forge chimney on the gable
    k.add(rbox(0.11, 0.62, 0.11, 0.008), P.brick, { p: [-w / 2 + 0.03, 0.31, -0.04] }, { pattern: 'stone' })
    k.add(box(0.13, 0.02, 0.13), shade(lin(P.brick), 0.8), { p: [-w / 2 + 0.03, 0.625, -0.04] })
    k.anchor('smoke', [-w / 2 + 0.03, 0.64, -0.04])
    // forge mouth, glowing
    k.add(box(0.09, 0.08, 0.01), '#2B201B', { p: [0.05, 0.08, d / 2 + 0.002] })
    k.add(box(0.07, 0.04, 0.012), '#FF8A3D', { p: [0.05, 0.065, d / 2 + 0.004] }, { glow: ctx.lit ? 2.2 : 0 })
    windowAt(k, -0.12, 0.17, d / 2, 0, 0.05, 0.055, glow)
    windowAt(k, 0.14, 0.17, -d / 2, Math.PI, 0.05, 0.055, glow)
    doorAt(k, 0.16, d / 2, 0, 0.08, 0.14)
    // a plank lean-to over the anvil, on two posts, with the guild sign
    k.add(box(0.38, 0.014, 0.24), '#8A6446', { p: [0.0, 0.2, d / 2 + 0.11], r: [0.3, 0, 0] }, { pattern: 'boards' })
    k.add(box(0.39, 0.02, 0.02), roof, { p: [0.0, 0.235, d / 2 + 0.005] })
    for (const sx of [-1, 1]) k.add(box(0.016, 0.17, 0.016), P.timberDark, { p: [sx * 0.17, 0.085, d / 2 + 0.21] })
    k.add(box(0.006, 0.006, 0.07), P.iron, { p: [0.2, 0.25, d / 2 + 0.04] })
    k.add(cyl(0.032, 0.032, 0.008, 12), ctx.team.base, { p: [0.2, 0.2, d / 2 + 0.075], r: [0, 0, Math.PI / 2] }, { flutter: 0.002 })
    k.add(box(0.03, 0.012, 0.01), P.gold, { p: [0.205, 0.2, d / 2 + 0.075], r: [0, Math.PI / 2, 0] })
  })
  // anvil on a stump, grindstone, barrels, a cart wheel against the wall
  k.group({ p: [0.06, 0, 0.18] }, () => {
    k.add(cyl(0.035, 0.04, 0.05, 8), P.timberDark, { p: [0, 0.025, 0] })
    k.add(box(0.07, 0.025, 0.035), P.iron, { p: [0, 0.062, 0] })
    k.add(cone(0.018, 0.04, 4), P.iron, { p: [0.05, 0.065, 0], r: [0, 0, -Math.PI / 2] })
  })
  k.group({ p: [0.3, 0, -0.05] }, () => {
    k.add(box(0.06, 0.06, 0.04), P.timber, { p: [0, 0.03, 0] })
    k.add(cyl(0.05, 0.05, 0.02, 12), '#B8B0A2', { p: [0, 0.09, 0], r: [Math.PI / 2, 0, 0] })
  })
  barrel(k, 0.28, 0.25)
  barrel(k, 0.34, 0.19, 0.9)
  crate(k, 0.38, 0.3, 1, 0.3)
  crate(k, 0.38, 0.3, 0.8, 0.8, 0.05)
  k.add(torus(0.05, 0.007, 4, 14), P.timberDark, { p: [-0.42, 0.055, 0.18], r: [0, 1.2, 0.2] })
  for (let i = 0; i < 6; i++) k.add(cyl(0.004, 0.004, 0.05, 4), i % 2 ? P.steel : P.timberDark, { p: [-0.42, 0.13, 0.2] })
  k.anchor('work', [0.06, 0, 0.26])
}

function market(k: Kit, ctx: BuildCtx) {
  lot(k, ctx, lin('#DCCDAE'), 'pavers')
  const goods: string[][] = [
    ['#D2432B', '#E05A3A', '#B8362A'], // apples
    ['#E8902E', '#F0A93E'], // pumpkins, oranges
    ['#7FA850', '#5E8A4A'], // greens
    ['#8C9AA6', '#A9B6C0'], // fish
    ['#C08A4E', '#A36F3B'], // bread
    [ctx.team.light, '#F3EADB', ctx.team.base], // cloth
  ]
  const stalls = [
    { x: -0.3, z: -0.2, a: 0.5 },
    { x: 0.05, z: -0.4, a: -0.1 },
    { x: 0.34, z: -0.08, a: -0.9 },
    { x: 0.16, z: 0.32, a: 3.6 },
    { x: -0.28, z: 0.26, a: 2.3 },
  ]
  stalls.forEach((s, i) => {
    k.group({ p: [s.x, 0, s.z], r: [0, s.a, 0] }, () => {
      const w = 0.24, d = 0.14
      // counter
      k.add(box(w, 0.06, d * 0.6), P.boards, { p: [0, 0.03, 0.02] }, { pattern: 'boards' })
      k.add(box(w + 0.01, 0.01, d * 0.6 + 0.01), '#C8A57A', { p: [0, 0.065, 0.02] })
      // goods
      const g = goods[(i + ctx.seed) % goods.length]
      for (let j = 0; j < 9; j++) {
        const gx = -w / 2 + 0.025 + (j % 5) * 0.047, gz = j < 5 ? 0.0 : 0.04
        if (g === goods[3]) k.add(sphere(0.011, 6, 4), g[j % g.length], { p: [gx, 0.077, gz], s: [2.2, 0.8, 1] })
        else if (g === goods[5]) k.add(cyl(0.014, 0.014, 0.05, 8), g[j % g.length], { p: [gx, 0.084, gz], r: [Math.PI / 2, 0, 0] })
        else k.add(sphere(g === goods[1] ? 0.016 : 0.013, 7, 5), g[j % g.length], { p: [gx, 0.083, gz] })
      }
      // posts and the striped awning
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(0.006, 0.006, sz < 0 ? 0.2 : 0.17, 5), P.timberDark, { p: [sx * w / 2, sz < 0 ? 0.1 : 0.085, sz * d / 2] })
      const stripes = 6
      for (let j = 0; j < stripes; j++) {
        const col = j % 2 ? P.cloth : ctx.team.base
        const sw = (w + 0.04) / stripes
        k.add(box(sw, 0.008, d + 0.06), col, { p: [-w / 2 - 0.02 + sw * (j + 0.5), 0.19, 0.0], r: [-0.25, 0, 0] }, { flutter: (_x, _y, z) => Math.max(0, z) * 0.03 })
        // scalloped valance
        k.add(box(sw * 0.9, 0.03, 0.006), col, { p: [-w / 2 - 0.02 + sw * (j + 0.5), 0.16, d / 2 + 0.034] }, { flutter: (_x, y) => Math.max(0, 0.015 - y) * 0.6 })
      }
      k.anchor('work', [0, 0, -0.1])
    })
  })
  // a market cross with the town banner, barrels and crates between the stalls
  flagPole(k, 0.0, 0.0, 0.5, ctx.team, 0.13)
  k.add(cyl(0.04, 0.05, 0.04, 8), P.stone, { p: [0, 0.02, 0] }, { pattern: 'stone' })
  barrel(k, -0.08, -0.16)
  barrel(k, -0.02, -0.2, 0.9)
  crate(k, 0.24, 0.16, 1, 0.4)
  crate(k, -0.42, 0.0, 1, 0.1)
  crate(k, -0.42, 0.0, 0.8, 0.7, 0.05)
  k.add(ico(0.03, 0), '#E8902E', { p: [0.12, 0.03, 0.12] })
  k.add(ico(0.025, 0), '#F0A93E', { p: [0.16, 0.025, 0.1] })
  k.anchor('crowd', [0, 0, 0])
}

/** A clinker boat hull along x: length L, beam W, depth D. Outside in tar, a stripe in the team
 * colour under the gunwale, inside in light wood. */
function hull(k: Kit, L: number, W: number, D: number, team: Team, o: Place = {}) {
  const nL = 12, nS = 8
  const sec: [number, number, number][][] = []
  for (let i = 0; i <= nL; i++) {
    const t = i / nL
    const u = Math.abs(2 * t - 1)
    const x = (t - 0.5) * L
    const w = (W / 2) * Math.max(0.02, Math.sqrt(Math.max(0, 1 - u ** 2.4)))
    const d = D * (0.5 + 0.5 * (1 - u * u))
    const top = 0.018 * u * u
    const ring: [number, number, number][] = []
    for (let j = 0; j <= nS; j++) {
      const th = (Math.PI * j) / nS
      ring.push([x, top - d * Math.sin(th) * (1 - 0.15 * Math.cos(th) ** 2), -w * Math.cos(th)])
    }
    sec.push(ring)
  }
  const outer: number[] = [], stripe: number[] = [], inner: number[] = []
  const push = (arr: number[], a: number[], b: number[], c: number[]) => arr.push(...a, ...b, ...c)
  for (let i = 0; i < nL; i++) for (let j = 0; j < nS; j++) {
    const a = sec[i][j], b = sec[i + 1][j], c = sec[i + 1][j + 1], d = sec[i][j + 1]
    const arr = j === 0 || j === nS - 1 ? stripe : outer
    push(arr, a, b, c); push(arr, a, c, d)
    const sh = (v: number[]) => [v[0], v[1] + 0.004, v[2] * 0.9]
    push(inner, sh(a), sh(c), sh(b)); push(inner, sh(a), sh(d), sh(c))
  }
  const geo = (arr: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    return g
  }
  k.group(o, () => {
    k.add(geo(outer), '#5E4130', {}, { jit: 0.08 })
    k.add(geo(stripe), team.base)
    k.add(geo(inner), '#B48A5C', {}, { jit: 0.06 })
    for (const x of [-L * 0.22, 0, L * 0.22]) k.add(box(0.012, 0.008, W * 0.8), '#A27850', { p: [x, -D * 0.25, 0] })
  })
}

function harbor(k: Kit, ctx: BuildCtx, bobbers: Bobber[]) {
  const r = rng(ctx.seed * 23 + 9)
  lot(k, ctx, mix(lin(P.lawn), lin(P.lawnLight), 0.3))
  const wd = ctx.waterDir
  const edge = ctx.spot.edgeDist / Math.max(0.5, Math.cos(wd)) / S
  const wy = ctx.waterY / S
  const jy = wy + 0.07
  const roof = roofColour(ctx.team, r)
  const ground = -LOT_Y / S
  k.group({ r: [0, -wd, 0] }, () => {
    // gravel yard from the street to the water
    k.add(flat([[-0.5, -0.2], [0.62, -0.2], [0.62, 0.22], [-0.5, 0.22]], 0.003), mix(lin(P.gravel), lin('#C9B58F'), 0.4), {}, { pattern: 'sand' })
    // the boathouse at the water's edge, gable door to the sea
    k.group({ p: [0.32, 0, 0.36], r: [0, 0, 0] }, () => {
      const w = 0.4, d = 0.3, h = 0.22, rh = 0.19
      const wall = barnColour(ctx.team)
      k.add(box(w + 0.02, 0.025, d + 0.02), P.stoneDark, { p: [0, 0.012, 0] }, { pattern: 'stone' })
      k.add(rbox(w, h, d, 0.006), wall, { p: [0, h / 2 + 0.02, 0] }, { pattern: 'boards' })
      gableEnds(k, w, d, rh, wall, { p: [0, h + 0.02, 0] }, 'boards')
      gableRoof(k, w, d, rh, roof, { p: [0, h + 0.02, 0] }, { ridge: shade(roof, 0.7), over: 0.035 })
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.016, h, 0.016), P.trim, { p: [sx * (w / 2 - 0.004), h / 2 + 0.02, sz * (d / 2 - 0.004)] })
      k.group({ p: [w / 2, 0, 0], r: [0, Math.PI / 2, 0] }, () => {
        k.add(box(0.15, 0.16, 0.012), shade(lin(wall), 0.82), { p: [0, 0.1, 0.004] }, { pattern: 'boards' })
        k.add(box(0.012, 0.16, 0.014), P.trim, { p: [0, 0.1, 0.008] })
        k.add(box(0.17, 0.012, 0.014), P.trim, { p: [0, 0.185, 0.008] })
      })
      windowAt(k, -0.08, 0.14, -d / 2, Math.PI, 0.045, 0.05, ctx.lit ? 1 : 0.1)
      windowAt(k, -w / 2, 0.14, 0, -Math.PI / 2, 0.045, 0.05, ctx.lit ? 1 : 0.1)
      k.add(rbox(0.04, 0.24, 0.04, 0.005), P.chimney, { p: [-0.12, 0.32, 0.06] }, { pattern: 'stone' })
      k.anchor('chimney', [-0.12, 0.45, 0.06])
    })
    // an upturned boat on trestles, being tarred
    k.group({ p: [-0.14, 0.13, 0.32], r: [Math.PI, 0.25, 0] }, () => hull(k, 0.36, 0.12, 0.06, ctx.team))
    for (const x of [-0.28, 0.0]) k.add(box(0.016, 0.07, 0.1), P.timberDark, { p: [x, 0.035, 0.28 + (x + 0.14) * 0.25] })
    // lobster pots, fish boxes, barrels
    for (let i = 0; i < 5; i++) {
      const px = -0.32 + (i % 3) * 0.06, pz = -0.36 + Math.floor(i / 3) * 0.06, py = i >= 3 ? 0.045 : 0
      k.add(cyl(0.024, 0.026, 0.045, 8, true), '#9A7B55', { p: [px, py + 0.0225, pz] })
      k.add(torus(0.024, 0.004, 3, 10), '#7E6244', { p: [px, py + 0.045, pz], r: [Math.PI / 2, 0, 0] })
    }
    k.group({ p: [0.1, 0, -0.32], r: [0, 0.2, 0] }, () => {
      k.add(box(0.1, 0.03, 0.06), '#B48A5C', { p: [0, 0.015, 0] }, { pattern: 'boards' })
      for (let i = 0; i < 4; i++) k.add(sphere(0.011, 6, 4), '#9AA8B2', { p: [-0.032 + i * 0.022, 0.034, 0], s: [1, 0.6, 2.4] })
    })
    barrel(k, 0.26, -0.3)
    barrel(k, 0.32, -0.25, 0.9)
    // nets drying on poles
    k.group({ p: [-0.38, 0, 0.0], r: [0, Math.PI / 2, 0] }, () => {
      for (const z of [-0.12, 0.12]) k.add(cyl(0.006, 0.006, 0.17, 5), P.timberDark, { p: [0, 0.085, z] })
      k.add(box(0.004, 0.11, 0.24), '#5D6B6E', { p: [0, 0.105, 0] }, { flutter: (_x, y) => Math.max(0, 0.05 - y) * 0.2 })
      k.add(cyl(0.004, 0.004, 0.26, 4), P.timberDark, { p: [0, 0.166, 0], r: [Math.PI / 2, 0, 0] })
    })
    // boardwalk across the shore, steps down the bank, then the jetty out over the water
    const x0 = LOT_R * 0.84
    const bw = 0.15
    k.add(box(edge - x0 + 0.02, 0.016, bw), '#A27850', { p: [(x0 + edge) / 2, ground + 0.03, 0] }, { pattern: 'boards' })
    for (let x = x0 + 0.05; x < edge; x += 0.18) for (const sz of [-1, 1]) k.add(box(0.016, 0.04, 0.016), P.timberDark, { p: [x, ground + 0.01, sz * bw * 0.42] })
    const drop = ground + 0.03 - jy
    const nSteps = Math.max(1, Math.round(drop / 0.04))
    const run = nSteps * 0.045
    for (let i = 0; i < nSteps; i++) {
      const sy = ground + 0.03 - (i + 1) * (drop / nSteps)
      k.add(box(0.05, 0.014, bw), '#A27850', { p: [edge + 0.02 + i * 0.045, sy, 0] })
    }
    for (const sz of [-1, 1]) k.add(cyl(0.01, 0.01, drop + 0.4, 5), P.timberDark, { p: [edge + run, jy - 0.2 + (drop + 0.4) / 2 - 0.2, sz * bw * 0.5] })
    const d0 = edge + run, len = 1.1, d1 = d0 + len
    k.add(box(len, 0.02, 0.16), '#A27850', { p: [(d0 + d1) / 2, jy, 0] }, { pattern: 'boards' })
    k.add(box(0.22, 0.02, 0.42), '#A27850', { p: [d1 - 0.11, jy, 0] }, { pattern: 'boards' })
    for (let x = d0 + 0.15; x <= d1 + 0.001; x += 0.2) for (const sz of [-1, 1]) k.add(cyl(0.012, 0.012, 0.5, 6), P.timberDark, { p: [x, jy - 0.24, sz * 0.085] })
    for (const z of [-0.2, 0.2]) k.add(cyl(0.014, 0.014, 0.5, 6), P.timberDark, { p: [d1 - 0.02, jy - 0.2, z] })
    k.add(cyl(0.012, 0.014, 0.04, 6), P.iron, { p: [d1 - 0.04, jy + 0.03, 0.18] })
    k.add(torus(0.02, 0.006, 4, 10), P.rope, { p: [d1 - 0.12, jy + 0.015, -0.16], r: [Math.PI / 2, 0, 0] })
    k.add(cyl(0.005, 0.005, 0.18, 5), P.timberDark, { p: [d1 - 0.2, jy + 0.09, -0.2] })
    k.add(box(0.02, 0.025, 0.02), '#FFD08A', { p: [d1 - 0.2, jy + 0.19, -0.2] }, { glow: 1.5 })
    crate(k, d0 + 0.25, 0.04, 0.9, 0.3, jy + 0.01)
    barrel(k, d0 + 0.32, -0.03, 0.85, jy + 0.01)
    k.anchor('work', [d1 - 0.1, jy + 0.01, 0.04])
    // the boat moored alongside, with a square sail in the town colours
    const boat = new Kit()
    hull(boat, 0.5, 0.17, 0.075, ctx.team, { p: [0, 0.06, 0] })
    boat.add(cyl(0.006, 0.007, 0.44, 6), P.timberDark, { p: [0.02, 0.28, 0] })
    boat.add(cyl(0.004, 0.004, 0.26, 5), P.timberDark, { p: [0.03, 0.42, 0], r: [Math.PI / 2, 0, 0] })
    const sail = (c: string, y0: number, y1: number) => boat.add(box(0.004, y1 - y0, 0.24), c, { p: [0.034, (y0 + y1) / 2, 0] }, { flutter: (_x, y, z) => (0.5 - Math.abs(z) * 2) * 0.006 + Math.max(0, -y) * 0.02 })
    sail(P.cloth, 0.2, 0.28)
    sail(ctx.team.base, 0.28, 0.33)
    sail(P.cloth, 0.33, 0.41)
    boat.add(box(0.06, 0.04, 0.06), '#B48A5C', { p: [-0.13, 0.065, 0] }, { pattern: 'boards' })
    const pivot = new THREE.Vector3(d1 - 0.28, wy, 0.24).applyMatrix4(k.matrix)
    const g = boat.build()
    g.applyMatrix4(k.matrix.clone().setPosition(0, 0, 0))
    bobbers.push({ geo: g, pivot, seed: ctx.seed })
  })
}

function barracks(k: Kit, ctx: BuildCtx) {
  const r = rng(ctx.seed * 29 + 1)
  lot(k, ctx, lin(P.sand), 'sand')
  const roof = roofColour(ctx.team, r)
  // the long barrack on the inner side
  k.group({ p: [-0.36, 0, 0], r: [0, Math.PI / 2, 0] }, () => {
    const w = 0.66, d = 0.26, h = 0.22, rh = 0.16
    k.add(box(w + 0.02, 0.035, d + 0.02), P.stoneDark, { p: [0, 0.0175, 0] }, { pattern: 'stone' })
    k.add(rbox(w, h, d, 0.006), '#7A5A40', { p: [0, h / 2 + 0.02, 0] }, { pattern: 'boards' })
    gableEnds(k, w, d, rh, '#7A5A40', { p: [0, h + 0.02, 0] }, 'boards')
    gableRoof(k, w, d, rh, roof, { p: [0, h + 0.02, 0] }, { ridge: shade(roof, 0.7), over: 0.035 })
    for (let i = 0; i < 4; i++) windowAt(k, -0.24 + i * 0.16, 0.15, d / 2, 0, 0.045, 0.05, 0.9)
    doorAt(k, 0.0, d / 2, 0, 0.09, 0.14, ctx.team.dark)
    k.add(rbox(0.05, 0.4, 0.05, 0.006), P.chimney, { p: [0.2, 0.3, -0.05] }, { pattern: 'stone' })
    k.anchor('chimney', [0.2, 0.51, -0.05])
  })
  // the yard fence, dummies, a target and the weapon rack
  const rot = lotRot(ctx.spot)
  const poly = hexPts(LOT_R - 0.05, rot).filter(([x]) => x > -0.12)
  fence(k, poly.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])), '#CDBB98', 0.06)
  for (let i = 0; i < 3; i++) strawDummy(k, 0.32, -0.22 + i * 0.22, -Math.PI / 2)
  k.group({ p: [0.1, 0, -0.4], r: [0, 0.3, 0] }, () => {
    k.add(cyl(0.006, 0.006, 0.12, 4), P.timberDark, { p: [0, 0.06, -0.02], r: [-0.25, 0, 0] })
    const rings = [ctx.team.base, P.cloth, ctx.team.base, P.cloth, P.gold]
    rings.forEach((c, i) => k.add(cyl(0.06 - i * 0.012, 0.06 - i * 0.012, 0.012 + i * 0.002, 14), c, { p: [0, 0.1, 0.0], r: [Math.PI / 2 - 0.25, 0, 0] }))
  })
  k.group({ p: [-0.08, 0, 0.42], r: [0, -0.2, 0] }, () => {
    k.add(box(0.2, 0.012, 0.02), P.timberDark, { p: [0, 0.1, 0] })
    k.add(box(0.2, 0.012, 0.02), P.timberDark, { p: [0, 0.03, 0.03] })
    for (let i = 0; i < 5; i++) {
      k.add(cyl(0.004, 0.004, 0.24, 4), P.timber, { p: [-0.08 + i * 0.04, 0.12, 0.012], r: [-0.12, 0, 0] })
      k.add(cone(0.008, 0.03, 4), P.steel, { p: [-0.08 + i * 0.04, 0.245, -0.004], r: [-0.12, 0, 0] })
    }
  })
  flagPole(k, -0.12, -0.42, 0.55, ctx.team, 0.16)
  k.anchor('drill', [0.1, 0, 0])
}

function temple(k: Kit, ctx: BuildCtx) {
  lot(k, ctx, mix(lin(P.lawn), lin(P.lawnLight), 0.5))
  const white = '#F6F1E7'
  const roof = mix(lin(ctx.team.base), lin(ctx.team.dark), 0.25)
  const glow = ctx.lit ? 1 : 0.15
  // gravel path from the square to the door
  k.add(box(0.36, 0.004, 0.1), P.gravel, { p: [-0.5, 0.002, 0] })
  k.group({ p: [0.06, 0, 0], r: [0, 0, 0] }, () => {
    const w = 0.56, d = 0.3, h = 0.34, rh = 0.24
    k.add(box(w + 0.03, 0.04, d + 0.03), P.stoneDark, { p: [0, 0.02, 0] }, { pattern: 'stone' })
    k.add(rbox(w, h, d, 0.01), white, { p: [0, h / 2 + 0.03, 0] }, { pattern: 'plaster' })
    gableEnds(k, w, d, rh, white, { p: [0, h + 0.03, 0] })
    gableRoof(k, w, d, rh, roof, { p: [0, h + 0.03, 0] }, { ridge: shade(roof, 0.75), over: 0.03 })
    // tall arched windows along the nave
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const x = -0.1 + i * 0.15
      k.group({ p: [x, 0.2, s * d / 2], r: [0, s > 0 ? 0 : Math.PI, 0] }, () => {
        k.add(box(0.045, 0.12, 0.008), P.glass, { p: [0, 0, 0.004] }, { glow })
        k.add(cyl(0.0225, 0.0225, 0.008, 10, false), P.glass, { p: [0, 0.06, 0.004], r: [Math.PI / 2, 0, 0] }, { glow })
        k.add(box(0.06, 0.012, 0.02), P.stone, { p: [0, -0.066, 0.008] })
      })
    }
    // apse at the east end
    k.add(cyl(0.13, 0.13, h * 0.85, 12, false), white, { p: [w / 2, h * 0.425 + 0.03, 0] }, { pattern: 'plaster' })
    k.add(spire(0.15, 0.14, 12), roof, { p: [w / 2, h * 0.85 + 0.03, 0] }, { pattern: 'roof' })
    // the bell tower at the west end, facing the square
    const tx = -w / 2 - 0.06
    k.add(rbox(0.2, 0.62, 0.2, 0.01), white, { p: [tx, 0.31 + 0.03, 0] }, { pattern: 'plaster' })
    k.add(box(0.215, 0.02, 0.215), P.stone, { p: [tx, 0.5, 0] })
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      k.group({ p: [tx, 0.56, 0], r: [0, a, 0] }, () => {
        k.add(box(0.07, 0.09, 0.01), '#2E2925', { p: [0, 0, 0.101] })
        k.add(cyl(0.035, 0.035, 0.01, 10), '#2E2925', { p: [0, 0.045, 0.101], r: [Math.PI / 2, 0, 0] })
      })
    }
    k.add(box(0.23, 0.025, 0.23), P.stone, { p: [tx, 0.66, 0] })
    k.add(spire(0.14, 0.5, 8), roof, { p: [tx, 0.67, 0] }, { pattern: 'roof' })
    k.add(cyl(0.004, 0.004, 0.1, 4), P.gold, { p: [tx, 1.21, 0] })
    k.add(sphere(0.016, 8, 6), P.gold, { p: [tx, 1.19, 0] })
    // the weathercock
    k.add(box(0.05, 0.03, 0.004), P.gold, { p: [tx + 0.01, 1.26, 0] }, { flutter: 0.004 })
    // big round door
    k.group({ p: [tx - 0.1, 0, 0], r: [0, -Math.PI / 2, 0] }, () => {
      k.add(box(0.08, 0.13, 0.012), P.door, { p: [0, 0.095, 0.004] }, { pattern: 'boards' })
      k.add(cyl(0.04, 0.04, 0.012, 10), P.door, { p: [0, 0.16, 0.004], r: [Math.PI / 2, 0, 0] })
      k.add(box(0.1, 0.02, 0.04), P.stoneDark, { p: [0, 0.02, 0.02] })
    })
    windowAt(k, tx, 0.36, 0.1, 0, 0.04, 0.06, glow)
    windowAt(k, tx, 0.36, -0.1, Math.PI, 0.04, 0.06, glow)
  })
  // churchyard: a low stone wall and trees
  const rot = lotRot(ctx.spot)
  const poly = hexPts(LOT_R - 0.04, rot).filter(([x]) => x > 0.0)
  const sorted = poly.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
  for (let i = 0; i < sorted.length - 1; i++) {
    const [ax, az] = sorted[i], [bx, bz] = sorted[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    k.add(rbox(len, 0.05, 0.04, 0.008), P.stone, { p: [(ax + bx) / 2, 0.025, (az + bz) / 2], r: [0, -Math.atan2(bz - az, bx - ax), 0] }, { pattern: 'stone' })
  }
  if (!ctx.bare) {
    k.group({ p: [0.42, 0, 0.28], s: 0.75 }, () => birch(k, ctx.seed + 1))
    k.group({ p: [0.44, 0, -0.26], s: 0.6 }, () => broadleaf(k, NATURE.broadleaf, NATURE.broadleafLight, ctx.seed + 2))
  }
  for (let i = 0; i < 3; i++) k.add(rbox(0.03, 0.04, 0.012, 0.004), P.granite, { p: [0.16 + i * 0.08, 0.02, 0.3 + (i % 2) * 0.03] })
  k.anchor('work', [-0.48, 0, 0.08])
}

/** Where along local +x the town's wall line (just outside the ring street) lies. */
function wallLine(ctx: BuildCtx, frac = 0.06): [number, number][] {
  // the wall polygon in plot-local coordinates
  const s = ctx.spot
  const ca = Math.cos(-s.out), sa = Math.sin(-s.out)
  return STREET_EDGE.map(([x, z]) => {
    const dx = x - s.x, dz = z - s.z
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca
    const l = Math.hypot(x, z)
    return [(lx + (x / l) * frac * ca - (z / l) * frac * sa) / S, (lz + (x / l) * frac * sa + (z / l) * frac * ca) / S] as [number, number]
  })
}

/** Segments of the wall line that run along this plot's outward edges. */
function wallSegments(ctx: BuildCtx): [[number, number], [number, number]][] {
  const s = ctx.spot
  const line = wallLine(ctx)
  const out: [[number, number], [number, number]][] = []
  // the plot's outward edges, as angle ranges in local space
  const angs = s.outEdges.map((e) => dirAngle(e) - s.out)
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length]
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2
    const ok = angs.some((x) => Math.abs(Math.atan2(Math.sin(x - ang), Math.cos(x - ang))) < 0.2)
    if (ok && Math.hypot(mx, mz) < 1.4 / S) out.push([a, b])
  }
  return out
}

/** The yard behind walls and towers: a guardhouse, a rack of spears, a brazier, stores. */
function guardYard(k: Kit, ctx: BuildCtx) {
  const r = rng(ctx.seed * 43 + 1)
  const roof = roofColour(ctx.team, r)
  k.group({ p: [-0.2, 0, -0.06], r: [0, Math.PI / 2 + 0.2, 0] }, () => {
    const w = 0.3, d = 0.22, h = 0.18
    k.add(box(w + 0.02, 0.03, d + 0.02), P.stoneDark, { p: [0, 0.015, 0] }, { pattern: 'stone' })
    k.add(rbox(w, h, d, 0.006), P.stone, { p: [0, h / 2 + 0.02, 0] }, { pattern: 'stone' })
    gableEnds(k, w, d, 0.13, P.stone, { p: [0, h + 0.02, 0] }, 'stone')
    gableRoof(k, w, d, 0.13, roof, { p: [0, h + 0.02, 0] }, { ridge: shade(roof, 0.72), over: 0.03 })
    doorAt(k, 0.04, d / 2, 0, 0.065, 0.12, ctx.team.dark)
    windowAt(k, -0.08, 0.13, d / 2, 0, 0.04, 0.045, 0.9)
    k.add(rbox(0.04, 0.3, 0.04, 0.005), P.chimney, { p: [-0.1, 0.24, -0.05] }, { pattern: 'stone' })
    k.anchor('chimney', [-0.1, 0.4, -0.05])
  })
  // spear rack
  k.group({ p: [0.12, 0, 0.18], r: [0, -0.4, 0] }, () => {
    k.add(box(0.14, 0.01, 0.016), P.timberDark, { p: [0, 0.08, 0] })
    for (let i = 0; i < 4; i++) {
      k.add(cyl(0.004, 0.004, 0.2, 4), P.timber, { p: [-0.05 + i * 0.033, 0.1, 0.008], r: [-0.1, 0, 0] })
      k.add(cone(0.008, 0.026, 4), P.steel, { p: [-0.05 + i * 0.033, 0.21, -0.003], r: [-0.1, 0, 0] })
    }
  })
  // a brazier and stores
  k.add(cyl(0.006, 0.006, 0.08, 4), P.iron, { p: [0.05, 0.04, -0.22] })
  k.add(cyl(0.03, 0.018, 0.03, 8), P.iron, { p: [0.05, 0.09, -0.22] })
  k.add(ico(0.02, 0), '#FF9A4A', { p: [0.05, 0.11, -0.22] }, { glow: 2.4 })
  barrel(k, -0.02, 0.3)
  crate(k, 0.06, 0.32, 0.9, 0.4)
}

function wall(k: Kit, ctx: BuildCtx) {
  lot(k, ctx, mix(lin(P.gravel), lin('#BFAE8A'), 0.4), 'none')
  const segs = wallSegments(ctx)
  const H = 0.3, T = 0.1
  segs.forEach(([a, b], i) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
    k.group({ p: [mx, 0, mz], r: [0, -ang, 0] }, () => {
      // local: x along the wall, +z outward (toward the open land)
      k.add(rbox(len + 0.02, H, T, 0.008), P.stone, { p: [0, H / 2 - 0.04, 0] }, { pattern: 'stone' })
      k.add(box(len + 0.04, 0.05, T + 0.03), P.stoneDark, { p: [0, -0.02, 0] }, { pattern: 'stone' })
      // crenellations on the outer side, a low parapet inside
      const n = Math.floor(len / 0.075)
      for (let j = 0; j < n; j++) k.add(box(0.04, 0.05, 0.03), P.stone, { p: [-len / 2 + (len / n) * (j + 0.5), H - 0.015, T / 2 - 0.015] }, { pattern: 'stone' })
      k.add(box(len, 0.025, 0.02), P.stone, { p: [0, H - 0.03, -T / 2 + 0.01] }, { pattern: 'stone' })
      k.add(box(len, 0.004, T - 0.04), '#B9AD96', { p: [0, H - 0.04, 0] })
      const gate = segs.length === 3 && i === 1
      if (gate) {
        // gatehouse: a taller block with an arch, a portcullis and a banner
        k.add(rbox(0.22, 0.42, 0.16, 0.01), P.stone, { p: [0, 0.17, 0] }, { pattern: 'stone' })
        for (let j = 0; j < 3; j++) k.add(box(0.045, 0.05, 0.04), P.stone, { p: [-0.075 + j * 0.075, 0.405, 0.06] }, { pattern: 'stone' })
        for (let j = 0; j < 3; j++) k.add(box(0.045, 0.05, 0.04), P.stone, { p: [-0.075 + j * 0.075, 0.405, -0.06] }, { pattern: 'stone' })
        for (const sz of [-1, 1]) {
          k.add(box(0.09, 0.13, 0.01), '#2E2925', { p: [0, 0.065, sz * 0.081] })
          k.add(cyl(0.045, 0.045, 0.01, 10), '#2E2925', { p: [0, 0.13, sz * 0.081], r: [Math.PI / 2, 0, 0] })
        }
        for (let j = 0; j < 4; j++) k.add(box(0.005, 0.15, 0.006), P.iron, { p: [-0.03 + j * 0.02, 0.085, 0.087] })
        k.add(box(0.08, 0.12, 0.004), ctx.team.base, { p: [0, 0.3, 0.083] }, { flutter: (_x, y) => Math.max(0, 0.06 - y) * 0.04 })
        k.add(box(0.08, 0.016, 0.005), ctx.team.light, { p: [0, 0.27, 0.084] })
        k.anchor('guard', [0, 0.38, -0.02])
      }
    })
    // a small turret at each joint
    if (i === 0 || segs.length > 1) {
      const [px, pz] = i === 0 ? a : b
      k.add(cyl(0.075, 0.085, 0.38, 10), P.stone, { p: [px, 0.15, pz] }, { pattern: 'stone' })
      for (let j = 0; j < 6; j++) {
        const t = (j / 6) * Math.PI * 2
        k.add(box(0.035, 0.045, 0.03), P.stone, { p: [px + Math.cos(t) * 0.066, 0.36, pz + Math.sin(t) * 0.066], r: [0, -t, 0] }, { pattern: 'stone' })
      }
    }
    if (i === segs.length - 1) {
      const [px, pz] = b
      k.add(cyl(0.075, 0.085, 0.38, 10), P.stone, { p: [px, 0.15, pz] }, { pattern: 'stone' })
      for (let j = 0; j < 6; j++) {
        const t = (j / 6) * Math.PI * 2
        k.add(box(0.035, 0.045, 0.03), P.stone, { p: [px + Math.cos(t) * 0.066, 0.36, pz + Math.sin(t) * 0.066], r: [0, -t, 0] }, { pattern: 'stone' })
      }
    }
  })
  guardYard(k, ctx)
}

function tower(k: Kit, ctx: BuildCtx) {
  lot(k, ctx, mix(lin(P.gravel), lin('#BFAE8A'), 0.4), 'none')
  guardYard(k, ctx)
  // stand on the wall line, straight out from the plot
  const line = wallLine(ctx, 0.02)
  let tx = 0.45
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length]
    if ((a[1] <= 0 && b[1] >= 0) || (a[1] >= 0 && b[1] <= 0)) {
      if (a[1] === b[1]) continue
      const x = a[0] + ((0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
      if (x > 0 && x < 1.5 / S) tx = Math.min(tx === 0.45 ? x : tx, x)
    }
  }
  const R = 0.19, H = 0.86
  k.group({ p: [tx - 0.04, 0, 0] }, () => {
    k.add(cyl(R + 0.03, R + 0.05, 0.08, 16), P.stoneDark, { p: [0, 0.0, 0] }, { pattern: 'stone' })
    k.add(cyl(R, R + 0.02, H, 16), P.stone, { p: [0, H / 2, 0] }, { pattern: 'stone' })
    k.add(cyl(R + 0.035, R + 0.01, 0.06, 16), P.stoneDark, { p: [0, H + 0.01, 0] }, { pattern: 'stone' })
    for (let j = 0; j < 12; j++) {
      const t = (j / 12) * Math.PI * 2
      k.add(box(0.05, 0.06, 0.04), P.stone, { p: [Math.cos(t) * (R + 0.015), H + 0.07, Math.sin(t) * (R + 0.015)], r: [0, -t, 0] }, { pattern: 'stone' })
    }
    // conical roof on posts above the crenels
    k.add(cyl(R - 0.04, R - 0.04, 0.12, 12), P.stone, { p: [0, H + 0.08, 0] }, { pattern: 'stone' })
    k.add(spire(R + 0.02, 0.38, 14), ctx.team.base, { p: [0, H + 0.13, 0] }, { pattern: 'roof' })
    k.add(cyl(R + 0.025, R + 0.025, 0.012, 14), ctx.team.dark, { p: [0, H + 0.135, 0] })
    flagPole(k, 0, 0, H + 0.62, ctx.team, 0.16)
    // arrow slits and a lit window
    for (const a of [0, 1.1, -1.1, 2.4, -2.4]) {
      k.group({ p: [0, 0, 0], r: [0, -a, 0] }, () => {
        k.add(box(0.012, 0.07, 0.01), '#2E2925', { p: [R + 0.006, 0.55, 0], r: [0, Math.PI / 2, 0] })
      })
    }
    windowAt(k, -R - 0.003, 0.32, 0, -Math.PI / 2, 0.04, 0.055, 0.9)
    doorAt(k, -R - 0.005, 0, -Math.PI / 2, 0.07, 0.13)
    k.anchor('guard', [0.05, H + 0.02, 0])
  })
}

// ---------------------------------------------------------------------------------------------
// The square, empty lots and construction sites

export function square(k: Kit, ctx: { capital: boolean; team: Team; seed: number }) {
  // round flagstone plaza
  k.add(cyl(0.96, 0.96, 0.03, 40), lin('#D9CDB4'), { p: [0, 0.015, 0] }, { pattern: 'flags' })
  k.add(torus(0.96, 0.016, 4, 40), '#BFB197', { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0] }, { pattern: 'stone' })
  // the old linden in the middle, a round bench around it
  k.add(cyl(0.2, 0.21, 0.06, 18), P.stone, { p: [0, 0.06, 0] }, { pattern: 'stone' })
  k.add(cyl(0.17, 0.17, 0.065, 18), P.soil, { p: [0, 0.065, 0] })
  k.group({ p: [0, 0.095, 0], s: 1.1 }, () => broadleaf(k, '#5E8F3E', '#86B252', 21))
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    k.add(box(0.075, 0.012, 0.04), '#A27850', { p: [Math.cos(a) * 0.255, 0.07, Math.sin(a) * 0.255], r: [0, -a + Math.PI / 2, 0] }, { pattern: 'boards' })
  }
  // the well
  k.group({ p: [0.52, 0.03, 0.3] }, () => {
    k.add(cyl(0.075, 0.08, 0.08, 14), P.stone, { p: [0, 0.04, 0] }, { pattern: 'stone' })
    k.add(cyl(0.058, 0.058, 0.005, 14), '#2D4E58', { p: [0, 0.075, 0] }, { glow: 0.02 })
    for (const s of [-1, 1]) k.add(box(0.012, 0.2, 0.012), P.timberDark, { p: [s * 0.07, 0.15, 0] })
    k.add(cyl(0.006, 0.006, 0.16, 5), P.timberDark, { p: [0, 0.19, 0], r: [0, 0, Math.PI / 2] })
    gableRoof(k, 0.2, 0.15, 0.06, lin(ctx.team.base), { p: [0, 0.24, 0] }, { over: 0.01, t: 0.012 })
    k.add(cyl(0.016, 0.014, 0.025, 8), P.timber, { p: [0.02, 0.13, 0] })
  })
  // capital: a maypole with ribbons in the town colours; otherwise a stone with the banner
  if (ctx.capital) {
    k.group({ p: [-0.5, 0.03, -0.32] }, () => {
      k.add(cyl(0.012, 0.016, 0.82, 8), '#F4EFE6', { p: [0, 0.41, 0] })
      k.add(cyl(0.006, 0.006, 0.36, 6), '#F4EFE6', { p: [0, 0.62, 0], r: [0, 0, Math.PI / 2] })
      for (const s of [-1, 1]) {
        k.add(torus(0.06, 0.016, 5, 14), '#6E9A4F', { p: [s * 0.14, 0.56, 0], r: [0, Math.PI / 2, 0] }, { jit: 0.2 })
        for (let i = 0; i < 2; i++) k.add(box(0.008, 0.14, 0.004), i ? ctx.team.base : ctx.team.light, { p: [s * 0.14 + i * 0.01, 0.43, 0.01] }, { flutter: (_x, y) => Math.max(0, -y + 0.07) * 0.06 })
      }
      k.add(torus(0.05, 0.016, 5, 14), '#6E9A4F', { p: [0, 0.8, 0], r: [Math.PI / 2, 0, 0] }, { jit: 0.2 })
      k.add(ico(0.02, 0), '#F2CF5B', { p: [0.04, 0.8, 0.03] })
      k.add(ico(0.02, 0), '#E86A8A', { p: [-0.04, 0.8, -0.02] })
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        k.add(box(0.006, 0.6, 0.004), [ctx.team.base, P.cloth, ctx.team.light][i % 3], { p: [Math.cos(a) * 0.06, 0.48, Math.sin(a) * 0.06], r: [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12] }, { flutter: (_x, y) => Math.max(0, 0.3 - y) * 0.02 })
      }
    })
  } else {
    flagPole(k, -0.52, -0.3, 0.6, ctx.team, 0.15)
    k.add(cyl(0.05, 0.06, 0.05, 8), P.stone, { p: [-0.52, 0.055, -0.3] }, { pattern: 'stone' })
  }
  // benches and flower tubs
  for (const [x, z, a] of [[-0.55, 0.42, 0.6], [0.2, -0.66, -0.2], [0.68, -0.2, 1.2]] as const) {
    k.group({ p: [x, 0.03, z], r: [0, a, 0] }, () => {
      k.add(box(0.14, 0.012, 0.04), '#A27850', { p: [0, 0.04, 0] }, { pattern: 'boards' })
      k.add(box(0.14, 0.035, 0.008), '#A27850', { p: [0, 0.065, -0.02] })
      for (const s of [-1, 1]) k.add(box(0.008, 0.04, 0.035), P.iron, { p: [s * 0.06, 0.02, 0] })
    })
  }
  for (const [x, z, c] of [[-0.18, 0.62, '#E86A8A'], [0.62, -0.42, '#F2CF5B'], [-0.7, 0.05, '#F4EFE2']] as const) {
    k.add(cyl(0.045, 0.035, 0.05, 10), '#B86B4B', { p: [x, 0.055, z] })
    k.group({ p: [x, 0.07, z], s: 0.7 }, () => bush(k, BIOME.grass.dark, Math.round(x * 100), c))
  }
  // a lantern post or two
  for (const [x, z] of [[0.36, -0.52], [-0.38, 0.62]] as const) {
    k.add(cyl(0.006, 0.009, 0.26, 6), P.iron, { p: [x, 0.16, z] })
    k.add(box(0.03, 0.04, 0.03), '#FFD08A', { p: [x, 0.3, z] }, { glow: 1.4 })
    k.add(cone(0.026, 0.025, 4), P.iron, { p: [x, 0.33, z], r: [0, Math.PI / 4, 0] })
  }
}

export function emptyLot(k: Kit, ctx: BuildCtx) {
  const rot = lotRot(ctx.spot)
  const r = rng(ctx.seed * 41 + 3)
  lot(k, ctx, mix(lin(P.lawnLight), lin(P.lawn), 0.25 + r() * 0.2), 'grass', true)
  // a surveyor's stake with a little flag in the town colour: this plot is free
  const pts = hexPts(LOT_R - 0.08, rot)
  const [sx, sz] = pts[Math.floor(r() * 6)]
  k.add(box(0.012, 0.11, 0.012), '#D8C29A', { p: [sx, 0.055, sz] })
  k.add(box(0.045, 0.028, 0.003), ctx.team.base, { p: [sx + 0.023, 0.095, sz] }, { flutter: (fx) => Math.max(0, fx + 0.022) * 0.25 })
  // wild meadow: low tufts and flowers
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2, d = 0.1 + r() * 0.32
    k.group({ p: [Math.cos(a) * d, 0, Math.sin(a) * d], r: [0, r() * 6, 0], s: 0.32 + r() * 0.18 }, () => tuft(k))
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, d = 0.08 + r() * 0.38
    k.add(cyl(0.002, 0.002, 0.03, 3), BIOME.grass.dark, { p: [Math.cos(a) * d, 0.015, Math.sin(a) * d] })
    k.add(ico(0.01, 0), ['#F4EFE2', '#F2CF5B', '#D99AB8', '#F4EFE2'][i % 4], { p: [Math.cos(a) * d, 0.032, Math.sin(a) * d] })
  }
  // and sometimes materials waiting for a builder
  const v = Math.floor(r() * 3)
  if (v === 0) {
    k.group({ p: [-0.16, 0, 0.22], r: [0, r() * 3, 0] }, () => {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) k.add(box(0.2, 0.014, 0.04), mix(lin('#D9B784'), lin('#C49A66'), hash(i * 3 + j, 4)), { p: [0, 0.008 + i * 0.015, (j - (2 - i) / 2) * 0.042] })
    })
  } else if (v === 1) {
    k.group({ p: [0.2, 0, -0.18] }, () => {
      for (let i = 0; i < 5; i++) k.add(rbox(0.05, 0.03, 0.04, 0.006), i % 2 ? P.stone : P.granite, { p: [(i % 3) * 0.045 - 0.04, 0.015 + Math.floor(i / 3) * 0.03, (i % 2) * 0.03], r: [0, i * 0.7, 0] }, { pattern: 'stone' })
    })
  }
}

/** Scaffolding around a footprint for a construction site. */
export function scaffold(k: Kit, ctx: BuildCtx, height: number) {
  const rot = lotRot(ctx.spot)
  const pts = hexPts(LOT_R - 0.12, rot)
  const h = Math.max(0.25, Math.min(0.55, height * 0.7))
  pts.forEach(([x, z]) => k.add(box(0.012, h, 0.012), '#C9A97A', { p: [x, h / 2, z] }))
  for (const y of [h * 0.45, h * 0.95]) for (let i = 0; i < 6; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % 6]
    const len = Math.hypot(bx - ax, bz - az)
    k.add(box(len, 0.008, 0.03), '#B98F5E', { p: [(ax + bx) / 2, y, (az + bz) / 2], r: [0, -Math.atan2(bz - az, bx - ax), 0] })
  }
  // a little treadwheel crane
  const [cx, cz] = pts[1]
  k.group({ p: [cx * 1.05, 0, cz * 1.05] }, () => {
    k.add(box(0.014, h + 0.15, 0.014), P.timberDark, { p: [0, (h + 0.15) / 2, 0] })
    k.add(box(0.3, 0.012, 0.012), P.timberDark, { p: [-0.1, h + 0.14, 0], r: [0, 0.4, 0.1] })
    k.add(cyl(0.002, 0.002, 0.18, 3), P.rope, { p: [-0.22, h + 0.05, 0.1] })
    k.add(box(0.04, 0.03, 0.03), P.stone, { p: [-0.22, h - 0.05, 0.1] })
  })
  k.add(box(0.12, 0.04, 0.08), P.stone, { p: [0.28, 0.02, 0.32] }, { pattern: 'stone' })
  k.add(box(0.2, 0.03, 0.06), '#D9B784', { p: [-0.3, 0.015, 0.3], r: [0, 0.4, 0] })
  k.anchor('work', [0.2, 0, 0.2])
  k.anchor('work', [-0.15, 0, -0.25])
}

// ---------------------------------------------------------------------------------------------

export function buildModel(type: BuildingType | 'empty', ctx: BuildCtx): Model {
  const k = new Kit()
  const spinners: Spinner[] = []
  const bobbers: Bobber[] = []
  k.group({ s: S }, () => build(k, type, ctx, spinners, bobbers))
  const anchors = k.anchors.slice()
  const geo = k.build()
  return { geo, spinners, bobbers, anchors, height: geo.boundingBox ? geo.boundingBox.max.y : 0.5 }
}

function build(k: Kit, type: BuildingType | 'empty', ctx: BuildCtx, spinners: Spinner[], bobbers: Bobber[]) {
  switch (type) {
    case 'house': houses(k, ctx); break
    case 'farm': farm(k, ctx); break
    case 'sawmill': sawmill(k, ctx, spinners); break
    case 'workshop': workshop(k, ctx); break
    case 'market': market(k, ctx); break
    case 'harbor': harbor(k, ctx, bobbers); break
    case 'barracks': barracks(k, ctx); break
    case 'temple': temple(k, ctx); break
    case 'tower': tower(k, ctx); break
    case 'wall': wall(k, ctx); break
    case 'empty': emptyLot(k, ctx); break
  }
}

/** The lot alone (for construction sites: the building rises out of it). */
export function buildLotOnly(ctx: BuildCtx): THREE.BufferGeometry {
  const k = new Kit()
  k.group({ s: S }, () => {
    lot(k, ctx, mix(lin(P.gravel), lin('#C9B58F'), 0.5), 'none')
    scaffold(k, ctx, 0.5)
  })
  return k.build()
}
