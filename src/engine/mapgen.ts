// Seeded map generator: hex columns with individual heights.
// Two-player maps are point-symmetric (180° rotation), so both seats start on equal terms.

import { MAP_SIZES, TILE_YIELD } from './config.ts'
import { hexCenter, neighbors, distance, offsetToAxial, tilesInRange } from './hex.ts'
import { fbm, makeNoise2D, rngFrom } from './rng.ts'
import { canStep, isPassable, isWater } from './terrain.ts'
import type { Biome, GameMap, Tile, TileId } from './types.ts'

// Height bands by elevation percentile. Water below 35 %.
const LAND_BANDS: [number, number][] = [
  // [cumulative percentile, height]
  [0.53, 2],
  [0.7, 3],
  [0.83, 4],
  [0.91, 5],
  [0.96, 6],
  [0.985, 7],
  [1.01, 8],
]
const WATER_FRACTION = 0.35

export function generateMap(seed: string, seats: number, size: keyof typeof MAP_SIZES = 'small'): GameMap {
  for (let attempt = 0; attempt < 40; attempt++) {
    const map = tryGenerate(attempt === 0 ? seed : `${seed}#${attempt}`, seed, seats, size)
    if (map) return map
  }
  throw new Error(`could not generate a playable map for seed ${seed}`)
}

function tryGenerate(noiseSeed: string, seed: string, seats: number, size: keyof typeof MAP_SIZES): GameMap | null {
  const { width: W, height: H } = MAP_SIZES[size]
  const rng = rngFrom(noiseSeed)
  const nElev = makeNoise2D(rng)
  const nWarp = makeNoise2D(rng)
  const nMoist = makeNoise2D(rng)
  const symmetric = seats === 2

  const n = W * H
  const elev = new Float64Array(n)
  const moist = new Float64Array(n)
  const span = hexCenter(W - 1, H - 1)
  const cx = span.x / 2
  const cz = span.z / 2
  const f = 0.11
  const ox = rng() * 100
  const oz = rng() * 100
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const id = row * W + col
      const { x, z } = hexCenter(col, row)
      const wx = x + 2.2 * fbm(nWarp, x * 0.07 + 31, z * 0.07, 3)
      const wz = z + 2.2 * fbm(nWarp, x * 0.07, z * 0.07 + 57, 3)
      const base = fbm(nElev, wx * f + ox, wz * f + oz, 5)
      // Elliptical falloff keeps the board's rim as sea.
      const dx = (x - cx) / (cx + 1)
      const dz = (z - cz) / (cz + 1)
      const d = Math.sqrt(dx * dx + dz * dz)
      elev[id] = base + 0.55 - 1.15 * Math.pow(d, 2.2)
      moist[id] = 0.5 + 0.5 * fbm(nMoist, x * 0.09 + 11, z * 0.09 + 5, 4)
    }
  }
  if (symmetric) {
    for (let id = 0; id < n; id++) {
      const m = mirror(id, W, H)
      if (m <= id) continue
      const e = (elev[id] + elev[m]) / 2
      const w = (moist[id] + moist[m]) / 2
      elev[id] = elev[m] = e
      moist[id] = moist[m] = w
    }
  }

  // Moisture as a percentile, so averaging for symmetry does not flatten it.
  const mSorted = Array.from(moist).sort((a, b) => a - b)
  for (let id = 0; id < n; id++) moist[id] = lowerBound(mSorted, moist[id]) / (n - 1)

  // Percentile thresholds (ties stay tied, so symmetry survives).
  const sorted = Array.from(elev).sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]
  const waterCut = at(WATER_FRACTION)
  const shallowCut = at(WATER_FRACTION * 0.72)
  const landCuts = LAND_BANDS.map(([p, h]) => [p >= 1 ? Infinity : at(WATER_FRACTION + (1 - WATER_FRACTION) * p), h] as const)

  const heights = new Int8Array(n)
  for (let id = 0; id < n; id++) {
    const e = elev[id]
    if (e < waterCut) heights[id] = e >= shallowCut ? 1 : 0
    else heights[id] = landCuts.find(([cut]) => e < cut)![1]
  }

  const tiles: Tile[] = []
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const id = row * W + col
      const { q, r } = offsetToAxial(col, row)
      tiles.push({ id, col, row, q, r, height: heights[id], biome: 'deep', moisture: moist[id] })
    }
  }
  const map: GameMap = { width: W, height: H, seed, tiles, starts: [] }

  // Water touching land is shallow; everything else keeps its band.
  for (const t of tiles) {
    if (t.height >= 2) continue
    const nearLand = neighbors(map, t.id).some((nb) => tiles[nb].height >= 2)
    if (nearLand) t.height = 1
  }
  for (const t of tiles) t.biome = biomeFor(map, t)

  const starts = pickStarts(map, seats, symmetric, rng)
  if (!starts) return null
  map.starts = starts
  if (!connected(map, starts)) return null
  return map
}

export function mirror(id: number, W: number, H: number): number {
  const col = id % W
  const row = Math.floor(id / W)
  return (H - 1 - row) * W + (W - 1 - col)
}

