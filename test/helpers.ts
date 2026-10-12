// Small hand-built positions for rule tests.
import { newInterior } from '../src/engine/city.ts'
import { CITY_MAX_HP, UNIT_MAX_HP } from '../src/engine/config.ts'
import { offsetToAxial } from '../src/engine/hex.ts'
import type { Biome, City, GameEvent, GameMap, GameState, PlayerOrders, Tile, TileId, Unit, UnitOrder } from '../src/engine/types.ts'

/** A grass map at height 2 (row-major, odd rows shifted right). `edit` may change tiles before use. */
export function makeMap(width: number, height: number, edit?: (t: Tile) => void): GameMap {
  const tiles: Tile[] = []
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const { q, r } = offsetToAxial(col, row)
      const t: Tile = { id: row * width + col, col, row, q, r, height: 2, biome: 'grass' as Biome, moisture: 0.5 }
      edit?.(t)
      tiles.push(t)
    }
  }
  return { width, height, seed: 'test', tiles, starts: [] }
}

export const at = (map: GameMap, col: number, row: number): TileId => row * map.width + col

let nextTestId = 1000

export function unit(owner: number, type: Unit['type'], tile: TileId, extra: Partial<Unit> = {}): Unit {
  return { id: nextTestId++, owner, type, tile, hp: UNIT_MAX_HP, stance: 'cautious', path: [], found: false, target: null, ...extra }
}

export function city(owner: number, tile: TileId, extra: Partial<City> = {}): City {
  return {
    id: nextTestId++, owner, name: `C${tile}`, tile, pop: 1, food: 0, prod: 0, hp: CITY_MAX_HP,
    walls: false, build: null, capital: false, founded: 1, interior: newInterior(), ...extra,
  }
}

/** Two (or more) players; each needs a city somewhere or it is eliminated at the end of the turn,
 * so by default every player gets a far-away city on the last row. */
export function makeState(map: GameMap, units: Unit[], cities?: City[], players = 2): GameState {
  const cs = cities ?? Array.from({ length: players }, (_, p) => city(p, at(map, map.width - 1 - 3 * p, map.height - 1)))
  return {
    turn: 1,
    maxTurns: 60,
    map,
    players: Array.from({ length: players }, (_, i) => ({ id: i, name: `P${i}`, color: i, kind: 'human' as const, alive: true })),
    units: [...units].sort((a, b) => a.id - b.id),
    cities: cs,
    nextId: nextTestId + 10000,
    winner: null,
  }
}

export function order(path: TileId[], stance: UnitOrder['stance'] = 'cautious', extra: Partial<UnitOrder> = {}): UnitOrder {
  return { path, stance, ...extra }
}

export function orders(units: Record<number, UnitOrder>, cities: PlayerOrders['cities'] = {}): PlayerOrders {
  return { units, cities }
}

export function ofKind<K extends GameEvent['kind']>(events: GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind)
}

export function find(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id)
}
