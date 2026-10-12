// Cities: the jewels of the board. Each city is laid out on the 19 plots of the city interior
// (engine/city.ts): the square in the middle, six inner plots and twelve outer plots that face the
// real neighbouring tiles. When the engine provides `interior`, the map city mirrors it; otherwise a
// plan is derived from population, terrain, capital and walls, seeded by the city id so every town
// looks a little different. Buildings are instanced per variant (one draw call each).
import * as THREE from 'three'
import { AXIAL_DIRS, SQRT3 } from '../../../engine/hex.ts'
import { type BuildingType, type CityInterior, PLOTS, fortifiedSides, neighborInDir } from '../../../engine/city.ts'
import { CITY_MAX_HP } from '../../../engine/config.ts'
import type { Biome, City, CityId, GameMap, GameState, PlayerId, TileId } from '../../../engine/types.ts'
import { type CityVariant, ROOFS, RING_R, WALL_IN, barnIsFalu, cityModel, hueClash, plasterFor } from './cityModels.ts'
import { type Board, clamp01, colorIndexOf, easeOutBack, easeOutCubic, hash01, teamColors } from './common.ts'
import type { Fx } from './fx.ts'
import { Batch, billboardQuad, spriteMaterial, textures } from './gfx.ts'
import { pieceMaterial } from './kit.ts'
import type { Label, Labels } from './labels.ts'

export const PLAZA_Y = 0.014

/** A roof for an ordinary building: seeded from the curated mix, rarely the player's dark tone. */
function roofPicker(team: THREE.Color, rnd: () => number): () => Spec['roof'] {
  const list = ROOFS.map((r) => ({ c: r.color, w: r.weight * (hueClash(r.color, team) ? 0.12 : 1) }))
  const total = list.reduce((a, b) => a + b.w, 0)
  return () => {
    if (rnd() < 0.1) return 'dark'
    let x = rnd() * total
    for (const r of list) if ((x -= r.w) <= 0) return r.c
    return list[0].c
  }
}

const INNER_R = 0.5
const CORNER_R = 0.715 // outer plots facing one neighbour (towards an edge midpoint)
const SIDE_R = 0.785 // outer plots facing two neighbours (towards a tile corner)

const ALL_VARIANTS: CityVariant[] = [
  'cottage', 'thatched', 'townhouse', 'longhouse', 'hiphouse', 'tallhouse', 'keep', 'hall', 'temple', 'market', 'workshop', 'barracks',
  'farmWheat', 'farmGreens', 'farmFlowers', 'farmWheatTar', 'sawmill', 'jetty', 'stairs', 'boat', 'wall', 'gate', 'tower',
  'ground', 'lanterns', 'road', 'well', 'linden', 'blossom', 'bushes', 'garden', 'flowerbed', 'hedge',
]
const FLAT: Set<CityVariant> = new Set(['ground', 'road', 'garden', 'flowerbed'])
const OUTSIDE: Set<CityVariant> = new Set(['jetty', 'stairs', 'boat'])
const CAPACITY: Partial<Record<CityVariant, number>> = { cottage: 640, thatched: 400, townhouse: 640, hiphouse: 640, longhouse: 400, tallhouse: 400, wall: 400, tower: 400 }

/** One placed building in tile-local space (y relative to the tile top). */
export interface Spec {
  key: string
  v: CityVariant
  x: number
  z: number
  y: number
  yaw: number
  s: number | [number, number, number]
  wall: THREE.Color
  shade: number
  /** Roof: a tone of the player colour, or a fixed colour (terracotta, slate). */
  roof?: 'base' | 'light' | 'dark' | THREE.Color
  order: number
  bob?: number
}

interface Piece {
  spec: Spec
  slot: number
  rise: number
  target: 0 | 1
  delay: number
  sweepDelay: number
}

export interface CityVis {
  id: CityId
  owner: PlayerId
  colorIdx: number
  tile: TileId
  name: string
  pop: number
  hp: number
  walls: boolean
  capital: boolean
  planKey: string
  pieces: Map<string, Piece>
  /** Roof colour transition (capture sweep). */
  fromColor: THREE.Color
  toColor: THREE.Color
  fromTones: { base: THREE.Color; light: THREE.Color; dark: THREE.Color }
  toTones: { base: THREE.Color; light: THREE.Color; dark: THREE.Color }
  sweep: number
  smoke: { at: THREE.Vector3; t: number; key: string }[]
  /** Fog: shown from memory (the tile is explored but out of sight). `veil` eases towards it. */
  memory: boolean
  veil: number
  /** Soft glows around lanterns. */
  halos: { slot: number; at: THREE.Vector3; key: string; phase: number }[]
  plaque: Label
  popEl: HTMLElement
  hpEl: HTMLElement
  shown: boolean
  dirty: boolean
}

