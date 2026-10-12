// The city seen from inside (SPEC.md §5b): 19 plots, buildings with neighbour effects, citizens
// working in buildings, directional walls and towers. Pure functions of map + city tile + interior.
//
// Plot layout (axial, radius 2, centred on the city): plot 0 is the square, 1..6 the inner ring,
// 7..18 the outer ring. Outer plots face the city's real neighbour tiles: a "corner" plot faces
// one direction, a "side" plot (between two corners) faces two.

import { AXIAL_DIRS, axialToOffset, SQRT3 } from './hex.ts'
import type { Biome, BuildingType, CityFocus, CityInterior, GameMap, TileId } from './types.ts'

// The interior types live in types.ts (the shared contract); re-exported here for convenience.
export type { BuildingOrder, BuildingType, CityFocus, CityInterior } from './types.ts'

export type Placement = 'any' | 'inner' | 'outer'

export interface BuildingInfo {
  name: string // shown in the UI
  cost: number
  placement: Placement
  /** Needs a citizen to produce anything. */
  worker: boolean
  /** Outer plots only: at least one faced tile must have one of these biomes. */
  faces?: Biome[]
  desc: string // one short line
}

export const BUILDINGS: Record<BuildingType, BuildingInfo> = {
  house: { name: 'House', cost: 15, placement: 'any', worker: false, desc: 'Room for 2 more citizens.' },
  farm: { name: 'Farm', cost: 20, placement: 'outer', worker: true, faces: ['grass', 'plains'], desc: 'Food, more the richer the land it faces.' },
  sawmill: { name: 'Sawmill', cost: 20, placement: 'outer', worker: true, faces: ['forest', 'hills'], desc: 'Production from the forests and hills outside.' },
  workshop: { name: 'Workshop', cost: 30, placement: 'inner', worker: true, desc: 'Production, +1 for each neighbouring workshop or sawmill.' },
  market: { name: 'Market', cost: 35, placement: 'inner', worker: true, desc: 'Food and production, +1 food for each neighbouring house.' },
  harbor: { name: 'Harbor', cost: 25, placement: 'outer', worker: true, faces: ['shallow', 'deep'], desc: 'Food from the sea.' },
  barracks: { name: 'Barracks', cost: 30, placement: 'inner', worker: false, desc: 'All units cost 25% less.' },
  temple: { name: 'Temple', cost: 40, placement: 'inner', worker: true, desc: 'Score, and the city grows faster.' },
  tower: { name: 'Tower', cost: 25, placement: 'outer', worker: false, desc: 'The city shoots further and harder on this side.' },
  wall: { name: 'Wall', cost: 20, placement: 'outer', worker: false, desc: '+50% defence against attacks from this side.' },
}

export const FOCUS_NAMES: Record<CityFocus, string> = { growth: 'Growth', production: 'Production', balance: 'Balance' }

export const PLOT_COUNT = 19
export const SQUARE_YIELD = { food: 2, prod: 4 }
/** What a staffed farm, sawmill, harbor, workshop or market makes before its bonuses. */
export const JOB_BASE = 2
export const BASE_HOUSING = 2
export const HOUSING_PER_HOUSE = 2
/** Citizens without a job still work the fields: */
export const IDLE_FOOD = 1
export const BARRACKS_DISCOUNT = 0.25
export const TEMPLE_GROWTH_DISCOUNT = 0.25

export interface PlotInfo {
  index: number
  q: number
  r: number
  ring: 0 | 1 | 2
  /** Directions (0..5, AXIAL_DIRS order) of the city's neighbour tiles this plot faces. */
  facing: number[]
  /** Plot-space centre, unit hex spacing, pointy-top like the world (x right, z down). */
  x: number
  z: number
}

function buildLayout(): PlotInfo[] {
  const out: PlotInfo[] = []
  const push = (q: number, r: number, ring: 0 | 1 | 2, facing: number[]) =>
    out.push({ index: out.length, q, r, ring, facing, x: SQRT3 * (q + r / 2), z: 1.5 * r })
  push(0, 0, 0, [])
  for (let d = 0; d < 6; d++) push(AXIAL_DIRS[d][0], AXIAL_DIRS[d][1], 1, [])
  for (let d = 0; d < 6; d++) {
    const [aq, ar] = AXIAL_DIRS[d]
    const [bq, br] = AXIAL_DIRS[(d + 1) % 6]
    push(2 * aq, 2 * ar, 2, [d]) // corner
    push(aq + bq, ar + br, 2, [d, (d + 1) % 6]) // side
  }
  return out
}

