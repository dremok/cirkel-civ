// Pathfinding and movement previews for UI and bots. Movement model (same as rules.ts):
// a unit gains `speed` points per tick, enters the next tile when it has the step cost
// (capped at speed x 6, so any passable neighbour takes at most one turn), at most one step
// per tick, and leftover points are lost at the end of the turn.

import { TICKS_PER_TURN, UNITS } from './config.ts'
import { neighbors } from './hex.ts'
import { stepCost } from './terrain.ts'
import type { GameMap, GameState, TileId, Unit, UnitId } from './types.ts'

interface Edges {
  /** nb[i * 6 + k]: k-th neighbour of tile i, or -1. */
  nb: Int32Array
  /** Raw step cost of each edge (Infinity if impassable or a cliff). */
  cost: Float64Array
  /** Raw step cost of the reverse edge, from the neighbour into tile i. */
  back: Float64Array
}

const edgeCache = new WeakMap<GameMap, Edges>()

export function edges(map: GameMap): Edges {
  let e = edgeCache.get(map)
  if (!e) {
    const n = map.tiles.length
    const nb = new Int32Array(n * 6).fill(-1)
    const cost = new Float64Array(n * 6).fill(Infinity)
    const back = new Float64Array(n * 6).fill(Infinity)
    for (let i = 0; i < n; i++) {
      neighbors(map, i).forEach((j, k) => {
        nb[i * 6 + k] = j
        cost[i * 6 + k] = stepCost(map, i, j)
        back[i * 6 + k] = stepCost(map, j, i)
      })
    }
    e = { nb, cost, back }
    edgeCache.set(map, e)
  }
  return e
}

/** Points a unit of `speed` needs to step from `from` into the neighbouring `to`; Infinity if it cannot. */
export function moveCost(map: GameMap, from: TileId, to: TileId, speed: number): number {
  const { nb, cost } = edges(map)
  for (let k = from * 6, end = k + 6; k < end; k++) {
    if (nb[k] === to) return cost[k] === Infinity ? Infinity : Math.min(cost[k], speed * TICKS_PER_TURN)
  }
  return Infinity
}

/** Tiles a unit may not enter at all (enemy cities and units for civilians) or only as the last step. */
function hostileTiles(state: GameState, u: Unit): { through: Uint8Array; enter: Uint8Array } {
  const n = state.map.tiles.length
  const through = new Uint8Array(n) // cannot pass through
  const enter = new Uint8Array(n) // cannot even end here
  const civilian = !!UNITS[u.type].civilian
  for (const c of state.cities) {
    if (c.owner === u.owner) continue
    through[c.tile] = 1
    if (civilian) enter[c.tile] = 1
  }
  if (civilian) for (const o of state.units) if (o.owner !== u.owner) enter[o.tile] = 1
  return { through, enter }
}

export interface PathField {
  from: TileId
  speed: number
  /** Arrival as an absolute tick: turn offset * 6 + tick (0 at the start tile, Infinity if unreachable). */
  ticks: Float64Array
  prev: Int32Array
  /** Every reached tile, in order of arrival (starting with `from`). */
  reached: TileId[]
}

/**
 * Fastest arrival at every tile. Dijkstra on (turn offset, points spent this turn): a step that does
 * not fit in the current turn starts the next one, so this minimises real arrival time.
 * `through[t]` marks tiles that can be entered but not passed through; `enter[t]` tiles that cannot be entered.
 */
export function pathField(
  map: GameMap,
  from: TileId,
  speed: number,
  opts: { through?: Uint8Array; enter?: Uint8Array; maxTurns?: number } = {},
): PathField {
  const n = map.tiles.length
  const budget = speed * TICKS_PER_TURN
  const K = budget + 1
  const key = new Float64Array(n).fill(Infinity)
  const ticks = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const { nb, cost } = edges(map)
  const maxKey = (opts.maxTurns ?? Infinity) * K
  const heap = new MinHeap()
  const reached: TileId[] = []
  key[from] = 0
  ticks[from] = 0
  heap.push(0, from)
  while (heap.size) {
    const [k0, i] = heap.pop()
    if (done[i] || k0 > key[i]) continue
    done[i] = 1
    reached.push(i)
    if (i !== from && opts.through?.[i]) continue
    const turn = Math.floor(k0 / K)
    const spent = k0 - turn * K
    for (let e = i * 6, end = e + 6; e < end; e++) {
      const j = nb[e]
      if (j < 0 || done[j] || opts.enter?.[j]) continue
      const c = cost[e]
      if (c === Infinity) continue
      const cc = Math.min(c, budget)
      const k1 = spent + cc <= budget ? turn * K + spent + cc : (turn + 1) * K + cc
      if (k1 >= key[j] || k1 >= maxKey) continue
      key[j] = k1
      const t1 = Math.floor(k1 / K)
      ticks[j] = t1 * TICKS_PER_TURN + Math.ceil((k1 - t1 * K) / speed)
      prev[j] = i
      heap.push(k1, j)
    }
  }
  return { from, speed, ticks, prev, reached }
}

