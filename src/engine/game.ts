import { CITY_MAX_HP, CITY_NAMES, DEFAULT_MAX_TURNS, UNIT_MAX_HP } from './config.ts'
import { neighbors } from './hex.ts'
import { generateMap, mirror } from './mapgen.ts'
import { canStep } from './terrain.ts'
import type { City, GameConfig, GameState, PlayerId, TileId, Unit, UnitType } from './types.ts'

/** A fresh game: each seat gets a founded capital, a spear, an archer and a settler. */
export function createGame(cfg: GameConfig): GameState {
  const seats = cfg.players.length
  if (seats < 2 || seats > 4) throw new Error('2 to 4 players')
  const map = generateMap(cfg.seed, seats, cfg.mapSize ?? (seats === 2 ? 'small' : 'medium'))
  const state: GameState = {
    turn: 1,
    maxTurns: cfg.maxTurns ?? DEFAULT_MAX_TURNS,
    map,
    players: cfg.players.map((p, i) => ({ id: i, name: p.name, color: i, kind: p.kind, alive: true })),
    units: [],
    cities: [],
    nextId: 1,
    winner: null,
  }
  const kinds: UnitType[] = ['spear', 'archer', 'settler']
  map.starts.forEach((start, seat) => {
    state.cities.push(newCity(state, seat, start, true))
    const free = neighbors(map, start).filter((nb) => canStep(map, start, nb))
    kinds.forEach((type, i) => {
      // Two-player maps are point-symmetric: seat 1 gets the mirror image of seat 0's setup.
      const tile = seats === 2 && seat === 1 ? mirror(state.units[i].tile, map.width, map.height) : free[i % free.length]
      state.units.push(newUnit(state, seat, type, tile))
    })
  })
  return state
}

export function newUnit(state: GameState, owner: PlayerId, type: UnitType, tile: TileId): Unit {
  return { id: state.nextId++, owner, type, tile, hp: UNIT_MAX_HP, stance: 'cautious', path: [], found: false, target: null }
}

export function newCity(state: GameState, owner: PlayerId, tile: TileId, capital = false): City {
  const used = new Set(state.cities.map((c) => c.name))
  const name = CITY_NAMES.find((n) => !used.has(n)) ?? `City ${state.cities.length + 1}`
  return {
    id: state.nextId++, owner, name, tile, pop: 1, food: 0, prod: 0, hp: CITY_MAX_HP,
    walls: false, build: null, capital, founded: state.turn,
  }
}