export const PLOTS: readonly PlotInfo[] = buildLayout()

const plotByAxial = new Map(PLOTS.map((p) => [`${p.q},${p.r}`, p.index]))

/** Plots adjacent to `plot` inside the city. */
export const PLOT_NEIGHBORS: readonly number[][] = PLOTS.map((p) =>
  AXIAL_DIRS.map(([dq, dr]) => plotByAxial.get(`${p.q + dq},${p.r + dr}`)).filter((i): i is number => i !== undefined),
)

/** The city's neighbour tile in direction d (AXIAL_DIRS order), or null at the map edge. */
export function neighborInDir(map: GameMap, tile: TileId, d: number): TileId | null {
  const t = map.tiles[tile]
  const { col, row } = axialToOffset(t.q + AXIAL_DIRS[d][0], t.r + AXIAL_DIRS[d][1])
  if (col < 0 || col >= map.width || row < 0 || row >= map.height) return null
  return row * map.width + col
}

/** Which of the city's six sides `to` lies on, seen from `from` (nearest direction by angle). */
export function directionTo(map: GameMap, from: TileId, to: TileId): number {
  const a = map.tiles[from]
  const b = map.tiles[to]
  const dq = b.q - a.q
  const dr = b.r - a.r
  const vx = SQRT3 * (dq + dr / 2)
  const vz = 1.5 * dr
  let best = 0
  let bestDot = -Infinity
  for (let d = 0; d < 6; d++) {
    const [q, r] = AXIAL_DIRS[d]
    const dot = vx * SQRT3 * (q + r / 2) + vz * 1.5 * r
    if (dot > bestDot) { bestDot = dot; best = d }
  }
  return best
}

function facedBiomes(map: GameMap, tile: TileId, plot: number): Biome[] {
  return PLOTS[plot].facing
    .map((d) => neighborInDir(map, tile, d))
    .filter((t): t is TileId => t !== null)
    .map((t) => map.tiles[t].biome)
}

export function newInterior(): CityInterior {
  return { plots: Array(PLOT_COUNT).fill(null), focus: 'balance' }
}

export function canPlace(map: GameMap, tile: TileId, interior: CityInterior, building: BuildingType, plot: number): { ok: boolean; reason?: string } {
  if (plot <= 0 || plot >= PLOT_COUNT) return { ok: false, reason: 'The square cannot be built on.' }
  if (interior.plots[plot] !== null) return { ok: false, reason: 'This plot is already built on.' }
  const info = BUILDINGS[building]
  const ring = PLOTS[plot].ring
  if (info.placement === 'inner' && ring !== 1) return { ok: false, reason: 'Must be in the inner ring.' }
  if (info.placement === 'outer' && ring !== 2) return { ok: false, reason: 'Must be in the outer ring.' }
  if (info.faces && !facedBiomes(map, tile, plot).some((b) => info.faces!.includes(b))) {
    return { ok: false, reason: `Must face ${facesText(info.faces)}.` }
  }
  return { ok: true }
}

function facesText(b: Biome[]): string {
  if (b.includes('forest')) return 'forest or hills'
  if (b.includes('grass')) return 'grassland or plains'
  return 'water'
}