function biomeFor(map: GameMap, t: Tile): Biome {
  const h = t.height
  if (h === 0) return 'deep'
  if (h === 1) return 'shallow'
  if (h >= 8) return 'snow'
  if (h === 7) return 'mountain'
  if (h >= 5) return t.moisture > 0.7 && h === 5 ? 'forest' : 'hills'
  if (h === 2 && neighbors(map, t.id).some((nb) => map.tiles[nb].height < 2)) return 'beach'
  if (t.moisture > 0.66) return 'forest'
  if (t.moisture > 0.3) return 'grass'
  return 'plains'
}

function startScore(map: GameMap, id: TileId): number {
  const t = map.tiles[id]
  if (!isPassable(map, id) || t.biome === 'beach' || t.height > 4) return -Infinity
  let s = 0
  for (const nb of tilesInRange(map, id, 2)) {
    if (nb === id) continue
    const y = TILE_YIELD[map.tiles[nb].biome]
    s += y.food * 1.2 + y.prod
    if (!isPassable(map, nb)) s -= isWater(map, nb) ? 0.5 : 2
  }
  const passableNeighbours = neighbors(map, id).filter((nb) => canStep(map, id, nb)).length
  return passableNeighbours < 4 ? -Infinity : s
}

function pickStarts(map: GameMap, seats: number, symmetric: boolean, rng: () => number): TileId[] | null {
  const { width: W, height: H } = map
  const interior = map.tiles.filter((t) => t.col >= 2 && t.col < W - 2 && t.row >= 2 && t.row < H - 2)
  const scored = interior
    .map((t) => ({ id: t.id, s: startScore(map, t.id) }))
    .filter((c) => Number.isFinite(c.s))
  if (scored.length < seats) return null
  const best = Math.max(...scored.map((c) => c.s))
  const good = scored.filter((c) => c.s >= best * 0.7)

  if (symmetric) {
    let pick: { id: TileId; v: number } | null = null
    for (const c of good) {
      const m = mirror(c.id, W, H)
      const d = distance(map, c.id, m)
      if (d < Math.floor(W * 0.55)) continue
      const v = c.s + d * 1.5
      if (!pick || v > pick.v) pick = { id: c.id, v }
    }
    if (!pick) return null
    return [pick.id, mirror(pick.id, W, H)]
  }

  return fairStarts(map, seats, good, rng)
}

/**
 * Three or four seats cannot be symmetric, so pick the set of starts that is best for the worst-off
 * seat: each start is worth its share of the land (tiles nearer to it than to any other start) plus
 * its site score, and starts are at least 6 apart. Greedy farthest-point sets from every candidate,
 * then one round of single swaps on the best few. Seats are then shuffled, so no seat is favoured.
 */
function fairStarts(map: GameMap, seats: number, good: { id: TileId; s: number }[], rng: () => number): TileId[] | null {
  const land = map.tiles.filter((t) => isPassable(map, t.id)).map((t) => t.id)
  const site = new Map(good.map((c) => [c.id, c.s]))
  const worth = (set: TileId[]): number => {
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (distance(map, set[i], set[j]) < 6) return -Infinity
    const area = new Array(set.length).fill(0)
    for (const t of land) {
      let best = Infinity
      let at: number[] = []
      set.forEach((st, i) => {
        const d = distance(map, st, t)
        if (d < best) [best, at] = [d, [i]]
        else if (d === best) at.push(i)
      })
      for (const i of at) area[i] += 1 / at.length
    }
    return Math.min(...set.map((st, i) => area[i] + site.get(st)! * 0.2))
  }
  const cands = good.length > 40 ? good.filter((_, i) => i % Math.ceil(good.length / 40) === 0) : good
  const sets: { set: TileId[]; v: number }[] = []
  for (const first of cands) {
    const set = [first.id]
    while (set.length < seats) {
      let pick: TileId | null = null
      let far = -1
      for (const c of cands) {
        const d = Math.min(...set.map((st) => distance(map, st, c.id)))
        if (d > far) [far, pick] = [d, c.id]
      }
      set.push(pick!)
    }
    sets.push({ set, v: worth(set) })
  }
  sets.sort((a, b) => b.v - a.v)
  let best = sets[0]
  for (const start of sets.slice(0, 3)) {
    const cur = { set: [...start.set], v: start.v }
    for (let i = 0; i < seats; i++) {
      for (const c of cands) {
        if (cur.set.includes(c.id)) continue
        const trial = cur.set.map((st, j) => (j === i ? c.id : st))
        const v = worth(trial)
        if (v > cur.v) [cur.set, cur.v] = [trial, v]
      }
    }
    if (cur.v > best.v) best = cur
  }
  if (best.v === -Infinity) return null
  const order = [...best.set]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function connected(map: GameMap, starts: TileId[]): boolean {
  const seen = new Uint8Array(map.tiles.length)
  const queue = [starts[0]]
  seen[starts[0]] = 1
  let reached = 0
  while (queue.length) {
    const id = queue.pop()!
    reached++
    for (const nb of neighbors(map, id)) {
      if (!seen[nb] && canStep(map, id, nb)) {
        seen[nb] = 1
        queue.push(nb)
      }
    }
  }
  const landTiles = map.tiles.filter((t) => isPassable(map, t.id)).length
  return starts.every((s) => seen[s]) && reached >= landTiles * 0.75
}

function lowerBound(sorted: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}