// ---------------------------------------------------------------------------------------------
// Planning

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

function dirAngle(d: number): number {
  const [q, r] = AXIAL_DIRS[d]
  return Math.atan2(1.5 * r, SQRT3 * (q + r / 2))
}

/** Angle and radius of a plot's centre in tile space. */
function plotAt(i: number): { a: number; r: number } {
  const p = PLOTS[i]
  if (p.ring === 0) return { a: 0, r: 0 }
  const a = Math.atan2(p.z, p.x)
  return { a, r: p.ring === 1 ? INNER_R : p.facing.length === 1 ? CORNER_R : SIDE_R }
}

/** Yaw that turns a model's +z towards direction angle `a`. */
const yawTo = (a: number) => Math.atan2(Math.cos(a), Math.sin(a))

const isWaterBiome = (b: Biome | undefined) => b === 'deep' || b === 'shallow'

export function interiorOf(city: City): CityInterior | null {
  return (city as City & { interior?: CityInterior | null }).interior ?? null
}

export function planCity(board: Board, map: GameMap, city: City, team: THREE.Color): Spec[] {
  const interior = interiorOf(city)
  const rnd = rng(city.id * 7919 + 17)
  const tile = city.tile
  const top = board.tops[tile]
  const out: Spec[] = []
  const neighbour = (d: number) => neighborInDir(map, tile, d)
  const biomeAt = (d: number) => {
    const n = neighbour(d)
    return n === null ? undefined : map.tiles[n].biome
  }
  const faces = (i: number) => PLOTS[i].facing.map(biomeAt)
  const plaster = () => plasterFor(team, rnd())
  const neutralPlaster = plasterFor(team, 0)
  const falu = barnIsFalu(team)
  const roofOf = roofPicker(team, rnd)
  let order = 1
  const push = (s: Omit<Spec, 'wall' | 'shade' | 'order' | 'y' | 's'> & Partial<Spec>) =>
    out.push({ y: 0, s: 1, wall: neutralPlaster, shade: 1, order: order++, ...s })
  const atPlot = (i: number, v: CityVariant, o: { out?: boolean; dr?: number; key?: string; shade?: number; wall?: THREE.Color; s?: number; roof?: Spec['roof'] } = {}) => {
    const { a, r } = plotAt(i)
    const rr = r + (o.dr ?? 0)
    const ja = (rnd() - 0.5) * 0.06
    push({
      key: o.key ?? `${v}:${i}`, v, x: Math.cos(a + ja) * rr, z: Math.sin(a + ja) * rr,
      yaw: (o.out ? yawTo(a) : yawTo(a + Math.PI)) + (rnd() - 0.5) * 0.22,
      wall: o.wall ?? plaster(), shade: o.shade ?? 1, s: (o.s ?? 1) * 1.12, roof: o.roof,
    })
  }
  const house = (i: number) => {
    const ring = PLOTS[i].ring
    const w = rnd()
    let v: CityVariant
    if (ring === 1) v = w < 0.3 ? 'townhouse' : w < 0.52 ? 'tallhouse' : w < 0.75 ? 'hiphouse' : 'cottage'
    else v = w < 0.28 ? 'cottage' : w < 0.46 ? 'thatched' : w < 0.62 ? 'longhouse' : w < 0.8 ? 'hiphouse' : 'townhouse'
    atPlot(i, v, { key: `house:${i}`, shade: 0.93 + rnd() * 0.14, s: 0.94 + rnd() * 0.12, roof: roofOf() })
  }
  const farm = (i: number) => {
    const c = rnd()
    const v: CityVariant = !falu ? (c < 0.6 ? 'farmWheatTar' : 'farmGreens') : c < 0.5 ? 'farmWheat' : c < 0.8 ? 'farmGreens' : 'farmFlowers'
    atPlot(i, v, { key: `farm:${i}`, out: true, dr: PLOTS[i].facing.length === 1 ? -0.025 : -0.005, s: 0.9, roof: roofOf() })
  }
  const harbour = (i: number) => {
    // the plot's water-facing side; the jetty runs out from the tile edge over the water
    const d = PLOTS[i].facing.find((f) => isWaterBiome(biomeAt(f)))
    if (d === undefined) return
    const n = neighbour(d)!
    const a = dirAngle(d)
    const waterY = board.tops[n].y - top.y
    const deck = waterY + 0.045
    const yaw = yawTo(a)
    const edge = (SQRT3 / 2) * board.R
    push({ key: `jetty:${i}`, v: 'jetty', x: Math.cos(a) * (edge - 0.02), z: Math.sin(a) * (edge - 0.02), y: deck, yaw })
    if (-deck > 0.03) push({ key: `stairs:${i}`, v: 'stairs', x: Math.cos(a) * (edge - 0.07), z: Math.sin(a) * (edge - 0.07), y: deck, yaw, s: [1, -deck, 1] })
    const side = 0.075
    const bx = Math.cos(a) * (edge + 0.27) - Math.sin(a) * side
    const bz = Math.sin(a) * (edge + 0.27) + Math.cos(a) * side
    push({ key: `boat:${i}`, v: 'boat', x: bx, z: bz, y: waterY + 0.012, yaw: yaw + 0.15, bob: rnd() * 6 })
    // a boathouse-ish cottage by the water on the plot itself
    atPlot(i, 'cottage', { key: `harbourhouse:${i}`, dr: -0.04, shade: 0.95, s: 0.85, roof: roofOf() })
  }
  const building = (i: number, b: BuildingType) => {
    switch (b) {
      case 'house': house(i); break
      case 'farm': farm(i); break
      case 'sawmill': atPlot(i, 'sawmill', { out: true, dr: 0.01, roof: roofOf() }); break
      case 'workshop': atPlot(i, 'workshop', { roof: roofOf() }); break
      case 'market': atPlot(i, 'market'); break
      case 'harbor': harbour(i); break
      case 'barracks': atPlot(i, 'barracks'); break
      case 'temple': atPlot(i, 'temple'); break
      case 'tower': atPlot(i, 'tower', { out: true, dr: 0.04 }); break
      case 'wall': break // drawn along the sides it covers
    }
  }

  push({ key: 'ground', v: 'ground', x: 0, z: 0, yaw: 0 })
  push({ key: 'lanterns', v: 'lanterns', x: 0, z: 0, yaw: 0 })

  // centrepiece at the mouth of a lane at the back of the square
  const backLanes = [-90, -30, -150].map((deg) => (deg * Math.PI) / 180)
  const centreA = backLanes[Math.floor(rnd() * backLanes.length)]
  const cp = rnd()
  const centre: CityVariant = cp < 0.38 ? 'well' : cp < 0.72 ? 'linden' : 'blossom'

  let walled: Set<number>
  let roads: number[] = []
  if (interior) {
    for (let i = 1; i < PLOTS.length; i++) {
      const b = interior.plots[i]
      if (b) building(i, b)
    }
    // the town's heart stands at the head of the square, its well or tree at another lane
    const heartA = centreA
    const otherA = backLanes.find((a) => a !== heartA) ?? backLanes[1]
    push({ key: 'heart', v: city.capital ? 'keep' : 'hall', x: Math.cos(heartA) * 0.47, z: Math.sin(heartA) * 0.47, yaw: yawTo(heartA + Math.PI), s: city.capital ? 1.12 : 0.95 })
    push({ key: 'centre', v: centre, x: Math.cos(otherA) * 0.45, z: Math.sin(otherA) * 0.45, yaw: rnd() * 6 })
    walled = fortifiedSides(interior, 'wall')
    // roads leave through empty corner plots facing land
    for (let d = 0; d < 6; d++) {
      const corner = PLOTS.findIndex((p) => p.ring === 2 && p.facing.length === 1 && p.facing[0] === d)
      if (!interior.plots[corner] && neighbour(d) !== null && !isWaterBiome(biomeAt(d))) roads.push(d)
    }
    roads = roads.sort((a, b) => Math.sin(dirAngle(b)) - Math.sin(dirAngle(a))).slice(0, 2)
    // flowering bushes on a couple of empty outer plots (greenery only; the plots stay free)
    const empty = Array.from({ length: 12 }, (_, k) => k + 7).filter((i) => !interior.plots[i] && !roads.some((d) => PLOTS[i].facing.length === 1 && PLOTS[i].facing[0] === d))
    const greens: CityVariant[] = ['bushes', 'linden', 'flowerbed', 'blossom', 'hedge', 'garden']
    for (let k = 0; k < Math.min(4, empty.length); k++) {
      const i = empty[Math.floor(rnd() * empty.length)]
      const v = greens[Math.floor(rnd() * greens.length)]
      if (!out.some((sp) => sp.key.startsWith('green:') && sp.key.endsWith(`:${i}`))) atPlot(i, v, { key: `green:${v}:${i}`, dr: 0.02, s: v === 'bushes' ? 1 : 0.85 })
    }
  } else {
    const P = Math.max(1, city.pop)
    const inner = [1, 2, 3, 4, 5, 6].sort((a, b) => Math.sin(plotAt(a).a) - Math.sin(plotAt(b).a) + (rnd() - 0.5) * 0.3)
    const outer = Array.from({ length: 12 }, (_, k) => k + 7)
    const used = new Set<number>()
    const take = (i: number | undefined, fn: (i: number) => void) => {
      if (i === undefined || used.has(i)) return
      used.add(i)
      fn(i)
    }
    // walls on every land side when the city has them; the gate (and a road) faces the viewer's side
    walled = new Set()
    const landDirs = [0, 1, 2, 3, 4, 5].filter((d) => neighbour(d) !== null && !isWaterBiome(biomeAt(d)))
    if (city.walls) for (let d = 0; d < 6; d++) if (!isWaterBiome(biomeAt(d))) walled.add(d)
    const byFront = [...landDirs].sort((a, b) => Math.sin(dirAngle(b)) - Math.sin(dirAngle(a)))
    if (byFront.length) roads.push(byFront[0])
    if (byFront.length > 2 && rnd() < 0.7) roads.push(byFront[1 + Math.floor(rnd() * (byFront.length - 1))])
    for (const d of roads) used.add(outer.find((i) => PLOTS[i].facing.length === 1 && PLOTS[i].facing[0] === d)!)
    // heart of the town at the back
    take(inner[0], (i) => atPlot(i, city.capital ? 'keep' : 'hall', { key: 'heart' }))
    // harbour on the water side
    const water = outer.filter((i) => !used.has(i) && faces(i).some(isWaterBiome)).sort((a, b) => PLOTS[a].facing.length - PLOTS[b].facing.length || Math.sin(plotAt(b).a) - Math.sin(plotAt(a).a))
    take(water[0], harbour)
    // market and temple as the town grows
    if (P >= 3) take([...inner].reverse().find((i) => !used.has(i)), (i) => atPlot(i, 'market'))
    if (P >= 5) take(inner.find((i) => !used.has(i)), (i) => atPlot(i, 'temple'))
    // fields in front, a sawmill facing the woods
    const farmland = outer.filter((i) => !used.has(i) && faces(i).some((b) => b === 'grass' || b === 'plains'))
      .sort((a, b) => Math.sin(plotAt(b).a) - Math.sin(plotAt(a).a))
    const fields = Math.min(farmland.length, 1 + Math.floor(P / 3))
    for (let k = 0; k < fields; k++) take(farmland[k], farm)
    if (P >= 3) take(outer.find((i) => !used.has(i) && faces(i).some((b) => b === 'forest' || b === 'hills')), (i) => atPlot(i, 'sawmill', { out: true, dr: 0.01, roof: roofOf() }))
    // houses: inner first (back to front), then outer (back to front)
    const houses = Math.round(1 + P * 1.5) + (city.capital ? 1 : 0)
    const order2 = [...inner, ...outer.filter((i) => !used.has(i)).sort((a, b) => Math.sin(plotAt(a).a) - Math.sin(plotAt(b).a) + (rnd() - 0.5) * 0.4)]
    let placed = 0
    for (const i of order2) {
      if (placed >= houses) break
      if (used.has(i)) continue
      take(i, house)
      placed++
    }
    // gardens and flowering bushes in a few of the empty outer plots
    const empty = outer.filter((i) => !used.has(i))
    const greens = Math.min(empty.length, 2 + Math.floor(P / 4))
    for (let k = 0; k < greens; k++) {
      const i = empty[Math.floor(rnd() * empty.length)]
      const kinds: CityVariant[] = ['garden', 'bushes', 'flowerbed', 'hedge']
      take(i, (j) => atPlot(j, kinds[Math.floor(rnd() * kinds.length)], { key: `green:${j}`, dr: rnd() * 0.03 }))
    }
    push({ key: 'centre', v: centre, x: Math.cos(centreA) * 0.45, z: Math.sin(centreA) * 0.45, yaw: rnd() * 6 })
  }

  // roads out to the countryside
  for (const d of roads) {
    const a = dirAngle(d)
    push({ key: `road:${d}`, v: 'road', x: Math.cos(a) * (RING_R + 0.02), z: Math.sin(a) * (RING_R + 0.02), yaw: yawTo(a) })
  }
  // walls along the covered sides, a gate on a road, towers where walls meet
  const gateSide = roads.find((d) => walled.has(d)) ?? (walled.size >= 4 ? [...walled][0] : -1)
  for (const d of walled) {
    const a = dirAngle(d)
    push({ key: `wall:${d}`, v: d === gateSide ? 'gate' : 'wall', x: Math.cos(a) * WALL_IN, z: Math.sin(a) * WALL_IN, yaw: yawTo(a) })
  }
  if (walled.size) {
    const cr = WALL_IN / Math.cos(Math.PI / 6)
    for (let c = 0; c < 6; c++) {
      // hexagon corner between sides whose angles straddle it
      const ca = dirAngle(c) + Math.PI / 6
      const sideA = [0, 1, 2, 3, 4, 5].filter((d) => Math.abs(Math.cos(dirAngle(d) - ca) - Math.cos(Math.PI / 6)) < 1e-3)
      if (!sideA.some((d) => walled.has(d))) continue
      push({ key: `corner:${c}`, v: 'tower', x: Math.cos(ca) * cr, z: Math.sin(ca) * cr, yaw: yawTo(ca), s: 0.72 })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The layer

export class CityLayer {
  readonly cities = new Map<CityId, CityVis>()
  private batches = new Map<CityVariant, Batch>()
  private halos: Batch
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private c = new THREE.Color()
  private axisY = new THREE.Vector3(0, 1, 0)
  private time = 0

  constructor(private board: Board, root: THREE.Object3D, private labels: Labels, private fx: Fx) {
    const mat = pieceMaterial({ wall: true, roughness: 0.72, flutter: 0.006, tones: true, veil: true })
    mat.side = THREE.DoubleSide
    const groundMat = pieceMaterial({ wall: true, roughness: 0.92, tones: true, veil: true })
    groundMat.polygonOffset = true
    groundMat.polygonOffsetFactor = -1
    groundMat.polygonOffsetUnits = -2
    this.halos = new Batch(root, [{
      geo: billboardQuad(),
      mat: spriteMaterial({ map: textures().blob, billboard: true, tint: '#FFC37A', blending: THREE.AdditiveBlending, depthBias: 0.04 }),
      order: 9,
    }], 512, { aAlpha: 1 })
    for (const v of ALL_VARIANTS) {
      const model = cityModel(v)
      const flatV = FLAT.has(v)
      this.batches.set(v, new Batch(root, [{ geo: model.geo, mat: flatV ? groundMat : mat, shadow: !flatV, receive: true }], CAPACITY[v] ?? 96, { aWall: 3, aTeamLight: 3, aTeamDark: 3, aVeil: 1 }))
    }
  }

  cityAt(tile: TileId): CityVis | undefined {
    for (const c of this.cities.values()) if (c.tile === tile) return c
    return undefined
  }

  /** Make the displayed cities match `state` exactly (no animation). */
  sync(state: GameState): void {
    const seen = new Set<CityId>()
    for (const city of state.cities) {
      seen.add(city.id)
      const ci = colorIndexOf(state, city.owner)
      let vis = this.cities.get(city.id)
      if (!vis || vis.tile !== city.tile) {
        if (vis) this.remove(city.id)
        this.create(state.map, city, ci, false)
        continue
      }
      if (vis.owner !== city.owner || vis.colorIdx !== ci) this.setOwner(city.id, city.owner, ci, false)
      vis.name = city.name
      vis.hp = city.hp
      this.replan(state.map, city, false)
      for (const p of vis.pieces.values()) { p.rise = p.target; p.delay = 0 }
      vis.sweep = 1
      vis.shown = true
      vis.plaque.el.style.opacity = ''
      this.updatePlaque(vis)
      vis.dirty = true
    }
    for (const id of [...this.cities.keys()]) if (!seen.has(id)) this.remove(id)
  }

  create(map: GameMap, city: City, colorIdx: number, animate: boolean): CityVis {
    const tc = teamColors(colorIdx)
    const popEl = document.createElement('span')
    popEl.className = 'pop'
    const hpEl = document.createElement('i')
    const el = document.createElement('div')
    el.className = 'cc-plaque'
    const name = document.createElement('span')
    name.className = 'name'
    const hpBar = document.createElement('span')
    hpBar.className = 'hp'
    hpBar.appendChild(hpEl)
    el.append(popEl, name, hpBar)
    const top = this.board.tops[city.tile]
    const plaque = this.labels.add(el, top.clone(), { dy: 4, zoom: 'plaque', toward: this.board.R * 0.86 })
    const vis: CityVis = {
      id: city.id, owner: city.owner, colorIdx, tile: city.tile, name: city.name, pop: city.pop, hp: city.hp,
      walls: city.walls, capital: city.capital, planKey: '', pieces: new Map(),
      fromColor: tc.base.clone(), toColor: tc.base.clone(), fromTones: tc, toTones: tc, sweep: 1, smoke: [], halos: [], memory: false, veil: 0, plaque, popEl, hpEl, shown: !animate, dirty: true,
    }
    this.cities.set(city.id, vis)
    this.replan(map, city, animate)
    if (animate) {
      vis.plaque.el.style.opacity = '0'
      for (const p of vis.pieces.values()) { p.rise = 0; p.delay = 0.04 + p.spec.order * 0.06 }
    }
    this.updatePlaque(vis)
    return vis
  }

  /** Re-plan a city after its population, walls, interior or capital status changed. New buildings rise; gone ones sink. */
  replan(map: GameMap, city: City, animate: boolean): void {
    const vis = this.cities.get(city.id)
    if (!vis) return
    const interior = interiorOf(city)
    const key = `${city.pop}|${city.walls}|${city.capital}|${interior ? interior.plots.join(',') : ''}`
    vis.pop = city.pop
    vis.walls = city.walls
    vis.capital = city.capital
    if (key === vis.planKey) return
    vis.planKey = key
    const specs = planCity(this.board, map, city, teamColors(vis.colorIdx).base)
    const want = new Map(specs.map((s) => [s.key, s]))
    let k = 0
    for (const [key2, p] of vis.pieces) {
      const s = want.get(key2)
      if (!s || s.v !== p.spec.v) {
        p.target = 0
        if (!animate) p.rise = 0
      } else {
        // keep its look (plaster) so a re-plan never repaints existing houses
        s.wall = p.spec.wall
        p.spec = s
        p.target = 1
      }
    }
    for (const s of specs) {
      const p = vis.pieces.get(s.key)
      if (p && p.spec.v === s.v) continue
      const key3 = p ? `${s.key}#${s.v}` : s.key
      const batch = this.batches.get(s.v)!
      const piece: Piece = {
        spec: { ...s, key: key3 }, slot: batch.alloc(), rise: animate ? 0 : 1, target: 1,
        delay: animate ? 0.1 + k++ * 0.12 : 0, sweepDelay: ((Math.atan2(s.z, s.x) + Math.PI) / (Math.PI * 2)) * 0.6,
      }
      batch.setExtra('aWall', piece.slot, s.wall.r, s.wall.g, s.wall.b)
      vis.pieces.set(key3, piece)
    }
    this.pickSmoke(vis)
    this.pickHalos(vis)
    vis.dirty = true
  }

  private pickHalos(vis: CityVis) {
    for (const h of vis.halos) this.halos.release(h.slot)
    vis.halos = []
    const top = this.board.tops[vis.tile]
    for (const p of vis.pieces.values()) {
      if (p.target !== 1) continue
      const a = cityModel(p.spec.v).anchors.halo
      if (!a) continue
      for (const pt of a) {
        const sc = typeof p.spec.s === 'number' ? p.spec.s : p.spec.s[0]
        const w = pt.clone().multiplyScalar(sc * this.board.R).applyAxisAngle(this.axisY, p.spec.yaw)
        w.add(new THREE.Vector3(top.x + p.spec.x * this.board.R, top.y + p.spec.y, top.z + p.spec.z * this.board.R))
        const slot = this.halos.alloc()
        if (slot >= 0) vis.halos.push({ slot, at: w, key: p.spec.key, phase: hash01(vis.id * 97 + vis.halos.length, 9) * 6.28 })
      }
    }
  }

  private pickSmoke(vis: CityVis) {
    const top = this.board.tops[vis.tile]
    const list: CityVis['smoke'] = []
    for (const p of vis.pieces.values()) {
      if (p.target !== 1) continue
      const a = cityModel(p.spec.v).anchors.chimney
      if (!a) continue
      for (const pt of a) {
        const sc = typeof p.spec.s === 'number' ? p.spec.s : p.spec.s[0]
        const w = pt.clone().multiplyScalar(sc * this.board.R).applyAxisAngle(this.axisY, p.spec.yaw)
        w.add(new THREE.Vector3(top.x + p.spec.x * this.board.R, top.y + p.spec.y, top.z + p.spec.z * this.board.R))
        list.push({ at: w, t: hash01(vis.id * 31 + list.length, 5) * 3, key: p.spec.key })
      }
    }
    // a few chimneys smoke, chosen by the city's seed
    list.sort((a, b) => hash01(a.key.length * 13 + Math.round(a.at.x * 100), vis.id) - hash01(b.key.length * 13 + Math.round(b.at.x * 100), vis.id))
    vis.smoke = list.slice(0, Math.min(4, 1 + Math.floor(vis.pop / 2)))
  }

  remove(id: CityId): void {
    const vis = this.cities.get(id)
    if (!vis) return
    for (const p of vis.pieces.values()) this.batches.get(p.spec.v)!.release(p.slot)
    for (const h of vis.halos) this.halos.release(h.slot)
    this.labels.remove(vis.plaque)
    this.cities.delete(id)
  }

  setPop(map: GameMap, city: City, animate: boolean): void {
    this.replan(map, city, animate)
    const vis = this.cities.get(city.id)
    if (vis) this.updatePlaque(vis)
  }

  setOwner(id: CityId, owner: PlayerId, colorIdx: number, animate: boolean): void {
    const vis = this.cities.get(id)
    if (!vis) return
    const tc = teamColors(colorIdx)
    vis.fromColor.copy(teamColors(vis.colorIdx).base)
    vis.toColor.copy(tc.base)
    vis.fromTones = teamColors(vis.colorIdx)
    vis.toTones = tc
    vis.sweep = animate ? 0 : 1
    vis.owner = owner
    vis.colorIdx = colorIdx
    this.updatePlaque(vis)
    vis.dirty = true
  }

  /** Fog: which cities are shown from memory. */
  setMemory(ids: Set<CityId>, animate: boolean): void {
    for (const vis of this.cities.values()) {
      const m = ids.has(vis.id)
      if (m === vis.memory && (animate || vis.veil === (m ? 1 : 0))) continue
      vis.memory = m
      if (!animate) vis.veil = m ? 1 : 0
      vis.plaque.el.classList.toggle('memory', m)
      vis.dirty = true
    }
  }

  setHp(id: CityId, hp: number): void {
    const vis = this.cities.get(id)
    if (!vis) return
    vis.hp = hp
    this.updatePlaque(vis)
  }

  /** Play the founding: the town rises building by building. */
  found(map: GameMap, city: City, colorIdx: number): CityVis {
    this.remove(city.id)
    return this.create(map, city, colorIdx, true)
  }

  private updatePlaque(vis: CityVis) {
    const tc = teamColors(vis.colorIdx)
    const el = vis.plaque.el
    el.style.setProperty('--team', tc.css.base)
    el.style.setProperty('--team-dark', tc.css.dark)
    vis.popEl.textContent = String(vis.pop)
    const name = el.querySelector('.name')!
    if (name.textContent !== vis.name) name.textContent = vis.name
    const hpBar = el.querySelector('.hp') as HTMLElement
    const f = vis.hp / CITY_MAX_HP
    hpBar.style.display = f < 0.999 ? '' : 'none'
    vis.hpEl.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`
  }

  /** World position of a city's highest point (for shots and labels). */
  topOf(id: CityId, out = new THREE.Vector3()): THREE.Vector3 {
    const vis = this.cities.get(id)
    if (!vis) return out.set(0, 0, 0)
    const t = this.board.tops[vis.tile]
    for (const p of vis.pieces.values()) {
      if (p.spec.v === 'keep') return out.set(t.x + p.spec.x, t.y + 0.38, t.z + p.spec.z)
      if (p.spec.v === 'hall') return out.set(t.x + p.spec.x, t.y + 0.22, t.z + p.spec.z)
    }
    return out.copy(t).setY(t.y + 0.25)
  }

  update(dt: number): void {
    this.time += dt
    for (const vis of this.cities.values()) {
      const top = this.board.tops[vis.tile]
      let animating = false
      for (const [key, p] of vis.pieces) {
        if (p.rise !== p.target) {
          if (p.delay > 0) p.delay -= dt
          else {
            const before = p.rise
            p.rise = p.target > p.rise ? Math.min(1, p.rise + dt / 0.6) : Math.max(0, p.rise - dt / 0.45)
            if (before === 0 && p.target === 1 && !FLAT.has(p.spec.v) && !OUTSIDE.has(p.spec.v)) {
              this.fx.dust(this.v.set(top.x + p.spec.x, top.y + 0.03, top.z + p.spec.z), 3, 0.13)
            }
          }
          animating = true
        }
        if (p.target === 0 && p.rise <= 0) {
          this.batches.get(p.spec.v)!.release(p.slot)
          vis.pieces.delete(key)
        }
        if (p.spec.bob !== undefined) animating = true
      }
      if (vis.sweep < 1) {
        vis.sweep = Math.min(1, vis.sweep + dt / 0.85)
        animating = true
      }
      const veilTo = vis.memory ? 1 : 0
      if (vis.veil !== veilTo) {
        vis.veil = Math.abs(veilTo - vis.veil) < 0.02 ? veilTo : vis.veil + (veilTo - vis.veil) * Math.min(1, dt * 4)
        animating = true
      }
      if (!vis.shown && [...vis.pieces.values()].some((p) => p.spec.v !== 'ground' && p.rise > 0.5)) {
        vis.shown = true
        vis.plaque.el.style.opacity = ''
      }
      if (vis.dirty || animating) this.write(vis)
      for (const h of vis.halos) {
        const piece = vis.pieces.get(h.key)
        const r = piece ? piece.rise : 0
        const flicker = 0.85 + 0.1 * Math.sin(this.time * 2.3 + h.phase) + 0.05 * Math.sin(this.time * 7.1 + h.phase * 2)
        this.m.compose(h.at, this.q.identity(), this.s.setScalar(0.13 * this.board.R))
        this.halos.setMatrix(h.slot, this.m)
        this.halos.setExtra('aAlpha', h.slot, 0.32 * r * r * flicker * (1 - vis.veil))
      }
      for (const sm of vis.smoke) {
        sm.t -= dt
        if (sm.t <= 0) {
          sm.t = 1.4 + hash01(vis.id * 7 + Math.floor(this.time * 3), Math.round(sm.at.x * 100)) * 1.6
          const piece = vis.pieces.get(sm.key)
          if (piece && piece.rise >= 1 && !vis.memory) this.fx.smoke(sm.at)
        }
      }
    }
    for (const b of this.batches.values()) b.commit()
    this.halos.commit()
  }

  private write(vis: CityVis) {
    vis.dirty = false
    const top = this.board.tops[vis.tile]
    const R = this.board.R
    const { m, q, v, s } = this
    for (const p of vis.pieces.values()) {
      const sp = p.spec
      const b = this.batches.get(sp.v)!
      const r = p.delay > 0 && p.target === 1 && p.rise === 0 ? 0 : p.rise
      const sc = typeof sp.s === 'number' ? [sp.s, sp.s, sp.s] : sp.s
      // capture: each building hops as its roof flips to the new colour, in a sweep around the town
      const t = clamp01((vis.sweep - p.sweepDelay) / 0.32)
      const hop = t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0
      let y = top.y + sp.y + hop * 0.04
      let k = [1, 1, 1]
      if (FLAT.has(sp.v)) k = [easeOutCubic(r), 1, easeOutCubic(r)]
      else if (OUTSIDE.has(sp.v) || sp.v === 'wall' || sp.v === 'gate') k = [1, Math.max(0.001, easeOutCubic(r)), 1]
      else {
        const e = easeOutBack(r, 0.9)
        y -= (1 - Math.min(1, e)) * 0.34 * sc[1]
        y += e > 1 ? (e - 1) * 0.08 : 0
      }
      if (sp.bob !== undefined) {
        const tt = this.time + sp.bob
        y += Math.sin(tt * 1.3) * 0.006
        q.setFromEuler(new THREE.Euler(Math.sin(tt * 1.1) * 0.05, sp.yaw, Math.sin(tt * 0.9 + 1) * 0.06, 'YXZ'))
      } else q.setFromAxisAngle(this.axisY, sp.yaw)
      m.compose(v.set(top.x + sp.x * R, y, top.z + sp.z * R), q, s.set(sc[0] * k[0] * R * (1 + hop * 0.06), sc[1] * k[1] * R, sc[2] * k[2] * R * (1 + hop * 0.06)))
      b.setMatrix(p.slot, r <= 0 ? m.makeScale(0, 0, 0) : m)
      const tone = t < 0.5 ? vis.fromTones : vis.toTones
      const roof = sp.roof ?? 'base'
      this.c.copy(roof instanceof THREE.Color ? roof : tone[roof]).multiplyScalar(sp.shade)
      b.setColor(p.slot, this.c)
      b.setExtra('aVeil', p.slot, vis.veil)
      b.setExtra('aTeamLight', p.slot, tone.light.r, tone.light.g, tone.light.b)
      b.setExtra('aTeamDark', p.slot, tone.dark.r, tone.dark.g, tone.dark.b)
    }
  }

  /** The city whose plaque is under a client point (plaques ignore pointer events so panning works). */
  plaqueAt(clientX: number, clientY: number): CityVis | null {
    for (const c of this.cities.values()) {
      if (c.plaque.hidden || c.plaque.el.style.display === 'none') continue
      const r = c.plaque.el.getBoundingClientRect()
      if (clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2) return c
    }
    return null
  }

  /** Approximate pick against the city volumes. */
  pick(ray: THREE.Ray, maxDist: number): CityVis | null {
    let best: CityVis | null = null
    let bestD = maxDist
    const p = this.v
    for (const vis of this.cities.values()) {
      const t = this.board.tops[vis.tile]
      for (let i = 0; i <= 2; i++) {
        p.copy(t).setY(t.y + 0.12 * i)
        if (ray.distanceSqToPoint(p) < 0.7 * 0.7) {
          const along = p.sub(ray.origin).dot(ray.direction)
          if (along < bestD) { bestD = along; best = vis }
          break
        }
      }
    }
    return best
  }

  dispose(): void {
    for (const id of [...this.cities.keys()]) this.remove(id)
    for (const b of this.batches.values()) b.dispose()
    this.halos.dispose()
  }
}