/** What one building would produce if staffed (before the worker check). */
export function buildingYield(map: GameMap, tile: TileId, interior: CityInterior, plot: number): { food: number; prod: number } {
  const b = interior.plots[plot]
  if (!b) return { food: 0, prod: 0 }
  const faced = facedBiomes(map, tile, plot)
  const near = PLOT_NEIGHBORS[plot].map((i) => interior.plots[i])
  const count = (pred: (b: Biome) => boolean) => faced.filter(pred).length
  switch (b) {
    case 'farm': return { food: JOB_BASE + count((x) => x === 'grass' || x === 'plains'), prod: 0 }
    case 'sawmill': return { food: 0, prod: JOB_BASE + count((x) => x === 'forest' || x === 'hills') }
    case 'harbor': return { food: JOB_BASE + count((x) => x === 'shallow' || x === 'deep'), prod: 0 }
    case 'workshop': return { food: 0, prod: JOB_BASE + near.filter((n) => n === 'workshop' || n === 'sawmill').length }
    case 'market': return { food: JOB_BASE + Math.min(3, near.filter((n) => n === 'house').length), prod: 1 }
    case 'temple': return { food: 0, prod: 0 }
    default: return { food: 0, prod: 0 }
  }
}

export interface CityOutput {
  food: number
  prod: number
  housing: number
  /** Per plot: does this building have a worker? (false for empty plots and worker-less buildings) */
  staffed: boolean[]
  /** Per plot: what it produces right now (0 if unstaffed). */
  perPlot: { food: number; prod: number }[]
  idle: number // citizens without a job
  jobs: number // buildings that need a worker
}

/** Total output of a city with `pop` citizens. Deterministic staffing by focus. */
export function cityOutput(map: GameMap, tile: TileId, interior: CityInterior, pop: number): CityOutput {
  const staffed = Array<boolean>(PLOT_COUNT).fill(false)
  const perPlot = PLOTS.map(() => ({ food: 0, prod: 0 }))
  const candidates: { plot: number; food: number; prod: number; temple: boolean }[] = []
  let houses = 0
  for (let p = 1; p < PLOT_COUNT; p++) {
    const b = interior.plots[p]
    if (!b) continue
    if (b === 'house') houses++
    if (!BUILDINGS[b].worker) continue
    const y = buildingYield(map, tile, interior, p)
    candidates.push({ plot: p, ...y, temple: b === 'temple' })
  }
  const value = (c: (typeof candidates)[number]) => {
    switch (interior.focus) {
      case 'growth': return c.food * 2 + c.prod + (c.temple ? 2.5 : 0)
      case 'production': return c.prod * 2 + c.food + (c.temple ? 0.5 : 0)
      default: return c.food + c.prod + (c.temple ? 1.5 : 0)
    }
  }
  // Equal value: food first (production first under the Production focus). Jobs still tied after
  // that yield the same, so which one is staffed never changes the totals (or depends on plot order).
  const second = (c: (typeof candidates)[number]) => (interior.focus === 'production' ? c.prod : c.food)
  candidates.sort((a, b) => value(b) - value(a) || second(b) - second(a) || a.plot - b.plot)
  let food = SQUARE_YIELD.food
  let prod = SQUARE_YIELD.prod
  const workers = Math.max(0, pop)
  candidates.forEach((c, i) => {
    if (i >= workers) return
    staffed[c.plot] = true
    perPlot[c.plot] = { food: c.food, prod: c.prod }
    food += c.food
    prod += c.prod
  })
  const idle = Math.max(0, workers - candidates.length)
  food += idle * IDLE_FOOD
  return { food, prod, housing: BASE_HOUSING + houses * HOUSING_PER_HOUSE, staffed, perPlot, idle, jobs: candidates.length }
}

/** How output would change if `building` were placed on `plot` (for the placement preview). */
export function previewPlacement(map: GameMap, tile: TileId, interior: CityInterior, pop: number, building: BuildingType, plot: number) {
  const before = cityOutput(map, tile, interior, pop)
  const next: CityInterior = { ...interior, plots: interior.plots.slice() }
  next.plots[plot] = building
  const after = cityOutput(map, tile, next, pop)
  return { food: after.food - before.food, prod: after.prod - before.prod, housing: after.housing - before.housing, after }
}

/** Sides (0..5) covered by walls / towers. */
export function fortifiedSides(interior: CityInterior, kind: 'wall' | 'tower'): Set<number> {
  const sides = new Set<number>()
  for (let p = 7; p < PLOT_COUNT; p++) if (interior.plots[p] === kind) PLOTS[p].facing.forEach((d) => sides.add(d))
  return sides
}

export function hasBuilding(interior: CityInterior, b: BuildingType): boolean {
  return interior.plots.includes(b)
}