export function extractPath(field: PathField, dest: TileId): TileId[] | null {
  if (dest === field.from) return []
  if (field.ticks[dest] === Infinity) return null
  const out: TileId[] = []
  for (let t = dest; t !== field.from; t = field.prev[t]) out.push(t)
  return out.reverse()
}

function unitById(state: GameState, id: UnitId): Unit | undefined {
  return state.units.find((u) => u.id === id)
}

/** Fastest path for a unit to `dest` (excluding the start tile), ignoring other units except that
 * `dest` may hold an enemy unit or city (an attack; never for settlers). Enemy cities cannot be
 * passed through. Null if unreachable. */
export function findPath(state: GameState, unit: UnitId, dest: TileId): TileId[] | null {
  const u = unitById(state, unit)
  if (!u || !Number.isInteger(dest) || dest < 0 || dest >= state.map.tiles.length) return null
  const { through, enter } = hostileTiles(state, u)
  if (enter[dest]) return null
  return extractPath(pathField(state.map, u.tile, UNITS[u.type].speed, { through, enter }), dest)
}

/** Unobstructed timing of a path from the unit's tile: turn offset (0 = this turn) and tick (1..6) of
 * each step. Stops at the first step that is not a passable neighbour. Matches resolveTurn when
 * nothing gets in the way. */
export function pathTiming(state: GameState, unit: UnitId, path: TileId[]): { turn: number; tick: number }[] {
  const u = unitById(state, unit)
  if (!u) return []
  const speed = UNITS[u.type].speed
  const out: { turn: number; tick: number }[] = []
  let at = u.tile
  let turn = 0
  let tick = 0
  let points = 0
  for (const next of path) {
    const cost = moveCost(state.map, at, next, speed)
    if (cost === Infinity) break
    for (;;) {
      tick++
      if (tick > TICKS_PER_TURN) {
        turn++
        tick = 1
        points = 0
      }
      points += speed
      if (points >= cost) break
    }
    points -= cost
    out.push({ turn, tick })
    at = next
  }
  return out
}

/** Tiles the unit can enter this turn (ignoring other units, except that enemy cities end a path). */
export function reachableThisTurn(state: GameState, unit: UnitId): TileId[] {
  return Object.keys(reachablePaths(state, unit)).map(Number)
}

/** Every tile the unit can enter this turn, with the fastest path to it (same rules as findPath). */
export function reachablePaths(state: GameState, unit: UnitId): Record<TileId, TileId[]> {
  const u = unitById(state, unit)
  if (!u) return {}
  const { through, enter } = hostileTiles(state, u)
  const f = pathField(state.map, u.tile, UNITS[u.type].speed, { through, enter, maxTurns: 1 })
  const out: Record<TileId, TileId[]> = {}
  for (const t of [...f.reached].sort((a, b) => a - b)) if (t !== u.tile) out[t] = extractPath(f, t)!
  return out
}

/** Binary min-heap of (key, value) pairs; ties pop the smaller value first (determinism). */
class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size(): number {
    return this.k.length
  }
  push(key: number, val: number): void {
    const k = this.k
    const v = this.v
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] < key || (k[p] === key && v[p] <= val)) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): [number, number] {
    const k = this.k
    const v = this.v
    const topK = k[0]
    const topV = v[0]
    const lastK = k.pop()!
    const lastV = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        let c = l
        if (r < n && (k[r] < k[l] || (k[r] === k[l] && v[r] < v[l]))) c = r
        if (k[c] > lastK || (k[c] === lastK && v[c] >= lastV)) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lastK
      v[i] = lastV
    }
    return [topK, topV]
  }
}
