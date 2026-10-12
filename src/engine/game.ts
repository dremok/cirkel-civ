import { CITY_MAX_HP, CITY_NAMES, DEFAULT_MAX_TURNS, UNIT_MAX_HP } from './config.ts'
import { PLOTS, buildingYield, canPlace, newInterior } from './city.ts'
import { AXIAL_DIRS, SQRT3, hexCenter, neighbors } from './hex.ts'
import { generateMap, mirror } from './mapgen.ts'
import { canStep } from './terrain.ts'
import type { BuildingType, City, CityInterior, GameConfig, GameMap, GameState, PlayerId, TileId, Unit, UnitType } from './types.ts'

/** A fresh game: each seat gets a founded capital (a House and a Farm, Sawmill or Harbor inside),
 * a spear, an archer and a settler. */
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
  // Two-player maps are point-symmetric: seat 1 gets the mirror image of seat 0's units (capital
  // interiors are mirror images by construction).
  const mirrored = seats === 2
  map.starts.forEach((start, seat) => {
    const capital = newCity(state, seat, start, true)
    capital.interior = capitalInterior(map, start)
    state.cities.push(capital)
    const free = neighbors(map, start).filter((nb) => canStep(map, start, nb))
    kinds.forEach((type, i) => {
      const tile = mirrored && seat === 1 ? mirror(state.units[i].tile, map.width, map.height) : free[i % free.length]
      state.units.push(newUnit(state, seat, type, tile))
    })
  })
  return state
}

export function newUnit(state: GameState, owner: PlayerId, type: UnitType, tile: TileId): Unit {
  return { id: state.nextId++, owner, type, tile, hp: UNIT_MAX_HP, stance: 'cautious', path: [], found: false, target: null }
}

/** A new city with one citizen and one House. */
export function newCity(state: GameState, owner: PlayerId, tile: TileId, capital = false): City {
  const used = new Set(state.cities.map((c) => c.name))
  const name = CITY_NAMES.find((n) => !used.has(n)) ?? `City ${state.cities.length + 1}`
  const interior = newInterior()
  interior.plots[1 + towardMiddle(state.map, tile)] = 'house'
  return {
    id: state.nextId++, owner, name, tile, pop: 1, food: 0, prod: 0, hp: CITY_MAX_HP,
    walls: false, build: null, capital, founded: state.turn, interior,
  }
}

/** A capital's starting interior: its House plus a Farm on its best farm plot (else the best
 * Sawmill plot, else Harbor plot). Equally good plots go to the one facing the middle of the map,
 * so mirrored capitals get mirrored interiors. */
export function capitalInterior(map: GameMap, tile: TileId): CityInterior {
  const interior = newInterior()
  interior.plots[1 + towardMiddle(map, tile)] = 'house'
  const mid = middleVector(map, tile)
  for (const b of ['farm', 'sawmill', 'harbor'] as BuildingType[]) {
    let best = -1
    let bestKey: [number, number, number] = [-1, -Infinity, -Infinity]
    for (let p = 7; p < interior.plots.length; p++) {
      if (!canPlace(map, tile, interior, b, p).ok) continue
      const trial = { ...interior, plots: interior.plots.slice() }
      trial.plots[p] = b
      const y = buildingYield(map, tile, trial, p)
      const key: [number, number, number] = [y.food + y.prod, ...facing(mid, PLOTS[p].x, PLOTS[p].z)]
      if (best < 0 || better(key, bestKey)) [best, bestKey] = [p, key]
    }
    if (best >= 0) {
      interior.plots[best] = b
      break
    }
  }
  return interior
}

/** Lexicographic comparison with a little slack for floating point. */
function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + 1e-9) return true
    if (a[i] < b[i] - 1e-9) return false
  }
  return false
}

/** From `tile` to the middle of the map, in the planar coordinates of hexCenter and PLOTS. */
function middleVector(map: GameMap, tile: TileId): { x: number; z: number } {
  const t = map.tiles[tile]
  const at = hexCenter(t.col, t.row)
  const mid = hexCenter((map.width - 0.5) / 2, (map.height - 1) / 2)
  return { x: mid.x - at.x, z: mid.z - at.z }
}

/** How well a direction faces `mid`: [dot, cross]. A 180° turn of the map negates both vectors and
 * keeps both numbers, so choices made by them survive the turn. */
function facing(mid: { x: number; z: number }, dx: number, dz: number): [number, number] {
  return [mid.x * dx + mid.z * dz, mid.x * dz - mid.z * dx]
}

/** The interior seen after turning the city by `k` sixth-turns (plot directions shift by k). */
export function rotateInterior(interior: CityInterior, k: number): CityInterior {
  const plots = interior.plots.map(() => null as BuildingType | null)
  interior.plots.forEach((b, p) => (plots[rotatePlot(p, k)] = b))
  return { ...interior, plots }
}

/** Plot index after turning the city by `k` sixth-turns: inner 1 + d, corners 7 + 2d, sides 8 + 2d. */
export function rotatePlot(p: number, k: number): number {
  if (p === 0) return 0
  if (p <= 6) return 1 + ((p - 1 + k) % 6)
  const d = Math.floor((p - 7) / 2)
  return 7 + 2 * ((d + k) % 6) + ((p - 7) % 2)
}

/** The direction (0..5) from `tile` that points closest to the middle of the map; exact ties go to the
 * counter-clockwise one, so the choice survives a 180° rotation of the map. */
function towardMiddle(map: GameMap, tile: TileId): number {
  const mid = middleVector(map, tile)
  let best = 0
  let bestKey: [number, number] = [-Infinity, -Infinity]
  AXIAL_DIRS.forEach(([q, r], d) => {
    const key = facing(mid, SQRT3 * (q + r / 2), 1.5 * r)
    if (better(key, bestKey)) [best, bestKey] = [d, key]
  })
  return best
}
