// Fog of war (SPEC.md §7b, docs/RULES.md): who sees which tiles, and what each player has explored.
//
// Sight: units see 2 tiles, cities 3, +1 when standing on hills; neighbours are always seen. A tile
// two or more away is hidden when a tile on the hex line in between is higher than both ends (its
// height, +1 for forest). When the line runs exactly along an edge, both nudged lines are tried and
// either clear one is enough, so sight is the same from both ends and on a mirrored map.
// Sight from a tile depends only on the map, so it is computed once per (map, tile, radius).

import { tilesInRange } from './hex.ts'
import type { City, CityId, GameMap, GameState, PlayerId, PlayerMemory, TileId } from './types.ts'

export const UNIT_SIGHT = 2
export const CITY_SIGHT = 3
export const HILLS_SIGHT_BONUS = 1

const sightCache = new WeakMap<GameMap, Map<number, TileId[]>>()

/** How tall a tile stands in the way of sight. */
function obstacle(map: GameMap, t: TileId): number {
  const tile = map.tiles[t]
  return tile.height + (tile.biome === 'forest' ? 1 : 0)
}

/** Sight radius of something standing on `tile` that normally sees `base` tiles. */
export function sightRadius(map: GameMap, tile: TileId, base: number): number {
  return base + (map.tiles[tile].biome === 'hills' ? HILLS_SIGHT_BONUS : 0)
}

/** Tiles on the hex line strictly between a and b, sampled with a small nudge (cube coordinates). */
function lineBetween(map: GameMap, a: TileId, b: TileId, nudge: number): TileId[] {
  const A = map.tiles[a]
  const B = map.tiles[b]
  const aq = A.q + 1e-6 * nudge
  const ar = A.r + 2e-6 * nudge
  const bq = B.q + 1e-6 * nudge
  const br = B.r + 2e-6 * nudge
  const n = Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.q + A.r - B.q - B.r))
  const out: TileId[] = []
  for (let i = 1; i < n; i++) {
    const q = aq + ((bq - aq) * i) / n
    const r = ar + ((br - ar) * i) / n
    const s = -q - r
    let rq = Math.round(q)
    let rr = Math.round(r)
    const rs = Math.round(s)
    const dq = Math.abs(rq - q)
    const dr = Math.abs(rr - r)
    const ds = Math.abs(rs - s)
    if (dq > dr && dq > ds) rq = -rr - rs
    else if (dr > ds) rr = -rq - rs
    const col = rq + (rr - (rr & 1)) / 2
    if (rr < 0 || rr >= map.height || col < 0 || col >= map.width) continue
    out.push(rr * map.width + col)
  }
  return out
}

/** Can something on `from` see `to` (ignoring range)? */
export function lineOfSight(map: GameMap, from: TileId, to: TileId): boolean {
  const top = Math.max(map.tiles[from].height, map.tiles[to].height)
  const clear = (nudge: number) => lineBetween(map, from, to, nudge).every((t) => obstacle(map, t) <= top)
  return clear(1) || clear(-1)
}

/** Every tile seen from `tile` with `radius` (the tile itself included). Cached per map. */
export function sightFrom(map: GameMap, tile: TileId, radius: number): TileId[] {
  let byKey = sightCache.get(map)
  if (!byKey) {
    byKey = new Map()
    sightCache.set(map, byKey)
  }
  const key = tile * 8 + radius
  let seen = byKey.get(key)
  if (!seen) {
    const center = map.tiles[tile]
    seen = tilesInRange(map, tile, radius).filter((t) => {
      const o = map.tiles[t]
      const d = (Math.abs(o.q - center.q) + Math.abs(o.r - center.r) + Math.abs(o.q + o.r - center.q - center.r)) / 2
      return d <= 1 || lineOfSight(map, tile, t)
    })
    byKey.set(key, seen)
  }
  return seen
}

/** Mark into `out` everything `player` sees with its units and cities as they stand in `state`. */
export function markSight(state: Pick<GameState, 'map' | 'units' | 'cities'>, player: PlayerId, out: Uint8Array): Uint8Array {
  const { map } = state
  for (const u of state.units) if (u.owner === player) for (const t of sightFrom(map, u.tile, sightRadius(map, u.tile, UNIT_SIGHT))) out[t] = 1
  for (const c of state.cities) if (c.owner === player) for (const t of sightFrom(map, c.tile, sightRadius(map, c.tile, CITY_SIGHT))) out[t] = 1
  return out
}

/** Tiles `player` has in sight right now (1 = visible). All 1 in games without fog. */
export function visibility(state: GameState, player: PlayerId): Uint8Array {
  const n = state.map.tiles.length
  if (!state.fog) return new Uint8Array(n).fill(1)
  return markSight(state, player, new Uint8Array(n))
}

/** Tiles `player` has ever seen (1 = explored). All 1 in games without fog. */
export function exploredOf(state: GameState, player: PlayerId): Uint8Array {
  const n = state.map.tiles.length
  const memory = state.fog?.[player]
  if (!state.fog) return new Uint8Array(n).fill(1)
  const out = new Uint8Array(n)
  if (memory) for (let t = 0; t < n; t++) out[t] = memory.explored.charCodeAt(t) === 49 ? 1 : 0 // '1'
  return out
}

export function encodeExplored(explored: Uint8Array): string {
  let s = ''
  for (let t = 0; t < explored.length; t++) s += explored[t] ? '1' : '0'
  return s
}

/** A rival city as another player sees it: buildings and size, but not its construction or stores. */
export function citySnapshot(c: City): City {
  return { ...c, interior: { ...c.interior, plots: [...c.interior.plots] }, build: null, prod: 0, food: 0 }
}

/**
 * What `player` sees in `state` becomes explored, and its memory of rival cities is refreshed: a city
 * in sight replaces its snapshot (seen this turn); a remembered city whose tile is in sight but which
 * is gone or now the player's own is forgotten; cities out of sight stay as last seen. `explored` is
 * updated in place; returns the new city memory.
 */
export function remember(
  state: Pick<GameState, 'map' | 'units' | 'cities' | 'turn'>,
  player: PlayerId,
  explored: Uint8Array,
  memory: Pick<PlayerMemory, 'cities' | 'seen'>,
): Pick<PlayerMemory, 'cities' | 'seen'> {
  const sight = markSight(state, player, new Uint8Array(state.map.tiles.length))
  for (let t = 0; t < sight.length; t++) if (sight[t]) explored[t] = 1
  const cities = memory.cities.filter((m) => !sight[m.tile])
  const seen: Record<CityId, number> = {}
  for (const m of cities) seen[m.id] = memory.seen[m.id] ?? state.turn
  for (const c of state.cities) {
    if (c.owner === player || !sight[c.tile]) continue
    cities.push(citySnapshot(c))
    seen[c.id] = state.turn
  }
  return { cities: cities.sort((a, b) => a.id - b.id), seen }
}

/** Fresh fog memories for every seat of a new game. */
export function initialFog(state: Pick<GameState, 'map' | 'units' | 'cities' | 'players' | 'turn'>): PlayerMemory[] {
  return state.players.map((p) => {
    const explored = new Uint8Array(state.map.tiles.length)
    const memory = remember(state, p.id, explored, { cities: [], seen: {} })
    return { explored: encodeExplored(explored), ...memory }
  })
}
